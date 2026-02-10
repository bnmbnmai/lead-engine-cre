# Mainnet Migration Guide — Lead Engine CRE

## Overview

This guide covers migrating Lead Engine from **Sepolia/Base Sepolia** testnets to **Base mainnet** for production deployment.

---

## 1. Pre-Migration Checklist

- [ ] All Slither findings resolved (no HIGH/MEDIUM)
- [ ] Security sim: 29/29 passing
- [ ] Load test: 10K concurrent users validated
- [ ] Contract unit tests: 100% passing
- [ ] Sentry monitoring configured and tested
- [ ] CRM webhook circuit breakers validated
- [ ] Deployer wallet funded (≥ 0.05 ETH on Base mainnet)
- [ ] Production USDC contract address confirmed

---

## 2. Contract Redeployment

### 2a. Update Hardhat Config

```ts
// hardhat.config.ts
networks: {
    base: {
        url: process.env.RPC_URL_BASE_MAINNET || 'https://mainnet.base.org',
        chainId: 8453,
        accounts: [process.env.DEPLOYER_PRIVATE_KEY],
        gasPrice: 'auto',
    },
}
```

### 2b. Deploy Contracts

```bash
npx hardhat run scripts/deploy.ts --network base
```

**Expected gas costs (Base mainnet, ~0.001 gwei):**

| Contract | Estimated Gas | USD (at $2500 ETH) |
|----------|--------------|---------------------|
| ACECompliance | ~2,500,000 | ~$0.006 |
| CREVerifier | ~1,800,000 | ~$0.005 |
| LeadNFTv2 | ~3,200,000 | ~$0.008 |
| RTBEscrow | ~2,100,000 | ~$0.005 |
| Marketplace | ~2,800,000 | ~$0.007 |
| **Total** | **~12,400,000** | **~$0.031** |

> Base mainnet is **10-50x cheaper** than Ethereum L1.

### 2c. Verify Contracts

```bash
npx hardhat verify --network base <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

---

## 3. Environment Variable Swap

### Backend (`backend/.env`)

```diff
- RPC_URL_SEPOLIA=https://eth-sepolia.g.alchemy.com/v2/KEY
- RPC_URL_BASE_SEPOLIA=https://sepolia.base.org
+ RPC_URL_BASE_MAINNET=https://mainnet.base.org
+ # or Alchemy: https://base-mainnet.g.alchemy.com/v2/KEY

- ACE_CONTRACT_ADDRESS=0x...sepolia
+ ACE_CONTRACT_ADDRESS=0x...base_mainnet

# Repeat for all 5 contract addresses

# USDC on Base mainnet:
+ USDC_CONTRACT_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

### Frontend (`frontend/.env.local`)

```diff
- VITE_DEFAULT_CHAIN_ID=11155111
+ VITE_DEFAULT_CHAIN_ID=8453

- VITE_ENABLE_TESTNET=true
+ VITE_ENABLE_TESTNET=false
```

---

## 4. Chainlink Subscription Migration

1. **CRE Functions:** Create new subscription on Base mainnet via [functions.chain.link](https://functions.chain.link)
2. **ACE:** Register new policies on mainnet ACE registry
3. **DECO:** Update attestation endpoints to mainnet oracle
4. **Data Streams:** Switch to mainnet feed IDs

```diff
- CRE_SUBSCRIPTION_ID=1234  # Sepolia
+ CRE_SUBSCRIPTION_ID=5678  # Base mainnet
```

---

## 5. RPC Provider Setup

| Provider | Endpoint | Free Tier |
|----------|----------|-----------|
| **Alchemy** | `base-mainnet.g.alchemy.com/v2/KEY` | 300M compute units/month |
| **Base RPC** | `mainnet.base.org` | Public, rate-limited |
| **QuickNode** | Custom endpoint | 10M API credits/month |

**Recommendation:** Use Alchemy for production with Base RPC as fallback.

---

## 6. Monitoring & Alerting

### Sentry
- Set `SENTRY_DSN` in both backend and frontend
- Configure alerts: error rate > 1%, p95 latency > 2s

### Uptime
- `/health` endpoint monitored via UptimeRobot or Render health checks
- Alert on 3+ consecutive failures

### On-chain
- Set up Tenderly alerts for contract events
- Monitor gas usage per operation

---

## 7. Rollback Plan

If critical issues are found post-migration:

1. **Frontend:** Revert Vercel to previous deployment (1-click)
2. **Backend:** Revert Render to previous deploy
3. **Contracts:** Cannot rollback — use pause pattern or deploy new versions
4. **DNS:** No change needed (same domains)

---

## 8. Post-Migration Validation

- [ ] Health check returns `status: ok`
- [ ] Contract calls succeed on Base mainnet
- [ ] USDC escrow creates/releases correctly
- [ ] CRE quality scoring runs on mainnet subscription
- [ ] ACE KYC checks pass on mainnet
- [ ] WebSocket connections stable (1000+ concurrent)
- [ ] Sentry receiving events (test error)
- [ ] CRM webhooks firing (test payload)
