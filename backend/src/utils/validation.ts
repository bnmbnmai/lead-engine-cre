import { z } from 'zod';

// ============================================
// Auth Schemas
// ============================================

export const WalletAuthSchema = z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address'),
    message: z.string().min(1),
    signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Invalid signature'),
});

export const KycInitSchema = z.object({
    provider: z.enum(['synaps', 'persona', 'jumio']).optional().default('synaps'),
    redirectUrl: z.string().url().optional(),
});

// ============================================
// Lead Schemas
// ============================================

export const GeoSchema = z.object({
    state: z.string().length(2).optional(),
    city: z.string().optional(),
    zip: z.string().regex(/^\d{5}(-\d{4})?$/).optional(),
    geoHash: z.string().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
});

export const LeadSubmitSchema = z.object({
    vertical: z.enum([
        'solar',
        'mortgage',
        'roofing',
        'insurance',
        'home_services',
        'b2b_saas',
        'real_estate',
        'auto',
        'legal',
        'financial',
    ]),
    geo: GeoSchema,
    source: z.enum(['PLATFORM', 'API', 'OFFSITE']).optional().default('PLATFORM'),
    parameters: z.record(z.unknown()).optional(),
    reservePrice: z.number().positive().optional(),
    tcpaConsentAt: z.string().datetime().optional(),
    consentProof: z.string().optional(),
    encryptedData: z.string().optional(),
    dataHash: z.string().optional(),
    expiresInMinutes: z.number().min(5).max(10080).optional().default(60), // 5min to 7days
});

export const LeadQuerySchema = z.object({
    vertical: z.string().optional(),
    status: z.enum(['PENDING_AUCTION', 'IN_AUCTION', 'REVEAL_PHASE', 'SOLD', 'EXPIRED']).optional(),
    state: z.string().length(2).optional(),
    limit: z.coerce.number().min(1).max(100).optional().default(20),
    offset: z.coerce.number().min(0).optional().default(0),
    sortBy: z.enum(['createdAt', 'reservePrice', 'auctionEndAt']).optional().default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// ============================================
// Ask Schemas
// ============================================

export const AskCreateSchema = z.object({
    vertical: z.string(),
    geoTargets: z.object({
        states: z.array(z.string().length(2)).optional(),
        zips: z.array(z.string()).optional(),
        excludeZips: z.array(z.string()).optional(),
        radius: z.object({
            lat: z.number(),
            lng: z.number(),
            miles: z.number().positive(),
        }).optional(),
    }),
    reservePrice: z.number().positive(),
    buyNowPrice: z.number().positive().optional(),
    parameters: z.record(z.unknown()).optional(),
    acceptOffSite: z.boolean().optional().default(true),
    auctionDuration: z.number().min(300).max(604800).optional().default(3600), // 5min to 7days
    revealWindow: z.number().min(60).max(3600).optional().default(900), // 1min to 1hr
    expiresInDays: z.number().min(1).max(90).optional().default(30),
});

export const AskQuerySchema = z.object({
    vertical: z.string().optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED']).optional(),
    minPrice: z.coerce.number().optional(),
    maxPrice: z.coerce.number().optional(),
    state: z.string().length(2).optional(),
    limit: z.coerce.number().min(1).max(100).optional().default(20),
    offset: z.coerce.number().min(0).optional().default(0),
});

// ============================================
// Bid Schemas
// ============================================

export const BidCommitSchema = z.object({
    leadId: z.string(),
    commitment: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid commitment hash'),
});

export const BidRevealSchema = z.object({
    amount: z.number().positive(),
    salt: z.string(),
});

export const BidDirectSchema = z.object({
    leadId: z.string(),
    amount: z.number().positive(),
});

// ============================================
// Buyer Preferences
// ============================================

export const BuyerPreferencesSchema = z.object({
    verticals: z.array(z.string()).optional(),
    geoFilters: z.object({
        states: z.array(z.string().length(2)).optional(),
        excludeStates: z.array(z.string().length(2)).optional(),
        zips: z.array(z.string()).optional(),
        excludeZips: z.array(z.string()).optional(),
    }).optional(),
    budgetMin: z.number().positive().optional(),
    budgetMax: z.number().positive().optional(),
    dailyBudget: z.number().positive().optional(),
    monthlyBudget: z.number().positive().optional(),
    acceptOffSite: z.boolean().optional(),
    requireVerified: z.boolean().optional(),
    autoAcceptLeads: z.boolean().optional(),
});

// ============================================
// Analytics
// ============================================

export const AnalyticsQuerySchema = z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    vertical: z.string().optional(),
    groupBy: z.enum(['day', 'week', 'month']).optional().default('day'),
});

// ============================================
// Type Exports
// ============================================

export type WalletAuth = z.infer<typeof WalletAuthSchema>;
export type LeadSubmit = z.infer<typeof LeadSubmitSchema>;
export type LeadQuery = z.infer<typeof LeadQuerySchema>;
export type AskCreate = z.infer<typeof AskCreateSchema>;
export type AskQuery = z.infer<typeof AskQuerySchema>;
export type BidCommit = z.infer<typeof BidCommitSchema>;
export type BidReveal = z.infer<typeof BidRevealSchema>;
export type BidDirect = z.infer<typeof BidDirectSchema>;
export type BuyerPreferences = z.infer<typeof BuyerPreferencesSchema>;
