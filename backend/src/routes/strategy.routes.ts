/**
 * Strategy Routes (Phase C1) — /api/v1/strategies
 *
 * CRUD + lifecycle for versioned agent strategies, plus the LLM-advisory
 * endpoints (draft from natural language, explain) and a deterministic
 * dry-run endpoint (the seed of the Phase C4 simulator).
 *
 * All routes require an authenticated session; strategies are tenant-scoped
 * to the owning user.
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { requireAgentScope, rejectSandboxKey } from '../middleware/agent-scope';
import { parseStrategySpec } from '@lead-engine/rules-engine';
import { executeStrategy } from '../agents/strategy/executor';

const router = Router();
router.use(authMiddleware);

function userId(req: Request): string {
    return (req as any).user?.id || (req as any).user?.userId;
}

/** Load a strategy owned by the caller or 404. */
async function ownedStrategy(req: Request, res: Response) {
    const strategy = await prisma.agentStrategy.findUnique({
        where: { id: req.params.id },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!strategy || strategy.ownerId !== userId(req)) {
        res.status(404).json({ error: 'Strategy not found' });
        return null;
    }
    return strategy;
}

// ── GET / — list my strategies ──

router.get('/', requireAgentScope('read'), async (req: Request, res: Response) => {
    const strategies = await prisma.agentStrategy.findMany({
        where: { ownerId: userId(req) },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        orderBy: { updatedAt: 'desc' },
    });
    res.json({
        strategies: strategies.map((s) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            currentVersion: s.currentVersion,
            isPublic: s.isPublic,
            forkedFromId: s.forkedFromId,
            spec: s.versions[0]?.spec ?? null,
            updatedAt: s.updatedAt,
        })),
    });
});

// ── POST / — create a strategy (spec validated) ──

router.post('/', requireAgentScope('bid'), rejectSandboxKey, async (req: Request, res: Response) => {
    try {
        const spec = parseStrategySpec(req.body.spec);
        const strategy = await prisma.agentStrategy.create({
            data: {
                ownerId: userId(req),
                name: spec.name,
                versions: { create: { version: 1, spec: spec as object, changelog: 'initial version' } },
            },
            include: { versions: true },
        });
        res.status(201).json({ id: strategy.id, version: 1, status: strategy.status });
    } catch (err: any) {
        res.status(400).json({ error: 'Invalid StrategySpec', details: err.message });
    }
});

// ── GET /marketplace — public published strategies (Phase C5) ──
// Registered before /:id so "marketplace" is not captured as an id.

router.get('/marketplace', async (_req: Request, res: Response) => {
    const strategies = await prisma.agentStrategy.findMany({
        where: { isPublic: true, status: { in: ['ACTIVE', 'PAUSED'] } },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        orderBy: { updatedAt: 'desc' },
        take: 50,
    });
    res.json({
        strategies: strategies.map((s) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            currentVersion: s.currentVersion,
            forkedFromId: s.forkedFromId,
            spec: s.versions[0]?.spec ?? null,
            updatedAt: s.updatedAt,
        })),
    });
});

// ── POST /draft — LLM advisory: natural language → StrategySpec ──
// Registered before /:id so "draft" is not captured as an id.

router.post('/draft', requireAgentScope('read'), async (req: Request, res: Response) => {
    const description = String(req.body.description || '').trim();
    if (!description) return res.status(400).json({ error: 'description is required' });
    if (description.length > 4000) return res.status(400).json({ error: 'description too long (max 4000 chars)' });
    try {
        const { draftStrategyFromText } = await import('../agents/strategy/advisor');
        const draft = await draftStrategyFromText(description);
        // Draft only — nothing is saved or activated until the user POSTs it.
        res.json({ spec: draft.spec });
    } catch (err: any) {
        res.status(502).json({ error: 'Strategy drafting failed', details: err.message });
    }
});

// ── GET /:id — fetch one (with full version history) ──

router.get('/:id', requireAgentScope('read'), async (req: Request, res: Response) => {
    const strategy = await prisma.agentStrategy.findUnique({
        where: { id: req.params.id },
        include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!strategy || strategy.ownerId !== userId(req)) {
        return res.status(404).json({ error: 'Strategy not found' });
    }
    res.json(strategy);
});

// ── PUT /:id — new immutable version ──

router.put('/:id', requireAgentScope('bid'), rejectSandboxKey, async (req: Request, res: Response) => {
    const strategy = await ownedStrategy(req, res);
    if (!strategy) return;
    try {
        const spec = parseStrategySpec(req.body.spec);
        const nextVersion = strategy.currentVersion + 1;
        await prisma.$transaction([
            prisma.agentStrategyVersion.create({
                data: {
                    strategyId: strategy.id,
                    version: nextVersion,
                    spec: spec as object,
                    changelog: typeof req.body.changelog === 'string' ? req.body.changelog.slice(0, 500) : null,
                },
            }),
            prisma.agentStrategy.update({
                where: { id: strategy.id },
                data: { currentVersion: nextVersion, name: spec.name },
            }),
        ]);
        res.json({ id: strategy.id, version: nextVersion });
    } catch (err: any) {
        res.status(400).json({ error: 'Invalid StrategySpec', details: err.message });
    }
});

// ── POST /:id/activate | /pause | /archive — lifecycle ──

router.post('/:id/activate', requireAgentScope('bid'), rejectSandboxKey, async (req: Request, res: Response) => {
    const strategy = await ownedStrategy(req, res);
    if (!strategy) return;
    await prisma.agentStrategy.update({ where: { id: strategy.id }, data: { status: 'ACTIVE' } });
    res.json({ id: strategy.id, status: 'ACTIVE' });
});

router.post('/:id/pause', requireAgentScope('bid'), async (req: Request, res: Response) => {
    const strategy = await ownedStrategy(req, res);
    if (!strategy) return;
    await prisma.agentStrategy.update({ where: { id: strategy.id }, data: { status: 'PAUSED' } });
    res.json({ id: strategy.id, status: 'PAUSED' });
});

router.post('/:id/archive', requireAgentScope('admin'), async (req: Request, res: Response) => {
    const strategy = await ownedStrategy(req, res);
    if (!strategy) return;
    await prisma.agentStrategy.update({ where: { id: strategy.id }, data: { status: 'ARCHIVED' } });
    res.json({ id: strategy.id, status: 'ARCHIVED' });
});

// ── POST /:id/publish — make strategy public (Phase C5) ──

router.post('/:id/publish', async (req: Request, res: Response) => {
    const strategy = await ownedStrategy(req, res);
    if (!strategy) return;
    await prisma.agentStrategy.update({ where: { id: strategy.id }, data: { isPublic: true } });
    res.json({ id: strategy.id, isPublic: true });
});

// ── POST /:id/fork — fork a public strategy (Phase C5) ──

router.post('/:id/fork', requireAgentScope('read'), async (req: Request, res: Response) => {
    const source = await prisma.agentStrategy.findUnique({
        where: { id: req.params.id },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!source?.isPublic || !source.versions[0]) {
        return res.status(404).json({ error: 'Public strategy not found' });
    }
    const spec = parseStrategySpec(source.versions[0].spec);
    const forked = await prisma.agentStrategy.create({
        data: {
            ownerId: userId(req),
            name: `${spec.name} (fork)`,
            forkedFromId: source.id,
            versions: {
                create: {
                    version: 1,
                    spec: source.versions[0].spec as object,
                    changelog: `forked from ${source.id}`,
                },
            },
        },
    });
    res.status(201).json({ id: forked.id, forkedFromId: source.id });
});

// ── POST /:id/explain — LLM advisory: plain-English explanation ──

router.post('/:id/explain', async (req: Request, res: Response) => {
    const strategy = await ownedStrategy(req, res);
    if (!strategy) return;
    try {
        const spec = parseStrategySpec(strategy.versions[0]?.spec);
        const { explainStrategy } = await import('../agents/strategy/advisor');
        res.json({ explanation: await explainStrategy(spec) });
    } catch (err: any) {
        res.status(502).json({ error: 'Strategy explanation failed', details: err.message });
    }
});

// ── POST /:id/dry-run — deterministic execution against a lead (no bid) ──

router.post('/:id/dry-run', async (req: Request, res: Response) => {
    const strategy = await ownedStrategy(req, res);
    if (!strategy) return;

    const leadId = String(req.body.leadId || '');
    if (!leadId) return res.status(400).json({ error: 'leadId is required' });

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    try {
        const spec = parseStrategySpec(strategy.versions[0]?.spec);
        const geo = lead.geo as any;
        const decision = executeStrategy(spec, {
            id: lead.id,
            vertical: lead.vertical,
            geo: {
                country: geo?.country || 'US',
                state: geo?.state || geo?.region,
                city: geo?.city,
                zip: geo?.zip,
            },
            source: (lead.source as string) || 'DIRECT',
            qualityScore: (lead as any).qualityScore ?? null,
            isVerified: lead.isVerified ?? false,
            reservePrice: Number(lead.reservePrice ?? 0),
            parameters: (lead as any).parameters ?? null,
        }, {
            // Dry runs use a neutral context — backtests (C4) supply real ones.
            dataFeedFloor: null,
            spentTodayUsd: 0,
            activeBidCount: 0,
        });
        res.json({ leadId, decision });
    } catch (err: any) {
        res.status(400).json({ error: 'Dry run failed', details: err.message });
    }
});

export default router;
