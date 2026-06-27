/**
 * Strategy Runner (Phase C1)
 * --------------------------
 * Bridges the pure executor to the live marketplace: loads ACTIVE
 * strategies, builds the real-time execution context (spend, open bids,
 * Data Feeds floor), executes each spec deterministically, and places the
 * resulting bids through bid.service (server-custody sealed commit-reveal).
 *
 * The LLM is nowhere in this path. All money flows through the same
 * BidService caps as every other bid source.
 */

import { prisma } from '../../lib/prisma';
import { executeStrategy, type StrategyExecutionContext } from './executor';
import { parseStrategySpec, type LeadData, type StrategySpec } from '@lead-engine/rules-engine';

export interface StrategyRunOutcome {
    strategyId: string;
    strategyName: string;
    ownerId: string;
    version: number;
    shouldBid: boolean;
    bidAmount: number | null;
    reason: string;
    bidPlaced: boolean;
    bidError?: string;
}

/** Start of "today" in UTC for daily budget windows. */
function utcDayStart(now = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Build the real-time context for one owner's strategy execution.
 * Spend figures come from revealed/placed bids today and open bids.
 */
async function buildContext(ownerId: string, vertical: string): Promise<StrategyExecutionContext> {
    const [todayAgg, openBids] = await Promise.all([
        prisma.bid.aggregate({
            _sum: { amount: true },
            where: {
                buyerId: ownerId,
                createdAt: { gte: utcDayStart() },
                status: { in: ['PENDING', 'REVEALED', 'ACCEPTED'] },
            },
        }),
        prisma.bid.count({
            where: { buyerId: ownerId, status: { in: ['PENDING', 'REVEALED'] } },
        }),
    ]);

    let dataFeedFloor: number | null = null;
    try {
        const { dataStreamsService } = await import('../../services/data-feeds.service');
        const floor = await dataStreamsService.getRealtimeBidFloor(vertical, 'US');
        dataFeedFloor = floor?.bidFloor ?? null;
    } catch {
        // Floor unavailable — floorPlus curves will clamp to their min.
    }

    return {
        dataFeedFloor,
        spentTodayUsd: Number(todayAgg._sum.amount ?? 0),
        activeBidCount: openBids,
        totalSpentUsd: undefined, // lifetime tracking lands with decision traces (C6)
    };
}

/**
 * Execute all ACTIVE strategies against a lead and place bids for the ones
 * that match. Called from the auto-bid engine after preference sets run.
 *
 * Duplicate-safe: bid.service upserts one bid per (lead, buyer), so a
 * strategy re-run (multiple triggers) cannot double-bid.
 */
export async function runStrategiesForLead(lead: LeadData): Promise<StrategyRunOutcome[]> {
    const strategies = await prisma.agentStrategy.findMany({
        where: { status: 'ACTIVE' },
        include: {
            versions: { orderBy: { version: 'desc' }, take: 1 },
        },
    });
    if (strategies.length === 0) return [];

    const outcomes: StrategyRunOutcome[] = [];

    for (const strategy of strategies) {
        const versionRow = strategy.versions[0];
        if (!versionRow) continue;

        let spec: StrategySpec;
        try {
            spec = parseStrategySpec(versionRow.spec);
        } catch (err: any) {
            console.warn(`[Strategy] ${strategy.id} v${versionRow.version} has invalid spec — skipping: ${err.message}`);
            continue;
        }

        const ctx = await buildContext(strategy.ownerId, lead.vertical);
        const decision = executeStrategy(spec, lead, ctx);

        const outcome: StrategyRunOutcome = {
            strategyId: strategy.id,
            strategyName: strategy.name,
            ownerId: strategy.ownerId,
            version: versionRow.version,
            shouldBid: decision.shouldBid,
            bidAmount: decision.bidAmount,
            reason: decision.reason,
            bidPlaced: false,
        };

        if (decision.shouldBid && decision.bidAmount != null) {
            try {
                const user = await prisma.user.findUnique({
                    where: { id: strategy.ownerId },
                    select: { walletAddress: true },
                });
                const { placeSealedBid } = await import('../../services/bid.service');
                const res = await placeSealedBid({
                    leadId: lead.id,
                    buyerId: strategy.ownerId,
                    walletAddress: user?.walletAddress,
                    serverCustody: { amount: decision.bidAmount },
                    source: 'AGENT',
                });
                outcome.bidPlaced = res.ok;
                if (!res.ok) outcome.bidError = res.error;
            } catch (err: any) {
                outcome.bidError = err.message;
            }
        }

        outcomes.push(outcome);
        console.log(
            `[Strategy] ${strategy.name} v${versionRow.version} on lead ${lead.id}: ` +
            `${outcome.bidPlaced ? `BID $${outcome.bidAmount}` : `SKIP (${outcome.reason})`}`,
        );
    }

    return outcomes;
}
