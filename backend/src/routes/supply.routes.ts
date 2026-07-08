/**
 * Supply Routes — /api/v1/supply (SupplySpec CRUD + lifecycle)
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { requireAgentScope, rejectSandboxKey } from '../middleware/agent-scope';
import { parseSupplySpec } from '@lead-engine/rules-engine';

const router = Router();
router.use(authMiddleware);

function userId(req: Request): string {
    return (req as any).user?.id || (req as any).user?.userId;
}

async function ownedSupply(req: Request, res: Response) {
    const strategy = await prisma.supplyStrategy.findUnique({
        where: { id: req.params.id },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!strategy || strategy.ownerId !== userId(req)) {
        res.status(404).json({ error: 'Supply strategy not found' });
        return null;
    }
    return strategy;
}

router.get('/', requireAgentScope('read'), async (req: Request, res: Response) => {
    const strategies = await prisma.supplyStrategy.findMany({
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
            spec: s.versions[0]?.spec ?? null,
            updatedAt: s.updatedAt,
        })),
    });
});

router.post('/', requireAgentScope('supply'), rejectSandboxKey, async (req: Request, res: Response) => {
    try {
        const spec = parseSupplySpec(req.body.spec);
        const strategy = await prisma.supplyStrategy.create({
            data: {
                ownerId: userId(req),
                name: spec.name,
                versions: { create: { version: 1, spec: spec as object, changelog: 'initial version' } },
            },
            include: { versions: true },
        });
        res.status(201).json({ id: strategy.id, version: 1, status: strategy.status });
    } catch (err: any) {
        res.status(400).json({ error: 'Invalid SupplySpec', details: err.message });
    }
});

router.get('/:id', requireAgentScope('read'), async (req: Request, res: Response) => {
    const strategy = await prisma.supplyStrategy.findUnique({
        where: { id: req.params.id },
        include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!strategy || strategy.ownerId !== userId(req)) {
        return res.status(404).json({ error: 'Supply strategy not found' });
    }
    res.json(strategy);
});

router.put('/:id', requireAgentScope('supply'), rejectSandboxKey, async (req: Request, res: Response) => {
    const strategy = await ownedSupply(req, res);
    if (!strategy) return;
    try {
        const spec = parseSupplySpec(req.body.spec);
        const nextVersion = strategy.currentVersion + 1;
        await prisma.$transaction([
            prisma.supplyStrategyVersion.create({
                data: {
                    strategyId: strategy.id,
                    version: nextVersion,
                    spec: spec as object,
                    changelog: typeof req.body.changelog === 'string' ? req.body.changelog.slice(0, 500) : null,
                },
            }),
            prisma.supplyStrategy.update({
                where: { id: strategy.id },
                data: { currentVersion: nextVersion, name: spec.name },
            }),
        ]);
        res.json({ id: strategy.id, version: nextVersion });
    } catch (err: any) {
        res.status(400).json({ error: 'Invalid SupplySpec', details: err.message });
    }
});

router.post('/:id/activate', requireAgentScope('supply'), rejectSandboxKey, async (req: Request, res: Response) => {
    const strategy = await ownedSupply(req, res);
    if (!strategy) return;
    await prisma.supplyStrategy.update({ where: { id: strategy.id }, data: { status: 'ACTIVE' } });
    res.json({ id: strategy.id, status: 'ACTIVE' });
});

router.post('/:id/pause', requireAgentScope('supply'), async (req: Request, res: Response) => {
    const strategy = await ownedSupply(req, res);
    if (!strategy) return;
    await prisma.supplyStrategy.update({ where: { id: strategy.id }, data: { status: 'PAUSED' } });
    res.json({ id: strategy.id, status: 'PAUSED' });
});

router.post('/:id/archive', requireAgentScope('admin'), async (req: Request, res: Response) => {
    const strategy = await ownedSupply(req, res);
    if (!strategy) return;
    await prisma.supplyStrategy.update({ where: { id: strategy.id }, data: { status: 'ARCHIVED' } });
    res.json({ id: strategy.id, status: 'ARCHIVED' });
});

export default router;
