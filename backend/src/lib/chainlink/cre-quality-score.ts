// ============================================
// CRE Quality Score — Shared Scoring JavaScript
// ============================================
//
// This is the AUTHORITATIVE scoring logic used in two places:
//
//   1. OFF-CHAIN at lead submission → numeric pre-score (0–10,000)
//      Stored in lead.qualityScore immediately so buyers can see it.
//
//   2. ON-CHAIN via CREVerifier.sol → runs on Chainlink Functions DON
//      Uploaded via setSourceCode(2, source). Confirms/updates the score
//      after NFT mint. The DON version receives the same inputs as args[].
//
// The scoring uses the same data that verifyLead() validates:
// TCPA freshness, geo completeness, data integrity, parameter richness,
// and source quality. No synthetic additions — every point is tied to a
// verifiable lead attribute.
//
// Score breakdown (0–10,000):
//   TCPA freshness:      0–2,000  (linear decay over 30 days)
//   Geo completeness:    0–2,000  (state + zip + cross-validation)
//   Data integrity:      0–2,000  (encrypted PII with valid structure)
//   Parameter richness:  0–2,000  (up to 5 meaningful parameters)
//   Source quality:       0–2,000  (DIRECT > PLATFORM > API > OTHER)
// ============================================

export interface LeadScoringInput {
    tcpaConsentAt: Date | string | null;
    geo: {
        state?: string;
        zip?: string;
        country?: string;
        geoHash?: string;
    } | null;
    hasEncryptedData: boolean;         // encryptedData is a non-null string
    encryptedDataValid: boolean;       // parsed JSON has ciphertext, iv, tag
    parameterCount: number;            // count of non-empty lead parameters
    source: string;                    // DIRECT, PLATFORM, API, OTHER
    zipMatchesState: boolean;          // zip↔state cross-validation passed
}

/**
 * Compute a CRE quality score (0–10,000) from lead attributes.
 *
 * This is the SAME algorithm that runs on the Chainlink Functions DON.
 * It scores leads based on verifiable data — no synthetic bonuses.
 */
export function computeCREQualityScore(input: LeadScoringInput): number {
    let score = 0;

    // ── TCPA Freshness (0–2,000) ──────────────────
    // Full points if consent < 24h old, linear decay to 0 at 30 days.
    if (input.tcpaConsentAt) {
        const consentTime = new Date(input.tcpaConsentAt).getTime();
        const ageMs = Date.now() - consentTime;
        const ageHours = ageMs / (1000 * 60 * 60);
        const maxAgeHours = 30 * 24; // 30 days

        if (ageHours <= 0) {
            score += 2000; // Future or now = full freshness
        } else if (ageHours <= 24) {
            score += 2000; // Less than 24h old = full points
        } else if (ageHours < maxAgeHours) {
            // Linear decay from 2000 to 0 between 24h and 30 days
            const remaining = 1 - ((ageHours - 24) / (maxAgeHours - 24));
            score += Math.round(2000 * remaining);
        }
        // >= 30 days: 0 points (would fail verifyLead anyway)
    }

    // ── Geo Completeness (0–2,000) ────────────────
    if (input.geo) {
        if (input.geo.state) score += 800;
        if (input.geo.zip) score += 600;
        if (input.zipMatchesState) score += 600;
    }

    // ── Data Integrity (0–2,000) ──────────────────
    // Full points if encrypted PII is present and structurally valid.
    if (input.hasEncryptedData && input.encryptedDataValid) {
        score += 2000;
    } else if (input.hasEncryptedData) {
        score += 500; // Present but malformed
    }

    // ── Parameter Richness (0–2,000) ──────────────
    // +400 per meaningful parameter, capped at 5 (2,000).
    const paramPoints = Math.min(input.parameterCount, 5) * 400;
    score += paramPoints;

    // ── Source Quality (0–2,000) ───────────────────
    const sourceScores: Record<string, number> = {
        'DIRECT': 2000,
        'PLATFORM': 1500,
        'API': 1000,
        'REFERRAL': 1500,
        'ORGANIC': 1200,
    };
    score += sourceScores[input.source?.toUpperCase()] || 500;

    return Math.min(10000, Math.max(0, score));
}

// ============================================
// DON Source Code (for setSourceCode upload)
// ============================================
//
// This is the Chainlink Functions-compatible version of the same algorithm.
// It receives lead data as args[] from the CREVerifier contract.
//
// To upload: await creVerifier.setSourceCode(2, DON_QUALITY_SCORE_SOURCE);

export const DON_QUALITY_SCORE_SOURCE = `
// CRE Quality Score — Chainlink Functions DON Source
// Receives: args[0] = leadTokenId
// The DON fetches lead data from the Lead Engine API and scores it.

const leadTokenId = args[0];

// Fetch lead data from the API (the DON has HTTP access)
const response = await Functions.makeHttpRequest({
    url: \`\${secrets.apiBaseUrl}/api/marketplace/leads/\${leadTokenId}/scoring-data\`,
    headers: { 'x-cre-key': secrets.creApiKey },
});

if (response.error) {
    throw Error('Failed to fetch lead data');
}

const d = response.data;
let score = 0;

// TCPA freshness (0–2000)
if (d.tcpaConsentAt) {
    const ageH = (Date.now() - new Date(d.tcpaConsentAt).getTime()) / 3600000;
    if (ageH <= 24) score += 2000;
    else if (ageH < 720) score += Math.round(2000 * (1 - (ageH - 24) / 696));
}

// Geo completeness (0–2000)
if (d.geo) {
    if (d.geo.state) score += 800;
    if (d.geo.zip) score += 600;
    if (d.zipMatchesState) score += 600;
}

// Data integrity (0–2000)
if (d.hasEncryptedData && d.encryptedDataValid) score += 2000;
else if (d.hasEncryptedData) score += 500;

// Parameter richness (0–2000)
score += Math.min(d.parameterCount || 0, 5) * 400;

// Source quality (0–2000)
const srcMap = { DIRECT: 2000, PLATFORM: 1500, API: 1000, REFERRAL: 1500, ORGANIC: 1200 };
score += srcMap[d.source] || 500;

score = Math.min(10000, Math.max(0, score));

// Return as uint16 ABI-encoded for the contract
return Functions.encodeUint256(score);
`;
