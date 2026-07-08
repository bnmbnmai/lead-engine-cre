/**
 * Seller Agent Routes — /api/v1/seller-agent
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireAgentScope, rejectSandboxKey } from '../middleware/agent-scope';
import { prisma } from '../lib/prisma';
import {
    registerSellerAgentProfile,
    createSellerAgentApiKey,
    getSellerLeaderboard,
} from '../services/agent-identity.service';

const router = Router();

function userId(req: Request): string {
    return (req as any).user?.id || (req as any).user?.userId;
}

router.post('/register', authMiddleware, requireAgentScope('admin'), async (req: Request, res: Response) => {
    const displayName = String(req.body.displayName || 'My Seller Agent').slice(0, 80);
    const profile = await registerSellerAgentProfile(userId(req), displayName, req.body.walletAddress as string | undefined);
    res.status(201).json(profile);
});

router.post('/api-keys', authMiddleware, requireAgentScope('admin'), async (req: Request, res: Response) => {
    const profile = await prisma.agentProfile.findUnique({ where: { ownerId: userId(req) } });
    if (!profile || (profile.role !== 'SELLER' && profile.role !== 'BOTH')) {
        return res.status(404).json({ error: 'Register a seller agent profile first' });
    }
    const sandboxOnly = Boolean(req.body.sandbox);
    const key = await createSellerAgentApiKey(profile.id, String(req.body.label || 'default'), {
        sandboxOnly,
        scopes: req.body.scopes as string[] | undefined,
    });
    res.status(201).json({
        id: key.id,
        label: key.label,
        scopes: key.scopes,
        sandboxOnly: key.sandboxOnly,
        apiKey: key.rawKey,
        warning: 'Store this lsa_ key now — it cannot be retrieved again.',
    });
});

router.get('/me', authMiddleware, requireAgentScope('read'), async (req: Request, res: Response) => {
    const uid = userId(req);
    const [profile, supplyStrategies, sellerProfile] = await Promise.all([
        prisma.agentProfile.findUnique({ where: { ownerId: uid } }),
        prisma.supplyStrategy.findMany({
            where: { ownerId: uid },
            orderBy: { updatedAt: 'desc' },
            take: 20,
        }),
        prisma.sellerProfile.findUnique({ where: { userId: uid } }),
    ]);
    res.json({ profile, supplyStrategies, sellerProfile });
});

router.get('/leaderboard', async (_req: Request, res: Response) => {
    res.json({ leaderboard: await getSellerLeaderboard(25) });
});

router.get('/metadata/:profileId', async (req: Request, res: Response) => {
    const profile = await prisma.agentProfile.findUnique({
        where: { id: req.params.profileId },
        select: {
            id: true,
            ownerId: true,
            displayName: true,
            role: true,
            createdAt: true,
        },
    });
    if (!profile || (profile.role !== 'SELLER' && profile.role !== 'BOTH')) {
        return res.status(404).json({ error: 'Seller agent not found' });
    }
    const seller = await prisma.sellerProfile.findUnique({ where: { userId: profile.ownerId } });
    const baseUrl = process.env.API_URL || process.env.PUBLIC_API_URL || 'https://api.leadrtb.com';
    res.json({
        name: 'AgentRTB Seller Agent',
        displayName: profile.displayName,
        profileId: profile.id,
        sellerProfileId: seller?.id,
        integration: {
            ingest: `${baseUrl}/api/v1/ingest/traffic-platform`,
            supply: `${baseUrl}/api/v1/supply`,
            openapi: `${baseUrl}/api/swagger`,
            wellKnown: `${baseUrl}/.well-known/agent.json`,
        },
    });
});

router.post('/webhooks', authMiddleware, requireAgentScope('admin'), async (req: Request, res: Response) => {
    const url = String(req.body.url || '');
    const events = (req.body.events as string[] | undefined) ?? ['lead.listed', 'auction.closed', 'settlement.paid'];
    const { registerSellerWebhook, isWebhookUrlAllowed } = await import('../services/agent-webhook.service');
    if (!isWebhookUrlAllowed(url)) {
        return res.status(400).json({ error: 'Invalid webhook URL — HTTPS required; private hosts blocked' });
    }
    const allowed = ['lead.listed', 'auction.closed', 'settlement.paid'];
    const filtered = events.filter((e) => allowed.includes(e));
    if (filtered.length === 0) return res.status(400).json({ error: 'No valid events' });
    const hook = await registerSellerWebhook(userId(req), url, filtered as any);
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
    const { listSellerWebhooks } = await import('../services/agent-webhook.service');
    res.json({ webhooks: await listSellerWebhooks(userId(req)) });
});

router.delete('/webhooks/:id', authMiddleware, requireAgentScope('admin'), async (req: Request, res: Response) => {
    const { deleteSellerWebhook } = await import('../services/agent-webhook.service');
    const ok = await deleteSellerWebhook(userId(req), req.params.id);
    if (!ok) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ ok: true });
});

export default router;
