# DEMO CURRENT STATUS ANALYSIS — 2026-02-19

**Investigation date:** 2026-02-19T16:24 MST  
**Latest commit at time of analysis:** `e5a19bb` (stabilization phase merged)  
**Environment:** Render (backend) + Vercel (frontend), Base Sepolia testnet  
**Status:** Investigation only — no code changes proposed herein

---

## Executive Summary

The demo environment is currently in a broken state across multiple independent failure axes, each of which compounds the others. The most visible symptom is the **Dev Log freezing after the initial banner** ("ONE-CLICK FULL ON-CHAIN DEMO") and the marketplace showing "No active leads" throughout the entire run. However, the underlying causes are deeper and interrelated.

At the root of the Dev Log freeze: the backend's pre-funding phase (Step 1 of `runFullDemo`) involves up to **40 sequential on-chain transactions** for 10 buyer wallets (gas top-up + USDC transfer + approve + deposit per wallet). This phase can take **5–15 minutes on Base Sepolia** under normal network load — and during this entire window, no `demo:log` events fire (the banner fires at the very start, then silence). The frontend's empty-state-poll detects no leads and fires an HTTP GET every 8 seconds, but since leads are only injected after pre-funding completes, the poll always returns zero. Compounding this: the ACE KYC `autoKYC` call during persona login also sends on-chain transactions **using the same deployer signer**, creating nonce contention that can cause pre-fund transactions to fail with `replacement transaction underpriced` — triggering silent partial failures and stranded vault states before a single auction cycle runs.

The combination of a slow pre-fund phase, nonce races, partial buyer preparation, and aggressive `shouldIncludeLead` filter logic in the marketplace frontend creates a demo that appears completely broken to any observer watching in real-time — regardless of whether Dev Log streaming is working.

---

## Section 1: Detailed Analysis of Dev Log Streaming Failure

### 1.1 The Pre-Fund Phase Silence Window

**File:** `backend/src/services/demo-e2e.service.ts` — `runFullDemo()`, lines 1080–1162

The demo run sequence after the banner emit (line 1052) is:

1. Check deployer vault/USDC balance (2 RPC reads) — emits one log line
2. **Step 1: Pre-fund all 10 buyers** — up to 40+ sequential on-chain transactions

Inside Step 1 (lines 1098–1156), for each of the 10 `DEMO_BUYER_WALLETS`:
- `vault.balanceOf(buyerAddr)` — RPC read
- `provider.getBalance(buyerAddr)` — RPC read  
- If ETH low: `signer.sendTransaction({ to: buyerAddr, value: 0.001 ETH })` + `await gasTx.wait()`
- `usdc.transfer(buyerAddr, 150_000000)` + `await transferTx.wait()`
- `buyerUsdc.approve(VAULT_ADDRESS, ...)` + `await approveTx.wait()`
- `buyerVault.deposit(preFundUnits)` + `await depositTx.wait()`

Each `await tx.wait()` on Base Sepolia typically takes **3–15 seconds** per transaction. In the worst case (all 10 buyers need funding, each needing a gas top-up):
- 10 buyers × 4 transactions × ~8 seconds average = **≈5 minutes before the first auction cycle starts**

During this entire window, the only `demo:log` events that fire are the per-buyer "✅ Buyer … funded & deposited" success lines and any "⚠️ Pre-fund failed" warnings. If a buyer already has sufficient vault balance it emits a "⏭️ skipping" line — but any buyer that was pre-funded in the previous run will have had their USDC recovered by `recycleTokens`, leaving them with `existingBal = 0n` and requiring full re-funding.

**Net effect:** From the judge's perspective, the banner fires and then the Dev Log goes completely silent for 5–15 minutes. This looks identical to a broken socket connection.

### 1.2 startLeadDrip Starts After Pre-Fund

**File:** `backend/src/services/demo-e2e.service.ts` — line 1166

```
const drip = startLeadDrip(io, signal, cycles + 15, 5);
```

`startLeadDrip` is called **only after** the entire pre-fund loop completes. Therefore:
- No leads appear in the marketplace until pre-funding is done
- The first 3 "seed" leads are injected immediately after drip starts, emitting `marketplace:lead:new` events
- But if the socket disconnected or the page navigated during the pre-fund silence window, those events are missed

### 1.3 Socket Transport Fallback Noise

**File:** `frontend/src/lib/socket.ts` — line 81

```
transports: ['websocket', 'polling'],
```

Vercel's edge network terminates WebSocket connections at the proxy layer before the socket.io handshake completes. The console shows:

> `WebSocket is closed before the connection is established`

Socket.IO then falls back to HTTP long-polling, which **does work** — but introduces ~1–3 second event latency per batch. During the Vercel→Render cross-origin long-poll, events are batched and delivered approximately every 25 seconds (the socket.io default polling interval). This means a log event emitted at T+0 on the backend may not appear in DevLogPanel until T+25 at worst.

Verified from Render backend logs: `demo:log` events ARE being emitted by the service with the correct data. The issue is the combination of: (a) events firing during the pre-fund silence window when there are fewer but still batch-delayed deliveries, and (b) the long-polling interval masking real-time progress.

### 1.4 Post-Stabilization Fix State

The `reconnect(token?)` fix in commit `e5a19bb` correctly addresses the persona-switch socket destruction issue: `DevLogPanel`'s raw `sock` reference now survives reconnects. However, it **does not** address the 5–15 minute pre-fund silence — which is the cause of the observed "nothing showing after banner" symptom in the latest screenshot.

---

## Section 2: Detailed Analysis of "No Active Leads" / Polling Loop

### 2.1 The 8-Second Empty-State Poll

**File:** `frontend/src/pages/HomePage.tsx` — lines 359–370

```typescript
useEffect(() => {
    const currentLeads = view === 'buyNow' ? buyNowLeads : view === 'asks' ? asks : leads;
    if (currentLeads.length > 0 || isLoading) return;

    console.log('[empty-state-poll] No leads in view, polling every 8s');
    const interval = setInterval(() => {
        console.log('[empty-state-poll] firing refetchData');
        refetchData();
    }, 8_000);
    return () => clearInterval(interval);
}, [view, leads.length, buyNowLeads.length, asks.length, isLoading, refetchData]);
```

The poll fires `GET /api/leads?status=IN_AUCTION&limit=20&offset=0` every 8 seconds while the lead list is empty. The response from the backend will return 0 leads if:
- `startLeadDrip` has not yet started (pre-fund still in progress)
- All injected leads have been settled/resolved and their status is no longer `IN_AUCTION`
- DB query filters exclude demo leads

Since the pre-fund phase takes 5–15 minutes and `startLeadDrip` only starts after it completes, the poll will return 0 leads for the entire pre-fund window. Each poll logs the observed message:

> `[setLeads:refetchData] setting 0 leads (filtered from 0)`

This indicates the backend returns 0 leads at the DB level — not a `shouldIncludeLead` client-side filter issue.

### 2.2 The shouldIncludeLead Client-Side Filter

**File:** `frontend/src/pages/HomePage.tsx` — lines 386–389

```typescript
if (!shouldIncludeLead(lead)) {
    console.log('[socket:lead:new] BLOCKED by shouldIncludeLead');
    return;
}
```

When a `marketplace:lead:new` socket event arrives, it passes through `shouldIncludeLead` before being added to state. If the user has any active filters (vertical, country, region, search) that don't match the incoming demo lead's attributes, the lead is silently blocked. Demo leads are injected with random verticals from `DEMO_VERTICALS` and random geos from `GEOS`. If the judge/viewer has selected a vertical filter (e.g., "Real Estate only") and the incoming lead is "mortgage," it gets blocked.

Additionally, the socket event path (`marketplace:lead:new`) only triggers for the real-time injection — the HTTP poll (`refetchData`) applies the same server-side filter with `params.status = 'IN_AUCTION'` but does NOT apply the client-side `shouldIncludeLead` filter (filtered leads just show up in the list). So there is an asymmetry: socket events are client-filtered, HTTP poll results are not. This means a lead that was "blocked" by the socket filter may still appear on the next 8-second HTTP poll cycle.

### 2.3 marketplace:refreshAll Triggering Additional Fetches

**File:** `backend/src/services/demo-e2e.service.ts` — line 1340

```typescript
io.emit('marketplace:refreshAll');
```

After each `injectOneLead` in the main cycle loop, the backend emits both `marketplace:lead:new` AND `marketplace:refreshAll`. The `marketplace:refreshAll` handler in `HomePage.tsx` (line 417–421) calls `refetchData()` which does an HTTP GET that is NOT client-filtered. So even if `marketplace:lead:new` was blocked, the `marketplace:refreshAll` that follows it should cause the lead to appear via the HTTP GET.

**However:** The HTTP GET for `refetchData` fetches from `GET /api/leads?status=IN_AUCTION`. If the lead was injected via the drip (`startLeadDrip`), its DB status is `IN_AUCTION`. But if the main cycle has already settled this lead's auction (changing its DB status to `SOLD`), the HTTP poll will not return it. The timing between drip injection and cycle settlement determines whether leads appear at all.

### 2.4 Auction Timing Race (LEAD_AUCTION_DURATION_SECS)

**File:** `backend/src/services/demo-e2e.service.ts` — line 617

```typescript
auctionEndAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
```

**File:** `backend/src/config/perks.env.ts` — (not read, but referenced)

If `LEAD_AUCTION_DURATION_SECS` is set too low (e.g., 60 seconds), a drip-injected lead's auction may expire and be marked `EXPIRED` or `UNSOLD` by the auction monitor before the frontend ever polls for it. The backend RTB socket server (`backend/src/rtb/socket.ts`) runs a `setInterval` that checks for expired auctions and emits `lead:status-changed` — which causes `setLeads` in `HomePage.tsx` to remove the lead from the list (line 456). Thus leads can appear for a brief moment and immediately disappear.

---

## Section 3: Detailed Analysis of Stop Demo Ineffectiveness

### 3.1 Pre-Fund Phase is Not Abort-Checked at Every Transaction

**File:** `backend/src/services/demo-e2e.service.ts` — lines 1098–1156

The pre-fund loop (Step 1) only checks `signal.aborted` at the top of the outer for-loop (line 1099: `if (signal.aborted) throw new Error('Demo aborted')`). However, each individual buyer's funding sequence (4 separate `await tx.wait()` calls) does NOT check `signal.aborted` between them. 

This means: if the judge clicks "Stop Demo" while the fourth buyer's `deposit()` transaction is mid-confirmation, the abort signal is set, but the current buyer's remaining 2–3 transactions still execute to completion before the outer loop checks the signal again and throws.

**Worst case:** 4 transactions × 8 seconds = 32 seconds of unresponsiveness after clicking Stop, even in the pre-fund phase.

### 3.2 Stop During startLeadDrip

**File:** `backend/src/services/demo-e2e.service.ts` — `startLeadDrip()`, lines 548–554

```typescript
while (created < maxLeads && Date.now() < deadline && !stopped && !signal.aborted) {
    const delaySec = rand(8, 15);
    for (let t = 0; t < delaySec && !stopped && !signal.aborted; t++) {
        await sleep(1000);
    }
```

The drip's inner loop checks `signal.aborted` every 1 second. This is reasonably responsive — the drip will stop within 1 second of abort being signalled. However, if the drip is mid-`injectOneLead()` (which involves Prisma `lead.create` and `auctionRoom.create`), it will complete those DB writes before returning.

### 3.3 Render Process Restart During Pre-Fund

If Render's free-tier server restarts during the pre-fund phase (which takes 5–15 minutes — longer than Render's 15-minute idle timeout on the free plan), the Node process terminates mid-transaction. The `isRunning = true` in-memory flag resets to `false`. On reconnect, the frontend polls `/full-e2e/status` and gets `{ running: false, recycling: false }`, which the frontend interprets as "demo not running, ready to start." A judge who clicks "Run Demo" at this point will start a second demo run with partially-funded buyers and potentially stale lockIds in the vault.

### 3.4 HTTP vs Socket Desync

**File:** `backend/src/routes/demo-panel.routes.ts` — stop route (post e5a19bb: lines 1651–1664)

The updated stop route now emits `demo:status { running: false, recycling: false }` via `moduleIo`. However, if `moduleIo` is `null` (because the server restarted and `runFullDemo` was never called in this process), the status broadcast is silently skipped. The frontend's `useDemoStatus` hook falls back to HTTP polling, but the polling interval is set elsewhere — if the socket reconnection is slow (Render cold boot), the button state may remain frozen for 30+ seconds.

---

## Section 4: Detailed Analysis of Emergency Top-Up Failures / Partial Cycles

### 4.1 Emergency Top-Up Nonce Race

**File:** `backend/src/services/demo-e2e.service.ts` — lines 1212–1242

When a buyer's vault balance is insufficient at cycle time, the emergency top-up fires:

```typescript
const gasTx = await signer.sendTransaction({ to: bAddr, value: ethers.parseEther('0.001') });
await gasTx.wait();
const txfr = await usdc.transfer(bAddr, topUpAmount);
await txfr.wait();
const approveTx = await bUsdcContract.approve(VAULT_ADDRESS, topUpAmount);
await approveTx.wait();
const depositTx = await bVaultContract.deposit(topUpAmount);
await depositTx.wait();
```

This uses `signer` (the deployer signer) for `gasTx` and `usdc.transfer`. Simultaneously, `startLeadDrip` running on its own async path also calls `sendTransaction` from the deployer signer periodically (whenever a drip-injected lead needs a seller gas top-up via `ensureDemoSeller`). 

**Nonce collision pattern:**
1. Main cycle: deployer sends gas top-up TxA (nonce N)
2. Drip: deployer sends USDC transfer TxB (nonce N) — **same nonce, nonce race**
3. One of the two transactions fails with `replacement transaction underpriced` or `nonce too low`
4. The one that fails causes the emergency top-up to throw, which catches and emits a `⚠️ Emergency top-up failed` warning — and `continue`s to the next buyer

Despite commit `e5a19bb` adding a shared provider and `_nonceChain` via `getNextNonce()`, the **emergency top-up code in Step 3 does NOT use `getNextNonce()`** — it calls `signer.sendTransaction(...)` directly (line 1219). Only `recycleTokens` gas top-ups are nominally intended to use the shared nonce path, but since both paths call `getSigner()` which returns `new ethers.Wallet(DEPLOYER_KEY, getSharedProvider())`, the nonce tracking is still per-`Wallet` instance rather than globally coordinated. Each call to `getSigner()` creates a **new Wallet object** with its own nonce state, meaning the nonce queue is not actually shared between the emergency top-up path and the drip path.

### 4.2 "Invalid Lock" Reverts During settleBid

**File:** `backend/src/services/demo-e2e.service.ts` — lines 1387–1398 (lockId parsing) and 1434–1441 (settle)

The `lockId` is parsed from the transaction receipt's `logs` array by matching the `BidLocked` event signature against the VAULT_ABI interface. If the log parsing fails (mismatched ABI, encoding mismatch, or the event was emitted from a different contract), `lockIds` remains empty and `winnerLockId` is `undefined`. Then `vault.settleBid(undefined, DEMO_SELLER_WALLET)` is called with an invalid lockId, causing the contract to revert with "Invalid lock."

Additionally: if the deployer approves/executes `lockForBid(bAddr, bAmountUnits)` but the buyer's vault shows a different approved amount (due to a previously failed approve-after-revoke cycle), the `lockForBid` itself may succeed with the wrong amount, producing a `BidLocked` event with a lockId that refers to a smaller bid — then `settleBid` with that lockId settles for less than expected, reducing `totalSettled`.

The partial cycle observation (1–2 bidders instead of 3) is explained by `readyBuyers` being 1 or 2 when some emergency top-ups fail. When `readyBuyers === 1`, only one lock is created, meaning there are no losers to refund — `lockIds.length === 1` and the refund loop (line 1446: `for (let r = 1; r < lockIds.length; r++)`) never executes. This is functionally correct but results in significantly lower `totalSettled` values.

### 4.3 DEMO_SELLER_WALLET is Also DEMO_BUYER_WALLETS[9]

**File:** `backend/src/services/demo-e2e.service.ts` — lines 44–50

```typescript
const DEMO_BUYER_WALLETS = [
    '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9', // [0]
    ...
    '0x089B6Bdb4824628c5535acF60aBF80683452e862',  // [9] ← also SELLER
];
const DEMO_SELLER_WALLET = '0x089B6Bdb4824628c5535acF60aBF80683452e862';
const DEMO_SELLER_KEY    = '0x17455af639...';
```

Wallet `0x089B6Bdb` is simultaneously the seller wallet and the 10th buyer wallet. This creates conflicts:

1. **Pre-fund Step 1:** The deployer sends 150 USDC to `0x089B6Bdb` as a "buyer" and deposits it to that wallet's buyer vault account.
2. **Auction cycle:** `settleBid(lockId, '0x089B6Bdb')` credits USDC to the same wallet as "seller payment."
3. **Cycle 8 (offset % 10 wraps to [7,8,9]):** Buyer[9] = `0x089B6Bdb` is selected as one of the 3 cycle buyers. `lockForBid('0x089B6Bdb', bidAmount)` is called. The vault locks funds from `0x089B6Bdb`'s buyer vault.
4. **Settlement of that same cycle:** `settleBid(winnerLockId, '0x089B6Bdb')` tries to credit `0x089B6Bdb` as a seller.

If `0x089B6Bdb` is also among the bidders, the settle tx may encounter a reentrancy guard or balance conflict depending on the vault contract's implementation. At minimum, the seller receives payment into the same wallet that just had USDC locked for bidding — which then gets partially recycled during `recycleTokens`.

---

## Section 5: Detailed Analysis of Persona / ACE KYC Conflicts

### 5.1 autoKYC On Buyer Login

**File:** `backend/src/routes/demo-panel.routes.ts` — lines 136–166

When a user switches to the Buyer persona via `/api/demo/demo-login`, the route calls:

```typescript
await aceService.autoKYC(walletAddress);
```

**File:** `backend/src/services/ace.service.ts` — line 369

```typescript
const tx = await this.contract.verifyKYC(walletAddress, kycProofHash, '0x');
```

`aceService.autoKYC` submits a `verifyKYC(address, bytes32, bytes)` transaction to the `ACECompliance` contract. This transaction is signed by the **deployer signer** (the same key used for demo pre-fund and emergency top-ups).

**Timing scenario:**
1. Judge opens app → switches to "Buyer" persona
2. `demo-login` fires → `autoKYC` sends `verifyKYC` tx using deployer signer (nonce N)
3. Judge immediately clicks "Run Demo"
4. `runFullDemo` starts → pre-fund loop sends gas top-up using deployer signer (nonce N)
5. **Nonce collision** → one of the two transactions reverts or gets dropped

Even if the judge switches personas before clicking "Run Demo," the `verifyKYC` transaction takes 3–30 seconds to confirm. If the demo starts before it confirms, the deployer's pending nonce from the KYC tx blocks the first pre-fund gas top-up.

### 5.2 Multiple KYC Calls Per Session

If a judge switches back and forth between personas (Buyer → Guest → Seller → Buyer), each transition to "Buyer" fires `autoKYC`. Each `autoKYC` call:
- Checks if the wallet already has a valid KYC entry in the DB (`complianceCheck`)
- If the DB check passes, it still calls `aceService.autoKYC`, which makes an on-chain call to check if `verifyKYC` needs to be re-run

Without inspecting `aceService.autoKYC` internals fully, the known behavior is that it submits a `verifyKYC` transaction each time unless it specifically checks the on-chain state first. Multiple `verifyKYC` transactions queued from the deployer key before a demo run can exhaust the deployer's nonce sequencing.

### 5.3 ACE KYC and Seller Persona

Only `isBuyer` triggers the ACE `autoKYC` path (line 121: `if (isBuyer)`). Seller persona login does NOT call `autoKYC`. However, the seller's wallet (`0x089B6Bdb`) is already in `DEMO_BUYER_WALLETS` — if the seller persona has its own wallet address that differs from the deployer, there is no conflict. But if the demo admin login uses the deployer key's derived address (common in some configurations), the seller login could also queue on-chain transactions from the deployer key.

---

## Root Causes Summary Table

| ID | Symptom | Root Cause | File(s) | Severity |
|----|---------|-----------|---------|----------|
| RC-1 | Dev Log silent for 5–15 min after banner | Pre-fund loop (10 buyers × 4 txs each) blocks before drip/cycles start | `demo-e2e.service.ts:1080-1162` | 🔴 Critical |
| RC-2 | "No active leads" throughout run | `startLeadDrip` starts AFTER pre-fund completes; marketplace polls return 0 | `demo-e2e.service.ts:1166` | 🔴 Critical |
| RC-3 | leads blocked by shouldIncludeLead filter | socket `marketplace:lead:new` filtered by vertical/geo client-side | `HomePage.tsx:386-389` | 🟠 Medium |
| RC-4 | Leads appear briefly then disappear | `LEAD_AUCTION_DURATION_SECS` too short; auction monitor expires lead before frontend sees it | `demo-e2e.service.ts:617`, `rtb/socket.ts` | 🟠 Medium |
| RC-5 | Emergency top-up nonce failures | Deployer signer used simultaneously by drip gas top-ups and cycle emergency top-ups; no global nonce guard on emergency path | `demo-e2e.service.ts:1219` | 🔴 Critical |
| RC-6 | Partial cycles (1–2 buyers instead of 3) | Emergency top-up failure causes `continue` — `readyBuyers` < 3 | `demo-e2e.service.ts:1241` | 🟠 Medium |
| RC-7 | "Invalid lock" revert during settleBid | lockId parsing from receipt.logs fails on ABI mismatch or empty lockIds | `demo-e2e.service.ts:1387-1398,1437` | 🔴 Critical |
| RC-8 | Low totalSettled ($165 observed) | RC-6 + RC-7 combined: fewer bidders, smaller bids, some settle at wrong amount | Multiple | 🟠 Medium |
| RC-9 | ACE KYC nonce race on persona switch | `demo-login` buyer path calls `autoKYC` → on-chain verifyKYC using deployer key, conflicts with demo pre-fund | `demo-panel.routes.ts:140` | 🔴 Critical |
| RC-10 | Seller = Buyer[9], vault conflict on cycle 8 | `0x089B6Bdb` is both DEMO_SELLER_WALLET and DEMO_BUYER_WALLETS[9] | `demo-e2e.service.ts:44-50` | 🟡 Low |
| RC-11 | Stop Demo unresponsive mid pre-fund | Abort not checked inside each buyer's 4-tx sequence | `demo-e2e.service.ts:1099` | 🟠 Medium |
| RC-12 | Server restart clears isRunning/isRecycling | In-process state lost on Render free-tier restart; frontend sees false-idle | `demo-e2e.service.ts:134-140` | 🟠 Medium |
| RC-13 | moduleIo null on cold boot | stopDemo() cannot broadcast demo:status if server restarted before runFullDemo | `demo-e2e.service.ts:1035,moduleIo` | 🟡 Low |
| RC-14 | WebSocket degraded to long polling on Vercel | Vercel edge severs WS upgrade; 25s polling batches add latency | `socket.ts:81`, Vercel infra | 🟡 Low (functional) |

---

## Cross-Cutting Considerations

### Demo Duration vs Render Free Tier

A full 5-cycle demo with pre-funding now takes:
- Pre-fund: ~8–15 minutes (10 buyers from scratch)
- Drip + cycles: ~5–10 minutes (5 cycles × 6+ txs each + drip every 8–15s)
- Recycling: ~5–10 minutes (10 buyers × drain + deployer withdraw)

**Total: 18–35 minutes** — which exceeds Render's free-tier 15-minute inactivity window if the backend has been cold. The chain of restarts during or between phases is a primary source of instability.

### Multi-Judge / Multi-Tab Viewers

All `io.emit()` calls broadcast to all connected clients. A judge in Tab A and Tab B both receive `demo:log` and `marketplace:lead:new`. However:
- Tab A may have different vertical/geo filters than Tab B → `shouldIncludeLead` blocks different leads per tab
- If Tab A runs the demo and Tab B joins mid-run, Tab B misses all pre-fund logs (no replay buffer)
- If Tab B switches persona, it fires `autoKYC` (RC-9) concurrently with Tab A's running demo

### Judge Experience Impact

1. **First 5–15 minutes:** blank Dev Log + empty marketplace — looks completely broken
2. **If pre-fund succeeds:** Suddenly 3 leads appear + fast auction logs — jarring jump
3. **Emergency top-up warnings** visible in Dev Log ("⚠️ Emergency top-up failed") — don't inspire confidence
4. **Total settled $165** (vs expected $125–$375) — looks like a toy demo
5. **Stop Demo button** may work (after e5a19bb) but no visible feedback if it succeeds silently

---

## Open Questions / Areas Needing Clarification

1. **What is `LEAD_AUCTION_DURATION_SECS` set to in the Render environment?** If ≤ 60 seconds, leads expire before the judge can see them even if they appear.

2. **Are all 10 buyer wallets starting fresh (0 vault balance) for each run?** If `recycleTokens` from the previous run partially failed and some buyers still have USDC, the pre-fund skip logic (line 1107: if `existingBal >= preFundUnits`) would skip those buyers — dramatically reducing the pre-fund phase duration.

3. **Does `aceService.autoKYC` check on-chain state first, or always submit a transaction?** If it always submits, every Buyer persona switch generates a deployer transaction. If it checks first, persona switching after the first KYC is safe.

4. **Has the demo been successfully run from an initial state (all buyer wallets empty) vs a "warm" state (buyers partially funded from previous run)?** The two scenarios have completely different timing profiles.

5. **What is the deployer wallet's current USDC balance?** The pre-fund requires 10 × $150 = $1,500 USDC minimum. If the previous run's `recycleTokens` only partially recovered, the deployer may have < $1,500, making pre-fund fail silently for some buyers.

6. **Is `DEMO_MODE=true` set on both Render AND Vercel?** `DevLogPanel` auto-opens only when `import.meta.env.VITE_DEMO_MODE === 'true'`. The backend's `devOnly` middleware also requires `DEMO_MODE` to be truthy on Render for the `/api/demo/*` routes.

7. **What is the exact error message for the "Invalid lock" reverts?** Whether it's `custom error 0x...` (encoded revert from contract) vs `execution reverted: Invalid lock` (string revert) determines whether the issue is a stale lockId or an ABI encoding problem.

8. **Is the `startLeadDrip` selling the same seller's leads in both the `injectOneLead` drip and the main cycle `injectOneLead` in the loops (lines 1291 and 583)?** Both call `ensureDemoSeller(DEMO_SELLER_WALLET)` and create leads under the same sellerId. If both run concurrently, there could be a conflict on who the seller's DB row represents.

---

## High-Level Recommended Approach

*Non-technical, phased bullets only. No code suggestions.*

### Phase A — Eliminate the Silence Window (Highest Priority)
- The pre-fund phase must emit progress logs for every buyer in real-time, so the Dev Log is visibly active from the first second of the demo, not just the banner. The 5–15 minute funding window should be narrated — every transaction attempt, confirmation, and skip should appear as a log line.
- Alternatively, the initial seed leads (3 immediate leads) should be injected in parallel with — not after — pre-funding, so the marketplace is never empty even while funding is in progress.

### Phase B — Decouple ACE KYC from the Deployer Signer
- The `autoKYC` call during buyer persona login must not use the same deployer key as the demo funding transactions. Either use a separate ACE-dedicated signer, or set a flag that delays the `autoKYC` until the demo is not running.

### Phase C — Fix the Seller/Buyer Wallet Overlap
- The DEMO_SELLER_WALLET must be a wallet that is NOT among the 10 DEMO_BUYER_WALLETS to prevent double-role conflicts during cycle 8+ bidding.

### Phase D — Add On-Chain Abort Checkpoints Inside Pre-Fund
- The abort signal should be respected between every individual transaction in the pre-fund loop, not just at the outer for-loop level. This would make "Stop Demo" responsive within seconds even during funding.

### Phase E — Frontend Filter Awareness in Demo Mode
- When demo mode is active, the `shouldIncludeLead` filter should either be bypassed or the active filter labels should display a clear warning: "Filters may hide demo leads. Clear filters for full demo view."

### Phase F — Persistent Run State in DB
- `isRunning` and `isRecycling` should be backed by a `DemoRun.status` field in the database so Render server restarts don't silently reset state. The frontend's status poll would then reflect true state regardless of process lifecycle.

---

*End of analysis — 2026-02-19T16:24 MST. Generated from investigation of codebase at commit `e5a19bb`.*
