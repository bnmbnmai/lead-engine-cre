/**
 * CRE Routes — Chainlink Runtime Environment API
 *
 * Exposes CRE workflow capabilities for the MCP autonomous agent.
 * Powered by official chainlink-agent-skills/cre-skills integration.
 *
 * GET  /status           — CRE workflow mode and health
 * GET  /score            — CRE quality score for a lead
 * POST /evaluate         — Trigger buyer-rules evaluation for a lead
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { creService } from '../services/cre.service';
import { getConfig } from '../lib/config';

const router = Router();

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
