# DEMO-RECYCLING-OPTIMIZATION-CONTEXT

> **Goal:** Enable indefinite, zero-manual-intervention demo runs by fully understanding and closing all recycling gaps.

---

## 1. Executive Summary

The 1-click demo is a fully on-chain, end-to-end lead auction flow that runs N cycles (default 5, max 12) against Base Sepolia. Each cycle injects a lead, triggers sealed bids from 10 buyer wallets, selects a winner, settles on-chain, and refunds losers. After all cycles complete, `recycleTokens()` consolidates all USDC back to the deployer and replenishes buyer vaults to $250 for the next run.

**Current state:** The code-level recycling loop is largely complete and self-sustaining. The main gap is that the **seller wallet's USDC cannot be auto-replenished** from within the demo itself (no deposit pathway back into the vault from the seller side), and the **deployer USDC reserve** must be seeded manually before the very first run (and re-seeded when depleted). ETH gas is a fund-once, permanent model.

---

## 2. The 11 Demo Wallets

All addresses are from `faucet-wallets.txt`. ETH is pre-funded once via `fund-wallets-eth-permanent.mjs` (0.015 ETH each ≈ $30/wallet, enough for 300+ transactions).

| # | Label | Address | Role |
|---|-------|---------|------|
| 1 | Buyer | `0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9` | Bid in demo auctions |
| 2 | Buyer | `0x55190CE8A38079d8415A1Ba15d001BC1a52718eC` | Bid in demo auctions |
| 3 | Buyer | `0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58` | Bid / demo seller / panel user |
| 4 | Buyer | `0x424CaC929939377f221348af52d4cb1247fE4379` | Bid in demo auctions |
| 5 | Buyer | `0x3a9a41078992734ab24Dfb51761A327eEaac7b3d` | Bid in demo auctions |
| 6 | Buyer | `0x089B6Bdb4824628c5535acF60aBF80683452e862` | Bid in demo auctions |
| 7 | Buyer | `0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE` | Bid in demo auctions |
| 8 | Buyer | `0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C` | Bid in demo auctions |
| 9 | Buyer | `0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf` | Bid in demo auctions |
| 10 | Buyer | `0x7be5ce8824d5c1890bC09042837cEAc57a55fdad` | Bid in demo auctions |
| 11 | Seller | `0x9Bb15F98982715E33a2113a35662036528eE0A36` | Receives winning bid proceeds |
| — | Deployer | `0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70` | Gas sponsor + USDC reservoir |

Private keys for all 11 wallets are in `BUYER_KEYS` (loaded in `demo-e2e.service.ts` from env). The deployer key is `DEPLOYER_PRIVATE_KEY`.

---

## 3. On-Chain Contracts (Base Sepolia)

| Contract | Address | Purpose |
|----------|---------|---------|
| `PersonalEscrowVault` | `0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4` | Central USDC vault: deposit, withdraw, lockForBid, settleBid, refundBid, PoR |
| USDC (Base Sepolia) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | ERC-20 USDC token; demo currency |
| `LeadNFT` | `0x37414bc0341e0AAb94e51E89047eD73C7086E303` | Minted for each lead |
| `RTBEscrow` | `0xff5d18a9fff7682a5285ccdafd0253e34761DbDB` | Legacy escrow (still present but mostly superseded) |
| `ACECompliance` | `0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6` | KYC/compliance check |
| `Marketplace` | `0xfDf961C1E6687593E3aad9C6f585be0e44f96905` | On-chain marketplace hooks |

---

## 4. End-to-End Demo Fund Flow

### 4.1 Pre-Flight (inside `runFullDemo`)

```
deployer (USDC) ──deposit──► PersonalEscrowVault
                              (per buyer wallet, target $250 vault balance)
```

For each of the 10 buyer wallets:
1. Read on-chain `balanceOf(buyer)` via `PersonalEscrowVault`.
2. If balance < $200, top up to $250 by: deployer → `USDC.transfer(buyer, amount)` → `buyer.approve(vault, amount)` → `PersonalEscrowVault.deposit(amount)`.
3. Deployer also checks its own USDC balance; if < $200, it logs a warning but continues.

**Source:** `demo-e2e.service.ts` lines ~450–750 (`prefundBuyerVaults`, `preFundBuyerVault`).

### 4.2 Per-Cycle Flow (inside the cycle loop in `runFullDemo`)

Each cycle (1–N):

```
1. injectOneLead()
   → creates Lead in DB (source=DEMO)
   → spawns AuctionRoom
   → emits marketplace:lead:new via Socket.IO

2. Bidding Phase (runs after configurable delay):
   For each BUYER_KEY in rotation:
     → vaultService.lockForBid(buyerWallet, bidAmount)
       → PersonalEscrowVault.lockForBid(buyer, bidAmountUnits)
       → decrements buyer.balanceOf, increments buyer.lockedBalances
       → emits BidLocked event, returns lockId

3. Auction Close / Winner Selection:
   → pick highest bid

4. Settlement (winner):
   → vaultService.settleBid(lockId, sellerAddress)
     → PersonalEscrowVault.settleBid(lockId, sellerWallet)
     → transfers: (bidAmount * 0.95 - $1) → seller
     → transfers: (bidAmount * 0.05) → platform (deployer)
     → transfers: ($1 convenience fee) → platform (deployer)
     → emits BidSettled

5. Refunds (all losers):
   → vaultService.refundBid(lockId)
     → PersonalEscrowVault.refundBid(lockId)
     → restores full (bid + fee) to buyer.balanceOf
     → emits BidRefunded

6. PoR Check (every N cycles, configurable):
   → PersonalEscrowVault.verifyReserves()
   → emits ReservesVerified
```

**After each cycle:** DB records updated, cycle result pushed to `resultsStore`.

### 4.3 Post-Demo Recycling (`recycleTokens`)

Called automatically after all cycles complete. Runs inside `withRecycleTimeout` (120s default).

```
Phase 1 — Drain seller wallet's vault balance:
  recycleVaultWithdraw(sellerSigner) → PersonalEscrowVault.withdraw(all) → USDC to seller EOA
  recycleTransfer(sellerWallet)       → USDC.transfer(sellerEOA → deployer)

Phase 2 — Drain each buyer wallet's vault balance:
  for each buyer:
    recycleVaultWithdraw(buyerSigner) → PersonalEscrowVault.withdraw(all unlocked)
    recycleTransfer(buyerWallet)       → USDC.transfer(buyerEOA → deployer)

Phase 3 — Replenish buyer vaults for next run:
  for each buyer:
    deployer → USDC.transfer(buyer, $250)
    buyer.approve(vault, $250)
    PersonalEscrowVault.deposit($250)  [signed by buyer]

Phase 4 — Final sweep (any residual amounts):
  Re-scans each wallet for remaining USDC and transfers to deployer if > $0.10 dust.
```

**Key implementation details:**
- `recycleTransfer`: 3-attempt retry loop with 1.2× gas escalation per attempt. Reads live balance before each attempt (avoids stale data).
- `recycleVaultWithdraw`: Calls `PersonalEscrowVault.withdraw(balance)` — only withdraws unlocked balance (cannot withdraw locked funds).
- `withRecycleTimeout`: AbortSignal-based 120s timeout guard. On timeout, logs warning and returns; does **not** crash the server.
- Nonce management: serialised via `getNextNonce()` promise-chain to prevent "nonce too low" errors.
- Gas escalation: Base fees from `getFeeData()` × 1.2^(attempt - 1).

---

## 5. State Management

### 5.1 In-Memory State (`demo-e2e.service.ts` module-level)

| Variable | Type | Reset condition |
|----------|------|-----------------|
| `isRunning` | `boolean` | Set false on normal completion or `stopDemo()` |
| `isRecycling` | `boolean` | Set false on recycle completion or timeout |
| `_currentController` | `AbortController` | New controller per demo run |
| `resultsStore` | `Map<runId, DemoResult>` | Accumulated across runs; never cleared |
| `_nonceChain` | `Promise<number>` | Rolling promise chain; reset each run |

### 5.2 Disk Persistence

- **File:** `backend/data/demo-results.json` (path constructed relative to service file).
- **Written:** After each successful `runFullDemo` completes — full `DemoResult` serialised as JSON.
- **Read:** On startup via `initResultsStore()` — hydrates `resultsStore` from disk so cold restarts don't lose history.
- **Failure mode:** If write fails (disk quota, permissions), it logs a warning and continues — non-fatal.

### 5.3 DB State

- `Lead` records with `source='DEMO'` track all demo leads.
- `Bid`, `Transaction`, `AuctionRoom` linked to demo leads.
- `EscrowVault` + `VaultTransaction` serve as read-cache/audit trail (source of truth is on-chain).
- `PlatformConfig` key `demoBuyersEnabled` persists the demo-buyers toggle across restarts.

### 5.4 On-Chain State (PersonalEscrowVault)

| Slot | Description |
|------|-------------|
| `balances[addr]` | Unlocked USDC (6-decimal) |
| `lockedBalances[addr]` | USDC locked in active bids |
| `totalObligations` | Sum of all user balances + locked balances |
| `bidLocks[lockId]` | `{user, amount, fee, lockedAt, settled}` |
| `lastPorCheck` / `lastPorSolvent` | Chainlink Automation PoR data |

---

## 6. Environment Variables (Critical Subset)

All sourced from `backend/.env` / Render environment:

| Variable | Value / Purpose |
|----------|-----------------|
| `DEPLOYER_PRIVATE_KEY` | `3c7139...` — signs all backend txns, funds wallets |
| `RPC_URL_BASE_SEPOLIA` | `https://sepolia.base.org` |
| `VAULT_ADDRESS_BASE_SEPOLIA` | `0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4` |
| `USDC_CONTRACT_ADDRESS` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| `BUYER_KEY_1` … `BUYER_KEY_10` | Private keys for 10 buyer wallets |
| `SELLER_KEY` | Private key for wallet 11 (seller) |
| `DEMO_MODE` | `true` — keeps demo routes enabled in prod |
| `NODE_ENV` | `development` locally, `production` on Render |

---

## 7. API Trigger Points

All under `/api/v1/demo-panel/` (gated by `DEMO_MODE !== 'false'`):

| Route | Purpose |
|-------|---------|
| `POST /full-e2e` | Start demo (cycles=1–12). Returns immediately; streams via Socket.IO |
| `POST /full-e2e/stop` | Abort running demo or recycling via AbortSignal |
| `GET /full-e2e/status` | Running/recycling flags + results summary |
| `GET /full-e2e/results/latest` | Newest `DemoResult`; 202 if still recycling |
| `GET /full-e2e/results/:runId` | Results by run ID |
| `POST /fund-eth` | Top-up all 11 wallets to 0.015 ETH from deployer (same logic as `fund-wallets-eth-permanent.mjs`) |
| `POST /seed` | Seed marketplace with demo leads/asks/verticals |
| `POST /demo-login` | Issue JWT for demo seller or buyer |

---

## 8. Socket.IO Events During Demo

| Event | Payload | Purpose |
|-------|---------|---------|
| `demo:log` | `{ message, level }` | Per-step log lines for DevLogPanel |
| `demo:status` | `{ running, recycling, cycle, totalCycles, phase }` | Progress bar / button state |
| `demo:cycle:complete` | Cycle result | Per-cycle result card update |
| `demo:complete` | Full `DemoResult` | Triggers UI to show results page |
| `marketplace:lead:new` | Lead data | Simulates a real lead arriving |

---

## 9. Scripts Inventory

| Script | Purpose | Run frequency |
|--------|---------|---------------|
| `scripts/fund-wallets-eth-permanent.mjs` | Pre-fund all 11 wallets with 0.015 ETH (top-up to target) | Once, or when ETH gets low |
| `scripts/consolidate-usdc-only.mjs` | Manual USDC consolidation from all wallets → deployer | Emergency / before first run |
| _(inline in routes)_ `POST /fund-eth` | HTTP version of fund-wallets-eth-permanent (same logic) | On-demand via demo panel |

---

## 10. Identified Gaps & Root Causes

### GAP-1: Deployer USDC Reserve Must Be Manually Seeded

**Root cause:** The recycling loop is self-sustaining only if the deployer holds enough USDC to cover the replenishment step (Phase 3: 10 buyers × $250 = $2,500). If the deployer USDC falls below this, `prefundBuyerVaults` will silently under-fund wallets and the next demo will fail mid-cycle.

**Impact:** High. A demo run with depleted deployer USDC will start, lock bids, then fail at settlement or the next replenishment round.

**Detection:** The pre-flight check logs a warning if deployer USDC < $200, but does **not** abort — it just continues with whatever is available.

**Fix needed:** Assert deployer USDC ≥ ($250 × numBuyers + buffer) at start of `runFullDemo`. Emit a `demo:status` error and return early if insufficient.

---

### GAP-2: Locked Funds Cannot Be Withdrawn During Recycling

**Root cause:** `PersonalEscrowVault.withdraw()` only withdraws `balances[addr]` (unlocked). If a bid was never settled or refunded (e.g., demo was `stopDemo()`-aborted mid-cycle), the funds remain in `lockedBalances[addr]` and `recycleVaultWithdraw` cannot recover them.

**Impact:** Medium. After an aborted run, some buyer vault balances will be stranded in locked state. The 7-day auto-refund via Chainlink Automation (`checkUpkeep` / `performUpkeep`) will eventually free them, but not fast enough for immediate re-demo.

**Detection:** The `activeLockCount()` function on vault can detect this. Currently not logged during post-cycle recycling.

**Fix needed:**
1. Before recycling, enumerate open lock IDs per wallet and call `refundBid(lockId)` for any unsettled locks.
2. Or: add a `forceRefundAll(address user)` admin function to the vault contract.

---

### GAP-3: Seller Wallet Cannot Be Auto-Replenished

**Root cause:** The seller wallet (`0x9Bb15F98982715E33a2113a35662036528eE0A36`) receives USDC from settlements but has no mechanism to re-deposit back into the vault to fund future selling activity. The recycling loop drains the seller wallet → deployer, but there's no "seller vault top-up" step.

**Impact:** Low for the demo (the demo doesn't require the seller to have vault balance — the seller only receives funds). However, the seller's ETH balance for gas does not auto-replenish.

**Fix needed:** Not critical for current demo mechanics. If the seller ever needs to initiate on-chain transactions, add a `prefundSellerETH` step.

---

### GAP-4: No Pre-Run Locked-Funds Check

**Root cause:** `runFullDemo` does not check for pre-existing locked balances in buyer vaults before starting. If a previous run was aborted, the new run's `prefundBuyerVaults` reads `balanceOf` (which excludes locked), so it might see $0 available and top up to $250 while $X is still stuck in locks.

**Impact:** Medium. Results in over-funded vaults (locked + newly deposited > $250), wasting deployer USDC and causing PoR checks to see inflated obligations.

**Fix needed:** At start of `runFullDemo`, for each buyer wallet, check `lockedBalances(buyer)`. If > 0, either refund all locks or wait. Log to `demo:log`.

---

### GAP-5: `withRecycleTimeout` Does Not Re-Attempt Failed Steps

**Root cause:** If `recycleTokens` times out at 120s, it aborts and returns. Any wallets that weren't drained remain with USDC. On the next `runFullDemo`, those wallets are partially funded, which is fine, but the deployer did not recover those funds and may have insufficient USDC for full replenishment.

**Impact:** Low-medium. Gradual fund leakage across runs if recycling consistently times out.

**Fix needed:** After the timeout, log which wallets were not drained. Consider increasing the timeout or running a background cleanup task.

---

### GAP-6: DB State Not Cleaned Between Runs

**Root cause:** `recycleTokens` does **not** delete demo DB records (Leads, Bids, Transactions). These accumulate across runs, growing the DB indefinitely and causing stale data in `GET /status` counts.

**Impact:** Low for functionality, medium for DB hygiene. The `/seed` endpoint does auto-clear demo data, but `recycleTokens` does not.

**Fix needed (optional):** At end of `recycleTokens`, call `prisma.lead.deleteMany({ where: { source: 'DEMO' } })` (or a soft-delete pattern). Or add a `POST /demo-panel/clear` endpoint for manual invocation.

---

### GAP-7: Convenience Fee Leaks to Platform (Deployer)

**Root cause:** Each `lockForBid` charges a $1 convenience fee that goes to the platform address (deployer), not back into the recycling pool. With 10 buyers × 5 cycles = 50 lock events per run, that's $50 in fees routed to deployer USDC directly (not through vault).

**Impact:** Positive — these fees naturally flow back to the deployer and supplement the replenishment reserve.

**Note:** This is not a gap but a **feature** — it means the system self-funds a small portion of replenishment costs. Document this explicitly.

---

## 11. Fund Balance Summary (Per Run)

Assumptions: 5 cycles, 10 buyers, bids ≈ $30–$80 each.

| Item | Flow | Amount |
|------|------|--------|
| Pre-fund (Phase 1) | deployer → 10 buyer vaults | ~$2,500 total (up to $250 each) |
| Bids locked | buyer.balance → buyer.lockedBalance | Varies (5 winning, 45 refunded) |
| Settlements | buyer.locked → seller wallet | Winner bid × 95% per cycle |
| Platform fees | buyer.locked → deployer | 5% of winner bid per cycle |
| Convenience fees | buyer.locked → deployer | $1 × winners + losers |
| Refunds | buyer.locked → buyer.balance | All losing bids (+ $1 fee) |
| Recycle drain | buyer.balance → deployer | All unlocked USDC |
| Seller drain | seller EOA → deployer | All received settlement USDC |
| Replenishment | deployer → buyer vaults | $250 × 10 = $2,500 |
| **Net deployer cost per run** | | **Fees collected − gas ≈ break-even** |

The demo is **self-sustaining on USDC** as long as:
1. Deployer starts with ≥ $2,500 USDC.
2. No large amount of USDC leaks into locked state permanently.
3. All recycle steps complete within the timeout.

---

## 12. State Reset Checklist (Manual Recovery)

If demo gets into a stuck state (e.g., `isRunning=true` on Render cold restart):

1. **Restart Render service** → `isRunning` / `isRecycling` reset to `false` (in-memory only).
2. **Call `POST /full-e2e/stop`** → If process is still alive, gracefully aborts.
3. **Check on-chain locked funds:** `PersonalEscrowVault.activeLockCount()` → if > 0, manually call `refundBid(lockId)` via deployer for each open lock.
4. **Run `consolidate-usdc-only.mjs`** → recovers all USDC from all demo wallets back to deployer.
5. **Re-seed deployer USDC** if balance < $3,000 (from testnet faucet or bridge).
6. **Run `fund-wallets-eth-permanent.mjs`** if any wallet ETH balance < 0.005 ETH.
7. **`POST /seed`** → Re-populates marketplace DB records for a fresh demo.
8. **`POST /full-e2e`** → Start demo normally.

---

## 13. Recommended Optimizations (Priority Order)

### P0 — Deployer USDC Balance Guard
**Where:** Start of `runFullDemo`, before pre-funding.
**Change:** Read deployer USDC balance. If < $2,500, emit `demo:log` error + `demo:status { running: false, error: 'insufficient_funds' }` and return early with a clear message.

### P1 — Pre-Run Locked Funds Cleanup
**Where:** Start of `runFullDemo`, after USDC guard.
**Change:** For each buyer wallet, call `PersonalEscrowVault.lockedBalances(addr)`. If > 0, call `refundBid` for all active locks. Log progress via `demo:log`.

### P2 — Post-Stop Lock Cleanup
**Where:** After `stopDemo()` is called.
**Change:** Trigger a background cleanup that refunds all open locks for demo buyers, then sweeps USDC back to deployer.

### P3 — Recycling Progress Logging
**Where:** Inside `recycleTokens`.
**Change:** Emit `demo:log` for each wallet drained/skipped/failed. Currently some steps are silent on success.

### P4 — Increase Recycle Timeout
**Where:** `withRecycleTimeout` constant.
**Change:** Raise from 120s to 180–240s to accommodate Base Sepolia congestion. 10 wallets × multiple tx steps × retry logic can easily exceed 120s.

### P5 — DB Cleanup on Recycle Complete
**Where:** End of `recycleTokens`.
**Change:** `prisma.lead.deleteMany({ where: { source: 'DEMO', createdAt: { lt: Date.now() - 24h } } })` — prune old demo leads to keep DB lean.

---

## 14. Key File Reference

| File | Purpose |
|------|---------|
| `backend/src/services/demo-e2e.service.ts` | Core orchestrator (2072 lines) — all fund flow, recycling, replenishment |
| `backend/src/routes/demo-panel.routes.ts` | API routes (1814 lines) — `/full-e2e`, `/fund-eth`, `/seed`, `/status` |
| `backend/src/services/vault.service.ts` | On-chain vault proxy (556 lines) — lockForBid, settleBid, refundBid, PoR |
| `contracts/contracts/PersonalEscrowVault.sol` | Vault contract (441 lines) — all money lives here |
| `scripts/consolidate-usdc-only.mjs` | Manual USDC recovery script (291 lines) — emergency drain |
| `scripts/fund-wallets-eth-permanent.mjs` | ETH pre-fund script (182 lines) — run once |
| `faucet-wallets.txt` | 11 demo wallet addresses + private keys |
| `backend/.env` | All contract addresses, RPC URLs, deployer key |
| `TESTNET-E2E-RESULTS.md` | Historical test run data, gas estimates, fund budgets |
