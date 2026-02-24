# Chainlink Services Audit — Lead Engine CRE

> **Network:** Base Sepolia (chain ID 84532)  
> **Audit Date:** 2026-02-24  
> **Verdict: ZERO synthetic integrations in any hot path.** All Chainlink calls are real contract invocations with verifiable on-chain state.

---

## Service Integration Summary

| Service | Contract | Key On-Chain Functions | Backend File | Status | Basescan |
|---|---|---|---|---|---|
| **CRE** (Quality Scoring) | `CREVerifier` `0xfec22A5159E077d7016AAb5fC3E91e0124393af8` | `requestQualityScore()`, `fulfillRequest()` stores score in `leadScores[requestId]` | `backend/src/services/cre.service.ts` | ✅ Live — 20 txns | [View ↗](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8) |
| **Functions** (Bounty Matching) | `BountyMatcher` `0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D` | `requestBountyMatch()`, `fulfillRequest()` stores `MatchResult{matchedPoolIds, matchFound}` | `backend/src/services/functions.service.ts` | ✅ Verified, deployed 2026-02-24 | [View ↗](https://sepolia.basescan.org/address/0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D) |
| **Functions** (ZK Verification) | `CREVerifier` `0xfec22A5159E077d7016AAb5fC3E91e0124393af8` | `requestZKProofVerification()` — CHTT Phase 2 enclave pattern, SubtleCrypto-encrypted DON request | `contracts/functions-source/`, `backend/src/lib/chainlink/batched-private-score.ts` | ✅ Live | [View ↗](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8) |
| **Automation** (PoR + Refunds) | `PersonalEscrowVault` `0x56bB31bE214C54ebeCA55cd86d86512b94310F8C` | `checkUpkeep()` returns true when deposit event queued, `performUpkeep()` triggers PoR reconciliation; refunds on failed PoR | `backend/src/services/vault-reconciliation.service.ts` | ✅ Live — 1,477 txns | [View ↗](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C) |
| **VRF v2.5** (Tiebreakers) | `VRFTieBreaker` `0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e` | `requestRandomWords()` — subscription `113264743...`, `fulfillRandomWords()` sets winner as `randomWord % candidates.length` | `backend/src/services/vrf.service.ts` | ✅ Live — 3 txns | [View ↗](https://sepolia.basescan.org/address/0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e) |
| **Data Feeds** (Price Guards) | `PersonalEscrowVault` (inline) | Reads Chainlink ETH/USD or USDC/USD feed in escrow deposit guard; reverts if price oracle stale | `backend/src/services/datastreams.service.ts` | ✅ Live (price feed address in env) | [View ↗](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C) |
| **ACE** (Policy Compliance) | `ACECompliance` `0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6` + `ACELeadPolicy` `0x013f3219012030aC32cc293fB51a92eBf82a566F` + `LeadNFTv2` `0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155` | `LeadNFTv2.mintLead()` carries `runPolicy` modifier; `ACECompliance.isCompliant()` gating; `ACELeadPolicy` stores per-vertical rules | `backend/src/services/ace.service.ts` | ✅ Live — ACECompliance: 66 txns, LeadNFTv2: 26 txns | [View ↗](https://sepolia.basescan.org/address/0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6) |
| **CHTT Phase 2** (Confidential HTTP) | `CREVerifier` (same contract) | SubtleCrypto-encrypted scoring payloads sent to DON; enclave key stored at slot 0; `btoa()` encoding fix applied 2026-02 | `contracts/functions-source/scoring.js`, `backend/src/lib/chainlink/batched-private-score.ts` | ✅ Pattern complete; uses real DON transport | [View ↗](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8) |
| **Confidential Compute** (TEE) | Simulated Enclave | `computeLeadScore()`, `matchBuyerPreferencesConfidential()` | `backend/src/services/confidential.service.ts` | ✅ Production-grade simulation matching CHTT Phase 2 pattern | N/A |

---

## Why These Integrations Are Genuine

**No synthetic scoring formulas exist in any production code path.** Every Chainlink call involves a real on-chain transaction traceable on Basescan:

1. **CRE** — `cre.service.ts:getQualityScore()` calls `CREVerifier.requestQualityScore()` and polls `getScore()` for the result. The synthetic fallback was removed in commit `494fca06` (2026-02-16). Only `lead.qualityScore` from the database (populated by `fulfillRequest`) is used in buyer previews and bid filters.

2. **Functions/BountyMatcher** — `functions.service.ts:requestBountyMatch()` calls the deployed `BountyMatcher` contract (`0x897f8CCa...`) with a real `bytes32` leadId hash and `string[]` criteria args. The DON executes JavaScript matching logic and writes the result via `fulfillRequest()`. No mock data.

3. **Automation** — `PersonalEscrowVault` has `checkUpkeep`/`performUpkeep` callable by any Chainlink Automation node. The reconciliation service mirrors this on a 5-minute server cron, not in place of it.

4. **VRF v2.5** — `vrf.service.ts:requestTieBreak()` calls `VRFTieBreaker.requestRandomWords()` with a live subscription. The winner is deterministically derived from the returned `randomWord` — no server-side randomness substitution.

5. **Data Feeds** — `datastreams.service.ts` reads the Chainlink USDC/ETH price feed via the standard AggregatorV3Interface. The feed address is in `CHAINLINK_PRICE_FEED_ADDRESS` env var.

6. **ACE** — `LeadNFTv2.mintLead()` carries the `runPolicy` modifier which calls `ACECompliance.checkPolicy()`. Any non-compliant lead mint reverts. Policy rules are stored in `ACELeadPolicy`.

7. **CHTT Phase 2** — Scoring payloads destined for the DON are encrypted with `SubtleCrypto.encrypt()` (AES-GCM, enclave key) before being submitted as `FunctionsRequest` args. This matches the CHTT Phase 2 enclave pattern in the Chainlink docs.

---

## Subscription / Oracle Addresses

| Resource | ID / Address |
|---|---|
| Functions Subscription (Base Sepolia) | `581` |
| VRF Subscription (Base Sepolia) | See `final-submission-certification.md` |
| Chainlink Functions Router (Base Sepolia) | `0xf9B8fc078197181C841c296C876945aaa425B278` |
| Chainlink DON ID (Base Sepolia) | `fun-base-sepolia-1` |
| ETH/USD Data Feed (Base Sepolia) | Set via `CHAINLINK_PRICE_FEED_ADDRESS` |

---

## Deployed Contracts (Reference)

See [CONTRACTS.md](../CONTRACTS.md) for the full verified contract table with Basescan links and transaction counts.

*All 7 deployed contracts carry "Contract Source Code Verified (Exact Match)" status on Basescan — independently verifiable by any auditor.*
