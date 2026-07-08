/**
 * Strategy Executor Tests (Phase C1)
 *
 * The executor must be pure and deterministic: same spec + lead + context
 * always yields the same decision. Budget envelope blocks are enforced
 * declaratively before any bid is suggested.
 */

import { executeStrategy, strategyToPreferenceSet } from '../src/agents/strategy/executor';
import { parseStrategySpec, type LeadData, type StrategySpec } from '@lead-engine/rules-engine';

const baseSpec: StrategySpec = parseStrategySpec({
    version: 1,
    name: 'CA Solar Sniper',
    description: 'High-quality California solar leads',
    gates: {
        vertical: 'solar',
        geoCountries: ['US'],
        geoInclude: ['CA'],
        geoExclude: [],
        minQualityScore: 70,
        acceptOffSite: true,
        requireVerified: false,
        fieldFilters: [],
    },
    bidCurve: { type: 'linear', base: 20, slopePerQualityPoint: 0.5, min: 15, max: 60 },
    budget: { maxBidPerLead: 60, dailyBudget: 200, totalBudget: null, maxConcurrentBids: 5 },
});

const matchingLead: LeadData = {
    id: 'lead-1',
    vertical: 'solar',
    geo: { country: 'US', state: 'CA' },
    source: 'API',
    qualityScore: 8000, // internal 0–10000 scale → 80 on buyer scale
    isVerified: true,
    reservePrice: 10,
    parameters: {},
};

describe('executeStrategy', () => {
    it('is deterministic — identical inputs produce identical decisions', () => {
        const a = executeStrategy(baseSpec, matchingLead, { spentTodayUsd: 50 });
        const b = executeStrategy(baseSpec, matchingLead, { spentTodayUsd: 50 });
        expect(a).toEqual(b);
    });

    it('bids on a matching lead with a linear curve amount', () => {
        const d = executeStrategy(baseSpec, matchingLead);
        expect(d.shouldBid).toBe(true);
        // base 20 + 0.5 × 80 = 60, clamped to max 60
        expect(d.bidAmount).toBe(60);
        expect(d.blockedBy).toBeNull();
    });

    it('blocks on gates for the wrong vertical', () => {
        const d = executeStrategy(baseSpec, { ...matchingLead, vertical: 'mortgage' });
        expect(d.shouldBid).toBe(false);
        expect(d.blockedBy).toBe('gates');
        expect(d.gateResult.gateResults.verticalMatch).toBe(false);
    });

    it('blocks on gates for an excluded/missing state', () => {
        const d = executeStrategy(baseSpec, { ...matchingLead, geo: { country: 'US', state: 'NY' } });
        expect(d.shouldBid).toBe(false);
        expect(d.blockedBy).toBe('gates');
    });

    it('blocks on gates below the quality threshold', () => {
        const d = executeStrategy(baseSpec, { ...matchingLead, qualityScore: 5000 });
        expect(d.shouldBid).toBe(false);
        expect(d.blockedBy).toBe('gates');
    });

    it('respects the reserve price as a hard floor', () => {
        const cheapCurve = parseStrategySpec({
            ...baseSpec,
            bidCurve: { type: 'fixed', base: 5 },
            budget: { ...baseSpec.budget, maxBidPerLead: 100 },
        });
        const d = executeStrategy(cheapCurve, { ...matchingLead, reservePrice: 12 });
        expect(d.shouldBid).toBe(true);
        expect(d.bidAmount).toBe(12);
    });

    it('blocks when the bid exceeds maxBidPerLead', () => {
        const tight = parseStrategySpec({ ...baseSpec, budget: { ...baseSpec.budget, maxBidPerLead: 30 } });
        const d = executeStrategy(tight, matchingLead);
        expect(d.shouldBid).toBe(false);
        expect(d.blockedBy).toBe('budget:maxBidPerLead');
    });

    it('blocks when the daily budget would be exceeded', () => {
        const d = executeStrategy(baseSpec, matchingLead, { spentTodayUsd: 150 });
        // 150 spent + 60 bid > 200 daily budget
        expect(d.shouldBid).toBe(false);
        expect(d.blockedBy).toBe('budget:dailyBudget');
    });

    it('blocks when the total budget would be exceeded', () => {
        const capped = parseStrategySpec({ ...baseSpec, budget: { ...baseSpec.budget, totalBudget: 100 } });
        const d = executeStrategy(capped, matchingLead, { totalSpentUsd: 50 });
        expect(d.shouldBid).toBe(false);
        expect(d.blockedBy).toBe('budget:totalBudget');
    });

    it('blocks at the concurrent bid cap', () => {
        const d = executeStrategy(baseSpec, matchingLead, { activeBidCount: 5 });
        expect(d.shouldBid).toBe(false);
        expect(d.blockedBy).toBe('budget:maxConcurrentBids');
    });

    it('uses the Data Feeds floor for floorPlus curves', () => {
        const floorSpec = parseStrategySpec({
            ...baseSpec,
            bidCurve: { type: 'floorPlus', floorMultiplier: 1.2, min: 10, max: 100 },
            budget: { ...baseSpec.budget, maxBidPerLead: 100, dailyBudget: null },
        });
        const d = executeStrategy(floorSpec, matchingLead, { dataFeedFloor: 40 });
        expect(d.shouldBid).toBe(true);
        expect(d.bidAmount).toBe(48); // 40 × 1.2
    });
});

describe('strategyToPreferenceSet', () => {
    it('maps gates faithfully onto the rules-engine contract', () => {
        const pref = strategyToPreferenceSet(baseSpec, 'strat-1');
        expect(pref.vertical).toBe('solar');
        expect(pref.geoInclude).toEqual(['CA']);
        expect(pref.minQualityScore).toBe(70);
        expect(pref.maxBidPerLead).toBe(60);
        expect(pref.id).toBe('strat-1');
    });
});
