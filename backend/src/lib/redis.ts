import { Redis } from 'ioredis';
import { aceDevBus } from '../services/ace.service';

const REDIS_URL = process.env.REDIS_URL;

// Singleton Redis Instance for BullMQ and generic caching/locks
export const redisClient = REDIS_URL ? new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
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

    redisClient.on('error', (err) => {
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
