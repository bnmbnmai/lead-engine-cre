/**
 * Ingest authentication — lsa_ seller keys or legacy traffic-platform x-api-key.
 */

import { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import type { AuthenticatedRequest } from './auth';
import { requireSharedSecret } from './secret-auth';

const validateTrafficPlatformKey = requireSharedSecret({
    header: 'x-api-key',
    envVars: ['TRAFFIC_PLATFORM_API_KEY'],
    label: 'traffic platform API key',
});

export interface IngestAuthContext {
    sellerUserId: string;
    sellerProfileId: string;
    authType: 'lsa' | 'traffic_platform';
    keyId?: string;
    scopes?: string[];
}

export async function ingestAuthMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    if (bearer?.startsWith('lsa_')) {
        const { verifySellerAgentApiKey } = await import('../services/agent-identity.service');
        const key = await verifySellerAgentApiKey(bearer);
        if (!key.valid || !key.ownerId) {
            res.status(401).json({ error: 'Invalid or revoked seller agent API key' });
            return;
        }
        const seller = await prisma.sellerProfile.findUnique({ where: { userId: key.ownerId } });
        if (!seller) {
            res.status(403).json({ error: 'Seller profile required — register at /api/v1/seller-agent/register' });
            return;
        }
        const user = await prisma.user.findUnique({ where: { id: key.ownerId } });
        if (!user) {
            res.status(401).json({ error: 'Seller owner account not found' });
            return;
        }
        req.user = { id: user.id, walletAddress: user.walletAddress, role: user.role };
        req.agentAuth = {
            keyId: key.keyId!,
            scopes: key.scopes ?? ['read', 'supply'],
            sandboxOnly: key.sandboxOnly ?? false,
        };
        (req as any).ingestAuth = {
            sellerUserId: seller.userId,
            sellerProfileId: seller.id,
            authType: 'lsa',
            keyId: key.keyId,
            scopes: key.scopes,
        } satisfies IngestAuthContext;
        next();
        return;
    }

    // Legacy traffic-platform shared secret path
    await validateTrafficPlatformKey(req, res, async () => {
        const apiKey = req.headers['x-api-key'] as string | undefined;
        if (!apiKey) {
            res.status(401).json({
                error: 'Missing authentication',
                hint: 'Use Authorization: Bearer lsa_... or x-api-key for traffic platform ingest.',
            });
            return;
        }

        let seller = await prisma.sellerProfile.findFirst({
            where: { companyName: 'Traffic Platform Seller' },
        });
        if (!seller) {
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
                    verticals: [],
                },
            });
        }

        (req as any).ingestAuth = {
            sellerUserId: seller.userId,
            sellerProfileId: seller.id,
            authType: 'traffic_platform',
        } satisfies IngestAuthContext;
        next();
    });
}
