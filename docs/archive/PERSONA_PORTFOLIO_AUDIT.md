# PERSONA_PORTFOLIO_AUDIT.md

> Deep investigation: why the Buyer persona's Portfolio and My Bids pages remain empty after 1-click demo

---

## 1. Executive Summary

The Buyer persona sees **zero leads** in Portfolio / My Bids because of a **three-part identity chain break** between:
- The wallet the settlement loop creates the Prisma `Bid` record for,
- The wallet the demo-login authenticates the Buyer persona JWT with, and
- How PostgreSQL matches wallet address strings (case-sensitive).

The demo is doing everything correctly on-chain (locking, settling, refunding), but the DB `Bid` record that links the win to the persona's `userId` is either **not created at all** or **created for the wrong user**.

---

## 2. Root Cause Analysis

### RC-1: `connectedWallet` Override Hijacks Persona Identity

**Files:** `DemoPanel.tsx:328`, `demo-panel.routes.ts:112-114`

When the user switches to Buyer persona, the frontend sends:

```typescript
// DemoPanel.tsx:328
body: JSON.stringify({ role, connectedWallet: address })
```

where `address` is the user's MetaMask wallet from `useAccount()`. The backend handles:

```typescript
// demo-panel.routes.ts:112-114
const walletAddress = isBuyer && connectedWallet
    ? connectedWallet.toLowerCase()   // ← uses MetaMask wallet, NOT persona wallet
    : isBuyer ? DEMO_WALLETS.BUYER    // ← only used when MetaMask NOT connected
    : DEMO_WALLETS.PANEL_USER;
```

**Impact:** If the user has MetaMask connected (e.g. to `0xABC...`), the JWT's `userId` will be for that MetaMask wallet — **not** for `0x424CaC...` (the persona wallet). Meanwhile, the settlement loop always creates the `Bid` record against `0x424CaC...`'s `userId`. The two IDs don't match → `GET /bids/my` returns zero bids.

**Even if MetaMask is disconnected**, the `address` value from `useAccount()` may be `undefined`, causing `connectedWallet` to be falsy, which falls through to `DEMO_WALLETS.BUYER`. But this leads to RC-2.

### RC-2: Wallet Address Case Sensitivity (PostgreSQL)

**Files:** `auth.routes.ts:32,38,83`, `demo-panel.routes.ts:114`, `demo-orchestrator.ts:1087`, `demo-shared.ts:76`

The system has **two code paths** that store `walletAddress` in different cases:

| Code Path | Address Stored |
|-----------|---------------|
| SIWE login (`auth.routes.ts:38`) | `address.toLowerCase()` = `0x424cac...` |
| Demo login, no MetaMask (`demo-panel.routes.ts:114`) | `DEMO_WALLETS.BUYER` = `0x424CaC...` |
| Settlement user lookup (`demo-orchestrator.ts:1087`) | `buyerWallet` = `0x424CaC...` from lock registry |

PostgreSQL's default collation is **case-sensitive**. This means:

```typescript
// demo-orchestrator.ts:1086-1088  — settlement Bid creation
const winnerUser = await prisma.user.findFirst({
    where: { walletAddress: buyerWallet },  // '0x424CaC...' (mixed case)
});
```

If the User was originally created by SIWE with `0x424cac...` (lowercase), this `findFirst` returns **`null`**, and the `Bid` record is **never created** (silently caught at line 1114).

**Scenario A (most common):** User previously connected MetaMask wallet `0x424CaC...` via SIWE → User stored with lowercase `0x424cac...` → Settlement lookup with mixed case fails → `winnerUser = null` → no Bid record.

**Scenario B:** User never used SIWE → demo-login creates User with mixed case `0x424CaC...` → Settlement lookup works → Bid created → **but RC-1 kicks in if MetaMask is connected** and the JWT is for a different user.

### RC-3: Settlement Uses `buyerWallet` from Registry, Not a Normalized Lookup

**File:** `demo-orchestrator.ts:1018, 1086-1088`

```typescript
// Line 1018 — winner determination
const buyerWallet = winnerEntry?.addr ?? DEMO_BUYER_WALLETS[0];

// Line 1086-1088 — DB Bid creation (inside try/catch that swallows errors)
const winnerUser = await prisma.user.findFirst({
    where: { walletAddress: buyerWallet },
});
```

The `winnerEntry.addr` comes from `scheduleBidsForLead` which sets `addr: buyerAddr` directly from `DEMO_BUYER_WALLETS` (mixed case, e.g. `'0x424CaC929939377f221348af52d4cb1247fE4379'`). There is **no `.toLowerCase()` normalization** before the Prisma lookup.

### RC-4: Silent Error Swallowing

**File:** `demo-orchestrator.ts:1114-1116`

```typescript
} catch (bidRecordErr: any) {
    console.warn(`[DEMO] Bid record creation failed (non-fatal): ${bidRecordErr.message?.slice(0, 80)}`);
}
```

When any of the above mismatches cause the Bid creation to fail, the error is logged as a `console.warn` but **never surfaced to the demo log panel or socket events**. The demo appears to succeed, but no DB record is created.

---

## 3. Tracing the Full Chain

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND: DemoPanel.tsx:handlePersonaSwitch('buyer')              │
│  → POST /demo-login { role:'BUYER', connectedWallet: address }    │
│  → address = MetaMask wallet (e.g. 0xABC...) or undefined         │
└────────────┬────────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────────┐
│  BACKEND: demo-panel.routes.ts:106-200  /demo-login               │
│  if connectedWallet → walletAddress = connectedWallet.toLowerCase()│
│  else → walletAddress = DEMO_WALLETS.BUYER = '0x424CaC...'        │
│  → findFirst({ walletAddress }) → create if not found              │
│  → JWT { userId: user.id, walletAddress }                          │
│                                                                    │
│  ⚠️ RC-1: userId may be for MetaMask wallet, NOT persona wallet   │
│  ⚠️ RC-2: Mixed-case can miss lowercase user record               │
└────────────┬────────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────────┐
│  BACKEND: demo-orchestrator.ts:1086-1113  Settlement Bid Creation  │
│  buyerWallet = winnerEntry.addr = '0x424CaC...' (mixed case)       │
│  winnerUser = prisma.user.findFirst({ walletAddress: buyerWallet })│
│                                                                    │
│  ⚠️ RC-2: If DB has '0x424cac...' → findFirst returns null         │
│  ⚠️ RC-3: No .toLowerCase() normalization                          │
│  → if winnerUser is null → Bid NOT created (silently swallowed)    │
│  → if winnerUser found → buyerId: winnerUser.id                    │
│                                                                    │
│  ⚠️ RC-1: Even if Bid IS created, buyerId may differ from the     │
│           JWT userId that GET /bids/my uses to query                │
└────────────┬────────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────────┐
│  BACKEND: bidding.routes.ts:302-311  GET /bids/my                  │
│  prisma.bid.findMany({ where: { buyerId: req.user!.id } })        │
│                                                                    │
│  req.user.id = JWT userId (from demo-login)                        │
│  ⚠️ If Bid.buyerId ≠ JWT userId → returns 0 results               │
└────────────┬────────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────────┐
│  FRONTEND: BuyerPortfolio.tsx:128-133                              │
│  api.getMyBids() → bids.filter(b => b.status === 'ACCEPTED')      │
│  → empty array → "No purchased leads yet"                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Recommended Robust Fix

### Fix 1: Normalize all wallet addresses to lowercase (5 files)

Every wallet address stored in / queried from the DB must be `.toLowerCase()`.

#### `demo-panel.routes.ts` (Line 114)
```diff
-    : isBuyer ? DEMO_WALLETS.BUYER : DEMO_WALLETS.PANEL_USER;
+    : isBuyer ? DEMO_WALLETS.BUYER.toLowerCase() : DEMO_WALLETS.PANEL_USER.toLowerCase();
```

#### `demo-orchestrator.ts` (Line 1087)
```diff
 const winnerUser = await prisma.user.findFirst({
-    where: { walletAddress: buyerWallet },
+    where: { walletAddress: buyerWallet.toLowerCase() },
 });
```

#### `demo-shared.ts` (Lines 56-67, 76)
Lowercase all entries in `DEMO_BUYER_WALLETS` and `BUYER_PERSONA_WALLET`:
```diff
 export const DEMO_BUYER_WALLETS = [
-    '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9',
+    '0xa75d76b27ff9511354c78cb915cfc106c6b23dd9',
     // ... all 10 entries lowercased
 ];
```
*(Or do `DEMO_BUYER_WALLETS.map(w => w.toLowerCase())` once.)*

### Fix 2: Force persona wallet on demo-login, ignore MetaMask (1 file)

When switching to the Buyer persona via the demo panel, the intent is to simulate the AI agent's wallet — NOT the user's MetaMask wallet. The demo-login should always use the persona wallet.

#### `demo-panel.routes.ts` (Lines 112-114)
```diff
-const walletAddress = isBuyer && connectedWallet
-    ? connectedWallet.toLowerCase()
-    : isBuyer ? DEMO_WALLETS.BUYER : DEMO_WALLETS.PANEL_USER;
+// Always use the persona wallet for demo login (ignore MetaMask).
+// The whole point of persona switching is to authenticate AS the demo wallet.
+const walletAddress = (isBuyer ? DEMO_WALLETS.BUYER : DEMO_WALLETS.PANEL_USER).toLowerCase();
```

### Fix 3: Emit Bid creation failures to demo log (1 file)

#### `demo-orchestrator.ts` (Lines 1114-1116)
```diff
 } catch (bidRecordErr: any) {
-    console.warn(`[DEMO] Bid record creation failed (non-fatal): ${bidRecordErr.message?.slice(0, 80)}`);
+    const errMsg = bidRecordErr.message?.slice(0, 120) || 'unknown';
+    console.warn(`[DEMO] Bid record creation failed: ${errMsg}`);
+    emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ DB Bid record creation failed: ${errMsg}` });
 }
```

### Fix 4: Case-insensitive fallback on `findFirst` (defense in depth)

#### `demo-orchestrator.ts` (Line 1087)
```diff
 const winnerUser = await prisma.user.findFirst({
-    where: { walletAddress: buyerWallet },
+    where: { walletAddress: { equals: buyerWallet.toLowerCase(), mode: 'insensitive' } },
 });
```

---

## 5. Testing Steps

1. **Run 1-click demo** — observe DevLog panel for:
   - `🎯 Buyer persona wallet won lead cmmXXXX…`
   - `📝 DB bid record created for 0x424cac…`
   - ❌ **No** `⚠️ DB Bid record creation failed` messages

2. **Switch to Buyer persona** (via demo panel)

3. **Navigate to Portfolio** (`/buyer/portfolio`)
   - ✅ At least one lead should appear with status ACCEPTED
   - ✅ Lead card shows vertical, geo, CRE quality badge

4. **Navigate to My Bids** (`/buyer/dashboard`)
   - ✅ "Purchased Leads" section shows won leads
   - ✅ Recent Bids list includes ACCEPTED entries

5. **Decrypt PII** on a won lead
   - ✅ Click "Decrypt PII" → real contact info appears

6. **Verify with different MetaMask state:**
   - Test with MetaMask connected to a different wallet → Portfolio still shows persona wins
   - Test with MetaMask disconnected → Portfolio still shows persona wins

---

## 6. Affected Files Summary

| File | Issue | Fix |
|------|-------|-----|
| `demo-panel.routes.ts:112-114` | `connectedWallet` overrides persona wallet | Always use persona wallet |
| `demo-panel.routes.ts:114` | Mixed-case stored in DB | `.toLowerCase()` |
| `demo-orchestrator.ts:1087` | Case-sensitive Prisma lookup | `.toLowerCase()` + `mode: 'insensitive'` |
| `demo-shared.ts:56-76` | `DEMO_BUYER_WALLETS` stored mixed-case | Lowercase all entries |
| `demo-orchestrator.ts:1114` | Error silently swallowed | Emit to demo log |
| `DemoPanel.tsx:328` | Sends MetaMask `address` as `connectedWallet` | *(Fixed by backend ignoring it)* |
