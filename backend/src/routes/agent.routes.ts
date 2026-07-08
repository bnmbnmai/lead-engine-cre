/**
 * Agent Routes (Phase C2–C6) — /api/v1/agent
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireAgentScope, rejectSandboxKey } from '../middleware/agent-scope';
import { prisma } from '../lib/prisma';
import {
    registerAgentProfile,
    createAgentApiKey,
    getLeaderboard,
} from '../services/agent-identity.service';
import { listDecisionTraces } from '../services/agent-trace.service';
import { enqueueAgentPipeline } from '../agents/orchestrator/queue';
import { simulateStrategy } from '../agents/simulator/replay';

const router = Router();

function userId(req: Request): string {
    return (req as any).user?.id || (req as any).user?.userId;
}

// ── POST /register — create agent profile ──
router.post('/register', authMiddleware, requireAgentScope('admin'), async (req: Request, res: Response) => {
    const displayName = String(req.body.displayName || 'My Agent').slice(0, 80);
    const profile = await registerAgentProfile(userId(req), displayName, req.body.walletAddress as string | undefined);
    res.status(201).json(profile);
});

// ── POST /api-keys — mint scoped key (shown once) ──
router.post('/api-keys', authMiddleware, requireAgentScope('admin'), async (req: Request, res: Response) => {
    const profile = await prisma.agentProfile.findUnique({ where: { ownerId: userId(req) } });
    if (!profile) return res.status(404).json({ error: 'Register an agent profile first' });
    const sandboxOnly = Boolean(req.body.sandbox);
    const key = await createAgentApiKey(profile.id, String(req.body.label || 'default'), {
        sandboxOnly,
        scopes: req.body.scopes as string[] | undefined,
    });
    res.status(201).json({
        id: key.id,
        label: key.label,
        scopes: key.scopes,
        sandboxOnly: key.sandboxOnly,
        apiKey: key.rawKey,
        warning: 'Store this key now — it cannot be retrieved again.',
    });
});

// ── GET /me — agent profile + active strategies ──
router.get('/me', authMiddleware, requireAgentScope('read'), async (req: Request, res: Response) => {
    const uid = userId(req);
    const [profile, strategies, traces] = await Promise.all([
        prisma.agentProfile.findUnique({ where: { ownerId: uid } }),
        prisma.agentStrategy.findMany({
            where: { ownerId: uid },
            orderBy: { updatedAt: 'desc' },
            take: 20,
        }),
        listDecisionTraces({ ownerId: uid, limit: 10 }),
    ]);
    res.json({ profile, strategies, recentTraces: traces });
});

// ── GET /traces — decision trace feed ──
router.get('/traces', authMiddleware, requireAgentScope('read'), async (req: Request, res: Response) => {
    const traces = await listDecisionTraces({
        ownerId: userId(req),
        leadId: req.query.leadId as string | undefined,
        limit: Number(req.query.limit) || 50,
    });
    res.json({ traces });
});

// ── GET /leaderboard — reputation leaderboard ──
router.get('/leaderboard', async (_req: Request, res: Response) => {
    res.json({ leaderboard: await getLeaderboard(25) });
});

// ── GET /metadata/:profileId — public agent card JSON (on-chain URI target) ──
router.get('/metadata/:profileId', async (req: Request, res: Response) => {
    const profile = await prisma.agentProfile.findUnique({
        where: { id: req.params.profileId },
        select: {
            id: true,
            displayName: true,
            reputationScore: true,
            wins: true,
            settlements: true,
            onChainAgentId: true,
            createdAt: true,
        },
    });
    if (!profile) return res.status(404).json({ error: 'Agent not found' });

    const baseUrl = process.env.API_URL || process.env.PUBLIC_API_URL || 'https://api.leadrtb.com';
    res.json({
        name: 'AgentRTB Buyer Agent',
        displayName: profile.displayName,
        profileId: profile.id,
        onChainAgentId: profile.onChainAgentId,
        reputation: {
            score: profile.reputationScore,
            wins: profile.wins,
            settlements: profile.settlements,
            winRate: profile.settlements > 0 ? Math.round((profile.wins / profile.settlements) * 100) : null,
        },
        integration: {
            openapi: `${baseUrl}/api/swagger`,
            wellKnown: `${baseUrl}/.well-known/agent.json`,
            sdkPackage: '@lead-engine/agent-sdk',
        },
    });
});

// ── POST /pipeline/:leadId — enqueue orchestration pipeline ──
router.post(
    '/pipeline/:leadId',
    authMiddleware,
    requireAgentScope('bid'),
    rejectSandboxKey,
    async (req: Request, res: Response) => {
        const leadId = req.params.leadId;
        await enqueueAgentPipeline({ leadId, ownerId: userId(req), trigger: 'api' });
        res.json({ ok: true, leadId, message: 'Pipeline enqueued' });
    },
);

// ── POST /simulate — backtest a strategy (Phase C4) ──
router.post('/simulate', authMiddleware, requireAgentScope('read', 'simulate'), async (req: Request, res: Response) => {
    const strategyId = String(req.body.strategyId || '');
    if (!strategyId) return res.status(400).json({ error: 'strategyId required' });
    try {
        const report = await simulateStrategy({
            strategyId,
            ownerId: userId(req),
            days: Number(req.body.days) || 30,
            limit: Number(req.body.limit) || 100,
        });
        res.json(report);
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

// ── Agent integration webhooks ──
router.post('/webhooks', authMiddleware, requireAgentScope('admin'), async (req: Request, res: Response) => {
    const url = String(req.body.url || '');
    const events = (req.body.events as string[] | undefined) ?? ['strategy.decision', 'bid.placed', 'auction.won', 'lead.matched'];
    const { registerAgentWebhook, isWebhookUrlAllowed } = await import('../services/agent-webhook.service');
    if (!isWebhookUrlAllowed(url)) {
        return res.status(400).json({ error: 'Invalid webhook URL — HTTPS required; private hosts blocked' });
    }
    const allowed = ['strategy.decision', 'bid.placed', 'auction.won', 'lead.matched'];
    const filtered = events.filter((e) => allowed.includes(e));
    if (filtered.length === 0) return res.status(400).json({ error: 'No valid events' });
    const hook = await registerAgentWebhook(userId(req), url, filtered as any);
    res.status(201).json({
        webhook: {
            id: hook.id,
            url: hook.url,
            events: hook.events,
            secret: hook.secret,
            warning: 'Store webhook secret now — used to verify X-AgentRTB-Signature',
        },
    });
});

router.get('/webhooks', authMiddleware, requireAgentScope('read'), async (req: Request, res: Response) => {
    const { listAgentWebhooks } = await import('../services/agent-webhook.service');
    res.json({ webhooks: await listAgentWebhooks(userId(req)) });
});

router.get('/webhooks/:id/deliveries', authMiddleware, requireAgentScope('read'), async (req: Request, res: Response) => {
    const { listWebhookDeliveries } = await import('../services/agent-webhook.service');
    const deliveries = await listWebhookDeliveries(userId(req), req.params.id, Number(req.query.limit) || 50);
    if (!deliveries) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ deliveries });
});

router.delete('/webhooks/:id', authMiddleware, requireAgentScope('admin'), async (req: Request, res: Response) => {
    const { deleteAgentWebhook } = await import('../services/agent-webhook.service');
    const ok = await deleteAgentWebhook(userId(req), req.params.id);
    if (!ok) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ ok: true });
});

export default router;
