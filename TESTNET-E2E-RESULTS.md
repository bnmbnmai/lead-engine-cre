# Testnet E2E Results — Lead Engine CRE

> **Network:** Base Sepolia (chain 84532)  
> **Budget:** 0.158 ETH + 1,050 USDC (deployer wallet)  
> **Date:** _Auto-populated on run_  
> **Suite:** Low-Balance Phase 1 (conservative amounts)

---

## Budget Breakdown

| Item | Amount | Total |
|------|--------|-------|
| ETH per wallet (gas) | 0.012 | 0.12 ETH (×10) |
| USDC per buyer (vault) | 60 | 420 USDC (×7) |
| Vault deposit per buyer | 55 | 385 USDC (×7) |
| Deployer ETH reserve | — | ~0.038 ETH |
| Deployer USDC reserve | — | ~630 USDC |
| Stress test net cost | ~$15/cycle | ~$300 (×20 cycles) |

---

## Deployed Contracts

| Contract | Address | Basescan |
|----------|---------|----------|
| PersonalEscrowVault (v2) | `0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4` | [View](https://sepolia.basescan.org/address/0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4) |
| PersonalEscrowVault (v1, retired) | `0xcB949C0867B39C5adDDe45031E6C760A0Aa0CE13` | [View](https://sepolia.basescan.org/address/0xcB949C0867B39C5adDDe45031E6C760A0Aa0CE13) |
| LeadNFTv2 | `0x37414bc0341e0AAb94e51E89047eD73C7086E303` | [View](https://sepolia.basescan.org/address/0x37414bc0341e0AAb94e51E89047eD73C7086E303) |
| Marketplace | `0xfDf961C1E6687593E3aad9C6f585be0e44f96905` | [View](https://sepolia.basescan.org/address/0xfDf961C1E6687593E3aad9C6f585be0e44f96905) |
| RTBEscrow | `0xff5d18a9fff7682a5285ccdafd0253e34761DbDB` | [View](https://sepolia.basescan.org/address/0xff5d18a9fff7682a5285ccdafd0253e34761DbDB) |
| ACECompliance | `0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6` | [View](https://sepolia.basescan.org/address/0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6) |
| USDC (Base Sepolia) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | [View](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |

---

## Script 1: Fund Wallets (0.012 ETH + 60 USDC)

```
_Paste output from: npx hardhat run scripts/testnet/01-fund-wallets.ts --network baseSepolia_
```

---

## Script 2: Seed 20 Leads ($8–18 reserves)

```
_Paste output from: npx hardhat run scripts/testnet/02-seed-leads.ts --network baseSepolia_
```

---

## Script 3: Vault Deposits (7 × 55 USDC)

```
_Paste output from: npx hardhat run scripts/testnet/03-bulk-vault-deposits.ts --network baseSepolia_
```

---

## Script 4: Stress Test (20 E2E Cycles)

```
_Paste output from: npx hardhat run scripts/testnet/04-autobid-stress-test.ts --network baseSepolia_
```

---

## Script 5: PoR Fix Verification (3 Cycles)

> **New Vault:** `0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4`
> **Fix:** Added `totalObligations` counter — replaces `totalDeposited - totalWithdrawn` formula
> **Deploy TX:** [`0x423ea34b...`](https://sepolia.basescan.org/tx/0x423ea34b1a34ea69a355267562fe1e18fb11f97c957c5705a1f4b0a4ef24a7e8)

| Cycle | Locks | Settle | Refunds | Contract USDC | Obligations | PoR |
|-------|-------|--------|---------|---------------|-------------|-----|
| 1 | 1,2,3 | #1 | #2,#3 | 24.0 | 24.0 | ✅ SOLVENT |
| 2 | 4,5,6 | #4 | #5,#6 | 18.0 | 18.0 | ✅ SOLVENT |
| 3 | 7,8,9 | #7 | #8,#9 | 12.0 | 12.0 | ✅ SOLVENT |

**Result:** 3/3 cycles SOLVENT, 3 settlements, 6 refunds, 2,726,707 gas

---

## Cycle Results

| Cycle | Vertical | State | Bids | Winner | Amount | Settle Tx | Lock ID | Refunds |
|-------|----------|-------|------|--------|--------|-----------|---------|---------|
| _Auto-populated from stress test output_ |

---

## On-Chain Coverage Proof

- [ ] `vault.lockForBid` — 60 calls (3 per cycle × 20)
- [ ] `vault.settleBid` — 20 calls (1 winner per cycle)
- [ ] `vault.refundBid` — 40 calls (2 losers per cycle × 20)
- [ ] `vault.deposit` — 7 deposits
- [ ] `usdc.approve` — 7 approvals
- [ ] `usdc.transfer` — 7 USDC distributions
- [ ] PoR checks — 20 verifications
- [ ] CRE scoring — 20+ lead quality scores
- [ ] Auction creation — 20 auctions started via API

---

## Gas Budget

| Operation | Est. Gas | Count | Total |
|-----------|----------|-------|-------|
| ETH transfer | ~21,000 | 10 | ~210,000 |
| USDC transfer | ~55,000 | 7 | ~385,000 |
| USDC approve | ~46,000 | 7 | ~322,000 |
| vault.deposit | ~75,000 | 7 | ~525,000 |
| vault.lockForBid | ~90,000 | 60 | ~5,400,000 |
| vault.settleBid | ~120,000 | 20 | ~2,400,000 |
| vault.refundBid | ~80,000 | 40 | ~3,200,000 |
| **Total** | | | **~12.4M gas** |

At ~0.001 gwei Base Sepolia → negligible ETH cost.

---

## Execution Sequence

```bash
cd contracts

# 1. Fund wallets (0.012 ETH each + 60 USDC to buyers)
npx hardhat run scripts/testnet/01-fund-wallets.ts --network baseSepolia

# 2. Start backend (separate terminal)
cd ../backend && npm run dev

# 3. Seed marketplace (20 leads)
cd ../contracts
npx hardhat run scripts/testnet/02-seed-leads.ts --network baseSepolia

# 4. Fund buyer vaults (55 USDC each)
npx hardhat run scripts/testnet/03-bulk-vault-deposits.ts --network baseSepolia

# 5. Run stress test (20 cycles)
npx hardhat run scripts/testnet/04-autobid-stress-test.ts --network baseSepolia

# 6. Verify PoR fix (3 quick cycles)
npx hardhat run scripts/testnet/05-verify-por-fix.ts --network baseSepolia

# Optional: fewer stress test cycles
CYCLES=10 npx hardhat run scripts/testnet/04-autobid-stress-test.ts --network baseSepolia
```
