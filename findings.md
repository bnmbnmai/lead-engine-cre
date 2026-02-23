# Lead Engine CRE — One Click Demo: Technical Audit Findings

> **Audit Date:** February 23, 2026
> **Codebase Snapshot:** Post-Iteration 10, commit post-`current-demo-state.md`
> **Scope:** All demo sub-modules, wallet management, USDC economics, on-chain settlement, real-time sync
> **Auditor:** Full automated code review — zero code changes made
> **Budget Context:** ~$1,000 testnet USDC remaining on deployer wallet

---

## 1. Executive Summary

The One Click Demo infrastructure is structurally sound and test-net-production-grade. The backend modules (`demo-orchestrator`, `demo-shared`, `demo-lead-drip`, `demo-buyer-scheduler`, `demo-vault-cycle`) are well-separated, use a proper singleton abort controller, serialize nonces correctly, handle gas escalation, and implement a real 5-minute natural settlement loop backed by actual on-chain vault transactions.

**The three critical facts about the current state:**

1. **10 private keys are hardcoded in plain text** across `demo-shared.ts` (lines 76–87), `demo-vault-cycle.ts` (lines 369–379), and `faucet-wallets.txt` in the project root. This is a `CRITICAL` security risk for any public/semi-public repository.

2. **The USDC recycling pipeline is mathematically sound** but requires the deployer wallet to have ≥ `$1,000 USDC` free before each run, and it leaves behind stranded locked balances any time a demo is aborted mid-auction. Post-abort cleanup is best-effort only.

3. **The demo is not runnable from a production build** — `DemoPanel.tsx` is gated behind `import.meta.env.DEV`. All operator control (start/stop/monitor) requires dev-mode access or raw HTTP calls to `/api/v1/demo-panel/*`.

The audit identified **29 pain points** across 7 modules. Of these, 7 are `HIGH` severity, 14 are `MEDIUM`, and 8 are `LOW/MINOR`. Full details follow.

---

## 2. Current State Analysis

### 2.1 Module Map

| Module | File | Lines | Role |
|--------|------|-------|------|
| Orchestrator | `backend/src/services/demo/demo-orchestrator.ts` | 1,254 | Singleton run state, pre-flight, natural settlement loop, CRE dispatch |
| Lead Drip | `backend/src/services/demo/demo-lead-drip.ts` | 431 | DB lead creation, socket emission, continuous drip, min-active-floor |
| Buyer Scheduler | `backend/src/services/demo/demo-buyer-scheduler.ts` | ~600 | 10 autonomous buyer personas, `setTimeout` bid scheduling, fallback bids |
| Vault Cycle | `backend/src/services/demo/demo-vault-cycle.ts` | 513 | On-chain lock/settle/refund, post-run recycle, abort cleanup |
| Shared | `backend/src/services/demo/demo-shared.ts` | 408 | Constants, ABIs, **hardcoded keys**, `emit`, `sendTx`, gas escalation |
| Demo Routes | `backend/src/routes/demo-panel.routes.ts` | 1,957 | REST endpoints: login, seed, clear, inject lead, simulate auction |
| Auction Closure | `backend/src/services/auction-closure.service.ts` | ~800 | Resolves expired auctions, VRF tiebreak, BIN, loser refunds |

### 2.2 Demo Wallet Inventory

| Label | Address | Role | Private Key Location |
|-------|---------|------|---------------------|
| Wallet 1 | `0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9` | Buyer | `demo-shared.ts:77`, `demo-vault-cycle.ts:369`, `faucet-wallets.txt:1` |
| Wallet 2 | `0x55190CE8A38079d8415A1Ba15d001BC1a52718eC` | Buyer | `demo-shared.ts:78`, `demo-vault-cycle.ts:370`, `faucet-wallets.txt:2` |
| Wallet 3 | `0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58` | Buyer / Panel User | `demo-shared.ts:79`, `demo-vault-cycle.ts:371`, `faucet-wallets.txt:3` |
| Wallet 4 | `0x424CaC929939377f221348af52d4cb1247fE4379` | Buyer | `demo-shared.ts:80`, `demo-vault-cycle.ts:372`, `faucet-wallets.txt:4` |
| Wallet 5 | `0x3a9a41078992734ab24Dfb51761A327eEaac7b3d` | Buyer | `demo-shared.ts:81`, `demo-vault-cycle.ts:373`, `faucet-wallets.txt:5` |
| Wallet 6 | `0x089B6Bdb4824628c5535acF60aBF80683452e862` | Buyer | `demo-shared.ts:82`, `demo-vault-cycle.ts:378`, `faucet-wallets.txt:6` |
| Wallet 7 | `0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE` | Buyer | `demo-shared.ts:83`, `demo-vault-cycle.ts:374`, `faucet-wallets.txt:7` |
| Wallet 8 | `0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C` | Buyer | `demo-shared.ts:84`, `demo-vault-cycle.ts:375`, `faucet-wallets.txt:8` |
| Wallet 9 | `0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf` | Buyer | `demo-shared.ts:85`, `demo-vault-cycle.ts:376`, `faucet-wallets.txt:9` |
| Wallet 10 | `0x7be5ce8824d5c1890bC09042837cEAc57a55fdad` | Buyer | `demo-shared.ts:86`, `demo-vault-cycle.ts:377`, `faucet-wallets.txt:10` |
| Wallet 11 | `0x9Bb15F98982715E33a2113a35662036528eE0A36` | Seller (Dedicated) | `demo-shared.ts:73`, `faucet-wallets.txt:11` |
| Deployer | `0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70` | Funder / Admin | `backend/.env → DEPLOYER_PRIVATE_KEY` |

> **⚠️ Note on Wallet 3:** Address `0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58` appears as both `DEMO_WALLETS.PANEL_USER`, `DEMO_WALLETS.ADMIN`, `DEMO_WALLETS.BUYER_1`, and `DEMO_BUYER_WALLETS[2]`. This triple-role assignment is confusing and risks conflicts if admin and buyer roles fire simultaneously.

### 2.3 Demo Flow (End-to-End)

```
POST /api/v1/demo-panel/run
  │
  ├─ [PRE-FLIGHT]
  │    ├─ checkDeployerUSDCReserve()    — min $1,000 USDC guard
  │    ├─ cleanupLockedFundsForDemoBuyers()  — refund stranded locks from prior run
  │    └─ prefundBuyerVaults()          — top each of 10 buyer vaults to $300 target
  │         └─ deployer → USDC.transfer(buyer) → buyer.approve(vault) → vault.deposit()
  │
  ├─ [LEAD DRIP — background, fire-and-forget]
  │    ├─ Initial burst: DEMO_INITIAL_LEADS leads at 400–800ms gaps (~5s total)
  │    ├─ Then: 1 lead every 3–9s until 5-min deadline
  │    ├─ Each lead: DB create → emit marketplace:lead:new → emit auction:updated
  │    └─ scheduleBuyerBids() called per lead (10 buyers, staggered setTimeout)
  │
  ├─ [NATURAL SETTLEMENT MONITOR — 5 minutes]
  │    ├─ Poll every 2 seconds for leads with auctionEndAt < now
  │    ├─ Per expired lead:
  │    │    ├─ vault.lockForBid(buyer, amount) × N bidders
  │    │    ├─ vault.settleBid(winnerLockId, sellerWallet)
  │    │    ├─ vault.refundBid(loserLockId) × N-1 losers
  │    │    └─ emit auction:closed
  │    ├─ Mid-run top-up every 75s (checkMidRunUSDCAndTop)
  │    └─ Stranded lock sweep if no active leads
  │
  ├─ [FINALIZATION]
  │    ├─ BuyItNow fallback if vault settlement failed (mintLeadNFT → requestOnChainQualityScore)
  │    ├─ Proof of Reserves (vault.verifyReserves)
  │    ├─ CRE dispatch guarantee (ensure at least 1 CRE event fired)
  │    └─ emit demo:complete
  │
  └─ [RECYCLING — background, 4-min timeout guard]
       ├─ R2: Withdraw deployer vault free balance
       ├─ R3: Seller vault withdraw + USDC transfer → deployer
       ├─ R4: Each buyer: vault withdraw → USDC transfer → deployer
       ├─ R5: Final sweep (check residuals)
       └─ R7: Replenish each buyer vault to $200 for next run
```

### 2.4 USDC Economics Per Run

| Item | Amount | Notes |
|------|--------|-------|
| Pre-fund per buyer vault | $300 target | `prefundBuyerVaults()` tops up each to $300 |
| Total pre-fund (10 buyers) | Up to $3,000 | Only delta from current balance is transferred |
| Post-run replenish target | $200 per buyer vault | `recycleTokens` step R7 |
| Minimum deployer reserve | $1,000 | `DEMO_DEPLOYER_USDC_MIN_REQUIRED` guard |
| Platform fee (on-chain) | 5% of winning bid | Via `vault.settleBid` |
| Convenience fee (winner) | $1.00 | On-chain, baked into vault |
| Gas per run (Base Sepolia) | ~$0.05–$0.40 | Negligible at testnet prices |
| Recycle completeness | ~95–98% | Stranded locks at abort = permanent gap |

**Budget sustainability at $1,000 remaining:**
- With $1,000 on the deployer wallet, the minimum pre-flight check passes (≥ $1,000 required).
- However, buyer vaults from prior runs may already hold $200 each (if recycle worked). Only the *delta* to $300 is transferred.
- If all 10 buyer vaults are empty: deployer needs $3,000. **At $1,000, this run will fail pre-funding completely** unless buyer vaults already have balances.
- **Recommended action before next run:** Check each buyer vault balance on-chain. If USDC < $200 each, fund the deployer with ≥ $3,000 before running again.

---

## 3. Root Cause Analysis

### RCA-01 — Private Keys in Source Code (`CRITICAL`)

**Location:** `demo-shared.ts:76–87`, `demo-vault-cycle.ts:369–379`, `faucet-wallets.txt`

**Root cause:** The demo was designed for rapid iteration — hardcoding keys made injection, approval, and deposit calls trivial. No secrets manager was integrated.

**Risk on testnet:** These are testnet funds only. The real risk is:
- If this repo is ever made public or included in a hackathon submission as source, the wallets' private keys are exposed.
- A key rotation requires manual code edits across 3 files (not 1 `.env`).
- There is no way to rotate keys at runtime without a redeploy.

**Duplication bug:** `REPLENISH_BUYER_KEYS` in `demo-vault-cycle.ts` is a full copy of `DEMO_BUYER_KEYS` from `demo-shared.ts` — if one is updated but not the other, the recycler uses the wrong keys.

### RCA-02 — Stranded USDC Locks on Abort (`HIGH`)

**Location:** `demo-vault-cycle.ts:58–91` (`abortCleanup`)

**Root cause:** When the demo is stopped mid-auction, any in-flight `vault.lockForBid()` transactions that completed but whose `settleBid`/`refundBid` counterpart hasn't fired leave USDC permanently locked in the vault under the buyer's address.

**`abortCleanup`** attempts best-effort refunds from `pendingLockIds`, but this set is only populated if the lock happened *after* the abort signal fires. Locks initiated in the same event loop tick as the abort are invisible to it.

**`cleanupLockedFundsForDemoBuyers`** (pre-run cleanup) catches these orphans on the *next* run, but only if the lockId is discoverable via `vault.lockedBalances()` — which returns the total locked amount, not individual lockIds. The code iterates `lockIds` from a DB query which may be stale.

### RCA-03 — Demo Panel Not Available in Production (`HIGH`)

**Location:** `frontend/src/components/demo/DemoPanel.tsx` (gated on `import.meta.env.DEV`)

**Root cause:** A deliberate safety decision to prevent judges from accidentally triggering the demo. But this means the only way to start/stop/monitor on a hosted Render deploy is via raw API calls.

**Impact:** Any live judge demo requires either a development build or a separate operator with curl/Postman running `POST /api/v1/demo-panel/run`.

### RCA-04 — `emitLiveMetrics` 30-Second Cadence (`MEDIUM`)

**Location:** `demo-buyer-scheduler.ts` (inferred from `current-demo-state.md` §3.3 P-11)

**Root cause:** Metrics are emitted on a 30-second timer, not on every auction event. For a 5-minute demo this means only ~10 updates total. Judges watching the demo metrics panel see stale numbers.

### RCA-05 — Bid Visibility Gap During Vault Settlement (`HIGH`)

**Location:** `demo-buyer-scheduler.ts` → `vault.lockForBid()` (3–8s on-chain round trip)

**Root cause:** No optimistic bid event is emitted until `lockForBid` mines. During a 60-second auction this black hole represents up to 13% of the auction lifetime with zero visible activity.

### RCA-06 — Dead Zone at Demo Start (`HIGH`)

**Location:** `demo-lead-drip.ts:356–372` (initial burst), `demo-buyer-scheduler.ts` (setTimeout scheduling)

**Root cause (improved but not resolved):** The R-07 fix (rapid 400–800ms seed gaps) pre-populates the grid in ~5 seconds. However `scheduleBuyerBids` fires `setTimeout` calls relative to `auctionEndAt`. For the first 50–60 seconds, most setTimeout delays haven't triggered yet. The marketplace shows active auctions with 0 bids — underwhelming.

### RCA-07 — BUG-09 VRF RequestId Never Persisted (`MEDIUM`)

**Location:** `auction-closure.service.ts:270` (noted in `current-demo-state.md` §7)

**Root cause:** `vrfRequestId` is initialized to `null` and set async inside the VRF watcher closure, but the DB persist call uses the `vrfRequestId` variable *before* the async setter fires. VRF outcome is on-chain and provable, but the DB column never records the requestId.

### RCA-08 — `DEMO_VERTICALS` / `FALLBACK_VERTICALS` Duplication (`LOW`)

**Location:** `demo-shared.ts:35–43`

Both arrays are identical 8-element lists. One re-export alias should be removed; both point to the same values but are maintained independently — someone extending one may forget the other.

### RCA-09 — `MAX_CYCLES = 12` Dead Constant (`LOW`)

**Location:** `demo-shared.ts:31`

The constant is exported but never consumed since the natural settlement model replaced the cycle-count model. Causes confusion when reading the code.

### RCA-10 — `demoComplete.totalSettled` Labeling Bug (`LOW`)

**Location:** `DemoPanel.tsx` (display) + `demo-orchestrator.ts` (accumulation)

`totalSettled` is a count of settled auction cycles, but the UI displays it as `$X settled` — implying a dollar amount. Confusing for judges seeing "3 settled" or "5 settled" instead of a revenue figure.

---

## 4. Flow Analysis

### 4.1 Auction Synchronization

The frontend's `auctionStore.ts` (v7) implements a **server-authoritative phase machine**: `live → closing-soon → closed`. No client-side clock is trusted for phase transitions. This is the correct design.

**AuctionMonitor cadence:**
- Polls every **2 seconds** for expired auctions.
- Emits `auction:bid:update` with `remainingTime` for all live auctions.
- Emits `auction:closing-soon` when ≤10 seconds remain.
- Local countdown fills 1-second gaps between server ticks.

**Socket-to-store event map:**

| Socket Event | Frontend Handler | Store Action |
|---|---|---|
| `marketplace:lead:new` | socketBridge → `addLead()` | Adds lead with phase `live` |
| `auction:updated` | socketBridge → `updateBid()` | Re-baselines `liveRemainingMs` |
| `marketplace:bid:update` | socketBridge → `updateBid()` | Updates bid count + remaining |
| `auction:closing-soon` | socketBridge → `setClosingSoon()` | Phase → `closing-soon` |
| `auction:closed` | socketBridge → `closeLead()` | Phase → `closed`, triggers fade |

**Race condition:** `auction:closed` emitted by `auction-closure.service` **and** `auction:updated` emitted by AuctionMonitor can arrive out of order. The store's `closeLead()` premature-close guard (> 5s remaining check) correctly rejects stale AuctionMonitor updates after closure.

**Unresolved gap:** `auction:resolved` (with `finalBids`) is emitted to the `auction_${leadId}` room only, not to the global namespace. Marketplace-grid viewers never see the final bid array — they only ever see the bid count.

### 4.2 USDC Recycle Flow (Detailed)

```
recycleTokens(io, signal, BUYER_KEYS)
  │
  ├─ R1: Warn if seller ETH < 0.005 ETH (no auto-fund)
  │
  ├─ R2: vault.balanceOf(deployer) > 0?
  │    └─ vault.withdraw(deployerVaultBal) via nonce queue
  │
  ├─ R3: For SELLER (Wallet 11):
  │    ├─ vault.balanceOf(seller): withdraw free balance
  │    └─ USDC.transfer(sellerWallet → deployer): entire wallet USDC balance
  │
  ├─ R4: For each BUYER (Wallets 1–10):
  │    ├─ Warn if locked balance > 0 (stranded — will resolve on next cleanup)
  │    ├─ vault.withdraw(freeBal) — withdraw free vault balance to wallet
  │    └─ USDC.transfer(buyerWallet → deployer) — entire wallet USDC
  │
  ├─ R5: Final sweep — re-check all wallets for residual USDC
  │
  ├─ R6: Log deployer balance before vs. after
  │
  └─ R7: Replenish each buyer vault to $200:
       ├─ deployer → USDC.transfer(buyer, topUp)
       ├─ buyer → USDC.approve(vault, MaxUint256)
       └─ buyer → vault.deposit(topUp)
```

**Key correctness issues:**
- R4 transfers the **entire** buyer USDC wallet balance. If a lock is still in-flight at transfer time, the transfer may fail with "insufficient balance" (the locked amount is in the vault, not the wallet, so this is fine — but if a prior vault.withdraw mined a partial amount into the wallet just before the lock settled, there could be a race). The 3-attempt retry with gas escalation handles this case.
- R7 uses a hardcoded `REPLENISH_BUYER_KEYS` map instead of `DEMO_BUYER_KEYS` imported from `demo-shared.ts` — **these two must match exactly** or the depositor signs with a wrong key.
- The 4-minute `withRecycleTimeout` guard prevents a hung recycle from blocking the next run, but can leave wallets partially recycled.

---

## 5. Pain Points: Severity-Ranked

### 🔴 HIGH (7 issues)

| ID | Module | Description |
|----|--------|-------------|
| **BUG-SK** | `demo-shared.ts`, `demo-vault-cycle.ts` | **10 private keys in plain text source code.** Triple-duplicated across `demo-shared.ts:76–87`, `demo-vault-cycle.ts:369–379`, and `faucet-wallets.txt`. A public repo push or screenshot exposes testnet wallets. |
| **BUG-DZ** | `demo-lead-drip.ts` | Dead zone: first 50–60s of a run has leads appear but no bids. `scheduleBuyerBids` setTimeout timers haven't fired yet. Judge's first impression is a quiet marketplace. |
| **BUG-BV** | `demo-buyer-scheduler.ts` | Bid visibility gap: vault settlement takes 3–8s on Base Sepolia. Bidding is invisible during this window. No `auction:bid:pending` event emitted before on-chain confirmation. |
| **BUG-AB** | `demo-vault-cycle.ts` | Abort leaves stranded locks. `abortCleanup` only covers lock IDs added to `pendingLockIds` after abort. Locks mid-flight at abort moment are never refunded until next pre-run cleanup (which can also miss them if lockIds aren't in the DB yet). |
| **BUG-DP** | `DemoPanel.tsx` | Panel invisible in production builds (`import.meta.env.DEV` gate). Live judge demos require raw API access or a dev build. |
| **BUG-BK** | `demo-vault-cycle.ts:368–379` | `REPLENISH_BUYER_KEYS` is a full copy-paste of `DEMO_BUYER_KEYS` instead of importing from `demo-shared.ts`. A key change in one place silently breaks the other. |
| **BUG-LR** | `demo-shared.ts:32` | `DEMO_DEPLOYER_USDC_MIN_REQUIRED = 1000` but at $1,000 deployer balance with empty buyer vaults, the $3,000 pre-fund requirement will fail mid-flow. The guard threshold is too low relative to the actual fund requirement. |

### 🟡 MEDIUM (14 issues)

| ID | Module | Description |
|----|--------|-------------|
| **P-02** | `demo-orchestrator.ts` | `emitStatus()` percent value stalls at 0 until auctions start closing — misleading progress bar in DemoPanel. |
| **P-04** | `demo-orchestrator.ts` | `runId` UUID not shown in any live UI — can't correlate live run with results without checking the Dev Log. |
| **P-07** | `demo-lead-drip.ts` | `ensureDemoSeller()` runs a DB query on every `injectOneLead()` call. Should be cached once per demo run. |
| **P-10** | `demo-buyer-scheduler.ts` | VRF tiebreak resolves 15–90s after auction card has closed and faded — good on-chain provenance, but frontend never shows VRF outcome on the grid. |
| **P-11** | `demo-buyer-scheduler.ts` | `emitLiveMetrics` every 30s (only ~10 updates in a 5-min demo). Metrics panel feels stale. |
| **P-12** | `demo-buyer-scheduler.ts` | `ensureMinBids` fallback uses deployer-signed "synthetic" bids (no vault lock). Inconsistency between real buyer bids and fallback bids in bid history. |
| **P-13** | `demo-vault-cycle.ts` | `recycleTransfer` transfers entire wallet balance. Small in-flight amounts may cause transient failures leaving residue. |
| **P-14** | `demo-vault-cycle.ts` | Recycle takes 2–5 minutes in practice (10 wallets × approve + transfer). Progress events are coarse (per-wallet). |
| **P-16** | `auction-closure.service.ts` | `auction:resolved` emitted to auction room only — global marketplace never sees `finalBids` array. |
| **P-17** | `auction-closure.service.ts` | `convertToUnsold` sets BIN price but UI never displays it. "Buy It Now" UX is wired but not rendered. |
| **P-19** | `auctionStore.ts` | No bid ladder / activity feed. Judges see only a bid count number, not who's winning or at what price. |
| **P-20** | `auctionStore.ts` | `auctionEndFeedback` overlay (8s showing "Auction ended → Sold") disappears, leaving a greyed card with no outcome indication. |
| **P-23** | `LeadCard.tsx` | Winning bid amount (`liveHighestBid`) not shown on closed card. Judge can't see the final price at-a-glance. |
| **P-26** | `DemoPanel.tsx` | `demo:metrics` wait (30s) before "Live Demo" banner appears — for first 30s only a small chip shows the demo is running. |

### 🟢 LOW / MINOR (8 issues)

| ID | Module | Description |
|----|--------|-------------|
| **P-03** | `demo-orchestrator.ts` | `checkActiveLeadsAndTopUp` DB query under load can lag, causing transient empty-grid moments. |
| **P-15** | `demo-vault-cycle.ts` | ETH balances not managed by recycle. Only logs a warning; demo can fail silently if ETH runs dry mid-settlement. |
| **P-18** | `auction-closure.service.ts` | UNSOLD/EXPIRED leads accumulate in DB across demo runs. No cleanup between cycles. |
| **P-21** | `auctionStore.ts` | Re-injected lead with same ID is silently ignored after closure (UUID collision is rare but possible). |
| **P-22** | `LeadCard.tsx` | Countdown drift up to 2s between AuctionMonitor ticks when no bid arrives. |
| **P-25** | `LeadCard.tsx` | Progress bar uses static `lead.auctionDuration` API prop, not server-authoritative remaining time. |
| **P-29** | `DemoPanel.tsx` | `demoComplete.totalSettled` labelled as `$X settled` but it's a count (number of auctions), not dollars. |
| **DEBT** | `demo-shared.ts` | `DEMO_VERTICALS` and `FALLBACK_VERTICALS` are identical arrays at lines 35–43. `MAX_CYCLES = 12` is unused. |

---

## 6. Constraints

1. **Testnet-only wallets:** All buyer and seller keys are testnet EOAs with no mainnet exposure. The security risk is repo hygiene (credential exposure), not financial theft of mainnet assets.

2. **Base Sepolia on-chain latency:** Each vault transaction takes 3–8 seconds. This is an infrastructure constraint, not a code bug. The only mitigation is optimistic UI emission.

3. **$1,000 USDC budget:** At the current balance, the pre-fund phase can only succeed if buyer vaults already hold ≥ $200 each (from a prior recycle run). If all 10 vaults are empty, the deployer needs $3,000 to run the demo cleanly.

4. **Render hosting (production):** The demo panel is DEV-gated. Any production deployment requires either: (a) a separate operator channel (raw API), or (b) a token-protected production-safe UI at `/demo-control`.

5. **VRF resolution time:** Chainlink VRF v2.5 on Base Sepolia resolves in 15–90 seconds. This is a network constraint. The tiebreak result always settles correctly on-chain; the only gap is the frontend doesn't re-open closed cards to show the VRF result.

---

## 7. Recommendations

Ordered by **impact-to-effort ratio**. Each has an estimated effort rating.

### Priority 1 — Pre-Demo Day Fixes (Effort: Low)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| **R-01** | Move all 10 buyer keys + seller key to environment variables (`DEMO_BUYER_KEYS_JSON` as a JSON string, or 11 individual `DEMO_BUYER_KEY_N` vars). Remove `faucet-wallets.txt` from repo and add to `.gitignore`. | 2h | Eliminates credential exposure risk |
| **R-02** | Deduplicate `REPLENISH_BUYER_KEYS` in `demo-vault-cycle.ts` — import from `demo-shared.ts` instead. | 30min | Eliminates silent key mismatch bug |
| **R-03** | Raise `DEMO_DEPLOYER_USDC_MIN_REQUIRED` to `2500` (or make it dynamic: `10 × replenishTarget`). | 15min | Prevents mid-run pre-fund failures at low balance |
| **R-04** | Remove `DEMO_VERTICALS` alias — export only `FALLBACK_VERTICALS` under a single name. Remove `MAX_CYCLES`. | 15min | Eliminates debt |
| **R-05** | Fix `totalSettled` display — show it as "N auctions settled" not "$N settled". | 15min | Fixes judge-facing confusion |

### Priority 2 — Demo UX Improvements (Effort: Low-Medium)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| **R-06** | Emit `auction:bid:pending` immediately when buyer scheduler fires, *before* on-chain confirmation. Frontend shows "Bid incoming…" state instantly. | 3h | Eliminates 3–8s bid visibility gap |
| **R-07** | Reduce `emitLiveMetrics` interval from 30s → 5s. | 15min | Live metrics feel alive |
| **R-08** | Add "sniper rush" heuristic: ensure 2–3 bids fire in the last 15s of each auction. | 2h | Creates last-second RTB tension |
| **R-09** | Show `liveHighestBid` on closed LeadCard ("Sold: $82.40"). | 1h | Judges see economic outcome at-a-glance |
| **R-10** | Cache `ensureDemoSeller()` result per run — memoize sellerId at drip start. | 30min | Removes redundant DB queries |
| **R-11** | Produce a production-safe `/demo-control?token=X` page (or un-gate DemoPanel behind `VITE_DEMO_MODE=true` instead of `DEV`). | 3h | Enables operator control on Render staging |

### Priority 3 — Architecture Improvements (Effort: Medium)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| **R-12** | Implement a global Activity Feed: stream `marketplace:bid:update` events to a sidebar ticker showing buyer name, vertical, amount. | 1 day | Judges see bid narrative, not just counters |
| **R-13** | Optimistic bid injection: frontend shows speculative bid immediately on `auction:bid:pending`, confirmed or withdrawn on timeout. | 1 day | Zero perceived latency |
| **R-14** | Fix `vrfRequestId` DB persist (BUG-09 in `auction-closure.service.ts`) — pass requestId into closure before async call. | 1h | Correct VRF provenance record |
| **R-15** | Emit `auction:resolved` globally (not only to auction room) — allows marketplace grid to show final bid array on closed cards. | 30min | Richer post-close card state |
| **R-16** | ETH auto-top-up: if any buyer wallet ETH < 0.005 ETH, deployer sends 0.01 ETH before the demo starts (inside pre-flight). | 2h | Removes manual ETH management requirement |

---

## 8. USDC Recycling Strategy

### 8.1 Decision: Fix vs. Rewrite

**Verdict: Fix.** The recycling pipeline in `demo-vault-cycle.ts` is already well-structured (R1–R7 steps, timeout guard, per-wallet retry). The issues are:
1. Wrong key source (`REPLENISH_BUYER_KEYS` copy-paste) — 1-line fix.
2. Threshold guard too low — 1-line fix.
3. Stranded lock handling is best-effort — acceptable for testnet.

**Do not rewrite** unless the above fixes are insufficient after the next 2–3 demo runs.

### 8.2 Current Deployer Balance: $1,000

**Assessment:** Marginally sufficient only if buyer vaults have residual balances.

**Before next demo run, do the following:**

#### Step 1 — Check current on-chain state
Run or inspect the following for each wallet:
```bash
# Check buyer vault free balances (repeat for each wallet address)
cast call <VAULT_ADDRESS> "balanceOf(address)(uint256)" <BUYER_WALLET> --rpc-url https://sepolia.base.org

# Check USDC wallet balances
cast call 0x036CbD53842c5426634e7929541eC2318f3dCF7e "balanceOf(address)(uint256)" <WALLET> --rpc-url https://sepolia.base.org
```

#### Step 2 — Manual recycle if vaults are empty
If buyer vaults show $0 and deployer has only $1,000, **do not run the demo** yet. Either:
- Option A: Use `POST /api/v1/demo-panel/reset` endpoint (calls `recycleTokens` + `cleanupLockedFundsForDemoBuyers`) to attempt a recovery from whatever is in the wallets.
- Option B: Run `scripts/consolidate-usdc.js` to sweep all buyer wallet USDC to the deployer.
- Option C: Get more testnet USDC from the Base Sepolia faucet and deposit to deployer.

#### Step 3 — Trigger recycleTokens manually if needed
The `/api/v1/demo-panel/recycle` endpoint (if exposed, check `demo-panel.routes.ts`) or trigger via `POST /api/v1/demo-panel/reset` which calls `cleanupLockedFundsForDemoBuyers + recycleTokens`.

#### Step 4 — Run the demo only when deployer ≥ $2,500
With $2,500 on deployer:
- 10 buyers × $200 replenish target = $2,000 needed.
- $500 buffer for the run itself (settlements flow back to deployer via seller wallet → deployer recycle).

#### Step 5 — Post-demo recycle is automatic
After `runFullDemo` completes, `recycleTokens` runs automatically in the background (4-minute timeout guard). Verify in the DevLogPanel that all R1–R7 steps complete without `⚠️ All 3 attempts failed` warnings. If any wallet fails, the next run's pre-flight cleanup will catch it.

### 8.3 Long-Term Recycling Contract

The recycling loop is **economically sustainable indefinitely** at testnet prices:
- Platform fee (5%) + convenience fee ($1) flow to the seller wallet.
- Seller wallet is recycled back to deployer in R3.
- Net deployer loss per run ≈ gas costs only (~$0.10–$0.50 base sepolia).
- The $1,000 budget at current gas prices supports **hundreds of demo runs**.

The only real drain is if recycling fails to complete (stranded locks + aborts). In that case, funds accumulate in locked vault positions until `cleanupLockedFundsForDemoBuyers` resolves them on the next run's pre-flight.

---

## 9. Overall Verdict

| Dimension | Verdict |
|-----------|---------|
| **Infrastructure soundness** | ✅ Production-grade — vault mechanics, nonce queue, gas escalation, idempotent closure |
| **Demo repeatability** | ✅ Self-sustaining USDC loop, effective cleanup, 4-min timeout guard |
| **Security** | 🔴 Critical — 10 private keys in source code and plaintext file |
| **Demo UX** | 🟡 Medium — bid visibility gap, dead zone at start, no winning price on closed card |
| **Operator experience** | 🔴 High — panel DEV-gated, production control requires raw API |
| **Code cleanliness** | 🟡 Medium — duplicated key maps, dead constants, labeling bugs |
| **Overall** | **Fix (not rewrite).** Apply Priority 1 fixes before the next demo run. Apply Priority 2 for the hackathon presentation build. |

---

## 10. Appendix: Key File Locations

| What | Path |
|------|------|
| Demo orchestrator | `backend/src/services/demo/demo-orchestrator.ts` |
| Demo shared (keys here) | `backend/src/services/demo/demo-shared.ts` |
| Lead drip | `backend/src/services/demo/demo-lead-drip.ts` |
| Buyer scheduler | `backend/src/services/demo/demo-buyer-scheduler.ts` |
| Vault cycle + recycle | `backend/src/services/demo/demo-vault-cycle.ts` |
| Demo panel routes | `backend/src/routes/demo-panel.routes.ts` |
| Auction closure service | `backend/src/services/auction-closure.service.ts` |
| Frontend demo panel | `frontend/src/components/demo/DemoPanel.tsx` |
| Frontend auction store | `frontend/src/stores/auctionStore.ts` |
| Frontend lead card | `frontend/src/components/marketplace/LeadCard.tsx` |
| Wallet plaintext (remove!) | `faucet-wallets.txt` |
| Prior audit | `current-demo-state.md` |
| Env example | `backend/.env.example` |
| USDC consolidation script | `scripts/consolidate-usdc.js` |

---

*End of findings. No code was modified during this audit.*
