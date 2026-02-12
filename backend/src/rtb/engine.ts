import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { aceService } from '../services/ace.service';
import { creService } from '../services/cre.service';
import { applyHolderPerks, computePrePing, HOLDER_SCORE_BONUS } from '../services/holder-perks.service';
import { findNotifiableHolders } from '../services/notification.service';
import { LEAD_AUCTION_DURATION_SECS } from '../config/perks.env';

// ============================================
// RTB Engine
// ============================================

interface MatchResult {
    matches: boolean;
    buyerId: string;
    score: number;
    reason?: string;
}

class RTBEngine {
    // ============================================
    // Lead Intake Processing
    // ============================================

    async processLeadIntake(leadId: string): Promise<{ success: boolean; error?: string }> {
        try {
            const lead = await prisma.lead.findUnique({
                where: { id: leadId },
                include: { seller: { include: { user: true } } },
            });

            if (!lead) {
                return { success: false, error: 'Lead not found' };
            }

            // Verify lead with CRE
            const verification = await creService.verifyLead(leadId);
            if (!verification.isValid) {
                await prisma.lead.update({
                    where: { id: leadId },
                    data: { status: 'CANCELLED' },
                });
                return { success: false, error: verification.reason };
            }

            // Check seller compliance with ACE
            const sellerCompliance = await aceService.canTransact(
                lead.seller.user.walletAddress,
                lead.vertical,
                (lead.geo as any)?.geoHash || ''
            );

            if (!sellerCompliance.allowed) {
                await prisma.lead.update({
                    where: { id: leadId },
                    data: { status: 'CANCELLED' },
                });
                return { success: false, error: sellerCompliance.reason };
            }

            // Find matching asks
            const matchingAsks = await this.findMatchingAsks(lead);

            if (matchingAsks.length === 0) {
                // No immediate matches - keep lead pending
                return { success: true };
            }

            // Start auction
            const ask = matchingAsks[0];
            const auctionDuration = ask.auctionDuration || LEAD_AUCTION_DURATION_SECS;
            const revealWindow = ask.revealWindow || 900;

            // Compute pre-ping window with per-auction nonce for unpredictability
            // (Fix #16: must use nonce to stay in sync with createAuction logic)
            const prePingNonce = crypto.randomBytes(8).toString('hex');
            const prePingSeconds = computePrePing(lead.vertical, prePingNonce);
            const auctionStartAt = new Date();

            await prisma.$transaction([
                prisma.lead.update({
                    where: { id: leadId },
                    data: {
                        askId: ask.id,
                        status: 'IN_AUCTION',
                        auctionStartAt,
                        auctionEndAt: new Date(Date.now() + auctionDuration * 1000),
                    },
                }),
                prisma.auctionRoom.create({
                    data: {
                        leadId,
                        roomId: `auction_${leadId}`,
                        phase: 'BIDDING',
                        prePingEndsAt: new Date(auctionStartAt.getTime() + prePingSeconds * 1000),
                        prePingNonce, // Persist for audit trail / recomputation
                        biddingEndsAt: new Date(Date.now() + auctionDuration * 1000),
                        revealEndsAt: new Date(Date.now() + (auctionDuration + revealWindow) * 1000),
                    },
                }),
            ]);

            // Notify matching buyers
            await this.notifyMatchingBuyers(leadId);

            return { success: true };
        } catch (error) {
            console.error('Lead intake error:', error);
            return { success: false, error: 'Processing failed' };
        }
    }

    // ============================================
    // Find Matching Asks
    // ============================================

    private async findMatchingAsks(lead: any) {
        const geoData = lead.geo as any;

        const asks = await prisma.ask.findMany({
            where: {
                vertical: lead.vertical,
                status: 'ACTIVE',
                expiresAt: { gt: new Date() },
            },
            orderBy: { reservePrice: 'desc' },
        });

        // Filter by geo match and parameters
        const matchingAsks = [];

        for (const ask of asks) {
            const geoTargets = ask.geoTargets as any;

            // Check country match first
            if (geoTargets?.country && geoData?.country) {
                if (geoTargets.country !== geoData.country) continue;
            }

            // Check region/state match
            if (geoTargets?.regions?.length > 0 && geoData?.state) {
                if (!geoTargets.regions.includes(geoData.state)) continue;
            } else if (geoTargets?.states?.length > 0 && geoData?.state) {
                // Backward compat: legacy "states" field
                if (!geoTargets.states.includes(geoData.state)) continue;
            }

            // Check off-site toggle
            if (!ask.acceptOffSite && lead.source === 'OFFSITE') continue;

            // Check parameters
            if (ask.parameters && lead.parameters) {
                const match = await creService.matchLeadToAsk(lead.id, ask.id);
                if (!match.matches) continue;
            }

            matchingAsks.push(ask);
        }

        return matchingAsks;
    }

    // ============================================
    // Notify Matching Buyers
    // ============================================

    private async notifyMatchingBuyers(leadId: string) {
        const lead = await prisma.lead.findUnique({
            where: { id: leadId },
        });

        if (!lead) return;

        // Find buyers with matching preferences
        const buyers = await prisma.buyerProfile.findMany({
            where: {
                kycStatus: 'VERIFIED',
                OR: [
                    { verticals: { has: lead.vertical } },
                    { verticals: { isEmpty: true } },
                ],
            },
            include: { user: true },
            take: 100,
        });

        const geoData = lead.geo as any;

        for (const buyer of buyers) {
            // Check off-site toggle
            if (!buyer.acceptOffSite && lead.source === 'OFFSITE') continue;

            // Check geo filters
            const geoFilters = buyer.geoFilters as any;
            // Country match
            if (geoFilters?.country && geoData?.country) {
                if (geoFilters.country !== geoData.country) continue;
            }
            // Region match (support both "regions" and legacy "states")
            const regionList = geoFilters?.regions || geoFilters?.states;
            if (regionList?.length > 0 && geoData?.state) {
                if (!regionList.includes(geoData.state)) continue;
            }
            const excludeList = geoFilters?.excludeRegions || geoFilters?.excludeStates;
            if (excludeList?.includes(geoData?.state)) continue;

            // Notify buyer — holders get priority notification
            const holderPerks = await applyHolderPerks(lead.vertical, buyer.user.walletAddress);
            if (holderPerks.isHolder) {
                console.log(`[RTB] Priority notify holder ${buyer.user.walletAddress} about lead ${leadId} (${holderPerks.prePingSeconds}s pre-ping)`);
            } else {
                console.log(`[RTB] Notify buyer ${buyer.user.walletAddress} about lead ${leadId}`);
            }
        }
    }

    // ============================================
    // Match Buyer to Lead
    // ============================================

    async matchBuyerToLead(buyerId: string, leadId: string): Promise<MatchResult> {
        const [buyer, lead] = await Promise.all([
            prisma.buyerProfile.findFirst({
                where: { userId: buyerId },
                include: { user: true },
            }),
            prisma.lead.findUnique({ where: { id: leadId } }),
        ]);

        if (!buyer || !lead) {
            return { matches: false, buyerId, score: 0, reason: 'Buyer or lead not found' };
        }

        // Check ACE compliance
        const compliance = await aceService.canTransact(
            buyer.user.walletAddress,
            lead.vertical,
            (lead.geo as any)?.geoHash || ''
        );

        if (!compliance.allowed) {
            return { matches: false, buyerId, score: 0, reason: compliance.reason };
        }

        // Check vertical preference
        if (buyer.verticals.length > 0 && !buyer.verticals.includes(lead.vertical)) {
            return { matches: false, buyerId, score: 0, reason: 'Vertical not in preferences' };
        }

        // Check off-site toggle
        if (!buyer.acceptOffSite && lead.source === 'OFFSITE') {
            return { matches: false, buyerId, score: 0, reason: 'Off-site leads not accepted' };
        }

        // Check verified requirement
        if (buyer.requireVerified && !lead.isVerified) {
            return { matches: false, buyerId, score: 0, reason: 'Verified leads only' };
        }

        // Check geo
        const geoData = lead.geo as any;
        const geoFilters = buyer.geoFilters as any;

        // Country match
        if (geoFilters?.country && geoData?.country) {
            if (geoFilters.country !== geoData.country) {
                return { matches: false, buyerId, score: 0, reason: 'Country mismatch' };
            }
        }

        // Region match (support both "regions" and legacy "states")
        const regionList = geoFilters?.regions || geoFilters?.states;
        if (regionList?.length > 0 && geoData?.state) {
            if (!regionList.includes(geoData.state)) {
                return { matches: false, buyerId, score: 0, reason: 'Geographic mismatch' };
            }
        }

        const excludeList = geoFilters?.excludeRegions || geoFilters?.excludeStates;
        if (excludeList?.includes(geoData?.state)) {
            return { matches: false, buyerId, score: 0, reason: 'Geographic exclusion' };
        }

        // Calculate match score
        let score = 5000;
        if (buyer.verticals.includes(lead.vertical)) score += 1500;
        const matchRegionList = geoFilters?.regions || geoFilters?.states;
        if (matchRegionList?.includes(geoData?.state)) score += 1000;
        if (geoFilters?.country && geoData?.country && geoFilters.country === geoData.country) score += 500;
        if (lead.isVerified) score += 500;

        // Holder priority: +2000 score bonus for NFT holders
        const holderPerks = await applyHolderPerks(lead.vertical, buyer.user.walletAddress);
        if (holderPerks.isHolder) {
            score += HOLDER_SCORE_BONUS;
        }

        return { matches: true, buyerId, score: Math.min(10000, score) };
    }

    // ============================================
    // Settlement (x402 Integration Placeholder)
    // ============================================

    async initiateSettlement(transactionId: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
        try {
            const transaction = await prisma.transaction.findUnique({
                where: { id: transactionId },
                include: {
                    lead: { include: { seller: { include: { user: true } } } },
                    buyer: true,
                },
            });

            if (!transaction) {
                return { success: false, error: 'Transaction not found' };
            }

            if (transaction.status !== 'PENDING') {
                return { success: false, error: 'Transaction not pending' };
            }

            // TODO: Implement x402 payment protocol integration
            // For now, simulate settlement

            // Simulated escrow flow:
            // 1. Buyer approves USDC transfer
            // 2. Escrow contract holds funds
            // 3. Lead data revealed to buyer
            // 4. After confirmation period, funds released to seller

            const mockTxHash = `0x${Date.now().toString(16)}${'0'.repeat(48)}`;

            await prisma.transaction.update({
                where: { id: transactionId },
                data: {
                    status: 'ESCROWED',
                    txHash: mockTxHash,
                    confirmedAt: new Date(),
                },
            });

            // Update seller reputation
            await prisma.sellerProfile.update({
                where: { id: transaction.lead.seller.id },
                data: {
                    totalLeadsSold: { increment: 1 },
                    reputationScore: { increment: 100 }, // Boost reputation
                },
            });

            return { success: true, txHash: mockTxHash };
        } catch (error) {
            console.error('Settlement error:', error);
            return { success: false, error: 'Settlement failed' };
        }
    }

    // ============================================
    // Release Escrow
    // ============================================

    async releaseEscrow(transactionId: string): Promise<{ success: boolean; error?: string }> {
        try {
            const transaction = await prisma.transaction.findUnique({
                where: { id: transactionId },
            });

            if (!transaction || transaction.status !== 'ESCROWED') {
                return { success: false, error: 'Transaction not in escrow' };
            }

            await prisma.transaction.update({
                where: { id: transactionId },
                data: {
                    status: 'RELEASED',
                    escrowReleased: true,
                    releasedAt: new Date(),
                },
            });

            return { success: true };
        } catch (error) {
            console.error('Escrow release error:', error);
            return { success: false, error: 'Release failed' };
        }
    }
}

export const rtbEngine = new RTBEngine();
