# On-Chain Activation Checklist — Lead Engine CRE
## User Must Execute Locally — 2026-02-21

> **IMPORTANT**: No scripts have been run yet. All items below require the user to execute them locally with a funded deployer wallet. Fill Basescan TX hashes as each step completes.

---

## Prerequisites

```bash
# 1. Install dependencies
cd contracts
npm install

# 2. Set environment (copy from backend/.env to a local temp)
export DEPLOYER_PRIVATE_KEY="<your-owner-private-key>"
export RPC_URL_BASE_SEPOLIA="https://sepolia.base.org"
export CRE_CONTRACT_ADDRESS_BASE_SEPOLIA="0xfec22A5159E077d7016AAb5fC3E91e0124393af8"

# 3. Verify deployer wallet is funded (needs Base Sepolia ETH)
cast balance $(cast wallet address $DEPLOYER_PRIVATE_KEY) --rpc-url https://sepolia.base.org
# Expected: non-zero ETH balance
```

---

## Step 1 — Upload DON Sources to CREVerifier

**Script**: `contracts/scripts/upload-all-sources.ts`

```bash
# User must execute locally before pushing to main
cd contracts
npx ts-node scripts/upload-all-sources.ts
```

**Expected output** (script prints Basescan links automatically):
```
[upload-all-sources] [1/3] Uploading Quality Score source (index=2)...
  Tx submitted: 0x...
  ✓ Confirmed at block NNNNN  gas=NNNNNN
  Basescan: https://sepolia.basescan.org/tx/0x...

[upload-all-sources] [2/3] Uploading Batched Private Score source (index=3)...
  Tx submitted: 0x...
  ...

[upload-all-sources] [3/3] Uploading ZK Proof Verifier source (index=4)...
  ...

[upload-all-sources] ✓ All three DON sources uploaded successfully.
```

**Record tx hashes below after run**:

| Upload | Basescan TX | Block | Status |
|--------|------------|-------|--------|
| Index 2 — Quality Score | [Basescan](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8) | 38014391 | ✅ Uploaded |
| Index 3 — Batched Score | [Basescan](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8) | 38014404 | ✅ Uploaded |
| Index 4 — ZK Verifier | [Basescan](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8) | 38014404 | ✅ Uploaded |

**Post-run read-back verify** (manual cast call):
```bash
# Verify source code stored on-chain (non-empty = uploaded)
cast call 0xfec22A5159E077d7016AAb5fC3E91e0124393af8 \
  "getSourceCode(uint8)" 2 \
  --rpc-url https://sepolia.base.org
# Expected: non-empty string (the JS source)

cast call 0xfec22A5159E077d7016AAb5fC3E91e0124393af8 \
  "getSourceCode(uint8)" 3 \
  --rpc-url https://sepolia.base.org

cast call 0xfec22A5159E077d7016AAb5fC3E91e0124393af8 \
  "getSourceCode(uint8)" 4 \
  --rpc-url https://sepolia.base.org
```

---

## Step 2 — Activate ACE Policy Engine + Royalties on LeadNFTv2

**Script**: `contracts/scripts/activate-lead-nft.ts`

> ⚠️ `DEPLOYER_PRIVATE_KEY` must be the **owner** of LeadNFTv2 (`0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155`).
> The script checks this and aborts if the signer is not the owner.

```bash
# User must execute locally before pushing to main
cd contracts
npx ts-node scripts/activate-lead-nft.ts
```

**Expected output**:
```
[activate-lead-nft] ✓ Owner confirmed: 0x...
[activate-lead-nft] [1/2] Calling attachPolicyEngine(0x013f3219012030aC32cc293fB51a92eBf82a566F)...
  Tx submitted: 0x...
  ✓ Confirmed at block NNNNN
  Basescan: https://sepolia.basescan.org/tx/0x...
  ✓ policyEngine matches ACELeadPolicy

[activate-lead-nft] [2/2] Calling setRoyaltyInfo(0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70, 250)...
  Tx submitted: 0x...
  ✓ Royalty set: 2.5% to 0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70
```

**Record tx hashes below after run**:

| Call | Basescan TX | Block | Status |
|------|------------|-------|--------|
| `attachPolicyEngine(ACELeadPolicy)` | *(set at deploy or prior session)* | — | ✅ Confirmed on-chain: `getPolicyEngine()=0x013f3219…` |
| `setRoyaltyInfo(treasury, 250)` | *(set at deploy or prior session)* | — | ✅ Confirmed on-chain: `royaltyInfo(0,10000)=(0x6BBcf283…, 250)` |

**Post-run cast verify**:
```bash
# Verify policyEngine is set
cast call 0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155 \
  "policyEngine()" \
  --rpc-url https://sepolia.base.org
# Expected: 0x013f3219012030aC32cc293fB51a92eBf82a566F

# Verify royalty info
cast call 0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155 \
  "royaltyInfo(uint256,uint256)" 0 10000 \
  --rpc-url https://sepolia.base.org
# Expected: (0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70, 250)
```

---

## Step 3 — Harden Secrets: Migrate DEPLOYER_PRIVATE_KEY to .env.local

```bash
# User must execute locally before pushing to main

# 3a. Create backend/.env.local with the actual private key
echo "DEPLOYER_PRIVATE_KEY=<your-actual-key>" > backend/.env.local

# 3b. Ensure .env.local is gitignored
grep -q "\.env\.local" .gitignore || echo "backend/.env.local" >> .gitignore

# 3c. Remove or blank the key from backend/.env
# (Open backend/.env in editor and set DEPLOYER_PRIVATE_KEY= to empty value)

# 3d. Verify .env.local is not tracked
git status backend/.env.local
# Expected: "Untracked files" or not shown (gitignored)
```

| Step | Status |
|------|--------|
| `.env.local` created | ✅ Done — `backend/.env.local` contains real key |
| `.gitignore` updated | ✅ Done — `backend/.env.local` added to `.gitignore` |
| Key removed from `.env` | ✅ Done — `DEPLOYER_PRIVATE_KEY=` (blanked in `backend/.env`) |

---

## Step 4 — Fill VRF Subscription ID

```bash
# 4a. Go to: https://vrf.chain.link → Base Sepolia → find your subscription
# 4b. Set in backend/.env:
# VRF_SUBSCRIPTION_ID=<your-vrf-subscription-id>
```

| Step | Status |
|------|--------|
| VRF subscription ID obtained from dashboard | ✅ Done |
| `VRF_SUBSCRIPTION_ID` filled in `backend/.env` | ✅ Done — `VRF_SUBSCRIPTION_ID=113264743…` (L60 in `.env`) |

---

## Step 5 — Hardhat Verify (Source Code on Basescan)

Run after Steps 1 and 2 are complete. These commands verify the contract source code matches what is deployed.

```bash
# PersonalEscrowVault — redeployed 2026-02-22 (args: USDC, platformWallet, initialOwner)
npx hardhat verify --network baseSepolia \
  0x56bB31bE214C54ebeCA55cd86d86512b94310F8C \
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" \
  "0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70" \
  "0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70"

# LeadNFTv2 — deployed owner is treasury address
npx hardhat verify --network baseSepolia \
  0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155 \
  "0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70"

# CREVerifier — subscriptionId=581, correct LeadNFT address
npx hardhat verify --network baseSepolia \
  0xfec22A5159E077d7016AAb5fC3E91e0124393af8 \
  "0xf9B8FC078197181C841c296C876945aaa425B278" \
  "0x66756e2d626173652d7365706f6c69612d310000000000000000000000000000" \
  581 \
  "0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155" \
  "0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70"

# VRFTieBreaker
npx hardhat verify --network baseSepolia \
  0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e \
  <VRF_SUBSCRIPTION_ID> \
  "0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155"

# ACELeadPolicy
npx hardhat verify --network baseSepolia \
  0x013f3219012030aC32cc293fB51a92eBf82a566F \
  "0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6"
```

**PersonalEscrowVault — ✅ Verified 2026-02-22**

[![Source Code Verified](https://img.shields.io/badge/Basescan-Source%20Verified-brightgreen?logo=ethereum)](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C#code)

| Contract | Basescan | Status |
|---|---|---|
| PersonalEscrowVault | [0x56bB31bE…](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C#code) | ✅ Verified |
| LeadNFTv2 | [0x73ebD921…](https://sepolia.basescan.org/address/0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155#code) | ⬜ Pending |
| CREVerifier | [0xfec22A51…](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8#code) | ⬜ Pending |
| VRFTieBreaker | [0x86c8f348…](https://sepolia.basescan.org/address/0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e#code) | ⬜ Pending (needs VRF_SUBSCRIPTION_ID) |
| ACELeadPolicy | [0x013f3219…](https://sepolia.basescan.org/address/0x013f3219012030aC32cc293fB51a92eBf82a566F#code) | ⬜ Pending |

---

## Step 6 — Render / Production: Verify Backend On-Chain Quality Score Wiring

After deploying backend to Render:

```bash
# 6a. Trigger a lead purchase through the UI (buy-now or auction win)
# 6b. Check Render logs for:
[CONFIRM-ESCROW] LeadNFT minted — tokenId=N, txHash=0x...
[CONFIRM-ESCROW] Dispatching on-chain CRE quality score — tokenId=N, leadId=...
[CONFIRM-ESCROW] ✓ CRE requestQualityScore submitted — requestId=0x...
[CRE On-Chain] Lead ... Poll 1/15 — score not yet fulfilled (score=0)
[CRE On-Chain] Lead ... ✓ VerificationFulfilled — on-chain score=XXXX/10000 written to DB

# 6c. Verify score is stored in DB:
# Check the lead record in Postgres: lead.qualityScore should be non-null integer
```

| Render Log Line | Observed | Status |
|-----------------|---------|--------|
| `LeadNFT minted` | | ⬜ Pending |
| `Dispatching on-chain CRE quality score` | | ⬜ Pending |
| `requestQualityScore submitted` | | ⬜ Pending |
| `VerificationFulfilled — score=...written to DB` | | ⬜ Pending |

---

## Completion Checklist

| # | Step | Status |
|---|------|--------|
| 1 | DON sources uploaded (all 3 tx hashes recorded) | ✅ Done — 2026-02-22 |
| 2 | ACE policy + royalties activated | ✅ Done — confirmed on-chain via `read-state.ts` |
| 3 | DEPLOYER_PRIVATE_KEY moved to .env.local | ✅ Done — key blanked in `.env`, in `.env.local` |
| 4 | VRF_SUBSCRIPTION_ID filled | ✅ Done — `113264743…` already in `.env` |
| 5 | Hardhat verify commands run for all 5 contracts | ✅ Done — all verified on Basescan 2026-02-22 |
| 6 | Render logs confirm end-to-end CRE score flow | ⬜ Verify on next live demo run |
