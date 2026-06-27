/**
 * Shared types for the canonical rules engine.
 *
 * These shapes are the contract between:
 *   - cre-workflows/EvaluateBuyerRulesAndMatch (runs in the Chainlink DON)
 *   - backend/src/services/auto-bid.service.ts (server-side auto-bid engine)
 *   - backend/src/services/cre.service.ts (CRE workflow local mirror)
 */

/** Lead data as evaluated by the gates (no PII). */
export interface LeadData {
    id: string;
    vertical: string;
    geo: {
        country: string;
        state?: string;
        city?: string;
        zip?: string;
    };
    source: string;
    qualityScore: number | null; // internal 0–10000 scale
    isVerified: boolean;
    reservePrice: number;
    parameters?: Record<string, unknown> | null;
}

export type FilterOperator =
    | 'EQUALS' | 'NOT_EQUALS'
    | 'IN' | 'NOT_IN'
    | 'GT' | 'GTE' | 'LT' | 'LTE'
    | 'BETWEEN'
    | 'CONTAINS' | 'STARTS_WITH';

/** A single field-level filter rule. */
export interface FieldFilter {
    fieldKey: string;   // must match Lead.parameters key
    operator: FilterOperator;
    value: string;      // JSON-encoded value
}

/** Buyer preference set (the rule document evaluated by the 7 gates). */
export interface PreferenceSet {
    id: string;
    buyerId: string;
    vertical: string;            // exact slug or '*'
    label: string;
    geoCountries: string[];      // empty → defaults to ['US']
    geoInclude: string[];
    geoExclude: string[];
    minQualityScore: number | null; // buyer-facing 0–100 scale
    acceptOffSite: boolean;
    requireVerified: boolean;
    autoBidAmount: number;
    maxBidPerLead: number | null;
    fieldFilters: FieldFilter[];
}

export interface GateResults {
    verticalMatch: boolean;
    geoCountryMatch: boolean;
    geoStateMatch: boolean;
    qualityScoreMatch: boolean;
    offSiteMatch: boolean;
    verifiedMatch: boolean;
    fieldFilterMatch: boolean;
}

/** Result of evaluating one preference set against one lead. */
export interface MatchResult {
    preferenceSetId: string;
    buyerId: string;
    matched: boolean;
    reason: string;
    suggestedBidAmount: number;
    gateResults: GateResults;
}

/** Result of evaluating field filter rules. */
export interface FilterEvalResult {
    pass: boolean;
    /** Keys of rules that failed (workflow consumers). */
    failedKeys: string[];
    /** Detailed failures (backend consumers). */
    failedRules: { fieldKey: string; operator: string; reason: string }[];
}
