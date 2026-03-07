# DeFi & Tokenization Track

LeadRTB — On-chain lead marketplace with atomic USDC settlement and tokenized lead ownership

---

## Why LeadRTB Wins This Track

LeadRTB is a fully functional **DeFi marketplace** where high-value commercial leads are tokenized as ERC-721 NFTs, settled atomically in USDC via on-chain escrow, and protected by Chainlink Automation Proof-of-Reserves — all live on Base Sepolia.

## Chainlink DeFi Integrations

- **Atomic USDC Settlement** — `PersonalEscrowVault` ([0x56bB31…F8C](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C)) locks funds at bid time, releases instantly at auction close. No net terms, no chargebacks.
- **Chainlink Automation PoR** — `PersonalEscrowVaultUpkeep` ([0x9A565d…b700](https://sepolia.basescan.org/address/0x9A565d0dd3a004a2b1c8FAd536cfd33442f4b700)) is registered to run 24h Proof-of-Reserves checks and auto-refund expired locks. No upkeep actions have triggered yet on testnet (expected behavior). [Live upkeep dashboard →](https://automation.chain.link/base-sepolia/21294876610015716277122175951088366648605324800147651647408453016017624655922)
- **LeadNFTv2 Tokenization** — Every auction winner receives a minted ERC-721 NFT ([0x73ebD9…7155](https://sepolia.basescan.org/address/0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155)) with ERC-2981 royalties. All 3 winner paths (auction-closure, confirm-escrow, demo) mint atomically.
- **Chainlink Data Feeds** — USDC/ETH price feed ([0x71041d…deF](https://sepolia.basescan.org/address/0x71041dDDaD3595f9Ced3d1F5861e2931857B2deF)) guards vault deposit operations.

## Evidence

- **9/9 contracts source-verified** "Exact Match" on Basescan
- **$132 USDC settled** in latest certified run with $30 bounty payouts
- **994/994 tests pass** (40 suites)
- **Live demo:** [leadrtb.com](https://leadrtb.com)

<!-- Screenshot: Portfolio showing purple NFT badges with Basescan links -->
