// ============================================================================
// CRE Workflow: EvaluateBuyerRulesAndMatch
// ============================================================================
//
// Production CRE workflow that evaluates buyer preference rules against
// incoming leads inside the Chainlink DON. Uses the @chainlink/cre-sdk
// ConfidentialHTTPClient to fetch lead + buyer preference sets from the
// Lead Engine CRE backend API in a SINGLE request, then runs deterministic
// 7-gate rule evaluation with BFT consensus via consensusIdenticalAggregation.
//
// Architecture (hybrid model):
//   DON (this workflow):
//     1. Fetch lead + active preference sets via ONE Confidential HTTP call
//     2. Evaluate each preference set against lead (7 deterministic gates)
//     3. Return match results with consensus
//
//   Server-side (cre.service.ts → auto-bid.service.ts):
//     4. Receive match results from DON
//     5. Execute real-time gates (budget, vault lock, duplicate check)
//     6. Place bids for approved matches
//
// Gates evaluated in-DON (deterministic, no external state):
//   Gate 1: Vertical match (exact or wildcard '*')
//   Gate 2: Geo country match
//   Gate 3: Geo state include/exclude lists
//   Gate 4: Quality score threshold (minQualityScore)
//   Gate 5: Off-site toggle (acceptOffSite)
//   Gate 6: Verified-only toggle (requireVerified)
//   Gate 7: Field-level filter evaluation (EQUALS, IN, GT, LT, etc.)
//
// IMPORTANT: The ConfidentialHTTPClient handler supports exactly ONE
// sendRequester.sendRequest() call per invocation. The SDK builds a static
// capability DAG at compile time — runtime-computed URLs from prior HTTP
// responses produce function references the protobuf serializer cannot decode.
// This is why we use the combined /evaluate-lead endpoint.
//
// Reference: cre-templates/conf-http-demo/my-workflow/main.ts
// ============================================================================

import {
    CronCapability,
    ConfidentialHTTPClient,
    handler,
    consensusIdenticalAggregation,
    ok,
    type ConfidentialHTTPSendRequester,
    type Runtime,
    Runner,
} from "@chainlink/cre-sdk"
import { z } from "zod"

// ── Config Schema ───────────────────────────────────────────────────────

const configSchema = z.object({
    schedule: z.string(),
    url: z.string(),
    owner: z.string(),
})

type Config = z.infer<typeof configSchema>

// ── Types ───────────────────────────────────────────────────────────────

/** Lead data fetched from the backend API. */
interface LeadData {
    id: string
    vertical: string
    geo: {
        country: string
        state?: string
        city?: string
        zip?: string
    }
    source: string
    qualityScore: number | null
    isVerified: boolean
    reservePrice: number
    parameters?: Record<string, unknown> | null
}

/** Buyer preference set fetched from the backend API. */
interface PreferenceSet {
    id: string
    buyerId: string
    vertical: string
    label: string
    geoCountries: string[]
    geoInclude: string[]
    geoExclude: string[]
    minQualityScore: number | null
    acceptOffSite: boolean
    requireVerified: boolean
    autoBidAmount: number
    maxBidPerLead: number | null
    fieldFilters: FieldFilter[]
}

/** Field-level filter rule from a buyer preference set. */
interface FieldFilter {
    fieldKey: string
    operator: FilterOperator
    value: string
}

type FilterOperator =
    | "EQUALS" | "NOT_EQUALS"
    | "IN" | "NOT_IN"
    | "GT" | "GTE" | "LT" | "LTE"
    | "BETWEEN"
    | "CONTAINS" | "STARTS_WITH"

/** Combined response from the /evaluate-lead endpoint. */
interface EvaluateLeadResponse {
    lead: LeadData | null
    preferenceSets: PreferenceSet[]
}

/** Result of evaluating a single preference set against a lead. */
interface MatchResult {
    preferenceSetId: string
    buyerId: string
    matched: boolean
    reason: string
    suggestedBidAmount: number
    gateResults: {
        verticalMatch: boolean
        geoCountryMatch: boolean
        geoStateMatch: boolean
        qualityScoreMatch: boolean
        offSiteMatch: boolean
        verifiedMatch: boolean
        fieldFilterMatch: boolean
    }
}

/** Aggregated result returned from the DON. */
interface WorkflowResult {
    leadId: string
    totalPreferenceSets: number
    matchedSets: number
    results: MatchResult[]
    evaluatedAt: string
}

// ── Gate Evaluation (Pure, Deterministic) ────────────────────────────────

/**
 * Evaluate all 7 deterministic gates for a single preference set.
 * Pure function — no external state, no async, fully deterministic.
 * This is the core logic that runs inside the DON with BFT consensus.
 */
function evaluatePreferenceSet(lead: LeadData, pref: PreferenceSet): MatchResult {
    const result: MatchResult = {
        preferenceSetId: pref.id,
        buyerId: pref.buyerId,
        matched: true,
        reason: "",
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
    }

    // ── Gate 1: Vertical match ──
    if (pref.vertical !== "*" && pref.vertical !== lead.vertical) {
        result.matched = false
        result.reason = `Vertical mismatch: ${lead.vertical} vs ${pref.vertical}`
        return result
    }
    result.gateResults.verticalMatch = true

    // ── Gate 2: Geo country match ──
    const geoCountries = pref.geoCountries.length > 0 ? pref.geoCountries : ["US"]
    if (!geoCountries.includes(lead.geo.country)) {
        result.matched = false
        result.reason = `Country mismatch: [${geoCountries.join(",")}] does not include ${lead.geo.country}`
        return result
    }
    result.gateResults.geoCountryMatch = true

    // ── Gate 3: Geo state include/exclude ──
    const state = lead.geo.state?.toUpperCase() ?? ""
    if (state && pref.geoInclude.length > 0) {
        const included = pref.geoInclude.map((s) => s.toUpperCase())
        if (!included.includes(state)) {
            result.matched = false
            result.reason = `State ${state} not in include list`
            return result
        }
    }
    if (state && pref.geoExclude.length > 0) {
        const excluded = pref.geoExclude.map((s) => s.toUpperCase())
        if (excluded.includes(state)) {
            result.matched = false
            result.reason = `State ${state} in exclude list`
            return result
        }
    }
    result.gateResults.geoStateMatch = true

    // ── Gate 4: Quality score threshold ──
    if (pref.minQualityScore != null && pref.minQualityScore > 0) {
        const leadScore = lead.qualityScore ?? 0
        // Buyer sets minQualityScore on 0–100 scale; internal score is 0–10,000
        const internalThreshold = pref.minQualityScore * 100
        if (leadScore < internalThreshold) {
            result.matched = false
            result.reason = `Quality ${Math.floor(leadScore / 100)}/100 < min ${pref.minQualityScore}/100`
            return result
        }
    }
    result.gateResults.qualityScoreMatch = true

    // ── Gate 5: Off-site toggle ──
    if (!pref.acceptOffSite && lead.source === "OFFSITE") {
        result.matched = false
        result.reason = "Off-site leads rejected"
        return result
    }
    result.gateResults.offSiteMatch = true

    // ── Gate 6: Verified-only ──
    if (pref.requireVerified && !lead.isVerified) {
        result.matched = false
        result.reason = "Requires verified lead"
        return result
    }
    result.gateResults.verifiedMatch = true

    // ── Gate 7: Field-level filters ──
    if (pref.fieldFilters.length > 0) {
        const filterResult = evaluateFieldFilters(lead.parameters, pref.fieldFilters)
        if (!filterResult.pass) {
            result.matched = false
            result.reason = `Field filter failed: ${filterResult.failedKeys.join(", ")}`
            return result
        }
    }
    result.gateResults.fieldFilterMatch = true

    result.reason = `Matched: ${pref.label} → $${pref.autoBidAmount}`
    return result
}

// ── Field Filter Evaluation (Pure, Deterministic) ────────────────────────

/**
 * Evaluate field-level filter rules against lead parameters.
 * All rules must pass (AND logic). Self-contained — no imports needed.
 * Mirrors backend/src/services/field-filter.service.ts exactly.
 */
function evaluateFieldFilters(
    parameters: Record<string, unknown> | null | undefined,
    rules: FieldFilter[]
): { pass: boolean; failedKeys: string[] } {
    const failedKeys: string[] = []
    if (!rules || rules.length === 0) return { pass: true, failedKeys }

    const params = parameters || {}

    for (const rule of rules) {
        const leadValue = params[rule.fieldKey]
        let filterValue: unknown
        try {
            filterValue = JSON.parse(rule.value)
        } catch {
            filterValue = rule.value
        }

        if (!evaluateSingleRule(leadValue, rule.operator, filterValue)) {
            failedKeys.push(rule.fieldKey)
        }
    }

    return { pass: failedKeys.length === 0, failedKeys }
}

/** Evaluate a single filter rule. Pure function. */
function evaluateSingleRule(
    leadValue: unknown,
    operator: FilterOperator,
    filterValue: unknown
): boolean {
    if (leadValue === undefined || leadValue === null) {
        if (operator === "NOT_EQUALS") return filterValue !== null && filterValue !== undefined
        if (operator === "NOT_IN") return true
        return false
    }

    switch (operator) {
        case "EQUALS":
            return normalize(leadValue) === normalize(filterValue)
        case "NOT_EQUALS":
            return normalize(leadValue) !== normalize(filterValue)
        case "IN": {
            if (!Array.isArray(filterValue)) return false
            const list = filterValue.map(normalize)
            return list.includes(normalize(leadValue))
        }
        case "NOT_IN": {
            if (!Array.isArray(filterValue)) return true
            const list = filterValue.map(normalize)
            return !list.includes(normalize(leadValue))
        }
        case "GT":
            return toNumber(leadValue) > toNumber(filterValue)
        case "GTE":
            return toNumber(leadValue) >= toNumber(filterValue)
        case "LT":
            return toNumber(leadValue) < toNumber(filterValue)
        case "LTE":
            return toNumber(leadValue) <= toNumber(filterValue)
        case "BETWEEN": {
            if (!Array.isArray(filterValue) || filterValue.length !== 2) return false
            const num = toNumber(leadValue)
            return num >= toNumber(filterValue[0]) && num <= toNumber(filterValue[1])
        }
        case "CONTAINS":
            return String(leadValue).toLowerCase().includes(String(filterValue).toLowerCase())
        case "STARTS_WITH":
            return String(leadValue).toLowerCase().startsWith(String(filterValue).toLowerCase())
        default:
            return false
    }
}

function normalize(val: unknown): string | number {
    if (typeof val === "number") return val
    if (typeof val === "boolean") return String(val)
    return String(val).toLowerCase().trim()
}

function toNumber(val: unknown): number {
    const num = Number(val)
    return isNaN(num) ? 0 : num
}

// ── Confidential HTTP Fetcher ───────────────────────────────────────────

/**
 * Fetch lead data + buyer preference sets from the backend API via
 * Confidential HTTP in a SINGLE request.
 *
 * CRITICAL: The CRE SDK only supports ONE sendRequester.sendRequest() call
 * per handler callback. The SDK builds a static capability DAG at compile
 * time — two sequential calls (especially where the second URL depends on
 * the first response) produce a function reference the protobuf serializer
 * cannot decode, yielding:
 *   "cannot decode message ConfidentialHTTPRequest from JSON: function"
 *
 * Solution: The /evaluate-lead endpoint returns BOTH lead and matching
 * preference sets in a single JSON response.
 *
 * Reference: cre-templates/conf-http-demo/my-workflow/main.ts line 64-92
 */
const fetchEvaluationData = (
    sendRequester: ConfidentialHTTPSendRequester,
    config: Config
): WorkflowResult => {
    const response = sendRequester
        .sendRequest({
            request: {
                url: config.url,
                method: "GET",
                multiHeaders: {
                    "x-cre-api-key": { values: ["{{.creApiKey}}"] },
                },
            },
            vaultDonSecrets: [
                { key: "creApiKey", owner: config.owner },
            ],
            encryptOutput: false,
        })
        .result()

    if (!ok(response)) {
        return {
            leadId: "unknown",
            totalPreferenceSets: 0,
            matchedSets: 0,
            results: [],
            evaluatedAt: new Date().toISOString(),
        }
    }

    // Parse combined response: { lead, preferenceSets }
    const bodyStr = new TextDecoder().decode(response.body ?? new Uint8Array(0))
    const data: EvaluateLeadResponse = JSON.parse(bodyStr)

    if (!data.lead) {
        return {
            leadId: "none",
            totalPreferenceSets: 0,
            matchedSets: 0,
            results: [],
            evaluatedAt: new Date().toISOString(),
        }
    }

    // Evaluate each preference set against the lead (deterministic)
    const results: MatchResult[] = []
    for (let i = 0; i < data.preferenceSets.length; i++) {
        results.push(evaluatePreferenceSet(data.lead, data.preferenceSets[i]))
    }

    let matchedCount = 0
    for (let i = 0; i < results.length; i++) {
        if (results[i].matched) matchedCount++
    }

    return {
        leadId: data.lead.id,
        totalPreferenceSets: data.preferenceSets.length,
        matchedSets: matchedCount,
        results,
        evaluatedAt: new Date().toISOString(),
    }
}

// ── Workflow Handler ────────────────────────────────────────────────────

/**
 * Main workflow handler. Triggered by CronCapability.
 * Fetches lead + preferences via ONE Confidential HTTP call, evaluates
 * rules, returns match results with BFT consensus.
 *
 * Pattern matches conf-http-demo/main.ts exactly:
 *   confHTTPClient.sendRequest(runtime, callback, consensus)(config).result()
 */
const onCronTrigger = (runtime: Runtime<Config>): string => {
    const confHTTPClient = new ConfidentialHTTPClient()

    const result = confHTTPClient
        .sendRequest(
            runtime,
            fetchEvaluationData,
            consensusIdenticalAggregation<WorkflowResult>()
        )(runtime.config)
        .result()

    runtime.log("--- EvaluateBuyerRulesAndMatch Results ---")
    runtime.log(`Lead ID: ${result.leadId}`)
    runtime.log(`Total preference sets evaluated: ${result.totalPreferenceSets}`)
    runtime.log(`Matched sets: ${result.matchedSets}`)

    for (let i = 0; i < result.results.length; i++) {
        const match = result.results[i]
        if (match.matched) {
            runtime.log(`  OK ${match.preferenceSetId} (buyer: ${match.buyerId}) $${match.suggestedBidAmount}`)
        } else {
            runtime.log(`  SKIP ${match.preferenceSetId}: ${match.reason}`)
        }
    }

    runtime.log(`Evaluated at: ${result.evaluatedAt}`)
    runtime.log("---")

    return JSON.stringify(result)
}

// ── Workflow Init ───────────────────────────────────────────────────────

const initWorkflow = (config: Config) => {
    return [
        handler(
            new CronCapability().trigger({
                schedule: config.schedule,
            }),
            onCronTrigger
        ),
    ]
}

export async function main() {
    const runner = await Runner.newRunner<Config>({ configSchema })
    await runner.run(initWorkflow)
}
