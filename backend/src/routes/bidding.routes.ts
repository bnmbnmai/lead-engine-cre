import { Router, Response } from 'express';
import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthenticatedRequest, requireBuyer } from '../middleware/auth';
import { BidCommitSchema, BidRevealSchema, BidDirectSchema, BuyerPreferencesSchema } from '../utils/validation';
import { rtbBiddingLimiter } from '../middleware/rateLimit';
import { aceService } from '../services/ace.service';

const router = Router();

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

            const bid = await prisma.bid.upsert({
                where: {
                    leadId_buyerId: { leadId, buyerId: req.user!.id },
                },
                create: {
                    leadId,
                    buyerId: req.user!.id,
                    amount,
                    status: 'REVEALED',
                    revealedAt: new Date(),
                },
                update: {
                    amount,
                    status: 'REVEALED',
                    revealedAt: new Date(),
                },
            });

            // Update auction room
            if (lead.auctionRoom) {
                const currentHighest = lead.auctionRoom.highestBid ? Number(lead.auctionRoom.highestBid) : 0;
                if (amount > currentHighest) {
                    await prisma.auctionRoom.update({
                        where: { id: lead.auctionRoom.id },
                        data: {
                            highestBid: amount,
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

            res.status(201).json({
                bid: {
                    id: bid.id,
                    leadId: bid.leadId,
                    amount: Number(bid.amount),
                    status: bid.status,
                    createdAt: bid.createdAt,
                },
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
        console.error('Update preferences error:', error);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

export default router;
