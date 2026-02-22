# CHTT Implementation Audit — 2026-02-21

---

## 1. Current Phase 1 — What Is Actually Implemented and Live Today

### 1.1 `backend/src/lib/chainlink/confidential-http.stub.ts` (283 lines)

**Classification: STUB — no TEE, no enclave, no encryption**

This file defines `ConfidentialHTTPClient`, the sole HTTP transport for the CHTT pipeline. It is explicitly labeled `isStub: true` at every callsite and in every return value.

**What it does:**

```ts
// L14: • Executes the HTTP request locally (no enclave, no TEE)
// L15: • Wraps the response with `isStub: true` + `executedInEnclave: false`
// L16: • Simulates enclave latency (50–150 ms)
```

**`simulateEnclaveLatency()` (L83–86):**
```ts
function simulateEnclaveLatency(): Promise<number> {
    const ms = 50 + Math.floor(Math.random() * 100);
    return new Promise(resolve => setTimeout(() => resolve(ms), ms));
}
```
This is a `setTimeout`. No enclave boot occurs.

**`resolveSecret()` (L94–106):**
```ts
const envMap: Record<string, string> = {
    creApiKey: process.env.CRE_API_KEY || '',
    apiBaseUrl: process.env.API_URL || 'http://localhost:3001',
};
```
In production, `{{.creApiKey}}` is resolved by the Vault DON inside the enclave. Here it is resolved from `process.env.CRE_API_KEY`. The secret is in Node.js memory and visible to the process.

**`simulateResponseEncryption()` (L115–121):**
```ts
function simulateResponseEncryption(body: string): string {
    const iv = crypto.randomBytes(12);
    const marker = Buffer.from('chtt-stub-encrypted:').toString('base64');
    const payload = Buffer.from(body).toString('base64');
    return `${marker}${iv.toString('hex')}:${payload}`;
}
```
This is **base64 encoding**, not AES-GCM encryption. The `iv` is generated but not used to actually encrypt. The marker `chtt-stub-encrypted:` is prepended to distinguish from real ciphertext.

**`execute()` (L155–256):**
- Resolves secrets from `process.env` (not Vault DON)
- Adds `resolvedHeaders['x-chtt-request'] = 'true'` (L183)
- Makes a real `fetch()` call locally (L207) — **not from a TEE**
- Sets `executedInEnclave: false` on every return path (L236, L251)

**`decryptResponse()` (L264–277):**
```ts
decryptResponse<T = unknown>(encryptedResponse: string): T | null {
    console.log('[CHTT STUB] decryptResponse (simulated — base64 decode)');
    // Strip the stub marker prefix
    const markerEnd = encryptedResponse.indexOf(':', encryptedResponse.indexOf(':') + 1);
    const payload = encryptedResponse.slice(markerEnd + 1);
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded) as T;
}
```
Reverses `simulateResponseEncryption()` by base64 decoding. No AES-GCM key, no decryption.

---

### 1.2 `backend/src/lib/chainlink/quality-score-workflow.ts` (302 lines)

**Classification: STUB — real HTTP calls, no on-chain write**

**`executeQualityScoreWorkflow()` (L132–302):**

**Step 1 — Scoring data request (L154–169):**
```ts
const scoringRequest: ConfidentialHTTPRequest = {
    url: `${apiBaseUrl}/api/v1/leads/${input.leadTokenId}/scoring-data`,
    method: 'GET',
    headers: { 'x-cre-key': '{{.creApiKey}}' },
    encryptOutput,
    secretsRef: [{ name: 'creApiKey', template: '{{.creApiKey}}' }],
    timeoutMs: 10_000,
};
```
This fires a real HTTP GET to the backend's own `/api/v1/leads/:id/scoring-data` endpoint. The `{{.creApiKey}}` template is resolved from `process.env.CRE_API_KEY` by `resolveSecret()` in the stub — not by the Vault DON.

**Step 3 — Fraud signal request (L222–236):**
```ts
const fraudRequest: ConfidentialHTTPRequest = {
    url: `${apiBaseUrl}/api/mock/fraud-signal/${input.leadTokenId}`,
    method: 'GET',
    headers: { 'x-cre-key': '{{.creApiKey}}' },
    encryptOutput: false,
    ...
};
```
Calls the mock fraud-signal endpoint in `mock.routes.ts`. The fraud signal data is **deterministically generated** from the lead ID using SHA-256 hashes — no real third-party call to Twilio, ZeroBounce, or MaxMind.

**Step 4 — Score computation (L270–271):**
```ts
const baseScore = computeCREQualityScore(scoringData);
const score = Math.min(10000, baseScore + externalFraudBonus);
```
`computeCREQualityScore` is the same JS function used on the direct-DB path. The `externalFraudBonus` (0–1000) is computed from the mock fraud signal.

**Step 5 — On-chain write (L273–275):**
```ts
// STUB: Skip on-chain write. Score is returned to the caller.
// In production: await creVerifier.fulfillQualityScore(tokenId, score);
```
The on-chain `CREVerifier.fulfillQualityScore()` call is **not implemented**. Score is returned to the caller in memory only.

**CHTT provenance fields (L240–290):**
```ts
let chttNonce = '';
let chttCiphertext = '';
// ...
chttNonce = fraudSignal.nonce;
chttCiphertext = fraudSignal.ciphertext;
// ...
chttProvenance: (chttNonce && chttCiphertext)
    ? { nonce: chttNonce, ciphertext: chttCiphertext }
    : null,
```
`nonce` and `ciphertext` originate from `mock.routes.ts:GET /api/mock/fraud-signal/:leadId` (see §1.4). They are pseudo-random hex strings generated by `crypto.randomBytes()` on the mock server app process — not produced inside an enclave.

---

### 1.3 `backend/src/services/cre.service.ts` (753 lines)

**Classification: Real service — CHTT path gated by env flag**

**Env gate (L28):**
```ts
const USE_CONFIDENTIAL_HTTP = process.env.USE_CONFIDENTIAL_HTTP === 'true';
```
When `false` (the default), the entire CHTT pipeline is bypassed. The direct-DB scoring path (`computeNumericPreScoreFromLead`) runs instead.

**`verifyLead()` CHTT branch (L180–218):**
```ts
if (USE_CONFIDENTIAL_HTTP) {
    const chttResult = await this.computeScoreViaConfidentialHTTP(leadId);
    preScore = chttResult.score;
    chttEnriched = chttResult.enriched;
    chttScore = chttResult.chttScore;

    // Persist CHTT provenance in parameters JSONB
    const chttMeta = {
        enriched: chttResult.enriched,
        score: chttResult.chttScore,
        bonus: chttResult.bonus,
        nonce: chttResult.nonce,
        ciphertext: chttResult.ciphertext,
        computedAt: new Date().toISOString(),
    };

    await prisma.lead.update({
        where: { id: leadId },
        data: {
            isVerified: true,
            qualityScore: preScore,
            parameters: { ...existingParams, _chtt: chttMeta } as any,
        },
    });
}
```
When `USE_CONFIDENTIAL_HTTP=true`, CHTT provenance (`nonce`, `ciphertext`, `bonus`) is persisted in the `parameters` JSONB column under the `_chtt` key. There is **no dedicated `chttEnriched` column in the Prisma schema** — confirmed by grep: `chttEnriched` does not appear in any `.prisma` file.

**`computeScoreViaConfidentialHTTP()` (L324–370):**
```ts
private async computeScoreViaConfidentialHTTP(leadId: string): Promise<{...}> {
    try {
        const result = await executeQualityScoreWorkflow({ leadTokenId: leadId });
        if (result.success && result.score !== null) {
            console.log(
                `[CRE] CHTT workflow scored lead ${leadId}: ${result.score}/10000 ` +
                `(bonus=${result.externalFraudBonus ?? 0}, ` +
                `enclave=${result.confidentialHTTP.executedInEnclave}, ` +   // always false
                `latency=${result.workflowLatencyMs}ms, isStub=${result.isStub})`,
            );
            return {
                score: result.score,
                enriched: result.fraudSignal !== null,
                ...
            };
        }
    } catch (err) { ... }

    // Fallback: score directly from DB
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    const score = lead ? this.computeNumericPreScoreFromLead(lead) : 0;
    return { score, enriched: false };
}
```
The log line explicitly records `enclave=false` on every run. On failure, the function falls back to the same direct-DB scoring path — **the CHTT failure mode is invisible to the caller**.

---

### 1.4 `backend/src/routes/mock.routes.ts` (153 lines)

**Classification: Mock endpoint — deterministic cleartext data**

**`GET /api/mock/fraud-signal/:leadId` (L86–150):**
```ts
const phoneScore = deterministicFloat(leadId, 'phone', 0.55, 0.99);
const emailScore = deterministicFloat(leadId, 'email', 0.60, 0.99);
const convScore  = deterministicFloat(leadId, 'conv',  0.40, 0.95);

const nonce = crypto.randomBytes(16).toString('hex');
const plaintext = JSON.stringify({ leadId, phoneScore, emailScore, convScore });
const iv = crypto.randomBytes(12);
const ciphertext = `chtt-enc:${iv.toString('hex')}:${Buffer.from(plaintext).toString('base64')}`;
```

All scores are derived from `SHA-256(leadId + salt)`. The `ciphertext` field value is base64-encoded plaintext prefixed with `chtt-enc:` — **not AES-GCM encrypted**. The `iv` is present in the string but was not used to encrypt. The scores always fall within fixed bounds regardless of actual phone/email validity.

This endpoint requires the `x-cre-key` header (any truthy value accepted — no hash validation in dev).

---

### 1.5 `backend/src/routes/marketplace.routes.ts` — two relevant sections

**`GET /api/v1/leads/:leadId/scoring-data` (L732–807):**
Returns the `LeadScoringInput` shape from the DB. Requires `x-cre-key` header (any truthy value). This is the target of Step 1 in `executeQualityScoreWorkflow`. The endpoint is real and functional. It excludes parameters with `_` prefix (L768: `!k.startsWith('_')`).

**`chttEnriched` in list response (L944–951):**
```ts
const leads = rawLeads.map((lead: any) => {
    const chttMeta = (lead.parameters as any)?._chtt;
    return {
        ...lead,
        qualityScore: lead.qualityScore != null ? Math.floor(lead.qualityScore / 100) : null,
        chttEnriched: chttMeta?.enriched === true,
        chttScore: chttMeta?.score != null ? Math.floor(chttMeta.score / 100) : null,
    };
});
```
`chttEnriched` is computed at serialization time by reading `parameters._chtt.enriched` from the JSONB field. There is no dedicated DB column. The field is absent from `GET /leads/:id` (lead detail) response — it is only in the list endpoint.

---

### 1.6 `backend/src/services/confidential.service.ts` (229 lines)

**Classification: Separate stub — not part of the CHTT scoring pipeline**

This file (`ConfidentialComputeService`) is a standalone **generic TEE stub** separate from the CHTT HTTP pipeline. It provides:

- `computeLeadScore(leadId)` — deterministic score from `MD5(leadId)` (L91–93)
- `matchBuyerPreferencesConfidential(buyerPrefs, leadData)` — local matching logic (L121–187)
- `decryptAndProcess(encryptedPayload, processorFn)` — base64 decode + local fn call (L195–224)

All three methods set `computedInTEE: !degraded` where `degraded` is always `false` (the simulated CC latency `setTimeout` never rejects). All methods return `isStub: true`.

**This service is referenced nowhere in `cre.service.ts` or `quality-score-workflow.ts`.** It is not called in the live CHTT scoring pipeline.

---

### 1.7 `frontend/src/components/marketplace/LeadCard.tsx` — TEE badge (L193–200)

```tsx
{/* TEE badge — visible only when score enriched by CHTT fraud-signal workflow */}
{lead.chttEnriched && (
    <Tooltip content="Quality score enriched by Chainlink Confidential HTTP inside a Trusted Execution Environment (TEE). External fraud signals (phone validation, email hygiene, conversion propensity) processed securely in enclave without exposing any PII.">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-widest border bg-violet-500/25 text-violet-300 border-violet-500/50 cursor-help uppercase shadow-sm shadow-violet-500/20">
            🔒 TEE
        </span>
    </Tooltip>
)}
```

The TEE badge renders only when `lead.chttEnriched === true`. This value arrives from the list API serializer (§1.5). The badge is present and styled. It is never visible in production because `USE_CONFIDENTIAL_HTTP` defaults to `false`.

Additionally, the CRE badge tooltip (L154–155) conditionally shows:
```tsx
? `CRE Quality Score — enriched by Chainlink CHTT TEE (${Math.floor(lead.qualityScore / 100)}/100)`
```
The 🔒 lock icon also conditionally renders (L168):
```tsx
{lead.chttEnriched && <span className="ml-0.5 opacity-75">🔒</span>}
```

---

### 1.8 `backend/src/lib/chainlink/cre-quality-score.ts` — DON source string

This file contains the `DON_QUALITY_SCORE_SOURCE` constant: a JavaScript source string intended to run on the Chainlink Functions DON. Excerpt (L131):
```ts
url: `${secrets.apiBaseUrl}/api/marketplace/leads/${leadTokenId}/scoring-data`,
```
This is a string template inside a string constant. It is never dispatched to the DON in any live code path found in this codebase. The `CREVerifier.sol` contract has a `requestQualityScore(uint256 leadTokenId)` function that would trigger the DON, but no backend code calls it in `cre.service.ts` outside of `requestZKFraudDetection` (which calls `requestZKProofVerification`, not `requestQualityScore`).

---

## 2. Current Limitations and Stubs

| Aspect | Status | Detail |
|--------|--------|--------|
| TEE execution | **Not implemented** | `executedInEnclave` is hardcoded `false` everywhere (stub L236, L251) |
| Secret injection | **Not implemented** | `{{.creApiKey}}` resolved from `process.env`, not Vault DON |
| Response encryption | **Not implemented** | `simulateResponseEncryption()` produces `base64(plaintext)` not `AES-GCM(plaintext)` |
| Fraud signal data | **Mock only** | `deterministicFloat(SHA-256(leadId))` — no Twilio/ZeroBounce/MaxMind call |
| CHTT nonce/ciphertext | **Simulated** | `crypto.randomBytes()` hex + base64 encode, produced on app process |
| On-chain write | **Not implemented** | Step 5 comment: `// STUB: Skip on-chain write` (quality-score-workflow.ts L274) |
| DON dispatch | **Not implemented** | `CREVerifier.requestQualityScore()` is never called from backend |
| `chttEnriched` DB column | **Does not exist** | Stored as JSONB `parameters._chtt.enriched` — no schema migration |
| `USE_CONFIDENTIAL_HTTP` default | **`false`** | CHTT path is bypassed entirely in all production and demo runs unless env is set |
| `confidential.service.ts` | **Disconnected** | Not called from scoring pipeline; standalone stub only |

---

## 3. Phase 2 Batched Confidential Score (Planned)

Based on the current architecture and inline comments, the intended Phase 2 design is:

### Intended Batched Design

A single Chainlink Functions/CRE Workflow request would:

1. **Trigger**: `CREVerifier` emits `QualityScoreRequested(leadTokenId)` (contract exists, event not yet fired by backend)
2. **Action A** (Confidential HTTP): DON fetches `GET /api/v1/leads/:tokenId/scoring-data` with `x-cre-key` injected from Vault DON — never in node memory
3. **Action B** (Confidential HTTP): DON fetches `GET /api/mock/fraud-signal/:leadId` (or a real provider) with same key injection — returns phone/email/conversion scores
4. **Compute** (inside enclave): `computeCREQualityScore(scoringData) + externalFraudBonus` → single `uint16` score
5. **Return**: Encrypted envelope (AES-GCM) containing score + ZK fraud-signal hash + ACE policy result → DON callback
6. **Write**: `CREVerifier.fulfillQualityScore(tokenId, score)` called on-chain by DON

The "batched" aspect is that quality score, ZK fraud signal, and ACE policy result would all be returned in one encrypted envelope from a single DON execution, rather than three separate calls.

### Gaps Between Phase 1 (Current) and Phase 2 (Planned)

| Gap | What is missing |
|-----|----------------|
| Real CRE Workflow YAML | No `.cre/workflow.yaml` or `cre-workflow-deploy` script exists in the codebase |
| Vault DON secret registration | `CRE_API_KEY` must be registered in Vault DON, not `process.env` |
| Real enclave execution | `ConfidentialHTTPClient` must be replaced with `confidentialhttp.Client` from CRE SDK |
| Real AES-GCM encryption | `simulateResponseEncryption()` must be replaced with enclave-managed key encryption |
| Real fraud signal provider | `GET /api/mock/fraud-signal/:leadId` must call Twilio Lookup / ZeroBounce / MaxMind |
| On-chain write | `CREVerifier.fulfillQualityScore(tokenId, score)` not yet called from any backend path |
| DON trigger wiring | Backend never calls `CREVerifier.requestQualityScore(tokenId)` after NFT mint |
| Encrypted envelope return | No combined score + ZK + ACE envelope format defined or implemented |
| `chttEnriched` Prisma field | `parameters._chtt` JSONB workaround must be migrated to a typed column if persistent storage is required |
| `GET /leads/:id` response | `chttEnriched` is absent from the lead detail endpoint — only in list endpoint |

---

## 4. Files Scanned

| File | Lines | Notes |
|------|-------|-------|
| `backend/src/lib/chainlink/confidential-http.stub.ts` | 283 | Read in full |
| `backend/src/lib/chainlink/quality-score-workflow.ts` | 302 | Read in full |
| `backend/src/services/cre.service.ts` | 753 | Read in full |
| `backend/src/services/confidential.service.ts` | 229 | Read in full |
| `backend/src/routes/mock.routes.ts` | 153 | Read in full |
| `backend/src/routes/marketplace.routes.ts` | 2190 | Lines 553–1352 and 1375–1474 examined |
| `backend/src/lib/chainlink/cre-quality-score.ts` | — | DON_QUALITY_SCORE_SOURCE constant examined via grep |
| `frontend/src/components/marketplace/LeadCard.tsx` | 344 | Lines 1–30, 149–215 examined |
| `backend/src/lib/chainlink/confidential.stub.ts` | — | Confirmed distinct file (sealed bids / lead PII — not CHTT) |
| `backend/src/lib/chainlink/deco.stub.ts` | — | Confirmed distinct file (DECO — not CHTT) |
| `backend/src/index.ts` | — | L217 comment examined |
| `database/schema.prisma` (all `.prisma` files) | — | Grepped for `chtt` — no results |
| `PRIVACY_INTEGRATION_AUDIT.md` | — | Referenced for historical context only |
| `docs/DEMO_SCRIPT.md`, `docs/PITCH_DECK.md`, `docs/SUBMISSION_FORM.md` | — | Grepped — contain marketing copy only, not code |
