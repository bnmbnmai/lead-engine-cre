import { prisma } from '../lib/prisma';
import { aceService } from '../services/ace.service';
import { creService } from '../services/cre.service';
import { applyHolderPerks, HOLDER_EARLY_PING_SECONDS, HOLDER_SCORE_BONUS } from '../services/holder-perks.service';
import { evaluateLeadForAutoBid } from '../services/auto-bid.service';
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
    // Lead Intake Processing (Sealed-Bid Auction Flow)
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

            // Stage 1: CRE Pre-Auction Gate + Numeric Pre-Score
            // Runs real checks (data integrity, TCPA consent, geo validation)
            // and computes numeric score (0–10,000) using the same JS as the DON.
            const preScore = await creService.computePreScore(leadId);
            console.log(
                `[RTB] Lead ${leadId} pre-score=${preScore.score}/10000: ` +
                `data=${preScore.checks.dataIntegrity} tcpa=${preScore.checks.tcpaConsent} geo=${preScore.checks.geoValid} ` +
                `→ ${preScore.admitted ? 'ADMITTED' : 'REJECTED'}`
            );

            if (!preScore.admitted) {
                await prisma.lead.update({
                    where: { id: leadId },
                    data: { status: 'CANCELLED' },
                });
                return { success: false, error: preScore.reason || 'Failed CRE pre-gate' };
            }

            // Mark lead as verified + store numeric pre-score
            await prisma.lead.update({
                where: { id: leadId },
                data: { isVerified: true, qualityScore: preScore.score },
            });

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
                // No immediate matches — revert to PENDING_AUCTION
                await prisma.lead.update({
                    where: { id: leadId },
                    data: { status: 'PENDING_AUCTION' },
                });
                return { success: true };
            }

            // ── Unified 60-Second Sealed-Bid Auction ──
            // All bidding (ping-post, manual, auto-bid) happens in one window.
            const ask = matchingAsks[0];
            const now = new Date();
            const auctionEndsAt = new Date(now.getTime() + LEAD_AUCTION_DURATION_SECS * 1000);

            await prisma.$transaction([
                prisma.lead.update({
                    where: { id: leadId },
                    data: {
                        askId: ask.id,
                        status: 'IN_AUCTION',
                        auctionStartAt: now,
                        auctionEndAt: auctionEndsAt,
                    },
                }),
                prisma.auctionRoom.create({
                    data: {
                        leadId,
                        roomId: `auction_${leadId}`,
                        phase: 'BIDDING',
                        biddingEndsAt: auctionEndsAt,
                        revealEndsAt: auctionEndsAt, // No separate reveal — kept for schema compat
                    },
                }),
            ]);

            // Notify matching buyers (holders get a head start)
            await this.notifyMatchingBuyers(leadId);

            console.log(`[RTB] Lead ${leadId} entered IN_AUCTION (${LEAD_AUCTION_DURATION_SECS}s window)`);
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
            include: {
                ask: { select: { vertical: true, reservePrice: true, buyNowPrice: true } },
                seller: { include: { user: true } },
            },
        });

        if (!lead) return;

        // ── Read stored CRE quality score (null for pre-NFT leads = "Pending CRE") ──
        const qualityScore = (lead as any).qualityScore ?? null;

        // ── Fetch seller ACE compliance attestation ──
        const aceAttestation = await aceService.canTransact(
            lead.seller.user.walletAddress,
            lead.vertical,
            (lead.geo as any)?.geoHash || ''
        );

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

        // Build enriched non-PII preview payload (safe to send pre-purchase)
        const pingPayload = {
            leadId,
            vertical: lead.vertical,
            geo: { state: geoData?.state, country: geoData?.country },
            reservePrice: lead.ask?.reservePrice ? Number(lead.ask.reservePrice) : null,
            auctionEndAt: lead.auctionEndAt,
            // ── CRE Score + Proof ──
            qualityScore,                         // 0-10000 CRE computed score
            proofHash: lead.dataHash || null,      // ZK proof hash (non-PII)
            isVerified: lead.isVerified,
            // ── ACE Attestation ──
            aceCompliant: aceAttestation.allowed,
            aceReason: aceAttestation.reason || null,
        };

        // Partition buyers into holders and non-holders
        const holders: string[] = [];
        const nonHolders: string[] = [];

        for (const buyer of buyers) {
            // Check off-site toggle
            if (!buyer.acceptOffSite && lead.source === 'OFFSITE') continue;

            // Check geo filters
            const geoFilters = buyer.geoFilters as any;
            if (geoFilters?.country && geoData?.country) {
                if (geoFilters.country !== geoData.country) continue;
            }
            const regionList = geoFilters?.regions || geoFilters?.states;
            if (regionList?.length > 0 && geoData?.state) {
                if (!regionList.includes(geoData.state)) continue;
            }
            const excludeList = geoFilters?.excludeRegions || geoFilters?.excludeStates;
            if (excludeList?.includes(geoData?.state)) continue;

            // Check NFT ownership (cached, fast)
            const holderPerks = await applyHolderPerks(lead.vertical, buyer.user.walletAddress);
            if (holderPerks.isHolder) {
                holders.push(buyer.userId);
            } else {
                nonHolders.push(buyer.userId);
            }
        }

        // ── Staggered Ping ──
        // Holders get lead:ping immediately (12s head start)
        if (holders.length > 0) {
            console.log(`[RTB] Holder ping → ${holders.length} holders for lead ${leadId} (${HOLDER_EARLY_PING_SECONDS}s head start)`);
            this.emitToUsers(holders, 'lead:ping', {
                ...pingPayload,
                isHolderPing: true,
                headStartSeconds: HOLDER_EARLY_PING_SECONDS,
            });
        }

        // Non-holders get lead:ping after HOLDER_EARLY_PING_SECONDS delay
        if (nonHolders.length > 0) {
            setTimeout(() => {
                console.log(`[RTB] Standard ping → ${nonHolders.length} buyers for lead ${leadId}`);
                this.emitToUsers(nonHolders, 'lead:ping', {
                    ...pingPayload,
                    isHolderPing: false,
                    headStartSeconds: 0,
                });
            }, HOLDER_EARLY_PING_SECONDS * 1000);
        }

        // ── Auto-Bid Evaluation ──
        // Trigger auto-bid rules so buyers with matching pref sets automatically
        // place bids during the auction window.
        // Gated by the demo buyers toggle — when OFF, no auto-bids fire.
        const { getDemoBuyersEnabled } = await import('../routes/demo-panel.routes');
        if (!(await getDemoBuyersEnabled())) {
            console.log(`[RTB] Auto-bid skipped for lead ${leadId} — demo buyers disabled`);
        } else {
            try {
                const autoBidResult = await evaluateLeadForAutoBid({
                    id: leadId,
                    vertical: lead.vertical,
                    geo: {
                        country: geoData?.country || 'US',
                        state: geoData?.state,
                        city: geoData?.city,
                        zip: geoData?.zip,
                    },
                    source: lead.source as string,
                    qualityScore,
                    isVerified: lead.isVerified,
                    reservePrice: Number(lead.reservePrice ?? 0),
                });

                if (autoBidResult.bidsPlaced.length > 0) {
                    console.log(`[RTB] Auto-bid placed ${autoBidResult.bidsPlaced.length} bids for lead ${leadId}`);
                }
            } catch (err) {
                console.error(`[RTB] Auto-bid evaluation failed for lead ${leadId}:`, err);
            }
        }
    }

    /**
     * Emit a socket event to specific users by userId.
     * Iterates connected sockets and matches by authenticated userId.
     */
    private emitToUsers(userIds: string[], event: string, data: any) {
        const sockets = (this as any).io?.sockets?.sockets;
        if (!sockets) return;
        for (const [, socket] of sockets) {
            if (userIds.includes((socket as any).userId)) {
                socket.emit(event, data);
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

            // ⚠️ DEPRECATED — settlement goes through client-side RTBEscrow signing.
            // The real flow is: marketplace.routes.ts → x402Service.prepareEscrowTx()
            // → buyer signs in MetaMask → x402Service.confirmEscrowTx().
            console.error(`[ENGINE] ⚠️ initiateSettlement called for tx=${transactionId} — this method is deprecated. Use client-side escrow flow.`);
            return { success: false, error: 'Settlement must go through client-side escrow flow (RTBEscrow). This method is deprecated.' };
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
