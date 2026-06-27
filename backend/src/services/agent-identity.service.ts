/**
 * Agent identity service (Phase C3).
 * Per-agent tenancy: profiles, scoped API keys, reputation attestations.
 */

import crypto from 'crypto';
import { prisma } from '../lib/prisma';

const KEY_PREFIX = 'lea_';

export function hashAgentApiKey(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

export function generateAgentApiKey(): string {
    return `${KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

export async function registerAgentProfile(ownerId: string, displayName: string, walletAddress?: string) {
    return prisma.agentProfile.upsert({
        where: { ownerId },
        create: { ownerId, displayName, walletAddress },
        update: { displayName, ...(walletAddress ? { walletAddress } : {}) },
    });
}

export async function createAgentApiKey(agentId: string, label = 'default') {
    const raw = generateAgentApiKey();
    const keyHash = hashAgentApiKey(raw);
    const row = await prisma.agentApiKey.create({
        data: { agentId, label, keyHash },
    });
    return { id: row.id, rawKey: raw, label };
}

export async function verifyAgentApiKey(rawKey: string): Promise<{
    valid: boolean;
    agentId?: string;
    ownerId?: string;
    scopes?: string[];
}> {
    if (!rawKey.startsWith(KEY_PREFIX)) return { valid: false };
    const keyHash = hashAgentApiKey(rawKey);
    const row = await prisma.agentApiKey.findUnique({
        where: { keyHash },
        include: { agent: true },
    });
    if (!row || row.revokedAt) return { valid: false };

    await prisma.agentApiKey.update({
        where: { id: row.id },
        data: { lastUsed: new Date() },
    });

    return {
        valid: true,
        agentId: row.agentId,
        ownerId: row.agent.ownerId,
        scopes: row.scopes,
    };
}

export async function getLeaderboard(limit = 20) {
    return prisma.agentProfile.findMany({
        orderBy: [{ reputationScore: 'desc' }, { wins: 'desc' }],
        take: limit,
        select: {
            id: true,
            displayName: true,
            reputationScore: true,
            wins: true,
            settlements: true,
            onChainAgentId: true,
        },
    });
}
