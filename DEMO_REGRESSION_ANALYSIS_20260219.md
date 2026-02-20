# DEMO REGRESSION ANALYSIS — 2026-02-19

**Status:** Investigation complete — no code changes made  
**Scope:** All commits after `4bc1783` through commit `515e750`  
**Environment:** Render (backend) + Vercel (frontend), Base Sepolia testnet  
**Investigation date:** 2026-02-19T16:08 MST

---

## Executive Summary

The Lead Engine CRE demo enters a broken state after the introduction of the full USDC recovery (`recycleTokens`) feature and the associated socket/frontend changes in late February 2026. Two independent failure modes combine to produce the observed symptoms: (1) the frontend `DevLogPanel` receives **zero** `demo:log` events after the first persona switch or page navigation because `DemoPanel.tsx` calls `socketClient.disconnect()` before reconnecting, and the socket.io singleton's `disconnect()` method **nullifies the internal socket instance** — a new `io()` connection is then created, but no `DevLogPanel` listener is attached to it, so all subsequent server broadcasts are silently dropped; and (2) the "Stop Demo" button has no effect because `stopDemo()` only signals the `currentAbort` controller which stops the *cycle loop* but does not halt the `recycleTokens()` background co-routine, which was spawned with `void` and holds its own separate `AbortController` (`recycleAbort`).

Beyond these two primary failures, a third systemic issue is the ~10-minute runtime of `recycleTokens` across 10 buyer wallets × 3 retry attempts × sequential on-chain transactions. If the Render instance restarts (common for the free tier during this window), the `isRecycling` in-memory flag resets to `false` while the underlying blockchain transactions may still be pending, leaving USDC stranded mid-sweep. The frontend has no way to distinguish "demo complete and recycling" from "server restarted and recycling silently died."

---

## 1. Dev Log / Socket Connection Failure

### 1.1 The Disconnect/Reconnect Gap

**File:** `frontend/src/components/demo/DemoPanel.tsx` — `handlePersonaSwitch()` (lines 248–310) and `handleDemoAdminLogin()` (lines 312–349)

Every persona switch and every admin login calls:

```ts
socketClient.disconnect();
socketClient.connect();
```

**File:** `frontend/src/lib/socket.ts` — `SocketClient.disconnect()` (lines ~165+)

The `disconnect()` method calls `this.socket.disconnect()` on the underlying Socket.IO client **and sets `this.socket = null`**. This is correct for forcing a fresh handshake with a new JWT — but it creates a critical gap:

1. `disconnect()` fires → `this.socket = null`
2. `connect()` fires → creates a brand-new `io()` instance
3. The new `io()` instance re-registers the forwarding listeners (the `events.forEach` at lines 127–131 of `socket.ts`) so events **are** forwarded to `this.listeners`
4. BUT `DevLogPanel.tsx` registered its `ace:dev-log` and `demo:log` handlers via `socketClient.on(...)` during its own mount `useEffect` — it never re-registers after a socket reconnect

The result: after the first persona switch, `DevLogPanel` holds stale handler references that are pointed at the old `this.listeners` Map entries, not at the new socket's event pipeline. In practice, the new socket receives `demo:log` events from the server but there is **no handler consuming them in the panel**.

### 1.2 Socket.IO WebSocket Fallback Noise

**Backend:** `backend/src/rtb/socket.ts` — `RTBSocketServer` constructor (lines 114–123)

The server configures `transports: ['websocket', 'polling']` on the client-side. Vercel's edge network does not support persistent WebSocket upgrades on the same origin as an HTTP Serverless Function. The session begins with a WebSocket handshake (`wss://`), which Vercel proxies — and then severs during the upgrade phase — resulting in the console error:

> `WebSocket is closed before the connection is established`

Socket.io then falls back to HTTP long-polling successfully, so events *can* arrive — but **only to whatever listeners were registered before the persona switch gap described in §1.1 above**.

### 1.3 Vercel / Render Split-Origin Gap

**Frontend env var:** `VITE_SOCKET_URL` or `VITE_API_URL` (used in `socket.ts` line 4)

The frontend (Vercel) connects its socket to the Render backend URL. Render's free tier puts the service to sleep after 15 minutes of inactivity. If the socket connection was established before the server went to sleep and then woke up, Socket.IO's reconnection logic re-connects (`reconnectionAttempts: 5, reconnectionDelay: 1000`) but the Render process is a **new Node process with a brand-new `io` server instance** — and the in-memory `isRunning` flag will be `false`, so `runFullDemo()` may be called again concurrently if the button is clicked during this window.

### 1.4 DevLogPanel Mount Timing

**File:** `frontend/src/components/demo/DevLogPanel.tsx` — `useEffect` (around line 300)

`DevLogPanel` calls `socketClient.connect()` on mount and registers `ace:dev-log` / `demo:log` listeners. If the panel is not mounted when `demo:log` events fire (e.g., if the panel starts collapsed or if the component unmounted during a route navigation), **all events emitted between the route change and re-mount are lost forever** — Socket.IO does not buffer past events for late joiners.

---

## 2. "Stop Demo" Button Failure

### 2.1 Stop Endpoint Logic

**File:** `backend/src/routes/demo-panel.routes.ts` — `POST /full-e2e/stop` (lines 1642–1648)

```ts
router.post('/full-e2e/stop', async (_req, res) => {
    const stopped = demoE2E.stopDemo();
    res.json({ success: stopped, message: stopped ? 'Demo abort signal sent' : 'No demo is currently running' });
});
```

**File:** `backend/src/services/demo-e2e.service.ts` — `stopDemo()` (lines 1557–1568)

```ts
export function stopDemo(): boolean {
    let stopped = false;
    if (isRunning && currentAbort) {
        currentAbort.abort();
        stopped = true;
    }
    if (isRecycling && recycleAbort) {
        recycleAbort.abort();
    }
    return stopped;
}
```

**Correct path:** `stopDemo()` returns `true` if `isRunning === true`, which means the button *does* work during the active cycle phase.

**Broken path (the observed state):** By the time the button is clicked, the demo cycles have completed and `isRunning` has been set to `false` (in the `finally` block at line 1548). The demo is now in the `recycleTokens()` background phase. `isRecycling` is `true`, but the `recycleAbort` controller is separate from `currentAbort`. The route returns `{ success: false, message: 'No demo is currently running' }` — which the frontend may not surface clearly, making the button appear dead.

**Secondary issue:** `recycleTokens()` is called with `void` (fire-and-forget, line 1542 for failure path and implicitly after the success path completes). It does check `recycleAbort.signal` at each wallet iteration boundary (lines 820 and 881), but if the Render process is mid-transaction (awaiting `tx.wait()`), aborting the controller does not cancel the in-flight blockchain request — it only skips the *next* wallet. The current transaction still runs to completion.

### 2.2 Frontend Stop Button — No Feedback Loop

**File:** `frontend/src/components/demo/DemoPanel.tsx` — (no explicit "Stop Demo" button in DemoPanel)

There is no "Stop Demo" `ActionButton` defined in `DemoPanel.tsx`. The "Stop Demo" button seen in the UI appears to come from a different component (likely `DemoResults.tsx` or a status banner). If that component subscribes to `demo:status` socket events and the socket has disconnected (§1.1), the button's state will be frozen on whatever the last known state was — which could be `running: true` even after the demo completes.

---

## 3. Side Effects of Full USDC Recovery

### 3.1 Sequential + Slow by Design

**File:** `backend/src/services/demo-e2e.service.ts` — `recycleTokens()` (lines 705–918)

The recovery is fully sequential across 10 buyer wallets. For each wallet, the sequence is:
1. `provider.getBalance()` (RPC call)
2. Optional gas top-up transaction + `await tx.wait()`
3. `vault.lockedBalances()` + `vault.balanceOf()` (2 RPC calls)
4. Optional `vault.withdraw()` + `await tx.wait()`
5. `usdc.balanceOf()` (RPC call)
6. `usdc.transfer()` + `await tx.wait()`

With 3 retry attempts per wallet and 1500ms back-off between retries, worst case per wallet is ~20–30 seconds. For 10 buyers + 1 seller + 1 deployer vault withdrawal + final sweep of all 11 wallets, total worst-case runtime approaches **5–10 minutes**.

### 3.2 isRecycling Flag and the Render Sleep Problem

`isRecycling = true` is set at line 710. It is cleared to `false` in the `finally` block at line 915. However, this is **in-process module-level state**. If Render's free-tier server sleeps or restarts during this window:

- The flag resets to `false` on restart
- Any pending `tx.wait()` calls are abandoned — the transactions may or may not have been mined
- The next `GET /full-e2e/status` call sees `recycling: false` even though funds may be partially recovered
- The frontend shows "results ready" prematurely
- A new demo run can be started even though the vault may be in an inconsistent state (some locked balances not yet refunded)

### 3.3 Gas Top-Up Race Condition

`recycleTokens()` sends a gas top-up ETH transaction from the deployer signer (line 643) and then immediately calls `usdc.transfer()` from the wallet signer in the same loop iteration. These transactions come from **different signers** (deployer for the gas top-up, buyer wallet for the USDC transfer). If the gas top-up has not been mined yet when `usdc.transfer()` is attempted, the buyer wallet still has `< 0.0005 ETH` and the transfer will fail with `insufficient funds for gas`.

The check `await gasTx.wait()` at line 647 should prevent this — but `gasTx.wait()` polls the RPC. On Base Sepolia under load, this can take 5–30 seconds. Meanwhile the deployer's own nonce has advanced, potentially causing subsequent deployer transactions to queue behind the gas top-up with higher-than-expected nonces.

### 3.4 Nonce Contention Between Main Demo and Recycle

`runFullDemo()` spawns `startLeadDrip()` (background loop) and runs vault cycles, all using the **same deployer signer** obtained via `getSigner()` at line 246. `recycleTokens()` also calls `getSigner()` independently. Both paths create `new ethers.JsonRpcProvider(RPC_URL)` and `new ethers.Wallet(DEPLOYER_KEY, provider)` — separate provider instances with no shared nonce tracking. If `startLeadDrip`'s gas top-up for a newly injected lead and `recycleTokens`' gas top-up for a buyer wallet fire from the same deployer key within the same block, a nonce collision produces `replacement transaction underpriced` or `nonce too low` errors.

---

## 4. Partial On-Chain vs Frontend State Mismatch

### 4.1 isRunning vs isRecycling — Frontend Cannot Distinguish

**File:** `backend/src/routes/demo-panel.routes.ts` — `GET /full-e2e/status` (lines 1705–1721)

The status endpoint returns both `running` and `recycling` booleans. The `emitStatus()` helper also broadcasts `demo:status` over the socket. However:

- The frontend `useDemoStatus` hook polls this endpoint on mount and receives socket events
- If the socket is disconnected (§1.1), the frontend never receives the `demo:status` update
- The HTTP poll runs on a fixed interval — if the interval fires *before* `recycleTokens()` sets `isRecycling = true`, the frontend sees `{ running: false, recycling: false }` and transitions to "demo complete, results ready" even though recycling hasn't started yet

### 4.2 Demo Results Available While Recycling

**File:** `backend/src/routes/demo-panel.routes.ts` — `GET /full-e2e/results/latest` (lines 1654–1678)

The endpoint returns a `202 finalizing` response while `isRecycling === true`. However, because `recycleTokens()` is `void`-launched (non-blocking relative to the `runFullDemo` return), there is a race: `runFullDemo` returns and `saveResultsToDB()` has already run (marking `status: 'completed'`), but `isRecycling` may not yet be `true` (it's set inside `recycleTokens()` which starts asynchronously). A frontend poll hitting `/results/latest` immediately after `demo:complete` fires can get a full `200 completed` result before recycling has even begun.

### 4.3 Leads in Marketplace vs No Log Events

On-chain activity (lead injection via `injectOneLead()`) calls `io.emit('marketplace:lead:new', ...)` directly (line 595). This event goes through the Socket.IO server's `io.emit()` and **does** reach all connected clients — including the `marketplace:lead:new` listener in the marketplace page. This is why leads appear in the marketplace even though `DevLogPanel` shows nothing.

The `demo:log` events use the same `io.emit()` mechanism (line 383 in `emit()` helper), so the transport layer is identical. The difference is purely which component is listening: the marketplace page's hook is mounted and connected, while `DevLogPanel` may have lost its listeners due to the persona-switch disconnect (§1.1).

---

## Root Causes Summary Table

| # | Symptom | Root Cause | File(s) | Severity |
|---|---------|-----------|---------|----------|
| RC-1 | Dev Log shows no events after persona switch | `socketClient.disconnect()` in `DemoPanel.tsx` nullifies socket, DevLogPanel never re-subscribes | `DemoPanel.tsx:266,291,327`, `socket.ts:disconnect()` | 🔴 Critical |
| RC-2 | WebSocket error noise in console | Vercel does not support native WebSocket upgrade; socket.io falls back to polling | `socket.ts:81`, Vercel infra | 🟡 Low (functional fallback) |
| RC-3 | Dev Log misses early events (cold start) | `DevLogPanel` must be mounted *before* demo starts — events are not buffered | `DevLogPanel.tsx:useEffect` | 🟠 Medium |
| RC-4 | "Stop Demo" gives "Not running" during recycle | `stopDemo()` checks `isRunning` which is `false` during recycle phase | `demo-e2e.service.ts:1557-1568` | 🔴 Critical |
| RC-5 | Stop button frozen/unresponsive in UI | Socket disconnect (RC-1) means `demo:status` events never update button state | `useDemoStatus`, `demo:status` event | 🔴 Cascading from RC-1 |
| RC-6 | Funds not fully returning to deployer | Nonce contention between `startLeadDrip` gas top-ups and `recycleTokens` gas top-ups from same deployer key | `demo-e2e.service.ts:643,831` | 🟠 Medium |
| RC-7 | `recycleTokens` silently fails on server restart | `isRecycling` is in-process memory; Render free-tier restarts reset it | `demo-e2e.service.ts:710,915` | 🟠 Medium |
| RC-8 | Result displayed before recycle finishes | `void recycleTokens()` is non-blocking; `results/latest` returns 200 during race window | `demo-panel.routes.ts:1654-1678` | 🟡 Low |
| RC-9 | Private keys hardcoded in service file | `DEMO_SELLER_KEY` at line 50, `BUYER_KEYS` at lines 944-952 | `demo-e2e.service.ts:50,944-952` | 🔴 Security (testnet only — benign for hackathon, must fix before mainnet) |

---

## Impact on Hackathon Judge Experience

1. **Dev Log panel appears completely broken** — a judge opening the panel during or after the demo sees "Waiting for Chainlink service events…" and the empty state forever, unless they happen to open it *before* switching persona and *before* the demo starts.

2. **Stop Demo button does nothing** — gives silent failure during the recycle phase (which lasts 5–10 minutes). A judge who accidentally starts the demo cannot easily stop it.

3. **Inconsistent results timing** — the results page occasionally shows "finalizing" indefinitely if the server restarts mid-recycle, or flashes `completed` 1–2 seconds after demo:complete before recycling has properly concluded.

4. **Console noise** — multiple WebSocket closed errors and Permissions-Policy warnings (not blocking, but visually unprofessional during a screenshare or video recording).

5. **USDC leakage** — if recycle partially fails, subsequent demo runs start with less-than-expected vault balance, causing on-chain transactions to fail mid-cycle with insufficient funds errors, which surface as error-level `demo:log` events if the panel is working, or silent failures if it is not.

---

## Open Questions / Clarifications Needed

1. **When is the Stop Demo button rendered?** It does not appear in `DemoPanel.tsx` — which component renders it and how does it hook into `demoE2E.stopDemo()`? Is it in `DemoResults.tsx` or a dedicated status banner?

2. **Is `VITE_DEMO_MODE` set to `'true'` on Vercel?** `DevLogPanel` auto-opens only when `import.meta.env.VITE_DEMO_MODE === 'true'`. If it starts collapsed and the judge doesn't know `Ctrl+Shift+L`, they'll never see the log even when it works correctly.

3. **Is `VITE_SOCKET_URL` pointing to the Render backend** on the deployed Vercel frontend? The socket will silently fail to connect (not even fallback to polling) if this env var is missing or points to `localhost`.

4. **Does the Render backend stay awake during the demo?** If on the free tier, the first request after 15 minutes of inactivity triggers a ~30s cold start. If the judge hits "Run Demo" during a cold start, the socket connection may succeed but `runFullDemo()` may fail as the DB connection pool (Prisma) also needs to warm up.

5. **Was the full USDC recovery ever observed to complete successfully** (all 10 buyers + seller drained) in a single run, or has it always hit partial failure? This matters for determining whether RC-6 is intermittent or deterministic.

6. **Which scenario happened most recently** — did the demo stop mid-cycle (isRunning stuck), or did it complete cycles but recycleTokens is still running (isRecycling)?

---

## High-Level Recommended Stabilization Path

*This section describes the phased approach in plain terms. No code snippets — implementation details to be decided in the next planning session.*

### Phase A — Fix Socket Reconnect Blindspot (Highest Priority)

- When the frontend socket reconnects after a disconnect (persona switch, admin login, or Vercel→Render network blip), `DevLogPanel` must automatically re-register its event handlers on the newly created socket instance, not just the handlers it registered at mount time.
- Alternatively, prevent `DemoPanel` from calling `disconnect()` when switching personas — instead refresh the JWT in-place so the existing socket instance is reused.

### Phase B — Improve Stop Demo UX

- The "Stop Demo" endpoint should also set `isRecycling = false` and abort the recycle co-routine — and broadcast a `demo:status` event with `{ running: false, recycling: false, phase: 'stopped' }` so all viewers see the updated state immediately.
- The frontend button should display a clearly different state for "stopping recycle" vs "stopping demo cycles" so the judge understands what's happening.

### Phase C — Harden recycleTokens Against Server Restarts

- Move `isRecycling` state to the database (`DemoRun.status = RECYCLING`) so a server restart can query the DB to determine if a recycle was in progress and either resume or mark it as interrupted.
- Add a top-level timeout to the recycle loop (e.g., 8 minutes) that hard-stops and logs remaining balances rather than hanging indefinitely.

### Phase D — Resolve Nonce Contention

- Use a single shared deployer signer with an async nonce queue (or sequentially lock deployer transactions using a promise chain) so `startLeadDrip` gas top-ups and `recycleTokens` gas top-ups never race.
- Alternatively, fund all demo buyer wallets with a fixed ETH reserve at the *start* of the demo, eliminating mid-flow gas top-ups entirely.

### Phase E — Move Private Keys Out of Source Code

- All `BUYER_KEYS` and `DEMO_SELLER_KEY` values must come from environment variables (Render secrets) before any mainnet deployment. For hackathon purposes this is acceptable on testnet — flag for post-hackathon cleanup.

### Phase F — Buffer or Replay Recent Log Events

- Add a small server-side ring buffer (last 50 `demo:log` entries) accessible via a REST endpoint. When `DevLogPanel` mounts, it fetches these 50 entries first and renders them, then switches to real-time socket events. This eliminates the "missed events during mount gap" problem entirely.

---

*Generated by engineering investigation — 2026-02-19. All line numbers reference the codebase as of commit `515e750`.*
