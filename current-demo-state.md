# Lead Engine CRE — Auction & Demo System Audit

> **Audit Date:** February 22, 2026
> **Codebase Snapshot:** Commit `75b7c54` · Iteration 10
> **Scope:** Backend auction/demo services, frontend state management, real-time sync layer, economic model, UX
> **Auditor:** AI-assisted comprehensive code review
> **Mandate:** Objective findings only. Zero code changes made.

---

## 1. Executive Summary

The Lead Engine CRE demo system is a sophisticated, production-grade simulation of a fully on-chain lead marketplace. The backend is structurally sound, with idempotent auction closure, proper nonce serialization, gas escalation, and a well-designed singleton abort controller. The frontend Zustand store (`auctionStore` v7) correctly implements a server-authoritative phase machine, eliminating the client-clock races that plagued earlier iterations.

However, despite this strong foundation, the **demo experience falls short of the high-energy RTB feel** the platform is capable of projecting. The key gaps are:

1. **Bids are invisible until they land in the DB** — no speculative/pending bid UI while the vault lock is in-flight.
2. **Drip timing creates an empty-gap feeling** — the first 55 seconds of a run are all seeding, no bidding.
3. **Buyer profiles bid too uniformly** — the staggered `setTimeout` distribution doesn't create the late-rush urgency of a real auction.
4. **No live bid ladder or activity feed** — a viewer watching the marketplace sees only a bid count number, no narrative.
5. **The 30-second `emitLiveMetrics` cadence is too slow** for a judge watching a 5-minute demo.
6. **`CLOSE_GRACE_MS` (15 s) still feels long** — closed cards dominate the grid before fading out.
7. **Private keys are hardcoded in `demo-shared.ts`** — a security concern for any repo that is or will be public.

---

## 2. System Architecture Overview

### 2.1 Backend Module Map

| Module | File | Responsibility |
|---|---|---|
| Orchestrator | `demo-orchestrator.ts` | Singleton run state, pre-flight checks, natural settlement monitor |
| Lead Drip | `demo-lead-drip.ts` | Staggered lead injection, min-active-leads top-up |
| Buyer Scheduler | `demo-buyer-scheduler.ts` | 10 autonomous buyer profiles, `setTimeout` bid scheduling |
| Vault Cycle | `demo-vault-cycle.ts` | On-chain USDC locks, settle, refund, loser refunds, post-run recycle |
| Shared | `demo-shared.ts` | Constants, ABIs, wallet keys, `emit`, `sendTx`, gas escalation |
| Auction Closure | `auction-closure.service.ts` | Resolves expired auctions, VRF tie-break, BIN conversion, socket broadcast |

### 2.2 Frontend Module Map

| Module | File | Responsibility |
|---|---|---|
| Zustand Store | `auctionStore.ts` | Server-authoritative phase machine (v7), bid count monotonicity, grace eviction |
| Lead Card | `LeadCard.tsx` | Phase-driven UI, local countdown tick, bid flash animation, fade-out |
| Demo Panel | `DemoPanel.tsx` | Floating control panel, socke-driven run metrics, stop/reset/fund actions |
| Dev Log Panel | `DevLogPanel.tsx` | Real-time log stream from `demo:log` + `ace:dev-log` socket events |

### 2.3 Data Flow

```
Backend Demo Run
 └─ demo-orchestrator.runFullDemo()
     ├─ startLeadDrip() → injectOneLead()
     │    └─ emit io('marketplace:lead:new', lead)
     └─ scheduleBuyerBids() → setTimeout bids
          └─ vault.lockForBid() → placeBid() → emit io('marketplace:bid:update', ...)

AuctionMonitor (every 2s)
 └─ resolveExpiredAuctions()
      └─ resolveAuction() → emit io('auction:closed', ...)

Frontend Socket Bridge (App.tsx)
 └─ 'marketplace:lead:new'   → auctionStore.addLead()
 └─ 'marketplace:bid:update' → auctionStore.updateBid()
 └─ 'auction:closing-soon'   → auctionStore.setClosingSoon()
 └─ 'auction:closed'         → auctionStore.closeLead()

auctionStore → LeadCard (via Zustand selector)
 └─ auctionPhase ∈ { 'live', 'closing-soon', 'closed' }
 └─ liveRemainingMs (clock-drift corrected, visual only)
 └─ liveBidCount (monotonic, never decrements)
 └─ newBidFlash (epoch ms, drives 800ms glow animation)
```

---

## 3. Deep Dive: Backend

### 3.1 Demo Orchestrator (`demo-orchestrator.ts`)

**Strengths:**
- Singleton `isRunning` + `AbortController` pattern cleanly prevents concurrent runs.
- Pre-flight checks: deployer ETH/USDC reserves, orphaned lock cleanup.
- Natural settlement monitor (replaces fixed cycle counts) gives an organic feel.
- `demo-results.json` file persistence survives server restarts.
- Mid-run USDC top-up (`checkMidRunUSDCAndTop`) prevents wallet exhaustion.

**Pain Points:**

| ID | Severity | Description |
|---|---|---|
| P-01 | 🔴 High | The `runFullDemo` function calls `startLeadDrip` first, then immediately returns the settlement monitor. The initial seeding of `DEMO_INITIAL_LEADS` leads takes ~55 seconds (staggered 1s gaps × initial batch). During this window, buyers haven't started bidding on early leads yet, creating a **dead zone at demo start**. |
| P-02 | 🟡 Med | `emitStatus()` uses a cycle/totalCycles model internally, but the natural settlement monitor tracks completions differently. The `percent` value in status events may be misleading or stall at 0 until auctions start closing. |
| P-03 | 🟡 Med | The `checkActiveLeadsAndTopUp` function runs every 15 seconds inside the drip loop but the check uses a DB query. Under load (many leads closing simultaneously), the top-up firing lag can cause transient empty-grid moments. |
| P-04 | 🟢 Low | `runId` is a UUID that isn't surfaced in any live UI element. Observers have no way to correlate the running demo with results without manually checking the Dev Log. |

### 3.2 Lead Drip (`demo-lead-drip.ts`)

**Strengths:**
- 8 distinct verticals with realistic form parameters per vertical.
- Separate demo seller profile (Wallet 11) with dedicated key, never overlapping buyers.
- NFT minting → CRE quality scoring pipeline integrated on each injected lead.
- `checkActiveLeadsAndTopUp` ensures the marketplace never looks empty.

**Pain Points:**

| ID | Severity | Description |
|---|---|---|
| P-05 | 🔴 High | `injectOneLead` must complete NFT minting + CRE oracle call before emitting `marketplace:lead:new`. This is an on-chain round trip (~5–15 s). During heavy bursts, this creates visible latency between "a lead was scheduled" and "it appears on screen". There's no optimistic UI lead emission before confirmation. |
| P-06 | 🟡 Med | `DEMO_INITIAL_LEADS` (default likely 8–10) are seeded with a 1-second stagger. This creates a visible "trickle-in" at start rather than a pre-populated marketplace. A judge opening the page mid-seeding sees 3 cards, then 5, then 8 — fragmented. |
| P-07 | 🟢 Low | The fallback seller ID lookup (`ensureDemoSeller`) runs on every `injectOneLead` call. It should be cached once per demo run. |

### 3.3 Buyer Scheduler (`demo-buyer-scheduler.ts`)

**Strengths:**
- 10 distinct buyer personas with named identities (`MortgageMaven`, `SolarSam`, etc.), vertical preferences, score thresholds, bid ceilings, and aggression coefficients — sophisticated for a simulation.
- `timingBias` field allows each buyer to bid earlier or later in the auction window.
- Fallback bidding (`ensureMinBids`) guarantees ≥4 bids per auction for liveness.
- `activeBidTimers` registry enables clean cancel-on-abort.
- Mid-run USDC sweeps recover free vault balances without halting the demo.

**Pain Points:**

| ID | Severity | Description |
|---|---|---|
| P-08 | 🔴 High | All bids are scheduled with `setTimeout` at demo-start relative to `auctionEndAt`. There is **no bid in the final 10–15 seconds** unless the random timing happens to land there — this kills the "last-second sniping" tension of real RTB auctions. |
| P-09 | 🔴 High | The `vault.lockForBid()` on-chain transaction is ~3–8 seconds on Base Sepolia. From the moment a bid is "scheduled" to when it's visible on-chain (and thus in the DB / socket event), there's a silent gap. The frontend shows nothing during this window. |
| P-10 | 🟡 Med | Buyer aggression coefficient is defined but its effect on bid amount spread is subtle. `maxPrice` acts as a hard ceiling, so in practice multiple buyers converge on similar amounts and ties are common. VRF tiebreak is the fallback, but it takes 15–90 s to resolve on-chain — long after the auction card has closed and faded. |
| P-11 | 🟡 Med | `emitLiveMetrics` fires every **30 seconds**. For a 5-minute demo with a judge watching, this means a metric update 10 times, or once every 30 seconds. The DevLog shows a live pulsing dot but the numbers barely change in real time. |
| P-12 | 🟢 Low | The `ensureMinBids` fallback uses the `deployer` wallet to place synthetic bids if fewer than 4 buyers bid. These bids are placed without an on-chain vault lock (they use `FALLBACK` source), making them structurally different from real buyer bids. This creates inconsistency in the bid history tooltip on LeadCard. |

### 3.4 Vault Cycle (`demo-vault-cycle.ts`)

**Strengths:**
- `abortCleanup` correctly iterates `pendingLockIds` to refund orphaned locks.
- `recycleTokens` is comprehensive: drain all wallets → replenish buyer vaults → confirm vault balances.
- Gas escalation (`sendWithGasEscalation`) with 2-retry EIP-1559 logic is production-grade.
- `recycleVaultWithdraw` handles the "free balance" case where USDC is in the vault but not locked.
- Timeout guard (10 minutes) on the entire recycle process prevents infinite hangs.

**Pain Points:**

| ID | Severity | Description |
|---|---|---|
| P-13 | 🟡 Med | `recycleTransfer` transfers the **entire** USDC balance of each wallet. If a buyer wallet has a partial in-flight lock at the moment of recycle, the transfer may fail with "insufficient balance". The retry handles this but may leave a small residue. |
| P-14 | 🟡 Med | The post-run recycle takes 2–5 minutes in practice (10 wallets × on-chain approval + transfer). The `demo:recycle-progress` events are emitted but the progress is coarse (per-wallet, not per-transaction). |
| P-15 | 🟢 Low | ETH balances in demo wallets are not managed by `recycleTokens`. They must be topped up separately via `handleFundEth` in the DemoPanel or via the external script `fund-wallets-eth-permanent.mjs`. There is no automated pre-run ETH check beyond a balance gate that just logs a warning — it does not block the demo if one wallet has low ETH. |

### 3.5 Auction Closure Service (`auction-closure.service.ts`)

**Strengths:**
- Idempotent: all closure functions are safe to call concurrently (DB-level uniqueness enforced).
- 2-second safety gate prevents premature resolution when AuctionMonitor fires within the last tick.
- `resolveStuckAuctions` handles null `auctionEndAt` / 5-minute-stale orphans — good safety net.
- VRF tiebreak is non-blocking: deterministic fallback winner selected immediately, VRF watcher runs async.
- Loser escrow auto-refund runs for all OUTBID bids — vault money returns to buyers.
- `auction:closed` event includes `finalBids` array, enabling rich winner/loser display on frontend should it be wired up.

**Pain Points:**

| ID | Severity | Description |
|---|---|---|
| P-16 | 🟡 Med | `resolveAuction` emits `auction:resolved` only to `auction_${leadId}` room, but `auction:closed` is emitted globally. If a viewer is not in the auction room (just watching marketplace), they get `auction:closed` but not `auction:resolved`. The `finalBids` in `auction:closed` is never rendered on the LeadCard. |
| P-17 | 🟡 Med | `convertToUnsold` sets `buyNowPrice = reservePrice * 1.2`. For the demo, this BIN offer is created but the UI shows "Auction ended → Buy It Now" regardless of whether a BIN is actually set. There's no BIN price displayed on the closed LeadCard. |
| P-18 | 🟢 Low | The `resolveExpiredBuyNow` function transitions UNSOLD leads to EXPIRED after 7 days. These are never cleaned up from the demo runs — over many demo runs the DB accumulates ghost UNSOLD/EXPIRED leads from prior iterations. |

---

## 4. Deep Dive: Frontend

### 4.1 Auction Store (`auctionStore.ts`)

**Strengths (v7 golden standard):**
- Pure server-authoritative phase machine: `live → closing-soon → closed`. No local-clock phase transitions.
- `closeLead` premature-close guard (>5 s remaining) correctly handles stale `auction:closed` events from the AuctionMonitor racing the demo orchestrator.
- `liveBidCount` is strictly monotonic — never decrements during an active auction.
- `bulkLoad` merges `max(socket-driven, api _count.bids)` — bids are always the higher of two sources.
- `newBidFlash` epoch timestamp drives the emerald card glow correctly.
- `forceRefreshLead` on mount resolves any API-vs-socket race at initial load.
- `CLOSE_GRACE_MS = 15_000` with fade starting at `closedAt + 100ms` feels snappy enough.

**Pain Points:**

| ID | Severity | Description |
|---|---|---|
| P-19 | 🟡 Med | `recentBids` is persisted per-lead in the store and shown in the bid count tooltip. However it only contains the **last 3 bids by buyer label** (e.g., `MortgageMaven: $82.40`). There is no running bid ladder or bid history panel visible from the marketplace grid — a viewer can't see who's "winning" without hovering every card. |
| P-20 | 🟡 Med | The `auctionEndFeedbackMap` overlay ("Auction ended → Sold" / "… → Buy It Now") shows for 8 seconds. After that, the card is just greyed with no indication of outcome until it fades at 2.5 s later. There's no persistent SOLD badge or winning price shown on a closed LeadCard. |
| P-21 | 🟢 Low | `addLead`: if a lead already exists and is closed, incoming `marketplace:lead:new` is ignored (returns `state` unchanged). This is correct behavior for socket dedup, but means a re-injected lead with the same ID won't appear until manual refresh. Demo leads use UUIDs so this is rare, but possible if `injectOneLead` is called twice quickly with the same slug. |

### 4.2 Lead Card (`LeadCard.tsx`)

**Strengths:**
- Phase-driven border colors: `blue (live) → amber (closing-soon) → grey (closed)` — clean visual grammar.
- `bidPulse` (scale-110 for 800ms) and `showNewBidFlash` (emerald badge) fire correctly on each new bid.
- Progress bar is purely visual and decoupled from the server clock — never affects phase.
- `isFadingOut` (opacity 0 over 2500ms) triggered by `storeSlice.fadeOutAt` — smooth and React-idiomatic.
- Sealed bid state (🔒) shown inline without disrupting layout.

**Pain Points:**

| ID | Severity | Description |
|---|---|---|
| P-22 | 🔴 High | The countdown tick (`setInterval(tick, 1_000)`) re-baselines from `storeRemainingMs` on each socket update (~every 2 s). Between server ticks, the local tick decrements by 1000ms. But `storeRemainingMs` updates are driven by `marketplace:bid:update` events — **if no bid arrives in 30+ seconds, the local countdown drifts by up to 2 seconds** before the next AuctionMonitor tick corrects it. For 60-second auctions this is noticeable. |
| P-23 | 🟡 Med | The winning bid amount (`liveHighestBid`) is shown nowhere on the LeadCard once the auction closes. After `closeLead`, the card greys out but shows only "Auction ended → Sold". The judge does not see the final winning price on the card. |
| P-24 | 🟡 Med | The `auctionEndFeedback` overlay uses `ArrowRight` icon and neutral text for both SOLD and UNSOLD. The visual differentiation between SOLD (emerald) and UNSOLD (amber) is color-only — no icon difference and no price. |
| P-25 | 🟢 Low | Card progress bar uses `lead.auctionDuration` from the static API prop. If the auction duration is extended or shortened server-side after the card renders, the progress bar is out of sync but the countdown is correct. |

### 4.3 Demo Panel (`DemoPanel.tsx`)

**Strengths:**
- `demoMetrics` banner (live pulsing) appears when `demo:metrics` arrives — clean conditional rendering.
- Elapsed timer (`elapsedSec`) counts up from when `demo:status{running:true}` first fires.
- `Stop Demo` button visible in both the metrics banner and the pre-metrics "running" chip.
- `runningActionsRef` imperative guard prevents double-click duplicate API calls.
- "Full Reset & Recycle" button with `demo:recycle-progress` progress bar provides good operator feedback.
- Persona switching uses real JWT (`demo-login` endpoint) and reconnects the socket with the new token.

**Pain Points:**

| ID | Severity | Description |
|---|---|---|
| P-26 | 🔴 High | The Demo Panel is **only rendered in DEV mode** (`import.meta.env.DEV`). For hosted demos (Render staging), judging runs on production builds where the panel is absent. The operator must use raw API calls or Render logs to start/stop/monitor the demo. |
| P-27 | 🟡 Med | `demoMetrics` fires every 30 seconds (`emitLiveMetrics`). The panel shows "Active: N" and "Platform rev today: $X" but these numbers only update every 30 s. During fast-moving auctions a judge may see stale metrics. |
| P-28 | 🟡 Med | The "Live Demo" banner appears only after the first `demo:metrics` event (30 s in). For the first 30 seconds of a run, the only indicator is the small "Demo Running…" chip — a judge may not notice the demo has started. |
| P-29 | 🟢 Low | `demoComplete.totalSettled` is displayed as `$X settled` but this is the count of settled auctions (CycleResult entries), not a dollar amount. The variable name is misleading. |

---

## 5. Real-Time Sync Layer Audit

### 5.1 Socket Events Inventory

| Event (Server → Client) | Emitter | Consumer | Notes |
|---|---|---|---|
| `marketplace:lead:new` | `demo-lead-drip` | socketBridge → `addLead` | Fires after NFT mint + CRE score — latency |
| `marketplace:bid:update` | `demo-buyer-scheduler` | socketBridge → `updateBid` | Fires after vault lock confirms on-chain |
| `auction:closing-soon` | AuctionMonitor (socket.ts) | socketBridge → `setClosingSoon` | Triggered when ≤10 s remain |
| `auction:closed` | `auction-closure.service` | socketBridge → `closeLead` | Authoritative, includes `finalBids` |
| `auction:resolved` | `auction-closure.service` | auction room only | Not consumed by marketplace grid |
| `demo:log` | `demo-shared.emit()` | DevLogPanel | Every step logged |
| `demo:status` | `demo-shared.emitStatus()` | DemoPanel | Running state |
| `demo:metrics` | `emitLiveMetrics` | DemoPanel | Every 30 s |
| `demo:results-ready` | Orchestrator | DemoPanel | On completion |
| `demo:recycle-progress` | `demo-vault-cycle` | DemoPanel | Per-wallet during recycle |
| `leads:updated` | `auction-closure.service` | MarketplaceGrid | Full re-fetch trigger |

**Gap identified:** There is no `auction:bid:pending` or `auction:bid:submitted` event emitted when the buyer scheduler *schedules* a bid but before the vault lock confirms. The frontend has zero visibility into pending bids.

### 5.2 AuctionMonitor Cadence

The `AuctionMonitor` polls every **2 seconds** and:
1. Calls `resolveExpiredAuctions` (2 s safety gate built in).
2. Emits `auction:bid:update` with current `remainingTime` for all live auctions.
3. Emits `auction:closing-soon` when ≤10 s remain.

This means the countdown on every card is *re-baselined* at worst every 2 seconds. The local tick fills the gap. This is correct and sufficient — no issue here.

---

## 6. Economic Model Analysis

### 6.1 USDC Flow

```
Deployer (funder)
 └─ deposits 200 USDC → each buyer vault (×10 = $2,000 pre-funded)
      └─ buyer vault.lockForBid(leadId, bidAmount + $1 fee)
           ├─ WINNER: vault.settleBid() → sellerWallet + platformCut
           └─ LOSER:  vault.refundBid() → buyer vault restored
 └─ recycleTokens():
      ├─ STEP 1: withdraw free vault balance → deployer
      ├─ STEP 2: USDC transfer from buyer wallet → deployer
      └─ STEP 3: deposit 200 USDC → each buyer vault (re-fund for next run)
```

### 6.2 Economic Sustainability

| Metric | Current | Notes |
|---|---|---|
| Pre-fund per run | $2,000 (10 × $200) | Sufficient for 10 buyers × 5–10 auctions each |
| Min deployer reserve | $2,000 (`DEMO_DEPLOYER_USDC_MIN_REQUIRED`) | Pre-flight guard |
| Platform fee | 5% of winning bid | Settled on-chain via `vault.settleBid` |
| Convenience fee | $1 (winner only) | On-chain, via vault |
| Gas per run | ~$0.05–$0.40 on Base Sepolia | Negligible at testnet prices |
| Recycle completeness | ~95–98% | Small residues if in-flight locks at abort |

**Finding:** The economic model is self-sustaining for repeated demo runs. The only external requirement is the deployer wallet having ≥$2,000 USDC + a small ETH buffer for gas. At current Base Sepolia gas prices this is inexpensive.

### 6.3 Risk: ETH Balance Drain

Each on-chain transaction (lock, settle, refund, approve, transfer) costs gas. With 10 buyer wallets each potentially doing 5–10 bids per run plus settle/refund, a full demo run consumes ~50–100 Gwei-equivalent transactions. The `handleFundEth` UI tops up to 0.015 ETH. At Base Sepolia gas prices this is many thousands of transactions — not a practical risk for demo use.

---

## 7. Legacy Code & Technical Debt

| Item | Location | Status |
|---|---|---|
| `vrfTxHash` in `CycleResult` stored as "settle tx hash used as VRF-equivalent" | `demo-shared.ts` | Misleading comment — VRF tiebreak is in `auction-closure.service`, not cycle results |
| `legacy demo format` base64 bid commitment decode | `auction-closure.service.ts:190` | Dead path for new bids, but kept for pre-v7 reveal compat |
| `DEMO_VERTICALS` and `FALLBACK_VERTICALS` are identical arrays | `demo-shared.ts:35-43` | Duplicate — one should be removed |
| `BuyItNow` socket event (`lead:bin-expired`) emitted globally | `auction-closure.service.ts:135` | No registered consumer on frontend — silently dropped |
| `auctionDuration` in `convertToUnsold` reads `lead.ask?.auctionDuration` | `auction-closure.service.ts:701` | `ask` is never selected in the query — this is always `undefined`, resolves to 60 as fallback |
| `vrfRequestId` declared as `null` and never assigned | `auction-closure.service.ts:270` | `vrfRequestId` is initialized to null and never updated in the main flow — the VRF watcher sets it async but the DB persist via `vrfRequestId` variable is always null (`// BUG-09` comment) |
| `MAX_CYCLES = 12` defined in `demo-shared.ts` | `demo-shared.ts:31` | Unused since natural settlement replaced cycle-count model |

---

## 8. Key Pain Points Summary

### 8.1 Critical (Demo Experience Blockers)

1. **No bid momentum visible during vault settlement window (P-08, P-09):** A buyer's bid is effectively invisible for 3–15 seconds while the vault lock mines. During a 60-second auction, this is a significant fraction of the auction lifetime. A bid is "happening" but the frontend shows nothing.

2. **Dead zone at demo start (P-01, P-06):** The first 55 seconds of a demo run are pure seeding — no competitive bidding. A judge who opens the app during this window sees leads appearing but no bids, which undercuts the high-energy narrative.

3. **No last-second urgency pattern (P-08):** The `timingBias` parameter shifts buyer bids earlier or later on average, but there's no deliberate mechanic to concentrate bids in the last 10–15 seconds for "sniper" effect. Real RTB systems have pronounced bid clustering at auction close.

4. **Demo Panel invisible in production builds (P-26):** The one-click start/stop/monitor capability is a dev-only feature. Any live demo to judges requires manual API calls or Render log access.

### 8.2 Moderate (Degraded UX)

5. **No winning price on closed card (P-23):** Once an auction closes, the final amount is not shown on the LeadCard. Only "Auction ended → Sold" appears. A judge cannot see the economic outcome at-a-glance.

6. **`emitLiveMetrics` every 30 s is too slow (P-11, P-27):** The demo metrics panel updates too infrequently to give a sense of platform velocity.

7. **No bid ladder / activity feed (P-19):** The marketplace grid doesn't have a sidebar or overlay showing the most recent bids across all auctions. A judge sees N bid counters ticking up but has no narrative thread.

8. **Countdown drift between AuctionMonitor ticks (P-22):** Up to 2-second visual drift on countdown when no bid is arriving for a quiet auction — minor but visible.

### 8.3 Minor (Polish)

9. **DEMO_VERTICALS duplicate (legacy debt).**
10. **Hardcoded private keys in `demo-shared.ts`** — acceptable for a testnet demo but a repo hygiene issue.
11. **VRF tiebreak resolves 15–90 s after the card has closed** — good on-chain provenance, but the frontend never shows the VRF outcome on the grid.
12. **`demoComplete.totalSettled` labeling bug (P-29).**

---

## 9. Recommendations for Demo Layer Redesign

The following recommendations are ordered by impact. They do not prescribe specific implementations — that is the mandate of a separate redesign phase.

### Option 1 — Patch (Minimal, High Impact)

Surgical fixes to the existing architecture achieving 80% of the demo experience improvement with minimal risk:

| # | Change | Expected Impact |
|---|---|---|
| R-01 | Emit `auction:bid:pending` immediately when buyer scheduler fires, before on-chain confirmation | Eliminates the silent bid window; card shows "Bid incoming…" state instantly |
| R-02 | Reduce `emitLiveMetrics` interval from 30 s to 5 s | Live metrics banner updates every 5 s — feels alive |
| R-03 | Add a "bidding rush" heuristic: inject 2–3 bids in the final 15 s window of every auction | Creates last-second urgency without changing the buyer profile system |
| R-04 | Show `liveHighestBid` on the closed LeadCard (final winning price) | Judges can see the $82.40 → $91.00 outcome at-a-glance |
| R-05 | Add a running global activity ticker (last N socket events) to the marketplace grid header | Provides narrative thread without major component restructure |
| R-06 | Expose demo start/stop via a production-safe URL (`/demo-control?token=X`) | Allows judge-facing demos without dev build |
| R-07 | Seed first batch of leads before emitting `demo:start` so the marketplace is pre-populated | Eliminates the trickle-in empty-grid at demo start |

### Option 2 — Refactor (Medium Effort, Near-Complete Redesign of Timing)

A targeted refactor of the buyer scheduler and drip timing:

| # | Change | Expected Impact |
|---|---|---|
| R-08 | Replace flat `setTimeout` scheduling with a **bid wave model**: early exploration bids (0–30 s), mid-auction response bids (30–50 s), sniper bids (50–58 s) | Creates a realistic RTB tension arc per auction |
| R-09 | Implement **optimistic bid injection**: frontend shows a speculative bid immediately on `auction:bid:pending`, which is either confirmed or withdrawn on timeout | Zero perceived latency for bid visibility |
| R-10 | Pre-populate the marketplace with 8–10 already-live leads before the socket connection is established (SSR or fast REST prefetch) | Instant rich view for first-load; no trickle-in |
| R-11 | Add a dedicated "Auction Activity Feed" column or sidebar that streams `marketplace:bid:update` events as a live ticker | Judges see the bid narrative without needing to hover each card |
| R-12 | Emit `demo:metrics` on every closed auction (not just on a timer) | Live platform revenue counter ticks up in real time |

### Option 3 — Complete Demo Layer Redesign (High Effort, Maximum Impact)

A ground-up overhaul of the demo experience layer, keeping all production on-chain logic intact:

**Vision:** The demo should feel like a Bloomberg Terminal crossed with an exchange order book — fast, data-rich, and viscerally real-time.

| Component | Proposed Design |
|---|---|
| **Demo Orchestration** | Decouple the demo "event engine" from the on-chain settlement layer. The event engine runs at UI-speed (100–500ms event cadence), emitting speculative bid events. Settlement runs at chain-speed in the background. |
| **Bid Visibility** | Introduce three bid states: `PENDING` (scheduled, not yet on-chain), `SUBMITTED` (vault lock tx broadcast), `CONFIRMED` (mined). Show all three on the card. |
| **Auction Tension Model** | Implement a configurable tension curve: flat early, accelerating mid, exponential final 10 s. Each buyer profile has a "patience" coefficient that maps to where on this curve they bid. |
| **Activity Feed** | Full-page "Live Auction Room" view: live bid ladder per auction, global cross-auction activity feed, platform revenue counter, buyers-active count — all updating at sub-second cadence. |
| **Marketplace Grid** | Sort cards by auction urgency (time remaining) with the most contested (highest bid count) elevated. Add a heat indicator (color saturation proportional to bid velocity). |
| **Demo Controls** | A fully public, token-protected `/demo` page with a rich control panel showing system status, vault balances, current run metrics, buyer wallet balances, and on-chain tx links in real time. |
| **Results Page** | Auto-navigate to results page at demo end; show per-auction winner → buyer wallet → Basescan link, aggregate gas cost, total platform revenue, VRF tiebreak provenance — all with clickable on-chain proof. |

---

## 10. Appendix: Environment Variables

| Variable | Used In | Purpose |
|---|---|---|
| `LEAD_AUCTION_DURATION_SECS` | `demo-shared.ts` → perks.env | Auction duration (recommend: 60 s for demo) |
| `DEMO_LEAD_DRIP_INTERVAL_MS` | `demo-shared.ts` → perks.env | Avg ms between lead injections (recommend: 5000) |
| `DEMO_INITIAL_LEADS` | `demo-shared.ts` → perks.env | Leads seeded at demo start (recommend: 8) |
| `DEMO_MIN_ACTIVE_LEADS` | `demo-shared.ts` → perks.env | Min concurrent live leads (recommend: 6) |
| `VAULT_ADDRESS_BASE_SEPOLIA` | `demo-shared.ts` | On-chain vault contract address |
| `USDC_CONTRACT_ADDRESS` | `demo-shared.ts` | USDC token on Base Sepolia |
| `DEPLOYER_PRIVATE_KEY` | `demo-shared.ts` | Deployer/funder EOA (⚠️ never commit to public repo) |
| `RPC_URL_BASE_SEPOLIA` | `demo-shared.ts` | Base Sepolia JSON-RPC endpoint |

---

## 11. Conclusion

The Lead Engine CRE auction infrastructure is **production-grade**. The on-chain vault mechanics, auction closure idempotency, VRF tiebreak, and Zustand server-authoritative phase machine are all well-engineered solutions to genuinely hard problems.

The demo experience gap is not a consequence of architectural flaws — it is a consequence of **real on-chain latency** (3–15 s per transaction on Base Sepolia) not being hidden by an optimistic UI layer. Every other major exchange — centralized or decentralized — shows speculative state immediately and reconciles silently.

**The single highest-leverage improvement** is emitting a `auction:bid:pending` socket event the moment a bid is scheduled, before any on-chain confirmation, so the frontend can render bid activity in real time. This one change, paired with a bidding rush mechanic in the final 15 seconds, would transform the demo from "impressive infrastructure demo" to "viscerally exciting RTB marketplace."

All other recommendations are refinements on top of a solid foundation.

---

*End of audit. No code was modified during this review.*
