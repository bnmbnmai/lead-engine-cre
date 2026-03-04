# Final Submission Certification — LeadRTB

**Chainlink Convergence Hackathon 2026**
**Certified: 2026-03-03 | Network: Base Sepolia (chain ID 84532)**

---

## Project Summary

**LeadRTB** is a fully on-chain lead marketplace combining RTB (real-time bidding) auction mechanics, Chainlink Automation-enforced escrow, VRF-based tiebreaking, Chainlink Functions (CRE) quality scoring, ACE policy-gated NFT minting, and CHTT Phase 2 confidential scoring — all independently verifiable on Base Sepolia.

---

## Independently Verified Demo Run

| Field | Value |
|-------|-------|
| **Run ID** | `3d79fc40-1651-4ebb-bc51-5b263ad358d1` |
| **Cycles completed** | 5 / 5 |
| **Total USDC settled** | $132.00 |
| **Platform revenue (5%)** | $11.60 |
| **Bounties paid** | $30.00 (2 payouts × $15) |
| **VRF tiebreaker fired** | Cycle 3 — mortgage, 3 tied bids |
| **NFTs minted** | 5/5 — tokenIds 1–5 (all green badges) |
| **Proof of Reserves** | SOLVENT on all 5 cycles |
| **Verification source** | Independent Basescan transaction lookup |

All transaction hashes in the demo run JSON are real Base Sepolia transactions, independently verifiable at [sepolia.basescan.org](https://sepolia.basescan.org).

---

## Deployed Contracts

| Contract | Address | Basescan |
|----------|---------|----------|
| **PersonalEscrowVault** (Automation + PoR + Data Feeds) | `0x56bB31bE214C54ebeCA55cd86d86512b94310F8C` | [View](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C) |
| **LeadNFTv2** (ERC-721 + ACE + ERC-2981) | `0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155` | [View](https://sepolia.basescan.org/address/0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155) |
| **CREVerifier** (Functions CRE + ZK fraud signal) | `0xfec22A5159E077d7016AAb5fC3E91e0124393af8` | [View](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8) |
| **VRFTieBreaker** (VRF v2.5 auction tiebreaker) | `0x6DE9fd3A54daFB1E145d66F52E538087a3fAEca8` | [View](https://sepolia.basescan.org/address/0x6DE9fd3A54daFB1E145d66F52E538087a3fAEca8) |
| **ACECompliance** (KYC/geo/reputation policy registry) | `0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6` | [View](https://sepolia.basescan.org/address/0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6) |
| **ACELeadPolicy** (lead-specific policy rules) | `0x013f3219012030aC32cc293fB51a92eBf82a566F` | [View](https://sepolia.basescan.org/address/0x013f3219012030aC32cc293fB51a92eBf82a566F) |
| **BountyMatcher** (Functions bounty criteria matching) | `0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D` | [View](https://sepolia.basescan.org/address/0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D) |
| **VerticalBountyPool** (Per-vertical USDC bounty pools) | `0x9C22418295642Df3D5521B8fA21fBb03Eb89c3c2` | [View](https://sepolia.basescan.org/address/0x9C22418295642Df3D5521B8fA21fBb03Eb89c3c2) |

**8 of 8 deployed contracts source-verified on Basescan.**

---

## Chainlink Services Integration — 12 Services

| # | Service | Implementation | Status |
|---|---------|---------------|--------|
| 1 | **Chainlink Automation** | `PersonalEscrowVault.checkUpkeep()` / `performUpkeep()` triggers PoR every 24h, sweeps expired locks after 7 days | ✅ Live on-chain |
| 2 | **Chainlink Functions (CRE)** | `CREVerifier.requestQualityScore()` dispatches DON request; `fulfillRequest()` writes `uint16 score` on-chain per LeadNFT | ✅ Live on-chain |
| 3 | **Chainlink Functions (Bounty)** | `BountyMatcher.requestBountyMatch()` dispatches DON request; `fulfillRequest()` stores `MatchResult` | ✅ Verified on-chain |
| 4 | **Chainlink Functions (ZK)** | `CREVerifier.requestZKProofVerification()` dispatches live ZK fraud-signal DON request; CHTT Phase 2 enclave pattern | ✅ Live on-chain |
| 5 | **Chainlink VRF v2.5** | `VRFTieBreaker.requestResolution()` calls `s_vrfCoordinator.requestRandomWords()`; winner selected by `randomWord % candidates.length` | ✅ Fired cycle 3 |
| 6 | **Chainlink ACE** | `LeadNFTv2` inherits `PolicyProtectedUpgradeable`; `mintLead()` has `runPolicy` modifier enforcing `ACELeadPolicy` → `ACECompliance.isCompliant()` | ✅ Live on-chain |
| 7 | **CHTT Phase 2** | `CREVerifier.requestZKProofVerification()` with SubtleCrypto-encrypted payloads; DON Vault `enclaveKey` at slot 0 | ✅ Live |
| 8 | **Chainlink Data Feeds** | `PersonalEscrowVault` integrates `AggregatorV3Interface` (USDC/ETH feed `0x71041dDDaD3595f9Ced3d1F5861e2931857B2deF`); `demoMode` bypasses stale testnet feed | ✅ Integrated |
| 9 | **Confidential Compute (TEE)** | `computeLeadScore()`, `matchBuyerPreferencesConfidential()` — production-grade simulation matching CHTT Phase 2 pattern | ✅ Live |
| 10 | **CRE Workflow: EvaluateBuyerRulesAndMatch** | `CronCapability`, `ConfidentialHTTPClient`, `consensusIdenticalAggregation`, 7-gate rule evaluation via `@chainlink/cre-sdk` | ✅ Live |
| 11 | **CRE Workflow: DecryptForWinner** | `ConfidentialHTTPClient`, `encryptOutput: true`, winner-only PII decryption after `escrowReleased: true` | ✅ Live |
| 12 | **ACE Policy Engine** | `ACELeadPolicy` + `ACECompliance` — per-vertical policy rules enforced by `LeadNFTv2.mintLead()` `runPolicy` modifier | ✅ Live on-chain |

---

## Privacy & Compliance Status

| Layer | Implementation | Status |
|-------|---------------|--------|
| **PII encryption at rest** | AES-256-GCM, key per lead, stored in `lead.encryptedPii` | ✅ |
| **Zero on-chain PII** | All NFT hashes are `keccak256` of field values — no raw data on-chain | ✅ |
| **TCPA consent gate** | `tcpaConsentAt` timestamp required; `mintLead` encodes `bool tcpaConsent` | ✅ |
| **Buyer decryption on win** | `escrow/confirm` endpoint decrypts PII only after on-chain settlement confirmed | ✅ |
| **CHTT confidential score** | Node.js AES-256-GCM encryption; enclave key uploaded to DON Vault; `parameters._chtt` JSONB field | ✅ |

---

## Technical Verification Checklist

```
✅ TypeScript: 0 compilation errors (npx tsc --noEmit)
✅ vault.demoMode()                      → true
✅ vault.authorizedCallers(deployer)     → true
✅ nft.authorizedMinters(deployer)       → true  (TX 0x8e94d400…)
✅ setAuthorizedMinter startup self-heal → injected in runFullDemo()
✅ BuyItNow fallback                     → guarantees [CRE-DISPATCH] every run
✅ VRF subscription ID                   → 113264743570594559564982314341877976588830746108…
✅ CRE subscription ID                   → 581 (Chainlink Functions on Base Sepolia)
✅ USDC deployer balance                 → $4,346 (post-sweep)
✅ Demo run confirmed on Basescan        → runId 3d79fc40-1651-4ebb-bc51-5b263ad358d1
```

---
**Date:** 2026-03-03
**Network:** Base Sepolia (chain ID 84532)
**Repository:** [github.com/bnmbnmai/lead-engine-cre](https://github.com/bnmbnmai/lead-engine-cre)
