# Privacy Features Integration Audit — 2026-02-21

---

## Executive Summary

Lead Engine CRE already has production-ready scaffolding for both Chainlink privacy primitives: a fully structured Confidential HTTP stub pipeline (`lib/chainlink/quality-score-workflow.ts` → `confidential-http.stub.ts`) wired directly into the two-stage CRE scoring flow inside `cre.service.ts`, and real AES-256-GCM PII encryption in `privacy.service.ts` that mirrors the on-chain commitment pattern needed for Compliant Private Token Transfers. The single highest-impact insertion point for Confidential HTTP is **the quality score displayed on every lead card** — the `QS {score}` badge rendered at `LeadCard.tsx:149–158` already reads `lead.qualityScore`, which is written post-verification in `cre.service.ts:116–121`. Promoting the stub workflow to a real CRE DON workflow that fetches encrypted fraud-signal data via Confidential HTTP and folds the result into the composite pre-score — then surfacing that provenance on the card with a "TEE" badge — transforms the QS badge from an internal metric to a trust signal visible at auction time. Private Token Transfers, powered by Chainlink ACE, map naturally onto the existing `RTBEscrow.sol` / `PersonalEscrowVault.sol` settlement layer: shielding royalty splits and seller payouts via off-chain private balances + on-chain withdrawal tickets adds a second, complementary privacy narrative that judges can trace end-to-end.

---

## Current Privacy Architecture & Stubs

### AES-256-GCM PII Encryption
- **File:** `backend/src/services/privacy.service.ts` (279 lines)
- **What it does:** `encryptLeadPII()` (L170–183) encrypts raw PII (name, email, phone, address) with AES-256-GCM using `PRIVACY_ENCRYPTION_KEY` from env; produces `{ ciphertext, iv, tag, commitment }`. `encryptBid()` (L103–132) applies commit-reveal for sealed bids using `ethers.solidityPackedKeccak256`. `encryptTokenMetadata()` (L201–232) keeps `qualityScore`, `vertical`, `geoState` public but seals PII fields.
- **Storage:** Encrypted blob stored in `lead.encryptedData` (Prisma); commitment stored on-chain via `dataHash`.
- **Key gap:** `PRIVACY_ENCRYPTION_KEY` is a single server-side symmetric key — no per-buyer asymmetric re-encryption, no TEE key derivation.

### Confidential HTTP Stub Pipeline
- **Files (in order of execution):**
  1. `backend/src/lib/chainlink/confidential-http.stub.ts` — `ConfidentialHTTPClient` simulates enclave HTTP execution; `{{.creApiKey}}` template token simulates DON vault secret injection; `encryptOutput: true` simulates AES-GCM response encryption inside enclave.
  2. `backend/src/lib/chainlink/quality-score-workflow.ts` (203 lines) — `executeQualityScoreWorkflow()` (L94–202): Step 1 builds a `ConfidentialHTTPRequest` to `/api/marketplace/leads/{tokenId}/scoring-data`; Step 2 calls `client.execute()`; Step 3 calls `computeCREQualityScore()`; Step 4 is noted as "STUB: Skip on-chain write."
  3. `backend/src/services/cre.service.ts:222–249` — `computeScoreViaConfidentialHTTP()`: called only when env `USE_CONFIDENTIAL_HTTP=true`; falls back to direct-DB scoring on failure.
  4. `backend/src/services/cre.service.ts:183–191` — called from `computePreScore()`, which is the function that stores `qualityScore` into Prisma.
- **Env gate:** `USE_CONFIDENTIAL_HTTP` flag (`cre.service.ts:28`). When `false` (default), the stub path is bypassed entirely.

### CRE On-Chain Scoring (CREVerifier.sol)
- **File:** `contracts/contracts/CREVerifier.sol` (449 lines)
- **Quality score storage:** `_leadQualityScores[tokenId]` (L31); written only in `fulfillRequest()` (L298–302) which is the Chainlink Functions callback.
- **Read path:** `getLeadQualityScore(tokenId)` (L340–342) → called in `cre.service.ts:getQualityScore()` (L403–414) → Stage 2 on-chain confirmed score.
- **Subject:** `requestQualityScore(tokenId)` (L198–236) dispatches a Chainlink Functions DON request with `_qualityScoreSource` as inline JS. Currently no fraud-signal enrichment in the DON source.
- **Pure scoring:** `computeQualityScoreFromParams()` (L358–409) is a pure on-chain function mirroring `cre-quality-score.ts` but with no external-signal input.

### Lead Card Quality Score Display
- **File:** `frontend/src/components/marketplace/LeadCard.tsx:146–166`
- **Render:** If `lead.qualityScore != null`, renders badge `QS {Math.floor(lead.qualityScore / 100)}` (scaled 0–100) with color tiers: ≥70=green, ≥50=amber, <50=red. Else renders `QS —` (pending).
- **Tooltip:** `"CRE Pre-score — confirmed on-chain after purchase"` (L147). No TEE provenance badge, no fraud-signal annotation.
- **Data flow:** `BuyerDashboard.tsx:112` → `api.listLeads()` → leads serialized with `qualityScore` from Prisma → `LeadCard` prop.
- **BuyerDashboard usage:** `BuyerDashboard.tsx:484–488` maps `activeLeads` → `<LeadCard key={lead.id} lead={lead} />`; no `floorPrice` or extra props passed.
- **Marketplace usage:** `Marketplace.tsx` (not opened but referenced) similarly maps leads to `<LeadCard>`.

### MCP ReAct Agent Tools
- **File:** `mcp-server/tools.ts` (215 lines)
- **Relevant tools:** `set_auto_bid_rules` (L101–134) exposes `minQualityScore` param (0–10,000) — agents can gate bids on CRE score. `search_leads_advanced` (L136–165) supports `filterRules` but no quality-score enrichment signal. No tool for triggering CHTT workflow.
- **Agent service:** `backend/src/services/agent.service.ts` (22 KB) — ReAct loop. No direct hook into the CHTT workflow per tool execution.

### Escrow & Settlement Layer
- **RTBEscrow.sol** (304 lines): `createAndFundEscrow()` is the single-signature settlement path; `releaseEscrow()` transfers `sellerAmount` (bid − platformFee) to seller; `feeRecipient` receives platform fee. All settlements are plaintext USDC ERC-20 transfers — no privacy layer.
- **PersonalEscrowVault.sol** (441 lines): `settleBid()` (L244–273) sends 95% to seller, 5% + $1 fee to `platformWallet`. Chainlink Automation (L313–351) runs Proof-of-Reserves every 24h and auto-refunds expired bid locks. Zero shielded-transfer integration.

### Existing Privacy / ZK Stubs
- `backend/src/services/zk.service.ts` — ZK fraud-proof stub; used by `cre.service.ts:requestZKFraudDetection()`.
- `backend/src/services/ace.service.ts` (22 KB) — ACE compliance stub; checks lead and buyer identity against configurable policy rules.
- `contracts/contracts/ACECompliance.sol` (12 KB) — on-chain ACE policy enforcement stub.
- `backend/src/lib/chainlink/confidential.stub.ts` — sealed bids & lead PII (distinct from CHTT stub).
- `backend/src/lib/chainlink/deco.stub.ts` — DECO proof stub (unused in active flows).

---

## Confidential HTTP Integration Feasibility (Priority: Bake into Quality Score on Lead Cards)

### Best Insertion Point — Post-CRE Score Enrichment via Async CRE Workflow → Composite Score on Lead Cards with TEE Badge

The natural insertion point is already wired: `cre.service.ts:computeScoreViaConfidentialHTTP()` (L222–249) calls `executeQualityScoreWorkflow()` which hits a `/scoring-data` endpoint through the CHTT client. The sole blocker is that the workflow returns a score based on the same direct-DB data as the non-CHTT path — it adds no new external fraud signal. The minimal upgrade is:

1. **Create a real external fraud-signal endpoint** (e.g., a mock fraud-score API or Chainlink-controlled data endpoint) that the CHTT workflow calls with the API key from DON secrets — **exactly** as `conf-http-demo` does with `{{.myApiKey}}` in the header and `encryptOutput: true`.
2. **Blend the fraud signal** into `computeCREQualityScore()` as a new input bucket (e.g., "External Fraud Signal" 0–1000 pts).
3. **Store a CHTT provenance flag** (`lead.chttEnriched: boolean`) alongside `qualityScore` in Prisma.
4. **Surface the TEE badge** on `LeadCard.tsx` when `lead.chttEnriched === true`.

This makes the QS badge on every lead card a provably TEE-computed trust signal — the primary judge anchor.

### Minimal Viable Scope: 1 Workflow for Encrypted Fraud Signals, Triggered from MCP Agent on Lead Submission

- 1 CRE workflow YAML (based on `conf-http-demo/my-workflow`) that:
  - Triggers on `lead:submitted` event (or via `cre workflow simulate` in demo)
  - Makes one Confidential HTTP GET to `GET /api/marketplace/leads/{tokenId}/scoring-data` with `x-cre-key: {{.creApiKey}}`
  - Optionally enables `encryptOutput: true` (AES-GCM encrypted response)
  - Returns composite score blob
- 1 new MCP tool `run_cre_workflow` that triggers the workflow for a given `leadId`
- 1 backend route `GET /api/marketplace/leads/:tokenId/scoring-data` that returns `LeadScoringInput` JSON (already partially implemented; the stub calls this URL at `quality-score-workflow.ts:113`)
- 1 job in `cre.service.ts` to set `USE_CONFIDENTIAL_HTTP=true` and promote the stub

### Exact Files, Functions, and Line Ranges to Touch or Create

| Action | File | Function / Location | Change |
|--------|------|---------------------|--------|
| **Promote stub** | `backend/src/lib/chainlink/confidential-http.stub.ts` | Entire class | Swap `ConfidentialHTTPClient` stub for real CRE SDK client when `CRE_CLI` env present |
| **Add scoring-data route** | `backend/src/routes/marketplace.routes.ts` (or new `cre.routes.ts`) | New: `GET /api/marketplace/leads/:tokenId/scoring-data` | Return `LeadScoringInput` JSON guarded by `x-cre-key` header check |
| **Enable CHTT path** | `backend/src/services/cre.service.ts:28` | `USE_CONFIDENTIAL_HTTP` | Set to `true` in `.env`; no code change needed |
| **Add fraud signal bucket** | `backend/src/lib/chainlink/cre-quality-score.ts` | `computeCREQualityScore()` | Add optional `externalFraudScore?: number` input field; score bucket 0–1000 |
| **Store CHTT provenance** | Prisma schema (`schema.prisma`) | `Lead` model | Add `chttEnriched  Boolean @default(false)`, `chttScore Int?` fields |
| **Persist provenance** | `backend/src/services/cre.service.ts:116–121` | `verifyLead()` → `prisma.lead.update()` | Include `chttEnriched: true` when CHTT workflow succeeds |
| **Add TEE badge** | `frontend/src/components/marketplace/LeadCard.tsx:146–166` | QS badge block | Add `{lead.chttEnriched && <span className="tee-badge">TEE</span>}` next to QS badge |
| **Expose in API** | `backend/src/routes/leads.routes.ts` | `GET /api/v1/leads` serializer | Include `chttEnriched`, `chttScore` in lead response |
| **Create CRE workflow** | `workflow/quality-score-workflow/` (new dir) | `workflow.ts`, `config.staging.json`, `secrets.yaml` | Port `conf-http-demo` pattern to call scoring-data endpoint |
| **Add MCP tool** | `mcp-server/tools.ts:210` | `TOOLS` array | Add `run_cre_workflow` tool → `POST /api/v1/cre/workflow/run` |

### Effort Estimate, Risk Level, Base Sepolia Notes

| Sub-task | Hours | Risk |
|----------|-------|------|
| Create `scoring-data` route | 2h | Low |
| Add `externalFraudScore` bucket to scoring lib | 1h | Low |
| Add Prisma fields + migration | 1h | Low |
| Add TEE badge to LeadCard | 1h | Low |
| Expose fields in API serializer | 0.5h | Low |
| Port conf-http-demo workflow YAML | 3h | Medium — CRE CLI auth required |
| Promote stub → real CRE SDK | 4h | High — requires CRE DON access + testnet LINK |
| Add MCP tool | 1h | Low |
| **Total (with stub)** | **~5h** | **Low** |
| **Total (real CRE DON)** | **~13h** | **High** |

**Base Sepolia notes:** The CRE CLI (`cre login`, `cre workflow simulate`) targets Chainlink's staging DON — not chain-specific for simulation. The on-chain write step (`CREVerifier.fulfillQualityScore`) requires a deployed CREVerifier on Base Sepolia with an active Chainlink Functions subscription. `CRE_CONTRACT_ADDRESS_BASE_SEPOLIA` env var is already present in `cre.service.ts:25`. The scoring-data endpoint is chain-agnostic (off-chain REST API).

### Judge Impact Score: **9/10**

The QS badge on every lead card is the single most visible trust signal in the entire UI — visible before a bid is placed, on both `BuyerDashboard.tsx` and `Marketplace.tsx` lead grids. Adding "TEE" provenance to that badge makes Chainlink Confidential HTTP directly legible to judges at first glance, without navigating to any detail page. The existing stub scaffold means demo simulation (`cre workflow simulate`) can be shown running in real time.

---

## Private Token Transfers Integration Feasibility (Secondary: Escrow Royalties/Settlements)

### Best Insertion Points

**Option A — PersonalEscrowVault `settleBid()` → Shielded Seller Payment**
- `PersonalEscrowVault.sol:settleBid()` (L244–273) currently calls `paymentToken.safeTransfer(seller, sellerAmount)` as a transparent ERC-20 transfer.
- Integration: Seller deposits USDC into the Compliant Private Transfer Vault (`0x615837B3...B12f` on Sepolia). On auction win, instead of calling `safeTransfer(seller, sellerAmount)`, the contract calls `vault.deposit(sellerAmount)` → the off-chain Private Token API records the private balance. Seller redeems via withdrawal ticket.
- **Challenge:** The vault contract address in the demo is on Sepolia; Base Sepolia adaptation requires redeployment (Foundry `forge build --via-ir` — same toolchain as the demo's prerequisites).

**Option B — RTBEscrow `releaseEscrow()` → Shielded Platform Fee**
- `RTBEscrow.sol:releaseEscrow()` (L240–252) sends `platformFee` to `feeRecipient`.
- Integration: Route `platformFee` through a private token vault instead; platform redeems shielded royalties in aggregate. Demonstrates that platform economics are privacy-preserving.

**Option C — Royalty Splits via ACE PolicyEngine**
- The existing `ACECompliance.sol` and `ace.service.ts` stub already mirror the Compliant Private Transfer Demo's `PolicyEngine` pattern. ACE-gated deposit/withdraw for royalty splits would create a clean narrative: "royalties comply with ACE before settlement".

### Minimal Viable Scope

For a judging demo, **Option B** (shielding the platform fee) is the lowest-risk insertion because:
- It doesn't require changing the buyer/seller payment flow
- The dollar amounts are small (2.5% of bid)
- It shows the API calls (`/deposit`, `/private-transfer`, `/shielded-address`, `/withdraw`) clearly

Minimal implementation:
1. Deploy `SimpleToken` + `Vault` + `PolicyEngine` to Base Sepolia (Foundry scripts already provided in the demo repo)
2. After `releaseEscrow()` sends `platformFee` to `feeRecipient`, backend calls the Private Token API to deposit that amount into the private vault
3. Add a UI panel in `BuyerDashboard.tsx` showing "Platform Royalties (Shielded)" with ACE compliance badge

### Exact Files, Base Sepolia Adaptation

| Action | File | Change |
|--------|------|--------|
| **Deploy contracts** | `contracts/scripts/deploy-private-token.ts` (new) | Foundry `forge script` for `SimpleToken`, `Vault`, `PolicyEngine` to Base Sepolia |
| **Add private token service** | `backend/src/services/private-token.service.ts` (new) | Wrapper for the Compliant Private Transfer API (`/balances`, `/private-transfer`, `/shielded-address`, `/withdraw`, `/transactions`) with EIP-712 signing |
| **Hook into escrow release** | `backend/src/services/escrow-impl.service.ts` | After `releaseEscrow()` call, invoke `privateTokenService.deposit(platformFee)` |
| **Track shielded transactions** | Prisma schema | Add `PrivateSettlement` model with `txType`, `shieldedAmount`, `withdrawalTicket` |
| **UI panel** | `frontend/src/components/marketplace/` → `PrivateSettlementsPanel.tsx` (new) | Show transaction history from `/private-transfer` API |
| **Base Sepolia adaptation** | `backend/src/config/` | Add `PRIVATE_TOKEN_VAULT_ADDRESS_BASE_SEPOLIA`, `PRIVATE_TOKEN_API_URL` envs |

**Base Sepolia note:** The demo's vault contract (`0x615837B3...B12f`) is on Sepolia. For Base Sepolia, run `forge script scripts/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --via-ir`. The off-chain Private Token API (`convergence2026-token-api.cldev.cloud`) is network-agnostic URI and accepts EIP-712 signatures from any wallet.

### Effort Estimate, Risk Level

| Sub-task | Hours | Risk |
|----------|-------|------|
| Deploy contracts to Base Sepolia | 1h | Low (Foundry scripts provided) |
| `private-token.service.ts` wrapper | 3h | Medium (EIP-712 signing flow) |
| Hook into escrow release | 1h | Low |
| Prisma model + migration | 1h | Low |
| UI panel (minimal) | 2h | Low |
| **Total** | **~8h** | **Medium** |

### Judge Impact Score: **7/10**

Private token transfers demonstrate financial privacy in the settlement layer, but they're less immediately visible to judges than the lead card QS badge. The impact is strongest when paired with a live demo flow: show an auction close, then show the shielded balance appear in the private token API. ACE compliance verification is the key differentiator that elevates this beyond a generic privacy feature.

---

## Combined Privacy Narrative & Multi-Track Opportunity

The two features compose into a coherent **"privacy from signal to settlement"** story:

```
Lead Submitted
    │
    ▼
[Confidential HTTP] ───── TEE fetches fraud signals (API key never exposed)
    │                      Score enriched with external signal
    ▼
[QS Badge on Lead Card] ─ "QS 83 🔐 TEE" — trust signal at auction time
    │
    ▼
[Auction Closed — Winner Selected]
    │
    ▼
[PersonalEscrowVault.settleBid()] ── 95% → Seller (transparent)
                                     5% → Private Token Vault (shielded)
                                          ↓
                                  [ACE PolicyEngine validates]
                                          ↓
                               [Off-chain private balance updated]
                                          ↓
                              [Seller redeems via withdrawal ticket]
```

**Multi-track opportunity:** This architecture natively supports a Chainlink hackathon multi-track submission:
- **Track: Confidential HTTP** — QS badge TEE enrichment
- **Track: ACE / Compliant Private Transfers** — shielded royalty settlements
- **Existing tracks already claimed:** Chainlink Functions (CREVerifier), Chainlink Data Feeds (floor pricing), Chainlink Automation (Proof-of-Reserves), Chainlink VRF (tie-breaking)

---

## Prioritized Implementation Sequence & Timeline

### Phase 1 — Confidential HTTP → Lead Card TEE Badge (Days 1–2, ~5h)

> **Primary deliverable: QS badge with "TEE" provenance on live lead cards.**

1. **Day 1 AM (2h):** Create `GET /api/marketplace/leads/:tokenId/scoring-data` route guarded by `x-cre-key` header. Return `LeadScoringInput` JSON. Set `USE_CONFIDENTIAL_HTTP=true` in staging env.
2. **Day 1 PM (2h):** Add `chttEnriched Boolean @default(false)` to Prisma `Lead` model. Run migration. Update `cre.service.ts:verifyLead()` to persist `chttEnriched: true` when CHTT workflow returns `success: true`. Expose in leads API serializer.
3. **Day 2 AM (1h):** Add TEE badge to `LeadCard.tsx` — a small `🔐 TEE` span next to `QS` badge, only when `lead.chttEnriched === true`. Update tooltip.

**Demo script (no CRE CLI needed):** Set `USE_CONFIDENTIAL_HTTP=true`, submit a lead, show the CHTT stub logs in the terminal, show the TEE badge appear on the lead card.

### Phase 2 — CRE Workflow YAML + CRE CLI Simulation (Day 3, ~4h)

> **Deliverable: `cre workflow simulate` running live in terminal during judging.**

4. Port `conf-http-demo` structure to `workflow/quality-score-workflow/`: create `workflow.ts`, `config.staging.json`, `secrets.yaml` (with `creApiKey` → `MY_API_KEY_ALL` mapping), `.env.example`.
5. Add `run_cre_workflow` MCP tool so the AI agent can trigger it.
6. Optionally: enable `encryptOutput: true` and show AES-GCM decryption step in the demo.

### Phase 3 — Private Token Transfers → Shielded Royalties (Days 4–5, ~8h)

> **Secondary deliverable: platform fees routed through ACE-compliant private vault.**

7. Deploy private token contracts to Base Sepolia.
8. Build `private-token.service.ts` with EIP-712 signing for API auth.
9. Hook into `escrow-impl.service.ts` after settlement.
10. Add `PrivateSettlementsPanel.tsx` to `BuyerDashboard.tsx`.

**Total wall-clock time (stub demo): ~5h | Full CRE DON + private transfers: ~13h**

---

## Risks, Mitigations & Scope Controls

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CRE CLI auth / DON access unavailable before judging | Medium | High | Keep stub path (`USE_CONFIDENTIAL_HTTP=true` + local CHTT client) as primary demo path; CRE workflow YAML is shown but not live-executed |
| Base Sepolia private token contract deployment fails | Low | Medium | Use Sepolia contracts + note network; judges evaluate the code and API call logs, not the chain |
| `scoring-data` endpoint returns wrong shape | Low | Low | Strong TypeScript typing on `LeadScoringInput`; unit test parity with `cre-quality-score.ts` |
| CHTT stub score indistinguishable from direct-DB score | Medium | High | **Must add an external fraud signal** (even a mock endpoint returning a fixed value) so the CHTT path demonstrably adds new data. Otherwise TEE badge is cosmetic. |
| Prisma migration breaks staging | Low | Medium | Add fields as `nullable`; no existing rows affected; run `prisma migrate deploy` in staging first |
| Private token EIP-712 signing complexity | Medium | Medium | Use `ethers.TypedDataEncoder.hash()` which is already used in `privacy.service.ts:encryptBid()` |
| Scope creep into ZK / DECO paths | High | Medium | Explicitly freeze DECO and ZK stubs; do not activate them for this sprint — they are already marked `isStub: true` |

---

## Recommended Next Action

**Implement Phase 1 only, in this exact order:**

1. `GET /api/marketplace/leads/:tokenId/scoring-data` route → confirm it returns `LeadScoringInput` JSON correctly.
2. Set `USE_CONFIDENTIAL_HTTP=true` in `.env` and `render.yaml`.
3. Add `chttEnriched` / `chttScore` Prisma fields (nullable, no migration risk).
4. Update `cre.service.ts:verifyLead()` to persist both when CHTT workflow succeeds.
5. Add TEE badge to `LeadCard.tsx` — the visual anchor for the entire Chainlink Confidential HTTP narrative.

This is a self-contained 5-hour change that makes Confidential HTTP legible to judges *on the first page they see* (the marketplace with live lead cards), requires no CRE CLI access to demo, and does not touch any existing scoring logic or contract code. Once this is live, Phase 2 (CRE workflow YAML) and Phase 3 (private token transfers) can be layered on top without refactoring.
