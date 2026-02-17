/**
 * CRE Quality Score Algorithm Tests
 *
 * Tests the shared scoring JavaScript used both off-chain (pre-score)
 * and on the Chainlink Functions DON (on-chain).
 */

import { computeCREQualityScore, LeadScoringInput } from '../../src/lib/chainlink/cre-quality-score';

describe('computeCREQualityScore', () => {
    const baseInput: LeadScoringInput = {
        tcpaConsentAt: new Date(),
        geo: { state: 'FL', zip: '33101', country: 'US' },
        hasEncryptedData: true,
        encryptedDataValid: true,
        parameterCount: 5,
        source: 'DIRECT',
        zipMatchesState: true,
    };

    it('should return maximum score for a perfect lead', () => {
        const score = computeCREQualityScore(baseInput);
        expect(score).toBe(10000);
    });

    it('should return 0 for a completely empty lead', () => {
        const score = computeCREQualityScore({
            tcpaConsentAt: null,
            geo: null,
            hasEncryptedData: false,
            encryptedDataValid: false,
            parameterCount: 0,
            source: 'UNKNOWN',
            zipMatchesState: false,
        });
        // Only gets 500 for unknown source
        expect(score).toBe(500);
    });

    it('should give full TCPA points for fresh consent (<24h)', () => {
        const score = computeCREQualityScore({
            ...baseInput,
            tcpaConsentAt: new Date(), // now = fresh
        });
        // 2000 (TCPA) + 2000 (geo) + 2000 (data) + 2000 (params) + 2000 (source) = 10000
        expect(score).toBe(10000);
    });

    it('should decay TCPA score for older consent (15 days)', () => {
        const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
        const score = computeCREQualityScore({
            ...baseInput,
            tcpaConsentAt: fifteenDaysAgo,
        });
        // TCPA should be partially decayed
        expect(score).toBeLessThan(10000);
        expect(score).toBeGreaterThan(8000);
    });

    it('should give 0 TCPA points for expired consent (31 days)', () => {
        const expired = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
        const score = computeCREQualityScore({
            ...baseInput,
            tcpaConsentAt: expired,
        });
        // All other checks pass = 8000
        expect(score).toBe(8000);
    });

    it('should scale geo points correctly', () => {
        const noGeo = computeCREQualityScore({ ...baseInput, geo: null, zipMatchesState: false });
        const stateOnly = computeCREQualityScore({
            ...baseInput,
            geo: { state: 'FL' },
            zipMatchesState: false,
        });
        const stateAndZip = computeCREQualityScore({
            ...baseInput,
            geo: { state: 'FL', zip: '33101' },
            zipMatchesState: false,
        });
        const fullGeo = computeCREQualityScore({
            ...baseInput,
            geo: { state: 'FL', zip: '33101' },
            zipMatchesState: true,
        });

        expect(stateOnly - noGeo).toBe(800);     // state = 800
        expect(stateAndZip - stateOnly).toBe(600); // zip = 600
        expect(fullGeo - stateAndZip).toBe(600);   // cross-validation = 600
    });

    it('should give partial data integrity points for present but invalid encrypted data', () => {
        const valid = computeCREQualityScore(baseInput);
        const invalid = computeCREQualityScore({ ...baseInput, encryptedDataValid: false });
        const none = computeCREQualityScore({ ...baseInput, hasEncryptedData: false, encryptedDataValid: false });

        expect(valid - invalid).toBe(1500); // 2000 vs 500
        expect(invalid - none).toBe(500);   // 500 vs 0
    });

    it('should cap parameter points at 5', () => {
        const five = computeCREQualityScore({ ...baseInput, parameterCount: 5 });
        const ten = computeCREQualityScore({ ...baseInput, parameterCount: 10 });
        expect(five).toBe(ten); // Both capped at 2000
    });

    it('should score different sources correctly', () => {
        const direct = computeCREQualityScore({ ...baseInput, source: 'DIRECT' });
        const platform = computeCREQualityScore({ ...baseInput, source: 'PLATFORM' });
        const api = computeCREQualityScore({ ...baseInput, source: 'API' });
        const other = computeCREQualityScore({ ...baseInput, source: 'OTHER' });

        expect(direct).toBeGreaterThan(platform);
        expect(platform).toBeGreaterThan(api);
        expect(api).toBeGreaterThan(other);
    });

    it('should never exceed 10000', () => {
        const score = computeCREQualityScore({
            ...baseInput,
            parameterCount: 100, // well over cap
        });
        expect(score).toBeLessThanOrEqual(10000);
    });

    it('should never go below 0', () => {
        const score = computeCREQualityScore({
            tcpaConsentAt: null,
            geo: null,
            hasEncryptedData: false,
            encryptedDataValid: false,
            parameterCount: 0,
            source: '',
            zipMatchesState: false,
        });
        expect(score).toBeGreaterThanOrEqual(0);
    });
});
