# Tenderly & CRE Workflows Track

LeadRTB — Full transaction simulation via Tenderly VNet + 2 production CRE workflows inside the Chainlink DON

---

## Why LeadRTB Wins This Track

LeadRTB combines **Tenderly VNet** for full transaction simulation and debugging across all 9 deployed contracts with **2 production CRE workflows** that run real business logic inside the Chainlink DON — buyer-rule evaluation and winner-only PII decryption, both using `@chainlink/cre-sdk`.

## Tenderly Integration

- **Tenderly Simulator (refreshed March 6, 2026)** — [Live Simulations](https://dashboard.tenderly.co/bnm/project/simulator) — 18 fresh simulations across all 9 contracts from the March-6 certified run (6 NFT mints #65–#70, 6 escrow settlements totaling $215, 2 VRF tiebreakers, 1 PoR solvency batch, 3 bounty payouts totaling $42). Full call traces, gas profiling, and state diffs for every interaction.
- **Replay Script** — `node scripts/tenderly-replay-march6.js` fetches real tx data from Base Sepolia RPC and replays each through Tenderly's simulation API. `scripts/tenderly-simulate.js` (33 KB) contains additional comprehensive scenarios.
- **Contract Debugging** — Full call trace, gas profiling, and state diff analysis for every on-chain interaction (escrow locks, NFT mints, VRF requests, bounty payouts).

## CRE Workflow Details

- **EvaluateBuyerRulesAndMatch** — 484-line TypeScript workflow with `CronCapability`, `ConfidentialHTTPClient`, 7 deterministic gates, `consensusIdenticalAggregation`. Fetches lead + buyer preferences via Confidential HTTP with Vault DON secrets (`{{.creApiKey}}`). Located at `cre-workflows/EvaluateBuyerRulesAndMatch/main.ts`.
- **DecryptForWinner** — 39-line winner-only PII decryption workflow. `CronCapability` → `ConfidentialHTTPClient` POST to `/decrypt-pii` → backend verifies `escrowReleased: true` → `privacyService.decryptLeadPII()` → `encryptOutput: true` ensures PII encrypted for winner's DON node only → `consensusIdenticalAggregation`. Located at `cre-workflows/DecryptForWinner/main.ts`.
- **CRE SDK:** `@chainlink/cre-sdk ^1.0.9` with typed config schema via Zod validation. Shared Vault secrets in `cre-workflows/secrets.yaml`.

## Evidence

- **Tenderly Simulator:** [Live Simulations →](https://dashboard.tenderly.co/bnm/project/simulator)
- **CRE simulate (EvaluateBuyerRulesAndMatch):**
  ```bash
  cd cre-workflows && cre workflow simulate ./EvaluateBuyerRulesAndMatch --target-staging-settings
  ```
- **CRE simulate (DecryptForWinner):**
  ```bash
  cd cre-workflows && cre workflow simulate ./DecryptForWinner --target-staging-settings
  ```
- **Certified runs:** `certified-runs/March-6-2026/` with full demo-results + CRE simulation JSONs
- **Live demo:** [leadrtb.com](https://leadrtb.com)
