/**
 * CRE Routes — Chainlink Runtime Environment API
 *
 * Exposes CRE workflow capabilities for the MCP autonomous agent.
 * Powered by official chainlink-agent-skills/cre-skills integration.
 *
 * GET  /status           — CRE workflow mode and health
 * GET  /score            — CRE quality score for a lead
 * POST /evaluate         — Trigger buyer-rules evaluation for a lead
 * POST /decrypt-request  — Winner enqueues a PII decryption request (B4)
 * GET  /decrypt-pending  — DecryptForWinner DON workflow polls the queue (B4)
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';
import { creService } from '../services/cre.service';
import { getConfig } from '../lib/config';
import { apiKeyMiddleware } from '../middleware/auth';
import { requireSharedSecret } from '../middleware/secret-auth';
import { privacyService } from '../services/privacy.service';

const router = Router();

// DON-facing shared-secret auth (same scheme as /auto-bid/evaluate-lead).
const validateCreApiKey = requireSharedSecret({
    header: 'x-cre-api-key',
    envVars: ['CRE_API_KEY', 'CRE_API_KEY_ALL'],
    label: 'CRE API key',
});

// ── GET /decrypt-pending — DecryptForWinner DON poll (Phase B4) ──
// Registered BEFORE the user apiKeyMiddleware: the DON authenticates with
// the x-cre-api-key shared secret (Vault DON secret), not a user session.
//
// Pops the oldest PENDING decrypt request, RE-VERIFIES the winner at
// delivery time, decrypts the PII (envelope encryption) and returns it over
// the Confidential HTTP channel. The request row records dataHash as an
// audit trail. Only ONE request is served per poll (single sendRequest
// constraint of the CRE SDK).
router.get('/decrypt-pending', validateCreApiKey, async (_req: Request, res: Response) => {
    try {
        const pending = await prisma.decryptRequest.findFirst({
            where: { status: 'PENDING' },
            orderBy: { requestedAt: 'asc' },
        });
        if (!pending) {
            return res.json({ request: null });
        }

        // Winner re-verification at delivery time (defense in depth — the
        // enqueue endpoint already verified, but state may have changed).
        const [settledTx, acceptedBid, lead] = await Promise.all([
            prisma.transaction.findFirst({
                where: { leadId: pending.leadId, buyerId: pending.winnerId, status: { in: ['PENDING', 'CONFIRMED', 'ESCROWED', 'RELEASED'] } },
            }),
            prisma.bid.findFirst({
                where: { leadId: pending.leadId, buyerId: pending.winnerId, status: 'ACCEPTED' },
            }),
            prisma.lead.findUnique({ where: { id: pending.leadId } }),
        ]);

        const isWinner = !!(settledTx || acceptedBid);
        if (!isWinner || !lead || !lead.encryptedData) {
            const failReason = !isWinner
                ? 'winner verification failed at delivery'
                : !lead ? 'lead not found' : 'lead has no encrypted PII';
            await prisma.decryptRequest.update({
                where: { id: pending.id },
                data: { status: 'DENIED', failReason },
            });
            console.warn(`[CRE] decrypt-pending: DENIED request ${pending.id} (${failReason})`);
            // Serve nothing this poll — the next poll picks up the next request
            return res.json({ request: null });
        }

        // Decrypt PII (per-lead DEK unwrapped under the master KEK)
        let pii: Record<string, unknown>;
        try {
            const parsed = typeof lead.encryptedData === 'string'
                ? JSON.parse(lead.encryptedData)
                : lead.encryptedData;
            pii = privacyService.decryptLeadPII(parsed as any);
        } catch (decryptErr: any) {
            await prisma.decryptRequest.update({
                where: { id: pending.id },
                data: { status: 'DENIED', failReason: `decryption failed: ${decryptErr.message?.slice(0, 120)}` },
            });
            return res.json({ request: null });
        }

        const dataHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(pii)));
        await prisma.decryptRequest.update({
            where: { id: pending.id },
            data: { status: 'DELIVERED', deliveredAt: new Date(), dataHash },
        });

        console.log(`[CRE] decrypt-pending: DELIVERED request ${pending.id} (lead ${pending.leadId} → winner ${pending.winnerId})`);
        return res.json({
            request: {
                requestId: pending.id,
                leadId: pending.leadId,
                winnerId: pending.winnerId,
                dataHash,
                pii,
            },
        });
    } catch (error) {
        console.error('[CRE] decrypt-pending error:', error);
        return res.status(500).json({ error: 'Failed to serve decrypt queue' });
    }
});

// All remaining CRE routes require authentication (API key or JWT session).
// /score exposes lead scoring data; /evaluate triggers DON workflow compute.
router.use(apiKeyMiddleware);

// ── POST /decrypt-request — Winner enqueues PII decryption (Phase B4) ──
// The caller must be the verified auction winner for the lead. The request
// is served to the DecryptForWinner CRE workflow on its next poll.
router.post('/decrypt-request', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Authenticated user session required' });
        }
        const { leadId } = req.body || {};
        if (!leadId) {
            return res.status(400).json({ error: 'leadId is required' });
        }

        const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // Winner verification (same policy as decrypt-pii): a transaction or
        // ACCEPTED bid owned by the caller.
        const [tx, acceptedBid] = await Promise.all([
            prisma.transaction.findFirst({ where: { leadId, buyerId: userId } }),
            prisma.bid.findFirst({ where: { leadId, buyerId: userId, status: 'ACCEPTED' } }),
        ]);
        if (!tx && !acceptedBid) {
            return res.status(403).json({ error: 'Only the auction winner can request PII decryption' });
        }

        const request = await prisma.decryptRequest.upsert({
            where: { leadId_winnerId: { leadId, winnerId: userId } },
            create: { leadId, winnerId: userId },
            // Re-requesting after a denial/expiry re-queues it
            update: { status: 'PENDING', failReason: null },
        });

        return res.json({
            requestId: request.id,
            leadId,
            status: request.status,
            workflow: 'DecryptForWinner',
            note: 'The CRE DON serves this request on its next poll; PII is delivered via Confidential HTTP (encryptOutput).',
        });
    } catch (error) {
        console.error('[CRE] decrypt-request error:', error);
        return res.status(500).json({ error: 'Failed to enqueue decrypt request' });
    }
});

// ── GET /status — CRE workflow mode and capabilities ──

router.get('/status', async (_req: Request, res: Response) => {
    try {
        const creWorkflowEnabled = process.env.CRE_WORKFLOW_ENABLED === 'true';
        const creNativeMode = await getConfig('creNativeDemoMode', 'false').catch(() => 'false');

        res.json({
            creNativeMode: creNativeMode === 'true',
            creWorkflowEnabled,
            subscriptionId: process.env.CRE_SUBSCRIPTION_ID || '581',
            network: 'Base Sepolia (chain ID 84532)',
            capabilities: {
                qualityScoring: true,
                buyerRulesEvaluation: creWorkflowEnabled,
                winnerDecryption: true,
                confidentialHTTP: true,
            },
            contracts: {
                CREVerifier: '0xfec22A5159E077d7016AAb5fC3E91e0124393af8',
                BountyMatcher: '0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D',
            },
            workflows: [
                'EvaluateBuyerRulesAndMatch — 7-gate buyer rule evaluation via CRE DON',
                'DecryptForWinner — Winner-only PII decryption with encryptOutput: true',
            ],
            skillsSource: 'smartcontractkit/chainlink-agent-skills/cre-skills',
        });
    } catch (error) {
        console.error('[CRE] Status error:', error);
        res.status(500).json({ error: 'Failed to get CRE status' });
    }
});

// ── GET /score — CRE quality score for a specific lead ──

router.get('/score', async (req: Request, res: Response) => {
    try {
        const leadId = req.query.leadId as string;
        if (!leadId) {
            res.status(400).json({ error: 'leadId query parameter is required' });
            return;
        }

        const lead = await prisma.lead.findUnique({
            where: { id: leadId },
            select: {
                id: true,
                qualityScore: true,
                isVerified: true,
                vertical: true,
                geo: true,
                source: true,
                createdAt: true,
            },
        });
        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }

        res.json({
            leadId: lead.id,
            qualityScore: lead.qualityScore,
            qualityScoreNormalized: lead.qualityScore != null ? Math.floor(Number(lead.qualityScore) / 100) : null,
            isVerified: lead.isVerified,
            vertical: lead.vertical,
            geo: lead.geo,
            source: lead.source,
            scoringMethod: 'CREVerifier via Chainlink Functions DON',
            contract: '0xfec22A5159E077d7016AAb5fC3E91e0124393af8',
            timestamp: lead.createdAt,
        });
    } catch (error) {
        console.error('[CRE] Score error:', error);
        res.status(500).json({ error: 'Failed to get CRE score' });
    }
});

// ── POST /evaluate — Trigger CRE buyer-rules workflow for a lead ──

router.post('/evaluate', async (req: Request, res: Response) => {
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

        // Trigger the CRE buyer-rules workflow
        const result = await creService.verifyLead(leadId);

        res.json({
            leadId,
            evaluation: result,
            qualityScore: lead.qualityScore,
            isVerified: lead.isVerified,
            workflow: 'EvaluateBuyerRulesAndMatch',
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[CRE] Evaluation error:', error);
        res.status(500).json({ error: 'Failed to run CRE evaluation' });
    }
});

export default router;
