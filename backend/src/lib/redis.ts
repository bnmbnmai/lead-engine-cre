import { Redis } from 'ioredis';
import { aceDevBus } from '../services/ace.service';

const REDIS_URL = process.env.REDIS_URL;

// Singleton Redis Instance for BullMQ and generic caching/locks
export const redisClient = REDIS_URL ? new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times: number) {
        if (times > 10) return null; // Stop after 10 retries
        return Math.min(times * 50, 2000);
    }
}) : null;

if (redisClient) {
    redisClient.on('connect', () => {
        console.log('[Redis] Connected successfully');
        aceDevBus.emit('ace:dev-log', {
            type: 'INFO',
            message: 'Redis connection established for queues and locks',
            timestamp: new Date().toISOString(),
            wallet: 'SYSTEM'
        });
    });

    redisClient.on('error', (err: any) => {
        console.error('[Redis] Connection Error:', err);
    });
} else {
    console.warn('[Redis] REDIS_URL not set. Running in memory-only mode. (NOT recommended for production)');
}

/**
 * Health check utility
 */
export async function checkRedisHealth(): Promise<boolean> {
    if (!redisClient) return false;
    try {
        await redisClient.ping();
        return true;
    } catch {
        return false;
    }
}

// ============================================
// Distributed Lock (multi-instance safety)
// ============================================

import crypto from 'crypto';

/**
 * Acquire a distributed lock via SET NX PX.
 * Returns a lock token when acquired, or null when the lock is held elsewhere.
 * When Redis is unavailable, returns a synthetic token (single-instance
 * deployments still get safety from DB-level compare-and-swap gates).
 */
export async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const token = crypto.randomUUID();
    if (!redisClient) return token; // no Redis — rely on DB CAS
    try {
        const ok = await redisClient.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
        return ok === 'OK' ? token : null;
    } catch {
        return token; // Redis hiccup — degrade to DB CAS protection
    }
}

/** Release a lock only if we still own it (check-and-del Lua). */
export async function releaseLock(key: string, token: string): Promise<void> {
    if (!redisClient) return;
    try {
        await redisClient.eval(
            `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
            1,
            `lock:${key}`,
            token,
        );
    } catch { /* lock expires via TTL */ }
}
