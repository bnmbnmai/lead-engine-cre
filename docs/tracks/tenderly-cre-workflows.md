# Tenderly & CRE Workflows Track

**Prize: $5,000** | LeadRTB — Full transaction simulation and debugging via Tenderly VNet

---

## Why LeadRTB Wins This Track

LeadRTB uses **Tenderly VNet** for full transaction simulation and debugging across all 9 deployed contracts, alongside 2 production CRE workflows that run real business logic inside the Chainlink DON.

## Tenderly Integration

- **Tenderly VNet Explorer** — [Live dashboard](https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions) with full transaction traces for PersonalEscrowVault, LeadNFTv2, CREVerifier, VRFTieBreaker, and all 9 contracts.
- **Simulation Script** — `scripts/tenderly-replay-march6.sh` replays 18 key transactions from the March-6 certified run (6 NFT mints, 6 escrow settlements, 2 VRF tiebreakers, 1 PoR batch, 3 bounty payouts). `scripts/tenderly-simulate.js` (33 KB) contains additional comprehensive scenarios.
- **Fresh Simulations (March 6, 2026)** — All 9 contracts have fresh transaction traces from the latest certified run (NFTs #65–#70, $215 settled, 2 VRF tiebreakers, PoR solvency check).
- **Contract Debugging** — Full call trace, gas profiling, and state diff analysis for every on-chain interaction (escrow locks, NFT mints, VRF requests, bounty payouts).

## CRE Workflow Details

- **EvaluateBuyerRulesAndMatch** — 484-line TypeScript workflow with `CronCapability`, `ConfidentialHTTPClient`, 7 deterministic gates, `consensusIdenticalAggregation`. Located at `cre-workflows/EvaluateBuyerRulesAndMatch/main.ts`.
- **DecryptForWinner** — Winner-only PII decryption with `encryptOutput: true`. Located at `cre-workflows/DecryptForWinner/main.ts`.
- **CRE SDK:** `@chainlink/cre-sdk ^1.0.9` with typed config schema via Zod validation.

## Evidence

- **Tenderly VNet:** [Explorer →](https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions)
- **CRE simulate:** `cd cre-workflows && cre workflow simulate ./EvaluateBuyerRulesAndMatch --target-staging-settings`
- **Certified runs:** `certified-runs/March-3-2026/` with full demo-results + CRE simulation JSONs
- **Live demo:** [leadrtb.com](https://leadrtb.com)

<!-- Screenshot: Tenderly VNet transaction trace showing PersonalEscrowVault settlement -->
