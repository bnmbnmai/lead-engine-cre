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
    country: z.string().length(2).toUpperCase().default('US').optional(),
    state: z.string().max(4).optional(),
    region: z.string().max(100).optional(),
    city: z.string().optional(),
    zip: z.string().regex(/^[A-Z0-9 -]{2,10}$/i, 'Invalid postal code').optional(),
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
    adSource: z.object({
        utm_source: z.string().max(200).optional(),
        utm_medium: z.string().max(200).optional(),
        utm_campaign: z.string().max(200).optional(),
        utm_content: z.string().max(200).optional(),
        utm_term: z.string().max(200).optional(),
        ad_id: z.string().max(200).optional(),
        ad_platform: z.enum(['google', 'facebook', 'tiktok', 'linkedin', 'bing', 'other']).optional(),
    }).optional(),
    reservePrice: z.number().positive().optional(),
    tcpaConsentAt: z.string().datetime().optional(),
    consentProof: z.string().optional(),
    encryptedData: z.string().optional(),
    dataHash: z.string().optional(),
    expiresInMinutes: z.number().min(5).max(10080).optional().default(5), // 5min to 7days, default 5min
});

export const LeadQuerySchema = z.object({
    vertical: z.string().optional(),
    status: z.enum(['PENDING_AUCTION', 'IN_AUCTION', 'REVEAL_PHASE', 'SOLD', 'EXPIRED']).optional(),
    state: z.string().length(2).optional(),
    country: z.string().optional(),
    search: z.string().max(100).optional(),
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
        country: z.string().length(2).toUpperCase().optional(),
        regions: z.array(z.string().max(4)).optional(),
        states: z.array(z.string().length(2)).optional(), // backward compat alias
        zips: z.array(z.string()).optional(),
        excludeZips: z.array(z.string()).optional(),
        radius: z.object({
            lat: z.number(),
            lng: z.number(),
            miles: z.number().positive(),
        }).optional(),
    }).transform(data => ({
        ...data,
        regions: data.regions || data.states, // merge legacy "states" into "regions"
    })),
    reservePrice: z.number().positive(),
    buyNowPrice: z.number().positive().optional(),
    parameters: z.record(z.unknown()).optional(),
    acceptOffSite: z.boolean().optional().default(true),
    auctionDuration: z.number().min(60).max(3600).optional().default(300), // 1min to 1hr, default 5min
    revealWindow: z.number().min(60).max(3600).optional().default(900), // 1min to 1hr
    expiresInDays: z.number().min(1).max(90).optional().default(30),
});

export const AskQuerySchema = z.object({
    vertical: z.string().optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED']).optional(),
    minPrice: z.coerce.number().optional(),
    maxPrice: z.coerce.number().optional(),
    state: z.string().length(2).optional(),
    country: z.string().optional(),
    search: z.string().max(100).optional(),
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
        country: z.string().length(2).toUpperCase().optional(),
        regions: z.array(z.string().max(4)).optional(),
        excludeRegions: z.array(z.string().max(4)).optional(),
        states: z.array(z.string().length(2)).optional(), // backward compat
        excludeStates: z.array(z.string().length(2)).optional(), // backward compat
        zips: z.array(z.string()).optional(),
        excludeZips: z.array(z.string()).optional(),
    }).transform(data => ({
        ...data,
        regions: data.regions || data.states,
        excludeRegions: data.excludeRegions || data.excludeStates,
    })).optional(),
    budgetMin: z.number().positive().optional(),
    budgetMax: z.number().positive().optional(),
    dailyBudget: z.number().positive().optional(),
    monthlyBudget: z.number().positive().optional(),
    acceptOffSite: z.boolean().optional(),
    requireVerified: z.boolean().optional(),
    autoAcceptLeads: z.boolean().optional(),
});

// Dynamic verticals — no longer restricted to a hard-coded enum.
// Slug format: lowercase letters, numbers, underscores, dots (for sub-verticals).
const VERTICAL_SLUG_PATTERN = /^[a-z][a-z0-9_.]{0,99}$/;

export const PreferenceSetSchema = z.object({
    id: z.string().optional(),
    label: z.string().min(1).max(100),
    vertical: z.string().min(1).max(100).regex(VERTICAL_SLUG_PATTERN, 'Invalid vertical slug format'),
    priority: z.number().int().min(0).default(0),
    geoCountry: z.string().length(2).default('US'),
    geoInclude: z.array(z.string().min(1).max(4).regex(/^[A-Za-z]+$/, 'State code must be letters only')).default([])
        .refine((arr) => new Set(arr).size === arr.length, { message: 'Duplicate state codes in geoInclude' }),
    geoExclude: z.array(z.string().min(1).max(4).regex(/^[A-Za-z]+$/, 'State code must be letters only')).default([])
        .refine((arr) => new Set(arr).size === arr.length, { message: 'Duplicate state codes in geoExclude' }),
    maxBidPerLead: z.number().min(1, 'maxBidPerLead must be at least $1').max(99999999.99, 'Exceeds Decimal(10,2) limit').default(100),
    dailyBudget: z.number().positive().max(99999999.99, 'Exceeds Decimal(10,2) limit').optional(),
    autoBidEnabled: z.boolean().default(false),
    autoBidAmount: z.number().positive().max(99999999.99, 'Exceeds Decimal(10,2) limit').optional(),
    minQualityScore: z.number().int().min(0).max(10000).optional(),
    excludedSellerIds: z.array(z.string().min(1).max(50)).max(100).default([])
        .refine((arr) => new Set(arr).size === arr.length, { message: 'Duplicate seller IDs in excludedSellerIds' }),
    preferredSellerIds: z.array(z.string().min(1).max(50)).max(100).default([])
        .refine((arr) => new Set(arr).size === arr.length, { message: 'Duplicate seller IDs in preferredSellerIds' }),
    minSellerReputation: z.number().int().min(0).max(10000).optional(),
    requireVerifiedSeller: z.boolean().default(false),
    acceptOffSite: z.boolean().default(true),
    requireVerified: z.boolean().default(false),
    isActive: z.boolean().default(true),
});

export const BuyerPreferencesV2Schema = z.object({
    preferenceSets: z.array(PreferenceSetSchema).min(1).max(20),
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
// Verticals
// ============================================

export const VerticalCreateSchema = z.object({
    name: z.string().min(2).max(100),
    parentSlug: z.string().max(200).optional(),
    description: z.string().max(500).optional(),
    attributes: z.record(z.any()).optional(),
    aliases: z.array(z.string().max(60)).max(10).optional(),
    requiresTcpa: z.boolean().optional(),
    requiresKyc: z.boolean().optional(),
    restrictedGeos: z.array(z.string().length(2)).optional(),
});

export const VerticalUpdateSchema = VerticalCreateSchema.partial().extend({
    status: z.enum(['PROPOSED', 'ACTIVE', 'DEPRECATED', 'REJECTED']).optional(),
    sortOrder: z.number().int().min(0).optional(),
});

export const VerticalQuerySchema = z.object({
    status: z.enum(['PROPOSED', 'ACTIVE', 'DEPRECATED', 'REJECTED']).optional(),
    depth: z.coerce.number().int().min(0).max(3).optional(),
    parentSlug: z.string().optional(),
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
export type PreferenceSet = z.infer<typeof PreferenceSetSchema>;
export type BuyerPreferencesV2 = z.infer<typeof BuyerPreferencesV2Schema>;
export type VerticalCreate = z.infer<typeof VerticalCreateSchema>;
export type VerticalUpdate = z.infer<typeof VerticalUpdateSchema>;
export type VerticalQuery = z.infer<typeof VerticalQuerySchema>;
