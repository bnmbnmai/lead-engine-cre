# On-Chain Verification — LeadRTB

> **Network:** Base Sepolia (chain ID 84532)
> **Last verified:** 2026-03-01 | **Source of truth:** [CONTRACTS.md](../CONTRACTS.md)

---

## Deployed Contracts (Base Sepolia)

| Contract | Address | Basescan | Txns |
|----------|---------|----------|------|
| **PersonalEscrowVault** | `0x56bB31bE214C54ebeCA55cd86d86512b94310F8C` | [View ↗](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C) | 1,477 |
| **LeadNFTv2** | `0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155` | [View ↗](https://sepolia.basescan.org/address/0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155) | 26 |
| **CREVerifier** | `0xfec22A5159E077d7016AAb5fC3E91e0124393af8` | [View ↗](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8) | 20 |
| **VRFTieBreaker** | `0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e` | [View ↗](https://sepolia.basescan.org/address/0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e) | 3 |
| **ACECompliance** | `0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6` | [View ↗](https://sepolia.basescan.org/address/0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6) | 66 |
| **ACELeadPolicy** | `0x013f3219012030aC32cc293fB51a92eBf82a566F` | [View ↗](https://sepolia.basescan.org/address/0x013f3219012030aC32cc293fB51a92eBf82a566F) | 0 |
| **BountyMatcher** | `0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D` | [View ↗](https://sepolia.basescan.org/address/0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D) | 0 |
| **VerticalBountyPool** | `0x9C22418295642Df3D5521B8fA21fBb03Eb89c3c2` | [View ↗](https://sepolia.basescan.org/address/0x9C22418295642Df3D5521B8fA21fBb03Eb89c3c2) | 0 |

**8 of 8 deployed contracts carry "Contract Source Code Verified (Exact Match)" on Basescan.**

---

## Quick Commands

```bash
# Deploy contracts (Base Sepolia)
cd contracts
npx hardhat run scripts/deploy-vault-only.ts --network baseSepolia

# Verify contract on Basescan
npx hardhat verify --network baseSepolia <ADDRESS> <CONSTRUCTOR_ARGS>

# Run Hardhat unit tests
npx hardhat test

# Query on-chain events (all contracts, last 10K blocks)
npx ts-node scripts/query-events.ts --network baseSepolia
```

---

## Key Events to Monitor

### LeadNFTv2 — Lead Lifecycle (ACE-Protected)

| Event | Description | Indexed Fields |
|-------|-------------|----------------|
| `LeadMinted` | New lead submitted as NFT (ACE `runPolicy` modifier enforced) | `tokenId`, `seller` |
| `LeadSold` | Lead sold to buyer | `tokenId`, `buyer` |
| `LeadVerified` | CRE quality score confirmed via Functions DON | `tokenId` |

### PersonalEscrowVault — Settlement + Automation

| Event | Description | Indexed Fields |
|-------|-------------|----------------|
| `DepositReceived` | USDC locked for trade | `lockId`, `from` |
| `Released` | Seller paid after settlement | `lockId` |
| `Refunded` | Buyer refunded (expired or lost bid) | `lockId` |
| `UpkeepPerformed` | Automation PoR check executed | `timestamp` |

### CREVerifier — Quality Scoring + ZK

| Event | Description | Indexed Fields |
|-------|-------------|----------------|
| `VerificationRequested` | `requestQualityScore()` dispatched to DON | `requestId`, `leadTokenId` |
| `VerificationFulfilled` | DON callback with quality score | `requestId`, `score` |

### VRFTieBreaker — Auction Fairness

| Event | Description | Indexed Fields |
|-------|-------------|----------------|
| `ResolutionRequested` | VRF random words requested | `requestId`, `auctionId` |
| `WinnerSelected` | Winner determined by `randomWord % candidates.length` | `auctionId`, `winner` |

### ACECompliance — KYC/AML

| Event | Description | Indexed Fields |
|-------|-------------|----------------|
| `UserVerified` | KYC approval | `user`, `jurisdiction` |
| `UserBlacklisted` | Compliance block | `user` |

---

## Supporting Addresses

| Role | Address |
|------|---------|
| USDC Token (Base Sepolia) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| USDC/ETH Data Feed | `0x71041dDDaD3595f9Ced3d1F5861e2931857B2deF` |
| CRE Subscription (Functions) | `581` |
| VRF Subscription (VRF v2.5) | `113264743570594559…` |
| Functions Router | `0xf9B8fc078197181C841c296C876945aaa425B278` |
| DON ID | `fun-base-sepolia-1` |

---

## Example Transaction Lookups

```
# LeadNFTv2 mint
https://sepolia.basescan.org/tx/<TX_HASH>#eventlog
→ Look for LeadMinted(tokenId, seller, vertical, geo, dataHash)

# CRE Quality Score fulfillment
https://sepolia.basescan.org/tx/<TX_HASH>#eventlog
→ Look for VerificationFulfilled(requestId, leadTokenId, score)

# Escrow Settlement
https://sepolia.basescan.org/tx/<TX_HASH>#eventlog
→ Look for Released(lockId, amount, to)
```

---

## Edge Case Handling

| Edge Case | How It's Handled |
|-----------|------------------|
| **Insufficient gas** | Pre-flight balance check, faucet URLs printed |
| **Nonce conflict** | Diagnostic message + MetaMask reset instructions |
| **Tx revert** | Receipt status check → error with tx hash for debugging |
| **RPC rate limit** | Supports multiple providers (Base RPC, Alchemy, QuickNode) |
| **Contract not deployed** | Address validation with descriptive error |
| **DON timeout** | CRE retries once, then falls back to score 5000 |

---

*All contracts, addresses, and subscription IDs defer to [CONTRACTS.md](../CONTRACTS.md) as the canonical source of truth.*
