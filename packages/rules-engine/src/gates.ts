/**
 * Canonical 7-gate buyer-rule evaluation — pure, deterministic, no I/O.
 *
 * This is THE single implementation. It runs:
 *   - inside the Chainlink DON (cre-workflows/EvaluateBuyerRulesAndMatch)
 *     with BFT consensus via consensusIdenticalAggregation
 *   - in the backend auto-bid engine (deterministic gates before real-time
 *     gates like budget/vault/duplicate)
 *   - in cre.service's local workflow mirror
 *
 * Gates:
 *   1. Vertical match (exact or wildcard '*')
 *   2. Geo country match (empty geoCountries defaults to ['US'])
 *   3. Geo state include/exclude lists
 *   4. Quality score threshold (buyer 0–100 scale vs internal 0–10000)
 *   5. Off-site toggle (acceptOffSite)
 *   6. Verified-only toggle (requireVerified)
 *   7. Field-level filter evaluation
 *
 * Real-time gates (budget, reserve price, vault balance, duplicates) are NOT
 * here — they depend on external state and live in the consuming services.
 */
import type { LeadData, MatchResult, PreferenceSet } from './types';
import { evaluateFieldFilters } from './field-filters';

export const RULES_ENGINE_VERSION = 1;

/**
 * Gate 1 vertical match: exact slug, wildcard '*', or parent prefix
 * (e.g. pref "solar" matches lead "solar.residential").
 */
export function verticalMatches(leadVertical: string, prefVertical: string): boolean {
    if (prefVertical === '*') return true;
    if (prefVertical === leadVertical) return true;
    return leadVertical.startsWith(`${prefVertical}.`);
}

export function evaluatePreferenceSet(lead: LeadData, pref: PreferenceSet): MatchResult {
    const result: MatchResult = {
        preferenceSetId: pref.id,
        buyerId: pref.buyerId,
        matched: true,
        reason: '',
        suggestedBidAmount: pref.autoBidAmount,
        gateResults: {
            verticalMatch: false,
            geoCountryMatch: false,
            geoStateMatch: false,
            qualityScoreMatch: false,
            offSiteMatch: false,
            verifiedMatch: false,
            fieldFilterMatch: false,
        },
    };

    // ── Gate 1: Vertical match ──
    if (!verticalMatches(lead.vertical, pref.vertical)) {
        result.matched = false;
        result.reason = `Vertical mismatch: ${lead.vertical} vs ${pref.vertical}`;
        return result;
    }
    result.gateResults.verticalMatch = true;

    // ── Gate 2: Geo country match ──
    const geoCountries = pref.geoCountries.length > 0 ? pref.geoCountries : ['US'];
    if (!geoCountries.includes(lead.geo.country)) {
        result.matched = false;
        result.reason = `Country mismatch: [${geoCountries.join(',')}] does not include ${lead.geo.country}`;
        return result;
    }
    result.gateResults.geoCountryMatch = true;

    // ── Gate 3: Geo state include/exclude ──
    const state = lead.geo.state ? lead.geo.state.toUpperCase() : '';
    if (state && pref.geoInclude.length > 0) {
        const included = pref.geoInclude.map((s) => s.toUpperCase());
        if (!included.includes(state)) {
            result.matched = false;
            result.reason = `State ${state} not in include list`;
            return result;
        }
    }
    if (state && pref.geoExclude.length > 0) {
        const excluded = pref.geoExclude.map((s) => s.toUpperCase());
        if (excluded.includes(state)) {
            result.matched = false;
            result.reason = `State ${state} in exclude list`;
            return result;
        }
    }
    result.gateResults.geoStateMatch = true;

    // ── Gate 4: Quality score threshold ──
    if (pref.minQualityScore != null && pref.minQualityScore > 0) {
        const leadScore = lead.qualityScore ?? 0;
        // Buyer sets minQualityScore on 0–100 scale; internal score is 0–10,000
        const internalThreshold = pref.minQualityScore * 100;
        if (leadScore < internalThreshold) {
            result.matched = false;
            result.reason = `Quality ${Math.floor(leadScore / 100)}/100 < min ${pref.minQualityScore}/100`;
            return result;
        }
    }
    result.gateResults.qualityScoreMatch = true;

    // ── Gate 5: Off-site toggle ──
    if (!pref.acceptOffSite && lead.source === 'OFFSITE') {
        result.matched = false;
        result.reason = 'Off-site leads rejected';
        return result;
    }
    result.gateResults.offSiteMatch = true;

    // ── Gate 6: Verified-only ──
    if (pref.requireVerified && !lead.isVerified) {
        result.matched = false;
        result.reason = 'Requires verified lead';
        return result;
    }
    result.gateResults.verifiedMatch = true;

    // ── Gate 7: Field-level filters ──
    if (pref.fieldFilters.length > 0) {
        const filterResult = evaluateFieldFilters(lead.parameters, pref.fieldFilters);
        if (!filterResult.pass) {
            result.matched = false;
            result.reason = `Field filter failed: ${filterResult.failedKeys.join(', ')}`;
            return result;
        }
    }
    result.gateResults.fieldFilterMatch = true;

    result.reason = `Matched: ${pref.label} → $${pref.autoBidAmount}`;
    return result;
}
