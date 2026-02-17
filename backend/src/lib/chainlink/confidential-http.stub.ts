// ============================================================================
// Confidential HTTP Client — STUB
// ============================================================================
//
// Simulates the Chainlink CRE Confidential HTTP capability for local
// development and demo environments. In production, this would be replaced
// by the real CRE SDK `confidentialhttp.Client` which executes HTTP requests
// inside a secure enclave with secret injection via the Vault DON.
//
// Reference: https://docs.chain.link/cre/capabilities/confidential-http-ts
//
// ── What this file does ──────────────────────────────────────────────────
//   • Accepts the same config shape the real SDK expects
//   • Executes the HTTP request locally (no enclave, no TEE)
//   • Wraps the response with `isStub: true` + `executedInEnclave: false`
//   • Simulates enclave latency (50–150 ms)
//   • Optionally base64-encodes the response body (simulating EncryptOutput)
//
// ── What this file does NOT do ───────────────────────────────────────────
//   • No sealed bids or lead PII (see: confidential.stub.ts)
//   • No TEE scoring or matching (see: confidential.service.ts)
//   • No DECO attestation (see: deco.stub.ts / deco.service.ts)
//
// ── Drop-in replacement ──────────────────────────────────────────────────
//   When Chainlink CRE Confidential HTTP is GA:
//   1. Replace ConfidentialHTTPClient with the real SDK client
//   2. Store secrets in the Vault DON instead of process.env
//   3. Deploy the CRE workflow via `cre workflow deploy`
// ============================================================================

import crypto from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────

/** Secret reference — points to a secret stored in the Vault DON. */
export interface SecretRef {
    /** Name of the secret in the Vault DON (e.g. "creApiKey") */
    name: string;
    /**
     * Template string for injection (e.g. "{{.creApiKey}}").
     * In production, the enclave resolves this from the Vault DON.
     * In this stub, we resolve it from process.env.
     */
    template: string;
}

/** Request configuration — mirrors the CRE SDK confidentialhttp.Request. */
export interface ConfidentialHTTPRequest {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;
    /** If true, the response body is encrypted before leaving the enclave. */
    encryptOutput?: boolean;
    /** References to secrets that should be injected into headers/body. */
    secretsRef?: SecretRef[];
    /** Request timeout in ms. Default: 10_000. */
    timeoutMs?: number;
}

/** Response from a Confidential HTTP request. */
export interface ConfidentialHTTPResponse<T = unknown> {
    /** HTTP status code from the upstream API. */
    statusCode: number;
    /** Parsed response body (null if encryptOutput was enabled). */
    data: T | null;
    /**
     * Base64-encoded response body (only present if encryptOutput was enabled).
     * In production, this would be AES-GCM encrypted with a key from the enclave.
     */
    encryptedResponse: string | null;
    /** Whether the request actually ran inside a TEE enclave. */
    executedInEnclave: boolean;
    /** Simulated enclave latency in ms. */
    enclaveLatencyMs: number;
    /** Always true for this stub. */
    isStub: true;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Simulate enclave boot + execution latency (50–150 ms). */
function simulateEnclaveLatency(): Promise<number> {
    const ms = 50 + Math.floor(Math.random() * 100);
    return new Promise(resolve => setTimeout(() => resolve(ms), ms));
}

/**
 * Resolve a secret template from process.env.
 *
 * In production, the enclave resolves `{{.secretName}}` from the Vault DON.
 * Here we map common secret names to their env-var equivalents.
 */
function resolveSecret(ref: SecretRef): string {
    const envMap: Record<string, string> = {
        creApiKey: process.env.CRE_API_KEY || '',
        apiBaseUrl: process.env.API_URL || 'http://localhost:3001',
    };

    const value = envMap[ref.name];
    if (!value) {
        console.warn(`[CHTT STUB] ⚠️  Secret "${ref.name}" not found in env — returning empty string`);
        return '';
    }
    return value;
}

/**
 * Simulate AES-GCM encryption of the response body.
 *
 * In production, the enclave encrypts the response with a key derived from
 * the workflow's encryption config. Here we just base64-encode it so the
 * shape is correct for downstream consumers.
 */
function simulateResponseEncryption(body: string): string {
    // Use a random IV so the output looks different each time
    const iv = crypto.randomBytes(12);
    const marker = Buffer.from('chtt-stub-encrypted:').toString('base64');
    const payload = Buffer.from(body).toString('base64');
    return `${marker}${iv.toString('hex')}:${payload}`;
}

// ── Client ───────────────────────────────────────────────────────────────

/**
 * Confidential HTTP Client — STUB
 *
 * Simulates the CRE SDK's `confidentialhttp.Client` for local development.
 * All responses include `isStub: true` and `executedInEnclave: false`.
 *
 * @example
 * ```ts
 * const client = new ConfidentialHTTPClient();
 * const response = await client.execute({
 *     url: 'http://localhost:3001/api/marketplace/leads/abc/scoring-data',
 *     method: 'GET',
 *     headers: { 'x-cre-key': '{{.creApiKey}}' },
 *     encryptOutput: true,
 *     secretsRef: [{ name: 'creApiKey', template: '{{.creApiKey}}' }],
 * });
 * ```
 */
export class ConfidentialHTTPClient {
    /**
     * Execute a confidential HTTP request.
     *
     * STUB: Runs the request locally (no enclave). In production, the
     * Confidential HTTP DON would:
     * 1. Reach consensus on request parameters
     * 2. Fetch encrypted secrets from the Vault DON
     * 3. Decrypt secrets inside the enclave
     * 4. Execute the HTTP request from the enclave (single execution)
     * 5. Optionally encrypt the response before returning
     */
    async execute<T = unknown>(
        request: ConfidentialHTTPRequest,
    ): Promise<ConfidentialHTTPResponse<T>> {
        const start = Date.now();
        console.log(`[CHTT STUB] execute: ${request.method} ${request.url}`);

        try {
            // ── Step 1: Simulate enclave boot latency ────────────
            const enclaveLatencyMs = await simulateEnclaveLatency();

            // ── Step 2: Resolve secrets ──────────────────────────
            const resolvedHeaders: Record<string, string> = {
                ...(request.headers || {}),
            };

            if (request.secretsRef) {
                for (const ref of request.secretsRef) {
                    const secretValue = resolveSecret(ref);
                    // Replace template placeholders in all header values
                    for (const [key, val] of Object.entries(resolvedHeaders)) {
                        if (val.includes(ref.template)) {
                            resolvedHeaders[key] = val.replace(ref.template, secretValue);
                        }
                    }
                }
            }

            // Always add the CHTT request marker
            resolvedHeaders['x-chtt-request'] = 'true';

            // ── Step 3: Execute the HTTP request (locally, not in enclave) ──
            const controller = new AbortController();
            const timeoutId = setTimeout(
                () => controller.abort(),
                request.timeoutMs || 10_000,
            );

            const fetchOptions: RequestInit = {
                method: request.method,
                headers: resolvedHeaders,
                signal: controller.signal,
            };

            if (request.body && request.method !== 'GET') {
                fetchOptions.body =
                    typeof request.body === 'string'
                        ? request.body
                        : JSON.stringify(request.body);
                resolvedHeaders['Content-Type'] =
                    resolvedHeaders['Content-Type'] || 'application/json';
            }

            const fetchResponse = await fetch(request.url, fetchOptions);
            clearTimeout(timeoutId);

            const responseText = await fetchResponse.text();
            let parsedData: T | null = null;

            try {
                parsedData = JSON.parse(responseText) as T;
            } catch {
                // Response is not JSON — leave as null
            }

            // ── Step 4: Optionally encrypt the response ──────────
            let encryptedResponse: string | null = null;
            if (request.encryptOutput) {
                encryptedResponse = simulateResponseEncryption(responseText);
                // When encrypted, the raw data is not returned (matches real behavior)
                parsedData = null;
            }

            const elapsed = Date.now() - start;
            console.log(
                `[CHTT STUB] ← ${fetchResponse.status} (${elapsed}ms total, ${enclaveLatencyMs}ms simulated enclave)`,
            );

            return {
                statusCode: fetchResponse.status,
                data: parsedData,
                encryptedResponse,
                executedInEnclave: false,
                enclaveLatencyMs,
                isStub: true,
            };
        } catch (err: any) {
            const elapsed = Date.now() - start;
            console.error(
                `[CHTT STUB] ✘ request failed after ${elapsed}ms:`,
                err.message,
            );

            return {
                statusCode: 0,
                data: null,
                encryptedResponse: null,
                executedInEnclave: false,
                enclaveLatencyMs: elapsed,
                isStub: true,
            };
        }
    }

    /**
     * Decrypt a response that was encrypted by `encryptOutput: true`.
     *
     * STUB: Reverses the base64 encoding. In production, this would
     * use the AES-GCM decryption key from the workflow's encryption config.
     */
    decryptResponse<T = unknown>(encryptedResponse: string): T | null {
        console.log('[CHTT STUB] decryptResponse (simulated — base64 decode)');
        try {
            // Strip the stub marker prefix
            const markerEnd = encryptedResponse.indexOf(':',
                encryptedResponse.indexOf(':') + 1);
            const payload = encryptedResponse.slice(markerEnd + 1);
            const decoded = Buffer.from(payload, 'base64').toString('utf-8');
            return JSON.parse(decoded) as T;
        } catch {
            console.warn('[CHTT STUB] ⚠️  Failed to decrypt response — returning null');
            return null;
        }
    }
}

// ── Singleton ────────────────────────────────────────────────────────────

export const confidentialHTTPClient = new ConfidentialHTTPClient();
