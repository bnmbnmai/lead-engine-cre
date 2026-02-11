# On-Chain Verification — Lead Engine CRE

## Deployed Contracts (Sepolia)

| Contract | Address | Explorer |
|----------|---------|----------|
| **ACECompliance** | `0x746245858A5A5bCccfd0bdAa228b1489908b9546` | [Etherscan](https://sepolia.etherscan.io/address/0x746245858A5A5bCccfd0bdAa228b1489908b9546) |
| **CREVerifier** | `0x00f1f1C16e1431FFaAc3d44c608EFb5F8Db257A4` | [Etherscan](https://sepolia.etherscan.io/address/0x00f1f1C16e1431FFaAc3d44c608EFb5F8Db257A4) |
| **LeadNFTv2** | `0xB93A1Ff499BdEaf74710F760Eb2B6bc5b62f8546` | [Etherscan](https://sepolia.etherscan.io/address/0xB93A1Ff499BdEaf74710F760Eb2B6bc5b62f8546) |
| **Marketplace** | `0x3b1bBb196e65BE66c2fB18DB70A3513c1dDeB288` | [Etherscan](https://sepolia.etherscan.io/address/0x3b1bBb196e65BE66c2fB18DB70A3513c1dDeB288) |
| **RTBEscrow** | `0x19B7a082e93B096B0516FA46E67d4168DdCD9004` | [Etherscan](https://sepolia.etherscan.io/address/0x19B7a082e93B096B0516FA46E67d4168DdCD9004) |

---

## Quick Commands

```bash
# Query on-chain events (all contracts, last 10K blocks)
npx ts-node scripts/query-events.ts --network sepolia

# Query specific contract
npx ts-node scripts/query-events.ts --contract LeadNFT --event LeadMinted

# Run full E2E simulation on testnet
npx hardhat run scripts/simulate-e2e.ts --network sepolia

# Run E2E simulation locally
npx hardhat run scripts/simulate-e2e.ts --network hardhat

# Run Hardhat unit tests
npx hardhat test

# Deploy contracts (testnet)
npx hardhat run contracts/scripts/deploy.ts --network sepolia

# Verify contract on Etherscan
npx hardhat verify --network sepolia <ADDRESS> <CONSTRUCTOR_ARGS>
```

---

## Key Events to Monitor

### LeadNFT — Lead Lifecycle

| Event | Description | Indexed Fields |
|-------|-------------|----------------|
| `LeadMinted` | New lead submitted as NFT | `tokenId`, `seller` |
| `LeadSold` | Lead sold to buyer | `tokenId`, `buyer` |
| `LeadVerified` | CRE quality score confirmed | `tokenId` |
| `LeadExpired` | Lead TTL reached | `tokenId` |

### Marketplace — Auction Flow

| Event | Description | Indexed Fields |
|-------|-------------|----------------|
| `ListingCreated` | Seller lists lead for auction | `listingId`, `tokenId` |
| `BidCommitted` | Sealed bid submitted | `listingId`, `bidder` |
| `BidRevealed` | Bid amount revealed | `listingId`, `bidder` |
| `AuctionResolved` | Winner determined | `listingId` |
| `BuyNowExecuted` | Instant purchase | `listingId`, `buyer` |

### RTBEscrow — Settlement

| Event | Description | Indexed Fields |
|-------|-------------|----------------|
| `EscrowCreated` | USDC locked for trade | `escrowId`, `listingId` |
| `EscrowReleased` | Seller paid | `escrowId` |
| `EscrowRefunded` | Buyer refunded | `escrowId` |
| `EscrowDisputed` | Dispute opened | `escrowId` |

### ACECompliance — KYC/AML

| Event | Description | Indexed Fields |
|-------|-------------|----------------|
| `UserVerified` | KYC approval | `user`, `jurisdiction` |
| `UserBlacklisted` | Compliance block | `user` |
| `JurisdictionUpdated` | Geo rule change | `jurisdiction` |

---

## Edge Case Handling

| Edge Case | How Script Handles It |
|-----------|-----------------------|
| **Insufficient gas** | Pre-flight balance check, faucet URLs printed |
| **Nonce conflict** | Diagnostic message + MetaMask reset instructions |
| **Block reorg** | Reorg safety check (12 confirmations before trusting events) |
| **Tx revert** | Receipt status check → error with tx hash for debugging |
| **RPC rate limit** | Supports multiple providers (Alchemy, Base RPC, QuickNode) |
| **Contract not deployed** | Address validation with descriptive error |

---

## Example Transaction Lookups

Once the simulation runs, you can look up transactions on Etherscan:

```
# KYC Verification
https://sepolia.etherscan.io/tx/<TX_HASH>#eventlog

# Lead NFT Mint
https://sepolia.etherscan.io/tx/<TX_HASH>#eventlog
→ Look for LeadMinted(tokenId, seller, vertical, geo, dataHash)

# Sealed Bid
https://sepolia.etherscan.io/tx/<TX_HASH>#eventlog
→ Look for BidCommitted(listingId, bidder, commitHash)

# Escrow Settlement
https://sepolia.etherscan.io/tx/<TX_HASH>#eventlog
→ Look for EscrowCreated → EscrowReleased sequence
```

---

## Simulation Output

Both scripts write JSON reports to `test-results/`:

| File | Contents |
|------|----------|
| `on-chain-events.json` | All events found by `query-events.ts` |
| `e2e-onchain-simulation.json` | Step-by-step simulation results |

Each report includes: chain ID, block numbers, tx hashes, gas usage, timestamps, and contract addresses.
