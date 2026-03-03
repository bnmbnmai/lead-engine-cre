# Deep Investigation: Background Recycling & Run Again Button

**Run ID**: `d537a93f-c454-42a2-8883-36004093083c`  
**Date**: 2026-03-03  
**Duration**: 378s (5 cycles, $165 settled, 1 VRF tiebreaker)

---

## Executive Summary

The Run Again button enables **the instant the results page loads** because `useDemo.ts` — the hook that DemoResults.tsx relies on — does not hydrate the `isRecycling` flag from the server on mount. The server-side guard is correct (rejects with 409 during recycling), but the client-side button is not gated.

There are **6 distinct root causes** that compound into the observed behavior:

---

## Root Cause 1 (PRIMARY): `useDemo.ts` HTTP Poll Ignores `recycling`

**File**: [`useDemo.ts:222-229`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/hooks/useDemo.ts#L222-L229)

```typescript
// Check initial status on mount
useEffect(() => {
    api.demoFullE2EStatus().then(({ data }) => {
        if (data?.running) {       // ← ONLY checks running
            setIsRunning(true);
        }
    }).catch(() => { /* ignore */ });
}, []);
```

The API endpoint at [`demo-panel.routes.ts:2068-2084`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L2068-L2084) returns **both** `running` and `recycling` flags:

```typescript
safeSend(res, {
    running: isDemoRunning(),
    recycling: isDemoRecycling(),   // ← Server sends this
    resultsReady,
    results: [...],
});
```

But `useDemo.ts` never reads `data?.recycling`. When DemoResults.tsx mounts (whether fresh navigation or page reload), `isRecycling` starts as `false` (React useState default), and the HTTP poll doesn't correct it.

**Impact**: Button immediately enabled on page load. This is the #1 cause.

**Log evidence**: Line 244 — `GET /full-e2e/status` returns `responseBytes=1498` (large payload = `recycling:true` + results data), but the client ignores the recycling flag.

---

## Root Cause 2: `useDemoStatus.ts` Had the Same Bug (Previously Fixed)

**File**: [`useDemoStatus.ts:68-76`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/hooks/useDemoStatus.ts#L68-L80)

This was fixed in commit `adca420` (our previous session), but `useDemo.ts` was NOT fixed — the same pattern exists in two independent hooks. `useDemoStatus` is used by the dashboard banner; `useDemo` is used by DemoResults. Both had the same bug; only one was fixed.

---

## Root Cause 3: `isRecycling` Is Ephemeral React State

**File**: [`useDemo.ts:75`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/hooks/useDemo.ts#L75) → `const [isRecycling, setIsRecycling] = useState(false);`

`isRecycling` is driven ONLY by socket events:
- `demo:results-ready` (line 179) → `setIsRecycling(true)`
- `demo:recycle-complete` (line 205) → `setIsRecycling(false)`

If the DemoResults page is navigated to *directly* (not from a socket-driven redirect), or if the user reloads the page, or if React unmounts and remounts the hook, `isRecycling` resets to `false`. There is no persistence (no localStorage, no URL param, no server hydration).

---

## Root Cause 4: Error/Abort Path Sets `phase: 'idle'` — No Recycling Gate

**File**: [`demo-orchestrator.ts:1660`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/demo/demo-orchestrator.ts#L1660)

```typescript
// Error path — sets phase to 'idle', NOT 'recycling'
emitStatus(io, { running: false, phase: 'idle', ... });
```

Contrast with the success path at [line 1623](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/demo/demo-orchestrator.ts#L1623):

```typescript
// Success path — correctly sets phase to 'recycling'
emitStatus(io, { running: false, recycling: true, phase: 'recycling', ... });
```

Both paths fire `recycleTokens()` (lines 1639 & 1684), but the error/abort path doesn't tell the frontend that recycling is happening. The Run Again button is immediately enabled on failure/abort even though USDC recovery is running in the background.

---

## Root Cause 5: Socket Disconnect During Recycling Drops Events

**Log evidence**: Line 349 — `Socket disconnected: qImfBlNzF2wJJflDAAAH` occurs after recycling completes.

If the socket disconnects *during* recycling (before `demo:recycle-complete` fires), the client never receives the signal to set `isRecycling=false`. Two outcomes:

1. **If client has reconnect logic**: It reconnects (line 354 shows reconnect), but `demo:recycle-complete` was already emitted — the client missed it. The button stays disabled forever (orphan state).
2. **If client remounts**: `isRecycling` resets to `false` (Root Cause 3), undoing the gate.

Currently the `useDemoStatus` hook's 5-second heartbeat (socketBridge.ts) handles reconnect + `fetchAndBulkLoad()`, but it doesn't re-poll `/full-e2e/status` to sync recycling state.

---

## Root Cause 6: No Periodic Recycling State Sync

There is no interval or heartbeat that periodically checks `/full-e2e/status` to re-sync `isRecycling`. The HTTP poll only runs once on mount (line 222-229). If the socket loses a critical event, the state diverges permanently until the next page load.

---

## Log Timeline Analysis (d537a93f)

| Log Line | Timestamp (relative) | Event | Recycling Impact |
|----------|---------------------|-------|-----------------|
| 222 | T+378s | `[DEMO] Demo run completed in 378s` | Backend sets `recycling:true` via emitStatus |
| 223-242 | T+378s | Fallback NFT mint starts | Still recycling — mint is fire-and-forget |
| 244 | T+~380s | `GET /full-e2e/status` (1498 bytes) | Returns `recycling:true` — but client ignores it |
| 248-302 | T+380-390s | NFT mint CALL_EXCEPTION (contract revert) | Non-fatal, recycling continues |
| 303-306 | T+~395s | Bounty recycle + formConfig re-seed on 8 verticals | Still recycling |
| 330 | T+~400s | `POST /full-e2e` — **new demo started** | Server returns 409 (recycling guard) OR user managed to start before recycle-complete |
| 337-338 | T+~401s | `GET /full-e2e/status` (972 bytes) | Smaller response = `recycling:false` — recycle just finished |
| 349 | Later | `Socket disconnected` | After everything settled |

**Key insight**: The POST at line 330 happened while fallback mints + bounty recycle were visibly active in the logs (lines 223-306). The button was not gated.

---

## Exact Post-"DEMO COMPLETE" Sequence (Code Flow)

```
demo-orchestrator.ts:1619 → saveResultsToDB(result)
demo-orchestrator.ts:1623 → emitStatus(io, { running: false, recycling: true, phase: 'recycling' })
                             ↳ Sends demo:status socket event with recycling=true
demo-orchestrator.ts:1626 → safeEmit(io, 'demo:results-ready', { ... })
                             ↳ useDemo.ts:176 receives → setIsRecycling(true) + navigate('/demo/results')
demo-orchestrator.ts:1632 → safeEmit(io, 'demo:complete', { ... })
                             ↳ useDemo.ts:138 receives → setIsRunning(false), setIsComplete(true)
                               NOTE: does NOT touch isRecycling                
demo-orchestrator.ts:1639 → void withRecycleTimeout(io, recycleTokens(io, signal, BUYER_KEYS))
                             ↳ FIRE AND FORGET (void)
                             ↳ recycleTokens() runs in background:
                               1. fallbackMintAndDispatch() for each unminted lead
                               2. drainBountyPools() — withdraws from all bounty pools
                               3. reseedFormConfigs() — re-seeds form config on 8 verticals
                               4. recycleTokens() — USDC approve + deposit per buyer wallet
                               5. emitStatus(io, { recycling: false, phase: 'idle' })
                               6. safeEmit(io, 'demo:recycle-complete', { ... })
                                  ↳ useDemo.ts:204 receives → setIsRecycling(false)

demo-orchestrator.ts:1641 → return result  ← function returns BEFORE recycle finishes
demo-orchestrator.ts:1699 → isRunning = false  ← in finally block
```

**Total recycling duration**: bounty drain (3 pools × 4s retries) + formConfig (8 verticals × 200ms) + token recycling (10 wallets × approve + deposit × 3 retries each) ≈ 30-120 seconds. The `withRecycleTimeout` caps at 480 seconds (8 minutes).

---

## Server-Side Guard (Correct — No Fix Needed)

[`demo-panel.routes.ts:1950-1957`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L1950-L1957):

```typescript
if (isDemoRecycling()) {
    res.status(409).json({
        error: 'Token redistribution from the previous run is in progress — please wait ~30s',
        running: false,
        recycling: true,
    });
    return;
}
```

This correctly rejects new demo starts during recycling. The server-side is NOT the problem.

---

## Proposed Fix Options

### Option A: Minimal Fix (Recommended — 4 lines)

Fix `useDemo.ts` HTTP poll to also hydrate `isRecycling` — identical to the fix already applied to `useDemoStatus.ts`:

**File**: `useDemo.ts:222-229`

```diff
 useEffect(() => {
     api.demoFullE2EStatus().then(({ data }) => {
-        if (data?.running) {
-            setIsRunning(true);
+        if (data?.running || data?.recycling) {
+            setIsRunning(Boolean(data.running));
+            setIsRecycling(Boolean(data.recycling));
         }
     }).catch(() => { /* ignore */ });
 }, []);
```

### Option B: Belt-and-Suspenders (Recommended alongside A)

1. **Fix error/abort path** in `demo-orchestrator.ts:1660` — set `recycling: true` instead of `phase: 'idle'` when recycling fires on failure:

```diff
-emitStatus(io, { running: false, phase: 'idle', ... });
+emitStatus(io, { running: false, recycling: true, phase: 'recycling', ... });
```

2. **Add periodic recycling sync** in `useDemo.ts` — a 10s interval that polls `/full-e2e/status` while `isRecycling` is true, to catch missed socket events:

```typescript
useEffect(() => {
    if (!isRecycling) return;
    const interval = setInterval(() => {
        api.demoFullE2EStatus().then(({ data }) => {
            if (!data?.recycling) {
                setIsRecycling(false);
            }
        }).catch(() => {});
    }, 10_000);
    return () => clearInterval(interval);
}, [isRecycling]);
```

### Option C: Nuclear Option (Most Robust)

Use `demo:status` socket event (which fires on every `emitStatus` call) as the primary driver for `isRecycling` in `useDemo.ts` — currently only `useDemoStatus.ts` listens to `demo:status`. This would make both hooks use the same authoritative source.

---

## Additional Polish Items Found

### 1. NFT `CALL_EXCEPTION` (Contract Revert)

**Log**: Line 248 — `status: 0` (transaction reverted). This is NOT a nonce race — the transaction was mined but the contract rejected it. Possible causes:
- Duplicate mint (same `platformLeadId` already minted)
- Invalid parameters
- Contract paused

**Impact**: Non-fatal (handled). But visible in logs and wastes gas.

### 2. VRF Checksum Warning Still Present

**Log**: Line 4 — Still showing the old checksum error. This means the fix from commit `cf9791a` hasn't been deployed to Render yet, or the build cache hasn't been cleared.

### 3. Bounty Nonce Collisions

**Log**: Lines 101, 192 — `releaseBounty nonce collision (attempt 1/3)`. The retry mechanism works (recovery confirmed at lines 114, 193), but indicates the deployer wallet is still under contention from parallel transactions.

### 4. On-Chain Log Visibility

The On-Chain Log in the frontend consumes `demo:log` events but does NOT show recycling progress. The `demo:recycle-progress` event (subscribed at `useDemo.ts:215`) updates `recyclePercent` but it's not rendered in the log stream — only in the progress badge. Users see an empty silence between "Demo completed" and "recycling done."

### 5. `POST /full-e2e` Response on Recycling 409

When the server rejects with 409 during recycling, the client's `startDemo()` at [useDemo.ts:244](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/hooks/useDemo.ts#L244) shows a generic "Failed to start demo" toast. It should parse the 409 response and show "Wallets still recycling — please wait" instead.

---

## Verification Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Server `isDemoRecycling()` guard | ✅ Correct | POST /full-e2e:1950 rejects with 409 |
| Server `emitStatus(recycling:true)` on success | ✅ Correct | orchestrator:1623 |
| Server `emitStatus(recycling:true)` on error | ❌ **Bug** | orchestrator:1660 sets `phase:'idle'` |
| Server `demo:recycle-complete` emission | ✅ Correct | vault-cycle:637 |
| Client `useDemoStatus` HTTP hydration | ✅ Fixed | commit `adca420` |
| Client `useDemo` HTTP hydration | ❌ **Bug (PRIMARY)** | Line 224 ignores `recycling` |
| Client socket-driven `isRecycling` | ✅ Works | When socket stays connected |
| Client reconnect recycling sync | ❌ **Missing** | No re-hydration on reconnect |
| DemoResults button guard | ✅ Correct | Line 331 uses `isRecycling` |
| VRF checksum fix deployed | ❓ Unconfirmed | Log still shows old error |
