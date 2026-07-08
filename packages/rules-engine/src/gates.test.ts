import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { evaluatePreferenceSet } from './gates';
import { evaluateFieldFilters, evaluateSingleRule } from './field-filters';
import { computeBidAmount, parseStrategySpec } from './strategy-spec';
import type { LeadData, PreferenceSet } from './types';

// ── Generators ───────────────────────────────────────────────────────────

const verticalArb = fc.constantFrom('solar', 'insurance', 'mortgage', 'hvac', '*');
const countryArb = fc.constantFrom('US', 'CA', 'GB', 'AU');
const stateArb = fc.constantFrom('CA', 'TX', 'NY', 'FL', 'WA');

const leadArb: fc.Arbitrary<LeadData> = fc.record({
    id: fc.uuid(),
    vertical: verticalArb.filter((v) => v !== '*'),
    geo: fc.record({
        country: countryArb,
        state: fc.option(stateArb, { nil: undefined }),
    }),
    source: fc.constantFrom('ONSITE', 'OFFSITE', 'API'),
    qualityScore: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: null }),
    isVerified: fc.boolean(),
    reservePrice: fc.integer({ min: 0, max: 500 }),
    parameters: fc.option(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.oneof(fc.string(), fc.integer(), fc.boolean())),
        { nil: null },
    ),
});

const prefArb: fc.Arbitrary<PreferenceSet> = fc.record({
    id: fc.uuid(),
    buyerId: fc.uuid(),
    vertical: verticalArb,
    label: fc.string({ minLength: 1, maxLength: 20 }),
    geoCountries: fc.array(countryArb, { maxLength: 3 }),
    geoInclude: fc.array(stateArb, { maxLength: 3 }),
    geoExclude: fc.array(stateArb, { maxLength: 3 }),
    minQualityScore: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    acceptOffSite: fc.boolean(),
    requireVerified: fc.boolean(),
    autoBidAmount: fc.integer({ min: 1, max: 1000 }),
    maxBidPerLead: fc.option(fc.integer({ min: 1, max: 2000 }), { nil: null }),
    fieldFilters: fc.constant([]),
});

// ── Property-based tests ─────────────────────────────────────────────────

describe('evaluatePreferenceSet (properties)', () => {
    it('is deterministic: same inputs always produce identical results', () => {
        fc.assert(
            fc.property(leadArb, prefArb, (lead, pref) => {
                const a = evaluatePreferenceSet(lead, pref);
                const b = evaluatePreferenceSet(lead, pref);
                expect(a).toEqual(b);
            }),
        );
    });

    it('matched=true implies every gate passed', () => {
        fc.assert(
            fc.property(leadArb, prefArb, (lead, pref) => {
                const res = evaluatePreferenceSet(lead, pref);
                if (res.matched) {
                    expect(Object.values(res.gateResults).every(Boolean)).toBe(true);
                }
            }),
        );
    });

    it('matched=false implies a non-empty reason and at least one failed gate', () => {
        fc.assert(
            fc.property(leadArb, prefArb, (lead, pref) => {
                const res = evaluatePreferenceSet(lead, pref);
                if (!res.matched) {
                    expect(res.reason.length).toBeGreaterThan(0);
                    expect(Object.values(res.gateResults).some((g) => !g)).toBe(true);
                }
            }),
        );
    });

    it('gates short-circuit in order: a failed gate means later gates stay false', () => {
        const gateOrder = [
            'verticalMatch', 'geoCountryMatch', 'geoStateMatch',
            'qualityScoreMatch', 'offSiteMatch', 'verifiedMatch', 'fieldFilterMatch',
        ] as const;
        fc.assert(
            fc.property(leadArb, prefArb, (lead, pref) => {
                const res = evaluatePreferenceSet(lead, pref);
                const firstFail = gateOrder.findIndex((g) => !res.gateResults[g]);
                if (firstFail >= 0) {
                    for (let i = firstFail; i < gateOrder.length; i++) {
                        expect(res.gateResults[gateOrder[i]]).toBe(false);
                    }
                }
            }),
        );
    });

    it('vertical mismatch always fails (unless wildcard)', () => {
        fc.assert(
            fc.property(leadArb, prefArb, (lead, pref) => {
                if (pref.vertical !== '*' && pref.vertical !== lead.vertical) {
                    const res = evaluatePreferenceSet(lead, pref);
                    expect(res.matched).toBe(false);
                    expect(res.gateResults.verticalMatch).toBe(false);
                }
            }),
        );
    });

    it('quality gate: lead below threshold never matches', () => {
        fc.assert(
            fc.property(leadArb, prefArb, fc.integer({ min: 1, max: 100 }), (lead, pref, minScore) => {
                const strict: PreferenceSet = { ...pref, minQualityScore: minScore };
                const lowLead: LeadData = { ...lead, qualityScore: minScore * 100 - 1 };
                const res = evaluatePreferenceSet(lowLead, strict);
                expect(res.gateResults.qualityScoreMatch).toBe(false);
            }),
        );
    });

    it('suggestedBidAmount always equals autoBidAmount', () => {
        fc.assert(
            fc.property(leadArb, prefArb, (lead, pref) => {
                expect(evaluatePreferenceSet(lead, pref).suggestedBidAmount).toBe(pref.autoBidAmount);
            }),
        );
    });
});

// ── Example-based gate tests ─────────────────────────────────────────────

const baseLead: LeadData = {
    id: 'lead-1',
    vertical: 'solar',
    geo: { country: 'US', state: 'CA' },
    source: 'ONSITE',
    qualityScore: 8000,
    isVerified: true,
    reservePrice: 10,
    parameters: { credit_score: 720, homeowner: true },
};

const basePref: PreferenceSet = {
    id: 'pref-1',
    buyerId: 'buyer-1',
    vertical: 'solar',
    label: 'Solar CA',
    geoCountries: ['US'],
    geoInclude: [],
    geoExclude: [],
    minQualityScore: null,
    acceptOffSite: true,
    requireVerified: false,
    autoBidAmount: 50,
    maxBidPerLead: 100,
    fieldFilters: [],
};

describe('evaluatePreferenceSet (examples)', () => {
    it('matches when all gates pass', () => {
        const res = evaluatePreferenceSet(baseLead, basePref);
        expect(res.matched).toBe(true);
        expect(res.reason).toContain('Matched');
    });

    it('wildcard vertical matches any lead vertical', () => {
        const res = evaluatePreferenceSet(baseLead, { ...basePref, vertical: '*' });
        expect(res.matched).toBe(true);
    });

    it('parent vertical slug matches child lead verticals', () => {
        const childLead: LeadData = { ...baseLead, vertical: 'solar.residential' };
        const res = evaluatePreferenceSet(childLead, { ...basePref, vertical: 'solar' });
        expect(res.matched).toBe(true);
        expect(res.gateResults.verticalMatch).toBe(true);
    });

    it('empty geoCountries defaults to US', () => {
        expect(evaluatePreferenceSet(baseLead, { ...basePref, geoCountries: [] }).matched).toBe(true);
        expect(
            evaluatePreferenceSet(
                { ...baseLead, geo: { country: 'CA' } },
                { ...basePref, geoCountries: [] },
            ).matched,
        ).toBe(false);
    });

    it('state include/exclude lists are case-insensitive', () => {
        expect(evaluatePreferenceSet(baseLead, { ...basePref, geoInclude: ['ca'] }).matched).toBe(true);
        expect(evaluatePreferenceSet(baseLead, { ...basePref, geoExclude: ['ca'] }).matched).toBe(false);
    });

    it('quality threshold uses the 0-100 → 0-10000 scale conversion', () => {
        expect(evaluatePreferenceSet(baseLead, { ...basePref, minQualityScore: 80 }).matched).toBe(true);
        expect(evaluatePreferenceSet(baseLead, { ...basePref, minQualityScore: 81 }).matched).toBe(false);
    });

    it('null qualityScore is treated as 0 against a threshold', () => {
        const res = evaluatePreferenceSet(
            { ...baseLead, qualityScore: null },
            { ...basePref, minQualityScore: 1 },
        );
        expect(res.matched).toBe(false);
    });

    it('rejects OFFSITE leads when acceptOffSite=false', () => {
        const res = evaluatePreferenceSet(
            { ...baseLead, source: 'OFFSITE' },
            { ...basePref, acceptOffSite: false },
        );
        expect(res.matched).toBe(false);
        expect(res.reason).toBe('Off-site leads rejected');
    });

    it('rejects unverified leads when requireVerified=true', () => {
        const res = evaluatePreferenceSet(
            { ...baseLead, isVerified: false },
            { ...basePref, requireVerified: true },
        );
        expect(res.matched).toBe(false);
    });

    it('Gate 7: field filters are evaluated (regression for the cre.service omission)', () => {
        const res = evaluatePreferenceSet(baseLead, {
            ...basePref,
            fieldFilters: [{ fieldKey: 'credit_score', operator: 'GTE', value: '750' }],
        });
        expect(res.matched).toBe(false);
        expect(res.gateResults.fieldFilterMatch).toBe(false);
        expect(res.reason).toContain('credit_score');
    });
});

// ── Field filter tests ───────────────────────────────────────────────────

describe('evaluateFieldFilters', () => {
    it('empty rules always pass', () => {
        fc.assert(
            fc.property(
                fc.option(fc.dictionary(fc.string(), fc.string()), { nil: null }),
                (params) => {
                    expect(evaluateFieldFilters(params, []).pass).toBe(true);
                },
            ),
        );
    });

    it('AND logic: result fails iff at least one rule fails', () => {
        const params = { a: 5, b: 'hello' };
        const passRule = { fieldKey: 'a', operator: 'GTE' as const, value: '5' };
        const failRule = { fieldKey: 'b', operator: 'EQUALS' as const, value: '"world"' };
        expect(evaluateFieldFilters(params, [passRule]).pass).toBe(true);
        expect(evaluateFieldFilters(params, [passRule, failRule]).pass).toBe(false);
        expect(evaluateFieldFilters(params, [passRule, failRule]).failedKeys).toEqual(['b']);
    });

    it('missing lead values fail closed except NOT_EQUALS / NOT_IN', () => {
        expect(evaluateSingleRule(undefined, 'EQUALS', 'x')).toBe(false);
        expect(evaluateSingleRule(undefined, 'GT', 1)).toBe(false);
        expect(evaluateSingleRule(undefined, 'NOT_EQUALS', 'x')).toBe(true);
        expect(evaluateSingleRule(null, 'NOT_IN', ['x'])).toBe(true);
    });

    it('unknown operators fail closed', () => {
        expect(evaluateSingleRule('x', 'BOGUS' as never, 'x')).toBe(false);
    });

    it('numeric and string comparisons behave per operator semantics', () => {
        expect(evaluateSingleRule(720, 'BETWEEN', [700, 750])).toBe(true);
        expect(evaluateSingleRule(699, 'BETWEEN', [700, 750])).toBe(false);
        expect(evaluateSingleRule('California', 'CONTAINS', 'forn')).toBe(true);
        expect(evaluateSingleRule('California', 'STARTS_WITH', 'cali')).toBe(true);
        expect(evaluateSingleRule('TX', 'IN', ['tx', 'ca'])).toBe(true);
        expect(evaluateSingleRule('NY', 'NOT_IN', ['tx', 'ca'])).toBe(true);
    });
});

// ── StrategySpec tests ───────────────────────────────────────────────────

describe('StrategySpec', () => {
    const validSpec = {
        version: 1,
        name: 'Solar aggressive',
        gates: {
            vertical: 'solar',
            geoCountries: ['US'],
            minQualityScore: 70,
        },
        bidCurve: { type: 'linear', base: 20, slopePerQualityPoint: 0.5, min: 20, max: 80 },
        budget: { maxBidPerLead: 80, dailyBudget: 500 },
    };

    it('parses a valid spec and applies defaults', () => {
        const spec = parseStrategySpec(validSpec);
        expect(spec.gates.acceptOffSite).toBe(true);
        expect(spec.gates.requireVerified).toBe(false);
        expect(spec.budget.totalBudget).toBeNull();
    });

    it('rejects unknown versions and malformed curves', () => {
        expect(() => parseStrategySpec({ ...validSpec, version: 2 })).toThrow();
        expect(() => parseStrategySpec({ ...validSpec, bidCurve: { type: 'fixed' } })).toThrow();
        expect(() => parseStrategySpec({ ...validSpec, budget: { maxBidPerLead: -5 } })).toThrow();
    });

    it('computeBidAmount is deterministic and clamps to [min, max]', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 10000 }), (qs) => {
                const curve = { type: 'linear' as const, base: 20, slopePerQualityPoint: 0.5, min: 20, max: 80 };
                const amount = computeBidAmount(curve, qs);
                expect(amount).toBeGreaterThanOrEqual(20);
                expect(amount).toBeLessThanOrEqual(80);
                expect(computeBidAmount(curve, qs)).toBe(amount);
            }),
        );
    });

    it('fixed curve always returns base; floorPlus multiplies the floor', () => {
        expect(computeBidAmount({ type: 'fixed', base: 42 }, 5000)).toBe(42);
        expect(computeBidAmount({ type: 'floorPlus', floorMultiplier: 1.1, min: 1, max: 1000 }, null, 100)).toBe(110);
    });
});
