/**
 * Strategy simulation / backtesting (Phase C4).
 * Replays historical leads against a StrategySpec using the same
 * deterministic executor as live trading — no bids placed.
 */

import { prisma } from '../../lib/prisma';
import { parseStrategySpec, type LeadData } from '@lead-engine/rules-engine';
import { executeStrategy } from '../strategy/executor';

export interface SimulationReport {
    strategyId: string;
    strategyVersion: number;
    leadsEvaluated: number;
    wouldBid: number;
    wouldSkip: number;
    estimatedSpend: number;
    avgBidAmount: number;
    gateFailures: Record<string, number>;
    decisions: Array<{
        leadId: string;
        vertical: string;
        shouldBid: boolean;
        bidAmount: number | null;
        reason: string;
    }>;
}

export async function simulateStrategy(opts: {
    strategyId: string;
    ownerId: string;
    days?: number;
    limit?: number;
}): Promise<SimulationReport> {
    const strategy = await prisma.agentStrategy.findFirst({
        where: { id: opts.strategyId, ownerId: opts.ownerId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!strategy?.versions[0]) throw new Error('Strategy not found');

    const spec = parseStrategySpec(strategy.versions[0].spec);
    const since = new Date(Date.now() - (opts.days ?? 30) * 86400000);
    const limit = Math.min(opts.limit ?? 100, 500);

    const leads = await prisma.lead.findMany({
        where: {
            createdAt: { gte: since },
            vertical: spec.gates.vertical === '*' ? undefined : spec.gates.vertical,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });

    const gateFailures: Record<string, number> = {};
    const decisions: SimulationReport['decisions'] = [];
    let wouldBid = 0;
    let wouldSkip = 0;
    let estimatedSpend = 0;

    for (const lead of leads) {
        const geo = lead.geo as any;
        const leadData: LeadData = {
            id: lead.id,
            vertical: lead.vertical,
            geo: {
                country: geo?.country || 'US',
                state: geo?.state || geo?.region,
                city: geo?.city,
                zip: geo?.zip,
            },
            source: (lead.source as string) || 'DIRECT',
            qualityScore: (lead as any).qualityScore ?? null,
            isVerified: lead.isVerified ?? false,
            reservePrice: Number(lead.reservePrice ?? 0),
            parameters: (lead as any).parameters ?? null,
        };

        const decision = executeStrategy(spec, leadData, {
            spentTodayUsd: 0,
            activeBidCount: 0,
        });

        if (decision.shouldBid) {
            wouldBid++;
            estimatedSpend += decision.bidAmount ?? 0;
        } else {
            wouldSkip++;
            if (decision.blockedBy === 'gates') {
                const key = decision.reason.split(':')[0] || 'gate';
                gateFailures[key] = (gateFailures[key] ?? 0) + 1;
            }
        }

        decisions.push({
            leadId: lead.id,
            vertical: lead.vertical,
            shouldBid: decision.shouldBid,
            bidAmount: decision.bidAmount,
            reason: decision.reason,
        });
    }

    return {
        strategyId: strategy.id,
        strategyVersion: strategy.versions[0].version,
        leadsEvaluated: leads.length,
        wouldBid,
        wouldSkip,
        estimatedSpend: round2(estimatedSpend),
        avgBidAmount: wouldBid > 0 ? round2(estimatedSpend / wouldBid) : 0,
        gateFailures,
        decisions,
    };
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
