# CRE & AI Track

**Prize: $20,000** | LeadRTB — 7-gate deterministic buyer-rule evaluation inside the Chainlink DON

---

## Why LeadRTB Wins This Track

LeadRTB deploys **two production CRE workflows** using `@chainlink/cre-sdk` that run real business logic inside the Chainlink DON: a 484-line 7-gate buyer-rule evaluation and a winner-only PII decryption workflow with `encryptOutput: true`.

## CRE Workflow Integrations

- **EvaluateBuyerRulesAndMatch** (484 lines) — `CronCapability` + `ConfidentialHTTPClient` + `consensusIdenticalAggregation`. Fetches lead + buyer preferences via Confidential HTTP with Vault DON secrets (`{{.creApiKey}}`), runs 7 deterministic gates (vertical, geo country, geo state, quality score, off-site, verified-only, field-level filters), returns match results with BFT consensus.
- **DecryptForWinner** — `ConfidentialHTTPClient` with `encryptOutput: true`. Verifies winner JWT, decrypts PII only for the auction winner. Ensures no PII leaks during bidding.
- **On-Chain Quality Scoring** — `CREVerifier` ([0xfec22A…af8](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8)) dispatches `requestOnChainQualityScore()` after every NFT mint. `fulfillRequest()` writes `uint16 score` on-chain per lead.
- **Unified CRE Pipeline** — `afterLeadCreated()` hook fires on ALL lead paths (API, webhook, demo, drip) ensuring every lead goes through CRE quality scoring.

## Evidence

- **CRE simulate command:** `cd cre-workflows && cre workflow simulate ./EvaluateBuyerRulesAndMatch --target-staging-settings`
- **CRE subscription ID:** 581 (Base Sepolia DON)
- **Field-level filters:** 11 operators (EQUALS, IN, GT, LT, BETWEEN, CONTAINS, STARTS_WITH, NOT_EQUALS, NOT_IN, GTE, LTE)
- **Live demo:** [leadrtb.com](https://leadrtb.com) — click "Run Full On-Chain Demo" to see CRE scoring in action

<!-- Screenshot: CRE workflow evaluation results in Demo Results table -->
