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
//   2. ACTION A: Confidential HTTP GET to scoring-data endpoint
//                - x-cre-key injected from Vault DON secrets (never in node memory)
//                - Request runs inside TEE enclave (single execution)
//   3. ACTION B: Confidential HTTP GET to fraud-signal endpoint
//                - x-cre-key injected from Vault DON secrets
//                - Returns phone/email/conversion intelligence
//   4. COMPUTE: Run computeCREQualityScore() + externalFraudScore bonus
//   5. WRITE:   Call CREVerifier.fulfillQualityScore(tokenId, score) on-chain
//
// ── Stub behavior ────────────────────────────────────────────────────────
//   Steps 2–4 run locally via ConfidentialHTTPClient stub.
//   Step 5 (on-chain write) is skipped — score is returned to the caller.
//   Step 1 (trigger) is invoked manually via executeWorkflow().
//
// ── Separation of concerns ───────────────────────────────────────────────
//   • confidential.stub.ts  = sealed bids & lead PII (auction privacy)
//   • confidential.service.ts = TEE scoring & matching (generic compute)
//   • THIS FILE = Confidential HTTP workflow for quality scoring + fraud signals
// ============================================================================

import {
    ConfidentialHTTPClient,
    confidentialHTTPClient,
    type ConfidentialHTTPRequest,
    type ConfidentialHTTPResponse,
} from './confidential-http.stub';
import { computeCREQualityScore, type LeadScoringInput } from './cre-quality-score';
import type { FraudSignalPayload } from '../../routes/mock.routes';

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
    /** The scoring data fetched from the scoring-data endpoint (for debugging). */
    scoringData: LeadScoringInput | null;
    /** Fraud signal payload fetched from the mock fraud-signal endpoint. */
    fraudSignal: FraudSignalPayload | null;
    /** Combined external fraud bonus added to the base CRE score (0–1000). */
    externalFraudBonus: number | null;
    /** CHTT provenance fields — stored in lead.parameters._chtt on success. */
    chttProvenance: {
        nonce: string;
        ciphertext: string;
    } | null;
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

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Compute an external fraud bonus (0–1000) from the fraud signal payload.
 *
 * Scoring:
 *   Phone validation:       0–400 (phoneValidation.score × 400)
 *   Email hygiene:          0–300 (emailHygiene.score × 300)
 *   Conversion propensity:  0–300 (conversionPropensity.score × 300)
 *
 * Total max: 1000 extra points on top of the 10,000 base CRE score.
 * The final score is still capped at 10,000 by computeCREQualityScore.
 */
function computeExternalFraudBonus(signal: FraudSignalPayload): number {
    const phoneContrib = Math.round(signal.phoneValidation.score * 400);
    const emailContrib = Math.round(signal.emailHygiene.score * 300);
    const convContrib = Math.round(signal.conversionPropensity.score * 300);
    return Math.min(1000, phoneContrib + emailContrib + convContrib);
}

// ── Workflow ─────────────────────────────────────────────────────────────

/**
 * Execute the quality-score workflow.
 *
 * STUB: Runs locally using the ConfidentialHTTPClient stub.
 * In production, this would be a deployed CRE Workflow triggered by the
 * CREVerifier contract's `QualityScoreRequested` event.
 *
 * Phase 1 additions vs original stub:
 *   • Calls `GET /api/mock/fraud-signal/:leadId` via CHTT client
 *   • Computes externalFraudBonus (0–1000) from phone/email/conv signals
 *   • Returns chttProvenance (nonce + ciphertext) for storage in lead.parameters
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
 * console.log(result.score);                 // e.g. 7840
 * console.log(result.externalFraudBonus);    // e.g. 840
 * console.log(result.fraudSignal?.phoneValidation.score); // e.g. 0.92
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

    // ── Step 1: Build the Confidential HTTP request for scoring-data ──────
    const scoringRequest: ConfidentialHTTPRequest = {
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

    // ── Step 2: Execute scoring-data via Confidential HTTP ────────────────
    const response: ConfidentialHTTPResponse<LeadScoringInput> =
        await client.execute<LeadScoringInput>(scoringRequest);

    if (response.statusCode !== 200 || !response.data) {
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
                fraudSignal: null,
                externalFraudBonus: null,
                chttProvenance: null,
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

        response.data = scoringData;
    }

    let scoringData = response.data!;
    if (!scoringData && response.encryptedResponse) {
        scoringData = client.decryptResponse<LeadScoringInput>(
            response.encryptedResponse,
        )!;
    }

    // ── Step 3: Fetch external fraud signals via Confidential HTTP ────────
    // Same pattern as scoring-data: x-cre-key injected from Vault DON.
    // In production this would call a real provider (Twilio Lookup, ZeroBounce, etc.)
    const fraudRequest: ConfidentialHTTPRequest = {
        url: `${apiBaseUrl}/api/mock/fraud-signal/${input.leadTokenId}`,
        method: 'GET',
        headers: {
            'x-cre-key': '{{.creApiKey}}',
        },
        encryptOutput: false, // Fraud signal is not encrypted in the stub
        secretsRef: [
            {
                name: 'creApiKey',
                template: '{{.creApiKey}}',
            },
        ],
        timeoutMs: 8_000,
    };

    let fraudSignal: FraudSignalPayload | null = null;
    let externalFraudBonus = 0;
    let chttNonce = '';
    let chttCiphertext = '';

    try {
        const fraudResponse = await client.execute<FraudSignalPayload>(fraudRequest);
        if (fraudResponse.statusCode === 200 && fraudResponse.data) {
            fraudSignal = fraudResponse.data;
            externalFraudBonus = computeExternalFraudBonus(fraudSignal);
            chttNonce = fraudSignal.nonce;
            chttCiphertext = fraudSignal.ciphertext;
            console.log(
                `[CHTT STUB] [QualityScoreWorkflow] Fraud signal for ${input.leadTokenId}: ` +
                `phone=${fraudSignal.phoneValidation.score.toFixed(2)} ` +
                `email=${fraudSignal.emailHygiene.score.toFixed(2)} ` +
                `conv=${fraudSignal.conversionPropensity.score.toFixed(2)} ` +
                `→ bonus=${externalFraudBonus}`,
            );
        } else {
            console.warn(
                `[CHTT STUB] [QualityScoreWorkflow] ⚠ Fraud signal unavailable (${fraudResponse.statusCode}) — bonus=0`,
            );
        }
    } catch (fraudErr: any) {
        console.warn(
            `[CHTT STUB] [QualityScoreWorkflow] ⚠ Fraud signal error: ${fraudErr.message} — bonus=0`,
        );
    }

    // ── Step 4: Compute composite score ───────────────────────────────────
    // Base CRE score (0–10,000) + external fraud bonus (0–1,000), capped at 10,000.
    const baseScore = computeCREQualityScore(scoringData);
    const score = Math.min(10000, baseScore + externalFraudBonus);

    // ── Step 5: In production, write to CREVerifier on-chain ─────────────
    // STUB: Skip on-chain write. Score is returned to the caller.
    // In production: await creVerifier.fulfillQualityScore(tokenId, score);

    const elapsed = Date.now() - start;
    console.log(
        `[CHTT STUB] [QualityScoreWorkflow] ✓ base=${baseScore} bonus=${externalFraudBonus} total=${score} (${elapsed}ms)`,
    );

    return {
        success: true,
        score,
        scoringData,
        fraudSignal,
        externalFraudBonus,
        chttProvenance: (chttNonce && chttCiphertext)
            ? { nonce: chttNonce, ciphertext: chttCiphertext }
            : null,
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
