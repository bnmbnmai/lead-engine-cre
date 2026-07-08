/**
 * Agent identity service (Phase C3).
 * Per-agent tenancy: profiles, scoped API keys, reputation attestations.
 */

import crypto from 'crypto';
import { prisma } from '../lib/prisma';

const KEY_PREFIX = 'lea_';
const SELLER_KEY_PREFIX = 'lsa_';

export function hashAgentApiKey(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

export function generateAgentApiKey(): string {
    return `${KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

export async function registerAgentProfile(ownerId: string, displayName: string, walletAddress?: string) {
    const existing = await prisma.agentProfile.findUnique({ where: { ownerId } });
    const role = existing?.role === 'SELLER' ? 'BOTH' : (existing?.role ?? 'BUYER');
    const profile = await prisma.agentProfile.upsert({
        where: { ownerId },
        create: { ownerId, displayName, walletAddress, role },
        update: { displayName, role, ...(walletAddress ? { walletAddress } : {}) },
    });

    if (walletAddress) {
        try {
            const baseUrl = process.env.API_URL || process.env.PUBLIC_API_URL || 'http://localhost:3001';
            const { registerAgentOnChain } = await import('./agent-registry.service');
            const onChainId = await registerAgentOnChain(
                ownerId,
                walletAddress,
                `${baseUrl}/api/v1/agent/metadata/${profile.id}`,
            );
            if (onChainId) {
                return await prisma.agentProfile.update({
                    where: { id: profile.id },
                    data: { onChainAgentId: onChainId },
                });
            }
        } catch (err: any) {
            console.warn(`[AgentIdentity] on-chain register skipped: ${err.message}`);
        }
    }

    return profile;
}

export function generateSellerAgentApiKey(): string {
    return `${SELLER_KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

export async function registerSellerAgentProfile(ownerId: string, displayName: string, walletAddress?: string) {
    const existing = await prisma.agentProfile.findUnique({ where: { ownerId } });
    const role = existing?.role === 'BUYER' ? 'BOTH' : (existing?.role ?? 'SELLER');
    const profile = await prisma.agentProfile.upsert({
        where: { ownerId },
        create: { ownerId, displayName, walletAddress, role },
        update: { displayName, role, ...(walletAddress ? { walletAddress } : {}) },
    });

    // Ensure seller business profile exists for ingest binding
    let user = await prisma.user.findUnique({ where: { id: ownerId } });
    if (user && user.role !== 'SELLER' && user.role !== 'ADMIN') {
        await prisma.user.update({ where: { id: ownerId }, data: { role: 'SELLER' } });
    }
    const sellerProfile = await prisma.sellerProfile.findUnique({ where: { userId: ownerId } });
    if (!sellerProfile) {
        await prisma.sellerProfile.create({
            data: {
                userId: ownerId,
                companyName: displayName,
                verticals: [],
            },
        });
    }

    return profile;
}

export async function createSellerAgentApiKey(
    agentId: string,
    label = 'default',
    opts?: { scopes?: string[]; sandboxOnly?: boolean },
) {
    const raw = generateSellerAgentApiKey();
    const keyHash = hashAgentApiKey(raw);
    const scopes = opts?.scopes ?? (opts?.sandboxOnly ? ['read'] : ['read', 'supply']);
    const row = await prisma.agentApiKey.create({
        data: {
            agentId,
            label,
            keyHash,
            scopes,
            sandboxOnly: opts?.sandboxOnly ?? false,
        },
    });
    return { id: row.id, rawKey: raw, label, scopes, sandboxOnly: row.sandboxOnly };
}

export async function verifySellerAgentApiKey(rawKey: string): Promise<{
    valid: boolean;
    keyId?: string;
    agentId?: string;
    ownerId?: string;
    scopes?: string[];
    sandboxOnly?: boolean;
}> {
    if (!rawKey.startsWith(SELLER_KEY_PREFIX)) return { valid: false };
    const keyHash = hashAgentApiKey(rawKey);
    const row = await prisma.agentApiKey.findUnique({
        where: { keyHash },
        include: { agent: true },
    });
    if (!row || row.revokedAt) return { valid: false };
    if (row.agent.role !== 'SELLER' && row.agent.role !== 'BOTH') return { valid: false };

    await prisma.agentApiKey.update({
        where: { id: row.id },
        data: { lastUsed: new Date() },
    });

    return {
        valid: true,
        keyId: row.id,
        agentId: row.agentId,
        ownerId: row.agent.ownerId,
        scopes: row.scopes,
        sandboxOnly: row.sandboxOnly,
    };
}

export async function createAgentApiKey(
    agentId: string,
    label = 'default',
    opts?: { scopes?: string[]; sandboxOnly?: boolean },
) {
    const raw = generateAgentApiKey();
    const keyHash = hashAgentApiKey(raw);
    const scopes = opts?.scopes ?? (opts?.sandboxOnly ? ['read', 'simulate'] : ['read', 'bid']);
    const row = await prisma.agentApiKey.create({
        data: {
            agentId,
            label,
            keyHash,
            scopes,
            sandboxOnly: opts?.sandboxOnly ?? false,
        },
    });
    return { id: row.id, rawKey: raw, label, scopes, sandboxOnly: row.sandboxOnly };
}

export async function verifyAgentApiKey(rawKey: string): Promise<{
    valid: boolean;
    keyId?: string;
    agentId?: string;
    ownerId?: string;
    scopes?: string[];
    sandboxOnly?: boolean;
}> {
    if (!rawKey.startsWith(KEY_PREFIX)) return { valid: false };
    const keyHash = hashAgentApiKey(rawKey);
    const row = await prisma.agentApiKey.findUnique({
        where: { keyHash },
        include: { agent: true },
    });
    if (!row || row.revokedAt) return { valid: false };
    if (row.agent.role !== 'BUYER' && row.agent.role !== 'BOTH') return { valid: false };

    await prisma.agentApiKey.update({
        where: { id: row.id },
        data: { lastUsed: new Date() },
    });

    return {
        valid: true,
        keyId: row.id,
        agentId: row.agentId,
        ownerId: row.agent.ownerId,
        scopes: row.scopes,
        sandboxOnly: row.sandboxOnly,
    };
}

export async function getLeaderboard(limit = 20) {
    const rows = await prisma.agentProfile.findMany({
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

    return rows.map((r) => ({
        ...r,
        winRate: r.settlements > 0 ? Math.round((r.wins / r.settlements) * 100) : null,
        reputationPercent: r.reputationScore != null ? Math.round(r.reputationScore / 100) : null,
    }));
}

export async function getSellerLeaderboard(limit = 20) {
    const rows = await prisma.sellerProfile.findMany({
        orderBy: [{ reputationScore: 'desc' }, { totalLeadsSold: 'desc' }],
        take: limit,
        select: {
            id: true,
            companyName: true,
            reputationScore: true,
            totalLeadsSold: true,
            userId: true,
        },
    });
    return rows.map((r) => ({
        sellerId: r.id,
        companyName: r.companyName,
        reputationScore: Number(r.reputationScore),
        totalLeadsSold: r.totalLeadsSold,
        reputationPercent: Math.round(Number(r.reputationScore) / 100),
    }));
}
