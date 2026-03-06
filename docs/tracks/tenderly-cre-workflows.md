# Tenderly & CRE Workflows Track

LeadRTB — Full transaction simulation and debugging via Tenderly VNet

---

## Why LeadRTB Wins This Track

LeadRTB uses **Tenderly VNet** for full transaction simulation and debugging across all 9 deployed contracts, alongside 2 production CRE workflows that run real business logic inside the Chainlink DON.

## Tenderly Integration

- **Tenderly Simulator (refreshed March 6, 2026)** — [Live Simulations](https://dashboard.tenderly.co/bnm/project/simulator) — 18 fresh simulations across all 9 contracts from the March-6 certified run (6 NFT mints #65–#70, 6 escrow settlements totaling $215, 2 VRF tiebreakers, 1 PoR solvency batch, 3 bounty payouts totaling $42). Full call traces, gas profiling, and state diffs for every interaction.
- **Replay Script** — `node scripts/tenderly-replay-march6.js` fetches real tx data from Base Sepolia RPC and replays each through Tenderly's simulation API. `scripts/tenderly-simulate.js` (33 KB) contains additional comprehensive scenarios.
- **Contract Debugging** — Full call trace, gas profiling, and state diff analysis for every on-chain interaction (escrow locks, NFT mints, VRF requests, bounty payouts).

## CRE Workflow Details

- **EvaluateBuyerRulesAndMatch** — 484-line TypeScript workflow with `CronCapability`, `ConfidentialHTTPClient`, 7 deterministic gates, `consensusIdenticalAggregation`. Located at `cre-workflows/EvaluateBuyerRulesAndMatch/main.ts`.
- **DecryptForWinner** — Winner-only PII decryption with `encryptOutput: true`. Located at `cre-workflows/DecryptForWinner/main.ts`.
- **CRE SDK:** `@chainlink/cre-sdk ^1.0.9` with typed config schema via Zod validation.

## Evidence

- **Tenderly Simulator:** [Live Simulations →](https://dashboard.tenderly.co/bnm/project/simulator)
- **CRE simulate:** `cd cre-workflows && cre workflow simulate ./EvaluateBuyerRulesAndMatch --target-staging-settings`
- **Certified runs:** `certified-runs/March-6-2026/` with full demo-results + CRE simulation JSONs
- **Live demo:** [leadrtb.com](https://leadrtb.com)

<!-- Screenshot: Tenderly VNet transaction trace showing PersonalEscrowVault settlement -->
