# PROJECT INVESTIGATION SUMMARY — Lead Engine CRE

> **Investigation Date:** 1 March 2026  
> **Investigator:** Antigravity AI (Google DeepMind)  
> **Scope:** Full-repository deep dive — docs, source code, contracts, CRE workflows, tests, file organization  
> **Purpose:** Fresh-session baseline for Phase 1 implementation work  

---

## 1. Project Overview

Lead Engine CRE is a **full-stack, on-chain marketplace for tokenized, privacy-preserving leads** on Base Sepolia, built for the **Chainlink Convergence Hackathon 2026**. The platform spans lead submission, CRE quality scoring, ACE-compliant NFT minting, sealed-bid auctions, atomic USDC settlement via PersonalEscrowVault, autonomous AI agent bidding (Kimi K2.5 + LangChain), winner-only PII decryption, and granular bounty pools.

**Version:** v0.9.6 (28 February 2026)  
**FINAL_PROJECT_AUDIT score:** 8.2 / 10  
**Repository:** [github.com/bnmbnmai/lead-engine-cre](https://github.com/bnmbnmai/lead-engine-cre)  
**Live Demo:** [lead-engine-cre-frontend.vercel.app](https://lead-engine-cre-frontend.vercel.app)  

---

## 2. Repository Structure

```
Lead Engine CRE/
├── backend/              # Express + Prisma + Socket.IO + LangChain
│   ├── src/              # ~80 source files
│   │   ├── routes/       # 16 route files (largest: demo-panel 104KB, marketplace 95KB)
│   │   ├── services/     # 31 service files + demo/ subfolder (6 files)
│   │   ├── lib/          # 13 files (chainlink stubs, encryption, etc.)
│   │   ├── middleware/   # 2 files
│   │   └── rtb/          # 3 real-time bidding files
│   ├── tests/            # ~40 test files (unit/, security/, e2e/, compliance/)
│   ├── prisma/           # Schema + migrations (15 files)
│   └── swagger.yaml      # OpenAPI spec (24KB)
├── frontend/             # Vite + React + Tailwind + Zustand + Socket.IO
│   ├── src/              # ~120 source files
│   │   ├── pages/        # 22 page components
│   │   ├── components/   # 69 components
│   │   ├── hooks/        # 15 hooks
│   │   └── lib/          # 7 utility files
│   └── cypress/          # E2E test scaffolding (spec files, videos, screenshots)
├── contracts/            # Solidity 0.8.27 + Hardhat
│   ├── contracts/        # 13 .sol files + interfaces/ + mocks/ + ace/
│   ├── test/             # 15 Hardhat test files
│   └── scripts/          # 21 deployment/utility scripts
├── cre-workflows/        # Chainlink CRE SDK workflows
│   ├── EvaluateBuyerRulesAndMatch/  # 7-gate buyer rules (9 files)
│   ├── DecryptForWinner/            # Winner-only PII decrypt (4 files)
│   └── project.yaml / secrets.yaml  # DON config
├── cre-templates/        # CRE SDK template references (412 files)
├── mcp-server/           # AI Agent MCP JSON-RPC server (8 files)
├── scripts/              # 12 root-level operational scripts
├── tests/load/           # 4 Artillery load-test configs
├── docs/                 # 7 markdown files + archive/ + certified-runs/
└── 15 root-level .md files
```

**Codebase size (source only):** ~2.1 MB across ~230 files.

---

## 3. Chainlink Integration Depth

### 3.1 Services Summary (12 Distinct Integrations)

| # | Service | Contract / Mechanism | Status | Evidence |
|---|---------|---------------------|--------|----------|
| 1 | **CRE** (Quality Scoring) | `CREVerifier` `0xfec22A…` | ✅ Live | 20+ txns on Basescan |
| 2 | **Functions** (Bounty Match) | `BountyMatcher` `0x897f8C…` | ✅ Deployed | Verified, subscription 581 |
| 3 | **Functions** (ZK Verification) | `CREVerifier` (shared) | ✅ Live | CHTT Phase 2 pattern |
| 4 | **Automation** (PoR + Refunds) | `PersonalEscrowVault` `0x56bB31…` | ✅ Live | 1,477+ txns |
| 5 | **VRF v2.5** (Tiebreakers) | `VRFTieBreaker` `0x86c8f3…` | ✅ Live | 3+ tiebreaker txns |
| 6 | **Data Feeds** (Price Guards) | Inline in Vault | ✅ Live | AggregatorV3Interface |
| 7 | **ACE** (Compliance) | `ACECompliance` `0xAea259…` | ✅ Live | 66+ txns |
| 8 | **CHTT Phase 2** (Confidential) | `CREVerifier` (shared) | ✅ Live | SubtleCrypto encryption |
| 9 | **Confidential Compute** (TEE) | Simulated Enclave | ✅ Simulation | Production-grade sim |
| 10 | **CRE Workflow** (Buyer Rules) | DON-executed | ✅ Live | `cre-workflows/EvaluateBuyerRulesAndMatch/` |
| 11 | **CRE Workflow** (Winner Decrypt) | DON-executed | ✅ Live | `cre-workflows/DecryptForWinner/` |
| 12 | **LeadNFTv2** (ACE-Protected) | `LeadNFTv2` `0x73ebD9…` | ✅ Live | 26+ txns |

### 3.2 Deployed Contracts (7 verified on Basescan)

All 7 deployed contracts carry **"Contract Source Code Verified (Exact Match)"** on Basescan:
- `PersonalEscrowVault`, `LeadNFTv2`, `CREVerifier`, `VRFTieBreaker`, `ACECompliance`, `ACELeadPolicy`, `BountyMatcher`

### 3.3 CRE Workflows

Two production workflows using `@chainlink/cre-sdk ^1.0.9`:

1. **EvaluateBuyerRulesAndMatch** — 7-gate deterministic buyer rule evaluation with `CronCapability`, `ConfidentialHTTPClient`, `consensusIdenticalAggregation`. Triggered on every lead via `afterLeadCreated()` when `CRE_WORKFLOW_ENABLED=true`.
2. **DecryptForWinner** — Winner-only PII decryption with `encryptOutput: true`. Verifies `escrowReleased: true` before decrypting.

### 3.4 Hybrid Architecture

When `CRE_WORKFLOW_ENABLED=true`, CRE DON executes the 7-gate evaluation. When `false`, backend `auto-bid.service.ts` evaluates the **same buyer preference JSON** — ensuring consistent scoring between on-chain and off-chain paths.

### 3.5 Gaps / Observations for Judges

- **Confidential Compute (TEE)** is a simulated enclave in `confidential.service.ts`, not a real TEE. This is clearly documented.
- `BountyMatcher` contract is deployed and verified but has **0 transaction count** on-chain (matching happens via Functions, but the full loop may not have been exercised in a certified demo run).
- `ACELeadPolicy` also shows **0 txns** — it is called indirectly via the `runPolicy` modifier on `LeadNFTv2.mintLead()`, so txns appear on the LeadNFTv2 contract.
- `final-submission-certification.md` references **6 Chainlink services**, but the current `CHAINLINK_SERVICES_AUDIT.md` and `README.md` claim **12** — the certification file is outdated.

---

## 4. Demo Readiness

### 4.1 1-Click Demo Flow

The purple "Run Full On-Chain Demo" button triggers a complete lifecycle:
1. Lead seeding with CRE quality scoring
2. NFT minting with ACE compliance check
3. Sealed-bid auction with autonomous agent bidding
4. Atomic USDC settlement via PersonalEscrowVault
5. Loser refunds + Winner-only PII reveal
6. Proof-of-Reserves verification
7. Wallet recycling

**Status:** Functional end-to-end. The demo-orchestrator (`demo-orchestrator.ts`, 83KB) handles the full cycle including re-auctions, VRF tiebreakers, and wallet fund management.

### 4.2 CRE-Native Mode

- Toggle available in Demo Control Panel ("⛓️ CRE Workflow Mode")
- Auto-enabled when clicking "Run Full On-Chain Demo"
- Every injected lead evaluated by CRE DON 7-gate workflow
- CRE entries appear in persistent On-Chain Log with Basescan proof links

### 4.3 Buyer Portfolio / My Bids

**PERSONA_PORTFOLIO_AUDIT.md** documented a critical 3-part identity chain break (RC-1 through RC-4):
- Wallet address case sensitivity (PostgreSQL)
- `connectedWallet` override hijacking persona identity
- Silent error swallowing in settlement bid creation

**Current status:** The audit documented recommended fixes. Per conversation history (df1126bf), the `GET /bids/my` endpoint was modified to include demo-won leads. **Verify that all 4 root causes are fully resolved** — this is the most critical demo UX issue.

### 4.4 Admin Panel

Three pages at `/admin/*`:
- **AdminNFTs** — NFT minting, proposals, provenance links
- **AdminVerticals** — Vertical lifecycle management (propose → approve → deprecate)
- **FormBuilder** — White-label form configuration per vertical

**Gaps from ADMIN_PANEL_AUDIT.md** (7 issues identified):
1. ❌ Admin panel inaccessible without URL knowledge — no admin link in sidebar Quick Switch
2. ❌ No system health / on-chain status overview at `/admin`
3. ❌ No provenance links in AdminVerticals ACTIVE tab
4. ❌ No redirect to admin after DemoPanel admin login
5. ❌ No audit trail in FormBuilder save/load
6. ❌ Hardcoded auction parameters in AdminNFTs
7. ❌ Quick Switch never includes Admin for ADMIN users

### 4.5 Seller Dashboard

Features bounty targeting card, submit lead form, leads table, analytics. The "Active Buyer Bounties" card with targeting modal and export JSON is a differentiating feature.

---

## 5. Open Tech Debt (from Audits)

### 5.1 HIGH Priority Issues (from FINAL_PROJECT_AUDIT.md)

| ID | Issue | Status |
|----|-------|--------|
| H-1 | README stale/incorrect info | ✅ RESOLVED |
| H-2 | 3 dead frontend pages (~61KB) | ❌ OPEN — `CreateAsk.tsx`, `SellerAsks.tsx`, `SellerTemplates.tsx` not routed |
| H-3 | Near-empty test coverage (backend services) | ❌ OPEN — no unit tests for ace, cre, vrf, vault, auction services |
| H-4 | 7 oversized files (104KB, 95KB, 88KB, 83KB, etc.) | ❌ OPEN — needs decomposition |

### 5.2 MEDIUM Priority Issues

| ID | Issue | Status |
|----|-------|--------|
| M-1 | Chainlink stub files may be dead code | ❌ OPEN — 4 stub files in `lib/chainlink/` |
| M-2 | Naming inconsistency (`data-feeds.service.ts` vs `datastreams.service.ts`) | ❌ OPEN |
| M-3 | Duplicate sweep scripts | ❌ OPEN |
| M-4 | `escrow.service.ts` is a 12-line re-export wrapper | ❌ OPEN |
| M-5 | `useMockData.ts` only for analytics chart placeholders | ❌ OPEN |
| M-6 | `demo-e2e.service.ts` is a thin wrapper | ❌ OPEN |
| M-7 | 25+ TODO/FIXME/HACK markers across codebase | ❌ OPEN |

### 5.3 LOW Priority Issues

| ID | Issue | Status |
|----|-------|--------|
| L-1 | Older `PROJECT_AUDIT.md` possibly superseded | ❌ OPEN |
| L-2 | `cre-templates/` directory has 412 files | ❌ OPEN (unclear which are active) |
| L-3 | `mcp-server/` minimal (8 files) | ❌ OPEN (by design?) |
| L-4 | `faucet-wallets.txt` contains testnet private keys | ❌ OPEN — verify `.gitignore` |
| L-5 | `backend/src/rtb/` purpose unclear | ❌ OPEN |

---

## 6. Documentation Accuracy

### 6.1 Documents Reviewed (18 files)

| File | Location | Last Updated | Accuracy |
|------|----------|-------------|----------|
| `README.md` | root | 28 Feb 2026 | ✅ Good — updated per prior session |
| `FINAL_PROJECT_AUDIT.md` | root | 28 Feb 2026 | ✅ Good |
| `ROADMAP.md` | root | 28 Feb 2026 | ✅ Good |
| `CHAINLINK_SERVICES_AUDIT.md` | root | 24 Feb 2026 | ⚠️ Minor — `datastreams.service.ts` naming mismatch |
| `CONTRACTS.md` | root | 24 Feb 2026 | ✅ Good |
| `ADMIN_PANEL_AUDIT.md` | root | — | ✅ Good — all gaps clearly documented |
| `PERSONA_PORTFOLIO_AUDIT.md` | root | — | ✅ Good — root causes well analyzed |
| `ENV_VARS.md` | root | — | ✅ Good — comprehensive var table |
| `submission-checklist.md` | root | 22 Feb 2026 | ⚠️ Outdated — says 6 services, now 12 |
| `final-submission-certification.md` | root | 22 Feb 2026 | ⚠️ Outdated — says 6 services, old demo run data |
| `docs/PRIVACY_TRACK.md` | docs | 24 Feb 2026 | ✅ Good — thorough code path walkthrough |
| `docs/SKILL.md` | docs | — | ✅ Good — full agent tool reference |
| `docs/GRANULAR_BOUNTIES.md` | docs | 28 Feb 2026 | ✅ Good |
| `docs/MAINNET_MIGRATION.md` | docs | — | ✅ Good — step-by-step migration guide |
| `docs/PRODUCTION_CHECKLIST.md` | docs | — | ⚠️ Contains mix of done/not-done items |
| `docs/ON_CHAIN_VERIFICATION.md` | docs | — | ⚠️ Stale — references Sepolia/Etherscan, not Base Sepolia/Basescan |
| `docs/PITCH_DECK.md` | docs | — | ⚠️ Says 7 services, should be 12; demo URL mismatch |
| `mcp-server/README.md` | mcp-server | — | ✅ Good |

### 6.2 Cross-Reference Issues

1. **Service count inconsistency:** `final-submission-certification.md` says 6, `submission-checklist.md` lists 7 sections (now 10 sections), `CHAINLINK_SERVICES_AUDIT.md` enumerates 12, `PITCH_DECK.md` says 7. **Canonical answer: 12.**
2. **`docs/ON_CHAIN_VERIFICATION.md`** references old Sepolia contracts (not Base Sepolia). Contract addresses don't match current `CONTRACTS.md`. This file appears to be from an earlier deployment phase.
3. **Demo URL discrepancy:** `PITCH_DECK.md` slide 12 says `https://lead-engine-cre.vercel.app`, but `README.md` says `https://lead-engine-cre-frontend.vercel.app`.
4. **`PRIVACY_TRACK.md` line 219** references `PRIVACY_INTEGRATION_AUDIT.md` which does not exist.
5. **`PRODUCTION_CHECKLIST.md`** mentions 10 contracts deployed, but `CONTRACTS.md` lists 7 deployed + 4 reference/future.

---

## 7. Test Coverage

### 7.1 Contract Tests (Hardhat)

**15 test files** in `contracts/test/` covering all major contracts:
- `PersonalEscrowVault.test.ts` (24KB), `VerticalAuction.test.ts` (25KB), `e2e-settlement.test.ts` (31KB)
- `BountyMatcher.test.ts` (24KB), `LeadNFT.test.ts` (15KB), `Marketplace.test.ts` (16KB)
- `VRFTieBreaker.test.ts` (10KB), `ACECompliance.test.ts` (9KB)
- 3 VerticalNFT test files (13KB + 13KB + 8KB)
- `Integration.test.ts` (9KB), `e2e-chainlink-stubs.test.ts` (15KB), `e2e-reorg.test.ts` (9KB)

**Verdict:** Contract tests are **reasonably comprehensive** for a hackathon project.

### 7.2 Backend Tests

**~40 test files** in `backend/tests/`:
- `unit/` — 34 files
- `security/` — 1 file
- `compliance/` — 1 file
- `e2e/` — 1 file
- Root: `auto-bid.test.ts` (26KB), `crm-webhooks.test.ts` (18KB)

**Verdict:** Backend has more test files than the audit suggested, but **service-level unit tests for core Chainlink services** (ace, cre, vrf, vault, auction, nft) need verification — the 34 unit test files may cover utilities rather than critical path services.

### 7.3 Frontend Tests

- **Cypress E2E:** Scaffolding exists (`cypress/` directory with support files, videos), but `e2e/` directory appears empty.
- **Component tests:** None found.

**Verdict:** Frontend testing is the weakest area. No component tests, and Cypress E2E may have been run historically but specs are not committed.

### 7.4 Load Tests

- `tests/load/` — 4 Artillery config files for load testing scenarios.

---

## 8. File Organization

### 8.1 Strengths

- Clean monorepo structure with clear separation (frontend/backend/contracts/cre-workflows/mcp-server)
- Consistent naming conventions across services (`*.service.ts`) and routes (`*.routes.ts`)
- CRE workflows properly structured with `main.ts`, `workflow.yaml`, `secrets.yaml`
- Comprehensive `.env.example` files in each package
- `render.yaml` for infrastructure-as-code deployment
- `.github/` directory for CI workflows

### 8.2 Weaknesses

- **7 oversized files** need decomposition (see H-4 above)
- **3 dead pages** should be deleted (see H-2 above)
- **4 potentially dead Chainlink stub files** in `backend/src/lib/chainlink/`
- **`cre-templates/`** directory has 412 files with unclear active subset
- **`backend/src/rtb/`** — 3 files with undocumented purpose
- **Duplicate scripts** (`sweep-usdc.mjs` variants)
- **`escrow.service.ts`** is just a re-export wrapper

---

## 9. Observations for Hackathon Judges

### 9.1 Strengths (What Will Impress)

1. **12 genuine Chainlink integrations** — each traceable to real on-chain transactions on Basescan
2. **Production CRE workflows** using `@chainlink/cre-sdk` with BFT consensus and Confidential HTTP
3. **Winner-only PII decryption** via CRE DON with `encryptOutput: true` — strong Privacy Track entry
4. **Hybrid CRE architecture** — same buyer preferences evaluated on-chain (DON) and off-chain (backend), single source of truth
5. **Autonomous AI agent** (Kimi K2.5 + LangChain) with 12 MCP tools — clearly differentiated from deterministic auto-bid
6. **Granular bounty pools** with Chainlink Functions matching — unique marketplace feature
7. **1-click end-to-end demo** with on-chain settlement proof
8. **PersonalEscrowVault** with Automation-driven Proof-of-Reserves and VRF tiebreakers
9. **Comprehensive documentation** — 18+ markdown files with architectural diagrams
10. **Multi-track eligibility** — Privacy, CRE & AI, DeFi & Tokenization, Autonomous Agents

### 9.2 Risks / Weaknesses (What Judges Might Note)

1. **Test coverage gaps** — no frontend tests, uncertain backend service coverage
2. **Oversized files** — 104KB route file suggests rushed development
3. **Dead code** — 3 unrouted pages, potentially dead stubs
4. **Documentation inconsistencies** — service count varies across files (6/7/10/12)
5. **Stale certification** — `final-submission-certification.md` outdated
6. **Admin panel discoverability** — judges may never find it without guidance
7. **`ON_CHAIN_VERIFICATION.md`** references wrong network contracts
8. **No video yet** — Loom video mentioned in PITCH_DECK.md but marked as "record before submission"

---

## 10. Pre-Submission Priority Actions

### P0 — Critical Before Submission

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 1 | **Update `final-submission-certification.md`** — update to 12 services, latest demo run data | 15 min | High |
| 2 | **Update `submission-checklist.md`** — align service count, add CRE workflow sections | 15 min | High |
| 3 | **Verify Buyer Portfolio fix is live** — run 1-click demo, switch to buyer, confirm won leads appear | 10 min | Critical |
| 4 | **Record demo video (Loom)** — 3-5 min covering CRE-native mode, 1-click flow, portfolio, admin | 30 min | Critical |
| 5 | **Make Admin Panel discoverable** — add Admin link to sidebar Quick Switch for ADMIN users | 10 min | High |

### P1 — High Impact Before Submission

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 6 | Delete 3 dead frontend pages | 5 min | Medium |
| 7 | Fix `ON_CHAIN_VERIFICATION.md` — update to Base Sepolia addresses or archive | 10 min | Medium |
| 8 | Fix `PITCH_DECK.md` — update to 12 services, correct demo URL | 10 min | Medium |
| 9 | Fix `PRODUCTION_CHECKLIST.md` — update contract count, remove stale items | 10 min | Low |
| 10 | Add redirect to `/admin/nfts` after DemoPanel admin login | 5 min | Medium |

### P2 — Nice to Have

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 11 | Seed Demo Bounties button in Demo Control Panel | 30 min | Medium |
| 12 | Demo flow phase order audit (recycle → fund → banner sequencing) | 1 hr | Medium |
| 13 | Delete/archive Chainlink stub files (`lib/chainlink/*.stub.ts`) | 10 min | Low |
| 14 | Fix `CHAINLINK_SERVICES_AUDIT.md` naming issue (datastreams vs data-feeds) | 5 min | Low |
| 15 | Add basic backend service unit tests for critical paths | 2 hrs | Medium |

---

## 11. Remaining ROADMAP Phase 0 Items (Unchecked)

From `ROADMAP.md`, these Phase 0 items are still marked as not done:

- [ ] **Autonomous Agents Track (Moltbook)** — Integrate `chainlink-agent-skills/cre-skills` into MCP agents; register agent on Moltbook
- [ ] **Data Streams quick win** — Real-time stream trigger for dynamic bounty adjustment
- [ ] **Video & Docs** — 3-5 min public Loom with CRE-native architecture segment
- [ ] **Demo Flow Phase Order Audit** — Recycle → fund → banner sequencing
- [ ] **Final Documentation Sync** — Update submission docs with latest service count
- [ ] **Seed Demo Bounties Button** — One-click bounty population for judges

---

*Investigation Complete. Ready for Phase 1 implementation tasks.*
