import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authMiddleware, optionalAuthMiddleware, apiKeyMiddleware, AuthenticatedRequest, requireSeller, requireBuyer } from '../middleware/auth';
import { LeadSubmitSchema, LeadQuerySchema, AskCreateSchema, AskQuerySchema } from '../utils/validation';
import { leadSubmitLimiter, generalLimiter } from '../middleware/rateLimit';
import { creService } from '../services/cre.service';
import { aceService } from '../services/ace.service';
import { x402Service } from '../services/x402.service';
import { nftService } from '../services/nft.service';
import { marketplaceAsksCache } from '../lib/cache';
import { fireConversionEvents, ConversionPayload } from '../services/conversion-tracking.service';
import { redactLeadForPreview } from '../services/piiProtection';
import { privacyService } from '../services/privacy.service';
import { calculateFees } from '../lib/fees';
import { evaluateFieldFilters, FieldFilterRule, FilterOperator } from '../services/field-filter.service';

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
                        userId: true,
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
// Update Ask (Seller Only)
// ============================================

router.put('/asks/:id', authMiddleware, requireSeller, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const seller = await prisma.sellerProfile.findFirst({ where: { user: { id: req.user!.id } } });
        if (!seller) { res.status(403).json({ error: 'Seller profile not found' }); return; }

        const ask = await prisma.ask.findUnique({ where: { id: req.params.id } });
        if (!ask) { res.status(404).json({ error: 'Ask not found' }); return; }
        if (ask.sellerId !== seller.id) { res.status(403).json({ error: 'Not your ask' }); return; }

        const { reservePrice, buyNowPrice, acceptOffSite, geoTargets, status, parameters } = req.body;
        const updateData: any = {};
        if (reservePrice !== undefined) updateData.reservePrice = Number(reservePrice);
        if (buyNowPrice !== undefined) updateData.buyNowPrice = buyNowPrice === null ? null : Number(buyNowPrice);
        if (acceptOffSite !== undefined) updateData.acceptOffSite = Boolean(acceptOffSite);
        if (geoTargets !== undefined) updateData.geoTargets = geoTargets;
        if (status !== undefined && ['ACTIVE', 'PAUSED'].includes(status)) updateData.status = status;
        if (parameters !== undefined) updateData.parameters = parameters;

        const updated = await prisma.ask.update({ where: { id: req.params.id }, data: updateData });
        res.json({ ask: updated });
    } catch (error) {
        console.error('Update ask error:', error);
        res.status(500).json({ error: 'Failed to update ask' });
    }
});

// ============================================
// Delete Ask (Seller Only)
// ============================================

router.delete('/asks/:id', authMiddleware, requireSeller, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const seller = await prisma.sellerProfile.findFirst({ where: { user: { id: req.user!.id } } });
        if (!seller) { res.status(403).json({ error: 'Seller profile not found' }); return; }

        const ask = await prisma.ask.findUnique({
            where: { id: req.params.id },
            include: { leads: { where: { status: 'IN_AUCTION' }, select: { id: true }, take: 1 } },
        });
        if (!ask) { res.status(404).json({ error: 'Ask not found' }); return; }
        if (ask.sellerId !== seller.id) { res.status(403).json({ error: 'Not your ask' }); return; }
        if (ask.leads.length > 0) { res.status(409).json({ error: 'Cannot delete ask with active auctions' }); return; }

        await prisma.ask.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) {
        console.error('Delete ask error:', error);
        res.status(500).json({ error: 'Failed to delete ask' });
    }
});

// ============================================
// Public Template Config (for hosted forms)
// No auth — used by HostedForm to fetch seller-specific colors/branding.
// ============================================

router.get('/asks/public/template-config', generalLimiter, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { vertical, sellerId } = req.query as { vertical?: string; sellerId?: string };
        if (!vertical || !sellerId) {
            res.status(400).json({ error: 'vertical and sellerId query params are required' });
            return;
        }

        // Find the seller profile by user id
        const seller = await prisma.sellerProfile.findFirst({ where: { user: { id: sellerId } } });
        if (!seller) {
            res.json({ templateConfig: null });
            return;
        }

        // Find the seller's active ask for this vertical
        const ask = await prisma.ask.findFirst({
            where: { sellerId: seller.id, vertical, status: 'ACTIVE' },
            orderBy: { createdAt: 'desc' },
            select: { parameters: true },
        });

        const templateConfig = (ask?.parameters as any)?.templateConfig || null;
        res.json({ templateConfig });
    } catch (error) {
        console.error('Public template config error:', error);
        res.status(500).json({ error: 'Failed to fetch template config' });
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

        // ── Server-side PII defense ──────────────────────────────────
        // Strip PII fields from parameters so they never sit unencrypted.
        // If the client already provided encryptedData, we just strip params.
        // If not, we encrypt server-side as a fallback.
        const PII_KEYS = new Set([
            'firstName', 'lastName', 'name', 'fullName',
            'email', 'emailAddress', 'phone', 'phoneNumber', 'mobile',
            'address', 'streetAddress', 'street', 'apartment', 'unit',
            'ssn', 'socialSecurity', 'taxId',
            'dob', 'dateOfBirth', 'birthDate',
            'ip', 'ipAddress', 'userAgent',
        ]);

        const piiData: Record<string, any> = {};
        const safeParams: Record<string, any> = {};
        const rawParams = (data.parameters || {}) as Record<string, any>;

        for (const [key, value] of Object.entries(rawParams)) {
            if (PII_KEYS.has(key)) {
                piiData[key] = value;
            } else {
                safeParams[key] = value;
            }
        }

        // Server-side encryption fallback if frontend didn't encrypt
        let encryptedData: any = data.encryptedData;
        let dataHash = data.dataHash || '';
        if (!encryptedData && Object.keys(piiData).length > 0) {
            const piiResult = privacyService.encryptLeadPII(piiData);
            encryptedData = JSON.stringify(piiResult.encrypted);
            dataHash = piiResult.dataHash;
        }

        // Create lead
        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical: data.vertical,
                geo: data.geo as any,
                source: data.source as any,
                parameters: safeParams as any,    // PII stripped
                adSource: data.adSource as any,
                reservePrice: data.reservePrice,
                tcpaConsentAt: data.tcpaConsentAt ? new Date(data.tcpaConsentAt) : null,
                consentProof: data.consentProof,
                encryptedData: encryptedData as any,
                dataHash,
                expiresAt: new Date(Date.now() + data.expiresInMinutes * 60 * 1000),
            },
        });

        // Stage 1: CRE Pre-Auction Gate (data integrity, TCPA, geo)
        // verifyLead computes a numeric pre-score and stores it in the DB
        const verification = await creService.verifyLead(lead.id);

        if (!verification.isValid) {
            // Delete the rejected lead — don't leave CANCELLED orphans
            await prisma.lead.delete({ where: { id: lead.id } }).catch(() => { });

            res.status(400).json({
                error: `Lead rejected: ${verification.reason || 'failed quality check (CRE)'}`,
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
                    revealEndsAt: new Date(Date.now() + bestMatch.auctionDuration * 1000), // no separate reveal
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
        // Emit real-time event for new marketplace lead
        const io = req.app.get('io');
        if (io) {
            io.emit('marketplace:lead:new', {
                lead: {
                    id: lead.id,
                    vertical: lead.vertical,
                    status: lead.status,
                    reservePrice: data.reservePrice,
                    geo: data.geo,
                    isVerified: verification.isValid,
                    sellerId: seller.id,
                    auctionStartAt: lead.auctionStartAt?.toISOString(),
                    auctionEndAt: lead.auctionEndAt?.toISOString(),
                    parameters: safeParams,
                    qualityScore: verification.score ?? null,
                    _count: { bids: 0 },
                },
            });
        }

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

        // ── PII Extraction & Encryption ──────────────────────────────
        // Separate PII fields from safe parameters so raw PII never
        // sits unencrypted in the database.
        const PII_KEYS = new Set([
            'firstName', 'lastName', 'name', 'fullName',
            'email', 'emailAddress', 'phone', 'phoneNumber', 'mobile',
            'address', 'streetAddress', 'street', 'apartment', 'unit',
            'ssn', 'socialSecurity', 'taxId',
            'dob', 'dateOfBirth', 'birthDate',
            'ip', 'ipAddress', 'userAgent',
        ]);

        const piiData: Record<string, any> = {};
        const safeParameters: Record<string, any> = {};

        for (const [key, value] of Object.entries(parameters)) {
            if (PII_KEYS.has(key)) {
                piiData[key] = value;
            } else {
                safeParameters[key] = value;
            }
        }

        // Encrypt PII via AES-256-GCM
        let encryptedData: any = null;
        let dataHash: string = '';
        if (Object.keys(piiData).length > 0) {
            const piiResult = privacyService.encryptLeadPII(piiData);
            encryptedData = JSON.stringify(piiResult.encrypted);
            dataHash = piiResult.dataHash;
        }

        // Create the lead attributed to this seller
        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical,
                geo: leadGeo as any,
                source: source || 'PLATFORM',
                parameters: safeParameters as any,   // non-PII only
                encryptedData: encryptedData as any,  // AES-256-GCM encrypted PII
                dataHash,                             // keccak256 of plaintext PII
                tcpaConsentAt: tcpaConsentAt ? new Date(tcpaConsentAt) : new Date(), // Default consent = now
                expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min default
            },
        });

        console.log(`[MARKETPLACE] Public lead ${lead.id} submitted for seller ${seller.id} (${seller.companyName}) — vertical: ${vertical}`);

        // Stage 1: CRE Pre-Auction Gate (data integrity, TCPA, geo)
        // verifyLead computes a numeric pre-score and stores it in the DB
        const verification = await creService.verifyLead(lead.id);

        if (!verification.isValid) {
            // Delete the rejected lead — don't leave CANCELLED orphans
            await prisma.lead.delete({ where: { id: lead.id } }).catch(() => { });
            console.warn(`[MARKETPLACE] Public lead ${lead.id} rejected by CRE: ${verification.reason}`);
            res.status(400).json({
                error: `Lead rejected: ${verification.reason || 'failed quality check (CRE)'}`,
            });
            return;
        }

        // Pre-score is already stored in the DB by verifyLead above.

        // Find matching asks for this lead
        let matchingAsks = await prisma.ask.findMany({
            where: {
                vertical,
                status: 'ACTIVE',
            },
            orderBy: { reservePrice: 'desc' },
            take: 10,
        });

        // If seller has no active ask for this vertical, auto-create one
        // Use seller's own ask reserve price if they have one, otherwise default $5
        if (matchingAsks.length === 0) {
            // Check if seller has their own ask for this vertical with a custom reserve
            const sellerAsk = await prisma.ask.findFirst({
                where: { sellerId: seller.id, vertical },
                orderBy: { createdAt: 'desc' },
            });
            const sellerReserve = sellerAsk?.reservePrice ? Number(sellerAsk.reservePrice) : 5.0;

            const autoAsk = await prisma.ask.create({
                data: {
                    sellerId: seller.id,
                    vertical,
                    geoTargets: leadGeo.country ? [leadGeo.country] : ['US'],
                    reservePrice: sellerReserve,
                    auctionDuration: sellerAsk?.auctionDuration ?? 60,
                    status: 'ACTIVE',
                },
            });
            console.log(`[MARKETPLACE] Auto-created ask ${autoAsk.id} for seller ${seller.id} — vertical: ${vertical}, reserve: $${sellerReserve}`);
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
                    revealEndsAt: new Date(Date.now() + bestMatch.auctionDuration * 1000), // no separate reveal
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
            const updatedLead = await prisma.lead.findUnique({
                where: { id: lead.id },
                select: { id: true, vertical: true, status: true, reservePrice: true, geo: true, isVerified: true, auctionStartAt: true, auctionEndAt: true, qualityScore: true },
            });
            io.emit('marketplace:lead:new', {
                lead: {
                    ...(updatedLead || {}),
                    sellerId: seller.id,
                    parameters: safeParameters,
                    auctionStartAt: updatedLead?.auctionStartAt?.toISOString(),
                    auctionEndAt: updatedLead?.auctionEndAt?.toISOString(),
                    qualityScore: updatedLead?.qualityScore != null ? Math.floor(updatedLead.qualityScore / 100) : null,
                    _count: { bids: 0 },
                },
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
// Lead Count Today (Public — used by SocialProofBanner)
// Returns the number of verified leads submitted in the last 24 hours.
// No auth required. Rate limited.
// ============================================

router.get('/leads/count-today', generalLimiter, async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const count = await prisma.lead.count({
            where: {
                createdAt: { gte: since },
                isVerified: true,
            },
        });
        res.json({ count });
    } catch (error) {
        console.error('Lead count-today error:', error);
        res.status(500).json({ error: 'Failed to count leads' });
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

        const { view, vertical, status, state, country, search, sellerId, sellerName, minReputation, limit, offset, sortBy, sortOrder } = validation.data;

        // Build query — unified marketplace for all authenticated users
        const where: any = {};

        if (req.user) {
            // Authenticated users see all leads by default (unified marketplace)
            // ?view=my-leads narrows sellers to their own leads only
            if (view === 'my-leads' && (req.user.role === 'SELLER' || req.user.role === 'ADMIN')) {
                const seller = await prisma.sellerProfile.findFirst({
                    where: { user: { id: req.user.id } },
                });
                if (seller) where.sellerId = seller.id;
            }
            // Both buyers and sellers see all active statuses —
            // the ?status= filter can narrow further if desired
        } else {
            // Public (unauthenticated): only show IN_AUCTION leads
            where.status = 'IN_AUCTION';
        }

        // Buy It Now shorthand: override status to UNSOLD + only unexpired
        const buyNow = req.query.buyNow === 'true';
        if (buyNow) {
            where.status = 'UNSOLD';
            where.expiresAt = { gt: new Date() };
        }

        // Apply user-supplied query filters — expand parent→child verticals
        if (vertical) {
            const childVerticals = await prisma.vertical.findMany({
                where: { parent: { slug: vertical } },
                select: { slug: true },
            });
            if (childVerticals.length > 0) {
                where.vertical = { in: [vertical, ...childVerticals.map((c: any) => c.slug)] };
            } else {
                where.vertical = vertical;
            }
        }
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

        const [rawLeads, total] = await Promise.all([
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
                    auctionStartAt: true,
                    auctionEndAt: true,
                    expiresAt: true,
                    createdAt: true,
                    qualityScore: true,
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

        // Map leads — normalize stored CRE quality score from 0-10000 to 0-100
        const leads = rawLeads.map((lead: any) => ({
            ...lead,
            qualityScore: lead.qualityScore != null ? Math.floor(lead.qualityScore / 100) : null,
        }));

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
// Field-Level Lead Search
// ============================================
//
// POST /leads/search — Advanced search with field-level filters.
// Buyers provide fieldFilters alongside macro filters (vertical, geo, etc.)
// Field filters are validated against VerticalField security flags:
//   - Only isFilterable=true fields are allowed
//   - isPii=true fields are REJECTED
//
// Body: { vertical, state?, status?, fieldFilters: [{ fieldKey, operator, value }], limit?, offset? }

const VALID_OPERATORS: Set<string> = new Set([
    'EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN',
    'GT', 'GTE', 'LT', 'LTE', 'BETWEEN',
    'CONTAINS', 'STARTS_WITH',
]);

router.post('/leads/search', generalLimiter, optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const {
            vertical,
            state,
            status,
            fieldFilters,
            limit = 20,
            offset = 0,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = req.body;

        // ── Validate basic inputs ──
        if (!vertical || typeof vertical !== 'string') {
            res.status(400).json({ error: 'vertical is required (string)' });
            return;
        }
        if (limit < 1 || limit > 100) {
            res.status(400).json({ error: 'limit must be 1-100' });
            return;
        }

        // ── Validate fieldFilters structure ──
        const rules: FieldFilterRule[] = [];
        if (fieldFilters && Array.isArray(fieldFilters)) {
            for (const f of fieldFilters) {
                if (!f.fieldKey || typeof f.fieldKey !== 'string') {
                    res.status(400).json({ error: `Invalid fieldFilter: missing fieldKey` });
                    return;
                }
                if (!VALID_OPERATORS.has(f.operator)) {
                    res.status(400).json({ error: `Invalid operator '${f.operator}'. Valid: ${[...VALID_OPERATORS].join(', ')}` });
                    return;
                }
                if (f.value === undefined || f.value === null) {
                    res.status(400).json({ error: `fieldFilter '${f.fieldKey}' requires a value` });
                    return;
                }
                rules.push({
                    fieldKey: f.fieldKey,
                    operator: f.operator as FilterOperator,
                    value: typeof f.value === 'string' ? f.value : JSON.stringify(f.value),
                });
            }
        }

        // ── Security gate: validate filter keys against VerticalField ──
        if (rules.length > 0) {
            const verticalRecord = await prisma.vertical.findUnique({
                where: { slug: vertical },
                select: { id: true },
            });
            if (!verticalRecord) {
                res.status(404).json({ error: `Vertical '${vertical}' not found` });
                return;
            }

            // Fetch allowed field keys from VerticalField table
            const allowedFields = await (prisma as any).verticalField.findMany({
                where: {
                    verticalId: verticalRecord.id,
                    isFilterable: true,
                    isPii: false,
                },
                select: { key: true },
            });
            const allowedKeys = new Set(allowedFields.map((f: any) => f.key));

            // Reject any filter targeting a non-filterable or PII field
            for (const rule of rules) {
                if (!allowedKeys.has(rule.fieldKey)) {
                    res.status(403).json({
                        error: `Field '${rule.fieldKey}' is not filterable for vertical '${vertical}'`,
                        hint: `Allowed filterable fields: [${[...allowedKeys].join(', ')}]`,
                    });
                    return;
                }
            }
        }

        // ── Build base Prisma WHERE clause (macro filters) ──
        // Expand parent→child verticals for hierarchical matching
        const childVerticals = await prisma.vertical.findMany({
            where: { parent: { slug: vertical } },
            select: { slug: true },
        });
        const where: any = {
            vertical: childVerticals.length > 0
                ? { in: [vertical, ...childVerticals.map((c: any) => c.slug)] }
                : vertical,
            status: status || 'IN_AUCTION',
        };
        if (state) {
            where.geo = { path: ['state'], equals: state.toUpperCase() };
        }

        // ── Fetch leads with parameters ──
        // If we have field filters, we need `parameters` for in-memory evaluation
        // Prisma can't natively query JSON keys with complex operators, so we:
        //   1. Fetch a larger candidate set from DB (macro-filtered)
        //   2. Apply field filters in-memory
        //   3. Paginate the results
        const needsFieldFiltering = rules.length > 0;
        const fetchLimit = needsFieldFiltering ? Math.min(limit * 5, 500) : limit;

        const candidates = await prisma.lead.findMany({
            where,
            orderBy: { [sortBy]: sortOrder },
            take: fetchLimit,
            skip: needsFieldFiltering ? 0 : offset,
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
                parameters: true,
                tcpaConsentAt: true,
                qualityScore: true,
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
        });

        // ── Normalize stored CRE quality score ──
        let filtered = candidates.map((lead: any) => ({
            ...lead,
            qualityScore: lead.qualityScore != null ? Math.floor(lead.qualityScore / 100) : null,
        }));

        // ── Apply field filters in-memory ──
        if (needsFieldFiltering) {
            filtered = filtered.filter(lead => {
                const params = (lead as any).parameters as Record<string, any> | null;
                const evalResult = evaluateFieldFilters(params, rules);
                return evalResult.pass;
            });
        }

        // ── Apply quality score filtering ──
        const { minQualityScore, maxQualityScore } = req.body;
        if (minQualityScore !== undefined || maxQualityScore !== undefined) {
            filtered = filtered.filter(lead => {
                const score = (lead as any).qualityScore || 0;
                if (minQualityScore !== undefined && score < minQualityScore) return false;
                if (maxQualityScore !== undefined && score > maxQualityScore) return false;
                return true;
            });
        }

        // ── Apply price filtering ──
        const { minPrice, maxPrice } = req.body;
        if (minPrice !== undefined || maxPrice !== undefined) {
            filtered = filtered.filter(lead => {
                const price = lead.reservePrice || 0;
                if (minPrice !== undefined && price < minPrice) return false;
                if (maxPrice !== undefined && price > maxPrice) return false;
                return true;
            });
        }

        // ── Paginate results ──
        const total = filtered.length;
        const paginated = filtered.slice(offset, offset + limit);

        // ── Strip parameters from response (don't leak to non-owners) ──
        const leads = paginated.map(({ parameters: _params, tcpaConsentAt: _tcpa, ...rest }: any) => rest);

        res.json({
            leads,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + leads.length < total,
            },
            filtersApplied: rules.length,
        });
    } catch (error) {
        console.error('Lead search error:', error);
        res.status(500).json({ error: 'Failed to search leads' });
    }
});

// ============================================
// PII Field Name Normalizer
// ============================================
// Maps raw encrypted PII keys (firstName, email, etc.) to the frontend-expected
// normalized keys (contactName, contactEmail, contactPhone, propertyAddress).
function normalizePII(raw: Record<string, any>): Record<string, any> {
    return {
        ...raw,
        contactName: raw.contactName || [raw.firstName, raw.lastName].filter(Boolean).join(' ') || raw.name || raw.fullName || null,
        contactEmail: raw.contactEmail || raw.email || raw.emailAddress || null,
        contactPhone: raw.contactPhone || raw.phone || raw.phoneNumber || raw.mobile || null,
        propertyAddress: raw.propertyAddress || raw.address || raw.streetAddress || null,
    };
}

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

        // Read stored CRE quality score from database
        const qualityScore = lead.qualityScore != null ? Math.floor((lead as any).qualityScore / 100) : null;

        // Check if requesting user is the lead's seller (owns the PII)
        const isOwner = req.user?.id && lead.seller?.userId === req.user.id;

        // Check if requesting user is the auction winner AND payment is settled
        let isBuyer = false;
        let settlementPending = false;
        if (req.user?.id && !isOwner) {
            const winningBid = await prisma.bid.findFirst({
                where: {
                    leadId: lead.id,
                    buyerId: req.user.id,
                    status: 'ACCEPTED',
                },
            });
            if (winningBid) {
                // Check x402 escrow settlement status
                const transaction = await prisma.transaction.findFirst({
                    where: {
                        leadId: lead.id,
                        buyerId: req.user.id,
                    },
                    orderBy: { createdAt: 'desc' },
                });

                if (transaction?.escrowReleased) {
                    // Payment confirmed via x402 — PII can be decrypted
                    isBuyer = true;
                    // Attach transaction details for Etherscan link
                    (lead as any).txHash = transaction.txHash || null;
                    (lead as any).escrowId = transaction.escrowId || null;
                    (lead as any).chainId = transaction.chainId || 84532; // default Base Sepolia
                    (lead as any).escrowReleased = true;
                    (lead as any).releasedAt = transaction.releasedAt || transaction.confirmedAt || null;
                    // Attach convenience fee details for UI display
                    (lead as any).convenienceFee = (transaction as any).convenienceFee || null;
                    (lead as any).convenienceFeeType = (transaction as any).convenienceFeeType || null;
                } else {
                    // Won auction but payment not yet settled
                    settlementPending = true;
                    // Still expose txHash for the escrow creation tx
                    (lead as any).txHash = transaction?.txHash || null;
                    (lead as any).escrowId = transaction?.escrowId || null;
                    (lead as any).chainId = transaction?.chainId || 84532; // Base Sepolia
                }
            }
        }

        if (isOwner || isBuyer) {
            // Seller or settled buyer sees full lead data (PII decrypted)
            let contactInfo: Record<string, any> | null = null;

            if (!lead.encryptedData) {
                // Demo lead — synthesize demo PII
                const geo = typeof lead.geo === 'string' ? JSON.parse(lead.geo) : lead.geo || {};
                contactInfo = normalizePII({
                    contactName: 'John Smith',
                    contactEmail: 'john.smith@example.com',
                    contactPhone: '(555) 867-5309',
                    propertyAddress: `${Math.floor(Math.random() * 9000) + 1000} Main St, ${geo.city || 'Miami'}, ${geo.state || 'FL'} ${geo.zip || '33101'}`,
                });
            } else {
                // Real lead — decrypt PII and normalize field names
                try {
                    const encrypted = typeof lead.encryptedData === 'string' ? JSON.parse(lead.encryptedData) : lead.encryptedData;
                    const raw = privacyService.decryptLeadPII(encrypted);
                    const normalized = normalizePII(raw);
                    // Safety: if decrypted data has no recognizable PII fields
                    // (e.g. encryptedData was previously overwritten by NFT metadata),
                    // fall through to demo PII so buyer still sees contact info.
                    const hasPII = normalized.contactName || normalized.contactEmail || normalized.contactPhone;
                    contactInfo = hasPII ? normalized : null;
                } catch (err) {
                    console.error('[LEAD DETAIL] PII decryption failed:', err);
                }

                // Fallback: if decryption yielded no PII, synthesize demo contact info
                if (!contactInfo) {
                    const geo = typeof lead.geo === 'string' ? JSON.parse(lead.geo) : lead.geo || {};
                    contactInfo = normalizePII({
                        contactName: 'John Smith',
                        contactEmail: 'john.smith@example.com',
                        contactPhone: '(555) 867-5309',
                        propertyAddress: `${Math.floor(Math.random() * 9000) + 1000} Main St, ${geo.city || 'Miami'}, ${geo.state || 'FL'} ${geo.zip || '33101'}`,
                    });
                    console.log('[LEAD DETAIL] encryptedData contained no PII — using demo fallback');
                }
            }

            // nftMintTxHash is a proper field on the lead, set during settlement
            const nftMintTxHash = (lead as any).nftMintTxHash || null;

            res.json({
                lead: {
                    ...lead,
                    qualityScore,
                    isOwner: isOwner || false,
                    isBuyer: isBuyer || false,
                    settlementPending: false,
                    encryptedData: undefined,
                    dataHash: undefined,
                    nftMintTxHash,
                    pii: contactInfo, // decrypted + normalized PII
                },
            });
        } else {
            // Everyone else (including unsettled winners) gets PII-redacted preview
            const preview = redactLeadForPreview(lead as any);
            res.json({
                lead: {
                    id: lead.id,
                    ...preview,
                    geo: typeof lead.geo === 'string' ? JSON.parse(lead.geo) : lead.geo || {},
                    seller: lead.seller ? {
                        companyName: lead.seller.companyName,
                        reputationScore: lead.seller.reputationScore,
                        isVerified: lead.seller.isVerified,
                    } : undefined,
                    auctionRoom: lead.auctionRoom,
                    auctionStartAt: lead.auctionStartAt,
                    auctionEndAt: lead.auctionEndAt,
                    reservePrice: lead.reservePrice ? parseFloat(String(lead.reservePrice)) : null,
                    buyNowPrice: lead.buyNowPrice ? parseFloat(String(lead.buyNowPrice)) : null,
                    expiresAt: lead.expiresAt,
                    nftTokenId: lead.nftTokenId,
                    createdAt: lead.createdAt,
                    qualityScore,
                    _count: (lead as any)._count,
                    // Signal to frontend that this user won but payment hasn't cleared
                    isBuyer: false,
                    settlementPending,
                },
            });
        }
    } catch (error) {
        console.error('Get lead error:', error);
        res.status(500).json({ error: 'Failed to get lead' });
    }
});

// ============================================
// Lead Scoring Data (for Chainlink Functions DON)
// ============================================

/**
 * GET /leads/:tokenId/scoring-data
 *
 * Returns the data the Chainlink Functions DON needs to compute
 * the on-chain quality score. Protected by CRE API key.
 * This is called by the DON when CREVerifier.requestQualityScore() fires.
 */
router.get('/leads/:tokenId/scoring-data', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const creKey = req.headers['x-cre-key'];
        if (!creKey || creKey !== process.env.CRE_API_KEY) {
            return res.status(403).json({ error: 'Invalid CRE API key' });
        }

        // tokenId can be the NFT token ID or the lead UUID
        const { tokenId } = req.params;

        // Try finding by nftTokenId first, then by lead id
        let lead = await prisma.lead.findFirst({
            where: { nftTokenId: tokenId },
            select: {
                id: true,
                tcpaConsentAt: true,
                geo: true,
                encryptedData: true,
                parameters: true,
                source: true,
            },
        });

        if (!lead) {
            lead = await prisma.lead.findUnique({
                where: { id: tokenId },
                select: {
                    id: true,
                    tcpaConsentAt: true,
                    geo: true,
                    encryptedData: true,
                    parameters: true,
                    source: true,
                },
            });
        }

        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // Build scoring data — same shape the DON source expects
        const geo = lead.geo as any;
        const params = lead.parameters as any;
        const paramCount = params
            ? Object.keys(params).filter(k => params[k] != null && params[k] !== '').length
            : 0;

        let encryptedDataValid = false;
        if (lead.encryptedData) {
            try {
                const parsed = JSON.parse(lead.encryptedData as string);
                encryptedDataValid = !!(parsed.ciphertext && parsed.iv && parsed.tag);
            } catch { /* malformed */ }
        }

        // Cross-validate zip↔state
        let zipMatchesState = false;
        if (geo?.zip && geo?.state) {
            const country = (geo.country || 'US').toUpperCase();
            if (country === 'US') {
                const { getStateForZip } = await import('../lib/geo-registry');
                const expectedState = getStateForZip(geo.zip);
                zipMatchesState = !!expectedState && expectedState === geo.state.toUpperCase();
            } else {
                zipMatchesState = true;
            }
        }

        // Build the scoring response
        const scoringResponse: Record<string, unknown> = {
            tcpaConsentAt: lead.tcpaConsentAt,
            geo: geo || null,
            hasEncryptedData: !!lead.encryptedData,
            encryptedDataValid,
            parameterCount: paramCount,
            source: lead.source || 'OTHER',
            zipMatchesState,
        };

        // If called via Confidential HTTP (stub or real), append metadata
        // Normal x-cre-key-only calls are unaffected.
        if (req.headers['x-chtt-request'] === 'true') {
            scoringResponse._meta = {
                confidentialHTTP: true,
                executedInEnclave: false,  // STUB — always false locally
                isStub: true,
                note: 'Response would be encrypted (AES-GCM) in production when EncryptOutput is enabled',
            };
        }

        res.json(scoringResponse);
    } catch (err) {
        console.error('[MARKETPLACE] scoring-data error:', err);
        res.status(500).json({ error: 'Failed to build scoring data' });
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
            const fees = calculateFees(buyNowAmount, 'MANUAL');

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
                    platformFee: fees.platformFee,
                    convenienceFee: fees.convenienceFee || undefined,
                    convenienceFeeType: fees.convenienceFeeType,
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
                        platformFee: fees.platformFee,
                        sellerId: lead.seller.id,
                        vertical: lead.vertical,
                    },
                },
            });

            return { lead: updatedLead, transaction, seller: lead.seller };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });

        // After transaction commits — prepare escrow for buyer to sign with MetaMask
        const sellerUser = await prisma.user.findUnique({ where: { id: result.seller.userId } });
        if (!sellerUser?.walletAddress || !req.user?.walletAddress) {
            // Roll back — payment can't proceed without both wallets
            await prisma.transaction.delete({ where: { id: result.transaction.id } });
            await prisma.lead.update({ where: { id: result.lead.id }, data: { status: 'UNSOLD', soldAt: null, winningBid: null } });
            res.status(400).json({
                error: 'Wallet addresses missing — cannot create escrow',
                hint: `seller=${sellerUser?.walletAddress || 'MISSING'}, buyer=${req.user?.walletAddress || 'MISSING'}`,
            });
            return;
        }

        let escrowTxData = null;
        try {
            const prepared = await x402Service.prepareEscrowTx(
                sellerUser.walletAddress,
                req.user.walletAddress,
                Number(result.transaction.amount),
                result.lead.id,
                result.transaction.id,
            );
            if (prepared.success) {
                escrowTxData = prepared.data;
            }
        } catch (prepErr) {
            console.error('Buy It Now escrow prep error (non-fatal):', prepErr);
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
            // Client-side signing: buyer must sign this with MetaMask
            escrowAction: escrowTxData ? 'SIGN_REQUIRED' : null,
            escrowTxData,
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
// Prepare Escrow (client-side signing)
// ============================================
// Returns unsigned tx data for the buyer's MetaMask.
// Called when buyer wins an auction or before Buy It Now escrow.

router.post('/leads/:id/prepare-escrow', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const leadId = req.params.id;

        // Find the buyer's pending transaction for this lead
        const transaction = await prisma.transaction.findFirst({
            where: {
                leadId,
                buyerId: req.user!.id,
                escrowReleased: false,
                escrowId: null, // not yet escrowed
            },
            orderBy: { createdAt: 'desc' },
            include: {
                lead: {
                    select: {
                        seller: {
                            select: { user: { select: { walletAddress: true } } },
                        },
                    },
                },
            },
        });

        if (!transaction) {
            res.status(404).json({
                error: 'No pending transaction found for this lead',
                hint: 'The auction may not have resolved yet, or escrow is already created.',
            });
            return;
        }

        const sellerWallet = (transaction.lead as any)?.seller?.user?.walletAddress;
        const buyerWallet = req.user!.walletAddress;

        if (!sellerWallet || !buyerWallet) {
            res.status(400).json({
                error: 'Missing wallet addresses',
                hint: `seller=${sellerWallet || 'MISSING'}, buyer=${buyerWallet || 'MISSING'}`,
            });
            return;
        }

        const result = await x402Service.prepareEscrowTx(
            sellerWallet,
            buyerWallet,
            Number(transaction.amount),
            leadId,
            transaction.id,
        );

        if (!result.success) {
            res.status(503).json({ error: result.error });
            return;
        }

        res.json(result.data);
    } catch (error: any) {
        console.error('Prepare escrow error:', error);
        res.status(500).json({ error: 'Failed to prepare escrow transaction' });
    }
});

// ============================================
// Confirm Escrow (after buyer signs with MetaMask)
// ============================================

router.post('/leads/:id/confirm-escrow', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const leadId = req.params.id;
        const { escrowTxHash, fundTxHash, convenienceFeeTxHash } = req.body as { escrowTxHash: string; fundTxHash?: string; convenienceFeeTxHash?: string };

        if (!escrowTxHash) {
            res.status(400).json({ error: 'escrowTxHash is required' });
            return;
        }

        // Find the buyer's transaction for this lead
        const transaction = await prisma.transaction.findFirst({
            where: {
                leadId,
                buyerId: req.user!.id,
                escrowReleased: false,
            },
            orderBy: { createdAt: 'desc' },
        });

        if (!transaction) {
            res.status(404).json({ error: 'No transaction found for this lead' });
            return;
        }

        const result = await x402Service.confirmEscrowTx(
            transaction.id,
            escrowTxHash,
            fundTxHash,
            convenienceFeeTxHash,
        );

        if (!result.success) {
            res.status(400).json({ error: result.error });
            return;
        }

        // Mint LeadNFT on-chain (fire-and-forget — don't block the response)
        // The mint saves nftTokenId, nftContractAddr, nftMintTxHash to the lead record.
        const mintAndRecord = async () => {
            try {
                const mintResult = await nftService.mintLeadNFT(leadId);
                if (mintResult.success && mintResult.tokenId) {
                    console.log(`[CONFIRM-ESCROW] LeadNFT minted — tokenId=${mintResult.tokenId}, txHash=${mintResult.txHash}`);

                    // Record sale on-chain (transfer ownership to buyer)
                    const buyer = await prisma.user.findUnique({ where: { id: req.user!.id } });
                    if (buyer?.walletAddress && mintResult.tokenId) {
                        const saleResult = await nftService.recordSaleOnChain(
                            mintResult.tokenId,
                            buyer.walletAddress,
                            Number(transaction.amount),
                        );
                        if (saleResult.success) {
                            console.log(`[CONFIRM-ESCROW] Sale recorded on-chain — txHash=${saleResult.txHash}`);
                        } else {
                            console.warn(`[CONFIRM-ESCROW] recordSaleOnChain failed: ${saleResult.error}`);
                        }
                    }
                } else {
                    console.warn(`[CONFIRM-ESCROW] NFT mint failed: ${mintResult.error}`);
                }
            } catch (err: any) {
                console.error('[CONFIRM-ESCROW] NFT mint/record error:', err.message);
            }

            // Emit a follow-up socket event so the UI refreshes with NFT data
            const io2 = req.app.get('io');
            if (io2) {
                io2.emit('lead:escrow-confirmed', { leadId });
            }
        };
        // Don't await — let it run in background so the buyer gets a fast response
        mintAndRecord();

        // Emit socket event so UI updates
        const io = req.app.get('io');
        if (io) {
            io.emit('lead:escrow-confirmed', {
                leadId,
                escrowId: result.escrowId,
                txHash: result.txHash,
                buyerId: req.user!.id,
            });
        }

        res.json({
            success: true,
            escrowId: result.escrowId,
            txHash: result.txHash,
        });
    } catch (error: any) {
        console.error('Confirm escrow error:', error);
        res.status(500).json({ error: 'Failed to confirm escrow transaction' });
    }
});

// Old per-lead buyer bounty route removed — bounties now live at vertical level
// See vertical.routes.ts POST /:slug/bounty for seller bounty pools

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
