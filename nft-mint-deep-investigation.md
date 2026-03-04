# LeadNFTv2 Mint Failure — Deep Investigation

**Run**: `9a2075c3` (6 cycles, $182 settled, all PoR solvent)  
**Symptom**: 0/6 cycles have `nftTokenId` or `mintTxHash` in results JSON → frontend shows "pending" in every NFT column  
**Render logs**: Mix of `NONCE_EXPIRED` and `CALL_EXCEPTION` across runs — 100% mint failure rate

---

## 1. Full Data Flow

```
Settlement loop (demo-orchestrator.ts)
  └── cycleResults.push({...})          // nftTokenId/mintTxHash NOT SET
  └── "Minting LeadNFTs for N settled leads…"
      └── for each cycle:
          └── nftService.mintLeadNFT(leadId)
              ├── prisma.lead.findUnique({id})
              ├── lead.nftTokenId check          // null → proceed
              ├── Build params (platformLeadId, vertical, geo, etc.)
              ├── Pre-flight diagnostics          // passes
              ├── contract.mintLead(10 args, overrides)
              │   ├── ATTEMPT 1: uses ethers default nonce
              │   ├── ON NONCE_EXPIRED: retry with fresh pending nonce
              │   └── ON CALL_EXCEPTION: NOT RETRIED → falls to catch
              ├── tx.wait()                       // ← FAILURE POINT
              │   ├── status:0 → CALL_EXCEPTION
              │   └── OR nonce collision → NONCE_EXPIRED before submission
              └── catch: return { success: false, error: ... }
          └── cr.nftTokenId stays undefined
  └── result built + saved + emitted WITH empty NFT fields
  └── Frontend DemoResults.tsx reads cycle.nftTokenId → null → "pending"
```

---

## 2. Evidence from Render Logs

### Error A: NONCE_EXPIRED (lines 25-39)
```
nonce too low: next nonce 7013, tx nonce 7012
```
- Deployer wallet (0x6BBcf283…) submits mint tx with stale nonce
- Between `contract.mintLead()` encoding and actual tx submission, another tx (refund, bounty, settler) consumed that nonce
- The retry loop handles this: it fetches `getTransactionCount('pending')` and retries
- **But**: if all 3 retries collide, the mint fails permanently

### Error B: CALL_EXCEPTION (lines 248-289)
```
transaction: { data: "", to: "0x73ebD921..." }
gasUsed: 42083, status: 0
reason: null, revert: null
```
- Transaction WAS submitted and mined (block 38401003, index 25)
- Basescan confirms: decoded as "Call Mint Lead Function" → **Fail**
- `data: ""` in the error object is ethers.js stripping calldata from the receipt (Basescan shows real calldata)
- gasUsed 42,083 is consistent with hitting a `require()` early and reverting
- No revert reason returned (Base Sepolia peculiarity or Solidity optimizer strips strings)

### Error C: Missing log entries for run 9a2075c3
- RunId `9a2075c3` does NOT appear in the supplied render logs
- The render logs capture a prior run using the **old fire-and-forget** fallback path
- The new synchronous batch (commit 5f2edc2) is deployed, but render log was captured before that run

---

## 3. Root Cause Analysis

### Primary: `platformLeadId` Collision (Contract `require` revert)

**Contract requirement (LeadNFTv2.sol line 214):**
```solidity
require(_platformLeadToToken[platformLeadId] == 0, "LeadNFTv2: Already tokenized");
```

**How `platformLeadId` is computed (nft.service.ts line 107):**
```typescript
const platformLeadId = ethers.keccak256(ethers.toUtf8Bytes(leadId));
```

**The collision scenario:**
1. Demo run A creates lead with CUID `cmmb2jesl004y...` and mints successfully on-chain → `_platformLeadToToken[keccak256("cmmb2jesl004y...")] = tokenId`
2. DB is cleaned/recycled between runs — `lead.nftTokenId` reset to null
3. Demo run B creates **different** leads with **different** CUIDs (each run generates fresh leads)
4. Each new lead has a unique CUID → unique `platformLeadId` → should NOT collide

**Verdict**: If each demo run creates entirely new leads with fresh CUIDs, platformLeadId collision is **unlikely for new leads**, but:

> [!WARNING]
> The render log line 223 shows `[CRE-DISPATCH] demo fallback mint — leadId=cmmb2jesl004ypvglovi1k9ma` which IS a lead from a **previous run** (different runId, not `9a2075c3`). The old fire-and-forget code (pre-5f2edc2) called `prisma.lead.findFirst({ nftTokenId: null })` — this could match an **OLD lead** that's still in the DB from a prior run. If that old lead was minted on-chain in an even earlier run, its `platformLeadId` exists on-chain but `nftTokenId` was cleared in DB → **collision**.

### Secondary: Deployer Nonce Contention

The deployer wallet (`0x6BBcf283…`) is used for:
- `vault.lockForBid()` — N bids per cycle
- `vault.settleBid()` — 1 per cycle
- `vault.refundBid()` — (N-1) per cycle
- `vault.verifyReserves()` — batched once
- `bountyContract.releaseBounty()` — per bounty cycle
- `nftService.mintLeadNFT()` — per lead

All share the same nonce counter. During peak activity (settlement + refunds + bounties firing), the deployer's pending nonce changes rapidly. The mint call's nonce becomes stale between encoding and submission.

The retry loop in nft.service.ts (lines 164-200) handles `NONCE_EXPIRED` and `REPLACEMENT_UNDERPRICED` but:
- Only 3 retries
- Backoff is 1500ms × attempt for nonce, 500ms for gas
- During a 6-cycle settlement batch, ~30+ deployer txs fire in rapid succession
- **3 retries may not be enough** in high-contention windows

### Tertiary: PolicyEngine Interference

**Contract (line 213):** `runPolicy` modifier runs **before** the function body.  
**PolicyProtectedUpgradeable.sol (line 70-79):** If `policyEngine != address(0)`, calls `IPolicyEngine.run(payload)`.

If the PolicyEngine contract:
- Reverts with no reason (e.g., the called policy contract has a bug or is not deployed correctly)
- Has a `require()` that silently fails
- The policy engine address is set but points to a dead/self-destructed contract

→ The mint call would revert at the `runPolicy` modifier before reaching any `require()`.

**Evidence**: gasUsed=42,083 is quite low. A normal mint (storage writes + Transfer event + URI set) should cost ~130k-200k gas. 42k is consistent with:
- Entering the function frame (~21k base tx cost)
- Executing `runPolicy` → external call to PolicyEngine → revert (~21k for the external call overhead)

> [!CAUTION]
> **This is the most likely culprit.** The PolicyEngine external call is reverting silently. Since Base Sepolia doesn't reliably return revert reasons for failed external calls, the error shows `reason: null`.

---

## 4. Why Manual Tests Succeed But Demo Fails

| Factor | Manual test | Full E2E demo |
|--------|------------|---------------|
| **Nonce contention** | Deployer is idle — clean nonce | 30+ concurrent deployer txs racing |
| **PolicyEngine state** | May test on fresh deploy (no policy engine) | Production contract has PolicyEngine attached |
| **DB lead state** | Fresh lead, never minted on-chain | `findFirst({ nftTokenId: null })` may match old leads already minted on-chain |
| **Gas pricing** | Testnet is quiet | Batch of txs may cause gas price escalation |
| **Timing** | Tx sent in isolation | Mint fires while refunds/bounties are still pending |

---

## 5. Ranked Fix Options (Purest First)

### Option A: Diagnose & Fix PolicyEngine (Purest — address root cause)

**Hypothesis**: The PolicyEngine is causing the silent revert.

**Steps**:
1. **Read the deployed PolicyEngine address** on-chain:
   ```typescript
   const pe = await contract.getPolicyEngine();
   console.log('[NFT] PolicyEngine address:', pe);
   ```
2. **If pe != address(0)**: The PolicyEngine is enforcing a policy that may be rejecting the deployer. Either:
   - Detach it: `contract.attachPolicyEngine(ethers.ZeroAddress)` — allows all mints (ACE enforcement can be re-added later when fully tested)
   - Or fix the policy: ensure the deployer is registered as compliant in ACECompliance
3. **If pe == address(0)**: PolicyEngine is not the issue → move to Option B
4. **Add pre-flight diagnostic**: Before minting, call `contract.getPolicyEngine()` and log it. This is cheap (view call) and will confirm/eliminate the hypothesis immediately.

**Risk**: Low — `attachPolicyEngine(address(0))` just disables policy enforcement, which is already how most test environments run.  
**Impact**: If this IS the root cause, it fixes 100% of CALL_EXCEPTION failures instantly.

### Option B: Serialize Mints with Deployer Nonce Queue (Addresses nonce races)

**Hypothesis**: Nonce contention is the primary failure mode.

**Steps**:
1. **Use the existing `getNextNonce()` from demo-shared.ts** (already serializes deployer nonce allocation) for NFT mints
2. **Wait until all settlement txs confirm** before starting the mint batch (already the case with post-settlement timing)
3. **Increase retry count** from 3 to 5, with exponential backoff (2s, 4s, 8s, 16s)
4. **Add CALL_EXCEPTION to retry list** — reverts may be transient (nonce collision that gets mined with wrong nonce → revert)

**Risk**: Medium — serialized nonce allocation is already used for other ops but mint was not integrated.  
**Impact**: Reduces nonce collisions but may not fix CALL_EXCEPTION if it's a contract-level `require()`.

### Option C: Deferred Mint with DB Hydration (Pragmatic fallback)

**Hypothesis**: Mints inherently race with settlement; defer them entirely.

**Steps**:
1. **Remove synchronous mint from the settlement flow** — let results emit without NFT data
2. **Add a post-demo "mint sweep" job** that runs 15-30s after demo completion:
   - Query `Lead WHERE nftTokenId IS NULL AND source='DEMO' AND status='SOLD'`
   - Mint each one sequentially when deployer wallet is idle (no nonce races)
   - Update `cycleResults` in saved JSON after each successful mint
3. **Frontend polls/refreshes** every 10s after initial load — once NFT data appears in JSON, badge updates from "pending" → "Minted #N ✓"

**Risk**: Higher complexity — requires polling, deferred execution, and JSON re-save.  
**Impact**: Guarantees mints succeed (no nonce contention) but adds delay + complexity.

---

## 6. Impact If Left Unfixed

| Aspect | Impact |
|--------|--------|
| **Judge impression** | Every demo shows "pending" in NFT column despite LeadNFTv2 being a flagship feature. Judges may assume NFT tokenization is broken or fake. |
| **Technical credibility** | CRE-DISPATCH workflow + on-chain quality scores rely on the NFT tokenId existing. Without it, the "Chainlink CRE → on-chain quality" story has no proof. |
| **Basescan screenshot** | No token page link = no visual proof of on-chain lead ownership. This is a major demo narrative miss. |
| **Scoring** | Hackathon scoring likely values working on-chain artifacts. A "pending" badge in every row suggests the feature is incomplete. |

> [!IMPORTANT]
> **Recommendation**: Start with Option A (diagnose PolicyEngine — 5 minutes of diagnostic logging). If PolicyEngine is the issue, detaching it fixes everything instantly. If not, apply Option B (nonce queue integration + expanded retries). Option C is the last resort if mints fundamentally cannot coexist with the settlement flow.

---

## 7. Immediate Diagnostic Steps (Before Code Changes)

1. **Add one view call before mint**:
   ```typescript
   const pe = await this.contract!.getPolicyEngine();
   console.log('[NFT MINT] PolicyEngine address:', pe);
   ```
   → If `pe != 0x0`, that's almost certainly the blocker.

2. **Check on Basescan**: Visit `https://sepolia.basescan.org/address/0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155#readContract` and read `getPolicyEngine()` directly.

3. **Check `_platformLeadToToken`**: For a known demo lead CUID, call `getLeadByPlatformId(keccak256(leadId))` on Basescan — if it returns a nonzero tokenId, that lead was minted in a previous run and on-chain state was never cleaned.
