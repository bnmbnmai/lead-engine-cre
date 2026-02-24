/**
 * Platform Config — Persistent key-value store backed by Prisma.
 *
 * Used for runtime settings that must survive server restarts
 * (e.g. the demo buyers toggle).  Includes a short in-memory
 * cache (5 s TTL) so hot-path readers like auto-bid don't hit
 * the DB on every evaluation.
 */

import { prisma } from './prisma';
import { redisClient } from './redis';

// ── In-memory cache fallback (key → { value, expiresAt }) ──
const fallbackCache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_S = 5;

export async function getConfig(key: string, defaultValue: string): Promise<string> {
    const redisKey = `config:cache:${key}`;

    // 1. Check cache (Redis first, then fallback)
    if (redisClient) {
        try {
            const cached = await redisClient.get(redisKey);
            if (cached) return cached;
        } catch { /* skip redis err */ }
    } else {
        const cached = fallbackCache.get(key);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.value;
        }
    }

    // 2. Read from DB
    try {
        const row = await prisma.platformConfig.findUnique({ where: { key } });
        const value = row?.value ?? defaultValue;

        // 3. Write cache
        if (redisClient) {
            await redisClient.setex(redisKey, CACHE_TTL_S, value).catch(() => { });
        } else {
            fallbackCache.set(key, { value, expiresAt: Date.now() + (CACHE_TTL_S * 1000) });
        }
        return value;
    } catch {
        // DB unreachable — return default (graceful degradation)
        return defaultValue;
    }
}

export async function setConfig(key: string, value: string): Promise<void> {
    await prisma.platformConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
    });

    // Invalidate cache so subsequent reads see the new value
    if (redisClient) {
        await redisClient.setex(`config:cache:${key}`, CACHE_TTL_S, value).catch(() => { });
    } else {
        fallbackCache.set(key, { value, expiresAt: Date.now() + (CACHE_TTL_S * 1000) });
    }
}
