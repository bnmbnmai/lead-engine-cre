import rateLimit, { Store, IncrementResponse } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { LRUCache } from '../lib/cache';

// ============================================
// LRU-Backed Rate Limit Store
// ============================================

/**
 * Custom rate-limit store backed by our LRU cache.
 * Provides unified memory management (eviction, TTL) across all limiters.
 * Falls back gracefully — if LRU evicts an entry, user gets a fresh window.
 */
class LRURateLimitStore implements Store {
    private lru: LRUCache<{ totalHits: number; resetTime: Date }>;
    private windowMs: number;

    constructor(windowMs: number, maxSize: number = 50000) {
        this.windowMs = windowMs;
        this.lru = new LRUCache<{ totalHits: number; resetTime: Date }>({
            maxSize,
            ttlMs: windowMs,
        });
    }

    async increment(key: string): Promise<IncrementResponse> {
        const now = Date.now();
        const existing = this.lru.get(key);

        if (existing) {
            existing.totalHits++;
            this.lru.set(key, existing, this.windowMs);
            return { totalHits: existing.totalHits, resetTime: existing.resetTime };
        }

        const entry = { totalHits: 1, resetTime: new Date(now + this.windowMs) };
        this.lru.set(key, entry, this.windowMs);
        return { totalHits: 1, resetTime: entry.resetTime };
    }

    async decrement(key: string): Promise<void> {
        const existing = this.lru.get(key);
        if (existing && existing.totalHits > 0) {
            existing.totalHits--;
            this.lru.set(key, existing);
        }
    }

    async resetKey(key: string): Promise<void> {
        this.lru.delete(key);
    }

    async resetAll(): Promise<void> {
        // LRU doesn't have a targeted clear, but entries will expire via TTL
    }
}

// ============================================
// Rate Limit Configurations
// ============================================

// General API - 100 requests per minute
// In demo mode (non-production or DEMO_MODE=true), rate limiting is bypassed
// to prevent "Too many requests" errors when using the Demo Control Panel.
const isDemoMode = process.env.NODE_ENV !== 'production' || process.env.DEMO_MODE === 'true';

export const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: isDemoMode ? 0 : 100, // 0 = unlimited in demo mode
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    store: new LRURateLimitStore(60_000),
    skip: () => isDemoMode,
    keyGenerator: (req: Request) => {
        const authReq = req as AuthenticatedRequest;
        return authReq.user?.id || req.ip || 'anonymous';
    },
});

// RTB Bidding - 50 per minute per user (aligned with SPAM_THRESHOLD_BIDS_PER_MINUTE default)
export const rtbBiddingLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: isDemoMode ? 0 : 50, // 0 = unlimited in demo mode
    message: { error: 'Bid rate limit exceeded — max 50 bids per minute' },
    standardHeaders: true,
    legacyHeaders: false,
    store: new LRURateLimitStore(60_000, 20000),
    keyGenerator: (req: Request) => {
        const authReq = req as AuthenticatedRequest;
        return authReq.user?.id || req.ip || 'anonymous';
    },
    skip: () => isDemoMode,
});

// Auth endpoints - 10 per minute (prevent brute force)
export const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Too many authentication attempts' },
    standardHeaders: true,
    legacyHeaders: false,
    store: new LRURateLimitStore(60_000, 5000),
});

// Lead submission - 50 per minute
export const leadSubmitLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 50,
    message: { error: 'Lead submission rate limit exceeded' },
    standardHeaders: true,
    legacyHeaders: false,
    store: new LRURateLimitStore(60_000, 10000),
    keyGenerator: (req: Request) => {
        const authReq = req as AuthenticatedRequest;
        return authReq.user?.id || req.ip || 'anonymous';
    },
});

// Analytics - 30 per minute (prevent scraping)
export const analyticsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Analytics rate limit exceeded' },
    standardHeaders: true,
    legacyHeaders: false,
    store: new LRURateLimitStore(60_000, 5000),
});

// ============================================
// Tier Constants (exported for testing)
// ============================================

export const TIER_MULTIPLIERS = {
    DEFAULT: 1,
    HOLDER: 2,   // NFT vertical holder
    PREMIUM: 3,  // Premium plan user (future)
} as const;

export const TIER_HARD_CEILING = 30; // Absolute max requests/min regardless of tier
const TIER_LOOKUP_CACHE_MS = 30_000; // Cache tier lookups for 30s to avoid DB hits

/** Per-user tier cache: userId → { tier, expiresAt } */
const tierCache = new Map<string, { tier: keyof typeof TIER_MULTIPLIERS; expiresAt: number }>();

/**
 * Look up user's rate limit tier.
 * Checks NFT holder status (cache) and premium/KYC status (DB-backed).
 * Results cached for 30s to avoid per-request DB hits.
 */
export async function lookupUserTier(
    userId?: string,
    walletAddress?: string,
): Promise<keyof typeof TIER_MULTIPLIERS> {
    if (!userId) return 'DEFAULT';

    // Check tier cache first
    const cached = tierCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.tier;

    let tier: keyof typeof TIER_MULTIPLIERS = 'DEFAULT';

    try {
        // 1. Check NFT holder status via cache
        if (walletAddress) {
            const { nftOwnershipCache } = require('../lib/cache');
            const cachedOwner = nftOwnershipCache.get(`nft-holder:${walletAddress.toLowerCase()}`);
            if (cachedOwner) tier = 'HOLDER';
        }

        // 2. Check premium status via DB (verified KYC = premium proxy)
        const { prisma } = require('../lib/prisma');
        const profile = await prisma.buyerProfile.findFirst({
            where: { userId },
            select: { kycStatus: true },
        });
        if (profile?.kycStatus === 'VERIFIED') {
            tier = 'PREMIUM'; // Premium overrides holder
        }
    } catch { /* fall through to cached or default tier */ }

    // Cache the result
    tierCache.set(userId, { tier, expiresAt: Date.now() + TIER_LOOKUP_CACHE_MS });
    return tier;
}

/** Clear tier cache (for testing) */
export function clearTierCache(): void { tierCache.clear(); }

export function createTieredLimiter(baseLimitPerMinute: number) {
    return rateLimit({
        windowMs: 60 * 1000,
        max: async (req: Request) => {
            const authReq = req as AuthenticatedRequest;
            if (!authReq.user) return baseLimitPerMinute;

            const tier = await lookupUserTier(
                authReq.user.id,
                (authReq.user as any).walletAddress,
            );
            const multiplier = TIER_MULTIPLIERS[tier];

            return Math.min(baseLimitPerMinute * multiplier, TIER_HARD_CEILING);
        },
        keyGenerator: (req: Request) => {
            const authReq = req as AuthenticatedRequest;
            return authReq.user?.id || req.ip || 'anonymous';
        },
        handler: (_req: Request, res: Response) => {
            res.status(429).json({
                error: 'Rate limit exceeded',
                retryAfter: 60,
                maxPerMinute: TIER_HARD_CEILING,
            });
        },
    });
}

// ============================================
// IP Blocklist
// ============================================

import { IP_BLOCKLIST_MAX_SIZE } from '../config/perks.env';

/**
 * Static IP blocklist with exact IP and /24 subnet matching.
 * Used to permanently block known bad actors identified through
 * coordinated spam detection or manual review.
 */
class IpBlocklist {
    private exactIps: Set<string> = new Set();
    private subnets: Set<string> = new Set(); // /24 prefixes
    private readonly maxSize: number;

    constructor(maxSize: number = 10000) {
        this.maxSize = maxSize;
    }

    /** Add an IP or /24 subnet (e.g. "192.168.1.42" or "192.168.1") */
    add(entry: string): boolean {
        if (this.exactIps.size + this.subnets.size >= this.maxSize) {
            console.warn(`[IP-BLOCKLIST] Max size (${this.maxSize}) reached — cannot add "${entry}"`);
            return false;
        }
        const normalized = normalizeIp(entry);
        const parts = normalized.split('.');
        if (parts.length === 3) {
            this.subnets.add(normalized);
        } else {
            this.exactIps.add(normalized);
        }
        console.log(`[IP-BLOCKLIST] Added: ${normalized} (exact: ${this.exactIps.size}, subnets: ${this.subnets.size})`);
        return true;
    }

    /** Remove an IP or subnet from the blocklist */
    remove(entry: string): boolean {
        const normalized = normalizeIp(entry);
        return this.exactIps.delete(normalized) || this.subnets.delete(normalized);
    }

    /** Check if an IP is blocked (exact match or /24 subnet match) */
    isBlocked(ip: string): boolean {
        const normalized = normalizeIp(ip);
        if (this.exactIps.has(normalized)) return true;
        const prefix = getSubnetPrefix(normalized);
        return this.subnets.has(prefix);
    }

    /** Get current blocklist size */
    get size(): number { return this.exactIps.size + this.subnets.size; }

    /** Clear entire blocklist */
    clear(): void {
        this.exactIps.clear();
        this.subnets.clear();
    }
}

/** Normalize IP: strip ::ffff: prefix for IPv4-mapped IPv6 */
function normalizeIp(ip: string): string {
    if (!ip) return '';
    // Handle IPv4-mapped IPv6 (e.g. "::ffff:192.168.1.42")
    if (ip.startsWith('::ffff:')) {
        const v4 = ip.slice(7); // "::ffff:".length === 7
        if (v4.includes('.')) return v4;
    }
    return ip;
}

/** Singleton blocklist instance */
export const ipBlocklist = new IpBlocklist(IP_BLOCKLIST_MAX_SIZE);

/** Convenience: add IP to blocklist */
export function addBlockedIp(ip: string): boolean { return ipBlocklist.add(ip); }

/** Convenience: remove IP from blocklist */
export function removeBlockedIp(ip: string): boolean { return ipBlocklist.remove(ip); }

/** Convenience: check if IP is blocked */
export function isBlocked(ip: string): boolean { return ipBlocklist.isBlocked(ip); }

/**
 * Middleware: Reject requests from blocked IPs.
 * Runs BEFORE rate limiting to save resources on known bad actors.
 */
export function ipBlocklistMiddleware(req: Request, res: Response, next: NextFunction): void {
    const clientIp = req.ip || '';
    if (ipBlocklist.isBlocked(clientIp)) {
        console.warn(`[IP-BLOCKLIST] Blocked request from ${clientIp}`);
        res.status(403).json({ error: 'Access denied' });
        return;
    }
    next();
}

// ============================================
// Coordinated Spam Detection (IP Diversity)
// ============================================

const COORDINATED_SPAM_THRESHOLD = 5; // 5+ distinct users from same /24 subnet
const SUBNET_WINDOW_MS = 60_000;       // 60-second tracking window

/** Cache: /24 prefix → Set of user IDs seen in window */
export const subnetActivityCache = new LRUCache<Set<string>>({
    maxSize: 10000,
    ttlMs: SUBNET_WINDOW_MS,
});

/**
 * Extract /24 subnet prefix from IP address.
 * IPv4: "192.168.1.42" → "192.168.1"
 * IPv6: uses first 3 segments
 * IPv4-mapped IPv6: "::ffff:192.168.1.42" → "192.168.1"
 */
function getSubnetPrefix(ip: string): string {
    if (!ip) return 'unknown';
    // Normalize IPv4-mapped IPv6 first
    const normalized = normalizeIp(ip);
    // Handle IPv4
    const parts = normalized.split('.');
    if (parts.length === 4) return parts.slice(0, 3).join('.');
    if (parts.length === 3) return normalized; // Already a /24 prefix
    // IPv6 — use first 3 hextets
    const v6parts = normalized.split(':');
    return v6parts.slice(0, 3).join(':');
}

/**
 * Middleware: Detect coordinated spam from /24 subnet clusters.
 * If 5+ distinct authenticated users send bids from the same /24 in 60s → 429.
 */
export function coordinatedSpamCheck(req: Request, res: Response, next: NextFunction): void {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    if (!userId) { next(); return; }

    const subnet = getSubnetPrefix(req.ip || '');
    const existing = subnetActivityCache.get(`subnet:${subnet}`);

    if (existing) {
        existing.add(userId);
        subnetActivityCache.set(`subnet:${subnet}`, existing, SUBNET_WINDOW_MS);

        if (existing.size >= COORDINATED_SPAM_THRESHOLD) {
            console.warn(`[SPAM-DETECTION] Coordinated spam: ${existing.size} users from ${subnet}.* in 60s: [${[...existing].join(', ')}]`);
            res.status(429).json({
                error: 'Coordinated spam detected',
                subnet: `${subnet}.*`,
                distinctUsers: existing.size,
            });
            return;
        }
    } else {
        subnetActivityCache.set(`subnet:${subnet}`, new Set([userId]), SUBNET_WINDOW_MS);
    }

    next();
}

// Export for testing
export { IpBlocklist, LRURateLimitStore, COORDINATED_SPAM_THRESHOLD, getSubnetPrefix, normalizeIp };

