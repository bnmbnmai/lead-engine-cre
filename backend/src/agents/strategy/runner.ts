/**
 * Strategy Runner (Phase C1)
 * --------------------------
 * Bridges the pure executor to the live marketplace: loads ACTIVE
 * strategies, builds the real-time execution context (spend, open bids,
 * Data Feeds floor), executes each spec deterministically, and places the
 * resulting bids through bid.service (server-custody sealed commit-reveal).
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

async function buildSpendContext(ownerId: string): Promise<{
    spentTodayUsd: number;
    activeBidCount: number;
    totalSpentUsd: number;
}> {
    const [todayAgg, openBids, lifetimeAgg] = await Promise.all([
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
        prisma.bid.aggregate({
            _sum: { amount: true },
            where: {
                buyerId: ownerId,
                status: { in: ['PENDING', 'REVEALED', 'ACCEPTED'] },
            },
        }),
    ]);

    return {
        spentTodayUsd: Number(todayAgg._sum.amount ?? 0),
        activeBidCount: openBids,
        totalSpentUsd: Number(lifetimeAgg._sum.amount ?? 0),
    };
}

async function buildContext(
    ownerId: string,
    vertical: string,
    spend?: { spentTodayUsd: number; activeBidCount: number; totalSpentUsd: number },
): Promise<StrategyExecutionContext> {
    const spendCtx = spend ?? await buildSpendContext(ownerId);

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
        spentTodayUsd: spendCtx.spentTodayUsd,
        activeBidCount: spendCtx.activeBidCount,
        totalSpentUsd: spendCtx.totalSpentUsd,
    };
}

/**
 * Execute all ACTIVE strategies against a lead and place bids for the ones
 * that match. Called from the auto-bid engine after preference sets run.
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

        const outcome: StrategyRunOutcome = {
            strategyId: strategy.id,
            strategyName: strategy.name,
            ownerId: strategy.ownerId,
            version: versionRow.version,
            shouldBid: false,
            bidAmount: null,
            reason: 'skipped',
            bidPlaced: false,
        };

        try {
            await prisma.$transaction(async (tx) => {
                const spend = await (async () => {
                    const [todayAgg, openBids, lifetimeAgg] = await Promise.all([
                        tx.bid.aggregate({
                            _sum: { amount: true },
                            where: {
                                buyerId: strategy.ownerId,
                                createdAt: { gte: utcDayStart() },
                                status: { in: ['PENDING', 'REVEALED', 'ACCEPTED'] },
                            },
                        }),
                        tx.bid.count({
                            where: { buyerId: strategy.ownerId, status: { in: ['PENDING', 'REVEALED'] } },
                        }),
                        tx.bid.aggregate({
                            _sum: { amount: true },
                            where: {
                                buyerId: strategy.ownerId,
                                status: { in: ['PENDING', 'REVEALED', 'ACCEPTED'] },
                            },
                        }),
                    ]);
                    return {
                        spentTodayUsd: Number(todayAgg._sum.amount ?? 0),
                        activeBidCount: openBids,
                        totalSpentUsd: Number(lifetimeAgg._sum.amount ?? 0),
                    };
                })();

                const ctx = await buildContext(strategy.ownerId, lead.vertical, spend);
                const decision = executeStrategy(spec, lead, ctx);

                outcome.shouldBid = decision.shouldBid;
                outcome.bidAmount = decision.bidAmount;
                outcome.reason = decision.reason;

                if (!decision.shouldBid || decision.bidAmount == null) return;

                const user = await tx.user.findUnique({
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
            });
        } catch (err: any) {
            outcome.bidError = err.message;
        }

        outcomes.push(outcome);
        console.log(
            `[Strategy] ${strategy.name} v${versionRow.version} on lead ${lead.id}: ` +
            `${outcome.bidPlaced ? `BID $${outcome.bidAmount}` : `SKIP (${outcome.reason})`}`,
        );
    }

    return outcomes;
}
