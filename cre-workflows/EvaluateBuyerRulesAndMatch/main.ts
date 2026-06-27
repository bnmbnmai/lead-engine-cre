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

// Canonical rule evaluation — shared with the backend via packages/rules-engine.
// Bun bundles this TypeScript source directly into the WASM build, so the DON
// and the server run byte-identical gate logic.
import { evaluatePreferenceSet } from "../../packages/rules-engine/src/gates"
import type { MatchResult } from "../../packages/rules-engine/src/types"

// ── Config Schema ───────────────────────────────────────────────────────

const configSchema = z.object({
    schedule: z.string(),
    url: z.string(),
    // Phase B5: DON → backend feedback loop. Consensus match results are
    // POSTed here (POST /api/v1/auto-bid/match-results) so the backend
    // ingests the DON verdict idempotently instead of re-evaluating on its
    // own cron (split-brain fix).
    reportUrl: z.string(),
    owner: z.string(),
})

type Config = z.infer<typeof configSchema>

// ── Types & API Response Validation (Zod) ───────────────────────────────

const filterOperatorSchema = z.enum([
    "EQUALS", "NOT_EQUALS",
    "IN", "NOT_IN",
    "GT", "GTE", "LT", "LTE",
    "BETWEEN",
    "CONTAINS", "STARTS_WITH",
])

/** Field-level filter rule from a buyer preference set. */
const fieldFilterSchema = z.object({
    fieldKey: z.string(),
    operator: filterOperatorSchema,
    value: z.string(),
})

/** Lead data fetched from the backend API. */
const leadDataSchema = z.object({
    id: z.string().min(1),
    vertical: z.string(),
    geo: z.object({
        country: z.string(),
        state: z.string().optional(),
        city: z.string().optional(),
        zip: z.string().optional(),
    }),
    source: z.string(),
    qualityScore: z.number().nullable(),
    isVerified: z.boolean(),
    reservePrice: z.number(),
    parameters: z.record(z.string(), z.unknown()).nullish(),
})

/** Buyer preference set fetched from the backend API. */
const preferenceSetSchema = z.object({
    id: z.string().min(1),
    buyerId: z.string().min(1),
    vertical: z.string(),
    label: z.string(),
    geoCountries: z.array(z.string()),
    geoInclude: z.array(z.string()),
    geoExclude: z.array(z.string()),
    minQualityScore: z.number().nullable(),
    acceptOffSite: z.boolean(),
    requireVerified: z.boolean(),
    autoBidAmount: z.number(),
    maxBidPerLead: z.number().nullable(),
    fieldFilters: z.array(fieldFilterSchema),
})

/** Combined response from the /evaluate-lead endpoint. */
const evaluateLeadResponseSchema = z.object({
    lead: leadDataSchema.nullable(),
    preferenceSets: z.array(preferenceSetSchema),
})

/**
 * Aggregated result returned from the DON.
 * NOTE: deliberately contains NO timestamp — every field must be identical
 * across nodes for consensusIdenticalAggregation to succeed. The evaluatedAt
 * timestamp is added post-consensus from runtime.now() (DON Time).
 */
interface WorkflowResult {
    leadId: string
    totalPreferenceSets: number
    matchedSets: number
    results: MatchResult[]
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

    // Fail closed on HTTP errors: a silent empty result is indistinguishable
    // from "no matches" downstream and masks backend/auth outages.
    if (!ok(response)) {
        throw new Error(
            `evaluate-lead request failed: HTTP ${response.statusCode ?? "?"} from ${config.url}`
        )
    }

    // Parse + validate combined response: { lead, preferenceSets }
    const bodyStr = new TextDecoder().decode(response.body ?? new Uint8Array(0))
    let parsedBody: unknown
    try {
        parsedBody = JSON.parse(bodyStr)
    } catch {
        throw new Error(`evaluate-lead returned non-JSON body (${bodyStr.slice(0, 120)})`)
    }

    const validation = evaluateLeadResponseSchema.safeParse(parsedBody)
    if (!validation.success) {
        throw new Error(`evaluate-lead response failed schema validation: ${validation.error.message}`)
    }
    const data = validation.data

    // No pending lead is a legitimate (non-error) outcome — nothing to evaluate.
    if (!data.lead) {
        return {
            leadId: "none",
            totalPreferenceSets: 0,
            matchedSets: 0,
            results: [],
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
    }
}

// ── Match-Result Report Fetcher (Phase B5 feedback loop) ───────────────

/** Serializable input for the report request (no closures — static DAG). */
interface ReportInput {
    url: string
    owner: string
    /** Pre-serialized JSON body — built post-consensus, identical on all nodes. */
    body: string
}

/** Deterministic receipt — identical across nodes so consensus succeeds. */
interface ReportReceipt {
    ok: boolean
    leadId: string
}

/**
 * POST the consensus match results back to the backend ingestion endpoint.
 * The backend response is deliberately deterministic ({ok, leadId}) even on
 * duplicate delivery, so consensusIdenticalAggregation never diverges when
 * one node's request lands first and the rest are idempotent no-ops.
 */
const reportMatchResults = (
    sendRequester: ConfidentialHTTPSendRequester,
    input: ReportInput
): ReportReceipt => {
    const response = sendRequester
        .sendRequest({
            request: {
                url: input.url,
                method: "POST",
                bodyString: input.body,
                multiHeaders: {
                    "content-type": { values: ["application/json"] },
                    "x-cre-api-key": { values: ["{{.creApiKey}}"] },
                },
            },
            vaultDonSecrets: [
                { key: "creApiKey", owner: input.owner },
            ],
            encryptOutput: false,
        })
        .result()

    if (!ok(response)) {
        throw new Error(
            `match-results report failed: HTTP ${response.statusCode ?? "?"} from ${input.url}`
        )
    }

    const bodyStr = new TextDecoder().decode(response.body ?? new Uint8Array(0))
    try {
        const parsed = JSON.parse(bodyStr) as { ok?: boolean; leadId?: string }
        return { ok: parsed.ok === true, leadId: parsed.leadId ?? "unknown" }
    } catch {
        throw new Error(`match-results report returned non-JSON body (${bodyStr.slice(0, 120)})`)
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

    // DON Time (consensus-derived) — deterministic across nodes, unlike
    // new Date() which would break consensusIdenticalAggregation.
    const evaluatedAt = runtime.now().toISOString()

    // ── Phase B5: report consensus matches back to the backend ──
    // Second sendRequest with its own top-level fetcher and serializable
    // input (no runtime-computed URL, no closures) — the static-DAG
    // constraint only forbids dynamic request *structure*, not data inputs.
    let reportStatus = "skipped (no lead)"
    if (result.leadId !== "none") {
        const reportBody = JSON.stringify({
            leadId: result.leadId,
            evaluatedAt,
            results: result.results.map((r) => ({
                preferenceSetId: r.preferenceSetId,
                buyerId: r.buyerId,
                matched: r.matched,
                reason: r.reason,
                bidAmount: r.matched ? r.suggestedBidAmount : undefined,
            })),
        })

        const receipt = confHTTPClient
            .sendRequest(
                runtime,
                reportMatchResults,
                consensusIdenticalAggregation<ReportReceipt>()
            )({
                url: runtime.config.reportUrl,
                owner: runtime.config.owner,
                body: reportBody,
            })
            .result()

        reportStatus = receipt.ok ? `delivered (${receipt.leadId})` : "rejected by backend"
    }

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

    runtime.log(`Evaluated at: ${evaluatedAt}`)
    runtime.log(`Match-result report: ${reportStatus}`)
    runtime.log("---")

    return JSON.stringify({ ...result, evaluatedAt, reportStatus })
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
