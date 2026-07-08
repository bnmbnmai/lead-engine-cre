// ============================================================================
// CRE Workflow: DecryptForWinner (Phase B4 rebuild)
// ============================================================================
//
// Winner-only PII delivery through the Chainlink DON. Mirrors the proven
// EvaluateBuyerRulesAndMatch pattern: cron trigger + ONE Confidential HTTP
// request per invocation + consensusIdenticalAggregation + Vault DON secrets.
//
// Flow:
//   1. The auction winner enqueues a decrypt request server-side
//      (POST /api/v1/cre/decrypt-request — winner verified at enqueue time).
//   2. This workflow polls GET /api/v1/cre/decrypt-pending on a cron schedule,
//      authenticating with the creApiKey Vault DON secret.
//   3. The backend RE-VERIFIES the winner at delivery time, decrypts the PII
//      (per-lead DEK unwrapped under the master KEK — envelope encryption)
//      and returns it over the Confidential HTTP channel.
//   4. encryptOutput: true — the response payload is encrypted inside the
//      confidential context so individual node operators cannot read the PII.
//   5. The CONSENSUS OUTPUT of this workflow is a delivery RECEIPT only
//      (requestId, leadId, winnerId, dataHash). Raw PII is never logged and
//      never included in the aggregated workflow result.
//
// ⚠️ Confidential HTTP GA status: per Chainlink docs, Confidential HTTP is
// simulation-only until GA. Until then the documented fallback is the direct
// server-side delivery path (POST /leads/:leadId/decrypt-pii over mTLS with
// winner JWT verification), which enforces the same winner checks. Track the
// GA checklist in docs/ENV_VARS.md before promoting this workflow.
//
// Reference: cre-workflows/EvaluateBuyerRulesAndMatch/main.ts
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

// ── API Response Validation (Zod) ───────────────────────────────────────

/** A pending decrypt request served by the backend queue. */
const decryptRequestSchema = z.object({
    requestId: z.string().min(1),
    leadId: z.string().min(1),
    winnerId: z.string().min(1),
    dataHash: z.string().min(1),
    // PII payload — stays inside the confidential context; deliberately
    // schema'd as an opaque record and NEVER copied into the receipt.
    pii: z.record(z.string(), z.unknown()),
})

const decryptPendingResponseSchema = z.object({
    request: decryptRequestSchema.nullable(),
})

/**
 * Aggregated result returned from the DON: a delivery receipt.
 * NOTE: contains NO timestamp and NO PII — every field must be identical
 * across nodes for consensusIdenticalAggregation, and the plaintext must
 * never leave the confidential channel.
 */
interface DeliveryReceipt {
    requestId: string
    leadId: string
    winnerId: string
    dataHash: string
    piiFieldCount: number
    delivered: boolean
}

const EMPTY_RECEIPT: DeliveryReceipt = {
    requestId: "none",
    leadId: "none",
    winnerId: "none",
    dataHash: "0x0",
    piiFieldCount: 0,
    delivered: false,
}

// ── Confidential HTTP Fetcher ───────────────────────────────────────────

/**
 * Poll the decrypt queue via a SINGLE Confidential HTTP request.
 *
 * CRITICAL: the CRE SDK supports exactly ONE sendRequester.sendRequest()
 * call per handler invocation (static capability DAG) — which is why the
 * backend pops, verifies, decrypts and marks DELIVERED in one endpoint.
 */
const fetchDecryptDelivery = (
    sendRequester: ConfidentialHTTPSendRequester,
    config: Config
): DeliveryReceipt => {
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
            // PII in transit: encrypt the response payload inside the
            // confidential context — node operators never see plaintext.
            encryptOutput: true,
        })
        .result()

    // Fail closed on HTTP errors — a silent empty receipt would mask
    // backend/auth outages from the workflow logs.
    if (!ok(response)) {
        throw new Error(
            `decrypt-pending request failed: HTTP ${response.statusCode ?? "?"} from ${config.url}`
        )
    }

    const bodyStr = new TextDecoder().decode(response.body ?? new Uint8Array(0))
    let parsedBody: unknown
    try {
        parsedBody = JSON.parse(bodyStr)
    } catch {
        throw new Error(`decrypt-pending returned non-JSON body (${bodyStr.slice(0, 120)})`)
    }

    const validation = decryptPendingResponseSchema.safeParse(parsedBody)
    if (!validation.success) {
        throw new Error(`decrypt-pending response failed schema validation: ${validation.error.message}`)
    }

    const request = validation.data.request
    if (!request) {
        return EMPTY_RECEIPT // empty queue — legitimate non-error outcome
    }

    // Receipt only: dataHash lets the winner verify integrity of the PII
    // they received without the plaintext ever entering the consensus value.
    return {
        requestId: request.requestId,
        leadId: request.leadId,
        winnerId: request.winnerId,
        dataHash: request.dataHash,
        piiFieldCount: Object.keys(request.pii).length,
        delivered: true,
    }
}

// ── Workflow Handler ────────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>): string => {
    const confHTTPClient = new ConfidentialHTTPClient()

    const receipt = confHTTPClient
        .sendRequest(
            runtime,
            fetchDecryptDelivery,
            consensusIdenticalAggregation<DeliveryReceipt>()
        )(runtime.config)
        .result()

    // DON Time (consensus-derived) — deterministic across nodes.
    const deliveredAt = runtime.now().toISOString()

    runtime.log("--- DecryptForWinner Receipt ---")
    if (receipt.delivered) {
        runtime.log(`Request: ${receipt.requestId}`)
        runtime.log(`Lead: ${receipt.leadId} → winner ${receipt.winnerId}`)
        runtime.log(`PII fields delivered: ${receipt.piiFieldCount} (dataHash: ${receipt.dataHash.slice(0, 18)}…)`)
    } else {
        runtime.log("Queue empty — no pending decrypt requests")
    }
    runtime.log(`Checked at: ${deliveredAt}`)
    runtime.log("---")

    return JSON.stringify({ ...receipt, deliveredAt })
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
