/**
 * StrategySpec — the versioned, user-authorable strategy document.
 *
 * This is the seed of the Phase C strategy engine: a declarative description
 * of WHAT an agent bids on (gates), HOW MUCH it bids (bid curve), and the
 * hard money limits it can never exceed (budget envelope).
 *
 * The executor (backend/src/agents/strategy) interprets a StrategySpec purely
 * and deterministically — the same spec + the same lead always produces the
 * same decision, which is what makes strategies backtestable.
 *
 * LLMs may DRAFT or TUNE a StrategySpec, but execution is never LLM-driven.
 */
import { z } from 'zod';

export const filterOperatorSchema = z.enum([
    'EQUALS', 'NOT_EQUALS',
    'IN', 'NOT_IN',
    'GT', 'GTE', 'LT', 'LTE',
    'BETWEEN',
    'CONTAINS', 'STARTS_WITH',
]);

export const fieldFilterSchema = z.object({
    fieldKey: z.string().min(1),
    operator: filterOperatorSchema,
    value: z.string(), // JSON-encoded
});

/** Declarative gate configuration (mirrors the 7-gate evaluation). */
export const strategyGatesSchema = z.object({
    vertical: z.string().min(1),                       // exact slug or '*'
    geoCountries: z.array(z.string().length(2)).default(['US']),
    geoInclude: z.array(z.string().min(1).max(4)).default([]),
    geoExclude: z.array(z.string().min(1).max(4)).default([]),
    minQualityScore: z.number().min(0).max(100).nullable().default(null), // buyer 0–100 scale
    acceptOffSite: z.boolean().default(true),
    requireVerified: z.boolean().default(false),
    fieldFilters: z.array(fieldFilterSchema).default([]),
});

/**
 * Bid curve: how the bid amount is derived for a matching lead.
 *   fixed     — always bid `base`
 *   linear    — base + slope × (qualityScore/100), clamped to [min, max]
 *   floorPlus — Chainlink Data Feeds floor × multiplier, clamped to [min, max]
 */
export const bidCurveSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('fixed'),
        base: z.number().positive(),
    }),
    z.object({
        type: z.literal('linear'),
        base: z.number().positive(),
        slopePerQualityPoint: z.number(),  // USDC per quality point (0–100 scale)
        min: z.number().positive(),
        max: z.number().positive(),
    }),
    z.object({
        type: z.literal('floorPlus'),
        floorMultiplier: z.number().positive(), // e.g. 1.1 = 10% above floor
        min: z.number().positive(),
        max: z.number().positive(),
    }),
]);

/** Hard money limits — enforced server-side, never by the LLM. */
export const budgetEnvelopeSchema = z.object({
    maxBidPerLead: z.number().positive(),
    dailyBudget: z.number().positive().nullable().default(null),
    totalBudget: z.number().positive().nullable().default(null),
    maxConcurrentBids: z.number().int().positive().nullable().default(null),
});

export const strategySpecSchema = z.object({
    /** Schema version — bump on breaking changes; executors check this. */
    version: z.literal(1),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    gates: strategyGatesSchema,
    bidCurve: bidCurveSchema,
    budget: budgetEnvelopeSchema,
    /** Free-form metadata (author, provenance, fork lineage). */
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export type StrategyGates = z.infer<typeof strategyGatesSchema>;
export type BidCurve = z.infer<typeof bidCurveSchema>;
export type BudgetEnvelope = z.infer<typeof budgetEnvelopeSchema>;
export type StrategySpec = z.infer<typeof strategySpecSchema>;

/** Parse + validate an untrusted StrategySpec document. */
export function parseStrategySpec(input: unknown): StrategySpec {
    return strategySpecSchema.parse(input);
}

/**
 * Compute the bid amount for a lead under a bid curve. Pure + deterministic.
 * @param qualityScore Lead quality on the internal 0–10000 scale (null = 0)
 * @param dataFeedFloor Chainlink floor price (required for floorPlus curves)
 */
export function computeBidAmount(
    curve: BidCurve,
    qualityScore: number | null,
    dataFeedFloor?: number | null,
): number {
    switch (curve.type) {
        case 'fixed':
            return curve.base;
        case 'linear': {
            const qs100 = (qualityScore ?? 0) / 100; // 0–100 scale
            const raw = curve.base + curve.slopePerQualityPoint * qs100;
            return Math.min(curve.max, Math.max(curve.min, round2(raw)));
        }
        case 'floorPlus': {
            const floor = dataFeedFloor ?? 0;
            const raw = floor * curve.floorMultiplier;
            return Math.min(curve.max, Math.max(curve.min, round2(raw)));
        }
    }
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
