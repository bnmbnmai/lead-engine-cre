import { Router, Response } from 'express';
import { ethers } from 'ethers';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthenticatedRequest, requireBuyer } from '../middleware/auth';
import { BidCommitSchema, BidRevealSchema, BidDirectSchema, BuyerPreferencesSchema, BuyerPreferencesV2Schema } from '../utils/validation';
import { rtbBiddingLimiter } from '../middleware/rateLimit';
import { aceService } from '../services/ace.service';
import { dataStreamsService } from '../services/datastreams.service';
import { evaluateLeadForAutoBid, LeadData } from '../services/auto-bid.service';
import { applyHolderPerks, applyMultiplier } from '../services/holder-perks.service';

const router = Router();

// ── Prisma error classifier ──
function classifyPrismaError(error: unknown): { status: number; message: string; code?: string } {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        switch (error.code) {
            case 'P2025': // Record not found
                return { status: 409, message: 'Preference set was modified or deleted by another session — please reload', code: 'STALE_RECORD' };
            case 'P2002': // Unique constraint violation
                return { status: 409, message: 'Duplicate preference set detected', code: 'DUPLICATE' };
            case 'P2028': // Transaction API error
                return { status: 500, message: 'Transaction failed — please retry', code: 'TX_FAILED' };
            default:
                return { status: 500, message: `Database error (${error.code})`, code: error.code };
        }
    }
    if (error instanceof Prisma.PrismaClientValidationError) {
        return { status: 400, message: 'Invalid data format — check budget and score values', code: 'VALIDATION' };
    }
    return { status: 500, message: 'Failed to update preference sets' };
}

// ============================================
// Place Bid (Commit-Reveal or Direct)
// ============================================

router.post('/', rtbBiddingLimiter, authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Determine bid type
        const isCommitReveal = 'commitment' in req.body;

        if (isCommitReveal) {
            // Commit-reveal bid
            const validation = BidCommitSchema.safeParse(req.body);
            if (!validation.success) {
                res.status(400).json({ error: 'Invalid bid', details: validation.error.issues });
                return;
            }

            const { leadId, commitment } = validation.data;

            // Check lead exists and is in auction
            const lead = await prisma.lead.findUnique({
                where: { id: leadId },
                include: { auctionRoom: true },
            });

            if (!lead) {
                res.status(404).json({ error: 'Lead not found' });
                return;
            }

            if (lead.status !== 'IN_AUCTION') {
                res.status(400).json({ error: 'Lead is not in auction' });
                return;
            }

            if (lead.auctionEndAt && lead.auctionEndAt < new Date()) {
                res.status(400).json({ error: 'Bidding phase has ended' });
                return;
            }

            // Check buyer compliance
            const compliance = await aceService.canTransact(
                req.user!.walletAddress,
                lead.vertical,
                (lead.geo as any)?.geoHash || ''
            );

            if (!compliance.allowed) {
                res.status(403).json({ error: 'Compliance check failed', reason: compliance.reason });
                return;
            }

            // Check buyer preferences match lead
            const buyer = await prisma.buyerProfile.findFirst({
                where: { user: { id: req.user!.id } },
            });

            if (buyer) {
                // Check off-site toggle
                if (!buyer.acceptOffSite && lead.source === 'OFFSITE') {
                    res.status(400).json({ error: 'Buyer does not accept off-site leads' });
                    return;
                }

                // Check vertical preference
                if (buyer.verticals.length > 0 && !buyer.verticals.includes(lead.vertical)) {
                    res.status(400).json({ error: 'Lead vertical not in buyer preferences' });
                    return;
                }

                // Check verified requirement
                if (buyer.requireVerified && !lead.isVerified) {
                    res.status(400).json({ error: 'Buyer requires verified leads' });
                    return;
                }
            }

            // Check holder perks (pre-ping + future multiplier at reveal)
            const holderPerks = await applyHolderPerks(
                lead.vertical,
                req.user!.walletAddress,
            );

            // Create or update bid
            const bid = await prisma.bid.upsert({
                where: {
                    leadId_buyerId: { leadId, buyerId: req.user!.id },
                },
                create: {
                    leadId,
                    buyerId: req.user!.id,
                    commitment,
                    status: 'PENDING',
                },
                update: {
                    commitment,
                    status: 'PENDING',
                },
            });

            // Update auction room
            if (lead.auctionRoom) {
                await prisma.auctionRoom.update({
                    where: { id: lead.auctionRoom.id },
                    data: {
                        bidCount: { increment: 1 },
                        participants: {
                            push: req.user!.id,
                        },
                    },
                });
            }

            // Log analytics
            await prisma.analyticsEvent.create({
                data: {
                    eventType: 'bid_committed',
                    entityType: 'bid',
                    entityId: bid.id,
                    userId: req.user!.id,
                    metadata: { leadId, vertical: lead.vertical },
                },
            });

            res.status(201).json({
                bid: {
                    id: bid.id,
                    leadId: bid.leadId,
                    status: bid.status,
                    committedAt: bid.createdAt,
                },
                holderPerks: holderPerks.isHolder ? {
                    prePingSeconds: holderPerks.prePingSeconds,
                    multiplier: holderPerks.multiplier,
                } : undefined,
                message: 'Bid committed. Reveal after bidding phase ends.',
            });
        } else {
            // Direct bid (non-commit-reveal, for simpler auctions)
            const validation = BidDirectSchema.safeParse(req.body);
            if (!validation.success) {
                res.status(400).json({ error: 'Invalid bid', details: validation.error.issues });
                return;
            }

            const { leadId, amount } = validation.data;

            const lead = await prisma.lead.findUnique({
                where: { id: leadId },
                include: { auctionRoom: true },
            });

            if (!lead) {
                res.status(404).json({ error: 'Lead not found' });
                return;
            }

            if (lead.status !== 'IN_AUCTION') {
                res.status(400).json({ error: 'Lead is not in auction' });
                return;
            }

            // Check reserve price
            if (lead.reservePrice && amount < Number(lead.reservePrice)) {
                res.status(400).json({ error: 'Bid below reserve price' });
                return;
            }

            // Compliance check
            const compliance = await aceService.canTransact(
                req.user!.walletAddress,
                lead.vertical,
                (lead.geo as any)?.geoHash || ''
            );

            if (!compliance.allowed) {
                res.status(403).json({ error: 'Compliance check failed', reason: compliance.reason });
                return;
            }

            // Check holder perks
            const holderPerks = await applyHolderPerks(
                lead.vertical,
                req.user!.walletAddress,
            );

            // Apply multiplier for holders (sealed-bid advantage)
            const effectiveBid = holderPerks.isHolder
                ? applyMultiplier(amount, holderPerks.multiplier)
                : amount;

            const bid = await prisma.bid.upsert({
                where: {
                    leadId_buyerId: { leadId, buyerId: req.user!.id },
                },
                create: {
                    leadId,
                    buyerId: req.user!.id,
                    amount,            // Raw bid amount
                    effectiveBid,      // After multiplier (same as amount for non-holders)
                    status: 'REVEALED',
                    revealedAt: new Date(),
                },
                update: {
                    amount,
                    effectiveBid,
                    status: 'REVEALED',
                    revealedAt: new Date(),
                },
            });

            // Update auction room — compare using effectiveBid (not raw amount)
            if (lead.auctionRoom) {
                const currentHighest = lead.auctionRoom.highestBid ? Number(lead.auctionRoom.highestBid) : 0;
                if (effectiveBid > currentHighest) {
                    await prisma.auctionRoom.update({
                        where: { id: lead.auctionRoom.id },
                        data: {
                            highestBid: effectiveBid,
                            highestBidder: req.user!.id,
                            bidCount: { increment: 1 },
                        },
                    });
                }
            }

            // Log analytics
            await prisma.analyticsEvent.create({
                data: {
                    eventType: 'bid_placed',
                    entityType: 'bid',
                    entityId: bid.id,
                    userId: req.user!.id,
                    metadata: { leadId, amount, vertical: lead.vertical },
                },
            });

            // Push real-time analytics update to dashboards
            const io = req.app.get('io');
            if (io) {
                io.emit('analytics:update', {
                    type: 'bid',
                    leadId,
                    buyerId: req.user!.id,
                    amount,
                    vertical: lead.vertical,
                    timestamp: new Date().toISOString(),
                });
            }

            res.status(201).json({
                bid: {
                    id: bid.id,
                    leadId: bid.leadId,
                    amount: Number(bid.amount),
                    rawAmount: holderPerks.isHolder ? amount : undefined,
                    status: bid.status,
                    createdAt: bid.createdAt,
                },
                holderPerks: holderPerks.isHolder ? {
                    prePingSeconds: holderPerks.prePingSeconds,
                    multiplier: holderPerks.multiplier,
                    effectiveBid: effectiveBid,
                } : undefined,
            });
        }
    } catch (error) {
        console.error('Place bid error:', error);
        res.status(500).json({ error: 'Failed to place bid' });
    }
});

// ============================================
// Reveal Bid
// ============================================

router.post('/:bidId/reveal', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = BidRevealSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid reveal', details: validation.error.issues });
            return;
        }

        const { amount, salt } = validation.data;

        const bid = await prisma.bid.findUnique({
            where: { id: req.params.bidId },
            include: { lead: { include: { auctionRoom: true } } },
        });

        if (!bid) {
            res.status(404).json({ error: 'Bid not found' });
            return;
        }

        if (bid.buyerId !== req.user!.id) {
            res.status(403).json({ error: 'Not your bid' });
            return;
        }

        if (bid.status !== 'PENDING') {
            res.status(400).json({ error: 'Bid already revealed or processed' });
            return;
        }

        // Check we're in reveal phase
        if (bid.lead.status !== 'REVEAL_PHASE') {
            if (bid.lead.auctionEndAt && bid.lead.auctionEndAt > new Date()) {
                res.status(400).json({ error: 'Bidding phase not ended yet' });
                return;
            }

            // Move lead to reveal phase
            await prisma.lead.update({
                where: { id: bid.leadId },
                data: { status: 'REVEAL_PHASE' },
            });

            if (bid.lead.auctionRoom) {
                await prisma.auctionRoom.update({
                    where: { id: bid.lead.auctionRoom.id },
                    data: { phase: 'REVEAL' },
                });
            }
        }

        // Check reveal deadline
        if (bid.lead.auctionRoom?.revealEndsAt && bid.lead.auctionRoom.revealEndsAt < new Date()) {
            res.status(400).json({ error: 'Reveal phase has ended' });
            return;
        }

        // Verify commitment
        const expectedCommitment = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(['uint96', 'bytes32'], [amount, salt])
        );

        if (bid.commitment !== expectedCommitment) {
            res.status(400).json({ error: 'Invalid reveal - commitment mismatch' });
            return;
        }

        // Check reserve price
        if (bid.lead.reservePrice && amount < Number(bid.lead.reservePrice)) {
            await prisma.bid.update({
                where: { id: bid.id },
                data: { status: 'REJECTED', amount, salt, revealedAt: new Date() },
            });
            res.status(400).json({ error: 'Bid below reserve price' });
            return;
        }

        // Update bid
        const updatedBid = await prisma.bid.update({
            where: { id: bid.id },
            data: {
                amount,
                salt,
                status: 'REVEALED',
                revealedAt: new Date(),
            },
        });

        // Update auction room highest bid
        if (bid.lead.auctionRoom) {
            const currentHighest = bid.lead.auctionRoom.highestBid ? Number(bid.lead.auctionRoom.highestBid) : 0;
            if (amount > currentHighest) {
                await prisma.auctionRoom.update({
                    where: { id: bid.lead.auctionRoom.id },
                    data: {
                        highestBid: amount,
                        highestBidder: req.user!.id,
                    },
                });
            }
        }

        // Log analytics
        await prisma.analyticsEvent.create({
            data: {
                eventType: 'bid_revealed',
                entityType: 'bid',
                entityId: bid.id,
                userId: req.user!.id,
                metadata: { leadId: bid.leadId, amount },
            },
        });

        res.json({
            bid: {
                id: updatedBid.id,
                amount: Number(updatedBid.amount),
                status: updatedBid.status,
                revealedAt: updatedBid.revealedAt,
            },
        });
    } catch (error) {
        console.error('Reveal bid error:', error);
        res.status(500).json({ error: 'Failed to reveal bid' });
    }
});

// ============================================
// Get My Bids
// ============================================

router.get('/my', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const bids = await prisma.bid.findMany({
            where: { buyerId: req.user!.id },
            orderBy: { createdAt: 'desc' },
            include: {
                lead: {
                    select: {
                        id: true,
                        vertical: true,
                        status: true,
                        geo: true,
                        nftTokenId: true,
                        nftContractAddr: true,
                        createdAt: true,
                        auctionEndAt: true,
                    },
                },
            },
        });

        res.json({ bids });
    } catch (error) {
        console.error('Get my bids error:', error);
        res.status(500).json({ error: 'Failed to get bids' });
    }
});

// ============================================
// Withdraw Bid
// ============================================

router.delete('/:bidId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const bid = await prisma.bid.findUnique({
            where: { id: req.params.bidId },
            include: { lead: true },
        });

        if (!bid) {
            res.status(404).json({ error: 'Bid not found' });
            return;
        }

        if (bid.buyerId !== req.user!.id) {
            res.status(403).json({ error: 'Not your bid' });
            return;
        }

        // Can only withdraw pending bids before reveal phase
        if (bid.status !== 'PENDING') {
            res.status(400).json({ error: 'Cannot withdraw revealed or processed bid' });
            return;
        }

        if (bid.lead.status === 'REVEAL_PHASE' || bid.lead.status === 'SOLD') {
            res.status(400).json({ error: 'Cannot withdraw after auction ended' });
            return;
        }

        await prisma.bid.update({
            where: { id: bid.id },
            data: { status: 'WITHDRAWN' },
        });

        res.json({ success: true, message: 'Bid withdrawn' });
    } catch (error) {
        console.error('Withdraw bid error:', error);
        res.status(500).json({ error: 'Failed to withdraw bid' });
    }
});

// ============================================
// Update Buyer Preferences
// ============================================

router.put('/preferences', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = BuyerPreferencesSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid preferences', details: validation.error.issues });
            return;
        }

        const data = validation.data;

        await prisma.buyerProfile.upsert({
            where: { userId: req.user!.id },
            create: {
                userId: req.user!.id,
                verticals: data.verticals || [],
                geoFilters: data.geoFilters || {},
                budgetMin: data.budgetMin,
                budgetMax: data.budgetMax,
                dailyBudget: data.dailyBudget,
                monthlyBudget: data.monthlyBudget,
                acceptOffSite: data.acceptOffSite ?? true,
                requireVerified: data.requireVerified ?? false,
                autoAcceptLeads: data.autoAcceptLeads ?? false,
            },
            update: {
                verticals: data.verticals,
                geoFilters: data.geoFilters,
                budgetMin: data.budgetMin,
                budgetMax: data.budgetMax,
                dailyBudget: data.dailyBudget,
                monthlyBudget: data.monthlyBudget,
                acceptOffSite: data.acceptOffSite,
                requireVerified: data.requireVerified,
                autoAcceptLeads: data.autoAcceptLeads,
            },
        });

        res.json({ success: true, message: 'Preferences updated' });
    } catch (error) {
        const classified = classifyPrismaError(error);
        console.error('[PREFS] Update preferences error:', {
            userId: req.user?.id,
            code: classified.code,
            message: classified.message,
            raw: error instanceof Error ? error.message : error,
        });
        res.status(classified.status).json({ error: classified.message, code: classified.code });
    }
});

// ============================================
// Data Streams — Real-Time Bid Floor (Stub)
// ============================================

router.get('/bid-floor', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const vertical = (req.query.vertical as string) || 'solar';
        const country = (req.query.country as string) || 'US';

        const bidFloor = await dataStreamsService.getRealtimeBidFloor(vertical, country);
        const priceIndex = await dataStreamsService.getLeadPriceIndex(vertical);

        res.json({ bidFloor, priceIndex });
    } catch (error) {
        console.error('Bid floor error:', error);
        res.status(500).json({ error: 'Failed to get bid floor' });
    }
});

// ============================================
// Preference Sets V2 — Per-Vertical Multi-Set
// ============================================

router.get('/preferences/v2', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const profile = await prisma.buyerProfile.findFirst({
            where: { userId: req.user!.id },
            include: {
                preferenceSets: {
                    orderBy: { priority: 'asc' },
                },
            },
        });

        if (!profile) {
            res.json({ sets: [] });
            return;
        }

        res.json({
            sets: profile.preferenceSets.map((s) => ({
                id: s.id,
                label: s.label,
                vertical: s.vertical,
                priority: s.priority,
                geoCountries: s.geoCountries,
                geoInclude: s.geoInclude,
                geoExclude: s.geoExclude,
                maxBidPerLead: s.maxBidPerLead ? Number(s.maxBidPerLead) : undefined,
                dailyBudget: s.dailyBudget ? Number(s.dailyBudget) : undefined,
                autoBidEnabled: s.autoBidEnabled,
                autoBidAmount: s.autoBidAmount ? Number(s.autoBidAmount) : undefined,
                minQualityScore: s.minQualityScore ?? undefined,
                excludedSellerIds: s.excludedSellerIds,
                preferredSellerIds: s.preferredSellerIds,
                minSellerReputation: s.minSellerReputation ?? undefined,
                requireVerifiedSeller: s.requireVerifiedSeller,
                acceptOffSite: s.acceptOffSite,
                requireVerified: s.requireVerified,
                isActive: s.isActive,
            })),
        });
    } catch (error) {
        console.error('Get preference sets error:', error);
        res.status(500).json({ error: 'Failed to get preference sets' });
    }
});

router.put('/preferences/v2', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = BuyerPreferencesV2Schema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid preferences', details: validation.error.issues });
            return;
        }

        const { preferenceSets } = validation.data;

        // Ensure buyer profile exists
        const profile = await prisma.buyerProfile.upsert({
            where: { userId: req.user!.id },
            create: { userId: req.user!.id },
            update: {},
        });

        // Get existing set IDs
        const existingSets = await prisma.buyerPreferenceSet.findMany({
            where: { buyerProfileId: profile.id },
            select: { id: true },
        });
        const existingIds = new Set(existingSets.map((s) => s.id));

        // Determine which IDs to keep (ones in the payload with an id)
        const incomingIds = new Set(preferenceSets.filter((s) => s.id).map((s) => s.id!));
        const idsToDelete = [...existingIds].filter((id) => !incomingIds.has(id));

        // Run upserts + deletes in a transaction
        await prisma.$transaction(async (tx) => {
            // Delete removed sets
            if (idsToDelete.length > 0) {
                await tx.buyerPreferenceSet.deleteMany({
                    where: { id: { in: idsToDelete } },
                });
            }

            // Upsert each set
            for (const set of preferenceSets) {
                if (set.id && existingIds.has(set.id)) {
                    await tx.buyerPreferenceSet.update({
                        where: { id: set.id },
                        data: {
                            label: set.label,
                            vertical: set.vertical,
                            priority: set.priority,
                            geoCountries: set.geoCountries,
                            geoInclude: set.geoInclude,
                            geoExclude: set.geoExclude,
                            maxBidPerLead: set.maxBidPerLead,
                            dailyBudget: set.dailyBudget,
                            autoBidEnabled: set.autoBidEnabled,
                            autoBidAmount: set.autoBidAmount,
                            minQualityScore: set.minQualityScore,
                            excludedSellerIds: set.excludedSellerIds,
                            preferredSellerIds: set.preferredSellerIds,
                            minSellerReputation: set.minSellerReputation,
                            requireVerifiedSeller: set.requireVerifiedSeller,
                            acceptOffSite: set.acceptOffSite,
                            requireVerified: set.requireVerified,
                            isActive: set.isActive,
                        },
                    });
                } else {
                    await tx.buyerPreferenceSet.create({
                        data: {
                            buyerProfileId: profile.id,
                            label: set.label,
                            vertical: set.vertical,
                            priority: set.priority,
                            geoCountries: set.geoCountries,
                            geoInclude: set.geoInclude,
                            geoExclude: set.geoExclude,
                            maxBidPerLead: set.maxBidPerLead,
                            dailyBudget: set.dailyBudget,
                            autoBidEnabled: set.autoBidEnabled,
                            autoBidAmount: set.autoBidAmount,
                            minQualityScore: set.minQualityScore,
                            excludedSellerIds: set.excludedSellerIds,
                            preferredSellerIds: set.preferredSellerIds,
                            minSellerReputation: set.minSellerReputation,
                            requireVerifiedSeller: set.requireVerifiedSeller,
                            acceptOffSite: set.acceptOffSite,
                            requireVerified: set.requireVerified,
                            isActive: set.isActive,
                        },
                    });
                }
            }

            // Sync flat verticals for backward compatibility
            const uniqueVerticals = [...new Set(preferenceSets.map((s) => s.vertical))];
            await tx.buyerProfile.update({
                where: { id: profile.id },
                data: { verticals: uniqueVerticals },
            });
        });

        res.json({ success: true, message: 'Preference sets updated' });
    } catch (error) {
        const classified = classifyPrismaError(error);
        console.error('[PREFS-V2] Update preference sets error:', {
            userId: req.user?.id,
            setCount: req.body?.preferenceSets?.length,
            code: classified.code,
            message: classified.message,
            raw: error instanceof Error ? error.message : error,
        });
        res.status(classified.status).json({ error: classified.message, code: classified.code });
    }
});

// ============================================
// Auto-Bid Evaluation (Manual Trigger)
// ============================================

router.post('/auto-bid/evaluate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { leadId } = req.body;
        if (!leadId) {
            res.status(400).json({ error: 'leadId is required' });
            return;
        }

        const lead = await prisma.lead.findUnique({ where: { id: leadId } });
        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }

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
            source: lead.source,
            qualityScore: (lead as any).qualityScore ?? null,
            isVerified: lead.isVerified ?? false,
            reservePrice: Number(lead.reservePrice ?? 0),
        };

        const result = await evaluateLeadForAutoBid(leadData);
        res.json(result);
    } catch (error) {
        console.error('Auto-bid evaluate error:', error);
        res.status(500).json({ error: 'Failed to evaluate auto-bid' });
    }
});

export default router;
