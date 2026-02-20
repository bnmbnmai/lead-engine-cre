# Lead Engine CRE — Demo Deep Dive Analysis
**Date:** 2026-02-19  
**Commit:** `ec6173e` (main)  
**Branch:** `main` — Render (backend) + Vercel (frontend) auto-deploy  
**Status:** Investigation-only — no code changes proposed in this document

---

## Executive Summary

The Lead Engine CRE demo suffers from five interconnected problems that collectively degrade the judge experience. The most impactful are structural: the sealed-bid auction cycle uses **one buyer wallet locking three bids against itself**, so there is no competitive bidding at all, and the total USD settled per run is mathematically bounded to `$7–$21` for 5 cycles (bid amounts $3–$10). The Chainlink Services Dev Log is silent for Guest persona viewers because (a) the panel's visibility gate (`isDemo`) depends on the `VITE_DEMO_MODE` env var which may not be set on Vercel, and (b) the Guest persona switch path calls `socketClient.disconnect()` without reconnecting, severing the WebSocket entirely. Additional compounding issues include ACE KYC triggering a real on-chain transaction on every Buyer persona switch (introducing a 5–30s delay and potential failure), cross-cutting state races from the new Prisma `DemoRun` model under concurrent viewers, and a results page that is only robustly reachable from the same session that ran the demo.

Together these make the demo feel quiet, sparse, and internally inconsistent — but all are fixable with targeted changes. The root causes are documented precisely below to enable surgical, low-risk implementation.

---

## 1. Dev Log Streaming Failure in Guest Persona

### Observed symptom
Guest persona viewers see "Waiting for Chainlink service events…" indefinitely. Console shows WebSocket connection failures. Switching to "Buyer" persona makes logs appear.

### Root Cause A — `isDemo` visibility gate (frontend `DevLogPanel.tsx:133`)

```typescript
const isDemo = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true';
// ...
if (!isDemo) return null;   // Line 229 — entire panel returns null
```

On Vercel, `import.meta.env.DEV` is `false` (it is always `false` in production builds). If `VITE_DEMO_MODE` is not explicitly set in Vercel environment variables, `isDemo` evaluates to `false` and the entire `DevLogPanel` component **returns null and never mounts**. The socket listener at line 145 (`socketClient.connect()`) is never called, so no events are ever received, regardless of the broadcast behavior of the backend.

**Files:** `frontend/src/components/demo/DevLogPanel.tsx:133,229`  
**Env dependency:** `VITE_DEMO_MODE` must be set to `"true"` in the Vercel project settings

### Root Cause B — Guest persona switch disconnects and never reconnects (frontend `DemoPanel.tsx:285–287`)

```typescript
} else if (persona === 'guest') {
    setAuthToken(null);
    localStorage.removeItem('le_auth_user');
    socketClient.disconnect();   // ← socket torn down here
    // ← socketClient.connect() is NEVER called
    if (import.meta.env.DEV) console.log('[DemoPanel] Guest persona — cleared auth');
}
```

When a judge clicks "Switch to Guest" in the Demo Control Panel, the socket is explicitly disconnected and never reconnected. The backend's `RTBSocketServer.setupMiddleware()` allows unauthenticated connections (`role: 'GUEST'`) and serves all broadcasts to them. But the client-side `SocketClient` singleton (`frontend/src/lib/socket.ts:73–74`) will return early on any subsequent `connect()` call only if the socket object already exists. Since `disconnect()` sets `this.socket = null` (line 141), the next call to `connect()` from `DevLogPanel.useEffect` *should* create a new connection — **but** `DevLogPanel` only calls `socketClient.connect()` once, at mount time (line 145 inside a `useEffect([], [])` that was already executed). With `isDemo = false` on Vercel the panel never mounts, so this is moot in production. In development, reconnection works if `DevLogPanel` is still mounted because the socket ref was nulled first, but any race between mount and persona-switch can leave it silent.

**Files:** `frontend/src/components/demo/DemoPanel.tsx:282–287`

### Root Cause C — `aceDevBus` event chain requires a connected socket

The backend emits `ace:dev-log` via `aceDevBus.emit('ace:dev-log', ...)` in `ace.service.ts:12` and `demo-e2e.service.ts:385–393`. The `RTBSocketServer` constructor wires `aceDevBus.on('ace:dev-log', entry => this.io.emit('ace:dev-log', entry))` at line 130–132 of `backend/src/rtb/socket.ts`. This is an `io.emit()` (broadcast to all) — **not** room-scoped. So backend-side emission is correct. The problem is entirely on the frontend receive path (Root Causes A and B above).

### Root Cause D — WebSocket transport vs. Vercel/Render proxy

`frontend/src/lib/socket.ts:81` configures `transports: ['websocket', 'polling']`. Render's free and hobby tiers support WebSocket connections. However, Render's 30-second idle timeout can cause silent disconnects during the gap between `demo:status` polling (on mount) and the first `demo:log` event. If the socket reconnection race (5 attempts × 1s delay = up to 5s reconnect) coincides with a burst of early `demo:log` events (first 3 leads injected in rapid 300ms bursts), those events are emitted to all connected sockets but the Guest client hasn't yet reconnected. Those events are **lost** — Socket.IO does not buffer missed broadcasts to reconnecting clients.

**Files:** `frontend/src/lib/socket.ts:81–84`, `backend/src/rtb/socket.ts:130–132`

---

## 2. Persona Switching & ACE KYC Interference

### Observed symptom
Switching persona to "Buyer" in Demo Control Panel makes Dev Log appear, but also triggers ACE KYC/compliance flows visibly in the log, which are confusing to judges and add 5–30 seconds of latency.

### Root Cause A — demo-login triggers real on-chain KYC for every Buyer switch

`demo-panel.routes.ts:136–166` calls `aceService.autoKYC(walletAddress)` synchronously in the `/api/v1/demo-panel/demo-login` handler, which calls `this.contract.verifyKYC(walletAddress, kycProofHash, '0x')` on-chain (Base Sepolia). This is a write transaction that:

1. Requires the deployer wallet to have ETH for gas
2. Takes 5–30 seconds to confirm on Base Sepolia
3. Logs `verifyKYC:call` and `verifyKYC:result` entries to `aceDevBus` which are forwarded to the Dev Log panel

Even though the demo-login code wraps this in `try/catch` and only logs a warning on failure, the *success* path adds a blocking on-chain tx to the demo-login response time. The DB fallback (`complianceCheck.create`) is only invoked if `autoKYC` throws, not as an early-exit optimization for already-verified wallets.

**Files:** `backend/src/routes/demo-panel.routes.ts:136–166`, `backend/src/services/ace.service.ts:357–407`

### Root Cause B — canTransact retry adds 3-second sleep

In `ace.service.ts:175–189`, if `canTransact()` returns `false` on the first call, the service calls `setVerticalPolicyIfNeeded()` and then sleeps 3 seconds before retrying. During the demo cycle, every `bid:place` socket event calls `aceService.canTransact()` (line 278–286 in `socket.ts`). If the vertical policy is not yet on-chain for any demo vertical (e.g., `legal`, `financial_services`, `hvac`), this adds a 3s + tx latency to every bid placement for that vertical.

**Files:** `backend/src/services/ace.service.ts:175–202`, `backend/src/rtb/socket.ts:278–287`

### Root Cause C — Guest disconnect causes socket room state inconsistency

When `handlePersonaSwitch('guest')` calls `socketClient.disconnect()` (DemoPanel.tsx:285), any in-progress auction room subscriptions are torn down. If the judge was in an auction room (`auction_${leadId}`), the server still has their socket in the room via `socket.join(roomId)` — but the socket is now disconnected. The `RTBSocketServer`'s disconnect handler (socket.ts:457) only logs, it doesn't clean up auction room membership. This is a non-critical memory leak on the server for demo duration, but it means `this.io.to(roomId).emit()` calls fan to a stale socket entry, adding tiny overhead.

**Files:** `frontend/src/components/demo/DemoPanel.tsx:282–287`, `backend/src/rtb/socket.ts:457–459`

### Root Cause D — Persona state is managed in `localStorage`, not in React state

`handlePersonaSwitch` writes to `localStorage` and dispatches a synthetic `StorageEvent`. `useAuth` reads from `localStorage`. Every component that depends on `useAuth` will correctly re-render. However, the `SocketClient` singleton retains the **old JWT** in its connection auth until `disconnect()` + `connect()` is called. If `connect()` is called before `localStorage` is updated (race), the new token is not picked up. In the Buyer path (lines 263–267), `setAuthToken` and `disconnect()` happen synchronously before `connect()`, so this race is unlikely. In the Guest path, the socket is torn down but not reconnected — meaning the next component that calls `socketClient.connect()` will pick up `getAuthToken()` which now returns `null` (correct for Guest), creating a GUEST-role connection.

**Files:** `frontend/src/components/demo/DemoPanel.tsx:248–303`, `frontend/src/lib/socket.ts:77–85`

---

## 3. Low Auction Activity & Sparse Bidding

### Observed symptom
Only 1 auction cycle completes reliably (previously configured for 5). Total settled is $7–$21 per run. Auctions look sparse — few bids, small numbers.

### Root Cause A — Critical: the demo locks 3 bids from ONE buyer against itself (not competitors)

This is the fundamental structural issue. In `demo-e2e.service.ts:1070–1116`:

```typescript
const buyerWallet = DEMO_BUYER_WALLETS[(cycle - 1) % DEMO_BUYER_WALLETS.length];
// ...
for (let b = 0; b < 3; b++) {
    vault.lockForBid(buyerWallet, bidAmountUnits)   // same wallet, 3x
}
// Then:
vault.settleBid(lockIds[0], DEMO_SELLER_WALLET)    // winner = lock[0]
vault.refundBid(lockIds[1])                         // refund lock[1] back to SAME buyer
vault.refundBid(lockIds[2])                         // refund lock[2] back to SAME buyer
```

**All 3 locks come from the same buyer wallet**. There is no competitive bidding. The `marketplace:bid:update` event increments bid count 3 times for 1 lead, but it's a single buyer simulating competition with themselves. `totalSettled` only increments by `bidAmount` once per cycle (line 1147), so for 5 cycles at $3–$10/bid: **total settled = $15–$50**, but in practice the $3–$10 range with a random `rand(3,10)` averages to ~$6.50, so 5 cycles ≈ $32.50 expected. The observed $7–$21 range suggests cycles are **aborting early** (see Root Cause B).

**Files:** `backend/src/services/demo-e2e.service.ts:947–972, 1070–1116`

### Root Cause B — Buyer vault depletion causes cycles to skip, not the on-chain execution

The pre-cycle vault check at lines 957–971:

```typescript
const maxPerBid = Math.floor(availableUsdc / 3);  // divide by 3 bids per cycle
if (maxPerBid < 1) {
    emit(io, { level: 'warn', message: `⚠️ Buyer ... vault too low ($... available). Skipping cycle` });
    continue;   // ← SKIPS the entire cycle
}
```

Each cycle depletes the rotating buyer's vault by `3 × bidAmount` (3 locks). After a `settle`, winners' funds go to the seller. The seller's received USDC is **not returned to the buyer within the same run** — recycling happens post-completion in the background. So after cycle 1 empties buyer[0] by ~$30 (if bids were $10), cycle 11 (which re-uses buyer[0]) would skip. But more critically: if the previous run's **recycle didn't complete** (Render free-tier idle kill, or recycle error), buyer vaults start the next run depleted. The next run then skips most cycles immediately due to the `maxPerBid < 1` guard at line 961.

The "only 1 cycle completes" pattern likely means buyer[0] had ~$5 of residual vault balance from a partially-recycled previous run, enough for 1 cycle at `bidAmount = 1` (the minimum from `maxPerBid < 1` guard), but then buyer[1], buyer[2], etc. are also depleted because the recycle is per-buyer-wallet sequentially (lines 718–755) and each vault withdraw is an independent tx that can fail silently.

**Files:** `backend/src/services/demo-e2e.service.ts:953–972`, `backend/src/services/demo-e2e.service.ts:718–755`

### Root Cause C — Bid amounts ($3–$10) are too small to look impressive

`rand(3, 10)` at line 954. Even in a perfect run, the results page shows:
- 5 cycles × avg $6.50 = **$32.50 total settled**
- Display: "Total Settled: $32.50" — not judge-delighting

The reserve price for cycle leads is also set to `bidAmount` (line 1010: `reservePrice: bidAmount`), so it's $3–$10. Marketplace cards show a `$3` reserve price which looks like a toy market.

**Files:** `backend/src/services/demo-e2e.service.ts:954, 1010`

### Root Cause D — Lead drip creates leads with no bidders for most of them

`startLeadDrip` at line 944 creates `cycles + 15` leads (e.g., 20 leads for a 5-cycle run) over 5 minutes. These marketplace leads have no automated buyers — they're `IN_AUCTION` and expire via the auction monitor (`resolveExpiredAuctions` at socket.ts:471) after `LEAD_AUCTION_DURATION_SECS = 60s`. A judge watching the marketplace sees 20 leads appear, zero bids on most of them, and they expire within 60 seconds. This makes the market appear dead. Only the 5 leads explicitly used in the main auction cycle get the 3 fake bid-count updates.

**Files:** `backend/src/services/demo-e2e.service.ts:944`, `backend/src/config/perks.env.ts:78`

### Root Cause E — Single deployer signer creates nonce contention under load

All on-chain transactions — lockForBid (×3), settleBid (×1), refundBid (×2), verifyReserves (×1) — are signed by the deployer wallet via the deployer's `ethers.Wallet`. These are sequential (awaited one by one), so nonce is managed correctly. However, if `sendTx`'s 3-attempt retry sends a tx with a nonce that the deployer wallet also used for an ACE `setVerticalPolicyIfNeeded` call (from a concurrent `canTransact` chain on the socket layer), nonce collisions may cause one of those txs to fail. The deployer wallet is shared between `demo-e2e.service.ts` and `ace.service.ts` — both instantiate `new ethers.Wallet(DEPLOYER_KEY, provider)` independently, with no nonce coordination.

**Files:** `backend/src/services/demo-e2e.service.ts:244–246`, `backend/src/services/ace.service.ts:63–65`

---

## 4. Multi-Viewer Concurrency & Global Demo State Implications

### Observed symptom
Multiple judge viewers should see the same state. The global `demo:status` broadcast (from the recent implementation) theoretically covers this. Questions remain about state tears during page reload, cold boot on Render, and multiple simultaneous users.

### Root Cause A — `isRunning` / `isRecycling` are process-level in-memory singletons, not persisted

`demo-e2e.service.ts:135–137`:
```typescript
let isRunning = false;
let isRecycling = false;
```

These are module-level variables in the Node.js process. They survive the run but reset on **Render process restart** (Render free tier idles after 15 minutes of no HTTP traffic and cold-starts). If Render restarts mid-demo, `isRunning` resets to `false`, and the next `runFullDemo` call will start a second run even though on-chain state from the first run is still pending. Since the `DemoRun` table (Prisma persistence) is now the authoritative source, the `isRunning` flag should be seeded from DB on boot — but `initResultsStore()` only reads `DemoRun` status, it does not set `isRunning` to `true` if the latest run has status `RUNNING`.

**Files:** `backend/src/services/demo-e2e.service.ts:135–137, 231–233`

### Root Cause B — `useDemoStatus` HTTP poll hydrates `isRunning` but not `isRecycling`

`frontend/src/hooks/useDemoStatus.ts` polls `api.demoFullE2EStatus()` on mount. The `/full-e2e/status` endpoint likely returns `{ running: boolean, recycling: boolean }`. But if Render was mid-recycle when it restarted, `isRecycling` in-memory is `false` after cold start even though the recycle was incomplete. The frontend would show the "Run Demo" button as enabled, but the first button press would fail because wallet balances are depleted mid-recycle.

**Files:** `frontend/src/hooks/useDemoStatus.ts`, `backend/src/routes/demo-panel.routes.ts` (status endpoint)

### Root Cause C — `demo:status` broadcast fires at 4 lifecycle points but not per-cycle

The recent implementation adds `emitStatus()` at: start, success-complete, abort-complete, finally. However, `currentCycle` and `percent` in the per-cycle status are only emitted if explicitly called inside the cycle loop. Reviewing `demo-e2e.service.ts:814–816` (start call) — the start emitStatus correctly sets `running: true, totalCycles`. But no per-cycle `emitStatus` call was added between start and complete. Viewers who open the page mid-demo see "Demo Running…" (from the start broadcast, potentially missed if they connected later) but no cycle progress — the `useDemoStatus` HTTP poll returns `running: true` but `currentCycle: 0`.

> Note: The implementation plan mentioned adding per-cycle progress updates — review whether those were actually included in the final commit.

**Files:** `backend/src/services/demo-e2e.service.ts:814–816, 947–1233`

### Root Cause D — Socket reconnection drops missed broadcasts; no replay buffer

Socket.IO's default configuration does not buffer missed events for reconnecting clients. A judge who refreshes the page mid-demo will:
1. Get `running: true` from the HTTP poll in `useDemoStatus` (correct)
2. Miss all `demo:log` entries that fired before their socket connected
3. See "Demo Running…" with no log entries in the Dev Log

This is expected Socket.IO behavior, but it means the dev log feels empty for late-joining viewers.

**Files:** `backend/src/rtb/socket.ts:114–123`, Socket.IO configuration

### Root Cause E — No protection against 10+ simultaneous judges hitting Run Demo concurrently

The singleton lock at `demo-e2e.service.ts:784–789` (if `isRunning` → throw 409) prevents double-starts from the backend. The frontend `DemoButtonBanner` uses `useDemoStatus` to disable the button globally. However, if 10+ judges with the Guest persona open the page simultaneously and hit the button before the first `demo:status` broadcast arrives (network latency ~100ms), there is a window where the button appears enabled for all of them. The button is only disabled reactively after receiving the socket broadcast.

**Files:** `frontend/src/pages/HomePage.tsx` (DemoButtonBanner), `backend/src/services/demo-e2e.service.ts:784`

---

## 5. Results Page Visibility & CORS Status

### Observed symptom
`/demo/results` now loads successfully showing "Latest Demo Run", PoR SOLVENT, tx links, and summary metrics. CORS issues were resolved in a previous session.

### Current state (resolved)
- The `Access-Control-Allow-Origin: true` setting in `RTBSocketServer` (`socket.ts:117–118`) matches the permissive CORS in `index.ts`.
- The `DemoRun` Prisma model provides persistent results visible across all viewers.
- DB → in-memory → disk fallback chain is correctly implemented.

### Remaining gap — Results page requires auth or is publicly accessible?

`/demo/results` is a frontend route. The API endpoint it calls (`GET /api/v1/demo-panel/full-e2e/results`) is gated by `devOnly` middleware which only blocks when `DEMO_MODE === 'false'`. So any viewer who knows the URL can access results, regardless of persona. This is the desired behavior for a hackathon demo — **no action needed**, but it should be confirmed that `DEMO_MODE` is not set to `'false'` in Render's environment variables.

**Files:** `backend/src/routes/demo-panel.routes.ts:27–43`

### Minor gap — Cold-boot results page 503 during Render wake-up

The results page makes a blocking HTTP call to fetch results on mount. If Render is cold-starting (15-minute idle spin-down on free tier), this call may timeout. The previous fix added a retry budget (5 attempts, 15s window) which should handle this. But there is no user-visible loading state for the case where all 5 retries fail — the page would show an empty list.

---

## 6. Judge Experience & "Wow" Factor Gaps

### Gap A — Demo looks like 1 buyer bidding on themselves (no competitive feel)

The 3 lock-per-cycle structure creates `bid count: 3` on marketplace cards, but it's one wallet. During the cycle, the marketplace card shows `3 bids — $X.XX highest`. If a judge is watching the marketplace in real-time, they see bids appear in rapid succession from what is technically the same wallet. Without wallet pseudonymity in the marketplace card display, this is not visible — but the log makes it obvious: all `lockForBid` calls reference the same buyer address.

### Gap B — $3–$10 bid amounts feel like a toy market

For hackathon judging of a B2C lead marketplace, judges expect to see real commercial value. CRE (commercial real estate) leads are worth thousands of dollars in reality. The current `rand(3, 10)` with `reservePrice = bidAmount` means the marketplace shows "$3" reserve prices next to sophisticated Chainlink integrations.

### Gap C — Lead drip creates 20 leads with 0 bids that all expire silently

The background drip creates `cycles + 15 = 20` leads. With `LEAD_AUCTION_DURATION_SECS = 60s`, all 20 expire within 1 minute. The auction monitor calls `resolveExpiredAuctions` every 2 seconds. Any judge watching the marketplace sees leads flash in and immediately disappear (status changes to `EXPIRED`/`UNSOLD`). There is no buyer activity on these dripped leads.

### Gap D — Token recycling block (~30s) creates dead time

After the demo completes, the "Recycling…" state in `DemoButtonBanner` blocks for ~30s while the background recycle runs. During this time, there is nothing happening publicly visible. The Dev Log shows recycling progress, but judges watching the homepage see only a spinner. No celebration, no summary, no redirect prompt until the Dev Log's "Demo Complete!" banner appears.

### Gap E — Results page is not surfaced in the main demo flow

When the demo completes, the backend emits `demo:complete` (socket) and `emitStatus(running: false)`. The `DevLogPanel` shows a "View Summary →" button linking to `/demo/results`. But:
- Guests don't see the Dev Log (Root Cause A of section 1)
- No toast, redirect, or visible homepage CTA appears for any persona
- Judges must know to open Ctrl+Shift+L and click the button

### Gap F — Only 1 cycle reliably completing means PoR only runs once

The PoR `verifyReserves()` call only occurs at the end of each cycle. If only cycle 1 completes, the results page shows 1 PoR check. The demo's core value proposition — "every settlement is validated by Chainlink PoR" — is only demonstrated once.

---

## Root Causes Summary Table

| # | Issue | Root Cause | File(s) | Severity |
|---|-------|-----------|---------|----------|
| 1a | Dev Log invisible on Vercel | `VITE_DEMO_MODE` not set in Vercel env → `isDemo = false` | `DevLogPanel.tsx:133` | 🔴 Critical |
| 1b | Dev Log silent after Guest switch | `socketClient.disconnect()` without reconnect | `DemoPanel.tsx:285` | 🔴 Critical |
| 1c | Dev Log misses early events | Socket.IO no buffer for reconnecting clients | `socket.ts:81` | 🟡 Medium |
| 2a | Buyer switch slow (5–30s) | On-chain `verifyKYC()` in demo-login handler | `demo-panel.routes.ts:140` | 🟠 High |
| 2b | canTransact adds 3s retry | ACE `setVerticalPolicyIfNeeded` + sleep | `ace.service.ts:175–189` | 🟡 Medium |
| 2c | Nonce contention | Deployer shared between demo and ACE | `demo-e2e.service.ts:244`, `ace.service.ts:64` | 🟠 High |
| 3a | No competitive bids | 3 locks from same buyer wallet | `demo-e2e.service.ts:1085–1091` | 🔴 Critical |
| 3b | Cycles skip (vault depleted) | Previous run's recycle incomplete → zero balance | `demo-e2e.service.ts:961` | 🔴 Critical |
| 3c | $3–$10 totals unimpressive | `rand(3, 10)` bid amount | `demo-e2e.service.ts:954` | 🟠 High |
| 3d | Lead drip: 0 bids on 20 leads | No automated buyers on dripped leads | `demo-e2e.service.ts:944` | 🟡 Medium |
| 4a | `isRunning` lost on cold start | In-memory flag not seeded from DB | `demo-e2e.service.ts:135` | 🟠 High |
| 4b | Per-cycle progress missing | No emitStatus() in cycle loop | `demo-e2e.service.ts:947–1233` | 🟡 Medium |
| 5a | Results not surfaced to guests | No post-demo CTA for non-Dev-Log viewers | `HomePage.tsx`, `DevLogPanel.tsx` | 🟡 Medium |
| 6a | Judge "wow" factor: toy amounts | Small bid amounts + single buyer | Multiple | 🔴 Critical |

---

## Cross-Cutting Considerations

### Scalability for Hackathon Judging (10–50 simultaneous viewers)

- All socket broadcasts are `io.emit()` (all connected clients) — scales well regardless of viewer count.
- The `RTBSocketServer` auction monitor runs every 2 seconds and makes Prisma calls — with 20 `IN_AUCTION` leads from the drip all expiring simultaneously, this creates a burst of 20 Prisma updates at `t + 60s`. On Render's free tier with a shared Postgres, this could cause a slow query cascade visible as UI lag.
- The results page's 5-retry HTTP poll means 50 judges × 5 retries = up to 250 HTTP requests to the results endpoint in a short window after demo completion. The `initResultsStore()` populates from DB once; subsequent calls use the in-memory `resultsStore.get()` (O(1)), so this is not a bottleneck.

### Hackathon Judging Criteria Alignment

- **Chainlink Integration depth**: ACE `canTransact` logs are the richest Chainlink signal in the Dev Log (amber color, ACE badge), but they're invisible to Guest judges (Root Cause 1a). Only Buyer persona viewers see the full Chainlink service matrix.
- **On-chain verifiability**: Every settlement and PoR check has a Basescan link. But with only 1 cycle completing, there's only 1 tx link to show.
- **Real-time UX**: The marketplace does update in real-time (leads appear, bid counts tick), but the lack of real competitive bidding makes the market look dead.
- **Demo robustness**: The vault-depletion-causes-skip pattern means the demo degrades progressively across consecutive judging sessions without operator intervention.

---

## Open Questions / Clarifications Needed

1. **Is `VITE_DEMO_MODE=true` set in Vercel project settings?** If not, `DevLogPanel` returns null for all viewers, making this the single most impactful open question.
2. **What is the intended number of demo cycles?** The default `cycles = 5` produces $7–$50 settled. Is there a target minimum (e.g., "at least $200 settled per run") to guide the right bid amount range?
3. **Should competitive bidding come from multiple different buyer wallets, or is a richer single-buyer simulation acceptable?** Using 3 different buyer wallets per cycle would show genuine competition but requires 3× more USDC prefunding per cycle.
4. **Is the deployer wallet consistently funded on Base Sepolia?** The nonce contention issue (Root Cause 2c) and the gas top-up logic for 10 buyer wallets all draw from the same deployer. If the deployer runs out of ETH, the entire demo freezes at the first `sendTx` attempt.
5. **Is Render's auto-sleep (free tier 15-min idle) acceptable, or is there a paid tier active?** This directly impacts the cold-boot guard and the in-memory `isRunning` reliability.
6. **Should the results page auto-navigate for all viewers when the demo completes?** Currently only the Dev Log "View Summary →" button provides this. A global post-demo CTA would require `useDemoStatus` to react to `running → false` and surface a modal or toast for all personas.
7. **Which persona are judges expected to use during live judging?** If Guest is the default (most restrictive, simplest onboarding), Root Cause 1a must be resolved first — it's blocking all streaming for the most common judge experience.

---

## High-Level Recommended Approach (Phased — No Code)

### Phase 1 — Unblock Guest streaming (highest judge impact)

- Set `VITE_DEMO_MODE=true` in Vercel project environment variables
- After Guest persona switch, trigger a socket reconnect so the Guest-mode connection is established
- These two changes alone should make the Dev Log visible and streaming for all viewers

### Phase 2 — Make the auction feel competitive

- Use multiple different buyer wallets per cycle (e.g., 3 distinct wallets from `DEMO_BUYER_WALLETS`) to lock bids so the lead genuinely has N unique bidders
- Increase bid amounts to a range that produces impressive results totals (consider $15–$35 per bid)
- Pre-fund buyers with a correspondingly larger amount, and/or validate the recycle completed before allowing a new run

### Phase 3 — Stabilize multi-cycle completion

- Verify vault balances for ALL buyer wallets as a pre-run preflight check before starting the run, not just per-cycle
- Add a mechanism to detect and recover from incomplete recycles (e.g., seed from DB recycle status, or always run a full recycle on demo start before prefunding)
- Seed `isRunning` from DB on server startup so Render cold-boots don't allow a second concurrent run

### Phase 4 — Improve judge "wow" factor and navigation

- After demo completion, push a visible post-demo summary CTA (toast or inline banner on HomePage) for all viewers regardless of persona, with a direct link to `/demo/results`
- Add per-cycle `emitStatus` calls so multi-viewer status bar shows real progress
- Consider extending `LEAD_AUCTION_DURATION_SECS` for dripped leads (e.g., 5 minutes) so the marketplace stays active longer with visible, unexpired leads

### Phase 5 — Long-term: ACE KYC optimization

- Cache the Buyer demo wallet's KYC status so subsequent demo-login calls skip the on-chain `verifyKYC` tx (check DB compliance cache first, only call on-chain if expired)
- Add vertical policy pre-seeding at server startup so `setVerticalPolicyIfNeeded` never triggers during a demo run
