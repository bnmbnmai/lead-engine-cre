/**
 * Chainlink Functions Source — Bounty Criteria Matching
 *
 * Executed by the Chainlink DON. Receives lead attributes and pool criteria
 * as arguments, evaluates AND-logic per pool, returns matched pool IDs.
 *
 * Args (from contract):
 *   [0] leadId          — Platform lead ID string
 *   [1] qualityScore    — Lead quality score (0–10000)
 *   [2] creditScore     — Lead credit score (300–850, or 0 if unknown)
 *   [3] geoState        — 2-letter US state code (e.g. "CA") or empty
 *   [4] geoCountry      — 2-letter country code (e.g. "US") or empty
 *   [5] leadAgeHours    — Hours since lead creation
 *   [6] criteriaJSON    — JSON array of pool criteria objects:
 *        [{
 *          poolId: string,
 *          minQualityScore?: number,
 *          geoStates?: string[],
 *          geoCountries?: string[],
 *          minCreditScore?: number,
 *          maxLeadAge?: number
 *        }]
 *
 * Returns:
 *   Bytes via Functions.encodeString():
 *     Comma-separated matched pool IDs, or empty string if no matches.
 *     e.g. "pool-1,pool-3" or ""
 *
 *   The contract parses this string to extract individual pool IDs
 *   and derives matchFound from string length > 0.
 */

// Parse lead attributes from args
const leadId = args[0];
const qualityScore = parseInt(args[1]) || 0;
const creditScore = parseInt(args[2]) || 0;
const geoState = args[3] || "";
const geoCountry = args[4] || "";
const leadAgeHours = parseFloat(args[5]) || 0;

// Parse pool criteria
let pools;
try {
    pools = JSON.parse(args[6]);
} catch (e) {
    throw Error("Invalid criteriaJSON");
}

if (!Array.isArray(pools)) {
    throw Error("criteriaJSON must be an array");
}

// Evaluate each pool against lead attributes (AND logic)
const matchedPoolIds = [];

for (const pool of pools) {
    let matched = true;

    // 1. Minimum quality score
    if (pool.minQualityScore != null && qualityScore < pool.minQualityScore) {
        matched = false;
    }

    // 2. Geo state allowlist
    if (matched && pool.geoStates && pool.geoStates.length > 0) {
        if (!geoState || !pool.geoStates.includes(geoState)) {
            matched = false;
        }
    }

    // 3. Geo country allowlist
    if (matched && pool.geoCountries && pool.geoCountries.length > 0) {
        if (!geoCountry || !pool.geoCountries.includes(geoCountry)) {
            matched = false;
        }
    }

    // 4. Minimum credit score
    if (matched && pool.minCreditScore != null && creditScore < pool.minCreditScore) {
        matched = false;
    }

    // 5. Maximum lead age (hours)
    if (matched && pool.maxLeadAge != null && leadAgeHours > pool.maxLeadAge) {
        matched = false;
    }

    if (matched) {
        matchedPoolIds.push(pool.poolId || "unknown");
    }
}

// Return comma-separated pool IDs as a string
// The contract splits on "," and derives matchFound from length > 0
return Functions.encodeString(matchedPoolIds.join(","));
