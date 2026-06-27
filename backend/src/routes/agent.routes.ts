/**
 * Agent Routes (Phase C2–C6) — /api/v1/agent
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { parseStrategySpec } from '@lead-engine/rules-engine';
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
router.post('/register', authMiddleware, async (req: Request, res: Response) => {
    const displayName = String(req.body.displayName || 'My Agent').slice(0, 80);
    const profile = await registerAgentProfile(userId(req), displayName, req.body.walletAddress as string | undefined);
    res.status(201).json(profile);
});

// ── POST /api-keys — mint scoped key (shown once) ──
router.post('/api-keys', authMiddleware, async (req: Request, res: Response) => {
    const profile = await prisma.agentProfile.findUnique({ where: { ownerId: userId(req) } });
    if (!profile) return res.status(404).json({ error: 'Register an agent profile first' });
    const key = await createAgentApiKey(profile.id, String(req.body.label || 'default'));
    res.status(201).json({
        id: key.id,
        label: key.label,
        apiKey: key.rawKey,
        warning: 'Store this key now — it cannot be retrieved again.',
    });
});

// ── GET /me — agent profile + active strategies ──
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
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
router.get('/traces', authMiddleware, async (req: Request, res: Response) => {
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

// ── POST /pipeline/:leadId — enqueue orchestration pipeline ──
router.post('/pipeline/:leadId', authMiddleware, async (req: Request, res: Response) => {
    const leadId = req.params.leadId;
    await enqueueAgentPipeline({ leadId, ownerId: userId(req), trigger: 'api' });
    res.json({ ok: true, leadId, message: 'Pipeline enqueued' });
});

// ── POST /simulate — backtest a strategy (Phase C4) ──
router.post('/simulate', authMiddleware, async (req: Request, res: Response) => {
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

export default router;
