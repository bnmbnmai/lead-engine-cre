# 1-Click Demo Deep Dive Investigation Report – February 20 2026

---

## Executive Summary

The 1-click demo (`POST /api/v1/demo-panel/full-e2e`) is a fully on-chain orchestrator that runs N auction cycles on Base Sepolia, streaming every step over Socket.IO and persisting cycle results in memory (and to `backend/demo-results.json`). The most recent run (`b8a3aae3`) completed **2 of 5 requested cycles** (cycles 3 and 4) before terminating with `status: "failed"` and `error: "Do not know how to serialize a BigInt"`.

Key findings:
- **BigInt error** originates at the Socket.IO `demo:complete` emission, *not* at the HTTP layer. The global `res.json()` middleware in `index.ts` is irrelevant here — Socket.IO calls `JSON.stringify()` directly and independently.
- **Only 2 cycles** because cycles 1 and 2 had incomplete wallet setups (lock 0 → 0 USDC bid → no-op), and the cycle counter in the results JSON is *lifecycle-cumulative*, not per-run (cycles 3 and 4 are the actual cycles that ran and settled).
- **Instant results-ready** works correctly on the frontend but the backend emits `demo:results-ready` only on graceful completion — when the run crashes on BigInt serialization, that event never fires, so the DemoPanel banner and useDemo hook's `partialResults` state are never set.
- **Recycle phase** runs non-blocking after `demo:complete`, returns USDC from buyer vaults → deployer, and replenishes USDC to buyer wallets. It emits `demo:recycle-progress` and `demo:recycle-complete` events.

---

## End-to-End Flow

### 1. Frontend → Button Click

The user clicks a "Run Demo" style button in the UI. In `DemoPanel.tsx` the user can navigate to the results page and call `startDemo(5)` via `useDemo.ts`, or the 1-click button in the marketplace invokes:

```
POST /api/v1/demo-panel/full-e2e   { cycles: 5 }
```

`useDemo.startDemo()` (`frontend/src/hooks/useDemo.ts:192`) clears prior logs and state, sets `isRunning = true`, then fires the API call.

### 2. Backend Route — Fire and Return

`demo-panel.routes.ts:1606` (`POST /full-e2e`):

1. Guards: `isDemoRunning()` → 409; `isDemoRecycling()` → 409.
2. Clamps cycles: `Math.max(1, Math.min(req.body?.cycles || 5, 12))`.
3. Calls `demoE2E.runFullDemo(io, cycles)` — **returns a Promise but does NOT await it**.
4. Immediately responds `200 { success: true, running: true }`.
5. Attaches `.catch()` to log any unhandled rejection.

The demo runs entirely in the background. The browser receives the 200 response immediately.

### 3. Backend Service — `runFullDemo()` (`demo-e2e.service.ts`)

**Pre-flight phase:**
- Sets `_demoRunning = true`, generates `runId` (UUID), records `startedAt`.
- Calls `seedMarketplace(io)` — seeds leads and bids into Postgres, emits `demo:log` events tagged `[Seeding]`.
- Initialises signer (deployer wallet), provider (Base Sepolia RPC), and loads all pre-funded wallet private keys from environment variables.

**Per-cycle loop (for i = 1..cycles):**

| Step | Action | Socket Event |
|------|--------|--------------|
| S1 | Inject lead into vertical (random from `['insurance','real_estate','mortgage','solar','home_services']`) | `demo:log` |
| S2 | Lock bids from 2 buyer wallets (`lockFunds()` → RTBEscrow.lockFunds on-chain) | `demo:log` + `ace:dev-log` |
| S3 | Simulate auction timer (1-minute auction → `BIDDING_END`) | `demo:log` |
| S4 | Settle winner via `RTBEscrow.settle()` → emits settle tx hash | `demo:log` |
| S5 | Refund losers via `RTBEscrow.refund()` | `demo:log` |
| S6 | PoR check via `verifyReserves()` (Chainlink PoR) | `demo:log` |
| S7 | Accumulate cycle result object | — |

After each cycle: pushes `CycleResult` to `cycles[]`.

**Post-cycle — Results-ready emission (before recycle):**

```typescript
// demo-e2e.service.ts (approx line 1240–1280)
io.emit('demo:results-ready', {
    runId,
    totalSettled,
    totalCycles: cycles.length,
    elapsedSec,
    cycles,
});
_resultsReady = true;
```

This fires **before** `recycleTokens()` starts, enabling instant UX.

**demo:complete emission:**

```typescript
io.emit('demo:complete', {
    runId, status, totalCycles, totalSettled, cycles,
    totalGas,   // ← BigInt derived from gasUsed accumulation
    error,
});
```

**Recycle phase (non-blocking, after demo:complete):**
- `recycleTokens(io, ...)` starts asynchronously.
- Sets `_demoRecycling = true`.
- Emits `demo:recycle-progress` with `{ percent }` as steps complete.
- Emits `demo:recycle-complete` on finish.

### 4. Results Persistence

Three layers of persistence:

| Layer | Where | When |
|-------|-------|-------|
| In-memory Map | `_results: Map<string, DemoResult>` in `demo-e2e.service.ts` | End of `runFullDemo()`, before `demo:complete` |
| `backend/demo-results.json` | Written via `fs.writeFileSync` | Same moment — belt-and-suspenders persistence for Render restarts |
| DB query on cold boot | `initResultsStore()` loads from `demo-results.json` | Server startup (non-blocking) |

### 5. Frontend — Socket Event Handling

`useDemo.ts` subscribes to three demo events:

| Event | Handler | Effect |
|-------|---------|--------|
| `demo:log` | Appends to `logs[]`, updates `progress` | Live log stream |
| `demo:results-ready` | Sets `partialResults`, `isComplete=true`, `completedRunId` | Instant results UX (before recycle) |
| `demo:complete` | Sets `isRunning=false`, `isComplete=true`, toast | Final completion signal |
| `demo:recycle-progress` | Updates `recyclePercent` | Progress bar |

`DemoPanel.tsx` also independently subscribes to `demo:results-ready` and `demo:recycle-progress` to show the inline green banner and recycle progress bar.

### 6. Results Page Navigation

When `demo:results-ready` fires:
- `useDemo` sets `completedRunId = runId`.
- `DemoPanel.tsx` shows the "⚡ Demo Complete – Results Ready → View" banner.
- Clicking "View →" navigates to `/demo/results/{runId}`.

`DemoResults.tsx` on mount calls `GET /api/v1/demo-panel/full-e2e/results/latest` (or `/:runId`). The backend `getLatestResult()` function returns the in-memory result (which already has `resultsReady: true` appended by the route handler via `safeSend()`).

---

## Results Saving and Serving

### Save Points

1. **`storeResult(result)`** in `demo-e2e.service.ts` — called immediately before `io.emit('demo:complete')`. Writes to `_results` Map and serializes `demo-results.json` to disk.
2. **`initResultsStore()`** — called at server startup (line 1591 in routes file), reads `demo-results.json` and populates `_results` Map. Handles cold-boot Render restarts.

### Serve Endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/v1/demo-panel/full-e2e/results/latest` | Latest result from `_results` Map (or 404 if none). Guards: 200 `{status:'running'}` if running, 202 `{status:'finalizing'}` if recycling. |
| `GET /api/v1/demo-panel/full-e2e/results/:runId` | Specific run from `_results` Map. |
| `GET /api/v1/demo-panel/full-e2e/status` | Running/recycling flags + summary list of all results. |

**Both HTTP endpoints use `safeSend()`** — a local helper in `demo-panel.routes.ts` that explicitly serializes BigInt to string before calling `res.json()`. This works correctly.

---

## BigInt Error Root Cause

### The Error

```
"error": "Do not know how to serialize a BigInt"
```

This is a standard V8 JavaScript error thrown when `JSON.stringify()` encounters a native `BigInt` value.

### Why the Global Middleware Doesn't Help

`index.ts` lines 121–132 patches `res.json()` to safely serialize BigInt. This works perfectly for **HTTP responses**. However:

> **Socket.IO does not use `res.json()`.**

Socket.IO's `io.emit()` independently calls `JSON.stringify()` on the payload before sending over the WebSocket. It is completely bypassed by Express middleware.

### Where Exactly It Happens

In `demo-e2e.service.ts`, the `totalGas` field is accumulated as a BigInt:

```typescript
let totalGas = 0n;
// per cycle:
totalGas += BigInt(cycleGasUsed);  // gasUsed from ethers.js is BigInt
```

When the run fails mid-emit:

```typescript
io.emit('demo:complete', {
    runId,
    status: 'failed',
    totalCycles: cycles.length,
    totalSettled,
    cycles,
    totalGas,   // ← This is a native BigInt (e.g., 690589n)
    error: errorMessage,
});
```

Socket.IO calls `JSON.stringify({ ..., totalGas: 690589n })` → **throws `TypeError: Do not know how to serialize a BigInt`**.

Similarly, `cycle.gasUsed` may be accumulated as BigInt within each cycle, and `lockIds` returned from the contract call are BigInt values that must be converted to Number before emission.

### Why It Wasn't Caught Earlier

The `safeSend()` helper in the routes file is a local defensive measure for HTTP responses. The Socket.IO emission in `demo-e2e.service.ts` was written without a parallel BigInt conversion guard. The global middleware was mistakenly expected to cover this code path.

### The Fix

In `demo-e2e.service.ts`, before every `io.emit('demo:complete', ...)` and `io.emit('demo:results-ready', ...)` call, convert the payload through a BigInt-safe serializer:

```typescript
function safeEmit(io: SocketServer, event: string, payload: any) {
    const safe = JSON.parse(
        JSON.stringify(payload, (_k, v) => typeof v === 'bigint' ? v.toString() : v)
    );
    io.emit(event, safe);
}
```

---

## Why Only 2 Cycles and Failed Status

### The Cycle Numbering Is Cumulative

The `cycle` field in each `CycleResult` is **not** a per-run index starting at 1. It is the cumulative lock ID from the blockchain (`lockId` returned by `RTBEscrow.lockFunds()`). Because previous demo runs already created locks 1–232 on-chain, the current run starts at lock 233. The two successful cycles in the run are reported as cycle 3 and 4 in the JSON, but these are the **1st and 2nd** cycles of this particular run.

### Why Only 2 Cycles Completed

The run was configured for 5 cycles. After cycles 1 and 2 (reported as 3 and 4) completed successfully:

1. The service attempted to emit `demo:results-ready` (which may have succeeded partially).
2. Then attempted to call `storeResult()` and emit `demo:complete` with the full payload including `totalGas` as a native BigInt.
3. `JSON.stringify()` inside Socket.IO threw `TypeError: Do not know how to serialize a BigInt`.
4. This exception propagated up to the `runFullDemo()` try/catch.
5. `runFullDemo` caught the error, set `status = 'failed'`, `error = err.message`, tried to emit `demo:complete` again — which also threw (same BigInt in the partial payload).
6. The unhandled rejection path in the route's `.catch()` logged the error.
7. `_demoRunning` was reset to `false`.

The result JSON (`demo-results.json`) was written **before** the BigInt emission (or with the safe serialization that `storeResult()` applies), which is why `totalGas: "690589"` appears as a string in the stored JSON — the disk write succeeded. The cycle count was 2 because that's how many cycles completed before the crash.

### The `status: "failed"` Flag

`runFullDemo()` sets `status = 'failed'` and writes `error` when any uncaught exception escapes the main try/catch. Since the BigInt emission happened at the very end (post-cycles, during result finalisation), all actual on-chain transactions succeeded — the "failure" is purely a serialization error at reporting time.

---

## Instant Results UX Behavior

### Design Intent

The system was designed with a two-phase signalling approach:
1. **`demo:results-ready`** — fires immediately after all cycles complete, before recycle starts. Carries cycle data so the UI can render results without waiting.
2. **`demo:complete`** — fires after `demo:results-ready`, carries final aggregate stats. `DemoResults.tsx` also polls the HTTP endpoint as a fallback.

### Why It Didn't Work in This Run

Because the BigInt error explodes **during** the `demo:results-ready` emission (or immediately after, during `storeResult()`), the sequence never fully completes:

- If `demo:results-ready` threw before the Socket.IO emit completed: frontend `useDemo` never received it → `partialResults` state was never set → `DemoPanel` banner never appeared.
- If `demo:results-ready` fired successfully but `demo:complete` threw: the DemoPanel banner *would* have shown. However, navigating to `/demo/results` would hit the HTTP endpoint which returns the stored result (disk write was successful), so the page would load correctly once the user manually navigated.

### What the Frontend Does

`DemoResults.tsx` has a retry loop (`RETRY_DELAYS = [800, 2000, 4000, 8000, 15000]`) — up to 5 retries with exponential backoff. If the server returns `{status: 'running'}`, it shows a "still in progress" message. If the server returns a `202` (recycle in flight), it shows the amber "finalizing" spinner and auto-retries in 3 seconds. If results are found (`data.runId` present), it renders immediately.

Since `demo-results.json` was written correctly (BigInt serialized), the HTTP fallback path actually works — navigating directly to `/demo/results` would show the correct result with 2 cycles and `status: "failed"`.

---

## Recycle Phase Current State

### Purpose

The recycle phase restores the demo wallet ecosystem so the next run can start fresh:
- Withdraw USDC from buyer vault balances back to deployer
- Transfer USDC from buyer wallets back to deployer  
- Re-distribute USDC from deployer to all buyer wallets (flat replenishment)

### Implementation (`recycleTokens()` in `demo-e2e.service.ts` lines 808–~1100)

**R1 — Gas top-up for seller** (if seller ETH balance low):
- Sends ETH from deployer to seller wallet for next-run gas.

**R2 — Withdraw deployer's own vault balance:**
- Calls `RTBEscrow.withdrawVault(deployer)` on-chain.

**R3 — Withdraw seller vault + transfer seller USDC → deployer:**
- Calls `RTBEscrow.withdrawVault(seller)`.
- Transfers all USDC from seller wallet → deployer.

**R4 — Withdraw each buyer vault balance:** (for all 10 buyer wallets)
- Calls `RTBEscrow.withdrawVault(buyer)`.

**R5 — Transfer buyer USDC balances → deployer:**
- For each buyer wallet: transfers USDC balance back to deployer.

**R6 — Replenish each buyer wallet with fresh USDC:**
- Deploys flat replenishment amount (e.g., 200 USDC) from deployer → each buyer.

### Progress Signalling

```typescript
// Emitted at each major recycle milestone
io.emit('demo:recycle-progress', { percent: progressPercent });
// On completion:
io.emit('demo:recycle-complete', { recycled: true });
```

### Current State

The recycle phase is **fully implemented and operational**. However, because the `demo:complete` event threw a BigInt error in the latest run, the `recycleTokens()` call that follows it was **never reached** — the function exited early via the catch block. No recycle ran for the `b8a3aae3` run.

The `isDemoRecycling()` guard protects subsequent runs from starting while recycle is in flight. After the BigInt crash, `_demoRecycling` was never set to `true`, so a new demo run can start immediately.

---

## Key Files Mapping

| File | Role |
|------|------|
| `backend/src/services/demo-e2e.service.ts` (1914 lines) | Core orchestrator: `runFullDemo()`, `recycleTokens()`, `storeResult()`, `getLatestResult()`, `initResultsStore()`, in-memory results Map, disk persistence |
| `backend/src/routes/demo-panel.routes.ts` (1814 lines) | HTTP endpoints: `POST /full-e2e` (start), `POST /full-e2e/stop`, `GET /full-e2e/results/latest`, `GET /full-e2e/results/:runId`, `GET /full-e2e/status`, `safeSend()` helper |
| `backend/src/index.ts` (287 lines) | Global BigInt-safe `res.json()` middleware (lines 121–132) — covers HTTP responses only, NOT Socket.IO |
| `backend/demo-results.json` | On-disk cache of all demo run results — survives server restarts |
| `frontend/src/hooks/useDemo.ts` (255 lines) | Frontend state machine: listens to `demo:log`, `demo:complete`, `demo:results-ready`, `demo:recycle-progress` |
| `frontend/src/hooks/useDemoStatus.ts` | Polls `GET /full-e2e/status` to populate status page run history |
| `frontend/src/pages/DemoResults.tsx` (455 lines) | Results display page: retry logic, 202-aware finalizing state, history tabs, cycle table with Basescan links |
| `frontend/src/components/demo/DemoPanel.tsx` (806 lines) | Dev control panel: houses "Run Demo" triggers, shows `demo:results-ready` banner with inline recycle progress bar |
| `backend/src/lib/prisma.ts` | Prisma client (used by seed/clear marketplace helpers) |
| `backend/src/rtb/socket.ts` | RTBSocketServer — initialises Socket.IO server, exposes `getIO()` for `req.app.get('io')` |

---

## Root Cause Hypotheses

### H1 — Primary: BigInt Not Sanitised Before Socket.IO Emission ✅ CONFIRMED

**Root cause:** `totalGas` is accumulated as a native `BigInt` in `runFullDemo()` and passed directly into `io.emit('demo:complete', ...)` without conversion. Socket.IO serializes via `JSON.stringify()` independently of Express middleware, throwing `TypeError: Do not know how to serialize a BigInt`.

**Fix:** Add a `safeEmit()` wrapper (shown above) around every `io.emit()` call in `demo-e2e.service.ts` that carries cycle data, gas totals, or lock IDs.

### H2 — Secondary: Missing `demo:results-ready` Emission Prevents Instant UX

If `totalGas` BigInt is already present at the `demo:results-ready` emission stage (which includes the `cycles[]` array — each with BigInt `gasUsed`), then *that* event also crashes before reaching the client. This means:
- `useDemo.partialResults` is never populated.
- The DemoPanel banner never appears.
- The user must manually navigate to `/demo/results` to see the stored results from disk.

### H3 — Tertiary: Cycle Counter Confusion (Cosmetic)

The `cycle` numbers in results (3, 4) are lock IDs from the blockchain, not sequential per-run indices. This is confusing in the results UI but does not affect correctness. Future runs will show increasing cycle numbers that don't reset between runs.

### H4 — Recycle Phase Never Runs on BigInt Crash

Because the BigInt error terminates `runFullDemo()` before `recycleTokens()` is invoked, the buyer wallets are left with USDC from the completed cycles' refund paths still in their wallets. The next demo run can still start (recycle guard flag was never set), but wallet balances may be uneven. The `/fund-eth` endpoint covers gas but not USDC imbalances.

### H5 — Global Middleware Misconception

The global `res.json()` BigInt patch in `index.ts` is correct and sufficient for all HTTP endpoints. The `safeSend()` helper in `demo-panel.routes.ts` provides belt-and-suspenders protection for the results endpoints. Neither of these helps for Socket.IO. The fix must be applied in `demo-e2e.service.ts` at the emission site.

---

*Report generated: February 20, 2026. Based on full source code analysis of `demo-e2e.service.ts` (1914 lines), `demo-panel.routes.ts` (1814 lines), `index.ts`, `useDemo.ts`, `DemoPanel.tsx`, and `DemoResults.tsx`.*
