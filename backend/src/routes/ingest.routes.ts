/**
 * ingest.routes.ts — Traffic Platform Lead Ingestion
 *
 * Simulates a production webhook endpoint for traffic platforms
 * (Google Ads, Facebook Lead Ads, TikTok Lead Gen, The Trade Desk).
 *
 * POST /api/v1/ingest/traffic-platform
 *
 * Accepts a lead payload, encrypts PII server-side, runs CRE
 * pre-auction verification, fires afterLeadCreated() for buyer
 * matching, and starts a real auction.
 *
 * Authentication: API key via x-api-key header (simulates
 * platform-to-platform secret; any truthy value accepted in dev).
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { creService } from '../services/cre.service';
import { privacyService } from '../services/privacy.service';

const router = Router();

// ── Sample payloads used by the frontend "Simulate Traffic Lead" button ──
const SAMPLE_PAYLOADS = [
    {
        platform: 'google_ads',
        campaignId: 'gads-solar-q1-2026',
        vertical: 'solar.residential',
        geo: { country: 'US', state: 'CA', city: 'San Diego', zip: '92101' },
        fields: {
            firstName: 'Sarah', lastName: 'Chen',
            email: 'sarah.chen@example.com', phone: '(619) 555-0142',
            ownOrRent: 'Own', roofAge: '5-10 years', electricBill: '$200-300',
            propertyType: 'Single Family', urgency: 'Within 3 Months',
        },
    },
    {
        platform: 'facebook_lead_ads',
        campaignId: 'fb-mortgage-refi-spring',
        vertical: 'mortgage.refinance',
        geo: { country: 'US', state: 'TX', city: 'Austin', zip: '78701' },
        fields: {
            firstName: 'James', lastName: 'Rodriguez',
            email: 'j.rodriguez@example.com', phone: '(512) 555-0198',
            loanAmount: '$350,000', creditScore: 'Good (700-749)',
            propertyValue: '$450,000', refinanceGoal: 'Lower Monthly Payment',
        },
    },
    {
        platform: 'tiktok_lead_gen',
        campaignId: 'tt-insurance-auto-q1',
        vertical: 'insurance.auto',
        geo: { country: 'US', state: 'FL', city: 'Miami', zip: '33101' },
        fields: {
            firstName: 'Maria', lastName: 'Santos',
            email: 'm.santos@example.com', phone: '(305) 555-0177',
            vehicleYear: '2023', vehicleMake: 'Tesla', vehicleModel: 'Model 3',
            currentInsurer: 'State Farm', drivingRecord: 'Clean',
        },
    },
    {
        platform: 'the_trade_desk',
        campaignId: 'ttd-roofing-storm-season',
        vertical: 'roofing.residential',
        geo: { country: 'US', state: 'CO', city: 'Denver', zip: '80202' },
        fields: {
            firstName: 'Mike', lastName: 'Johnson',
            email: 'mike.j@example.com', phone: '(720) 555-0133',
            roofType: 'Asphalt Shingle', damageType: 'Storm/Hail',
            propertyType: 'Single Family', urgency: 'Urgent',
            ownOrRent: 'Own',
        },
    },
];

// ── PII keys to encrypt ─────────────────────────────────────────────────
const PII_KEYS = new Set([
    'firstName', 'lastName', 'name', 'fullName',
    'email', 'emailAddress', 'phone', 'phoneNumber', 'mobile',
    'address', 'streetAddress', 'street', 'apartment', 'unit',
    'ssn', 'socialSecurity', 'taxId',
    'dob', 'dateOfBirth', 'birthDate',
    'ip', 'ipAddress', 'userAgent',
]);

// ============================================
// POST /traffic-platform — Ingest lead from ad platform webhook
// ============================================

router.post('/traffic-platform', async (req: Request, res: Response) => {
    try {
        // API key guard (any truthy value in dev; production would validate against vault)
        const apiKey = req.headers['x-api-key'] as string | undefined;
        if (!apiKey) {
            res.status(401).json({
                error: 'Missing x-api-key header',
                hint: 'Traffic platform webhooks must include an API key.',
            });
            return;
        }

        const { platform, campaignId, vertical, geo, fields } = req.body;

        // Validate required fields
        if (!vertical || typeof vertical !== 'string') {
            res.status(400).json({ error: 'vertical is required (e.g. "solar.residential")' });
            return;
        }
        if (!fields || typeof fields !== 'object') {
            res.status(400).json({ error: 'fields object is required (lead form data)' });
            return;
        }

        // Resolve or auto-create a demo seller for ingested leads
        let seller = await prisma.sellerProfile.findFirst({
            where: { companyName: 'Traffic Platform Seller' },
        });
        if (!seller) {
            // Find or create a user for the traffic platform seller
            let user = await prisma.user.findFirst({
                where: { walletAddress: '0x0000000000000000000000000000000000000000' },
            });
            if (!user) {
                user = await prisma.user.create({
                    data: {
                        walletAddress: '0x0000000000000000000000000000000000000000',
                        role: 'SELLER',
                    },
                });
            }
            seller = await prisma.sellerProfile.create({
                data: {
                    userId: user.id,
                    companyName: 'Traffic Platform Seller',
                    verticals: [vertical],
                },
            });
        }

        // Separate PII from safe parameters
        const piiData: Record<string, any> = {};
        const safeParams: Record<string, any> = {};

        for (const [key, value] of Object.entries(fields)) {
            if (PII_KEYS.has(key)) {
                piiData[key] = value;
            } else {
                safeParams[key] = value;
            }
        }

        // Encrypt PII
        let encryptedData: any = null;
        let dataHash = '';
        if (Object.keys(piiData).length > 0) {
            const piiResult = privacyService.encryptLeadPII(piiData);
            encryptedData = JSON.stringify(piiResult.encrypted);
            dataHash = piiResult.dataHash;
        }

        // Create the lead
        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical,
                geo: (geo || { country: 'US' }) as any,
                source: 'API' as any,
                parameters: {
                    ...safeParams,
                    _trafficPlatform: platform || 'unknown',
                    _campaignId: campaignId || null,
                } as any,
                encryptedData: encryptedData as any,
                dataHash,
                tcpaConsentAt: new Date(),
                expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min
            },
        });

        console.log(`[INGEST] Traffic lead ${lead.id} from ${platform || 'unknown'} (campaign: ${campaignId || 'n/a'}) — vertical: ${vertical}`);

        // CRE Pre-Auction Gate
        const verification = await creService.verifyLead(lead.id);
        if (!verification.isValid) {
            await prisma.lead.delete({ where: { id: lead.id } }).catch(() => { });
            res.status(400).json({
                error: `Lead rejected by CRE: ${verification.reason || 'quality check failed'}`,
            });
            return;
        }

        // Fire CRE buyer-rules evaluation (fire-and-forget)
        creService.afterLeadCreated(lead.id);

        // Find matching asks and start auction
        let matchingAsks = await prisma.ask.findMany({
            where: { vertical, status: 'ACTIVE' },
            orderBy: { reservePrice: 'desc' },
            take: 10,
        });

        // Auto-create ask if none exist
        if (matchingAsks.length === 0) {
            const autoAsk = await prisma.ask.create({
                data: {
                    sellerId: seller.id,
                    vertical,
                    geoTargets: geo?.country ? [geo.country] : ['US'],
                    reservePrice: 5.0,
                    auctionDuration: 60,
                    status: 'ACTIVE',
                },
            });
            matchingAsks = [autoAsk];
        }

        // Start auction
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

        await prisma.auctionRoom.create({
            data: {
                leadId: lead.id,
                roomId: `auction_${lead.id}`,
                phase: 'BIDDING',
                biddingEndsAt: new Date(Date.now() + bestMatch.auctionDuration * 1000),
                revealEndsAt: new Date(Date.now() + bestMatch.auctionDuration * 1000),
            },
        });

        // Emit real-time event
        const io = req.app.get('io');
        if (io) {
            io.emit('marketplace:lead:new', {
                lead: {
                    id: lead.id,
                    vertical: lead.vertical,
                    status: 'IN_AUCTION',
                    reservePrice: Number(bestMatch.reservePrice),
                    geo,
                    isVerified: verification.isValid,
                    sellerId: seller.id,
                    parameters: safeParams,
                    qualityScore: verification.score ?? null,
                    _count: { bids: 0 },
                    _trafficPlatform: platform,
                },
            });
        }

        // Log analytics
        await prisma.analyticsEvent.create({
            data: {
                eventType: 'lead_submitted',
                entityType: 'lead',
                entityId: lead.id,
                userId: seller.userId,
                metadata: {
                    vertical,
                    source: 'API',
                    origin: 'traffic_platform',
                    platform: platform || 'unknown',
                    campaignId: campaignId || null,
                },
            },
        });

        res.status(201).json({
            success: true,
            lead: {
                id: lead.id,
                vertical: lead.vertical,
                status: 'IN_AUCTION',
                qualityScore: verification.score ?? null,
                platform: platform || 'unknown',
                campaignId: campaignId || null,
                auctionEndAt: new Date(Date.now() + bestMatch.auctionDuration * 1000).toISOString(),
                matchingAsks: matchingAsks.length,
            },
            pipeline: {
                piiEncrypted: Object.keys(piiData).length > 0,
                creVerified: true,
                buyerMatchingTriggered: true,
                auctionStarted: true,
            },
        });
    } catch (error) {
        console.error('[INGEST] Traffic platform error:', error);
        res.status(500).json({ error: 'Failed to ingest lead from traffic platform' });
    }
});

// ============================================
// GET /sample-payload — Return a random sample payload for the UI button
// ============================================

router.get('/sample-payload', (_req: Request, res: Response) => {
    const sample = SAMPLE_PAYLOADS[Math.floor(Math.random() * SAMPLE_PAYLOADS.length)];
    res.json({ payload: sample });
});

export default router;
