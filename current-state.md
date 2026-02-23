# Current State Audit — Lead Engine CRE (dc727aa)

> Audit initialized – I have fully absorbed all provided context and materials.

---

## 1. Executive Summary

| Dimension | Score |
|---|---|
| **Hackathon submission readiness** | **8.2 / 10** |
| **Production MVP readiness** | **6.1 / 10** |

### Strongest Aspects
- **Chainlink stack breadth is genuinely impressive.** CRE (on-chain quality scoring), ACE (policy compliance), Chainlink Functions (CHTT TEE fraud scoring), VRF (tie-breaking), Automation (AuctionMonitor every 2 s), and Data Feeds (floor pricing) are all plumbed end-to-end, not merely stubbed.
- **v7 "Golden Standard" architecture is conceptually sound.** Pure server-authoritative phase machine (`auctionPhase ∈ {live, closing-soon, closed}`), `storeSlice`-as-single-source-of-truth in Zustand, and the global `useSocketBridge()` mounted once in `App.tsx` are correct patterns.
- **Demo orchestrator is production-grade.** Pre-run cleanup, nonce serialization, gas escalation, BuyItNow fallback, PoR batch check, and file-based result persistence form a robust self-healing loop.
- **LeadCard UI rendering logic is clean.** The fade/grey lifecycle (`fadeOutAt`, CSS opacity transition, `CLOSE_GRACE_MS`) is clearly coded and correct at the component level.
- **Codebase is well-factored.** Clean module boundaries between `demo-shared`, `demo-lead-drip`, `demo-buyer-scheduler`, `demo-vault-cycle`, and `demo-orchestrator`. No circular dependencies at runtime.

### Single Biggest Risk Right Now
Four concrete bugs in the socket emission pipeline cause the two reported UX issues ("hardly any bids" and "cards linger grey") and are entirely fixable before submission. They are documented exhaustively in §2 and §6. Everything else is polish or medium-term debt.

---

## 2. Real-Time Synchronization Deep Dive

### 2.1 State-Flow Diagram

```
Demo Orchestrator (backend)
  ── per bid lock: io.emit('marketplace:bid:update')    ──→  socketBridge.on → store.updateBid
  ── per bid lock: io.emit('auction:updated')           ──→  socketBridge.on → store.updateBid (clock-correct)
  ── (10-s window):io.emit('auction:closing-soon')      ──→  socketBridge.on → store.setClosingSoon
  ── post-settle:  io.emit('auction:closed')            ──→  socketBridge.on → store.closeLead + forceRefreshLead(+1 s)

auction-closure.service.ts (AuctionMonitor fires every 2 s via Automation upkeep)
  ── resolveExpiredAuctions() → resolveAuction()
  ──   io.emit('lead:status-changed')                   ──→  socketBridge.on → store.closeLead
  ──   io.emit('auction:closed')  ← "FIXED" broadcast   ──→  socketBridge.on → store.closeLead

injectOneLead (lead-drip)
  ── io.emit('marketplace:lead:new')                    ──→  socketBridge.on → store.addLead
  ── io.emit('auction:updated')   ← initial baseline    ──→  store.updateBid (liveRemainingMs seed)
  ── io.emit('leads:updated')                           ──→  socketBridge → fetchAndBulkLoad()

scheduleBuyerBids (buyer-scheduler)
  ── per successful lockForBid: io.emit('marketplace:bid:update') ──→ store.updateBid
  (no auction:updated emitted here ← GAP)

Zustand store.updateBid
  ── updates liveBidCount, liveHighestBid, liveRemainingMs, auctionPhase
  ── drives LeadCard via React subscription (s.leads.get(lead.id))

LeadCard.tsx
  ── storeSlice → auctionPhase → isClosed / button state
  ── local 1-s countdown interval re-baselines from storeRemainingMs
  ── fadeOutAt → isFadingOut (CSS opacity 0 over 2500 ms)
  ── CLOSE_GRACE_MS = 15 000 ms → removeLead
```

### 2.2 Component-Level Analysis

#### `socketBridge.ts`
- **Mount:** correctly inside a `useEffect([], [])` in `App.tsx` via `useSocketBridge()`. Global — no per-card listener duplication.
- **Heartbeat (5 s):** pings server, re-fetches on disconnect, calls `forceRefreshLead` for all known leads. Correct.
- **`auction:updated` handler:** calls `store.updateBid()` which receives `remainingTime` + `serverTs`. ✅ Structurally correct.
- **`auction:closed` → `store.closeLead()` + `forceRefreshLead(+1 s)`:** belt-and-suspenders pattern is good.
- **`leads:updated` → `fetchAndBulkLoad()`:** correct. Used by drip and watchdog.

#### `auctionStore.ts`
- **Phase machine is server-authoritative (v7):** transitions only happen from socket events, never from `Date.now()` comparisons. ✅
- **`updateBid` drives phase from `liveRemainingMs`** (lines 252–258): if `remainingTime ≤ 0 → 'closed'`, if `≤ 10 000 → 'closing-soon'`. Correct in principle, but **see BUG-1 below** — `serverTs` is received as ISO string not epoch, so `networkDelayMs` always computes as `NaN`.
- **`closeLead`:** sets `fadeOutAt = now + 100 ms`. `CLOSE_GRACE_MS = 15 000 ms`. The 8-s overlay clears correctly.
- **`bulkLoad` merge:** preserves existing socket-driven state (phase, liveBidCount, liveHighestBid). `liveBidCount = max(socket, api)` — monotonic rule is correct.
- **`addLead`:** always starts at `liveBidCount: null` (not seeded from `_count.bids` unlike `bulkLoad`/`apiLeadToSlice`). **See BUG-3.**

#### `LeadCard.tsx`
- **Phase-reading:** `storeSlice?.auctionPhase ?? 'live'` — the `'live'` fallback is safe because `forceRefreshLead` runs 1 s after any `auction:closed` event.
- **`effectiveBidCount`:** `liveBidCount ?? (lead._count?.bids || lead.auctionRoom?.bidCount || 0)` — falls back correctly to API data if socket stream hasn't arrived.
- **Sealed-bid banner** `isLive && isSealed`: only shows while live. Correct. But the orchestrator never emits `isSealed: true` (it doesn't track the 5-second sealed window). This is a cosmetic gap.
- **Fade-out UX:** after `closeLead`, card goes to `opacity: 0.6`, then on `fadeOutAt` fires `isFadingOut = true` → `opacity: 0` over 2500 ms → DOM removed at 15 s. This is polished.
- **Comment mismatch (line 361–365):** `// IRONCLAD v4 gate: isLive is the ONLY key...` says `isLive = !isClosed && !isSealed && effectiveStatus === 'IN_AUCTION'` but the actual code is simply `isLive = !isClosed`. Minor doc debt.

#### `auction-closure.service.ts`
- **`resolveExpiredAuctions` 58-s safety gate** (line 53): prevents closure until `ageMs ≥ 58 000 ms`. Combined with the AuctionMonitor's 2-s poll, this means a lead expires at T+60 s but is only resolved on the next 2-s tick after T+118 s in the worst case. **See BUG-4.**
- **`auction:closed` emitted from `resolveAuction`** (line 606) and `convertToUnsold` (line 714): `serverTs` is `new Date().toISOString()` — **ISO string, not epoch ms**. Same BUG-1 as orchestrator.
- **`resolveStuckAuctions` emits `lead:status-change`** (line 96) — note the typo: `lead:status-change` vs. the correct event name `lead:status-changed`. The socketBridge listens for `lead:status-changed`, so stuck-auction cleanup events are silently dropped by the frontend.

#### Backend Event Emission Summary Table

| Location | Event | `serverTs` type | `bidCount` type | Issues |
|---|---|---|---|---|
| `demo-orchestrator.ts:736` | `auction:updated` | `new Date().toISOString()` *(ISO string)* | absolute `b+1` | **BUG-1 + BUG-2** |
| `demo-orchestrator.ts:811` | `auction:closed` | `Date.now()` epoch ✅ | — | OK |
| `demo-buyer-scheduler.ts:216` | `marketplace:bid:update` | — | **always `1`** | **BUG-2** |
| `auction-closure.service.ts:619` | `auction:closed` (SOLD) | `new Date().toISOString()` *(ISO string)* | — | **BUG-1** |
| `auction-closure.service.ts:719` | `auction:closed` (UNSOLD) | `new Date().toISOString()` *(ISO string)* | — | **BUG-1** |
| `injectOneLead:230` | `auction:updated` | `Date.now()` epoch ✅ | `0` | OK |

---

### 2.3 Root-Cause Analysis of the Two Reported Issues

#### Issue A: "Hardly any bids are coming through"

**Root cause — cascade of three independent suppressors:**

1. **BUG-1 — `serverTs` type mismatch (HIGH):** In `demo-orchestrator.ts` at line 736, `auction:updated` is emitted with `serverTs: new Date().toISOString()`. The store's `updateBid` expects `serverTs` to be a *number* (epoch ms) for drift correction: `networkDelayMs = serverTs != null ? Math.max(0, Date.now() - serverTs) : 0`. When `serverTs` is an ISO string, `Date.now() - "2026-02-22T..."` evaluates to `NaN`, so `networkDelayMs = NaN` and `liveRemainingMs = Math.max(0, remainingTime - NaN) = NaN`. With `liveRemainingMs = NaN`, the phase check falls through to `'live'` (since `NaN <= 0` and `NaN <= 10_000` are both *false* in JS), which is actually the safer fallback, but the timer in LeadCard re-baselines to `NaN` causing the display to freeze. More critically — when `remainingTime` is near-zero but `serverTs` is a string, the phase doesn't transition to `'closed'` as expected, so **the card stays live past auction end**.

2. **BUG-2 — `bidCount: 1` absolute (HIGH):** `demo-buyer-scheduler.ts` at line 219 emits `bidCount: 1` hardcoded as an absolute value for every buyer's successful bid. The store's `updateBid` uses `Math.max(bidCount, lead.liveBidCount ?? 0)` (monotonic), so if Buyer #6 bids at T+30 s, `liveBidCount` goes to 1. When Buyer #7 bids at T+40 s, it also emits `bidCount: 1`, and `Math.max(1, 1) = 1` — the counter never increments past 1 for drip-path bids. The orchestrator's cycle-path bids are correctly incremental (`b+1`) but the majority of bids visible during a demo run come from the `scheduleBuyerBids` drip path.

3. **BUG-3 — Cascading buyer-skip probability (MEDIUM):** At demo runtime, for each new lead:
   - `Math.random() < 0.15` → 15% chance the lead gets **zero bids** immediately (line 121 of `demo-buyer-scheduler.ts`).
   - For each of the 10 buyer profiles that passes vertical preference AND `minScore` AND reserve threshold: `Math.random() < 0.10` → 10% independent skip (line 153).
   - After first eligible bid: `Math.random() < 0.10` → 10% chance of early termination (line 242).
   - Combined expected bids per qualifying lead with 8 verticals and 10 profiles: roughly **3–5 bids**. But tight `minScore` values (LegalEagle at 8000, FinancePilot at 7500) combined with CRE quality scores that often land in the 3000–6000 range mean many buyers are silently filtered. Logs show `🙅 Buyer... skipping — quality X < threshold Y` spamming the DevLog, which confirms this is active.

#### Issue B: "Lead cards remain greyed out for too long after auctions end"

**Root cause — two independent delays:**

1. **BUG-4 — 58-second safety gate on top of 60-second auction lifecycle (HIGH):** `resolveExpiredAuctions` in `auction-closure.service.ts` (line 53) requires `ageMs >= 58_000` before closing a lead. The auction `auctionEndAt = startTime + 60 s`. The AuctionMonitor fires every 2 s. In the worst case, a lead's `auctionEndAt` is T+60 s. The first monitor tick after expiry is at T+62 s. At that point `ageMs = 2000 ms < 58 000`— the lead is skipped. Next tick at T+64 s: `ageMs = 4000`, still skipped. This continues until T+118 s — **58 more seconds of waiting after the lead is already expired**. The frontend card sits grey and unresponsive for the entire 58-s window because the `auction:closed` event the orchestrator emits (from `demo-orchestrator.ts:803`) fires at T+~90 s (after all on-chain txs including refunds), while `resolveExpiredAuctions` is a secondary path that fires much later for leads that never went through the orchestrator cycle. The UX gap: demo-mode leads hit `auction:closed` from the orchestrator reasonably promptly, but pre-seeded leads (injected via `injectOneLead` from the drip) have their closure driven by `resolveExpiredAuctions`, meaning they sit grey for up to 2 minutes total.

2. **BUG-1 contributes here too:** Because `serverTs` is an ISO string in the `auction:updated` events from `auction-closure.service.ts:619`, the frontend's clock-drift correction is broken for those leads — the countdown freezes rather than ticking to 0, so the in-progress blue progress bar stops mid-way. This looks like the card is "stuck" even before it greys.

---

### 2.4 Sync Failure Hypotheses (Ranked by Likelihood)

| # | Hypothesis | Evidence | Likelihood |
|---|---|---|---|
| **H1** | `serverTs` ISO-string type mismatch breaks clock-drift correction, freezes countdown timers, and prevents prompt `'closed'` phase transitions | `demo-orchestrator.ts:736`, `auction-closure.service.ts:619,719`; `auctionStore.ts:249` expects `number` | **CONFIRMED** |
| **H2** | `bidCount: 1` hardcoded in `scheduleBuyerBids` means the bid counter stays at 1 regardless of how many autonomous buyers bid; `Math.max` monotonic guard prevents decrement but also prevents increment | `demo-buyer-scheduler.ts:219`; `auctionStore.ts:268` | **CONFIRMED** |
| **H3** | `resolveExpiredAuctions` 58-s safety gate adds up to 58 s of additional grey-card latency for drip leads | `auction-closure.service.ts:53` | **CONFIRMED** |
| **H4** | Per-buyer cascade of vertical + minScore + 15%-cold + 10%-skip produces far fewer bids than expected for certain verticals; `legal` and `financial_services` often get 0 buyer-scheduler bids | `demo-buyer-scheduler.ts:121,136,144,153,242` | **CONFIRMED** |
| **H5** | `addLead` in `auctionStore.ts:183` initializes `liveBidCount: null`, so cards from `marketplace:lead:new` show `0 bids` until the first `marketplace:bid:update` arrives; delayed bids make the initial state persist | `auctionStore.ts:183` vs `apiLeadToSlice:131` | **HIGH** |
| **H6** | `resolveStuckAuctions` emits `lead:status-change` (typo, missing `-d`), so its events are never consumed by `socketBridge` (which listens for `lead:status-changed`); stuck leads quietly linger | `auction-closure.service.ts:96`; `socket.ts:47, socketBridge.ts:81` | **CONFIRMED** |

### 2.5 Golden Standard v4 — Does It Hold in Practice?

**Verdict: Architecture holds; implementation has 4 point bugs that undermine the experience.**

The v7 design (server-authoritative phases, no local-clock guards, single global socketBridge) is correct and would deliver the intended "magical" UX if the four bugs above were fixed. The Zustand store's merge logic, the monotonic bid counter, and the fade-out grace period all function as designed. The failure points are entirely in:
- How `serverTs` is serialized at emission time (ISO string vs. epoch number)
- How `bidCount` is emitted from the scheduler (absolute vs. cumulative)
- The 58-s grace gate in `resolveExpiredAuctions`
- The typo `lead:status-change` vs. `lead:status-changed`

---

## 3. Auction Lifecycle & State Machine Audit

### 3.1 End-to-End Flow Verification

```
SEED/DRIP
  injectOneLead()
    → prisma.lead.create(status='IN_AUCTION', auctionEndAt=+60s)
    → io.emit('marketplace:lead:new')        ← store.addLead → leads shown ✅
    → io.emit('auction:updated', {remainingTime, serverTs(number), bidCount:0}) ✅
    → io.emit('leads:updated')               ← fetchAndBulkLoad() ✅
    → scheduleBuyerBids()                    ← async, 10–55 s staggered

BIDDING (orchestrator path)
  for each buyer:
    vault.lockForBid(buyer, amount)           ← on-chain ✅
    → io.emit('marketplace:bid:update', {bidCount:b+1, highestBid}) ✅
    → io.emit('auction:updated', {serverTs:ISO_STRING ← BUG-1})

BIDDING (scheduler/drip path)
  scheduleBuyerBids inner timer:
    vault.lockForBid(buyer, amount)           ← on-chain ✅
    → io.emit('marketplace:bid:update', {bidCount:1 ← BUG-2})
    (no auction:updated emitted here ← GAP)

CLOSURE (orchestrator path — fast)
  vault.settleBid(winnerLockId, seller)       ← on-chain ✅
  vault.refundBid(loserLockId, ...)           ← on-chain ✅
  → io.emit('auction:closed', {serverTs:Date.now()}) ← epoch ✅
  → store.closeLead → fadeOutAt = now+100ms → remove at 15s ✅

CLOSURE (AuctionMonitor path — for drip leads)
  resolveExpiredAuctions() every 2 s via Automation
    → safety gate: ageMs < 58_000 → wait 58 s extra ← BUG-4
    → resolveAuction()
      → prisma $transaction (SOLD/UNSOLD)
      → io.emit('auction:closed', {serverTs:ISO_STRING ← BUG-1})
      → store.closeLead ✅ (but delayed by up to 58 s)

PoR CHECK
  vault.verifyReserves()                      ← on-chain ✅
  → vault.lastPorSolvent()                    ← on-chain ✅
  → emit PoR result to DevLog

NFT MINT (post-sale)
  nftService.mintLeadNFT(leadId)              ← on-chain ✅ (BuyItNow fallback path)
  creService.requestOnChainQualityScore(...)  ← Chainlink CRE request ✅

PII REVEAL
  Not triggered in demo flow — buyer PII decryption is manual/post-purchase.
  This is a gap but acceptable for demo.
```

### 3.2 Demo-Mode vs Real-Mode Differences

| Concern | Demo Mode | Real Mode | Risk |
|---|---|---|---|
| Closure trigger | Orchestrator emits `auction:closed` directly after vault txs | `resolveExpiredAuctions` via Automation | Demo is slightly faster; real mode has 58-s gate |
| Bid sequencing | Sequential (`await sendTx` + `sleep(500)`) | Parallel user WebSocket bids | Demo bids always succeed; real mode has race conditions in bidding route |
| NFT mint | On `auction:closed` (BuyItNow fallback) | Deferred to buyer (escrow-required) | Inconsistent PII release timing |
| Reconnection | socketBridge heartbeat re-fetches all leads | Same | Correct in both modes |
| Multiple tabs | `leads` Map keyed by ID prevents duplication | Same | ✅ Correct |
| Stale state on refresh | `fetchAndBulkLoad` restores store from API | Same | ✅ Correct |

### 3.3 Edge Cases Identified

- **Rapid double-close:** `closeLead` checks `lead.isClosed` before proceeding. SOLD upgrade of UNSOLD is allowed. UNSOLD→UNSOLD is no-op. ✅
- **Reconnection during live auction:** heartbeat calls `forceRefreshLead` for all known IDs. If lead is still `IN_AUCTION`, `bulkLoad` fires preserving socket state. ✅
- **Lead injected while disconnected:** `leads:updated` triggers `fetchAndBulkLoad` which re-fetches `status=IN_AUCTION` leads. ✅
- **`addLead` for a lead already in store (not closed):** returns `state` unchanged (no overwrite). This means if a lead is re-broadcast via `marketplace:lead:new` while live, the store silently ignores it — correct. ✅
- **`bulkLoad` for a closed lead:** skips it (`if (existing.isClosed) continue`). This prevents a `leads:updated` re-fetch from resurrecting a server-closed card. ✅

---

## 4. Broader Technical Debt & Gaps Register

### Critical

| ID | Description | File(s) |
|---|---|---|
| **TD-C1** | `serverTs` emitted as ISO string instead of epoch ms. Breaks clock-drift correction and can prevent `'closed'` phase transition | `demo-orchestrator.ts:736`, `auction-closure.service.ts:619,719` |
| **TD-C2** | `bidCount: 1` hardcoded in `scheduleBuyerBids` — monotonic guard prevents it from ever exceeding 1 | `demo-buyer-scheduler.ts:219` |
| **TD-C3** | `auction-closure.service.ts:96` emits `lead:status-change` (missing final `-d`), dropped silently by socketBridge | `auction-closure.service.ts:96` |
| **TD-C4** | 58-s safety gate in `resolveExpiredAuctions` makes pre-seeded leads linger grey for up to 60+58 = 118 s total after injection | `auction-closure.service.ts:53` |

### High

| ID | Description | File(s) |
|---|---|---|
| **TD-H1** | `addLead` initializes `liveBidCount: null` (not from `_count.bids`) — cards briefly show `0 bids` even when real bids exist | `auctionStore.ts:183` |
| **TD-H2** | `scheduleBuyerBids` does not emit `auction:updated` after a successful bid — no remaining-time rebaseline from drip-path bids | `demo-buyer-scheduler.ts:213-228` |
| **TD-H3** | `resolveExpiredAuctions:43-44` selects by `auctionEndAt: { lte: now }` without the 58-s gate filtering by query; the gate is checked in JS *after* fetch, meaning the DB query returns stale leads on every 2-s tick unnecessarily | `auction-closure.service.ts:39-56` |
| **TD-H4** | LegalEagle (`minScore:8000`) and FinancePilot (`minScore:7500`) are silent for any lead scoring below 7500 (common with default CRE scoring). This disproportionately suppresses bids on `legal` and `financial_services` verticals | `demo-buyer-scheduler.ts:48-49` |
| **TD-H5** | Private keys (`BUYER_KEYS`, `DEMO_SELLER_KEY`) hardcoded in plaintext in source — acceptable for testnet demo but a critical security risk if committed and the repo becomes public | `demo-orchestrator.ts:311-321`, `demo-shared.ts:76-87` |
| **TD-H6** | `resolveStuckAuctions` targets leads with `auctionEndAt: { lte: 5-minutes-ago }` but these may also be caught by `resolveExpiredAuctions` — double-resolution possible (both idempotent but wasteful) | `auction-closure.service.ts:77-101` |

### Medium

| ID | Description | File(s) |
|---|---|---|
| **TD-M1** | `auctionStore` comment at line 23 says "45-second grace period" but `CLOSE_GRACE_MS = 15_000` (15 s). Misleading for future devs | `auctionStore.ts:23,82` |
| **TD-M2** | `LeadCard.tsx` comment at line 361 says `isLive = !isClosed && !isSealed && effectiveStatus === 'IN_AUCTION'` but actual code is `isLive = !isClosed` | `LeadCard.tsx:361-365` |
| **TD-M3** | `scheduleBuyerBids` 15% cold-auction skip (`Math.random() < 0.15`) and 10% per-buyer independent skip compound to produce unpredictable demo variability. No minimum-bid floor ensures at least 1 bid per lead | `demo-buyer-scheduler.ts:121,153` |
| **TD-M4** | `isSealed` flag is set via `auction:updated` event, but the orchestrator never explicitly enters a "sealed window" — the 5-s sealed-bid section exists in the schema but is never triggered in demo mode | `socket.ts:77`, `demo-orchestrator.ts` |
| **TD-M5** | `forceRefreshLead` in `updateBid` (line 287) fires `setTimeout(500)` if `phase === 'closed'` — this can race with `closeLead` if `auction:closed` also arrives shortly after, producing a redundant double-refresh | `auctionStore.ts:285-288` |
| **TD-M6** | `fetchAndBulkLoad` in socketBridge fetches `status=IN_AUCTION&limit=50` — if more than 50 active leads exist, older leads won't appear on reconnect | `socketBridge.ts:25` |
| **TD-M7** | `demo-panel.routes.ts` (91 KB) is a monolith — should be split into route, controller, and service layers | `demo-panel.routes.ts` |
| **TD-M8** | No E2E test for the demo flow. Jest tests cover individual services; the full `runFullDemo → bid → settle → auction:closed → store.closeLead` pipeline is untested as an integration | `tests/` |

### Low

| ID | Description | File(s) |
|---|---|---|
| **TD-L1** | `consolidate-usdc.js` in project root is a standalone node script with hardcoded wallet keys — dangerous if accidentally executed against mainnet | `consolidate-usdc.js` |
| **TD-L2** | `qualityScore` in `marketplace:lead:new` emits `Math.floor(qs / 100)` (scaled to 0-100) but the store stores it in raw units (0-10000). Display in LeadCard correctly divides by 100, but the emitted value is already divided — double-division could display 0-1 instead of 0-100 | `demo-orchestrator.ts:599` (see also `injectOneLead:221`) |
| **TD-L3** | `CLOSE_GRACE_MS` comment on `LeadCard.tsx:77` says "removeLead setTimeout eliminates it from the DOM after CLOSE_GRACE_MS" — this is driven by `auctionStore`, not directly from LeadCard | `LeadCard.tsx:73-76` |
| **TD-L4** | `sentry.ts` exists but Sentry DSN may not be configured for Render production | `sentry.ts` |
| **TD-L5** | `demo-results.json` is written to disk via `fs.writeFileSync` — on Render's ephemeral filesystem this file is lost on every deploy | `demo-orchestrator.ts:98` |

---

## 5. Judge Experience Simulation

### Step-by-Step First Impressions

```
00:00 — Judge lands on marketplace. 7 seeded leads visible.
         ✅ CRE quality scores, ACE badges, TEE badges, Data Feeds floor prices → impressive Chainlink signal density.
         ⚠️  Countdown timers may be frozen (BUG-1). Progress bars stuck.
         ⚠️  Bid counts all show 0 or 1 (BUG-2).

00:05 — Judge clicks "Run Demo" in Demo Control Panel.
         ✅ Dev Log streams immediately. Banner shows "Cycle 1/5 — MORTGAGE | 3 bids incoming".
         ✅ Deployer vault check, ETH pre-flight — professional confidence-building.

00:30 — Leads appearing in marketplace.
         ✅ Cards pop in with gradient border, "Place Bid" button active.
         ⚠️  Bid counts may still show 0 (scheduler bids have not fired yet at 10–55 s delay).

01:00 — Cycle 1 on-chain transactions running.
         ✅ DevLog shows tx hashes with Basescan links — very judge-friendly.
         ✅ "🔒 Bidder 1/3 — $42 USDC from 0xa75d…" messages confirm real wallets.
         ⚠️  Cards for scheduler-drip leads still show stale bid counts.

02:00 — Cycle 2 starting.
         ✅ "auction:closed" emitted → cards grey out, "Auction ended → Sold" tag appears.
         ⚠️  Seeded leads that expired via AuctionMonitor path linger grey for 58+ extra seconds.
         ⚠️  "Sealed – resolving winner…" banner on some cards — confusing if judge doesn't expect it.

03:00–05:00 — Cycles 3–5.
         ✅ VRF tiebreaker occasionally fires — "⚡ Tie detected — VRF picks winner" is dramatic.
         ✅ PoR check at end: "🏦 PoR Result: ✅ SOLVENT" — strong closing statement.

05:30 — Results page navigates automatically.
         ✅ 5 cycles, $200 settled, platform revenue shown, per-cycle table with Basescan links.
         ✅ "PoR SOLVENT" badge — correct and trust-building.
```

**Overall judge impression:** The DevLog and Results page are excellent. The main friction points visible to a judge are the frozen/inconsistent countdown timers and the bid counts that barely change. A judge looking at the marketplace during the demo will see several cards stuck at "0 bids" or "1 bid" with frozen countdowns — that undermines the "live, active marketplace" narrative.

---

## 6. Prioritized Action Plan

### Fix 1 — `serverTs` type: ISO string → epoch ms `(CRITICAL | 30 min)`

**Problem:** Three emission sites send `serverTs` as `new Date().toISOString()` but `auctionStore.updateBid` expects a number (`Date.now()`). Arithmetic `Date.now() - "2026-..."` = `NaN`. Breaks drift correction, freezes countdown timers, prevents `'closed'` phase transition via `remainingTime`.

**Fix:** Change `new Date().toISOString()` → `Date.now()` at all three sites.

```typescript
// demo-orchestrator.ts:736
io.emit('auction:updated', {
    leadId: demoLeadId,
    remainingTime,
-   serverTs: new Date().toISOString(),   // ← BUG-1
+   serverTs: Date.now(),                  // ← epoch ms ✅
    bidCount: b + 1,
    highestBid: Math.max(...buyerBids.slice(0, b + 1).map(x => x.amount)),
});

// auction-closure.service.ts:619
io.emit('auction:closed', {
    leadId,
    status: 'SOLD',
    ...
-   serverTs: new Date().toISOString(),   // ← BUG-1
+   serverTs: Date.now(),
});

// auction-closure.service.ts:719
io.emit('auction:closed', {
    leadId,
    status: 'UNSOLD',
    ...
-   serverTs: new Date().toISOString(),   // ← BUG-1
+   serverTs: Date.now(),
});
```

**Files:** `backend/src/services/demo/demo-orchestrator.ts:736`, `backend/src/services/auction-closure.service.ts:619,719`
**Effort:** Low | **Expected outcome:** Countdown timers re-baseline correctly after each bid; `'closed'` phase triggers promptly when `remainingTime ≤ 0`.

---

### Fix 2 — `bidCount` in scheduler: hardcoded `1` → cumulative DB count `(CRITICAL | 45 min)`

**Problem:** `scheduleBuyerBids` in `demo-buyer-scheduler.ts:219` emits `bidCount: 1` for every autonomous bid. The store's monotonic max guard means it never increments past 1 from the drip path.

**Fix:** Query actual bid count from DB immediately after the lock succeeds.

```typescript
// demo-buyer-scheduler.ts — inside the timer callback, after tx.wait():

const receipt = await tx.wait();

+ // Get real bid count from DB so frontend counter increments correctly
+ const actualBidCount = await prisma.bid.count({
+     where: { leadId, status: { not: 'EXPIRED' } }
+ }).catch(() => 1);

io.emit('marketplace:bid:update', {
    leadId,
-   bidCount: 1,
+   bidCount: actualBidCount,
    highestBid: bidAmount,
    timestamp: new Date().toISOString(),
    buyerName: profile.name,
});

+ // Also emit auction:updated so remaining-time re-baselines on each bid
+ const leadRecord = await prisma.lead.findUnique({
+     where: { id: leadId }, select: { auctionEndAt: true }
+ }).catch(() => null);
+ if (leadRecord?.auctionEndAt) {
+     const remainingTime = Math.max(0, new Date(leadRecord.auctionEndAt).getTime() - Date.now());
+     io.emit('auction:updated', {
+         leadId, remainingTime, serverTs: Date.now(),
+         bidCount: actualBidCount, highestBid: bidAmount, isSealed: false,
+     });
+ }
```

**Files:** `backend/src/services/demo/demo-buyer-scheduler.ts:216-222`
**Effort:** Low-Medium | **Expected outcome:** Bid counter increments naturally as each autonomous buyer commits; countdown timers stay synchronized.

---

### Fix 3 — Typo: `lead:status-change` → `lead:status-changed` `(CRITICAL | 5 min)`

**Problem:** `auction-closure.service.ts:96` emits `lead:status-change` (missing final `-d`). The socketBridge listens for `lead:status-changed`. Stuck auctions cleaned by `resolveStuckAuctions` are invisible to the frontend.

```typescript
// auction-closure.service.ts:96
- io.emit('lead:status-change', { leadId: lead.id, newStatus: 'UNSOLD' });
+ io.emit('lead:status-changed', { leadId: lead.id, oldStatus: 'IN_AUCTION', newStatus: 'UNSOLD' });
```

**Files:** `backend/src/services/auction-closure.service.ts:96`
**Effort:** Trivial | **Expected outcome:** Stuck leads now close promptly on the frontend.

---

### Fix 4 — Reduce 58-s safety gate to 5-s `(HIGH | 10 min)`

**Problem:** `resolveExpiredAuctions:53` requires `ageMs >= 58_000` before closing an expired lead. This was added to prevent early closure but the AuctionMonitor already polls every 2 s, so a 5-s buffer is sufficient for clock drift.

```typescript
// auction-closure.service.ts:53
- if (ageMs < 58_000) {
+ if (ageMs < 5_000) {   // 5 s is enough for clock drift; was 58 s (BUG-4)
    continue;
  }
```

**Files:** `backend/src/services/auction-closure.service.ts:53`
**Effort:** Trivial | **Expected outcome:** Grey cards from drip leads disappear within ~7 s of `auctionEndAt` instead of up to 120 s.

---

### Fix 5 — Seed `liveBidCount` in `addLead` from `_count.bids` `(HIGH | 20 min)`

**Problem:** `auctionStore.addLead` initializes `liveBidCount: null` (line 183). Cards added via `marketplace:lead:new` show "0 bids" until a socket bid arrives. `apiLeadToSlice` correctly seeds from `_count.bids` but `addLead` doesn't.

```typescript
// auctionStore.ts:183 — addLead()
const slice: LeadSlice = {
    ...lead,
    auctionPhase: phase,
    isClosed: !isActuallyLive,
    isSealed: false,
-   liveBidCount: null,
+   liveBidCount: lead._count?.bids ?? null,  // seed from API data immediately
    liveHighestBid: null,
    ...
};
```

**Files:** `frontend/src/store/auctionStore.ts:183`
**Effort:** Trivial | **Expected outcome:** Newly injected leads show their real bid count immediately without waiting for the first socket event.

---

### Fix 6 — Enforce minimum bid density per lead `(MEDIUM | 45 min)`

**Problem:** The 15% cold-auction + per-buyer skip cascade means some leads get 0 bids, which looks bad to a judge. For demo mode specifically the floor should be 2 bids per qualifying lead.

```typescript
// demo-buyer-scheduler.ts:121 — change cold-auction rate
- if (Math.random() < 0.15) {
+ if (Math.random() < 0.05) {  // 5% cold leads max in demo (was 15%)

// Also reduce per-buyer skip rate in demo:
// demo-buyer-scheduler.ts:153
- if (Math.random() < 0.10) continue;
+ if (Math.random() < 0.05) continue;  // 5% skip (was 10%)
```

And lower minScore for `LegalEagle` and `FinancePilot` to ensure at least one bid per lead:
```typescript
// demo-buyer-scheduler.ts:48-49
- { index: 4, name: 'LegalEagle',   ..., minScore: 8000, ... },
- { index: 5, name: 'FinancePilot', ..., minScore: 7500, ... },
+ { index: 4, name: 'LegalEagle',   ..., minScore: 6000, ... },
+ { index: 5, name: 'FinancePilot', ..., minScore: 6000, ... },
```

**Files:** `backend/src/services/demo/demo-buyer-scheduler.ts:43-54,121,153`
**Effort:** Low | **Expected outcome:** Near-zero cold auctions in demo; every lead shows 3+ bids.

---

### Fix 7 — Migrate `demo-results.json` to DB `(MEDIUM | 1 hr)`

**Problem:** Results written to disk (`demo-orchestrator.ts:98`) are lost on every Render deploy. A judge running the demo on a fresh deploy sees no history.

**Fix:** Write results to a `DemoResult` Prisma model (or use the existing `AnalyticsEvent` table). Fall back to in-memory cache if DB write fails.

**Files:** `backend/src/services/demo/demo-orchestrator.ts:94-125`, add Prisma migration
**Effort:** Medium | **Expected outcome:** Demo history persists across deploys.

---

## 7. Hackathon Submission Excellence Checklist

- [x] Chainlink CRE integrated and verified on-chain (CREVerifier deployed + confirmed)
- [x] Chainlink ACE (Policy Engine) integrated and confirmed
- [x] Chainlink Automation driving AuctionMonitor (every 2 s)
- [x] Chainlink VRF for tie-breaking
- [x] Chainlink Functions (CHTT TEE fraud enrichment)
- [x] Chainlink Data Feeds (floor price in LeadCard)
- [x] On-chain USDC vault (lock / settle / refund / verifyReserves / PoR)
- [x] LeadNFT minting on auction close
- [x] Demo results page with Basescan tx links
- [x] Proof of Reserves visible in demo results
- [ ] **Fix BUG-1: `serverTs` ISO string → epoch ms** ← Fixes frozen countdown timers
- [ ] **Fix BUG-2: `bidCount` hardcoded `1` → cumulative** ← Fixes "no bids" symptom
- [ ] **Fix BUG-3: typo `lead:status-change`** ← Fixes stuck-lead ghost cards
- [ ] **Fix BUG-4: 58-s gate → 5-s** ← Fixes grey-card linger
- [ ] Ensure `VITE_API_URL` / `VITE_SOCKET_URL` set correctly on Render frontend
- [ ] Verify deployer USDC reserve > $2,000 before judge runs demo
- [ ] Pin `demo-results.json` to a persistent volume or migrate to DB
- [x] README accurately documents all Chainlink service addresses
- [x] MCP agent responds to natural language queries about leads
- [x] ACE DevLog streams live during demo

---

## 8. Recommended Next Prompt

```
You are working on the Lead Engine CRE project (commit dc727aa). The following four bugs are causing
"hardly any bids" and "grey cards linger too long" in the demo:

BUG-1: `serverTs` emitted as ISO string in 3 places — fix to `Date.now()` (epoch ms):
  - backend/src/services/demo/demo-orchestrator.ts line 736
  - backend/src/services/auction-closure.service.ts lines 619 and 719

BUG-2: `bidCount` hardcoded as `1` in scheduleBuyerBids — fix to DB count + also emit `auction:updated`:
  - backend/src/services/demo/demo-buyer-scheduler.ts line 219
  (Use prisma.bid.count({ where: { leadId, status: { not: 'EXPIRED' } } }) after tx.wait())

BUG-3: Typo `lead:status-change` → `lead:status-changed`:
  - backend/src/services/auction-closure.service.ts line 96

BUG-4: Safety gate `ageMs < 58_000` → `ageMs < 5_000`:
  - backend/src/services/auction-closure.service.ts line 53

Also apply this bonus fix for card initial state:
BUG-5: addLead() in auctionStore.ts initializes liveBidCount: null — change to lead._count?.bids ?? null:
  - frontend/src/store/auctionStore.ts line 183

Apply all five fixes, verify TypeScript compiles, and commit with message:
"fix: sync pipeline — serverTs epoch, bidCount cumulative, status-changed typo, 58s gate, addLead seed"
```
