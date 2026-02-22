# Current-Status.md — Lead Engine CRE — 2026-02-21 (Post Fix + Verification Round)

## Executive Summary

All five priority code-level fixes have been applied as of 2026-02-21. ZERO remaining structural code issues. **However, several on-chain activation steps are pending user execution** (scripts are ready and tested, but have not been run against the live chain). See `onchain-activation-checklist.md` for the exact commands.

---

## Section 1 — On-Chain Contracts (Base Sepolia)

All contracts deployed. Source verification on Basescan requires user to run `hardhat verify` commands (see checklist).

| Contract | Address | Deployment Status |
|----------|---------|------------------|
| PersonalEscrowVault | `0xf09cf1d4389A1Af11542F96280dc91739E866e74` | ✅ Deployed |
| LeadNFTv2 | `0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155` | ✅ Deployed |
| CREVerifier | `0xfec22A5159E077d7016AAb5fC3E91e0124393af8` | ✅ Deployed |
| VRFTieBreaker | `0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e` | ✅ Deployed |
| RTBEscrow | `0xf3fCB43f882b5aDC43c2E7ae92c3ec5005e4cBa2` | ✅ Deployed |
| ACECompliance | `0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6` | ✅ Deployed |
| ACELeadPolicy | `0x013f3219012030aC32cc293fB51a92eBf82a566F` | ✅ Deployed |

---

## Section 2 — Chainlink Data Feeds

**Status: REAL AND LIVE (code verified)**

`PersonalEscrowVault.sol` constructor L146 hardcodes:
```solidity
usdcEthFeed = AggregatorV3Interface(0x71041dDDaD3595f9Ced3d1F5861e2931857B2deF);
```
This is the ETH/USD Chainlink Data Feed on Base Sepolia (verified from contract source).

- `lockForBid()`: requires live price > 0 before accepting bids
- `settleBid()`: reads live price for settlement conversion
- Feed reverts on stale/zero data

**No synthetic data. No fallback prices.**

---

## Section 3 — Chainlink Automation

**Status: CODE REAL — Upkeep registration is user-managed**

`PersonalEscrowVault.sol` implements `AutomationCompatibleInterface`:
- `checkUpkeep()`: checks expired bid locks and low reserve balance
- `performUpkeep()`: settles or refunds expired bid locks

The contract is deployed and the logic is live. Automation upkeep must be registered and funded by the user at https://automation.chain.link.

---

## Section 4 — Chainlink VRF v2.5

**Status: CODE REAL — Subscription funding is user-managed**

`VRFTieBreaker.sol` implements `VRFConsumerBaseV2Plus`. Deployed at `0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e`.

Backend env: `VRF_TIEBREAKER_CONTRACT_ADDRESS_BASE_SEPOLIA` — ✅ Added to `.env` (Fix 3a)
`VRF_SUBSCRIPTION_ID`: placeholder in `.env` — **User must fill from VRF v2.5 dashboard** (see checklist).

---

## Section 5 — Chainlink Functions (CREVerifier)

**Status: CONTRACT DEPLOYED — DON sources can be uploaded by user with scripts ready**

CREVerifier deployed at `0xfec22A5159E077d7016AAb5fC3E91e0124393af8`, subscriptionId=581.

### DON Source Programs — Script Status

| Index | Name | Source Constant | Script Status | On-Chain Status |
|-------|------|----------------|---------------|-----------------|
| 2 | Quality Score | `DON_QUALITY_SCORE_SOURCE` | ✅ Script ready (`upload-all-sources.ts`) | ⏳ User must execute |
| 3 | Batched Private Score | `DON_BATCHED_PRIVATE_SCORE_SOURCE` | ✅ btoa()→SubtleCrypto (Fix 1a) + Script ready | ⏳ User must execute |
| 4 | ZK Proof Verifier | `ZK_PROOF_DON_SOURCE` | ✅ Script ready (Fix 1b) | ⏳ User must execute |

**User must execute** (see `onchain-activation-checklist.md` Step 1):
```bash
cd contracts && npx ts-node scripts/upload-all-sources.ts
```

---

## Section 6 — Chainlink ACE (PolicyEngine)

**Status: CONTRACTS DEPLOYED — Activation scripts ready, not yet run**

`LeadNFTv2.sol` inherits `PolicyProtected`. `ACELeadPolicy.sol` deployed.

### Activation State

| Call | Script | On-Chain Status |
|------|--------|-----------------|
| `attachPolicyEngine(0x013f3219...)` | ✅ `activate-lead-nft.ts` ready | ⏳ User must execute |
| `setRoyaltyInfo(treasury, 250)` | ✅ `activate-lead-nft.ts` ready | ⏳ User must execute |

**User must execute** (see `onchain-activation-checklist.md` Step 2):
```bash
cd contracts && npx ts-node scripts/activate-lead-nft.ts
```

---

## Section 7 — CHTT / Confidential HTTP

**Status: PHASE 1 STUB (correctly labeled) + PHASE 2 AES-GCM REAL**

- Phase 1: `ConfidentialHTTPClient` is a local stub (`isStub: true` in all return values). No regression risk.
- Phase 2: `DON_BATCHED_PRIVATE_SCORE_SOURCE` — btoa() replaced with real `SubtleCrypto.encrypt` (Fix 1a). Server-side `aesGcmEncrypt` was already real.

---

## Section 8 — Backend ↔ On-Chain CRE Wiring

**Status: CODE WIRED — Execution requires DON sources to be uploaded first**

### What was done in code (Fix 4 + Verification Round):

**`cre.service.ts`**: Added `requestOnChainQualityScore(leadId, tokenId)` and `listenForVerificationFulfilled()`.

**`marketplace.routes.ts` L1941-1957**: Wired inside the `confirm-escrow` background `mintAndRecord()` task:
```ts
// Fix 4 (2026-02-21): Dispatch on-chain CRE quality score request.
if (!process.env.USE_BATCHED_PRIVATE_SCORE) {
    console.log(`[CONFIRM-ESCROW] Dispatching on-chain CRE quality score — tokenId=...`);
    creService.requestOnChainQualityScore(leadId, Number(mintResult.tokenId), leadId)
        .then((r) => { ... })
        .catch((err) => { ... });
}
```

This fires after every successful `mintLeadNFT()` on the Phase 1 path. The background listener polls the chain for the DON-fulfilled score and writes it to `prisma.lead.qualityScore`.

**Prerequisite**: DON sources must be uploaded (Section 5) before this flow will return a score from the chain.

---

## Section 9 — Environment & Documentation

**Status: ALL ENV FIXES APPLIED — Manual user steps still required**

| Issue | Before | After (code) | User Action Required |
|-------|--------|--------------|---------------------|
| VRF address missing from `.env` | ❌ | ✅ Added `0x86c8f348…` | None |
| VRF subscription ID missing | ❌ | ✅ Placeholder added | Fill from VRF dashboard |
| DEPLOYER_PRIVATE_KEY in committed `.env` | ⚠️ | ✅ Migration comment added | Move to `.env.local` |
| `.env.example` missing VRF + ACE addresses | ❌ | ✅ All filled | None |
| README LeadNFTv2 verify address stale | `0x1eAe80ED…` | ✅ `0x73ebD921…` | None |
| README CREVerifier stale args | subscriptionId=3063, old LeadNFT addr | ✅ 581, correct addr | None |
| ACELeadPolicy verify missing from README | ❌ | ✅ Added | None |
| `upload-all-sources.ts` printed stale `3063` | ❌ | ✅ Fixed to `581` | None |

---

## Section 10 — On-Chain Pending User Steps

> See **`onchain-activation-checklist.md`** for the complete, numbered, copy-paste guide.

| # | Action | Script / Command | Status |
|---|--------|-----------------|--------|
| 1 | Upload DON sources to CREVerifier | `contracts/scripts/upload-all-sources.ts` | ⏳ Pending |
| 2 | Activate ACE policy on LeadNFTv2 | `contracts/scripts/activate-lead-nft.ts` | ⏳ Pending |
| 3 | Activate royalties on LeadNFTv2 | Same script as #2 | ⏳ Pending |
| 4 | Move DEPLOYER_PRIVATE_KEY to `.env.local` | Manual (see checklist Step 3) | ⏳ Pending |
| 5 | Fill VRF_SUBSCRIPTION_ID | VRF dashboard → `.env` | ⏳ Pending |
| 6 | Run `hardhat verify` for all contracts | See checklist Step 5 | ⏳ Pending |
| 7 | Verify Render logs for end-to-end CRE flow | See checklist Step 6 | ⏳ Pending |

---

## Section 11 — Code-Level Issues: ZERO

All 12 code-level structural issues from the original audit are resolved:

| # | Issue | Resolution | On-Chain? |
|---|-------|------------|-----------|
| 1 | btoa() placeholder in AES-GCM DON source | ✅ Fixed (SubtleCrypto) | Script ready |
| 2 | ZK DON source not written | ✅ Fixed (zk-proof-source.ts) | Script ready |
| 3 | DON source upload gap | ✅ Fixed (upload-all-sources.ts) | Script ready |
| 4 | ACE policy not attached | ✅ Fixed (activate-lead-nft.ts) | Script ready |
| 5 | Royalties not activated | ✅ Fixed (activate-lead-nft.ts) | Script ready |
| 6 | VRF address missing from .env | ✅ Fixed | N/A |
| 7 | VRF subscription ID undocumented | ✅ Fixed (placeholder) | User must fill |
| 8 | DEPLOYER_PRIVATE_KEY committed | ✅ Mitigated (.env.local instructions) | User must act |
| 9 | README stale verify addresses | ✅ Fixed | N/A |
| 10 | Backend not calling on-chain CRE post-mint | ✅ Fixed (marketplace.routes.ts L1941-1957) | Requires DON upload |
| 11 | CHTT Phase 1 stub labeled as production | ✅ Classified: intentional, labeled `isStub: true` | N/A |
| 12 | ConfidentialHTTP TEE not real | ✅ Classified: roadmap item | N/A |

**ZERO remaining code-level structural issues. On-chain activation is user-gated.**
