import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, optionalAuthMiddleware, apiKeyMiddleware, AuthenticatedRequest, requireSeller } from '../middleware/auth';
import { LeadSubmitSchema, LeadQuerySchema, AskCreateSchema, AskQuerySchema } from '../utils/validation';
import { leadSubmitLimiter, generalLimiter } from '../middleware/rateLimit';
import { creService } from '../services/cre.service';
import { aceService } from '../services/ace.service';
import { marketplaceAsksCache } from '../lib/cache';

const router = Router();

// ============================================
// List Asks (Marketplace Listings)
// ============================================

router.get('/asks', generalLimiter, optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = AskQuerySchema.safeParse(req.query);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid query', details: validation.error.issues });
            return;
        }

        const cacheKey = `asks:${JSON.stringify(validation.data)}`;
        const cached = marketplaceAsksCache.get(cacheKey);
        if (cached) {
            res.json(cached);
            return;
        }

        const { vertical, status, minPrice, maxPrice, state, limit, offset } = validation.data;

        const where: any = {};

        if (vertical) where.vertical = vertical;
        if (status) where.status = status;
        if (minPrice) where.reservePrice = { ...where.reservePrice, gte: minPrice };
        if (maxPrice) where.reservePrice = { ...where.reservePrice, lte: maxPrice };
        if (state) where.geoTargets = { path: ['states'], array_contains: state };

        const [asks, total] = await Promise.all([
            prisma.ask.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: offset,
                include: {
                    seller: {
                        select: {
                            companyName: true,
                            reputationScore: true,
                            isVerified: true,
                        },
                    },
                    _count: { select: { leads: true } },
                },
            }),
            prisma.ask.count({ where }),
        ]);

        const result = {
            asks,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + asks.length < total,
            },
        };
        marketplaceAsksCache.set(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('List asks error:', error);
        res.status(500).json({ error: 'Failed to list asks' });
    }
});

// ============================================
// Create Ask (Seller Listing)
// ============================================

router.post('/asks', authMiddleware, requireSeller, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = AskCreateSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }

        const data = validation.data;

        // Get seller profile
        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { id: req.user!.id } },
        });

        if (!seller) {
            res.status(400).json({
                error: 'A seller profile is required to create ask listings.',
                code: 'SELLER_PROFILE_MISSING',
                resolution: 'Create your seller profile first by navigating to Submit Lead and completing the setup wizard.',
                action: { label: 'Create Seller Profile', href: '/seller/submit' },
            });
            return;
        }

        // Check KYC
        const kycValid = await aceService.isKYCValid(req.user!.walletAddress);
        if (!kycValid) {
            res.status(403).json({
                error: 'KYC verification must be completed before creating listings.',
                code: 'KYC_REQUIRED',
                resolution: 'Complete your identity verification through the ACE compliance flow. KYC results are cached on-chain for 1 year after approval.',
                action: { label: 'Start KYC', href: '/profile/kyc' },
            });
            return;
        }

        const ask = await prisma.ask.create({
            data: {
                sellerId: seller.id,
                vertical: data.vertical,
                geoTargets: data.geoTargets as any,
                reservePrice: data.reservePrice,
                buyNowPrice: data.buyNowPrice,
                parameters: data.parameters as any,
                acceptOffSite: data.acceptOffSite,
                auctionDuration: data.auctionDuration,
                revealWindow: data.revealWindow,
                expiresAt: new Date(Date.now() + data.expiresInDays! * 24 * 60 * 60 * 1000),
            },
        });

        // Log analytics event
        await prisma.analyticsEvent.create({
            data: {
                eventType: 'ask_created',
                entityType: 'ask',
                entityId: ask.id,
                userId: req.user!.id,
                metadata: { vertical: data.vertical },
            },
        });

        res.status(201).json({ ask });
    } catch (error) {
        console.error('Create ask error:', error);
        res.status(500).json({ error: 'Failed to create ask' });
    }
});

// ============================================
// Get Ask Details
// ============================================

router.get('/asks/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const ask = await prisma.ask.findUnique({
            where: { id: req.params.id },
            include: {
                seller: {
                    select: {
                        companyName: true,
                        reputationScore: true,
                        isVerified: true,
                    },
                },
                leads: {
                    where: { status: 'IN_AUCTION' },
                    select: { id: true, status: true, auctionEndAt: true },
                    take: 10,
                },
            },
        });

        if (!ask) {
            res.status(404).json({ error: 'Ask not found' });
            return;
        }

        res.json({ ask });
    } catch (error) {
        console.error('Get ask error:', error);
        res.status(500).json({ error: 'Failed to get ask' });
    }
});

// ============================================
// Submit Lead (Hybrid: Platform/API/Offsite)
// ============================================

router.post('/leads/submit', leadSubmitLimiter, apiKeyMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = LeadSubmitSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid lead data', details: validation.error.issues });
            return;
        }

        const data = validation.data;

        // Get seller profile
        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { id: req.user!.id } },
        });

        if (!seller) {
            res.status(400).json({
                error: 'A seller profile is required to submit leads.',
                code: 'SELLER_PROFILE_MISSING',
                resolution: 'Create your seller profile first by completing the setup wizard. You will need a company name and at least one lead vertical.',
                action: { label: 'Create Seller Profile', href: '/seller/submit' },
            });
            return;
        }

        // Create lead
        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical: data.vertical,
                geo: data.geo as any,
                source: data.source as any,
                parameters: data.parameters as any,
                reservePrice: data.reservePrice,
                tcpaConsentAt: data.tcpaConsentAt ? new Date(data.tcpaConsentAt) : null,
                consentProof: data.consentProof,
                encryptedData: data.encryptedData,
                dataHash: data.dataHash,
                expiresAt: new Date(Date.now() + data.expiresInMinutes * 60 * 1000),
            },
        });

        // Verify lead immediately
        const verification = await creService.verifyLead(lead.id);

        if (!verification.isValid) {
            // Mark lead as invalid but keep it
            await prisma.lead.update({
                where: { id: lead.id },
                data: { status: 'CANCELLED' },
            });

            res.status(400).json({
                error: 'Lead verification failed',
                reason: verification.reason,
                leadId: lead.id,
            });
            return;
        }

        // Find matching asks for this lead
        const matchingAsks = await prisma.ask.findMany({
            where: {
                vertical: data.vertical,
                status: 'ACTIVE',
                reservePrice: data.reservePrice ? { lte: data.reservePrice } : undefined,
            },
            take: 10,
        });

        // Start auction if we have matching asks
        if (matchingAsks.length > 0) {
            const bestMatch = matchingAsks[0];

            await prisma.lead.update({
                where: { id: lead.id },
                data: {
                    askId: bestMatch.id,
                    status: 'IN_AUCTION',
                    auctionStartAt: new Date(),
                    auctionEndAt: new Date(Date.now() + bestMatch.auctionDuration * 1000),
                },
            });

            // Create auction room
            await prisma.auctionRoom.create({
                data: {
                    leadId: lead.id,
                    roomId: `auction_${lead.id}`,
                    phase: 'BIDDING',
                    biddingEndsAt: new Date(Date.now() + bestMatch.auctionDuration * 1000),
                    revealEndsAt: new Date(Date.now() + (bestMatch.auctionDuration + bestMatch.revealWindow) * 1000),
                },
            });
        }

        // Log analytics
        await prisma.analyticsEvent.create({
            data: {
                eventType: 'lead_submitted',
                entityType: 'lead',
                entityId: lead.id,
                userId: req.user!.id,
                metadata: { vertical: data.vertical, source: data.source },
            },
        });

        res.status(201).json({
            lead: {
                id: lead.id,
                vertical: lead.vertical,
                status: lead.status,
                isVerified: verification.isValid,
                matchingAsks: matchingAsks.length,
                auctionEndAt: lead.auctionEndAt,
            },
        });
    } catch (error) {
        console.error('Lead submit error:', error);
        res.status(500).json({ error: 'Failed to submit lead' });
    }
});

// ============================================
// List Leads
// ============================================

router.get('/leads', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = LeadQuerySchema.safeParse(req.query);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid query', details: validation.error.issues });
            return;
        }

        const { vertical, status, state, limit, offset, sortBy, sortOrder } = validation.data;

        // Build query based on user role
        const where: any = {};

        if (req.user) {
            // Authenticated: role-based filtering
            if (req.user.role === 'SELLER') {
                const seller = await prisma.sellerProfile.findFirst({
                    where: { user: { id: req.user.id } },
                });
                if (seller) where.sellerId = seller.id;
            }

            if (req.user.role === 'BUYER') {
                where.status = { in: ['IN_AUCTION', 'REVEAL_PHASE'] };

                const buyer = await prisma.buyerProfile.findFirst({
                    where: { user: { id: req.user.id } },
                });

                if (buyer) {
                    if (buyer.verticals.length > 0) {
                        where.vertical = { in: buyer.verticals };
                    }
                    if (!buyer.acceptOffSite) {
                        where.source = { not: 'OFFSITE' };
                    }
                }
            }
        } else {
            // Public (unauthenticated): show all active leads
            where.status = { in: ['IN_AUCTION', 'REVEAL_PHASE'] };
        }

        // Apply user-supplied query filters
        if (vertical) where.vertical = vertical;
        if (status) where.status = status;
        if (state) where.geo = { path: ['state'], equals: state };

        const [leads, total] = await Promise.all([
            prisma.lead.findMany({
                where,
                orderBy: { [sortBy]: sortOrder },
                take: limit,
                skip: offset,
                select: {
                    id: true,
                    vertical: true,
                    geo: true,
                    source: true,
                    status: true,
                    reservePrice: true,
                    isVerified: true,
                    auctionEndAt: true,
                    createdAt: true,
                    _count: { select: { bids: true } },
                },
            }),
            prisma.lead.count({ where }),
        ]);

        res.json({
            leads,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + leads.length < total,
            },
        });
    } catch (error) {
        console.error('List leads error:', error);
        res.status(500).json({ error: 'Failed to list leads' });
    }
});

// ============================================
// Get Lead Details
// ============================================

router.get('/leads/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const lead = await prisma.lead.findUnique({
            where: { id: req.params.id },
            include: {
                seller: {
                    select: {
                        companyName: true,
                        reputationScore: true,
                        isVerified: true,
                    },
                },
                auctionRoom: true,
                _count: { select: { bids: true } },
            },
        });

        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }

        // Get quality score
        const qualityScore = await creService.getQualityScore(lead.id);

        res.json({
            lead: {
                ...lead,
                qualityScore,
                encryptedData: undefined, // Don't expose
                dataHash: undefined,
            },
        });
    } catch (error) {
        console.error('Get lead error:', error);
        res.status(500).json({ error: 'Failed to get lead' });
    }
});

export default router;
