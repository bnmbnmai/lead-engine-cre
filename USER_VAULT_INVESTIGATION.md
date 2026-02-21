# User-Facing PersonalEscrowVault Regression Investigation

---

## Executive Summary

The "On-Chain Escrow Vault" card in `BuyerDashboard.tsx` is **not connected to the PersonalEscrowVault v2 contract** (`0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4`) in any user-initiated flow. Three independent regressions exist simultaneously:

| Flow | Expected Behavior | Actual Behavior | Severity |
|---|---|---|---|
| **Balance read** (`getVaultBalance`) | `publicClient.readContract(balanceOf(userWallet))` via wagmi/viem | Backend reads on-chain *if* `VAULT_ADDRESS_BASE_SEPOLIA` env var is set **and** the authenticated user has a `walletAddress` in Prisma — silently falls back to stale DB cache on any RPC error | **Medium** — on-chain read exists but is fragile and hidden from UI |
| **Deposit** (`handleDeposit`) | User signs `deposit(amount)` tx in MetaMask → frontend passes real `txHash` to backend | Frontend passes the literal string `"demo-deposit"` as `txHash` to `POST /api/v1/buyer/vault/deposit` — which calls `recordDeposit()` that **only increments the Prisma DB cache**; no USDC ERC-20 approval or `deposit()` call is made on-chain | **Critical** — deposits are entirely fabricated |
| **Withdraw** (`handleWithdraw`) | User signs `withdraw(amount)` tx in MetaMask → frontend passes real `txHash` to backend | Frontend calls `POST /api/v1/buyer/vault/withdraw` with no `txHash`; backend calls `recordCacheWithdraw()` which **only decrements the Prisma DB cache** and explicitly documents it is DB-only; no `withdraw()` call is made on-chain | **Critical** — withdrawals are entirely simulated |
| **Recent Activity** (`loadRecentActivity`) | Parse on-chain `Deposited`, `Withdrawn`, `BidLocked`, `BidSettled`, `BidRefunded` events | Backend returns `VaultTransaction` rows from Prisma only — populated by the same simulated DB writes above | **Critical** — activity log reflects fake in-memory state |

There is also a **fourth structural regression**: the frontend has no wagmi, viem, or any direct contract-call library installed or imported. The entire vault interaction surface was quietly moved behind a REST API layer at some point during the stability/persistence rewrites, removing the only mechanism by which a user could sign a real on-chain transaction for vault operations.

---

## Files Audited

| File | Relevance |
|---|---|
| `frontend/src/pages/BuyerDashboard.tsx` | **Primary UI** — hosts the "On-Chain Escrow Vault" card (lines 302–411); renders balance, deposit input + button, Withdraw All button, and Recent Activity list |
| `frontend/src/lib/api.ts` | **API client** — `getVault()` (line 462), `depositVault()` (line 466), `withdrawVault()` (line 471); all three call REST endpoints, zero contract interaction |
| `frontend/src/hooks/useEscrow.ts` | **Lead-escrow hook** — handles `prepareEscrow`/`confirmEscrow` for RTBEscrow (bid settlement), **not** PersonalEscrowVault; no vault balance/deposit/withdraw logic here |
| `frontend/src/hooks/useAuth.tsx` | Auth + SIWE; provides user wallet address; not involved in vault reads |
| `frontend/src/hooks/` (all 14 hooks) | **No `useVault` hook exists at all**; no wagmi, viem, `writeContract`, `publicClient`, or `useContractWrite` import appears in any frontend file |
| `backend/src/routes/vault.routes.ts` | **Vault REST layer** — `GET /`, `POST /deposit`, `POST /withdraw`, `GET /contract`, `GET /reserves`, `POST /verify-por`, `POST /reconcile-all`; deposit route (lines 41–44) **enforces `txHash` required**, yet frontend passes `"demo-deposit"` constant |
| `backend/src/services/vault.service.ts` | **Core vault logic** — `getVaultInfo()` reads on-chain `balanceOf`/`lockedBalances` when `VAULT_ADDRESS` env is set (lines 106–121); `lockForBid()`, `settleBid()`, `refundBid()` are genuine on-chain calls (lines 288–498); `recordDeposit()` is DB-only (lines 151–186); `recordCacheWithdraw()` is explicitly documented as DB-only with BUG-03 label (lines 189–267) |
| `backend/src/services/vault-reconciliation.service.ts` | 5-minute cron that calls `reconcileVaultBalance()` for DB vs. on-chain drift detection; works correctly for auction flows but cannot compensate for fabricated deposit entries |
| `backend/src/routes/buyer.routes.ts` | Only exposes `GET /perks-overview`; vault routes are registered separately via `vaultRoutes` |
| `backend/src/index.ts` | Route registration (line 211): `app.use('/api/v1/buyer/vault', vaultRoutes)` — correctly wired |
| `contracts/artifacts/contracts/PersonalEscrowVault.sol/PersonalEscrowVault.json` | ABI artifact exists on disk and is referenced by `vault.service.ts` inline ABI |
| `contracts/contracts/PersonalEscrowVault.sol` | Deployed contract source |
| `contracts/typechain-types/contracts/PersonalEscrowVault.ts` | TypeChain types — **never imported anywhere in the frontend** |
| `backend/src/services/escrow-impl.service.ts` | RTBEscrow (bid settlement) — separate contract, not PersonalEscrowVault; uses `ethers.js` with real `DEPLOYER_PRIVATE_KEY` signing; serves as the correct pattern to mirror |

---

## Root Cause

### Primary Regression: `BuyerDashboard.tsx` — Lines 337–349

```typescript
// BuyerDashboard.tsx line 341
const { data } = await api.depositVault(amt, 'demo-deposit');
```

On click of the "Deposit" button, the handler passes the **literal string `"demo-deposit"`** as the `txHash` argument to `api.depositVault()`. This calls `POST /api/v1/buyer/vault/deposit` with `{ amount, txHash: "demo-deposit" }`.

The backend's `recordDeposit()` (`vault.service.ts` lines 151–186) accepts this and writes a `VaultTransaction` row with `reference: "demo-deposit"` plus increments `EscrowVault.balance` in Prisma. **No USDC approval, no `deposit(uint256)` call, and no MetaMask interaction ever occurs.**

Note: `vault.routes.ts` line 41–44 technically requires `txHash` to be truthy — and the string `"demo-deposit"` satisfies that check — making this a silent false-positive passthrough.

### Secondary Regression: `BuyerDashboard.tsx` — Lines 364–378

```typescript
// BuyerDashboard.tsx line 367
const { data } = await api.withdrawVault(vaultBalance);
```

The "Withdraw All" button calls `POST /api/v1/buyer/vault/withdraw { amount }` with **no `txHash`**. The backend calls `recordCacheWithdraw()` which is self-documented as BUG-03 (vault.service.ts lines 191–202): it only decrements the Prisma cache. No `withdraw(uint256)` call is made on-chain. The backend even returns a `warning` field explaining this, but the frontend ignores it.

### Tertiary Regression: No Frontend Wallet/Contract Integration

A full-text search across all 69 components, 14 hooks, 6 lib files, and 25 pages in `frontend/src` finds **zero occurrences** of:
- `wagmi`, `viem`, `writeContract`, `useContractWrite`, `publicClient`, `simulateContract`, `useWalletClient`
- Any import of the `PersonalEscrowVault.json` ABI or TypeChain types

The frontend has never had (or has had removed) any on-chain signing capability for vault operations. The only on-chain interaction in the entire frontend is the lead-escrow SIWE flow in `useEscrow.ts`, which uses `prepareEscrow`/`confirmEscrow` REST calls (not direct contract calls) for the RTBEscrow, not PersonalEscrowVault.

### Quaternary Regression: Balance Display Uses DB Cache When Env Var Missing

`vault.service.ts` `getVaultInfo()` only reads from the contract when `VAULT_ADDRESS_BASE_SEPOLIA` is set **and** the user has a non-null `walletAddress` in the database. On any RPC failure it silently falls back to the DB cache (line 123). On Render (production), if `VAULT_ADDRESS_BASE_SEPOLIA` was never set or was cleared, every balance read silently returns the DB-fabricated value. There is no UI indicator of whether the displayed balance is on-chain or cached.

### Commit Context

While no git history was inspected, the evidence strongly points to the **"stability and persistence rewrites"** timeline. The self-documenting BUG-03 comment in `recordCacheWithdraw()` and the `// For demo: record deposit via API` comment in `BuyerDashboard.tsx` (line 340) indicate the change was made deliberately as a temporary demo accommodation and never reverted. The reconciliation service and PoR endpoint were added afterward as compensating controls, but the frontend deposit/withdraw flows were never restored to on-chain signing.

---

## Impact on User Fidelity and Exemplary Readiness

1. **User trust**: A buyer who "deposits" $200 USDC via the UI has not transferred any tokens. Their MetaMask balance is unchanged. The Prisma DB shows $200 but the PersonalEscrowVault contract shows $0. If the buyer attempts to bid, `lockForBid()` will call `canBid(wallet, amount)` on-chain and **fail** — correct but confusing, since the UI showed a $200 balance.

2. **Hackathon judging**: The UI text states "Your vault balance is stored on-chain in the PersonalEscrowVault contract." This is false for deposits/withdrawals. A judge who inspects Basescan for the contract address will see zero user activity from the UI, directly contradicting the claim.

3. **Proof of Reserves contradiction**: The `/reserves` and `/verify-por` endpoints make real on-chain calls that will correctly return `solvent: true` (or `false`) based on the contract's own accounting — but since no real deposits were made, `totalDeposited` on-chain will be 0 or whatever was deposited via Hardhat/scripts, not matching any UI-driven deposit amounts.

4. **`lockForBid` / `refundBid` / `settleBid` integrity**: These three backend-only, deployer-signed flows in `vault.service.ts` are genuine on-chain calls. Any bid that reaches auction settlement will attempt to call `lockForBid` on-chain against actual user wallet addresses, fail with "Insufficient on-chain vault balance", and propagate a failed bid state — even though the UI shows a funded vault.

---

## Recommended Minimal Surgical Restore Plan

The goal is to restore real on-chain signing for deposit and withdrawal while **preserving** all of the following without modification:
- Gas-sponsorship pattern (`lockForBid`, `settleBid`, `refundBid` via `DEPLOYER_PRIVATE_KEY`)
- Error handling in `vault.service.ts`
- Prisma persistence and reconciliation job
- UX polish (loading states, toast messages, USDC formatting)
- Balance polling logic
- Proof of Reserves endpoints

### Step 1 — Install wagmi + viem in the frontend

```bash
cd frontend
npm install wagmi viem @tanstack/react-query
```

The project does not currently have these packages. (Verify `frontend/package.json` for any existing wagmi/viem references before installing.)

### Step 2 — Create `frontend/src/hooks/useVault.ts`

This hook encapsulates all PersonalEscrowVault contract interactions for the UI. It reads the contract address and ABI from the backend's `GET /api/v1/buyer/vault/contract` endpoint (already implemented), then uses wagmi's `useWriteContract` + `useWaitForTransactionReceipt` to:

- **`getBalance()`**: `publicClient.readContract({ functionName: 'balanceOf', args: [userWallet] })` — poll every 15 seconds or on every deposit/withdraw confirmation.
- **`handleDeposit(amount)`**: 
  1. Call `publicClient.readContract({ functionName: 'allowance', ...USDC })` to check current USDC allowance.
  2. If allowance < amount: `walletClient.writeContract({ functionName: 'approve', ...USDC, args: [vaultAddress, amountInUnits] })` and wait for receipt.
  3. `walletClient.writeContract({ functionName: 'deposit', args: [amountInUnits] })` and wait for receipt (get real `txHash`).
  4. Call `api.depositVault(amount, txHash)` with the **real transaction hash**.
- **`handleWithdraw(amount)`**:
  1. `walletClient.writeContract({ functionName: 'withdraw', args: [amountInUnits] })` and wait for receipt.
  2. Call `api.withdrawVault(amount, txHash)` with the real `txHash` — the backend route signature needs a `txHash` param added for fidelity.
- **`loadRecentActivity()`**: Continue reading `VaultTransaction` rows from the backend (keep Prisma as the activity log) — but supplement with on-chain event reads from `contract.queryFilter(Deposited/Withdrawn)` if needed. Keep the current backend approach as the primary source; it will be accurate once real txHashes are being recorded.

### Step 3 — Update `BuyerDashboard.tsx` (lines 337–411 only)

Replace the three inline handler closures with calls to the `useVault` hook:

```tsx
// Before
const { data } = await api.depositVault(amt, 'demo-deposit');

// After
await deposit(amt); // from useVault hook — signs on-chain, then records txHash
```

No other part of `BuyerDashboard.tsx` needs to change. The balance display, recent activity list, loading state, and toast messages all remain intact.

### Step 4 — Update `vault.routes.ts` `POST /withdraw` to accept optional `txHash`

Add `txHash` to the request body and forward it to the service for audit trail purposes:

```typescript
// vault.routes.ts line 62 — add txHash
const { amount, txHash } = req.body;
// pass txHash to recordCacheWithdraw so it can replace the synthetic reference
```

Update `recordCacheWithdraw()` to accept and store the real `txHash` instead of `cache-withdraw-${Date.now()}`.

### Step 5 — Add `VAULT_ADDRESS_BASE_SEPOLIA` to Vercel/Render env vars

Confirm the env var `VAULT_ADDRESS_BASE_SEPOLIA=0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4` is set in the production environment. Without it, `vault.service.ts` silently falls back to the DB cache for balance reads.

### Step 6 — Verify Proof of Reserves alignment

After at least one real deposit via MetaMask, call `POST /api/v1/buyer/vault/verify-por` and confirm `solvent: true` with a non-zero `contractBalance`. This validates the full stack end-to-end.

---

## Critical Functions Diff Sketch

### `getBalance` (balance read)

```
BEFORE (regression — DB cache fallback dominant):
  Frontend: api.getVault() → GET /api/v1/buyer/vault
  Backend:  vault.service.getVaultInfo(userId)
              → if(VAULT_ADDRESS && user.walletAddress)
                  contract.balanceOf(wallet)  ← exists but hidden / silently skipped
              → else: return vault.balance (Prisma DB cache, fabricated by demo-deposit writes)

AFTER (correct pattern):
  Frontend: useVault hook → publicClient.readContract({ address: VAULT_ADDRESS, abi, functionName: 'balanceOf', args: [userWallet] })
              → display on-chain balance directly; no REST round-trip for balance read
  Backend:  GET /api/v1/buyer/vault retained for activity log and PoR metadata only
```

### `handleDeposit`

```
BEFORE (regression — fabricated):
  Frontend: setVaultLoading(true)
            api.depositVault(amt, 'demo-deposit')  ← passes literal string, no MetaMask
  Backend:  recordDeposit(userId, amount, 'demo-deposit')
              → prisma.escrowVault.update(balance: +amt)
              → prisma.vaultTransaction.create(reference: 'demo-deposit')
  On-chain: nothing — contract untouched

AFTER (correct):
  Frontend: setVaultLoading(true)
            await usdc.approve(VAULT_ADDRESS, amountInUnits)  ← wagmi writeContract
            await receiptApprove = waitForTransactionReceipt(approveTxHash)
            await vault.deposit(amountInUnits)                ← wagmi writeContract
            await receiptDeposit = waitForTransactionReceipt(depositTxHash)
            api.depositVault(amt, depositTxHash)              ← real txHash recorded
  Backend:  recordDeposit(userId, amount, txHash)
              → prisma writes same as before — now with real txHash
  On-chain: PersonalEscrowVault.Deposited event emitted; balanceOf(user) increases
```

### `handleWithdraw`

```
BEFORE (regression — DB-only):
  Frontend: api.withdrawVault(vaultBalance)
  Backend:  recordCacheWithdraw(userId, amount)  ← self-documented as BUG-03
              → prisma.escrowVault.update(balance: -amount)  ← DB only
  On-chain: nothing — contract untouched

AFTER (correct):
  Frontend: await vault.withdraw(amountInUnits)              ← wagmi writeContract
            await receiptWithdraw = waitForTransactionReceipt(withdrawTxHash)
            api.withdrawVault(amount, withdrawTxHash)        ← real txHash
  Backend:  recordCacheWithdraw(userId, amount, txHash)
              → prisma writes same as before — now with real txHash
              → warning field can be removed once txHash is always provided
  On-chain: PersonalEscrowVault.Withdrawn event emitted; balanceOf(user) decreases
```

### `loadRecentActivity`

```
BEFORE (regression — Prisma rows only, sourced from fake demo-deposit writes):
  Frontend: api.getVault().then(d => setVaultTxs(d.transactions.slice(0,5)))
  Backend:  prisma.vaultTransaction.findMany({ where: vaultId, orderBy: desc, take: 20 })
            → rows contain reference: 'demo-deposit', 'cache-withdraw-{ts}'

AFTER (correct):
  Option A (minimal): Keep exact same Prisma query — once real txHashes are being recorded
                      the rows will contain actual Basescan-verifiable tx hashes;
                      display them as Basescan links in the UI.
  Option B (full):    Supplement with on-chain event scan:
                      publicClient.getLogs({ address: VAULT_ADDRESS, events: [Deposited, Withdrawn] })
                      → merge with DB rows for unified activity stream
  Recommended: Option A for the surgical restore; Option B as a follow-up enhancement.
```

---

*Report generated via full static audit — no code changes made. Last audited: 2026-02-21.*
