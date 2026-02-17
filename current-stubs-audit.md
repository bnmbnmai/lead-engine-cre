# Current Stubs Audit

Comprehensive inventory of every stub, simulation, mock, and demo-only code path in the Lead Engine CRE codebase. Each entry documents **what it fakes**, **where it lives**, **how it's labelled**, **Confidential HTTP conflict risk**, and **impact on demo vs production flows**.

---

## Summary

| # | Stub Name | Location | Label Quality | CHTT Conflict | Severity |
|---|-----------|----------|---------------|---------------|----------|
| 1 | DECO Service | `services/deco.service.ts` | ✅ Clear | 🔴 High | Critical |
| 2 | DECO KYC Verifier | `lib/chainlink/deco.stub.ts` | ✅ Clear | 🔴 High | Critical |
| 3 | Data Streams Service | `services/datastreams.service.ts` | ✅ Clear | 🟡 Medium | High |
| 4 | Confidential Compute Service | `services/confidential.service.ts` | ✅ Clear | 🔴 High | Critical |
| 5 | Confidential Privacy Service | `lib/chainlink/confidential.stub.ts` | ✅ Clear | 🔴 High | Critical |
| 6 | Custom Data Feed (Producer) | `lib/chainlink/data-feed.stub.ts` | ✅ Clear | 🟡 Medium | High |
| 7 | ZK Proof Service | `services/zk.service.ts` | ✅ Clear | 🟢 Low | Medium |
| 8 | Analytics Mock | `services/analytics-mock.ts` | ✅ Clear | 🟢 None | Low |
| 9 | Demo Panel Routes | `routes/demo-panel.routes.ts` | ✅ Clear | 🟢 None | Low |
| 10 | ACE Off-Chain Fallbacks | `services/ace.service.ts` | ⚠️ Implicit | 🟡 Medium | Medium |
| 11 | Keepers Stub | `services/quarterly-reset.service.ts` | ✅ Clear | 🟢 Low | Low |
| 12 | Requalify / Twilio Stub | `routes/marketplace.routes.ts` | ✅ Clear | 🟢 None | Low |
| 13 | KYC Mock URL | `routes/auth.routes.ts` | ⚠️ Implicit | 🟢 None | Medium |
| 14 | Settlement Placeholder | `rtb/engine.ts` | ✅ Clear | 🟡 Medium | Medium |
| 15 | MCP Fallback Chat | `routes/mcp.routes.ts` | ✅ Clear | 🟢 None | Low |
| 16 | Frontend Mock Data Toggle | `hooks/useMockData.ts` | ✅ Clear | 🟢 None | Low |
| 17 | NFT/Escrow Off-Chain Fallbacks | `services/nft.service.ts`, `services/x402.service.ts` | ⚠️ Implicit | 🟡 Medium | Medium |

---

## Detailed Findings

### 1. DECO Service (Web Attestation Stub)

**File:** [deco.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/deco.service.ts)
**Lines:** 1–164 (entire file)

**What it fakes:** Chainlink DECO zkTLS web attestation. Simulates verifying web page elements (e.g., business licenses, solar subsidy databases) by generating deterministic hashes instead of performing real TLS sessions.

**Labelling:** Clearly marked `[DECO STUB]` in all console output. File header states "STUB". All return types include `isStub: true`. ✅

**How it works:**
- `attestWebData()` — hashes inputs deterministically, adds 100–300ms simulated latency
- `verifySolarSubsidy()` — wraps `attestWebData()` with mock subsidy tier mapping
- `batchAttest()` — parallel stub attestations
- Timeout fallback returns `TIMEOUT_FALLBACK` with `isValid: false`

**Confidential HTTP conflict:** 🔴 **High** — DECO is a core Privacy Enhancing Technology. When Confidential HTTP is implemented, DECO's real TLS-based attestation will run inside TEEs. The stub's simulated latency and deterministic hashing will need complete replacement.

**Demo impact:** Powers the demo seller verification flow. Removing it without replacement breaks the attestation display on seller profiles.

**Production impact:** Not suitable for production — returns fabricated attestation IDs.

---

### 2. DECO KYC Verifier (zkTLS KYC Stub)

**File:** [deco.stub.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/lib/chainlink/deco.stub.ts)
**Lines:** 1–234 (entire file)

**What it fakes:** KYC identity verification via DECO's zkTLS protocol. Simulates verifying NMLS licenses, OFAC sanctions screening, and batch KYC checks.

**Labelling:** `[DECO-KYC STUB]` in console output. File header documents it as stub with drop-in replacement instructions. All return types include `isStub: true`. ✅

**How it works:**
- `verifyIdentity()` — deterministic pass/fail based on wallet + issuer hash
- `verifyNMLSLicense()` — concrete mortgage-vertical example
- `screenSanctions()` — OFAC/SDN screening simulation
- `batchVerify()` — parallel verification with `allPassed` / `passRate` aggregation
- Includes timeout fallback (`deco_kyc_fallback_*` IDs) with `degraded: true`

> [!WARNING]
> **Duplicate concern:** This file duplicates functionality in `services/deco.service.ts`. The two files have overlapping but different APIs (one is KYC-focused, the other is web attestation-focused). They should be consolidated.

**Confidential HTTP conflict:** 🔴 **High** — Same as #1. Real DECO will handle these via TEE-backed TLS sessions.

---

### 3. Data Streams Service (Pricing Stub)

**File:** [datastreams.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/datastreams.service.ts)
**Lines:** 1–194 (entire file)

**What it fakes:** Chainlink Data Streams pull-based market data. Returns fabricated bid floors, ceilings, and price indices per vertical+country pair from hardcoded `BASE_PRICES` table.

**Labelling:** `[DATA_STREAMS STUB]` in console output. Header states "STUB". All return types include `isStub: true`. ✅

**How it works:**
- `getRealtimeBidFloor()` — looks up hardcoded prices, adds ±8% jitter, simulates 20–80ms latency
- `getLeadPriceIndex()` — derives normalized 0–1000 index from midpoint prices
- `subscribePriceFeed()` — `setInterval`-based polling stub (not a real WebSocket stream)
- Falls back to cached stale values or defaults when "stream unavailable"

**Confidential HTTP conflict:** 🟡 **Medium** — Data Streams integration is SDK-based, not directly TEE-related, but the pricing data feeds into auction logic that Confidential HTTP may wrap.

**Demo impact:** The marketplace and auto-bid engine reference these prices indirectly. The stub ensures demo data has realistic pricing.

---

### 4. Confidential Compute Service (TEE Stub)

**File:** [confidential.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/confidential.service.ts)
**Lines:** 1–229 (entire file)

**What it fakes:** Chainlink Confidential Compute TEE operations — lead scoring, buyer-lead matching, and encrypted data processing inside a Trusted Execution Environment.

**Labelling:** `[CONFIDENTIAL STUB]` in console output. Header states "STUB". All types include `isStub: true`, `degraded: boolean`, and `computedInTEE: boolean` flags. ✅

**How it works:**
- `computeLeadScore()` — MD5-based deterministic score from lead ID (not real scoring model)
- `matchBuyerPreferencesConfidential()` — real matching logic but runs locally, not in TEE
- `decryptAndProcess()` — mock envelope encryption (base64 decode ≠ real TEE-sealed keys)
- All methods include timeout → degraded local fallback

**Confidential HTTP conflict:** 🔴 **High** — This is the **primary** conflict surface. Confidential HTTP will replace these stubs with real TEE-backed operations. The `computedInTEE` flag is currently always `false` in practice.

---

### 5. Confidential Privacy Service (Sealed Bid/Lead Stub)

**File:** [confidential.stub.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/lib/chainlink/confidential.stub.ts)
**Lines:** 1–380 (entire file)

**What it fakes:** Privacy-preserving auction mechanics — bid sealing/revealing, lead data sealing/unsealing with TEE-backed encryption.

**Labelling:** All types include `isStub: true`. Header documents stub with drop-in replacement guide. ✅

**How it works:**
- `sealBid()` — AES-256-GCM encryption with in-memory key store (not TEE-sealed)
- `revealBid()` — decrypts and verifies commitment hash
- `sealLeadData()` — encrypts lead PII, returns non-PII preview
- `unsealLeadData()` — decrypts after payment verification (mock: checks `paymentTxId` is non-empty)
- In-memory `sealKeys` Map (lost on restart)

> [!WARNING]
> **Duplicate concern:** Overlaps significantly with `services/confidential.service.ts`. Both simulate TEE operations but with different APIs and use cases.

**Confidential HTTP conflict:** 🔴 **High** — Direct replacement target for Confidential HTTP sealed bid/reveal + PII gating.

---

### 6. Custom Data Feed (Data Producer Stub)

**File:** [data-feed.stub.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/lib/chainlink/data-feed.stub.ts)
**Lines:** 1–296 (entire file)

**What it fakes:** Publishing aggregated platform metrics back to the Chainlink network via a Custom Data Feed (CRE cron workflow).

**Labelling:** Header and console output clearly marked as stub. All types include `isStub: true`. ✅

**How it works:**
- `collectPlatformMetrics()` — queries Prisma for real aggregate data (AVG quality score, total volume, fill rate), falls back to cached or synthetic defaults
- `pushLeadMetrics()` — simulates CRE cron push with retry logic but generates mock `txHash` (no real on-chain write)
- `scheduleDailyPush()` — logs intent only, no real scheduler

**Confidential HTTP conflict:** 🟡 **Medium** — The CRE workflow replaces this stub entirely. No direct CHTT dependency, but the metric aggregation may run inside a TEE in production.

---

### 7. ZK Proof Service (Hackathon Simulation)

**File:** [zk.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/zk.service.ts)
**Lines:** 1–205 (entire file)

**What it fakes:** Zero-knowledge proofs for fraud detection, geo-parameter matching, proof verification, and bid commitments. Uses keccak256 hashing instead of real ZK circuits (Circom/Groth16).

**Labelling:** Header explicitly states "Hackathon Simulation" and "Uses keccak256 commitments to simulate ZK proofs." ✅

**How it works:**
- `generateFraudProof()` — hashes lead data with random nonce, returns simulated proof + commitment
- `generateGeoParameterMatchProof()` — actual matching logic but proof is a hash, not a real ZK proof
- `verifyProofLocally()` — checks proof structure (non-zero, has inputs), not cryptographic verification
- `generateBidCommitment()` — real keccak256 commitment (this **is** production-ready)

> [!TIP]
> `generateBidCommitment()` uses `solidityPackedKeccak256` which matches Solidity's `keccak256(abi.encodePacked(...))`. This function is **not a stub** — it's production-ready cryptographic logic.

**Confidential HTTP conflict:** 🟢 **Low** — ZK proofs are orthogonal to TEE-based Confidential HTTP.

---

### 8. Analytics Mock

**File:** [analytics-mock.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/analytics-mock.ts)
**Lines:** 1–170 (entire file)

**What it fakes:** Dashboard analytics data (seller stats, buyer stats, platform stats, vertical breakdown, bid analysis).

**Labelling:** File named `analytics-mock.ts`. Uses `@faker-js/faker` with fixed seed (42) for deterministic output. ✅

**Guard:** [analytics.routes.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/analytics.routes.ts) — `USE_MOCK_DEFAULT = process.env.USE_MOCK_DATA === 'true' && !IS_PROD`. Mock data is **blocked in production** with an explicit warning log.

**Confidential HTTP conflict:** 🟢 **None** — Analytics mock is purely for demo presentation and has no overlap with Confidential HTTP.

---

### 9. Demo Panel Routes

**File:** [demo-panel.routes.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts)
**Lines:** 1–1300+ (entire file)

**What it fakes:** Demo persona management, lead injection, marketplace seeding, demo reset, and demo flow orchestration.

**Labelling:** File header and all console output use `[DEMO]` prefix. Routes are under `/api/demo/*`. Gated by demo persona authentication. ✅

**Key stubs within:**
- Demo wallet addresses (real Base Sepolia addresses, not `0xDEMO_*` placeholders — previously cleaned up)
- `FALLBACK_VERTICALS` array for when DB verticals table is unavailable
- Demo lead injection with synthetic PII (Faker-generated names, emails, phones)
- Demo-tagged SOLD leads (fake sales for demo, not real purchases)

**Confidential HTTP conflict:** 🟢 **None** — Demo panel is orthogonal to production Confidential HTTP flows.

---

### 10. ACE Off-Chain Fallbacks

**File:** [ace.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/ace.service.ts)
**Lines:** 29–435 (entire class)

**What it fakes:** When `ACE_CONTRACT_ADDRESS` is empty or RPC calls fail, ACE methods fall back to database-only checks. This silently degrades on-chain compliance to off-chain lookups.

**Labelling:** ⚠️ **Implicit** — fallbacks are inline `if (this.contract)` checks. No `isStub` flag on responses. The DEMO_MODE bypass was removed but the warning still logs. Methods like `autoKYC()` write directly to the database when the contract is unavailable, returning `{ verified: true }` without an on-chain proof.

**Specific fallbacks:**
| Method | On-Chain | Off-Chain Fallback |
|--------|----------|--------------------|
| `isKYCValid()` | `contract.isKYCValid()` | DB `complianceCheck` lookup |
| `canTransact()` | `contract.canTransact()` | Returns `{ allowed: false }` if contract call fails |
| `getReputationScore()` | `contract.getReputationScore()` | DB `sellerProfile.reputationScore` |
| `autoKYC()` | `contract.verifyKYC()` + tx | DB `complianceCheck` create (no txHash) |
| `enforceJurisdictionPolicy()` | `contract.isJurisdictionAllowed()` | `jurisdiction-policies` + DB check |
| `updateReputation()` | `contract.updateReputationScore()` | DB update |

**Confidential HTTP conflict:** 🟡 **Medium** — ACE compliance checks may be wrapped in Confidential HTTP if sensitive user data is involved in the check.

---

### 11. Chainlink Keepers Stub

**File:** [quarterly-reset.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/quarterly-reset.service.ts)
**Lines:** 416–427

**What it fakes:** Returns hardcoded function selectors for `checkUpkeep(bytes)` and `performUpkeep(bytes)` — the Chainlink Automation (Keepers) interface.

**Labelling:** Comments clearly state "Stub for future Chainlink Keepers integration." ✅

**How it works:** Returns two 4-byte selectors. No actual upkeep logic. The daily lease check itself uses `node-cron` (or manual trigger), not Keepers.

**Confidential HTTP conflict:** 🟢 **Low** — Keepers integration is separate from Confidential HTTP.

---

### 12. Requalify / Twilio SMS Stub

**File:** [marketplace.routes.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/marketplace.routes.ts)
**Lines:** 1698–1740

**What it fakes:** Lead requalification via SMS. Returns a mock SMS preview instead of actually sending via Twilio.

**Labelling:** Section header says "Stub — Twilio SMS Preview". Response includes `status: 'preview'` and `note: 'Twilio integration coming soon.'` ✅

**Confidential HTTP conflict:** 🟢 **None** — SMS integration is external to Chainlink services.

---

### 13. KYC Mock Verification URL

**File:** [auth.routes.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/auth.routes.ts)
**Lines:** 240–248

**What it fakes:** Returns a mock KYC verification URL (`https://verify.leadengine.io/kyc/{userId}`) instead of integrating with a real KYC provider (Synaps/Persona/Jumio).

**Labelling:** ⚠️ **Implicit** — comment says "In production, this would integrate with Synaps/Persona/Jumio" but the response doesn't indicate it's a mock. The URL looks real.

**Confidential HTTP conflict:** 🟢 **None** — KYC provider integration is orthogonal.

**Risk:** A user clicking this URL will get a 404. The mock URL should be more clearly flagged or return a warning.

---

### 14. Settlement Placeholder (Deprecated)

**File:** [engine.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/rtb/engine.ts)
**Lines:** 413–444

**What it fakes:** `initiateSettlement()` is marked deprecated. Returns an error directing callers to the client-side escrow flow.

**Labelling:** Comment says "⚠️ DEPRECATED". Method logs an error and returns `{ success: false }`. ✅

**Confidential HTTP conflict:** 🟡 **Medium** — Settlement flows through `x402.service.ts` which has its own off-chain fallbacks for escrow preparation when contract/signer are not configured.

---

### 15. MCP Fallback Chat

**File:** [mcp.routes.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/mcp.routes.ts)
**Lines:** 471–625

**What it fakes:** When `KIMI_API_KEY` is not set or Kimi API is unreachable, the MCP chat falls back to keyword-based response matching instead of LLM inference.

**Labelling:** Function named `fallbackChat()`. Response includes `mode: 'fallback'`. ✅

**Confidential HTTP conflict:** 🟢 **None** — MCP chat is independent of Confidential HTTP.

---

### 16. Frontend Mock Data Toggle

**Files:**
- [useMockData.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/hooks/useMockData.ts)
- [DemoPanel.tsx](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/components/demo/DemoPanel.tsx)

**What it fakes:** Toggle in DemoPanel that sets `VITE_USE_MOCK_DATA` in localStorage. Analytics pages read this flag to decide whether to request mock or real data from the backend.

**Labelling:** ✅ Clear — hook is named `useMockData`, storage key is explicit.

**Confidential HTTP conflict:** 🟢 **None**

---

### 17. NFT / Escrow Off-Chain Fallbacks

**Files:**
- [nft.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/nft.service.ts) — Line 74, 207, 273
- [x402.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/x402.service.ts) — Line 431, 553

**What it fakes:** When contract/signer are not configured:
- NFT service warns and uses "off-chain fallback" for ownership checks (DB-only)
- x402 service falls back to database for escrow state

**Labelling:** ⚠️ **Implicit** — fallbacks are inline conditional checks. No `isStub` flag.

**Confidential HTTP conflict:** 🟡 **Medium** — Escrow and NFT operations may require Confidential HTTP wrapping for PII-gated lead reveals.

---

## Duplicate / Consolidation Issues

| Files | Concern |
|-------|---------|
| `services/deco.service.ts` + `lib/chainlink/deco.stub.ts` | Both stub DECO with different APIs. `deco.service.ts` handles web attestation; `deco.stub.ts` handles KYC/sanctions. These should be consolidated into one module with clear sub-namespaces. |
| `services/confidential.service.ts` + `lib/chainlink/confidential.stub.ts` | Both stub Confidential Compute. `confidential.service.ts` handles scoring/matching; `confidential.stub.ts` handles sealed bids and lead data. Same consolidation need. |

---

## Confidential HTTP Migration Priority

Based on the audit, the recommended migration order for Confidential HTTP implementation is:

1. **`lib/chainlink/confidential.stub.ts`** — Sealed bid/reveal and PII gating (core auction privacy)
2. **`services/confidential.service.ts`** — TEE scoring and matching (privacy-preserving computation)
3. **`services/deco.service.ts` + `lib/chainlink/deco.stub.ts`** — zkTLS attestation (seller verification)
4. **`lib/chainlink/data-feed.stub.ts`** — CRE cron data push (metric publishing)
5. **`services/datastreams.service.ts`** — Pricing feeds (SDK integration, not TEE)

Items 6–17 have no direct Confidential HTTP dependency and can be addressed independently.

---

## Technical Debt Summary

| Area | Debt | Priority |
|------|------|----------|
| Duplicate stubs (DECO, Confidential) | 2 files each doing overlapping work | High |
| Missing `isStub` flags (ACE, NFT, x402) | Off-chain fallbacks don't self-identify | Medium |
| KYC mock URL looks real | `verify.leadengine.io` URL will 404 | Medium |
| In-memory seal keys (confidential.stub.ts) | Lost on restart, not persistent | Low (stub only) |
| `initiateSettlement()` dead code | Deprecated method still exists | Low |
| `generateBidCommitment()` is NOT a stub | Incorrectly lives in `zk.service.ts` (labelled "simulation") | Low |
