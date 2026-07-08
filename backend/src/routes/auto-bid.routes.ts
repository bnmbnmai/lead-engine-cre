/**
 * Auto-Bid CRE Routes — Lead Engine CRE
 *
 * Read-only API endpoints consumed by the EvaluateBuyerRulesAndMatch
 * CRE workflow via Confidential HTTP from the Chainlink DON.
 *
 * Endpoints:
 *   GET /api/v1/auto-bid/preference-sets?vertical={vertical}
 *   GET /api/v1/auto-bid/pending-lead
 *
 * Authentication: x-cre-api-key header (validated against CRE_API_KEY env var)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireSharedSecret } from '../middleware/secret-auth';
import { ingestMatchResults, verifyMatchResultSignature } from '../services/cre-match-ingest.service';

const router = Router();

// ── API Key Validation Middleware ─────────────────────────────────────
// Fail-closed: in production an unset CRE_API_KEY rejects all requests.

const validateCreApiKey = requireSharedSecret({
    header: 'x-cre-api-key',
    envVars: ['CRE_API_KEY', 'CRE_API_KEY_ALL'],
    label: 'CRE API key',
});

// ── GET /preference-sets?vertical={vertical} ─────────────────────────
// Returns active buyer preference sets for a given vertical.
// Called by the CRE DON workflow via Confidential HTTP.

router.get('/preference-sets', validateCreApiKey, async (req: Request, res: Response) => {
    try {
        const vertical = (req.query.vertical as string) || '*';

        const sets = await prisma.buyerPreferenceSet.findMany({
            where: {
                vertical: { in: [vertical, '*'] },
                isActive: true,
                autoBidEnabled: true,
                autoBidAmount: { not: null },
            },
            include: {
                buyerProfile: {
                    include: {
                        user: { select: { id: true, walletAddress: true } },
                    },
                },
                fieldFilters: {
                    where: { isActive: true },
                    include: { verticalField: { select: { key: true, isBiddable: true, isPii: true } } },
                },
            },
            orderBy: { priority: 'asc' },
        });

        // Transform to the shape expected by the CRE workflow
        const response = sets.map((s) => ({
            id: s.id,
            buyerId: s.buyerProfile.userId,
            vertical: s.vertical,
            label: s.label,
            geoCountries: Array.isArray(s.geoCountries) ? s.geoCountries : [s.geoCountries || 'US'],
            geoInclude: s.geoInclude || [],
            geoExclude: s.geoExclude || [],
            minQualityScore: (s as any).minQualityScore || null,
            acceptOffSite: s.acceptOffSite,
            requireVerified: s.requireVerified,
            autoBidAmount: Number(s.autoBidAmount),
            maxBidPerLead: s.maxBidPerLead ? Number(s.maxBidPerLead) : null,
            fieldFilters: ((s as any).fieldFilters || [])
                .filter((f: any) => f.verticalField.isBiddable && !f.verticalField.isPii)
                .map((f: any) => ({
                    fieldKey: f.verticalField.key,
                    operator: f.operator,
                    value: f.value,
                })),
        }));

        res.json(response);
    } catch (error: any) {
        console.error('[CRE-ROUTE] preference-sets error:', error.message);
        res.status(500).json({ error: 'Failed to fetch preference sets' });
    }
});

// ── GET /pending-lead ─────────────────────────────────────────────────
// Returns the most recent lead pending auction, for CRE workflow evaluation.
// In production, this would be triggered by an on-chain event (lead mint).
// For simulation and cron-based polling, returns the latest pending lead.

router.get('/pending-lead', validateCreApiKey, async (_req: Request, res: Response) => {
    try {
        const lead = await prisma.lead.findFirst({
            where: { status: 'PENDING_AUCTION' },
            orderBy: { createdAt: 'desc' },
        });

        if (!lead) {
            return res.status(404).json({ error: 'No pending lead found' });
        }

        const geo = lead.geo as any;
        const response = {
            id: lead.id,
            vertical: lead.vertical,
            geo: {
                country: geo?.country || 'US',
                state: geo?.state || geo?.region,
                city: geo?.city,
                zip: geo?.zip,
            },
            source: lead.source || 'DIRECT',
            qualityScore: (lead as any).qualityScore ?? null,
            isVerified: lead.isVerified ?? false,
            reservePrice: Number(lead.reservePrice ?? 0),
            parameters: (lead as any).parameters ?? null,
        };

        res.json(response);
    } catch (error: any) {
        console.error('[CRE-ROUTE] pending-lead error:', error.message);
        res.status(500).json({ error: 'Failed to fetch pending lead' });
    }
});

// ── GET /evaluate-lead ────────────────────────────────────────────────
// Combined endpoint: returns both the pending lead AND its matching
// buyer preference sets in a single response.
//
// The CRE DON workflow calls this via a SINGLE ConfidentialHTTPClient
// sendRequest() — the SDK builds a static capability DAG at compile time
// and only supports one HTTP request per handler callback. Two sequential
// sendRequest() calls where the second URL depends on the first response
// produce a function reference the protobuf serializer cannot decode.

router.get('/evaluate-lead', validateCreApiKey, async (_req: Request, res: Response) => {
    try {
        const lead = await prisma.lead.findFirst({
            where: { status: 'PENDING_AUCTION' },
            orderBy: { createdAt: 'desc' },
        });

        if (!lead) {
            return res.json({
                lead: null,
                preferenceSets: [],
            });
        }

        const geo = lead.geo as any;
        const leadData = {
            id: lead.id,
            vertical: lead.vertical,
            geo: {
                country: geo?.country || 'US',
                state: geo?.state || geo?.region,
                city: geo?.city,
                zip: geo?.zip,
            },
            source: lead.source || 'DIRECT',
            qualityScore: (lead as any).qualityScore ?? null,
            isVerified: lead.isVerified ?? false,
            reservePrice: Number(lead.reservePrice ?? 0),
            parameters: (lead as any).parameters ?? null,
        };

        // Fetch matching preference sets for this lead's vertical
        const sets = await prisma.buyerPreferenceSet.findMany({
            where: {
                vertical: { in: [lead.vertical, '*'] },
                isActive: true,
                autoBidEnabled: true,
                autoBidAmount: { not: null },
            },
            include: {
                buyerProfile: {
                    include: {
                        user: { select: { id: true, walletAddress: true } },
                    },
                },
                fieldFilters: {
                    where: { isActive: true },
                    include: { verticalField: { select: { key: true, isBiddable: true, isPii: true } } },
                },
            },
            orderBy: { priority: 'asc' },
        });

        const preferenceSets = sets.map((s) => ({
            id: s.id,
            buyerId: s.buyerProfile.userId,
            vertical: s.vertical,
            label: s.label,
            geoCountries: Array.isArray(s.geoCountries) ? s.geoCountries : [s.geoCountries || 'US'],
            geoInclude: s.geoInclude || [],
            geoExclude: s.geoExclude || [],
            minQualityScore: (s as any).minQualityScore || null,
            acceptOffSite: s.acceptOffSite,
            requireVerified: s.requireVerified,
            autoBidAmount: Number(s.autoBidAmount),
            maxBidPerLead: s.maxBidPerLead ? Number(s.maxBidPerLead) : null,
            fieldFilters: ((s as any).fieldFilters || [])
                .filter((f: any) => f.verticalField.isBiddable && !f.verticalField.isPii)
                .map((f: any) => ({
                    fieldKey: f.verticalField.key,
                    operator: f.operator,
                    value: f.value,
                })),
        }));

        res.json({ lead: leadData, preferenceSets });
    } catch (error: any) {
        console.error('[CRE-ROUTE] evaluate-lead error:', error.message);
        res.status(500).json({ error: 'Failed to fetch evaluation data' });
    }
});

// ── POST /match-results ───────────────────────────────────────────────
// Phase B5: DON → backend feedback loop. The EvaluateBuyerRulesAndMatch
// workflow POSTs its consensus match results here.
//
// Auth layers:
//   1. x-cre-api-key shared secret (fail-closed, timing-safe) — always.
//   2. x-cre-signature HMAC-SHA256 over the canonical payload string —
//      verified whenever present, and REQUIRED when
//      CRE_INGEST_REQUIRE_SIGNATURE=true. The DON path cannot compute the
//      HMAC today because Vault DON secrets are template-substituted into
//      request headers, never exposed to workflow JS; server-side callers
//      (scripts, reconciliation jobs) must sign.
//
// Response is DETERMINISTIC ({ok, leadId}) even for duplicate deliveries:
// each DON node may POST independently, and divergent bodies would break
// consensusIdenticalAggregation on the workflow side.
//
// Idempotent: CreMatchResult UNIQUE(leadId) + FOR UPDATE SKIP LOCKED in
// the ingestion service — replays and concurrent local/DON races no-op.

const matchResultsSchema = z.object({
    leadId: z.string().min(1),
    evaluatedAt: z.string().min(1),
    results: z.array(z.object({
        preferenceSetId: z.string().min(1),
        buyerId: z.string().min(1),
        matched: z.boolean(),
        reason: z.string().optional(),
        bidAmount: z.number().optional(),
    })).max(500),
});

router.post('/match-results', validateCreApiKey, async (req: Request, res: Response) => {
    try {
        const parsed = matchResultsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid match-results payload', details: parsed.error.flatten() });
        }

        const secret = process.env.CRE_API_KEY || process.env.CRE_API_KEY_ALL || '';
        const signature = (req.headers['x-cre-signature'] as string) || '';
        const signatureRequired = process.env.CRE_INGEST_REQUIRE_SIGNATURE === 'true';
        if (signature || signatureRequired) {
            if (!secret || !verifyMatchResultSignature(parsed.data, signature, secret)) {
                return res.status(401).json({ error: 'Invalid or missing x-cre-signature' });
            }
        }

        const outcome = await ingestMatchResults({
            ...parsed.data,
            source: 'DON',
        });

        // Deterministic receipt — duplicates/races are expected (mirror vs
        // DON, node fan-out) and must yield the SAME body as the winning
        // delivery so DON-side consensus on the receipt never diverges.
        // The real outcome is logged + persisted in CreMatchResult.
        console.log(`[CRE-ROUTE] match-results for ${parsed.data.leadId}: ${outcome.reason} (${outcome.bidsPlaced} bids)`);
        res.json({ ok: true, leadId: parsed.data.leadId });
    } catch (error: any) {
        console.error('[CRE-ROUTE] match-results error:', error.message);
        res.status(500).json({ error: 'Failed to ingest match results' });
    }
});

export default router;
