# CONTRACTS.md — Single Source of Truth
> **Network:** Base Sepolia (chain ID 84532)  
> **Last verified:** 2026-02-24 | **Verification method:** Live Basescan lookup  
> **All deployed contracts are source-verified on Basescan.**

---

## Deployed Contracts (Production)

| Contract | Address | Basescan | Verified | Key Chainlink Usage | Txns |
|---|---|---|---|---|---|
| **PersonalEscrowVault** | `0x56bB31bE214C54ebeCA55cd86d86512b94310F8C` | [View ↗](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C) | ✅ Exact Match | Automation (PoR/checkUpkeep/performUpkeep), Data Feeds (USDC/ETH price gate) | 1,477 |
| **LeadNFTv2** | `0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155` | [View ↗](https://sepolia.basescan.org/address/0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155) | ✅ Exact Match | ACE (PolicyProtectedUpgradeable; mintLead runPolicy modifier) | 26 |
| **CREVerifier** | `0xfec22A5159E077d7016AAb5fC3E91e0124393af8` | [View ↗](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8) | ✅ Exact Match | Functions CRE (requestQualityScore/fulfillRequest), CHTT Phase 2 (requestZKProofVerification) | 20 |
| **VRFTieBreaker** | `0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e` | [View ↗](https://sepolia.basescan.org/address/0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e) | ✅ Exact Match | VRF v2.5 (requestRandomWords; winner = randomWord % candidates.length) | 3 |
| **ACECompliance** | `0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6` | [View ↗](https://sepolia.basescan.org/address/0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6) | ✅ Exact Match | ACE (isCompliant, KYC/geo/reputation policy registry) | 66 |
| **ACELeadPolicy** | `0x013f3219012030aC32cc293fB51a92eBf82a566F` | [View ↗](https://sepolia.basescan.org/address/0x013f3219012030aC32cc293fB51a92eBf82a566F) | ✅ Exact Match | ACE (lead-specific policy rules; enforced by LeadNFTv2 mintLead) | 0 |

**6 of 6 deployed contracts source-verified on Basescan. Zero pending.**

---

## Reference / Future Contracts (Not Deployed)

| Contract | File | Status | Notes |
|---|---|---|---|
| **BountyMatcher** | `contracts/contracts/BountyMatcher.sol` | 🔷 Reference | Complete implementation using Chainlink Functions for off-chain bounty matching. Deploy when `BOUNTY_FUNCTIONS_ENABLED=true` is needed in prod. |
| **VerticalBountyPool** | `contracts/contracts/VerticalBountyPool.sol` | 🔷 Reference | Buyer USDC bounty pool contract. BountyMatcher depends on this. |
| **VerticalAuction** | `contracts/contracts/VerticalAuction.sol` | 🔷 Reference | Vertical-level auction variant. Not in primary auction flow. |
| **VerticalNFT** | `contracts/contracts/VerticalNFT.sol` | 🔷 Reference | Vertical-specific NFT variant. Not in primary mint flow. |

---

## Chainlink Services Integration by Contract

| Service | Contract | Integration Detail |
|---|---|---|
| Chainlink Automation | PersonalEscrowVault | `checkUpkeep()` / `performUpkeep()` fires every 24h for Proof-of-Reserves; sweeps expired bid locks after 7 days |
| Chainlink Data Feeds | PersonalEscrowVault | `AggregatorV3Interface(0x71041dDDaD3595f9Ced3d1F5861e2931857B2deF)` — USDC/ETH feed; `demoMode` flag bypasses stale check on testnet |
| Chainlink Functions (CRE) | CREVerifier | `requestQualityScore()` dispatches DON job; `fulfillRequest()` writes `uint16 score` on-chain per lead |
| Chainlink CHTT Phase 2 | CREVerifier | `requestZKProofVerification()` dispatches live ZK fraud-signal DON request; enclave key uploaded to DON Vault at slot 0 |
| Chainlink VRF v2.5 | VRFTieBreaker | `requestResolution()` → `requestRandomWords()`; winner by `randomWord % candidates.length` |
| Chainlink ACE | LeadNFTv2 + ACECompliance + ACELeadPolicy | `mintLead` has `runPolicy` modifier enforcing `ACELeadPolicy` → `ACECompliance.isCompliant()` |

---

## Key Addresses (Supporting)

| Role | Address | Notes |
|---|---|---|
| Deployer / Platform Wallet | `0x6BBcf283847f409a58Ff984A79eFD571...` | Receiving platform fees; authorized caller on vault |
| USDC Token (Base Sepolia) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Circle USDC on Base Sepolia testnet |
| USDC/ETH Data Feed | `0x71041dDDaD3595f9Ced3d1F5861e2931857B2deF` | Chainlink Base Sepolia price feed used by vault |
| CRE Subscription | `581` | Chainlink Functions subscription on Base Sepolia |
| VRF Subscription | `113264743570594559...` | Chainlink VRF v2.5 subscription |

---

## How to Re-deploy and Verify in Future

### Deploy
```bash
cd contracts
npx hardhat run scripts/deploy-vault-only.ts --network baseSepolia
```

### Verify (after deploy, using addresses from deploy output)
```bash
# PersonalEscrowVault — 3 args: USDC token, platformWallet, initialOwner
npx hardhat verify --network baseSepolia <VAULT_ADDRESS> \
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" \
  "<DEPLOYER_ADDRESS>" \
  "<DEPLOYER_ADDRESS>"

# LeadNFTv2 — check deploy script for constructor args
npx hardhat verify --network baseSepolia <NFT_ADDRESS> [args...]

# VRFTieBreaker
npx hardhat verify --network baseSepolia <VRF_ADDRESS> [args...]
```

### Key Hardhat config
- Network: `baseSepolia` (in `hardhat.config.ts`)
- API key: `BASESCAN_API_KEY` env var (Basescan account → API Keys)
- RPC: `BASE_SEPOLIA_RPC_URL` env var

---

*This file is the canonical on-chain reference. All other docs should defer to this file for contract addresses.*
