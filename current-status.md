# Current Status — LeadRTB (March 3, 2026)

> **Assessment method:** Zero-assumption code inspection, directory audit, git log, live demo log analysis, and Basescan verification.
> **Last commit:** `f3055c4` — `fix(preferences): restore field-level targeting by falling back to form config templates`
> **Last demo run:** 7 cycles, **$290 settled**, **$46 bounties**, 1 VRF tiebreaker, all SOLVENT
> **Last updated:** March 3, 2026 12:55 PM MT (Post-investigation update)

---

## 1. Accomplishments Today (March 3, 2026)

### UI Polish — Lead Card Badge Overhaul
- **Badge hierarchy redesign:** Bounty (gold pill `💰 +$XX`) → CRE score (muted 9px text) → Verified (tiny check pill). TEE/ACE consolidated as micro-chips. All badges use `absolute top-3 right-3 z-20` vertical stack.
- **Fixed double-division bug:** `qualityScore` was divided by 100 on the backend AND frontend — scores displayed as 0. Fixed backend normalization (L965 of `marketplace.routes.ts`) to send 0–100 directly.
- **Tooltip stacking fix:** `hover:z-50` on Card component — hovered card's stacking context rises above siblings, so z-100 tooltips render above everything while staying centered and properly wide. (`af6901e` → `48fe1a9`)
- **Sealed banner fix:** Moved from top-of-card block layout to compact 10px status strip above pricing section. No height change, no badge overlap. (`a54161a`)

### Bounty Settlement — Fixed Nonce Collisions
- **Root cause:** `releaseBounty()` in `bounty.service.ts` sent on-chain txs without explicit nonce management. Racing deployer wallet txs failed with `REPLACEMENT_UNDERPRICED`.
- **Fix:** Added retry-with-backoff loop (3 attempts, 2s delay) with explicit `getNonce('pending')` on each attempt.
- **Result:** Latest run shows **$46 bounties settled** across multiple verticals.

### Bounty Pool Pre-Seed Drain
- **Implemented on-chain pool drain** before seeding new pools in `demo-orchestrator.ts`. Iterates all 8 demo verticals, queries stale pool balances, and withdraws available USDC.
- **Result:** Latest run drained $27 from 2 stale pools during pre-seed.

### Bounty Basescan Links on Demo Results
- **End-to-end feature** (`48fe1a9`): Added `bountyTxHashes?: string[]` to `CycleResult`, collected tx hashes from `releaseBounty()`, rendered clickable Basescan links in `DemoResults.tsx` — both in summary card and per-cycle Gas/Revenue column.

### Deployment Architecture Discovery
- **Frontend is on Vercel** (`lead-engine-cre-frontend.vercel.app`), NOT Render. The `render.yaml` contains only the backend service. Frontend deploys trigger from Vercel's GitHub webhook.

### 🆕 Portfolio Total Invested Bug Fix (`c9bf852`)
- **Problem:** "Total Invested" in the buyer portfolio displayed an astronomically large number (~3×10^75).
- **Root cause:** `reduce` in `BuyerPortfolio.tsx` performed string concatenation instead of numeric addition on `b.amount` values — Prisma `Decimal` fields serialize to strings.
- **Fix:** Added `parseFloat(String(b.amount))` before summing in the reduce function.

### 🆕 Lead Detail Page — PII Decryption Panel (`c723720`)
- **Problem:** Obsolete "You Won — Fund Escrow" panel still showed MetaMask signing flow for on-chain escrow locking — this flow is now handled automatically by PersonalEscrowVault during bidding.
- **Fix:** Replaced with new "Lead Won — Decrypt PII" panel:
  - Vault flow step indicators (Auction won ✓ → USDC locked ✓ → Settlement confirmed ✓ → PII decryption)
  - "Decrypt PII" button → calls `api.demoDecryptPII()` → shows Name/Email/Phone inline with "CRE DON Attested" badge
  - Link to "View in Portfolio"
  - Error handling with retry
- **Also cleaned up** 3 unused imports (`Hourglass`, `Lock`, `EscrowStep`).

### 🆕 Bounty Panel Dropdown Z-Stacking Fix (`f513867`)
- **Problem:** Both `NestedVerticalSelect` dropdowns in the Bounty Pools section of the buyer dashboard had the same z-index. The deposit form's dropdown appeared behind the "View My Pools" section, and the "View My Pools" dropdown appeared behind the Recent Bids card.
- **Fix:** Added `relative z-20` to the deposit form wrapper and `relative z-10` to the pool viewer wrapper in `BountyPanel.tsx`. Creates a clear stacking hierarchy.

### 🆕 Buyer Analytics Charts Fixed (`17026bf`)
- **Problem:** "Bid Activity Over Time" (AreaChart) and "Spending Trend" (BarChart) were completely empty. "Total Spent (30D)" showed $0.00 despite 47 won bids.
- **Root cause:** In live data mode, `bidHistory` was hardcoded to `[]` at L80 — the API call only fetched overview stats and `byVertical` breakdown, never time-series data.
- **Fix:** Added `api.getMyBids()` to the parallel fetch, aggregates real bids by date into `{ date, totalBids, wonBids, spent }` entries, sorts chronologically. Also added `parseFloat(String(...))` guards on `overview.totalSpent` and `v.avgAmount` for Prisma Decimal strings.

### 🆕 Field-Level Targeting Restored (`f3055c4`)
- **Problem:** The "Field-Level Filters" accordion (Section 4) in Auto Bidding preference sets was invisible — despite all the code being present and functional in `PreferenceSetCard.tsx`.
- **Root cause:** The section is conditionally rendered when `verticalFields.length > 0`. Fields come from `api.getFormConfig(vertical)` which reads `Vertical.formConfig` from the DB. That column was empty/null because form config templates only get written to the DB when `demoSeedTemplates()` is explicitly called.
- **Fix:** Added fallback to `FORM_CONFIG_TEMPLATES` in the `GET /:slug/form-config` endpoint in `vertical.routes.ts`. When no config is saved in the DB, tries exact slug then parent slug from the template map.
- **⚠️ Review needed:** This template fallback approach works but may not be the purest architecture. See "Tomorrow's Review Items" below.

---

## 2. Technical State Audit

### On-Chain Contracts

| Contract | Address | Basescan Status | Live Txns | On-Chain Activity |
|----------|---------|-----------------|-----------|-------------------|
| PersonalEscrowVault | `0x56bB31bE…` | ✅ Exact Match | 1,477+ | Active — every bid, settlement, refund goes through this |
| CREVerifier | `0xfec22A51…` | ✅ Exact Match | 20 | Active — `requestQualityScore` + `fulfillRequest` |
| VRFTieBreaker | `0x6DE9fd3A…` | ✅ Exact Match | **0** | ⚠️ Deployed March 2 but **zero on-chain transactions** — see notes below |
| ACECompliance | `0xAea2590E…` | ✅ Exact Match | 66 | Active — `isCompliant()` checks |
| ACELeadPolicy | `0x013f3219…` | ✅ Exact Match | **0** | Deployed, not invoked |
| BountyMatcher | `0x897f8CCa…` | ✅ Exact Match | **0** | Deployed, not invoked (Functions matching disabled) |
| VerticalBountyPool | `0x9C224182…` | ✅ Exact Match | **0** | ⚠️ **Active in code** but Basescan shows 0 txns — needs `BOUNTY_POOL_ADDRESS` env var verification on Render |
| LeadNFTv2 | `0x73ebD921…` | ✅ Exact Match | 26 | Active — NFT mints |

**Key finding — VRFTieBreaker (0 txns):**
The demo reports 1 tiebreaker but Basescan shows 0 txns. Either `isVrfConfigured()` check returns false (VRF_TIE_BREAKER_ADDRESS not set on Render), causing deterministic first-lock-wins fallback, or txs hit the old VRF address.

### CRE Workflow & Confidential Compute

| Component | Status | Details |
|-----------|--------|---------|
| `EvaluateBuyerRulesAndMatch` workflow | ✅ Written, ✅ Simulatable | TypeScript CRE SDK workflow with 7-gate evaluation. **NOT deployed to a live DON** (pending CRE Early Access). |
| `DecryptForWinner` workflow | ✅ Written | Winner-only PII decryption with `encryptOutput: true`. Same DON deployment status. |
| CHTT Phase 2 (ZK Proof) | ⚠️ Stub | `CREVerifier.requestZKProofVerification()` exists on-chain but backend is explicitly marked as a stub. |
| CRE Quality Scoring | ✅ Live | `cre.service.ts` runs real scoring algorithm locally | 
| Backend Hybrid Fallback | ✅ Working | When `CRE_WORKFLOW_ENABLED=false`, buyer preferences evaluated locally with same 7-gate logic. |

### Demo Flow Reliability

**Latest run (7 cycles):** 7/7 settled on-chain. $290 settled. $46 bounties. 1 VRF tiebreaker (deterministic fallback). SOLVENT. $21.50 platform revenue. 2,023,799 gas. 5m 44s duration. Bounty seeding: 5/8 pools succeeded (3 failed — nonce collisions).

### Scaling Infrastructure

| Component | Actual State |
|-----------|-------------|
| BullMQ | ✅ Implemented in `lib/queues.ts`. |
| Redis | ⚠️ `REDIS_URL` **not set in `render.yaml`** — production uses in-memory fallback (`setInterval` every 2s). |
| WebSocket | ✅ Socket.IO implemented. Single-process, no sharding. |

### Test Coverage
- **41 test files** across `backend/tests/` — unit (34), integration (1), e2e (1), security (1), compliance (1), other (3).

---

## 3. Remaining Gaps & Tech Debt

### Critical (Pre-Submission)

1. **VRFTieBreaker: 0 on-chain txns** — Verify `VRF_TIE_BREAKER_ADDRESS` env var on Render. Single most important claim to verify.
2. **VerticalBountyPool: 0 txns on Basescan** — Verify `BOUNTY_POOL_ADDRESS` env var on Render matches `0x9C224182…`.
3. **Repo clutter** — 10+ internal audit/temp files still git-tracked. Execute `git rm` cleanup.

### Medium Priority

4. **Bounty seeding nonce collisions** — `depositBounty()` fails for 3/8 pools per run. Needs same retry-with-getNonce pattern as `releaseBounty()`.
5. **Sweep scripts committed to git** — `scripts/sweep-*.mjs` should be gitignored or removed from tracking.
6. **Record demo walkthrough video** — Compelling visual proof for judges.
7. **Run final clean demo** with all env vars verified and screenshot Basescan with live txns.

### Tomorrow's Review Items

8. **🔍 Form config template fallback architecture** — The current fix for field-level targeting in `vertical.routes.ts` falls back to `FORM_CONFIG_TEMPLATES` in the `getFormConfig` endpoint when no config is saved in the DB. This works but couples the API endpoint to template data. **Purer alternatives to evaluate:**
   - **Option A:** Auto-seed form configs to DB during vertical creation/demo seed — populate `Vertical.formConfig` column so the API always reads from the DB (single source of truth).
   - **Option B:** Separate "default template" endpoint from "saved config" endpoint — `getFormConfigTemplate()` vs `getFormConfig()`.
   - **Option C:** Apply templates during `demoSeedTemplates()` and ensure it's called as part of any demo reset — current approach is fine if templates are always seeded.
   - The current fallback works for the hackathon, but the right long-term answer is Option A (templates seeded to DB on vertical creation).

9. **Prisma Decimal string pattern** — We've now hit this in 3 places: Portfolio Total Invested, Analytics Total Spent, Analytics avgAmount. Should do a sweep for any remaining `reduce` or arithmetic operations on Prisma Decimal fields that might silently string-concatenate instead of numeric-add.

10. **Buyer Analytics chart with single data point** — Since all 47 demo bids land on the same day (3/3/2026), the "Bid Activity Over Time" and "Spending Trend" charts show a single data point. This is technically correct but visually sparse. Consider: generating a backfill of historical demo data across multiple days for a more compelling visual, OR accepting single-point as honest demo behavior.

---

## 4. Tonight's Commits (Chronological)

| Commit | Description |
|--------|-------------|
| `48fe1a9` | Tooltip hover:z-50 fix + bounty Basescan links on demo results |
| `c9bf852` | Portfolio Total Invested bug fix (Prisma Decimal string concatenation) |
| `c723720` | Lead Detail page — replaced Fund Escrow panel with PII Decryption panel |
| `f513867` | Bounty Panel dropdown z-stacking fix (deposit form z-20, pool viewer z-10) |
| `17026bf` | Buyer Analytics — populate Bid Activity and Spending Trend charts from real bid data |
| `f3055c4` | Restore field-level targeting via form config template fallback |

---

## 5. Submission Readiness

### What Stands Out (Judge Impression)

**Strong:**
- ✅ 8 contracts deployed and source-verified on Base Sepolia Basescan
- ✅ Live site at leadrtb.com — 1-click demo settles real USDC on-chain
- ✅ PersonalEscrowVault: 1,477+ transactions, real USDC locking/settlement
- ✅ Bounty system: $46 settled with on-chain calls + Basescan tx links
- ✅ 41 test files — comprehensive coverage
- ✅ Professional UI — marketplace, real-time auctions, badge system, analytics charts
- ✅ CRE workflows written with full `@chainlink/cre-sdk` integration
- ✅ Multi-track eligibility — Privacy, CRE & AI, DeFi & Tokenization, Autonomous Agents
- ✅ Lead detail PII decryption with CRE DON Attested badge
- ✅ Field-level targeting (credit score, property type, loan type) in auto-bidding
- ✅ Real analytics — live charts from actual bid data, spend by vertical pie chart

**Could Be Stronger:**
- ⚠️ VRFTieBreaker: 0 Basescan transactions
- ⚠️ VerticalBountyPool: 0 Basescan transactions (despite active code)
- ⚠️ CRE Workflows: Simulation only (pending Early Access)
- ⚠️ BullMQ/Redis: In-memory mode on production
- ⚠️ Repo clutter — temp files still tracked

### Priority Action Items for Tomorrow

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 1 | **Verify VRF env var on Render** | 🔴 Critical | 2 min |
| 2 | **Verify BOUNTY_POOL_ADDRESS on Render** | 🔴 Critical | 2 min |
| 3 | **Execute directory cleanup** (`git rm` temp files) | 🟡 High | 5 min |
| 4 | **Add nonce retry to `depositBounty()`** | 🟡 Medium | 10 min |
| 5 | **Sweep for Prisma Decimal string arithmetic** across codebase | 🟡 Medium | 10 min |
| 6 | **Review form config template fallback architecture** | 🟢 Low | 15 min |
| 7 | **Gitignore sweep scripts** | 🟢 Low | 2 min |
| 8 | **Record demo walkthrough video** | 🟡 High | 15 min |
| 9 | **Run final clean demo** with verified env vars + Basescan screenshots | 🟡 High | 10 min |

### Deployment Architecture

```
┌─────────────────────────────────┐     ┌──────────────────────────────┐
│  Vercel (Frontend)              │     │  Render (Backend)            │
│  lead-engine-cre-frontend       │────▶│  lead-engine-api             │
│  vercel.json → Vite build       │     │  render.yaml → Node.js       │
│  Auto-deploy from GitHub main   │     │  Auto-deploy from GitHub main│
│  CDN + Edge                     │     │  PostgreSQL (Render DB)      │
│                                 │     │  No Redis (in-memory BullMQ) │
└─────────────────────────────────┘     └──────────────────────────────┘
                                              │
                                              ▼
                                    Base Sepolia (On-Chain)
                                    8 verified contracts
                                    USDC settlements
                                    VRF / Functions / Automation
```

---

## Post-Investigation Status (March 3, 2026 ~12:55 PM MT)

### Architecture Fix: Form Config DB Auto-Seeding (Option A)

**Root cause found:** Demo orchestrator (`demo-orchestrator.ts:897-903`) and vault cycle recycler (`demo-vault-cycle.ts:315-322`) both reset `Vertical.formConfig` to `{}` during bounty pool drain/reset. This wiped the form config templates that power field-level targeting in auto-bid preferences (credit score, property type, etc.).

**Fix applied:**
- Both reset sites now re-seed `FORM_CONFIG_TEMPLATES` into the DB immediately after clearing bounty data
- Removed the `FORM_CONFIG_TEMPLATES` fallback from `vertical.routes.ts` (lines 323-331) — DB is now the single source of truth
- Removed unused `FORM_CONFIG_TEMPLATES` import from `vertical.routes.ts`

**Files changed:** `demo-orchestrator.ts`, `demo-vault-cycle.ts`, `vertical.routes.ts`

### Render.yaml Env Var Hygiene

Added 4 missing env vars as `sync: false` placeholders:
- `VRF_TIE_BREAKER_ADDRESS` — VRFTieBreaker contract on Base Sepolia
- `VRF_SUBSCRIPTION_ID` — Chainlink VRF v2.5 subscription ID
- `DEMO_MODE` — enables demo panel endpoints
- `PLATFORM_WALLET_ADDRESS` — platform fee recipient

These now appear in the Render Dashboard for manual entry on fresh Blueprint deploys.

### VRF Tiebreaker Readiness

- **Env vars confirmed set on Render:** `VRF_TIE_BREAKER_ADDRESS=0x6DE9fd3A54daFB1E145d66F52E538087a3fAEca8`, `VRF_SUBSCRIPTION_ID` ✅
- **Code verified:** `isVrfConfigured()` checks `!!(VRF_TIE_BREAKER_ADDRESS && DEPLOYER_KEY)` — both present ✅
- **Demo tie-force:** Settlement cycle #3 forces equal bids to trigger VRF (`demo-orchestrator.ts:1158-1161`) ✅
- **Next step:** Run a demo to confirm on-chain VRF transaction on Basescan

### CI / Test Status

- **994/994 tests pass locally** (40 suites, exit code 0)
- Fixed 1 pre-existing failure: `marketplace-visibility.test.ts:244` — `BountyDepositSchema` was relaxed from `min(10)` to `min(1)` for small demo pools, but test still expected `amount: 5` to fail. Fixed test to use `amount: 0`.
- CI may still show failures due to Ubuntu/Node 22 environment differences — recommend re-running CI after pushing these changes.

### Temp File Cleanup

- `git rm deploy-bounty-pool-output.txt` ✅
- `git rm deploy-vrf-output.txt` ✅
- `faucet-wallets.txt` — not tracked in git (no action needed)

### Prisma Decimal String Sweep — Clean

Swept entire codebase for `reduce` or arithmetic on Prisma Decimal fields. No new string-concatenation bugs found:
- `BuyerPortfolio.tsx:227` uses `parseFloat(String(b.amount))` ✅
- `analytics.routes.ts:277` uses `Number(l.winningBid || 0)` ✅
- All backend `.reduce()` calls operate on already-numeric values ✅

### Updated Priority Actions

| # | Action | Status |
|---|--------|--------|
| 1 | Form config auto-seeding (Option A) | ✅ Done |
| 2 | Render.yaml env var hygiene | ✅ Done |
| 3 | Directory cleanup (temp files) | ✅ Done |
| 4 | Fix failing test assertion | ✅ Done |
| 5 | Prisma Decimal sweep | ✅ Clean |
| 6 | VRF tiebreaker on Render | ✅ Env vars set — verify on next demo run |
| 7 | Record demo walkthrough video | 🟡 Remaining |
| 8 | Run final clean demo + Basescan screenshots | 🟡 Remaining |

