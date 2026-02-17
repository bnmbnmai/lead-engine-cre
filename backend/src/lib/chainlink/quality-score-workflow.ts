// ============================================================================
// CRE Quality Score Workflow — STUB
// ============================================================================
//
// Models how the pre-auction quality-score computation would run as a
// Chainlink CRE Workflow using Confidential HTTP.
//
// Reference: https://docs.chain.link/cre/capabilities/confidential-http-ts
//
// ── Production flow ──────────────────────────────────────────────────────
//   1. TRIGGER: CREVerifier emits `QualityScoreRequested(leadTokenId)`
//   2. ACTION:  Confidential HTTP GET to scoring-data endpoint
//               - x-cre-key injected from Vault DON secrets (never in node memory)
//               - Request runs inside TEE enclave (single execution)
//               - Response optionally encrypted before leaving enclave
//   3. COMPUTE: Run computeCREQualityScore() on the response data
//   4. WRITE:   Call CREVerifier.fulfillQualityScore(tokenId, score) on-chain
//
// ── Stub behavior ────────────────────────────────────────────────────────
//   Steps 2–3 run locally via ConfidentialHTTPClient stub.
//   Step 4 (on-chain write) is skipped — score is returned to the caller.
//   Step 1 (trigger) is invoked manually via executeWorkflow().
//
// ── No overlap ───────────────────────────────────────────────────────────
//   • confidential.stub.ts  = sealed bids & lead PII (auction privacy)
//   • confidential.service.ts = TEE scoring & matching (generic compute)
//   • THIS FILE = Confidential HTTP workflow for quality scoring
// ============================================================================

import {
    ConfidentialHTTPClient,
    confidentialHTTPClient,
    type ConfidentialHTTPRequest,
    type ConfidentialHTTPResponse,
} from './confidential-http.stub';
import { computeCREQualityScore, type LeadScoringInput } from './cre-quality-score';

// ── Types ────────────────────────────────────────────────────────────────

/** Input to the quality-score workflow (matches the CRE trigger payload). */
export interface QualityScoreWorkflowInput {
    /** Lead token ID (NFT) or lead UUID. */
    leadTokenId: string;
    /** Base URL of the Lead Engine API. Defaults to process.env.API_URL. */
    apiBaseUrl?: string;
}

/** Output from the quality-score workflow. */
export interface QualityScoreWorkflowOutput {
    /** Whether the workflow completed successfully. */
    success: boolean;
    /** Computed quality score (0–10,000). Null on failure. */
    score: number | null;
    /** The scoring data fetched from the API (for debugging). */
    scoringData: LeadScoringInput | null;
    /** Confidential HTTP response metadata. */
    confidentialHTTP: {
        statusCode: number;
        executedInEnclave: boolean;
        enclaveLatencyMs: number;
        encryptOutputEnabled: boolean;
        isStub: true;
    };
    /** Total workflow execution time in ms. */
    workflowLatencyMs: number;
    /** Always true for this stub. */
    isStub: true;
    /** Error message if the workflow failed. */
    error?: string;
}

// ── Workflow ─────────────────────────────────────────────────────────────

/**
 * Execute the quality-score workflow.
 *
 * STUB: Runs locally using the ConfidentialHTTPClient stub.
 * In production, this would be a deployed CRE Workflow triggered by the
 * CREVerifier contract's `QualityScoreRequested` event.
 *
 * @param input - The lead token ID and optional API base URL.
 * @param options - Optional: custom client instance, encryptOutput flag.
 * @returns The computed quality score and workflow metadata.
 *
 * @example
 * ```ts
 * const result = await executeQualityScoreWorkflow({
 *     leadTokenId: 'abc-123',
 * });
 * console.log(result.score); // 7200
 * console.log(result.isStub); // true
 * ```
 */
export async function executeQualityScoreWorkflow(
    input: QualityScoreWorkflowInput,
    options?: {
        client?: ConfidentialHTTPClient;
        encryptOutput?: boolean;
    },
): Promise<QualityScoreWorkflowOutput> {
    const start = Date.now();
    const client = options?.client || confidentialHTTPClient;
    const encryptOutput = options?.encryptOutput ?? false;
    const apiBaseUrl =
        input.apiBaseUrl || process.env.API_URL || 'http://localhost:3001';

    console.log(
        `[CHTT STUB] [QualityScoreWorkflow] Starting for lead ${input.leadTokenId}`,
    );

    // ── Step 1: Build the Confidential HTTP request ──────────────
    const request: ConfidentialHTTPRequest = {
        url: `${apiBaseUrl}/api/marketplace/leads/${input.leadTokenId}/scoring-data`,
        method: 'GET',
        headers: {
            'x-cre-key': '{{.creApiKey}}',
        },
        encryptOutput,
        secretsRef: [
            {
                name: 'creApiKey',
                template: '{{.creApiKey}}',
            },
        ],
        timeoutMs: 10_000,
    };

    // ── Step 2: Execute via Confidential HTTP ────────────────────
    const response: ConfidentialHTTPResponse<LeadScoringInput> =
        await client.execute<LeadScoringInput>(request);

    if (response.statusCode !== 200 || !response.data) {
        // If encrypted, try decrypting first
        let scoringData: LeadScoringInput | null = null;
        if (response.encryptedResponse) {
            scoringData = client.decryptResponse<LeadScoringInput>(
                response.encryptedResponse,
            );
        }

        if (!scoringData) {
            const elapsed = Date.now() - start;
            console.error(
                `[CHTT STUB] [QualityScoreWorkflow] ✘ Failed: status=${response.statusCode}`,
            );

            return {
                success: false,
                score: null,
                scoringData: null,
                confidentialHTTP: {
                    statusCode: response.statusCode,
                    executedInEnclave: response.executedInEnclave,
                    enclaveLatencyMs: response.enclaveLatencyMs,
                    encryptOutputEnabled: encryptOutput,
                    isStub: true,
                },
                workflowLatencyMs: elapsed,
                isStub: true,
                error: `Scoring-data endpoint returned ${response.statusCode}`,
            };
        }

        // Decryption succeeded — continue with decrypted data
        response.data = scoringData;
    }

    // ── Step 3: Compute score using the shared algorithm ─────────
    // If response was encrypted, decrypt it first
    let scoringData = response.data!;
    if (!scoringData && response.encryptedResponse) {
        scoringData = client.decryptResponse<LeadScoringInput>(
            response.encryptedResponse,
        )!;
    }

    const score = computeCREQualityScore(scoringData);

    // ── Step 4: In production, write to CREVerifier on-chain ─────
    // STUB: Skip on-chain write. Score is returned to the caller.
    // In production: await creVerifier.fulfillQualityScore(tokenId, score);

    const elapsed = Date.now() - start;
    console.log(
        `[CHTT STUB] [QualityScoreWorkflow] ✓ Score=${score} (${elapsed}ms)`,
    );

    return {
        success: true,
        score,
        scoringData,
        confidentialHTTP: {
            statusCode: response.statusCode,
            executedInEnclave: response.executedInEnclave,
            enclaveLatencyMs: response.enclaveLatencyMs,
            encryptOutputEnabled: encryptOutput,
            isStub: true,
        },
        workflowLatencyMs: elapsed,
        isStub: true,
    };
}
