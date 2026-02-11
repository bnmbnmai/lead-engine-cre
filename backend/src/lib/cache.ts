/**
 * In-Memory LRU Cache
 * 
 * TTL-based cache for reducing DB queries under load.
 * Used for: parameter matching results, quality scores, compliance checks.
 */

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}

export class LRUCache<T = any> {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private readonly maxSize: number;
    private readonly defaultTTL: number; // milliseconds

    // Stats
    private hits = 0;
    private misses = 0;

    constructor(options?: { maxSize?: number; ttlMs?: number }) {
        this.maxSize = options?.maxSize || 1000;
        this.defaultTTL = options?.ttlMs || 60_000; // 1 minute default
    }

    /**
     * Get a value from cache. Returns undefined if not found or expired.
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }

        // Move to end (most recently used) by re-inserting
        this.cache.delete(key);
        this.cache.set(key, entry);
        this.hits++;
        return entry.value;
    }

    /**
     * Set a value in cache with optional custom TTL.
     */
    set(key: string, value: T, ttlMs?: number): void {
        // Evict oldest entry if at capacity
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, {
            value,
            expiresAt: Date.now() + (ttlMs || this.defaultTTL),
        });
    }

    /**
     * Delete a specific key from cache.
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Clear all cached entries.
     */
    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Get cache statistics.
     */
    stats(): { size: number; maxSize: number; hits: number; misses: number; hitRate: string } {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: total === 0 ? '0%' : `${((this.hits / total) * 100).toFixed(1)}%`,
        };
    }

    /**
     * Get or set a value, computing it if not cached.
     * Useful for wrapping expensive operations.
     */
    async getOrSet(key: string, compute: () => Promise<T>, ttlMs?: number): Promise<T> {
        const cached = this.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const value = await compute();
        this.set(key, value, ttlMs);
        return value;
    }

    /**
     * Evict all expired entries (periodic cleanup).
     */
    evictExpired(): number {
        const now = Date.now();
        let evicted = 0;
        for (const [key, entry] of this.cache) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                evicted++;
            }
        }
        return evicted;
    }
}

// ============================================
// Pre-configured cache instances
// ============================================

/** Cache for quality score lookups (5 min TTL) */
export const qualityScoreCache = new LRUCache<number>({
    maxSize: 5000,
    ttlMs: 5 * 60_000,
});

/** Cache for parameter matching results (2 min TTL) */
export const parameterMatchCache = new LRUCache<{ matches: boolean; score: number }>({
    maxSize: 10000,
    ttlMs: 2 * 60_000,
});

/** Cache for compliance check results (10 min TTL) */
export const complianceCache = new LRUCache<{ allowed: boolean; reason?: string }>({
    maxSize: 5000,
    ttlMs: 10 * 60_000,
});

/** Cache for KYC validity (30 min TTL) */
export const kycCache = new LRUCache<boolean>({
    maxSize: 2000,
    ttlMs: 30 * 60_000,
});

/** Cache for marketplace /asks listing (30s TTL — short for freshness) */
export const marketplaceAsksCache = new LRUCache<any>({
    maxSize: 500,
    ttlMs: 30_000,
});

/** Cache for marketplace /leads listing (20s TTL) */
export const marketplaceLeadsCache = new LRUCache<any>({
    maxSize: 500,
    ttlMs: 20_000,
});

/** Cache for analytics overview (60s TTL — expensive aggregation queries) */
export const analyticsOverviewCache = new LRUCache<any>({
    maxSize: 200,
    ttlMs: 60_000,
});

/** Cache for analytics leads/bids time-series (45s TTL) */
export const analyticsLeadCache = new LRUCache<any>({
    maxSize: 300,
    ttlMs: 45_000,
});

/** Cache for vertical hierarchy tree (5 min TTL — rarely changes) */
export const verticalHierarchyCache = new LRUCache<any>({
    maxSize: 50,
    ttlMs: 5 * 60_000,
});

/** Cache for NFT ownership lookups (2 min TTL) */
export const nftOwnershipCache = new LRUCache<string | null>({
    maxSize: 2000,
    ttlMs: 2 * 60_000,
});

/** Cache for bid activity counters — spam prevention (60s TTL = 1 minute window) */
export const bidActivityCache = new LRUCache<number>({
    maxSize: 10000,
    ttlMs: 60_000,
});

/** Cache for holder notification opt-in status (5 min TTL) */
export const holderNotifyCache = new LRUCache<boolean>({
    maxSize: 5000,
    ttlMs: 5 * 60_000,
});

