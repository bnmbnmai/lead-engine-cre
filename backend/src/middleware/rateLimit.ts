import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from './auth';

// ============================================
// Rate Limit Configurations
// ============================================

// General API - 100 requests per minute
export const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
        const authReq = req as AuthenticatedRequest;
        return authReq.user?.id || req.ip || 'anonymous';
    },
});

// RTB Bidding - 10 per minute per user (aligned with LRU-based 5/min inner limit)
export const rtbBiddingLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Bid rate limit exceeded — max 10 bids per minute' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
        const authReq = req as AuthenticatedRequest;
        return authReq.user?.id || req.ip || 'anonymous';
    },
    skip: (req: Request) => {
        // Skip rate limiting for health checks
        return req.path === '/health';
    },
});

// Auth endpoints - 10 per minute (prevent brute force)
export const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Too many authentication attempts' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Lead submission - 50 per minute
export const leadSubmitLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 50,
    message: { error: 'Lead submission rate limit exceeded' },
    standardHeaders: true,
    legacyHeaders: false,
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

export function createTieredLimiter(baseLimitPerMinute: number) {
    return rateLimit({
        windowMs: 60 * 1000,
        max: async (req: Request) => {
            const authReq = req as AuthenticatedRequest;
            if (!authReq.user) return baseLimitPerMinute;

            let multiplier: number = TIER_MULTIPLIERS.DEFAULT;

            // Check holder status for tiered rate limit
            try {
                const walletAddress = (authReq.user as any).walletAddress;
                if (walletAddress) {
                    const { nftOwnershipCache } = require('../lib/cache');
                    const cachedOwner = nftOwnershipCache.get(`nft-holder:${walletAddress.toLowerCase()}`);
                    if (cachedOwner) multiplier = TIER_MULTIPLIERS.HOLDER;
                }

                // Future: check premium plan from DB
                // if (isPremiumUser(authReq.user.id)) multiplier = TIER_MULTIPLIERS.PREMIUM;
            } catch { /* fall through to base limit */ }

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

