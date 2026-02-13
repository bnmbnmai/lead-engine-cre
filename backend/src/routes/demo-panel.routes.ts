/**
 * Demo Panel API Routes
 * 
 * Development-only endpoints for demo control panel.
 * Gated by NODE_ENV check — returns 403 in production.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { LEAD_AUCTION_DURATION_SECS } from '../config/perks.env';
import { clearAllCaches } from '../lib/cache';

const router = Router();

// ============================================
// Production Guard — block all demo routes in prod
// ============================================

const devOnly = (_req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
        res.status(403).json({ error: 'Demo endpoints disabled in production' });
        return;
    }
    next();
};

router.use(devOnly);

const DEMO_TAG = 'DEMO_PANEL';  // Tag for identifying demo data
const FALLBACK_VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'b2b_saas', 'real_estate', 'auto', 'legal', 'financial_services'];
const STATES = ['CA', 'TX', 'FL', 'NY', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI'];
const CITIES: Record<string, string> = { CA: 'Los Angeles', TX: 'Houston', FL: 'Miami', NY: 'New York', IL: 'Chicago', PA: 'Philadelphia', OH: 'Columbus', GA: 'Atlanta', NC: 'Charlotte', MI: 'Detroit' };

const PRICING: Record<string, { min: number; max: number }> = {
    solar: { min: 25, max: 75 }, mortgage: { min: 30, max: 100 }, roofing: { min: 20, max: 60 },
    insurance: { min: 15, max: 50 }, home_services: { min: 10, max: 30 }, b2b_saas: { min: 50, max: 200 },
    real_estate: { min: 40, max: 150 }, auto: { min: 12, max: 40 }, legal: { min: 35, max: 120 }, financial_services: { min: 45, max: 180 },
};

// Non-PII demo form-field values (mirrors LeadSubmitForm VERTICAL_FIELDS)
const VERTICAL_DEMO_PARAMS: Record<string, Record<string, string | boolean>> = {
    solar: { roof_age: '8', monthly_bill: '185', ownership: 'own', panel_interest: 'purchase', shade_level: 'no_shade' },
    mortgage: { loan_type: 'purchase', credit_range: 'good_700-749', property_type: 'single_family', purchase_price: '450000', down_payment_pct: '20' },
    roofing: { roof_type: 'shingle', damage_type: 'storm', insurance_claim: true, roof_age: '15', square_footage: '2200' },
    insurance: { coverage_type: 'home', current_provider: 'State Farm', policy_expiry: '30', num_drivers: '2' },
    home_services: { service_type: 'hvac', urgency: 'this_week', property_type: 'residential' },
    real_estate: { transaction_type: 'buying', property_type: 'single_family', price_range: '200k-500k', timeline: '1-3_months' },
    auto: { vehicle_year: '2022', vehicle_make: 'Toyota', vehicle_model: 'Camry', mileage: '28000', coverage_type: 'full', current_insured: true },
    b2b_saas: { company_size: '51-200', industry: 'technology', budget_range: '2000-10000', decision_timeline: '1-3_months', current_solution: 'Salesforce' },
    legal: { case_type: 'personal_injury', urgency: 'this_week', has_representation: false, case_value: '75000' },
    financial_services: { service_type: 'financial_planning', portfolio_size: '250k-1m', risk_tolerance: 'moderate', existing_advisor: false },
};

function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[rand(0, arr.length - 1)]; }

// Demo buyer profiles for multi-user bid simulation
const DEMO_BUYERS = [
    { wallet: '0xDEMO_BUYER_1', company: 'SolarPro Acquisitions' },
    { wallet: '0xDEMO_BUYER_2', company: 'FinanceLead Partners' },
    { wallet: '0xDEMO_BUYER_3', company: 'InsureTech Direct' },
];

// ============================================
// GET /status — current demo data counts
// ============================================
router.get('/status', async (_req: Request, res: Response) => {
    try {
        // Count demo-tagged data using consentProof field as tag
        const [leads, bids, asks] = await Promise.all([
            prisma.lead.count({ where: { consentProof: DEMO_TAG } }),
            prisma.bid.count({ where: { lead: { consentProof: DEMO_TAG } } }),
            prisma.ask.count({ where: { parameters: { path: ['_demoTag'], equals: DEMO_TAG } } }),
        ]);

        res.json({
            seeded: leads > 0,
            leads,
            bids,
            asks,
        });
    } catch (error) {
        console.error('Demo status error:', error);
        res.json({ seeded: false, leads: 0, bids: 0, asks: 0 });
    }
});

// ============================================
// POST /seed — populate marketplace with demo data
// ============================================
router.post('/seed', async (req: Request, res: Response) => {
    try {
        // Fetch verticals dynamically from DB, fall back to hard-coded list
        let VERTICALS = FALLBACK_VERTICALS;
        try {
            const dbVerticals = await (prisma as any).vertical?.findMany?.({
                where: { status: 'ACTIVE', depth: 0 },
                select: { slug: true },
                orderBy: { sortOrder: 'asc' },
            });
            if (dbVerticals && dbVerticals.length > 0) {
                VERTICALS = dbVerticals.map((v: any) => v.slug);
                console.log(`[DEMO] Using ${VERTICALS.length} dynamic verticals from DB`);
            } else {
                console.log(`[DEMO] No DB verticals found, using ${FALLBACK_VERTICALS.length} fallback verticals`);
            }
        } catch {
            console.log(`[DEMO] Vertical table not available, using fallback verticals`);
        }

        // Auto-clear existing demo data (makes seed idempotent)
        // Must delete in FK dependency order: Transaction uses RESTRICT on leadId
        const existing = await prisma.lead.count({ where: { consentProof: DEMO_TAG } });
        if (existing > 0) {
            console.log(`[DEMO] Auto-clearing ${existing} existing demo leads before re-seed`);
            await prisma.bid.deleteMany({ where: { lead: { consentProof: DEMO_TAG } } });
            await prisma.transaction.deleteMany({ where: { lead: { consentProof: DEMO_TAG } } });
            await prisma.auctionRoom.deleteMany({ where: { lead: { consentProof: DEMO_TAG } } });

            await prisma.lead.deleteMany({ where: { consentProof: DEMO_TAG } });
            await prisma.ask.deleteMany({ where: { parameters: { path: ['_demoTag'], equals: DEMO_TAG } } });
            clearAllCaches();
        }

        // Find or create a demo user + profiles
        let demoUser = await prisma.user.findFirst({ where: { walletAddress: '0xDEMO_PANEL_USER' } });
        if (!demoUser) {
            demoUser = await prisma.user.create({
                data: {
                    walletAddress: '0xDEMO_PANEL_USER',
                    role: 'SELLER',
                    sellerProfile: {
                        create: {
                            companyName: 'Demo Seller Co.',
                            verticals: VERTICALS,
                            isVerified: true,
                            kycStatus: 'VERIFIED',
                        },
                    },
                    buyerProfile: {
                        create: {
                            companyName: 'Demo Buyer Corp.',
                            verticals: VERTICALS,
                            acceptOffSite: true,
                        },
                    },
                },
                include: { sellerProfile: true, buyerProfile: true },
            });
        } else {
            // Ensure profiles exist for previously created user
            const existingSeller = await prisma.sellerProfile.findFirst({ where: { userId: demoUser.id } });
            if (!existingSeller) {
                await prisma.sellerProfile.create({
                    data: { userId: demoUser.id, companyName: 'Demo Seller Co.', verticals: VERTICALS, isVerified: true, kycStatus: 'VERIFIED' },
                });
            }
            const existingBuyer = await prisma.buyerProfile.findFirst({ where: { userId: demoUser.id } });
            if (!existingBuyer) {
                await prisma.buyerProfile.create({
                    data: { userId: demoUser.id, companyName: 'Demo Buyer Corp.', verticals: VERTICALS, acceptOffSite: true },
                });
            }
        }

        const seller = await prisma.sellerProfile.findFirst({ where: { userId: demoUser.id } });
        if (!seller) {
            res.status(500).json({ error: 'Failed to create demo seller profile' });
            return;
        }

        // Create demo buyer users for multi-user bid simulation
        const buyerUserIds: string[] = [];
        for (const buyer of DEMO_BUYERS) {
            let buyerUser = await prisma.user.findFirst({ where: { walletAddress: buyer.wallet } });
            if (!buyerUser) {
                buyerUser = await prisma.user.create({
                    data: {
                        walletAddress: buyer.wallet,
                        role: 'BUYER',
                        buyerProfile: {
                            create: {
                                companyName: buyer.company,
                                verticals: VERTICALS.slice(0, 5),
                                acceptOffSite: true,
                            },
                        },
                    },
                });
            }
            buyerUserIds.push(buyerUser.id);
        }

        // Create 5 asks (one per 2 verticals)
        let askCount = 0;
        for (let i = 0; i < 5; i++) {
            const vertical = VERTICALS[i * 2];
            const states = [pick(STATES), pick(STATES)];
            await prisma.ask.create({
                data: {
                    sellerId: seller.id,
                    vertical,
                    geoTargets: { country: 'US', states },
                    reservePrice: rand(PRICING[vertical].min, PRICING[vertical].max),
                    status: 'ACTIVE',
                    parameters: { _demoTag: DEMO_TAG },
                    auctionDuration: LEAD_AUCTION_DURATION_SECS,
                    revealWindow: 900,
                },
            });
            askCount++;
        }

        // Create 20 leads across all verticals
        let leadCount = 0;
        const leadIds: string[] = [];

        for (let i = 0; i < 20; i++) {
            const vertical = VERTICALS[i % VERTICALS.length];
            const state = pick(STATES);
            const price = rand(PRICING[vertical].min, PRICING[vertical].max);

            // Status distribution: 70% IN_AUCTION, 20% SOLD, 10% EXPIRED
            const r = Math.random();
            const status = r < 0.7 ? 'IN_AUCTION' : r < 0.9 ? 'SOLD' : 'EXPIRED';

            const now = new Date();
            const createdAt = new Date(now.getTime() - rand(0, 7) * 86400000);
            const auctionEnd = status === 'IN_AUCTION'
                ? new Date(now.getTime() + LEAD_AUCTION_DURATION_SECS * 1000)
                : new Date(createdAt.getTime() + 2 * 86400000);

            const lead = await prisma.lead.create({
                data: {
                    sellerId: seller.id,
                    vertical,
                    geo: { country: 'US', state, city: CITIES[state] || 'Demo City', zip: `${rand(10000, 99999)}` },
                    source: 'PLATFORM',
                    status: status as any,
                    reservePrice: price,
                    winningBid: status === 'SOLD' ? price * 1.2 : undefined,
                    isVerified: true,
                    tcpaConsentAt: createdAt,
                    consentProof: DEMO_TAG,
                    createdAt,
                    auctionStartAt: createdAt,
                    auctionEndAt: auctionEnd,
                    soldAt: status === 'SOLD' ? new Date(createdAt.getTime() + rand(1, 3) * 86400000) : undefined,
                },
            });

            leadIds.push(lead.id);
            leadCount++;
        }

        // Create bids for IN_AUCTION leads
        let bidCount = 0;
        const auctionLeads = await prisma.lead.findMany({
            where: { id: { in: leadIds }, status: 'IN_AUCTION' },
            select: { id: true, reservePrice: true },
        });

        for (const lead of auctionLeads) {
            // Create bids from different demo buyers (respects @@unique([leadId, buyerId]))
            const shuffledBuyers = [...buyerUserIds].sort(() => Math.random() - 0.5);
            const numBidders = rand(1, Math.min(3, shuffledBuyers.length));
            const baseAmount = Number(lead.reservePrice || 20);

            for (let b = 0; b < numBidders; b++) {
                await prisma.bid.create({
                    data: {
                        leadId: lead.id,
                        buyerId: shuffledBuyers[b],
                        amount: baseAmount + rand(1, 30) + (b * rand(2, 8)),
                        status: 'REVEALED',
                        source: 'MANUAL',
                    },
                });
                bidCount++;
            }
        }

        // Notify all clients to refresh marketplace
        const io = req.app.get('io');
        if (io) io.emit('marketplace:refreshAll');

        res.json({
            success: true,
            leads: leadCount,
            bids: bidCount,
            asks: askCount,
        });
    } catch (error) {
        console.error('Demo seed error:', error);
        res.status(500).json({ error: 'Failed to seed demo data', details: String(error) });
    }
});

// ============================================
// POST /clear — remove all demo data
// ============================================
router.post('/clear', async (req: Request, res: Response) => {
    try {
        // Delete ALL data in dependency order — ensures old long-duration / orphan records are removed
        const deletedBids = await prisma.bid.deleteMany({});
        await prisma.auctionRoom.deleteMany({});
        await prisma.transaction.deleteMany({});
        const deletedLeads = await prisma.lead.deleteMany({});
        const deletedAsks = await prisma.ask.deleteMany({});

        // Flush all in-memory LRU caches so stale data doesn't persist
        const cachesFlushed = clearAllCaches();

        // Notify clients marketplace is empty
        const io = req.app.get('io');
        if (io) io.emit('marketplace:refreshAll');

        res.json({
            success: true,
            deleted: {
                leads: deletedLeads.count,
                bids: deletedBids.count,
                asks: deletedAsks.count,
            },
            cachesFlushed,
        });
    } catch (error) {
        console.error('Demo clear error:', error);
        res.status(500).json({ error: 'Failed to clear demo data', details: String(error) });
    }
});

// ============================================
// POST /lead — inject single random lead
// ============================================
router.post('/lead', async (req: Request, res: Response) => {
    try {
        const vertical = req.body?.vertical || pick(FALLBACK_VERTICALS);
        const state = pick(STATES);
        const price = rand(PRICING[vertical]?.min || 10, PRICING[vertical]?.max || 50);

        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { walletAddress: '0xDEMO_PANEL_USER' } },
        });

        if (!seller) {
            res.status(400).json({ error: 'Demo data not seeded. Seed marketplace first.' });
            return;
        }

        // Build non-PII form parameters from vertical schema
        const params = VERTICAL_DEMO_PARAMS[vertical] || {};

        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical,
                geo: { country: 'US', state, city: CITIES[state] || 'Demo City', zip: `${rand(10000, 99999)}` },
                source: 'PLATFORM',
                status: 'IN_AUCTION',
                reservePrice: price,
                isVerified: true,
                tcpaConsentAt: new Date(),
                consentProof: DEMO_TAG,
                auctionStartAt: new Date(),
                auctionEndAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
                parameters: params as any,
            },
        });

        // Emit real-time event for new lead
        const io = req.app.get('io');
        if (io) {
            io.emit('marketplace:lead:new', {
                lead: {
                    id: lead.id,
                    vertical,
                    status: 'IN_AUCTION',
                    reservePrice: price,
                    geo: { country: 'US', state },
                    isVerified: true,
                    auctionStartAt: lead.auctionStartAt?.toISOString(),
                    auctionEndAt: lead.auctionEndAt?.toISOString(),
                    parameters: params,
                    _count: { bids: 0 },
                },
            });
        }

        res.json({ success: true, lead: { id: lead.id, vertical, state, price, parameters: params } });
    } catch (error) {
        console.error('Demo inject lead error:', error);
        res.status(500).json({ error: 'Failed to inject lead' });
    }
});

// ============================================
// POST /auction — simulate live auction (create lead + bids over time)
// ============================================
router.post('/auction', async (req: Request, res: Response) => {
    try {
        const vertical = req.body?.vertical || pick(FALLBACK_VERTICALS);
        const state = pick(STATES);
        const reservePrice = rand(PRICING[vertical]?.min || 10, PRICING[vertical]?.max || 50);

        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { walletAddress: '0xDEMO_PANEL_USER' } },
        });

        const demoUser = await prisma.user.findFirst({
            where: { walletAddress: '0xDEMO_PANEL_USER' },
        });

        // Gather all demo buyer IDs for multi-user bids
        const demoBuyerUsers = await prisma.user.findMany({
            where: { walletAddress: { in: DEMO_BUYERS.map(b => b.wallet) } },
            select: { id: true, walletAddress: true },
        });
        // Fallback to demoUser if buyers don't exist yet
        const bidderIds = demoBuyerUsers.length > 0
            ? demoBuyerUsers.map(u => u.id)
            : demoUser ? [demoUser.id] : [];

        if (!seller || !demoUser) {
            res.status(400).json({ error: 'Demo data not seeded. Seed marketplace first.' });
            return;
        }

        // Create lead in auction
        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical,
                geo: { country: 'US', state, city: CITIES[state] || 'Demo City', zip: `${rand(10000, 99999)}` },
                source: 'PLATFORM',
                status: 'IN_AUCTION',
                reservePrice,
                isVerified: true,
                tcpaConsentAt: new Date(),
                consentProof: DEMO_TAG,
                auctionStartAt: new Date(),
                auctionEndAt: new Date(Date.now() + 120000), // 2 min auction
            },
        });

        // Create auction room
        await prisma.auctionRoom.create({
            data: {
                leadId: lead.id,
                roomId: `demo-auction-${lead.id}`,
                phase: 'BIDDING',
                biddingEndsAt: new Date(Date.now() + 90000),
                revealEndsAt: new Date(Date.now() + 120000),
                participants: [demoUser.id],
            },
        });

        // Emit real-time event for new auction lead
        const io = req.app.get('io');
        if (io) {
            io.emit('marketplace:lead:new', {
                lead: {
                    id: lead.id,
                    vertical,
                    status: 'IN_AUCTION',
                    reservePrice,
                    geo: { country: 'US', state },
                    isVerified: true,
                    auctionStartAt: new Date().toISOString(),
                    auctionEndAt: new Date(Date.now() + 120000).toISOString(),
                    _count: { bids: 0 },
                },
            });
        }

        // Simulate bids arriving over 30s (fire-and-forget)
        const bidIntervals = [3000, 6000, 10000, 15000, 20000, 25000];
        let currentBid = reservePrice;

        bidIntervals.forEach((delay, index) => {
            setTimeout(async () => {
                try {
                    currentBid += rand(2, 10);
                    const bidderId = bidderIds[index % bidderIds.length];
                    await prisma.bid.create({
                        data: {
                            leadId: lead.id,
                            buyerId: bidderId,
                            amount: currentBid,
                            status: 'REVEALED',
                            source: 'MANUAL',
                        },
                    });
                    await prisma.auctionRoom.update({
                        where: { leadId: lead.id },
                        data: { bidCount: { increment: 1 }, highestBid: currentBid },
                    });

                    // Emit real-time bid update
                    if (io) {
                        io.emit('marketplace:bid:update', {
                            leadId: lead.id,
                            bidCount: index + 1,
                            highestBid: currentBid,
                            timestamp: new Date().toISOString(),
                        });
                    }
                } catch (err) {
                    console.error('Demo auction bid error:', err);
                }
            }, delay);
        });

        res.json({
            success: true,
            leadId: lead.id,
            vertical,
            reservePrice,
            auctionEndsIn: '2 minutes',
            simulatedBids: bidIntervals.length,
        });
    } catch (error) {
        console.error('Demo auction error:', error);
        res.status(500).json({ error: 'Failed to start demo auction' });
    }
});

// ============================================
// POST /reset — clear ALL data + reseed fresh short auctions
// ============================================
router.post('/reset', async (req: Request, res: Response) => {
    try {
        // 1. Clear everything
        await prisma.bid.deleteMany({});
        await prisma.auctionRoom.deleteMany({});
        await prisma.transaction.deleteMany({});
        const cleared = await prisma.lead.deleteMany({});
        await prisma.ask.deleteMany({});

        // Flush all in-memory LRU caches so stale data doesn't persist
        clearAllCaches();

        // 2. Re-seed with short auctions (delegate to seed logic)
        // Find or create demo user
        let demoUser = await prisma.user.findFirst({ where: { walletAddress: '0xDEMO_PANEL_USER' } });
        if (!demoUser) {
            demoUser = await prisma.user.create({
                data: {
                    walletAddress: '0xDEMO_PANEL_USER',
                    role: 'SELLER',
                    sellerProfile: { create: { companyName: 'Demo Seller Co.', verticals: FALLBACK_VERTICALS, isVerified: true, kycStatus: 'VERIFIED' } },
                    buyerProfile: { create: { companyName: 'Demo Buyer Corp.', verticals: FALLBACK_VERTICALS, acceptOffSite: true } },
                },
                include: { sellerProfile: true, buyerProfile: true },
            });
        }

        // Ensure profiles exist (may have been cascade-deleted by a previous partial reset)
        let seller = await prisma.sellerProfile.findFirst({ where: { userId: demoUser.id } });
        if (!seller) {
            console.log('[DEMO] Recreating missing seller profile for demo user');
            seller = await prisma.sellerProfile.create({
                data: { userId: demoUser.id, companyName: 'Demo Seller Co.', verticals: FALLBACK_VERTICALS, isVerified: true, kycStatus: 'VERIFIED' },
            });
        }
        const existingBuyerP = await prisma.buyerProfile.findFirst({ where: { userId: demoUser.id } });
        if (!existingBuyerP) {
            console.log('[DEMO] Recreating missing buyer profile for demo user');
            await prisma.buyerProfile.create({
                data: { userId: demoUser.id, companyName: 'Demo Buyer Corp.', verticals: FALLBACK_VERTICALS, acceptOffSite: true },
            });
        }

        // Create demo buyers
        const buyerUserIds: string[] = [];
        for (const buyer of DEMO_BUYERS) {
            let buyerUser = await prisma.user.findFirst({ where: { walletAddress: buyer.wallet } });
            if (!buyerUser) {
                buyerUser = await prisma.user.create({
                    data: { walletAddress: buyer.wallet, role: 'BUYER', buyerProfile: { create: { companyName: buyer.company, verticals: FALLBACK_VERTICALS.slice(0, 5), acceptOffSite: true } } },
                });
            }
            buyerUserIds.push(buyerUser.id);
        }

        // Create 5 asks
        let askCount = 0;
        for (let i = 0; i < 5; i++) {
            const vertical = FALLBACK_VERTICALS[i * 2];
            await prisma.ask.create({
                data: {
                    sellerId: seller.id, vertical,
                    geoTargets: { country: 'US', states: [pick(STATES), pick(STATES)] },
                    reservePrice: rand(PRICING[vertical].min, PRICING[vertical].max),
                    status: 'ACTIVE', parameters: { _demoTag: DEMO_TAG },
                    auctionDuration: LEAD_AUCTION_DURATION_SECS, revealWindow: 900,
                },
            });
            askCount++;
        }

        // Create 10 leads (all IN_AUCTION with 5-min durations)
        let leadCount = 0;
        const leadIds: string[] = [];
        for (let i = 0; i < 10; i++) {
            const vertical = FALLBACK_VERTICALS[i % FALLBACK_VERTICALS.length];
            const state = pick(STATES);
            const price = rand(PRICING[vertical].min, PRICING[vertical].max);
            const params = VERTICAL_DEMO_PARAMS[vertical] || {};
            const lead = await prisma.lead.create({
                data: {
                    sellerId: seller.id, vertical,
                    geo: { country: 'US', state, city: CITIES[state] || 'Demo City', zip: `${rand(10000, 99999)}` },
                    source: 'PLATFORM', status: 'IN_AUCTION', reservePrice: price,
                    isVerified: true,
                    tcpaConsentAt: new Date(), consentProof: DEMO_TAG,
                    auctionStartAt: new Date(),
                    auctionEndAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
                    parameters: params as any,
                },
            });
            leadIds.push(lead.id);
            leadCount++;
        }

        // Create bids
        let bidCount = 0;
        for (const leadId of leadIds) {
            const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { reservePrice: true } });
            if (!lead) continue;
            const shuffled = [...buyerUserIds].sort(() => Math.random() - 0.5);
            const numBidders = rand(1, Math.min(2, shuffled.length));
            for (let b = 0; b < numBidders; b++) {
                await prisma.bid.create({
                    data: { leadId, buyerId: shuffled[b], amount: Number(lead.reservePrice || 20) + rand(5, 25), status: 'REVEALED', source: 'MANUAL' },
                });
                bidCount++;
            }
        }

        // 3. Notify clients
        const io = req.app.get('io');
        if (io) io.emit('marketplace:refreshAll');

        res.json({
            success: true,
            cleared: cleared.count,
            reseeded: { leads: leadCount, bids: bidCount, asks: askCount },
        });
    } catch (error) {
        console.error('Demo reset error:', error);
        res.status(500).json({ error: 'Failed to reset demo state', details: String(error) });
    }
});

export default router;
