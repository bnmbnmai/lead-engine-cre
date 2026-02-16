# Tech Debt & Hacky Workarounds

> Comprehensive audit of shortcuts, off-chain fallbacks, incorrect wallet usage,
> and non-ideal patterns shipped to "make things work quickly."  
> Prioritized: 🔴 Critical → 🟡 Medium → 🟢 Low.

---

## 🔴 Critical — On-Chain Integrity

### TD-01 · Deployer wallet pays for all on-chain actions (not the actual buyer/seller)

**Files:**  
- [`x402.service.ts:56-73`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/x402.service.ts#L56-L73)  
- [`nft.service.ts:63-73`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/nft.service.ts#L63-L73)

**Why it's hacky:**  
Both X402Service and NFTService use a single `DEPLOYER_PRIVATE_KEY` as the signer for *all* on-chain operations — escrow creation, funding, release, NFT minting, and sale recording. The deployer pays gas and acts *as* the buyer when funding escrow. There is no user-signed transaction flow.

**Impact:** The on-chain escrow records `deployer` as the entity funding the escrow, *not* the actual buyer's MetaMask wallet. This breaks the trust model — a judge inspecting Etherscan sees the deployer paying itself, not a real buyer → seller flow.

**Recommended fix:**  
Implement a client-side signing flow:
1. Backend prepares the unsigned tx (or EIP-712 typed data).
2. Frontend signs with the buyer's MetaMask wallet via `signer.sendTransaction()`.
3. Backend verifies the on-chain receipt.

---

### TD-02 · Off-chain fallbacks silently bypass real on-chain behavior

**Files:**  
- [`nft.service.ts:201-212`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/nft.service.ts#L201-L212) — `offchain-${Date.now()}` pseudo-tokenId  
- [`nft.service.ts:226,239-240`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/nft.service.ts#L226-L240) — `recordSaleOnChain` silently succeeds off-chain  
- [`nft.service.ts:303,314`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/nft.service.ts#L303-L314) — `updateQualityScoreOnChain` silently succeeds off-chain  
- [`x402.service.ts:348-353`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/x402.service.ts#L348-L353) — `refundPayment` updates DB only when off-chain  
- [`x402.service.ts:388-398`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/x402.service.ts#L388-L398) — `getPaymentStatus` falls back to DB status  

**Why it's hacky:**  
When contract/signer env vars are missing, every on-chain function returns `{ success: true }` with fake IDs. The caller never knows the action was a no-op. The `offchain-` prefix sentinel is then sprinkled everywhere as a guard (`!nftTokenId.startsWith('offchain-')`) to skip real on-chain calls.

**Recommended fix:**  
1. Make missing env vars a hard startup error (or at least log bold warnings and set a `isOnChainMode` flag).
2. Return `{ success: false, error: 'OFF_CHAIN_MODE' }` instead of silently succeeding.
3. Expose an `/api/v1/status` endpoint that shows which on-chain features are enabled.
4. Remove the `offchain-` sentinel pattern — use a proper `isOnChain: boolean` DB column on `Lead` and `Transaction`.

---

### TD-03 · Sequential on-chain escrow scan (loop 1–50)

**File:** [`x402.service.ts:299-316`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/x402.service.ts#L299-L316)

**Why it's hacky:**  
`findEscrowByLeadId` brute-force loops `getEscrow(1)` → `getEscrow(50)` making up to 50 RPC calls to find an existing escrow. This is an O(n) linear scan against the blockchain.

**Recommended fix:**  
Listen for `EscrowCreated(uint256 escrowId, string leadId)` events or store the `escrowId ↔ leadId` mapping in the DB at creation time. The event filter approach: `contract.queryFilter(contract.filters.EscrowCreated(null, leadId))`.

---

### TD-04 · USDC balance/allowance check uses DB wallet, not session wallet

**File:** [`bidding.routes.ts:643-686`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/bidding.routes.ts#L643-L686)

**Why it's hacky:**  
The `/buyer/usdc-allowance` endpoint reads `user.walletAddress` from the DB (`prisma.user.findUnique`). If the user originally registered with a demo wallet and later connects with a different MetaMask wallet, the allowance check queries the *wrong* address. The session's authenticated wallet (`req.user.walletAddress`) should be used instead.

**Recommended fix:**  
Use `req.user!.walletAddress` (from JWT/session) instead of re-fetching from DB. Compare session wallet vs. DB wallet at login-time and update the DB record if they don't match.

---

### TD-05 · NFT mint and recordSale are non-fatal ("best-effort")

**File:** [`demo-panel.routes.ts:1290-1322`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L1290-L1322)

**Why it's hacky:**  
Both `mintLeadNFT()` and `recordSaleOnChain()` are wrapped in `try/catch` that log `(non-fatal)` warnings and continue. The settlement endpoint returns success even if the NFT mint reverts or sale recording fails. The buyer's settlement experience shows ✅ even when the NFT doesn't exist.

**Recommended fix:**  
1. For a demo: Acceptable, but surface the partial failure in the response (`nftMinted: false`).
2. For production: NFT mint should be required for settlement completion. Use a multi-step status: `SETTLED` → `NFT_MINTED`.

---

## 🔴 Critical — Demo Infrastructure Leaking into Production

### TD-06 · Demo buyers toggle is in-memory only (resets on restart, defaults to ON)

**File:** [`demo-panel.routes.ts:67`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L67)

**Why it's hacky:**  
`let demoBuyersEnabled = true` — the toggle starts as `true` every time the server restarts. If a user toggles it OFF and the server restarts (Render auto-scale, deploy, crash…), demo buyers are silently re-enabled. This global mutable variable is also imported by `auto-bid.service.ts` (line 96) and `engine.ts` (line 274) via dynamic `await import()`.

**Impact:** Even with the toggle OFF, a server restart re-enables bot bids. The user sees unexpected demo bids after a deploy.

**Recommended fix:**  
Persist the toggle in Redis or a DB `config` table. Read on startup. Default to `false` in production.

---

### TD-07 · Demo buyers scheduled via fire-and-forget `setTimeout` (no cancellation)

**File:** [`demo-panel.routes.ts:959-990`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L959-L990)

**Why it's hacky:**  
When "Start Live Auction" is clicked, 3 demo bids are scheduled at 5s, 15s, 30s via raw `setTimeout`. These timers:
- Cannot be cancelled if the user toggles demo buyers OFF mid-auction.
- Survive even if the auction is manually resolved or cleared early.
- Have no reference tracking — the HTTP response returns before bids are placed.
- Use a stale closure over `currentBid` that can drift if multiple auctions overlap.

**Recommended fix:**  
Use a proper scheduled job system (e.g., BullMQ with Redis) or at minimum track timer IDs and cancel them on toggle-OFF or auction resolution.

---

### TD-08 · `consentProof` field hijacked as demo data tag

**Files:**  
- [`demo-panel.routes.ts:32,475-529,683,829,918`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L32)

**Why it's hacky:**  
The `consentProof` column — semantically for TCPA/consent proof — is overloaded with `'DEMO_PANEL'` as a tag to identify demo data. This corrupts the consent audit trail and makes it impossible to distinguish "no consent proof" from "demo lead".

**Recommended fix:**  
Add a `demoTag` or `source: 'DEMO'` column to the `Lead` model. Use `source` enum (`PLATFORM`, `API`, `OFFSITE`, `DEMO`) or a boolean `isDemo` flag.

---

### TD-09 · "Clear Demo Data" actually deletes ALL data (not just demo data)

**File:** [`demo-panel.routes.ts:743-771`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L743-L771)

**Why it's hacky:**  
The `/clear` endpoint runs `prisma.bid.deleteMany({})`, `prisma.lead.deleteMany({})`, etc. with **no where clause**. It nukes all marketplace data, not just demo-tagged records. The button text says "Clear Demo Data" but it wipes everything.

**Recommended fix:**  
Use `where: { consentProof: DEMO_TAG }` (or the proper `isDemo` flag from TD-08) to scope deletions to demo-only records.

---

### TD-10 · Settlement endpoint auto-creates missing Transaction records (recovery hack)

**File:** [`demo-panel.routes.ts:1141-1221`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L1141-L1221)

**Why it's hacky:**  
If no Transaction record exists (because auction resolution failed or was skipped), the settle endpoint:
1. Searches for any `SOLD` or `UNSOLD` lead with a bid.
2. Corrects the lead status `UNSOLD → SOLD`.
3. Corrects the bid status `OUTBID → ACCEPTED`.
4. Creates a Transaction record inline.

This masks the root cause (auction resolution failing due to USDC check) and produces inconsistent DB state.

**Recommended fix:**  
Fix the USDC check (see TD-04) so auction resolution always creates a Transaction. The settle endpoint should require a valid Transaction and fail loudly if none exists.

---

## 🟡 Medium — Architecture & Security

### TD-11 · Privacy encryption key is random on every restart if env var is unset

**File:** [`privacy.service.ts:9`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/privacy.service.ts#L9)

**Why it's hacky:**  
`const ENCRYPTION_KEY = process.env.PRIVACY_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');`

If the env var is not set, every server restart generates a new key. All previously encrypted PII (lead contact info, bid amounts) becomes permanently unrecoverable. Encrypted data in the DB is now garbage.

**Recommended fix:**  
Make `PRIVACY_ENCRYPTION_KEY` a **required** env var. Fail server startup if not set. Add a startup check with a descriptive error message.

---

### TD-12 · USDC approve uses 10× amount (over-approval)

**File:** [`x402.service.ts:134`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/x402.service.ts#L134)

**Why it's hacky:**  
`this.usdcContract.approve(ESCROW_CONTRACT_ADDRESS, amountWei * 10n)` — approves 10× the required amount. This is a security shortcut to avoid re-approving on subsequent escrows, but it leaves a large unlimited allowance on the contract.

**Recommended fix:**  
Approve the exact amount needed (`amountWei`). Or use `type(uint256).max` approval once with an explicit opt-in from the user.

---

### TD-13 · Hardcoded gas limit (500k for mint, 200k for sale)

**Files:**  
- [`nft.service.ts:158`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/nft.service.ts#L158) — `{ gasLimit: 500_000 }`  
- [`nft.service.ts:229`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/nft.service.ts#L229) — `{ gasLimit: 200_000 }`

**Why it's hacky:**  
Hardcoded gas limits bypass `estimateGas` entirely. If the contract changes or the gas cost varies, these will either waste ETH or revert silently.

**Recommended fix:**  
Use `estimateGas` with a 20% buffer: `const gas = await contract.mintLead.estimateGas(...args); const gasLimit = gas * 120n / 100n;`. Fall back to the hardcoded value only if estimation reverts.

---

### TD-14 · Hardcoded Sepolia chain ID

**File:** [`x402.service.ts:277`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/x402.service.ts#L277)

**Why it's hacky:**  
`chainId: 11155111` is hardcoded in the Transaction update. If the app is redeployed to Base Sepolia, Polygon Amoy, or mainnet, this value will silently be wrong.

**Recommended fix:**  
Read the chain ID from the RPC provider: `const { chainId } = await this.provider.getNetwork();`.

---

### TD-15 · DemoPanel hardcodes fallback wallet addresses

**File:** [`DemoPanel.tsx:249-254`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/components/demo/DemoPanel.tsx#L249-L254)

**Why it's hacky:**  
When the demo-login API call fails, the frontend falls back to hardcoded wallet addresses:
```ts
walletAddress: persona === 'buyer'
  ? '0x424CaC929939377f221348af52d4cb1247fE4379'
  : '0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70',
```
This creates a localStorage-only persona with no real JWT, which causes auth failures on subsequent API calls.

**Recommended fix:**  
Remove the fallback. Show an error toast and don't set auth state if the demo-login fails.

---

### TD-16 · DEMO_WALLETS and FAUCET_WALLETS overlap

**File:** [`demo-panel.routes.ts:35-57`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L35-L57)

**Why it's hacky:**  
`DEMO_WALLETS.BUYER_1` = `0x88DDA5D...` is the same as `FAUCET_WALLETS[2]` and `DEMO_WALLETS.PANEL_USER`. `DEMO_WALLETS.BUYER_2` = `0x424CaC...` is `FAUCET_WALLETS[3]`. This means a demo buyer's wallet is the same as a faucet seller's wallet. In auction resolution, the "buyer" and "seller" can be the same address, which breaks escrow semantics.

**Recommended fix:**  
Designate wallets 1-5 as seller-only and wallets 6-10 as buyer-only. Ensure no overlap.

---

## 🟡 Medium — Data Model Issues

### TD-17 · Auto-bid places bids with `amount` AND `commitment`, breaking sealed-bid semantics

**File:** [`auto-bid.service.ts:239-248`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/auto-bid.service.ts#L239-L248)

**Why it's hacky:**  
Auto-bids store both the actual `amount` and the `commitment` hash at creation time in `PENDING` status. In a real sealed-bid auction, the `amount` should only appear after the `REVEAL` phase. Storing it immediately means anyone with DB access can see the bid amount before reveal.

**Recommended fix:**  
Store only `commitment` and `salt` during the commit phase. Auto-reveal after the auction window closes, the same way manual bids work.

---

### TD-18 · Demo bids skip commit-reveal entirely (created with status='REVEALED')

**File:** [`demo-panel.routes.ts:964-971`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L964-L971)

**Why it's hacky:**  
Demo auction bids are created directly with `status: 'REVEALED'` and a plain `amount`, completely bypassing the commit-reveal protocol. No `commitment`, no `salt`, no encrypted bid. The auction resolution logic then treats these as valid revealed bids.

**Recommended fix:**  
Use `privacyService.encryptBid()` to create a proper commitment, store it as `PENDING`, then reveal at auction end. This makes the demo flow match the production flow.

---

### TD-19 · `parameters` JSON field used as a dumping ground for demo tags

**File:** [`demo-panel.routes.ts:616`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L616) — `parameters: { _demoTag: DEMO_TAG }`

**Why it's hacky:**  
The `Ask.parameters` JSON field has an internal `_demoTag` key injected to identify demo asks. This pollutes the user-facing parameters with internal metadata.

**Recommended fix:**  
Use a proper `source` or `isDemo` flag column on the `Ask` model, consistent with the `Lead` model fix (TD-08).

---

## 🟢 Low — Quality of Life

### TD-20 · Auto-bid USDC allowance check swallows RPC errors

**File:** [`auto-bid.service.ts:216-219`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/auto-bid.service.ts#L216-L219)

**Why it's hacky:**  
```ts
catch (err: any) {
    // Graceful fallback: don't block auto-bids on RPC errors
    console.warn(`…Proceeding anyway.`);
}
```
If the RPC is down or the contract address is wrong, the auto-bid proceeds without money verification. This can lead to bids that can never be funded.

**Recommended fix:**  
Make the USDC check a hard gate in production. Only gracefully skip in development/demo mode.

---

### TD-21 · Hardcoded `'https://eth-sepolia.g.alchemy.com/v2/demo'` fallback RPC

**Files:**  
- [`x402.service.ts:11`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/x402.service.ts#L11)  
- [`nft.service.ts:10`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/nft.service.ts#L10)  
- [`auto-bid.service.ts:26`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/auto-bid.service.ts#L26)  
- [`bidding.routes.ts:636`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/bidding.routes.ts#L636)

**Why it's hacky:**  
The `/demo` API key has strict rate limits and will silently fail under load.

**Recommended fix:**  
Make `RPC_URL_SEPOLIA` a required env var. Remove the demo fallback. Add a health check that tests the RPC connection on startup.

---

### TD-22 · `getLeadMetadata` called but may not exist in contract ABI

**File:** [`nft.service.ts:251`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/nft.service.ts#L251)

**Why it's hacky:**  
`getTokenMetadata` calls `this.contract.getLeadMetadata(nftTokenId)`, but `getLeadMetadata` is not in the `LEAD_NFT_ABI` array at the top of the file. This will always revert and fall through to the DB fallback — the on-chain metadata path is dead code.

**Recommended fix:**  
Add `getLeadMetadata` to the ABI, or remove the dead on-chain path.

---

### TD-23 · Platform fee hardcoded at 2.5%

**File:** [`demo-panel.routes.ts:1201`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L1201)

**Why it's hacky:**  
`platformFee: bidAmount * 0.025` is applied in the auto-created Transaction, completely disconnected from the on-chain `platformFeeBps()` value.

**Recommended fix:**  
Read `platformFeeBps` from the escrow contract and derive the fee: `const bps = await this.escrowContract.platformFeeBps(); const fee = amount * Number(bps) / 10000;`.

---

### TD-24 · No PII encryption at rest for demo-injected leads

**File:** [`demo-panel.routes.ts:819-834`](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L819-L834)

**Why it's hacky:**  
Demo leads are created without any `encryptedData` or `dataHash`. When the frontend checks for PII it finds nothing — the PII display relies on a separate "normalize PII" endpoint call. Real submitted leads would have `encryptedData` set by the privacy service.

**Recommended fix:**  
Call `privacyService.encryptLeadPII()` when creating demo leads, store in `encryptedData/dataHash`, matching the production flow.

---

## Summary

| Severity | Count | Quick Wins |
|----------|-------|------------|
| 🔴 Critical | 10 | TD-04 (DB→session wallet), TD-06 (persist toggle), TD-09 (scope clear) |
| 🟡 Medium | 7 | TD-11 (require env var), TD-14 (read chainId), TD-15 (remove fallback) |
| 🟢 Low | 7 | TD-21 (require RPC url), TD-22 (fix ABI), TD-23 (read on-chain fee) |
