/**
 * Demo Panel API Routes
 * 
 * Development-only endpoints for demo control panel.
 * Gated by NODE_ENV check — returns 403 in production.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

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
const VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'b2b_saas', 'real_estate', 'auto', 'legal', 'financial_services'];
const STATES = ['CA', 'TX', 'FL', 'NY', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI'];
const CITIES: Record<string, string> = { CA: 'Los Angeles', TX: 'Houston', FL: 'Miami', NY: 'New York', IL: 'Chicago', PA: 'Philadelphia', OH: 'Columbus', GA: 'Atlanta', NC: 'Charlotte', MI: 'Detroit' };

const PRICING: Record<string, { min: number; max: number }> = {
    solar: { min: 25, max: 75 }, mortgage: { min: 30, max: 100 }, roofing: { min: 20, max: 60 },
    insurance: { min: 15, max: 50 }, home_services: { min: 10, max: 30 }, b2b_saas: { min: 50, max: 200 },
    real_estate: { min: 40, max: 150 }, auto: { min: 12, max: 40 }, legal: { min: 35, max: 120 }, financial: { min: 45, max: 180 },
};

function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[rand(0, arr.length - 1)]; }

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
router.post('/seed', async (_req: Request, res: Response) => {
    try {
        // Check if demo data already exists
        const existing = await prisma.lead.count({ where: { consentProof: DEMO_TAG } });
        if (existing > 0) {
            res.status(409).json({ error: 'Demo data already exists. Clear first.', leads: existing });
            return;
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
                    auctionDuration: 3600,
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
                ? new Date(now.getTime() + rand(1, 72) * 3600000)
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
            // One bid per lead (@@unique([leadId, buyerId]) constraint)
            const baseAmount = Number(lead.reservePrice || 20);
            await prisma.bid.create({
                data: {
                    leadId: lead.id,
                    buyerId: demoUser.id,
                    amount: baseAmount + rand(1, 30),
                    status: 'REVEALED',
                    source: 'MANUAL',
                },
            });
            bidCount++;
        }

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
router.post('/clear', async (_req: Request, res: Response) => {
    try {
        // Delete in dependency order: bids → leads → asks → profiles
        const demoLeadIds = await prisma.lead.findMany({
            where: { consentProof: DEMO_TAG },
            select: { id: true },
        });
        const ids = demoLeadIds.map(l => l.id);

        // Delete bids on demo leads
        const deletedBids = await prisma.bid.deleteMany({
            where: { leadId: { in: ids } },
        });

        // Delete auction rooms
        await prisma.auctionRoom.deleteMany({
            where: { leadId: { in: ids } },
        });

        // Delete transactions
        await prisma.transaction.deleteMany({
            where: { leadId: { in: ids } },
        });

        // Delete demo leads
        const deletedLeads = await prisma.lead.deleteMany({
            where: { consentProof: DEMO_TAG },
        });

        // Delete demo asks — use sellerId from demo user for reliability
        const demoSeller = await prisma.sellerProfile.findFirst({ where: { user: { walletAddress: '0xDEMO_PANEL_USER' } } });
        let deletedAsksCount = 0;
        if (demoSeller) {
            const deletedAsks = await prisma.ask.deleteMany({ where: { sellerId: demoSeller.id } });
            deletedAsksCount = deletedAsks.count;
        }

        res.json({
            success: true,
            deleted: {
                leads: deletedLeads.count,
                bids: deletedBids.count,
                asks: deletedAsksCount,
            },
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
        const vertical = req.body?.vertical || pick(VERTICALS);
        const state = pick(STATES);
        const price = rand(PRICING[vertical]?.min || 10, PRICING[vertical]?.max || 50);

        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { walletAddress: '0xDEMO_PANEL_USER' } },
        });

        if (!seller) {
            res.status(400).json({ error: 'Demo data not seeded. Seed marketplace first.' });
            return;
        }

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
                auctionEndAt: new Date(Date.now() + 3600000), // 1 hour
            },
        });

        res.json({ success: true, lead: { id: lead.id, vertical, state, price } });
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
        const vertical = req.body?.vertical || pick(VERTICALS);
        const state = pick(STATES);
        const reservePrice = rand(PRICING[vertical]?.min || 10, PRICING[vertical]?.max || 50);

        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { walletAddress: '0xDEMO_PANEL_USER' } },
        });

        const demoUser = await prisma.user.findFirst({
            where: { walletAddress: '0xDEMO_PANEL_USER' },
        });

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

        // Simulate bids arriving over 30s (fire-and-forget)
        const bidIntervals = [3000, 6000, 10000, 15000, 20000, 25000];
        let currentBid = reservePrice;

        bidIntervals.forEach((delay) => {
            setTimeout(async () => {
                try {
                    currentBid += rand(2, 10);
                    await prisma.bid.create({
                        data: {
                            leadId: lead.id,
                            buyerId: demoUser.id,
                            amount: currentBid,
                            status: 'REVEALED',
                            source: 'MANUAL',
                        },
                    });
                    await prisma.auctionRoom.update({
                        where: { leadId: lead.id },
                        data: { bidCount: { increment: 1 }, highestBid: currentBid },
                    });
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

export default router;
