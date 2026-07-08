/**
 * ingest.routes.ts — Traffic Platform / Seller Agent Lead Ingestion
 *
 * POST /api/v1/ingest/traffic-platform
 *
 * Auth: Bearer lsa_... (seller agent) or legacy x-api-key (traffic platform).
 * Fraud: TCPA proof, contact dedup, rate limits, CRE verify, quality floor.
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { creService } from '../services/cre.service';
import { privacyService } from '../services/privacy.service';
import { ingestAuthMiddleware, type IngestAuthContext } from '../middleware/ingest-auth';
import { ingestLimiter } from '../middleware/rateLimit';
import { executeSupplyValidation } from '../agents/supply/executor';
import {
    validateTcpaProof,
    extractContactHashes,
    findDuplicateContact,
    recordContactDedup,
    countSellerListings,
    passesQualityFloor,
    getMinAuctionQualityScore,
    isChttRequiredForIngest,
} from '../services/ingest-fraud.service';

const router = Router();

router.use(ingestLimiter);

const SAMPLE_PAYLOADS = [
    {
        platform: 'google_ads',
        campaignId: 'gads-solar-q1-2026',
        vertical: 'solar.residential',
        geo: { country: 'US', state: 'CA', city: 'San Diego', zip: '92101' },
        tcpaConsentAt: new Date().toISOString(),
        tcpaProof: { consentId: 'demo-consent-001', provider: 'google_lead_form' },
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
        tcpaConsentAt: new Date().toISOString(),
        tcpaProof: { consentId: 'demo-consent-002', provider: 'meta_lead_ads' },
        fields: {
            firstName: 'James', lastName: 'Rodriguez',
            email: 'j.rodriguez@example.com', phone: '(512) 555-0198',
            loanAmount: '$350,000', creditScore: 'Good (700-749)',
            propertyValue: '$450,000', refinanceGoal: 'Lower Monthly Payment',
        },
    },
];

const PII_KEYS = new Set([
    'firstName', 'lastName', 'name', 'fullName',
    'email', 'emailAddress', 'phone', 'phoneNumber', 'mobile',
    'address', 'streetAddress', 'street', 'apartment', 'unit',
    'ssn', 'socialSecurity', 'taxId',
    'dob', 'dateOfBirth', 'birthDate',
    'ip', 'ipAddress', 'userAgent',
]);

function ingestCtx(req: Request): IngestAuthContext {
    return (req as any).ingestAuth as IngestAuthContext;
}

async function resolveActiveSupplySpec(ownerId: string, supplyStrategyId?: string) {
    if (supplyStrategyId) {
        const strategy = await prisma.supplyStrategy.findFirst({
            where: { id: supplyStrategyId, ownerId },
            include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        });
        return strategy?.versions[0]?.spec ?? null;
    }
    const active = await prisma.supplyStrategy.findFirst({
        where: { ownerId, status: 'ACTIVE' },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    return active?.versions[0]?.spec ?? null;
}

router.post('/traffic-platform', ingestAuthMiddleware, async (req: Request, res: Response) => {
    try {
        const ctx = ingestCtx(req);
        const {
            platform,
            campaignId,
            vertical,
            geo,
            fields,
            tcpaConsentAt,
            tcpaProof,
            supplyStrategyId,
            reservePrice,
        } = req.body;

        if (!vertical || typeof vertical !== 'string') {
            res.status(400).json({ error: 'vertical is required (e.g. "solar.residential")' });
            return;
        }
        if (!fields || typeof fields !== 'object') {
            res.status(400).json({ error: 'fields object is required (lead form data)' });
            return;
        }

        const tcpa = validateTcpaProof({ tcpaConsentAt, tcpaProof });
        if (!tcpa.ok) {
            res.status(400).json({ error: tcpa.reason, code: 'TCPA_REQUIRED' });
            return;
        }

        const contactHashes = extractContactHashes(fields as Record<string, unknown>);
        const dup = await findDuplicateContact(contactHashes, vertical);
        if (dup.duplicate) {
            res.status(409).json({
                error: `Duplicate ${dup.hashType} rejected within dedup window`,
                code: 'DUPLICATE_CONTACT',
                existingLeadId: dup.leadId,
            });
            return;
        }

        const seller = await prisma.sellerProfile.findUnique({ where: { id: ctx.sellerProfileId } });
        if (!seller) {
            res.status(500).json({ error: 'Seller profile not found' });
            return;
        }

        const listingCounts = await countSellerListings(seller.id);
        const supplySpecRaw = await resolveActiveSupplySpec(ctx.sellerUserId, supplyStrategyId as string | undefined);
        if (supplySpecRaw) {
            const supplyCheck = executeSupplyValidation(
                supplySpecRaw,
                {
                    vertical,
                    geo,
                    fields: fields as Record<string, unknown>,
                    reservePrice: reservePrice != null ? Number(reservePrice) : undefined,
                    tcpaConsentAt,
                    tcpaProof,
                    campaignId,
                },
                { listingsToday: listingCounts.today, listingsThisHour: listingCounts.thisHour },
            );
            if (!supplyCheck.ok) {
                res.status(400).json({
                    error: supplyCheck.reason,
                    code: 'SUPPLY_SPEC_VIOLATION',
                    gate: supplyCheck.gate,
                });
                return;
            }
        }

        const piiData: Record<string, unknown> = {};
        const safeParams: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(fields)) {
            if (PII_KEYS.has(key)) piiData[key] = value;
            else safeParams[key] = value;
        }

        let encryptedData: string | null = null;
        let dataHash = '';
        if (Object.keys(piiData).length > 0) {
            const piiResult = privacyService.encryptLeadPII(piiData);
            encryptedData = JSON.stringify(piiResult.encrypted);
            dataHash = piiResult.dataHash;
        }

        const parsedReserve = reservePrice != null ? Number(reservePrice) : undefined;
        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical,
                geo: (geo || { country: 'US' }) as object,
                source: 'API' as const,
                parameters: {
                    ...safeParams,
                    _trafficPlatform: platform || 'unknown',
                    _campaignId: campaignId || null,
                    _tcpaProof: typeof tcpaProof === 'object' ? tcpaProof : { token: String(tcpaProof) },
                } as object,
                encryptedData,
                dataHash,
                tcpaConsentAt: tcpa.consentAt!,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            },
        });

        await recordContactDedup(lead.id, vertical, contactHashes);

        console.log(`[INGEST] Lead ${lead.id} from ${platform || 'unknown'} seller=${seller.id} vertical=${vertical}`);

        const verification = await creService.verifyLead(lead.id);
        if (!verification.isValid) {
            await prisma.lead.delete({ where: { id: lead.id } }).catch(() => {});
            res.status(400).json({
                error: `Lead rejected by CRE: ${verification.reason || 'quality check failed'}`,
                code: 'CRE_REJECTED',
            });
            return;
        }

        if (isChttRequiredForIngest() && verification.score == null) {
            await prisma.lead.update({
                where: { id: lead.id },
                data: { status: 'CANCELLED' },
            });
            res.status(400).json({
                error: 'CHTT fraud scoring required in production but score unavailable',
                code: 'CHTT_REQUIRED',
            });
            return;
        }

        if (!passesQualityFloor(verification.score)) {
            await prisma.lead.update({
                where: { id: lead.id },
                data: { status: 'CANCELLED' },
            });
            res.status(400).json({
                error: `Quality score ${verification.score ?? 'n/a'} below platform floor ${getMinAuctionQualityScore()}`,
                code: 'QUALITY_FLOOR',
                qualityScore: verification.score ?? null,
                minRequired: getMinAuctionQualityScore(),
            });
            return;
        }

        creService.afterLeadCreated(lead.id);

        let reserve = parsedReserve ?? 5.0;
        let auctionDuration = 60;
        if (supplySpecRaw) {
            const spec = supplySpecRaw as { reservePrice?: number; auctionDurationSec?: number };
            if (spec.reservePrice != null) reserve = parsedReserve ?? spec.reservePrice;
            if (spec.auctionDurationSec != null) auctionDuration = spec.auctionDurationSec;
        }

        let matchingAsks = await prisma.ask.findMany({
            where: { vertical, status: 'ACTIVE', sellerId: seller.id },
            orderBy: { reservePrice: 'desc' },
            take: 10,
        });

        if (matchingAsks.length === 0) {
            const autoAsk = await prisma.ask.create({
                data: {
                    sellerId: seller.id,
                    vertical,
                    geoTargets: geo?.country ? [geo.country] : ['US'],
                    reservePrice: reserve,
                    auctionDuration,
                    status: 'ACTIVE',
                },
            });
            matchingAsks = [autoAsk];
        }

        const bestMatch = matchingAsks[0];
        const endAt = new Date(Date.now() + bestMatch.auctionDuration * 1000);

        await prisma.lead.update({
            where: { id: lead.id },
            data: {
                askId: bestMatch.id,
                status: 'IN_AUCTION',
                reservePrice: bestMatch.reservePrice,
                auctionStartAt: new Date(),
                auctionEndAt: endAt,
            },
        });

        await prisma.auctionRoom.create({
            data: {
                leadId: lead.id,
                roomId: `auction_${lead.id}`,
                phase: 'BIDDING',
                biddingEndsAt: endAt,
                revealEndsAt: endAt,
            },
        });

        try {
            const { fireSellerWebhooks } = await import('../services/agent-webhook.service');
            await fireSellerWebhooks(ctx.sellerUserId, 'lead.listed', {
                leadId: lead.id,
                vertical,
                status: 'IN_AUCTION',
                qualityScore: verification.score ?? null,
                campaignId: campaignId || null,
                auctionEndAt: endAt.toISOString(),
            });
        } catch { /* non-blocking */ }

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

        await prisma.analyticsEvent.create({
            data: {
                eventType: 'lead_submitted',
                entityType: 'lead',
                entityId: lead.id,
                userId: seller.userId,
                metadata: {
                    vertical,
                    source: 'API',
                    origin: ctx.authType,
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
                auctionEndAt: endAt.toISOString(),
                matchingAsks: matchingAsks.length,
            },
            pipeline: {
                piiEncrypted: Object.keys(piiData).length > 0,
                tcpaValidated: true,
                dedupChecked: true,
                creVerified: true,
                qualityFloorPassed: true,
                buyerMatchingTriggered: true,
                auctionStarted: true,
            },
        });
    } catch (error) {
        console.error('[INGEST] Traffic platform error:', error);
        res.status(500).json({ error: 'Failed to ingest lead from traffic platform' });
    }
});

router.get('/sample-payload', (_req: Request, res: Response) => {
    const sample = SAMPLE_PAYLOADS[Math.floor(Math.random() * SAMPLE_PAYLOADS.length)];
    res.json({ payload: sample });
});

export default router;
