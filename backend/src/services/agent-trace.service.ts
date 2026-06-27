/**
 * Agent decision trace persistence (Phase C6).
 */

import { prisma } from '../lib/prisma';
import type { StageTrace } from '../agents/orchestrator/types';

export async function persistDecisionTrace(opts: {
    leadId: string;
    trigger: string;
    traces: StageTrace[];
    bidsPlaced: number;
    ownerId?: string;
    outcome?: string;
}): Promise<void> {
    await prisma.agentDecisionTrace.create({
        data: {
            leadId: opts.leadId,
            ownerId: opts.ownerId,
            trigger: opts.trigger,
            traces: opts.traces as object[],
            bidsPlaced: opts.bidsPlaced,
            outcome: opts.outcome,
        },
    });
}

export async function listDecisionTraces(opts: {
    ownerId?: string;
    leadId?: string;
    limit?: number;
}) {
    return prisma.agentDecisionTrace.findMany({
        where: {
            ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
            ...(opts.leadId ? { leadId: opts.leadId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(opts.limit ?? 50, 200),
    });
}

/** Update agent reputation after settlement (Phase C3). */
export async function recordAgentSettlementAttestation(ownerId: string, won: boolean): Promise<void> {
    const profile = await prisma.agentProfile.findUnique({ where: { ownerId } });
    if (!profile) return;

    const wins = profile.wins + (won ? 1 : 0);
    const settlements = profile.settlements + 1;
    const reputationScore = settlements > 0 ? Math.round((wins / settlements) * 10000) : profile.reputationScore;

    await prisma.agentProfile.update({
        where: { id: profile.id },
        data: { wins, settlements, reputationScore },
    });
}
