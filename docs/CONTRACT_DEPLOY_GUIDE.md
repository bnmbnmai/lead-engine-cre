# Contract Deployment & Gas Troubleshooting

## Quick Deploy

```powershell
# 1. Ensure keys are set in backend/.env
#    DEPLOYER_PRIVATE_KEY=0x...
#    ALCHEMY_API_KEY=...

# 2. Deploy to Sepolia
.\scripts\deploy-contracts.ps1 -Network sepolia

# 3. Deploy to Base Sepolia
.\scripts\deploy-contracts.ps1 -Network baseSepolia

# 4. Deploy to both
.\scripts\deploy-contracts.ps1 -Network both
```

## Manual Deploy (Hardhat directly)

```bash
cd contracts

# Compile
npx hardhat compile

# Deploy to Sepolia
npx hardhat run scripts/deploy.ts --network sepolia

# Deploy to Base Sepolia
npx hardhat run scripts/deploy.ts --network baseSepolia

# Verify on Etherscan (replace ADDRESS with deployed address)
npx hardhat verify --network sepolia ADDRESS
npx hardhat verify --network baseSepolia ADDRESS
```

## Post-Deploy: Chainlink Functions Setup

1. Go to [functions.chain.link](https://functions.chain.link)
2. Connect the same deployer wallet
3. Create subscription on Sepolia
4. Fund with at least 2 LINK ([faucets.chain.link](https://faucets.chain.link))
5. Add `CRE_CONTRACT_ADDRESS` as consumer
6. Copy subscription ID → `CRE_SUBSCRIPTION_ID` in `backend/.env`

## Gas Optimization for High Volume

The contracts are optimized for hackathon demo but designed for production scale:

| Contract | Estimated Gas | USD (at 20 gwei, $2500 ETH) |
|---------|--------------|------------------------------|
| ACE: KYC Set | ~45,000 | ~$2.25 |
| ACE: Reputation Update | ~35,000 | ~$1.75 |
| NFT: Mint Lead | ~150,000 | ~$7.50 |
| NFT: Record Sale | ~50,000 | ~$2.50 |
| Escrow: Create | ~120,000 | ~$6.00 |
| Escrow: Release | ~65,000 | ~$3.25 |

**For high-concurrency (1000s of bids):**
- Use Base mainnet (10-50x cheaper than Ethereum L1)
- Batch operations where possible (ACE bulk KYC)
- Off-chain fallbacks for non-critical checks (already implemented)
- LRU cache reduces redundant on-chain reads (~80% cache hit rate)

## Troubleshooting

### Gas Errors

| Error | Fix |
|-------|-----|
| `insufficient funds for gas` | Fund deployer wallet: [faucets.chain.link](https://faucets.chain.link) for Sepolia ETH |
| `gas required exceeds allowance` | Increase gas limit in hardhat.config.ts: `gas: 5000000` |
| `transaction underpriced` | Wait for gas prices to drop, or set `gasPrice` manually |
| `nonce too low` | Reset MetaMask account, or wait for pending txns to confirm |

### RPC Errors

| Error | Fix |
|-------|-----|
| `could not detect network` | Check `ALCHEMY_API_KEY` is valid |
| `timeout` | Try again — Sepolia can be slow. Also try Base Sepolia (faster) |
| `rate limit exceeded` | Upgrade Alchemy plan or add delay between deployments |
| `invalid api key` | Verify key at [dashboard.alchemy.com](https://dashboard.alchemy.com) |

### Contract Verification Errors

| Error | Fix |
|-------|-----|
| `already verified` | Contract already verified — check Etherscan |
| `bytecode mismatch` | Re-compile with same Solidity version (0.8.24) + optimizer settings |
| `constructor args` | Pass constructor args: `npx hardhat verify --network sepolia ADDRESS arg1 arg2` |
| `API key missing` | Set `ETHERSCAN_API_KEY` or `BASESCAN_API_KEY` in `backend/.env` |

### Private Key Security

⚠️ **NEVER commit private keys to Git:**
- Use `.env` files (excluded by `.gitignore`)
- For CI/CD: use GitHub Secrets
- For Render: use environment variables (not in code)
- Rotate keys if accidentally exposed
- Use a separate deployer wallet with minimal funds

### Checking Deployed Contracts

```bash
# Sepolia
https://sepolia.etherscan.io/address/YOUR_ADDRESS

# Base Sepolia
https://sepolia.basescan.org/address/YOUR_ADDRESS

# Check deployer balance
cd contracts
npx hardhat console --network sepolia
> (await ethers.provider.getBalance("YOUR_ADDRESS")).toString()
```
