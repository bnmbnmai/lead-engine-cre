import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authMiddleware, optionalAuthMiddleware, apiKeyMiddleware, AuthenticatedRequest, requireSeller, requireBuyer } from '../middleware/auth';
import { LeadSubmitSchema, LeadQuerySchema, AskCreateSchema, AskQuerySchema } from '../utils/validation';
import { leadSubmitLimiter, generalLimiter } from '../middleware/rateLimit';
import { creService } from '../services/cre.service';
import { aceService } from '../services/ace.service';
import { x402Service } from '../services/x402.service';
import { marketplaceAsksCache } from '../lib/cache';
import { fireConversionEvents, ConversionPayload } from '../services/conversion-tracking.service';
import { redactLeadForPreview } from '../services/piiProtection';

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

        const { vertical, status, minPrice, maxPrice, state, country, search, limit, offset } = validation.data;

        const where: any = {};

        if (vertical) where.vertical = vertical;
        if (status) where.status = status;
        if (minPrice) where.reservePrice = { ...where.reservePrice, gte: minPrice };
        if (maxPrice) where.reservePrice = { ...where.reservePrice, lte: maxPrice };
        if (state) where.geoTargets = { path: ['states'], array_contains: state };
        if (country) where.geoTargets = { ...where.geoTargets, path: ['country'], equals: country };
        if (search) {
            where.OR = [
                { id: { startsWith: search, mode: 'insensitive' } },
                { vertical: { contains: search, mode: 'insensitive' } },
            ];
        }

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

router.get('/asks/:id', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
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
        let seller = await prisma.sellerProfile.findFirst({
            where: { user: { id: req.user!.id } },
        });

        // Auto-create basic seller profile on first lead submit
        if (!seller) {
            seller = await prisma.sellerProfile.create({
                data: {
                    userId: req.user!.id,
                    companyName: req.user!.walletAddress
                        ? req.user!.walletAddress.slice(0, 10) + '…'
                        : 'New Seller',
                    verticals: [data.vertical],
                },
            });
            console.log(`[MARKETPLACE] Auto-created seller profile ${seller.id} for user ${req.user!.id}`);
        }

        // Create lead
        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical: data.vertical,
                geo: data.geo as any,
                source: data.source as any,
                parameters: data.parameters as any,
                adSource: data.adSource as any,
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
// Public Lead Submit (Hosted Forms / Embeds / Off-site)
// No auth required — sellerId comes from the hosted URL slug.
// ============================================

router.post('/leads/public/submit', leadSubmitLimiter, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { sellerId, vertical, parameters, geo, source, tcpaConsentAt } = req.body;

        // Validate required fields
        if (!sellerId || typeof sellerId !== 'string') {
            res.status(400).json({ error: 'sellerId is required' });
            return;
        }
        if (!vertical || typeof vertical !== 'string') {
            res.status(400).json({ error: 'vertical is required' });
            return;
        }
        if (!parameters || typeof parameters !== 'object') {
            res.status(400).json({ error: 'parameters (form data) is required' });
            return;
        }

        // Look up the seller by user ID (sellerId from URL is the User.id)
        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { id: sellerId } },
        });

        if (!seller) {
            res.status(404).json({ error: 'Seller not found' });
            return;
        }

        // Validate vertical exists
        const verticalRecord = await prisma.vertical.findUnique({
            where: { slug: vertical },
        });

        if (!verticalRecord) {
            res.status(404).json({ error: 'Vertical not found' });
            return;
        }

        // Build geo object from form parameters or explicit geo field
        const leadGeo = geo || {
            country: parameters.country || 'US',
            state: parameters.state || parameters.region || undefined,
            city: parameters.city || undefined,
            zip: parameters.zip || parameters.zipCode || parameters.zip_code || undefined,
        };

        // Create the lead attributed to this seller
        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical,
                geo: leadGeo as any,
                source: source || 'PLATFORM',
                parameters: parameters as any,
                tcpaConsentAt: tcpaConsentAt ? new Date(tcpaConsentAt) : new Date(), // Default consent = now
                expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min default
            },
        });

        console.log(`[MARKETPLACE] Public lead ${lead.id} submitted for seller ${seller.id} (${seller.companyName}) — vertical: ${vertical}`);

        // Verify lead via CRE
        const verification = await creService.verifyLead(lead.id);

        if (!verification.isValid) {
            await prisma.lead.update({
                where: { id: lead.id },
                data: { status: 'CANCELLED' },
            });
            // Still return 201 to the form submitter — they don't need to know about internal verification
            console.warn(`[MARKETPLACE] Public lead ${lead.id} failed CRE verification: ${verification.reason}`);
            res.status(201).json({
                lead: { id: lead.id, vertical: lead.vertical, status: 'CANCELLED' },
            });
            return;
        }

        // Find matching asks for this lead
        let matchingAsks = await prisma.ask.findMany({
            where: {
                vertical,
                status: 'ACTIVE',
            },
            orderBy: { reservePrice: 'desc' },
            take: 10,
        });

        // If seller has no active ask for this vertical, auto-create one with defaults
        if (matchingAsks.length === 0) {
            const autoAsk = await prisma.ask.create({
                data: {
                    sellerId: seller.id,
                    vertical,
                    geoTargets: leadGeo.country ? [leadGeo.country] : ['US'],
                    reservePrice: 5.0,
                    auctionDuration: 300, // 5-minute auction
                    revealWindow: 120,
                    status: 'ACTIVE',
                },
            });
            console.log(`[MARKETPLACE] Auto-created ask ${autoAsk.id} for seller ${seller.id} — vertical: ${vertical}, reserve: $5`);
            matchingAsks = [autoAsk];
        }

        // Start auction if we have matching asks
        if (matchingAsks.length > 0) {
            const bestMatch = matchingAsks[0];

            await prisma.lead.update({
                where: { id: lead.id },
                data: {
                    askId: bestMatch.id,
                    status: 'IN_AUCTION',
                    reservePrice: bestMatch.reservePrice,
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

            console.log(`[MARKETPLACE] Lead ${lead.id} matched ask ${bestMatch.id} — auction started (${bestMatch.auctionDuration}s)`);
        } else {
            console.log(`[MARKETPLACE] Lead ${lead.id} has no matching asks — stays PENDING_AUCTION`);
        }

        // Log analytics
        await prisma.analyticsEvent.create({
            data: {
                eventType: 'lead_submitted',
                entityType: 'lead',
                entityId: lead.id,
                userId: sellerId,
                metadata: { vertical, source: source || 'PLATFORM', origin: 'hosted_form' },
            },
        });

        // Emit real-time events
        const io = req.app.get('io');
        if (io) {
            io.emit('lead:new', {
                leadId: lead.id,
                vertical,
                sellerId: seller.id,
                status: matchingAsks.length > 0 ? 'IN_AUCTION' : 'PENDING_AUCTION',
                timestamp: new Date().toISOString(),
            });
        }

        // Reload lead with auction data for the response
        const finalLead = await prisma.lead.findUnique({
            where: { id: lead.id },
            select: { id: true, vertical: true, status: true, auctionEndAt: true, isVerified: true },
        });

        res.status(201).json({
            lead: finalLead,
            matchingAsks: matchingAsks.length,
        });
    } catch (error) {
        console.error('Public lead submit error:', error);
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

        const { vertical, status, state, country, search, sellerId, sellerName, minReputation, limit, offset, sortBy, sortOrder } = validation.data;

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

        // Buy It Now shorthand: override status to UNSOLD + only unexpired
        const buyNow = req.query.buyNow === 'true';
        if (buyNow) {
            where.status = 'UNSOLD';
            where.expiresAt = { gt: new Date() };
        }

        // Apply user-supplied query filters
        if (vertical) where.vertical = vertical;
        if (status && !buyNow) where.status = status;  // buyNow overrides status
        if (state) where.geo = { path: ['state'], equals: state };
        if (country) where.geo = { ...where.geo, path: ['country'], equals: country };
        if (search) {
            where.OR = [
                { id: { startsWith: search, mode: 'insensitive' } },
                { vertical: { contains: search, mode: 'insensitive' } },
                { geo: { path: ['state'], string_contains: search } },
                { geo: { path: ['city'], string_contains: search } },
                { seller: { companyName: { contains: search, mode: 'insensitive' } } },
            ];
        }

        // Seller-specific filters
        if (sellerId) where.sellerId = sellerId;
        if (sellerName) {
            where.seller = { ...where.seller, companyName: { contains: sellerName, mode: 'insensitive' } };
        }
        if (minReputation !== undefined) {
            where.seller = { ...where.seller, reputationScore: { gte: minReputation } };
        }

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
                    buyNowPrice: true,
                    isVerified: true,
                    auctionEndAt: true,
                    expiresAt: true,
                    createdAt: true,
                    _count: { select: { bids: true } },
                    seller: {
                        select: {
                            id: true,
                            companyName: true,
                            reputationScore: true,
                            isVerified: true,
                        },
                    },
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

router.get('/leads/:id', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const lead = await prisma.lead.findUnique({
            where: { id: req.params.id },
            include: {
                seller: {
                    select: {
                        id: true,
                        companyName: true,
                        reputationScore: true,
                        isVerified: true,
                        userId: true,
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

        // Check if requesting user is the lead's seller (owns the PII)
        const isOwner = req.user?.id && lead.seller?.userId === req.user.id;

        if (isOwner) {
            // Seller sees full lead data (they own the PII)
            res.json({
                lead: {
                    ...lead,
                    qualityScore,
                    encryptedData: undefined,
                    dataHash: undefined,
                },
            });
        } else {
            // Everyone else gets PII-redacted preview
            const preview = redactLeadForPreview(lead as any);
            res.json({
                lead: {
                    id: lead.id,
                    ...preview,
                    seller: lead.seller ? {
                        companyName: lead.seller.companyName,
                        reputationScore: lead.seller.reputationScore,
                        isVerified: lead.seller.isVerified,
                    } : undefined,
                    auctionRoom: lead.auctionRoom,
                    auctionStartAt: lead.auctionStartAt,
                    auctionEndAt: lead.auctionEndAt,
                    buyNowPrice: lead.buyNowPrice,
                    qualityScore,
                    _count: (lead as any)._count,
                },
            });
        }
    } catch (error) {
        console.error('Get lead error:', error);
        res.status(500).json({ error: 'Failed to get lead' });
    }
});

// ============================================
// Lead Preview (Redacted for Buyers)
// ============================================

router.get('/leads/:id/preview', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const lead = await prisma.lead.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                vertical: true,
                geo: true,
                source: true,
                status: true,
                isVerified: true,
                createdAt: true,
                reservePrice: true,
                dataHash: true,
                parameters: true,
                // Never select: encryptedData, sellerId, etc.
            },
        });

        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }

        const preview = redactLeadForPreview(lead as any);
        res.json({ preview });
    } catch (error) {
        console.error('Lead preview error:', error);
        res.status(500).json({ error: 'Failed to get lead preview' });
    }
});

// ============================================
// Buy It Now (Purchase UNSOLD Lead)
// ============================================

router.post('/leads/:id/buy-now', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Use serializable isolation to prevent double-buy race conditions
        const result = await prisma.$transaction(async (tx) => {
            const lead = await tx.lead.findUnique({
                where: { id: req.params.id },
                include: {
                    seller: {
                        select: { id: true, userId: true, companyName: true },
                    },
                },
            });

            if (!lead) throw { status: 404, message: 'Lead not found' };
            if (lead.status !== 'UNSOLD') throw { status: 409, message: 'Lead is no longer available for Buy It Now' };
            if (!lead.buyNowPrice) throw { status: 400, message: 'Lead does not have a Buy It Now price' };
            if (lead.expiresAt && lead.expiresAt < new Date()) throw { status: 410, message: 'Buy It Now listing has expired' };

            const buyNowAmount = Number(lead.buyNowPrice);
            const platformFee = buyNowAmount * 0.025; // 2.5%

            // Mark as SOLD
            const updatedLead = await tx.lead.update({
                where: { id: lead.id },
                data: {
                    status: 'SOLD',
                    winningBid: lead.buyNowPrice,
                    soldAt: new Date(),
                },
            });

            // Create transaction record
            const transaction = await tx.transaction.create({
                data: {
                    leadId: lead.id,
                    buyerId: req.user!.id,
                    amount: lead.buyNowPrice,
                    platformFee,
                    status: 'PENDING',
                },
            });

            // Log analytics
            await tx.analyticsEvent.create({
                data: {
                    eventType: 'lead_buy_now_purchased',
                    entityType: 'lead',
                    entityId: lead.id,
                    userId: req.user!.id,
                    metadata: {
                        buyNowPrice: buyNowAmount,
                        platformFee,
                        sellerId: lead.seller.id,
                        vertical: lead.vertical,
                    },
                },
            });

            return { lead: updatedLead, transaction, seller: lead.seller };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });

        // After transaction commits — initiate escrow (outside tx to avoid long locks)
        let escrow = null;
        try {
            const sellerUser = await prisma.user.findUnique({ where: { id: result.seller.userId } });
            if (sellerUser?.walletAddress && req.user?.walletAddress) {
                escrow = await x402Service.createPayment(
                    sellerUser.walletAddress,
                    req.user.walletAddress,
                    Number(result.transaction.amount),
                    parseInt(result.lead.nftTokenId || '0'),
                    result.transaction.id,
                );
            }
        } catch (escrowErr) {
            console.error('Buy It Now escrow error (non-fatal):', escrowErr);
        }

        // Emit real-time events
        const io = req.app.get('io');
        if (io) {
            io.emit('lead:buy-now-sold', {
                leadId: result.lead.id,
                buyerId: req.user!.id,
                amount: Number(result.transaction.amount),
                vertical: result.lead.vertical,
                timestamp: new Date().toISOString(),
            });

            io.emit('analytics:update', {
                type: 'buy-now',
                leadId: result.lead.id,
                buyerId: req.user!.id,
                amount: Number(result.transaction.amount),
                vertical: result.lead.vertical,
                timestamp: new Date().toISOString(),
            });
        }

        // Fire seller conversion tracking (pixel + webhook) — non-blocking
        const geo = result.lead.geo as any;
        const convPayload: ConversionPayload = {
            event: 'lead_sold',
            lead_id: result.lead.id,
            sale_amount: Number(result.transaction.amount),
            platform_fee: Number(result.transaction.platformFee),
            vertical: result.lead.vertical,
            geo: geo ? `${geo.country || 'US'}-${geo.state || ''}` : 'US',
            quality_score: (result.lead as any).qualityScore || 0,
            transaction_id: result.transaction.id,
            sold_at: new Date().toISOString(),
        };
        fireConversionEvents(result.seller.id, convPayload).catch(console.error);

        res.json({
            lead: {
                id: result.lead.id,
                vertical: result.lead.vertical,
                status: result.lead.status,
                buyNowPrice: Number(result.lead.buyNowPrice),
            },
            transaction: {
                id: result.transaction.id,
                amount: Number(result.transaction.amount),
                platformFee: Number(result.transaction.platformFee),
                status: result.transaction.status,
            },
            escrow: escrow ? {
                escrowId: escrow.escrowId,
                txHash: escrow.txHash,
            } : null,
        });
    } catch (error: any) {
        if (error.status) {
            res.status(error.status).json({ error: error.message });
            return;
        }
        console.error('Buy It Now error:', error);
        res.status(500).json({ error: 'Failed to process Buy It Now purchase' });
    }
});

// ============================================
// Requalify Lead (Stub — Twilio SMS Preview)
// ============================================

router.post('/leads/:id/requalify', authMiddleware, requireSeller, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const lead = await prisma.lead.findUnique({
            where: { id: req.params.id },
            include: { seller: true },
        });

        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }

        if (lead.status !== 'UNSOLD') {
            res.status(400).json({ error: 'Only UNSOLD leads can be requalified' });
            return;
        }

        // Verify the requesting seller owns this lead
        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { id: req.user!.id } },
        });

        if (!seller || seller.id !== lead.sellerId) {
            res.status(403).json({ error: 'You can only requalify your own leads' });
            return;
        }

        // Stub: return a mock Twilio SMS preview
        res.json({
            preview: `SMS to lead: Hi, are you still looking for ${lead.vertical.replace(/[_.]/g, ' ')} service? Reply YES to reconnect with a verified provider.`,
            estimatedDelivery: '2-5 seconds',
            status: 'preview',
            note: 'Twilio integration coming soon. This is a preview of the SMS that would be sent.',
        });
    } catch (error) {
        console.error('Requalify error:', error);
        res.status(500).json({ error: 'Failed to requalify lead' });
    }
});

// ============================================
// Browse Sellers (public directory)
// ============================================

router.get('/sellers', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const search = (req.query.search as string || '').trim();
        const sortBy = (req.query.sortBy as string) || 'reputationScore';
        const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const offset = parseInt(req.query.offset as string) || 0;

        const where: any = {};
        if (search && search.length >= 2) {
            where.companyName = { contains: search, mode: 'insensitive' };
        }

        const orderBy: any = {};
        if (['reputationScore', 'totalLeadsSold', 'createdAt'].includes(sortBy)) {
            orderBy[sortBy] = sortOrder;
        } else {
            orderBy.reputationScore = 'desc';
        }

        const [sellers, total] = await Promise.all([
            prisma.sellerProfile.findMany({
                where,
                orderBy,
                take: limit,
                skip: offset,
                select: {
                    id: true,
                    companyName: true,
                    verticals: true,
                    reputationScore: true,
                    totalLeadsSold: true,
                    isVerified: true,
                    kycStatus: true,
                    createdAt: true,
                    _count: {
                        select: { leads: true, asks: true },
                    },
                },
            }),
            prisma.sellerProfile.count({ where }),
        ]);

        // Compute sold count + success rate for each seller
        const enriched = await Promise.all(
            sellers.map(async (s) => {
                const [soldCount, totalCount] = await Promise.all([
                    prisma.lead.count({ where: { sellerId: s.id, status: 'SOLD' } }),
                    prisma.lead.count({ where: { sellerId: s.id } }),
                ]);
                return {
                    ...s,
                    leadsSold: soldCount,
                    totalLeads: totalCount,
                    successRate: totalCount > 0 ? Math.round((soldCount / totalCount) * 100) : 0,
                };
            })
        );

        res.json({
            sellers: enriched,
            pagination: { total, limit, offset, hasMore: offset + sellers.length < total },
        });
    } catch (error) {
        console.error('List sellers error:', error);
        res.status(500).json({ error: 'Failed to list sellers' });
    }
});

// ============================================
// Seller Search (autocomplete for buyer filters)
// ============================================


router.get('/sellers/search', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const query = (req.query.q as string || '').trim();
        if (!query || query.length < 2) {
            res.json({ sellers: [] });
            return;
        }

        const sellers = await prisma.sellerProfile.findMany({
            where: {
                companyName: { contains: query, mode: 'insensitive' },
            },
            select: {
                id: true,
                companyName: true,
                reputationScore: true,
                isVerified: true,
                totalLeadsSold: true,
            },
            orderBy: { reputationScore: 'desc' },
            take: 20,
        });

        res.json({ sellers });
    } catch (error) {
        console.error('Seller search error:', error);
        res.status(500).json({ error: 'Failed to search sellers' });
    }
});

// ============================================
// Seller Conversion Settings
// ============================================

router.get('/seller/conversion-settings', authMiddleware, requireSeller, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const profile = await prisma.sellerProfile.findUnique({
            where: { userId: req.user!.id },
            select: { conversionPixelUrl: true, conversionWebhookUrl: true },
        });
        if (!profile) {
            res.status(404).json({ error: 'Seller profile not found' });
            return;
        }
        res.json(profile);
    } catch (error) {
        console.error('Get conversion settings error:', error);
        res.status(500).json({ error: 'Failed to fetch conversion settings' });
    }
});

router.put('/seller/conversion-settings', authMiddleware, requireSeller, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { conversionPixelUrl, conversionWebhookUrl } = req.body;

        // Validate URLs if provided
        for (const [key, val] of Object.entries({ conversionPixelUrl, conversionWebhookUrl })) {
            if (val !== undefined && val !== null && val !== '') {
                try { new URL(val as string); } catch {
                    res.status(400).json({ error: `Invalid URL for ${key}` });
                    return;
                }
            }
        }

        const profile = await prisma.sellerProfile.update({
            where: { userId: req.user!.id },
            data: {
                conversionPixelUrl: conversionPixelUrl || null,
                conversionWebhookUrl: conversionWebhookUrl || null,
            },
            select: { conversionPixelUrl: true, conversionWebhookUrl: true },
        });
        res.json(profile);
    } catch (error) {
        console.error('Update conversion settings error:', error);
        res.status(500).json({ error: 'Failed to update conversion settings' });
    }
});

export default router;
