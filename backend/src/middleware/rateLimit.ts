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

// RTB Bidding - 100 requests per second (high concurrency)
export const rtbBiddingLimiter = rateLimit({
    windowMs: 1000,
    max: 100,
    message: { error: 'Bid rate limit exceeded' },
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
// Dynamic Rate Limiting by User Tier
// ============================================

export function createTieredLimiter(baseLimitPerMinute: number) {
    return rateLimit({
        windowMs: 60 * 1000,
        max: async (req: Request) => {
            const authReq = req as AuthenticatedRequest;
            if (!authReq.user) return baseLimitPerMinute;

            // TODO: Implement tier lookup from database
            // For now, return base limit
            // Premium users could have 5x the limit
            return baseLimitPerMinute;
        },
        keyGenerator: (req: Request) => {
            const authReq = req as AuthenticatedRequest;
            return authReq.user?.id || req.ip || 'anonymous';
        },
        handler: (_req: Request, res: Response) => {
            res.status(429).json({
                error: 'Rate limit exceeded',
                retryAfter: 60,
            });
        },
    });
}
