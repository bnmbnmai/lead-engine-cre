/**
 * Platform Config — Persistent key-value store backed by Prisma.
 *
 * Used for runtime settings that must survive server restarts
 * (e.g. the demo buyers toggle).  Includes a short in-memory
 * cache (5 s TTL) so hot-path readers like auto-bid don't hit
 * the DB on every evaluation.
 */

import { prisma } from './prisma';

// ── In-memory cache (key → { value, expiresAt }) ──
const cache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 5_000;

/**
 * Read a config value.  Returns `defaultValue` when the key
 * does not yet exist in the DB.
 */
export async function getConfig(key: string, defaultValue: string): Promise<string> {
    // 1. Check cache
    const cached = cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.value;
    }

    // 2. Read from DB
    try {
        const row = await prisma.platformConfig.findUnique({ where: { key } });
        const value = row?.value ?? defaultValue;
        cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        return value;
    } catch {
        // DB unreachable — return default (graceful degradation)
        return defaultValue;
    }
}

/**
 * Write (upsert) a config value.  Immediately invalidates the
 * cache so the next read reflects the new value.
 */
export async function setConfig(key: string, value: string): Promise<void> {
    await prisma.platformConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
    });
    // Invalidate cache so subsequent reads see the new value
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}
