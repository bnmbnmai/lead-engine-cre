# Verified Contracts & Chainlink Services – Base Sepolia (March 2026)

> **Network:** Base Sepolia (chain ID 84532)
> **All contracts source-verified on Basescan (Exact Match).**
> **Last verified:** 3 March 2026

---

## Deployed Contracts

| # | Contract | Address | Chainlink Service |
|---|----------|---------|-------------------|
| 1 | **PersonalEscrowVault** | [`0x56bB31bE...10F8C`](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C) | Automation (PoR), Data Feeds |
| 2 | **LeadNFTv2** | [`0x73ebD921...7155`](https://sepolia.basescan.org/address/0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155) | ACE (PolicyProtectedUpgradeable) |
| 3 | **CREVerifier** | [`0xfec22A51...af8`](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8) | Functions CRE, CHTT Phase 2 |
| 4 | **VRFTieBreaker** | [`0x6DE9fd3A...ca8`](https://sepolia.basescan.org/address/0x6DE9fd3A54daFB1E145d66F52E538087a3fAEca8) | VRF v2.5 |
| 5 | **ACECompliance** | [`0xAea2590E...EfE6`](https://sepolia.basescan.org/address/0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6) | ACE (KYC/geo/reputation) |
| 6 | **ACELeadPolicy** | [`0x013f3219...566F`](https://sepolia.basescan.org/address/0x013f3219012030aC32cc293fB51a92eBf82a566F) | ACE (lead-specific policy) |
| 7 | **BountyMatcher** | [`0x897f8CCa...417D`](https://sepolia.basescan.org/address/0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D) | Functions (granular bounty matching) |
| 8 | **VerticalBountyPool** | [`0x9C224182...3c2`](https://sepolia.basescan.org/address/0x9C22418295642Df3D5521B8fA21fBb03Eb89c3c2) | USDC bounty pools |

**8 / 8 contracts source-verified on Basescan. Zero pending.**
All contracts receive real on-chain transactions during the 1-click demo (including VRFTieBreaker via `requestResolution()`).

---

## Chainlink Services Integration

| Service | Contract | How It's Used |
|---------|----------|---------------|
| **Automation** | PersonalEscrowVault | `checkUpkeep()` / `performUpkeep()` — 24h PoR cycle; sweeps expired bid locks after 7 days |
| **Data Feeds** | PersonalEscrowVault | USDC/ETH price feed ([`0x71041dDD...deF`](https://sepolia.basescan.org/address/0x71041dDDaD3595f9Ced3d1F5861e2931857B2deF)) for vault operations |
| **Functions (CRE)** | CREVerifier | `requestQualityScore()` → DON job → `fulfillRequest()` writes `uint16 score` on-chain |
| **CHTT Phase 2** | CREVerifier | `requestZKProofVerification()` — live ZK fraud-signal DON request; enclave key in Vault slot 0 |
| **VRF v2.5** | VRFTieBreaker | `requestResolution()` → `requestRandomWords()`; winner = `randomWord % candidates.length` |
| **ACE** | LeadNFTv2 + ACECompliance + ACELeadPolicy | `mintLead` has `runPolicy` modifier enforcing compliance before NFT mint |
| **Functions** | BountyMatcher | Granular bounty criteria matching in DON; `fulfillRequest` stores `MatchResult` |

---

## Supporting Addresses

| Role | Address |
|------|---------|
| Deployer / Platform Wallet | `0x6BBcf283847f409a58Ff984A79eFD571...` |
| USDC Token (Base Sepolia) | [`0x036CbD53...CF7e`](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |
| USDC/ETH Data Feed | [`0x71041dDD...2deF`](https://sepolia.basescan.org/address/0x71041dDDaD3595f9Ced3d1F5861e2931857B2deF) |
| CRE Subscription | `581` |
| VRF Subscription | `113264743570594559...` |

---

## Reference Contracts (Not Deployed)

| Contract | Status | Notes |
|----------|--------|-------|
| VerticalAuction | 🔷 Reference | Vertical-level auction variant. Not in primary auction flow. |
| VerticalNFT | 🔷 Reference | Vertical-specific NFT variant. Not in primary mint flow. |

---

## Re-deploy & Verify

```bash
cd contracts
npx hardhat run scripts/deploy-vault-only.ts --network baseSepolia

# Verify (example for PersonalEscrowVault)
npx hardhat verify --network baseSepolia <VAULT_ADDRESS> \
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" \
  "<DEPLOYER_ADDRESS>" \
  "<DEPLOYER_ADDRESS>"
```

Requires `BASESCAN_API_KEY` and `BASE_SEPOLIA_RPC_URL` in env.

---

*This file is the canonical on-chain reference. All other docs defer to this file for contract addresses.*

See also: [`FINAL_VERIFICATION_LOG.md`](FINAL_VERIFICATION_LOG.md) for full Tenderly simulations and deployment details.
