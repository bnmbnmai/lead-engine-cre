# Self-Review — Iteration 12 (Pure Option 1)

**Base Commit:** 75b7c54  
**Applied Patches:** R-01 through R-07  
**Date:** 2026-02-22

---

## 1. Purity Confirmation

**Did any on-chain, vault, settlement, PoR, VRF, NFT minting, or core orchestrator flow change?**

**No.** Exact proof by file:

| File | Change | On-chain impact |
|------|--------|----------------|
| `demo-buyer-scheduler.ts` | Added two `io.emit('auction:bid:pending', …)` calls and changed `fallbackDelay` window for slots 2–3 | None — vault `lockForBid()` call site is unchanged; setTimeout logic is unchanged; only a socket emit is prepended |
| `demo-orchestrator.ts` | Changed `30_000` → `5_000` in `setInterval` for `emitLiveMetrics` | None — `emitLiveMetrics` only reads DB metrics and broadcasts a DevLog event; no writes, no chain calls |
| `demo-lead-drip.ts` | Changed sleep duration from 3500–7000 ms to 400–800 ms; added `io.emit('demo:pre-populated', …)` after seed loop | None — `injectOneLead()` is identical; only the inter-lead delay and one new socket event were added |
| `LeadCard.tsx` | Added `liveHighestBid` read from existing Zustand store; added conditional price chip in overlay | Frontend only — no backend touched |
| `HomePage.tsx` | Added `TickerEvent` type, `tickerEvents` state, `addTicker` callback, two socket handler additions, one JSX block | Frontend only — no backend touched |

**Are all new events emitted from real existing scheduler/drip code only?**

- `auction:bid:pending` — emitted from `scheduleBuyerBids()` in `demo-buyer-scheduler.ts`, which is the real buyer-scheduling function. It fires synchronously after the bid amount is determined, before the `setTimeout` vault lock. This is a genuine scheduler milestone, not a fake event.
- `demo:pre-populated` — emitted from `startLeadDrip()` in `demo-lead-drip.ts` after the real initial seed loop completes. It signals a real system state.

**Verdict: 100% pure. Zero on-chain code was modified.**

---

## 2. Completeness Check

### R-01: `auction:bid:pending` emitted immediately on schedule (primary + fallback)
✅ **Implemented.** Verified in `demo-buyer-scheduler.ts`:
- Line 164: emitted in primary buyer loop immediately after `delayMs` is computed, before the `setTimeout(async () => { vault.lockForBid(…) })` fires.
- Line 320: emitted in fallback buyer loop, before `fallbackTimer = setTimeout(…)`.

⚠️ **Gap — not consumed in frontend.** `socketBridge.ts` (the global bridge mounted in `App.tsx`) has no handler for `auction:bid:pending`. `LeadCard.tsx` has no handler for it either. The event is emitted to the wire and silently dropped by every client. **No UI change results from R-01.** The event is real and correct on the wire, but the frontend loop is incomplete — the last mile (display) was not implemented.

### R-02: Metrics interval reduced to 5 s
✅ **Implemented and correct.** `demo-orchestrator.ts` line 577:
```
metricsInterval = setInterval(() => { void emitLiveMetrics(io, runId); }, 5_000); // R-02
```
`emitLiveMetrics` is defined in `demo-buyer-scheduler.ts` and reads live DB metrics then emits a `demo:log` DevLog event. At 5 s cadence it will fire 60× per 5-min demo (vs. 10×). No side effects; purely additive.

### R-03: Late-window sniper bias for 2 of 4 fallback buyers
✅ **Implemented and correct.** `demo-buyer-scheduler.ts`:
```
const isLateSniper = fallbackSlot >= 2;
const fallbackDelay = isLateSniper
    ? Math.round((45 + Math.random() * 13) * 1000) // 45–58 s
    : Math.round((3 + Math.random() * 40) * 1000);  // 3–43 s
```
`fallbackSlot` is incremented before each iteration. Slots 0 and 1 use the normal window; slots 2 and 3 are biased to 45–58 s, which creates last-second pressure within the 60 s auction window. The vault `lockForBid` inside the `setTimeout` is unchanged — timing is real on-chain timing.

⚠️ **Edge case:** If the eligible pool has fewer than 3 extra buyers (some verticals are restrictive), slots 2+ may not be reached, so the late-sniper bias might not fire on every auction. This is acceptable — it degrades gracefully to the pre-patch behaviour rather than failing.

### R-04: Winning price shown in emerald chip on SOLD cards
✅ **Partially implemented.**

- `LeadCard.tsx` correctly reads `storeSlice?.liveHighestBid` from the Zustand store and renders it in an emerald chip when `auctionEndFeedback === 'SOLD'`.

⚠️ **Critical gap — `winningAmount` is never written to `liveHighestBid` at close.** Trace:
1. `demo-orchestrator.ts` emits `auction:closed` with `winningAmount: bidAmount` (line 914).  
2. `socketBridge.ts` handles `auction:closed` at line 74–80: calls `store().closeLead(data.leadId, data.status === 'SOLD' ? 'SOLD' : 'UNSOLD')`.
3. `closeLead()` in `auctionStore.ts` (lines 316–370) does **not** accept or write `winningAmount` — the spread `...lead` preserves whatever `liveHighestBid` was from the last `updateBid()` call.
4. `liveHighestBid` is only written in `updateBid()`, which is called on `auction:updated` and `marketplace:bid:update`. If the last such event arrived before the winning bid was fully processed, `liveHighestBid` may be stale or null.

**Result:** In practice the chip will show the last bid amount seen during bidding, not the confirmed `winningAmount` from the settlement event. For a demo where bidding is continuous this will often be close to correct, but it is not the authoritative `winningAmount`. The chip may also not appear at all if `liveHighestBid` is null (e.g., the store was loaded from a bulk refresh that set it to null).

### R-05: Global activity ticker added in HomePage.tsx
✅ **Implemented and functional.** `type TickerEvent` is defined at module scope. `tickerEvents` state and `addTicker` callback are correct. Two socket event handlers push to the ticker:
- `marketplace:lead:new` → pushes a `kind: 'lead'` event (always has `vertical`).
- `marketplace:bid:update` → pushes a `kind: 'bid'` event **only when `data.buyerName` is present**.

⚠️ **`buyerName` is not in all `marketplace:bid:update` payloads.** The RTB socket server (`socket.ts` line 389) emits `marketplace:bid:update` without `buyerName` for real user bids placed via the UI. `buyerName` is only included in the demo scheduler paths (`demo-buyer-scheduler.ts` lines 249, 359). For the demo use case this is fine — all demo bids include `buyerName` — but real user bids will be silently dropped by the `if (data?.leadId && data.buyerName)` guard and won't appear in the ticker.

The JSX is rendered only when `view === 'leads' && tickerEvents.length > 0` — appears above the hero section and filters, degrading gracefully (invisible until the first socket event).

### R-06: Prod-safe `/full-e2e` routes (no-op confirmed)
✅ **Correctly identified as no-op.** `demo-panel.routes.ts` lines 1663 and 1710 use `authMiddleware` + `publicDemoBypass`. `publicDemoBypass` (lines 1640–1661) permits passage for ADMIN JWT or `X-Api-Token` header — there is no `NODE_ENV === 'development'` check anywhere on these routes. They already work in production builds. No change was needed and none was made.

### R-07: Fast initial seed (400–800 ms) + `demo:pre-populated` event
✅ **Implemented.** Sleep reduced from `3500 + rand(0,3500)` ms to `400 + rand(0,400)` ms. With `DEMO_INITIAL_LEADS = 8` (default), all 8 leads seed in approximately 5 s (vs. ~55 s before). `demo:pre-populated` is emitted after the loop.

⚠️ **`demo:pre-populated` is not consumed in the frontend.** Neither `socketBridge.ts` nor `HomePage.tsx` nor any other frontend file listens for `demo:pre-populated`. It is emitted to the wire but silently dropped. The rapid seeding itself (the timing change) is the functional part — that works. The event exists on the wire for future use.

---

## 3. Stability & Correctness

### TSC — backend/frontend
✅ **Both clean.** Verified with `npx tsc --noEmit`:
- `backend`: exit 0, zero errors
- `frontend`: exit 0, zero errors

### Hardhat tests — 260 passing?
⚠️ **Not run in this session.** Hardhat tests were not executed. The patches touch zero Solidity files, zero contract ABIs, and zero Hardhat scripts — all changes are TypeScript-only in demo service and React frontend files. The pre-existing test suite should be unaffected. A run is strongly recommended before any deployment.

### Races, dead zones, or broken behavior when demo is not running?
All patches are guarded correctly:
- R-01 `auction:bid:pending` only emits during a demo (only scheduled buyers call `scheduleBuyerBids`). When demo is not running, no buyer scheduling occurs, so the event is never emitted.
- R-02 metrics interval only exists while `metricsInterval` is set (between `runFullDemo` start and the `finally` cleanup block which calls `clearInterval`). Outside a demo run the interval does not exist.
- R-03 late-window bias only affects `scheduleBuyerBids`, which is demo-only.
- R-04 `liveHighestBid` read is safe: `storeSlice?.liveHighestBid ?? null` — if null, the chip simply doesn't render.
- R-05 ticker is empty state-guarded (`tickerEvents.length > 0`) and the `addTicker` callback has no side effects beyond React state.
- R-07 rapid seed only fires inside `startLeadDrip()`, which is demo-only.

**No regressions when demo is not running.**

### Wallet economics within 3500–4000 USDC limit?
R-03's late-sniper bias does not increase the number of bids — it only changes *when* existing scheduled bids land. The total number of vault lock + refund cycles per auction is identical. Wallet economics are unchanged.

---

## 4. Excellence & Gaps

### Does the demo now feel lively?

**Partially.** The functional improvements that actually manifest in UI:

| Improvement | Actually visible? | Notes |
|-------------|-------------------|-------|
| Fast grid population (~5 s) | ✅ Yes | Most impactful change — grid fills immediately |
| Activity ticker (bids + new leads) | ✅ Yes | Works for all demo bids; invisible for non-demo real bids |
| Metrics updates every 5 s | ✅ Yes | DevLog gets live pulses throughout the demo |
| Late-sniper urgency (last 15 s) | ✅ Yes | Two buyers guaranteed to hit 45–58 s |
| SOLD price chip on card close | ⚠️ Partial | Shows last bidding-phase price, not confirmed `winningAmount` |

**Not visible in UI:**
- `auction:bid:pending` — emitted but unhandled.
- `demo:pre-populated` — emitted but unhandled.

### Gaps Summary

| Gap | Severity | Description |
|-----|----------|-------------|
| `auction:bid:pending` not consumed in frontend | 🟡 Moderate | The "bid incoming" moment — the core premise of R-01 — has no visual effect. The event fires on the wire but nothing renders. |
| `liveHighestBid` at close is not `winningAmount` | 🟡 Moderate | The R-04 chip may show stale or null price. `closeLead()` must forward `winningAmount` from the `auction:closed` payload to fix this. |
| `demo:pre-populated` not consumed | 🟢 Minor | The timing change (R-07) delivers the grid-fill benefit; the event is informational only. No UI regression. |
| `buyerName` absent from non-demo `marketplace:bid:update` | 🟢 Minor | Demo-only path always includes it; real user bids from UI don't, so ticker silently skips them. Acceptable for demo context. |

---

## 5. Final Verdict

**Needs Micro-Fix**

The fast seeding (R-07), metrics cadence (R-02), and sniper timing (R-03) are excellent and require no further work. The ticker (R-05) works for demo. The prod-safe routes (R-06) were correctly identified as pre-existing.

Two patches have incomplete last-mile wiring:

### Micro-Fix A — R-01: Wire `auction:bid:pending` in `socketBridge.ts`
**File:** `frontend/src/lib/socketBridge.ts`  
**After line 88** (after the `unsubStatusChanged` block), add:
```typescript
const unsubBidPending = socketClient.on('auction:bid:pending', (data: any) => {
    if (!data?.leadId) return;
    // Surfaces the pending bid to any component listening (e.g., LeadCard incoming-bid flash)
    store().updateBid({ leadId: data.leadId, highestBid: data.amount });
});
```
And add `unsubBidPending()` to the cleanup return. This routes the real scheduler event into the store so `liveHighestBid` updates immediately — before the vault lock confirms — giving LeadCard a real-time price signal.

### Micro-Fix B — R-04: Forward `winningAmount` through `closeLead()`
**File 1:** `frontend/src/store/auctionStore.ts`  
Change `closeLead(leadId: string, status: 'SOLD' | 'UNSOLD')` signature to accept an optional `winningAmount?: number | null`. Inside the function, after `liveRemainingMs: 0,` add:
```typescript
liveHighestBid: winningAmount ?? lead.liveHighestBid,
```

**File 2:** `frontend/src/lib/socketBridge.ts`  
Change the `auction:closed` handler (line 77) to:
```typescript
store().closeLead(data.leadId, data.status === 'SOLD' ? 'SOLD' : 'UNSOLD', data.winningAmount ?? null);
```

These two changes are the minimal, exact wiring that completes R-01 and R-04 as specified in the audit.
