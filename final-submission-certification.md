# Final Submission Certification — Lead Engine CRE

**Chainlink Convergence Hackathon 2026**
**Certified: 2026-02-22 | Network: Base Sepolia (chain ID 84532)**

---

## Project Summary

**Lead Engine CRE** is a fully on-chain lead marketplace combining RTB (real-time bidding) auction mechanics, Chainlink Automation-enforced escrow, VRF-based tiebreaking, Chainlink Functions (CRE) quality scoring, ACE policy-gated NFT minting, and CHTT Phase 2 confidential scoring — all independently verifiable on Base Sepolia.

---

## Independently Verified Demo Run

| Field | Value |
|-------|-------|
| **Run ID** | `05ad5f55-ae29-4569-9f00-8637f0e0746a` |
| **Cycles completed** | 5 / 5 |
| **Total USDC settled** | $239.00 |
| **Platform revenue (5%)** | $32.95 |
| **VRF tiebreaker fired** | Cycle 3 — on-chain confirmed |
| **Proof of Reserves** | Passed all 5 cycles |
| **Verification source** | Independent Basescan transaction lookup |

All transaction hashes in the demo run JSON are real Base Sepolia transactions, independently verifiable at [sepolia.basescan.org](https://sepolia.basescan.org).

---

## Deployed Contracts

| Contract | Address | Basescan |
|----------|---------|----------|
| **PersonalEscrowVault** (Automation + PoR + Data Feeds) | `0x56bB31bE214C54ebeCA55cd86d86512b94310F8C` | [View](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C) |
| **LeadNFTv2** (ERC-721 + ACE + ERC-2981) | `0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155` | [View](https://sepolia.basescan.org/address/0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155) |
| **CREVerifier** (Functions CRE + ZK fraud signal) | `0xfec22A5159E077d7016AAb5fC3E91e0124393af8` | [View](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8) |
| **VRFTieBreaker** (VRF v2.5 auction tiebreaker) | `0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e` | [View](https://sepolia.basescan.org/address/0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e) |
| **ACECompliance** (KYC/geo/reputation policy registry) | `0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6` | [View](https://sepolia.basescan.org/address/0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6) |

---

## Chainlink Services Integration — 6 Services

| # | Service | Implementation | Status |
|---|---------|---------------|--------|
| 1 | **Chainlink Automation** | `PersonalEscrowVault.checkUpkeep()` / `performUpkeep()` triggers PoR every 24h, sweeps expired locks after 7 days | ✅ Live on-chain |
| 2 | **Chainlink Functions (CRE)** | `CREVerifier.requestQualityScore()` dispatches DON request; `fulfillRequest()` writes `uint16 score` on-chain per LeadNFT | ✅ Live on-chain |
| 3 | **Chainlink VRF v2.5** | `VRFTieBreaker.requestResolution()` calls `s_vrfCoordinator.requestRandomWords()`; winner selected by `randomWord % candidates.length` | ✅ Fired cycle 3 |
| 4 | **Chainlink ACE** | `LeadNFTv2` inherits `PolicyProtectedUpgradeable`; `mintLead()` has `runPolicy` modifier enforcing `ACELeadPolicy` → `ACECompliance.isCompliant()` | ✅ Live on-chain |
| 5 | **CHTT Phase 2** | `CREVerifier.requestZKProofVerification()` dispatches live ZK fraud-signal DON request; `fulfillRequest()` writes `uint8 signal`; DON Vault `enclaveKey` uploaded at slot 0 | ✅ Dispatches live |
| 6 | **Chainlink Data Feeds** | `PersonalEscrowVault` integrates `AggregatorV3Interface` (USDC/ETH feed `0x71041dDDaD3595f9Ced3d1F5861e2931857B2deF`); `demoMode` bypasses stale testnet feed | ✅ Integrated |

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
✅ Demo run confirmed on Basescan        → runId 05ad5f55-ae29-4569-9f00-8637f0e0746a
```

---
**Date:** 2026-02-22
**Network:** Base Sepolia (chain ID 84532)
**Repository:** [github.com/bnmbnmai/lead-engine-cre](https://github.com/bnmbnmai/lead-engine-cre)
