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

    if (opts.ownerId) {
        try {
            const { fireAgentWebhooks } = await import('./agent-webhook.service');
            await fireAgentWebhooks(opts.ownerId, 'strategy.decision', {
                leadId: opts.leadId,
                trigger: opts.trigger,
                bidsPlaced: opts.bidsPlaced,
                traces: opts.traces,
            });
        } catch { /* non-blocking */ }
    }
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

    const wallet = profile.walletAddress
        ?? (await prisma.user.findUnique({ where: { id: ownerId }, select: { walletAddress: true } }))?.walletAddress;

    if (wallet) {
        try {
            const { attestAgentSettlementOnChain } = await import('./agent-registry.service');
            await attestAgentSettlementOnChain(wallet, won);
        } catch (err: any) {
            console.warn(`[AgentTrace] on-chain attestation skipped: ${err.message}`);
        }
    }

    try {
        const { fireAgentWebhooks } = await import('./agent-webhook.service');
        await fireAgentWebhooks(ownerId, 'auction.won', { ownerId, won, settlements, wins, reputationScore });
    } catch { /* non-blocking */ }
}

/** Update seller reputation after settlement / auction close. */
export async function recordSellerSettlementAttestation(sellerUserId: string, sold: boolean): Promise<void> {
    const seller = await prisma.sellerProfile.findUnique({ where: { userId: sellerUserId } });
    if (!seller) return;

    const totalLeadsSold = seller.totalLeadsSold + (sold ? 1 : 0);
    const currentRep = Number(seller.reputationScore);
    const reputationScore = sold
        ? Math.min(10000, currentRep + 50)
        : Math.max(0, currentRep - 25);

    await prisma.sellerProfile.update({
        where: { id: seller.id },
        data: { totalLeadsSold, reputationScore },
    });

    try {
        const { fireSellerWebhooks } = await import('./agent-webhook.service');
        if (sold) {
            await fireSellerWebhooks(sellerUserId, 'settlement.paid', {
                sellerId: seller.id,
                sold,
                totalLeadsSold,
                reputationScore,
            });
        }
    } catch { /* non-blocking */ }
}
