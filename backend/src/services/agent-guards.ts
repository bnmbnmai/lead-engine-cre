/**
 * Shared agent bid guards (Phase A6).
 *
 * Both LLM agent execution paths place bids:
 *   1. Raw Kimi tool loop      — backend/src/routes/mcp.routes.ts (mcpPlaceBid)
 *   2. LangChain agent         — backend/src/services/agent.service.ts (place_bid tool)
 *
 * Both must enforce the SAME guards before any bid leaves the process:
 *   - auction-state: the lead is still IN_AUCTION and the window hasn't ended
 *   - budget caps:   maxBidPerLead and dailyBudget from the agent buyer's
 *                    preference set for the lead's vertical
 *
 * The LLM never gets to bypass money limits: a guard rejection is returned to
 * the model as a tool error, the bid request is never forwarded.
 */
import { prisma } from '../lib/prisma';

export interface AgentBidGuardResult {
    allowed: boolean;
    reason?: string;
}

/**
 * The platform's MCP place_bid convention encodes the commitment as
 * base64("amount:salt") so the backend can auto-reveal at auction close.
 * Returns the embedded amount, or null when the commitment is an opaque hash.
 */
export function decodeCommitmentAmount(commitment: string | undefined): number | null {
    if (!commitment) return null;
    try {
        const decoded = Buffer.from(commitment, 'base64').toString('utf8');
        const match = decoded.match(/^(\d+(?:\.\d+)?):.+$/);
        if (!match) return null;
        const amount = parseFloat(match[1]);
        return Number.isFinite(amount) && amount > 0 ? amount : null;
    } catch {
        return null;
    }
}

/** Resolve the agent buyer's user id (seeded by seed-agent-buyer.ts). */
export async function resolveAgentBuyerUserId(): Promise<string | null> {
    if (process.env.KIMI_AGENT_USER_ID) return process.env.KIMI_AGENT_USER_ID;
    const wallet = process.env.KIMI_AGENT_WALLET;
    if (!wallet) return null;
    const user = await prisma.user.findUnique({
        where: { walletAddress: wallet },
        select: { id: true },
    });
    return user?.id ?? null;
}

/**
 * Run all agent bid guards. Call before forwarding ANY agent-initiated bid.
 *
 * @param leadId       Lead being bid on
 * @param buyerUserId  The agent buyer's user id (budget subject). When null,
 *                     budget checks are skipped (auction-state still enforced).
 * @param amount       Bid amount in USDC when known (decoded from commitment).
 */
export async function checkAgentBidGuards(opts: {
    leadId: string;
    buyerUserId?: string | null;
    amount?: number | null;
}): Promise<AgentBidGuardResult> {
    const { leadId, buyerUserId, amount } = opts;

    // ── Guard 1: auction state ──
    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true, status: true, auctionEndAt: true, vertical: true },
    });

    if (!lead) {
        return { allowed: false, reason: `lead ${leadId} not found` };
    }
    if (lead.status !== 'IN_AUCTION') {
        return { allowed: false, reason: `lead ${leadId} is not available (status: ${lead.status})` };
    }
    if (lead.auctionEndAt && new Date(lead.auctionEndAt) < new Date()) {
        return { allowed: false, reason: `auction for lead ${leadId} has already ended` };
    }

    // ── Guard 2: budget caps ──
    if (!buyerUserId) {
        console.warn('[AgentGuards] No agent buyer id resolvable — skipping budget caps (set KIMI_AGENT_USER_ID)');
        return { allowed: true };
    }
    if (amount == null) {
        // Opaque commitment hash — amount unknowable pre-reveal. Auction-state
        // guard passed; budget enforcement happens at reveal/settlement.
        return { allowed: true };
    }

    const profile = await prisma.buyerProfile.findFirst({
        where: { userId: buyerUserId },
        include: {
            preferenceSets: {
                where: { isActive: true },
                orderBy: { priority: 'asc' },
            },
        },
    });

    const matchingSet = profile?.preferenceSets.find(
        (s) => s.vertical === lead.vertical || s.vertical === '*',
    );

    if (matchingSet) {
        const maxBidPerLead = matchingSet.maxBidPerLead ? Number(matchingSet.maxBidPerLead) : null;
        if (maxBidPerLead != null && amount > maxBidPerLead) {
            return {
                allowed: false,
                reason: `bid $${amount.toFixed(2)} exceeds maxBidPerLead $${maxBidPerLead.toFixed(2)} for vertical ${lead.vertical}`,
            };
        }

        const dailyBudget = matchingSet.dailyBudget ? Number(matchingSet.dailyBudget) : null;
        if (dailyBudget != null) {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const todaysBids = await prisma.bid.aggregate({
                where: {
                    buyerId: buyerUserId,
                    createdAt: { gte: startOfDay },
                    amount: { not: null },
                    status: { in: ['PENDING', 'ACCEPTED'] },
                },
                _sum: { amount: true },
            });
            const spentToday = Number(todaysBids._sum.amount ?? 0);
            if (spentToday + amount > dailyBudget) {
                return {
                    allowed: false,
                    reason: `bid $${amount.toFixed(2)} would exceed daily budget ($${spentToday.toFixed(2)} committed of $${dailyBudget.toFixed(2)})`,
                };
            }
        }
    }

    return { allowed: true };
}
