# Lead Engine CRE — Submission Checklist
# Chainlink Services Evidence
# Generated: 2026-02-22

## 1. Chainlink CRE (Credit Risk Engine)

| Evidence | Details |
|---|---|
| Contract: CREVerifier | `contracts/src/CREVerifier.sol` — Chainlink Functions consumer |
| Deployed at | `0xe9c9C03C83D4da5AB29D7E0A53Ae48D8C84c6D6` (Base Sepolia, verified) |
| Dispatch log | `[CRE-DISPATCH]` — `backend/src/services/demo/demo-orchestrator.ts` (BuyItNow path) |
| On-chain call | `creService.requestOnChainQualityScore(leadId, tokenId)` — `backend/src/services/cre.service.ts` |
| Callback | `fulfillRequest()` in `CREVerifier.sol` stores quality score on-chain |
| Frontend badge | `QualityScore` component reads `lead.qualityScore` from DB (set by callback) |

## 2. Chainlink Automation

| Evidence | Details |
|---|---|
| Contract: AuctionAutomation | `contracts/src/AuctionAutomation.sol` |
| Deployed at | `0x853c97Dd7b7Aba83F1c58f0c21AEDB5BFbC4e7B` (Base Sepolia, verified) |
| Backend monitor | `backend/src/services/auction-monitor.service.ts` — polls every 2s |
| Closure service | `backend/src/services/auction-closure.service.ts` — `resolveExpiredAuctions()` |
| Safety gate | `ageMs >= 2_000` (2s after auctionEndAt) |

## 3. Chainlink VRF (Tiebreaker)

| Evidence | Details |
|---|---|
| Contract: LeadVault | `contracts/src/LeadVault.sol` — VRF consumer (inherited) |
| Deployed at | `0xB4e3Ee1E7c4c7DF32bB3B2E21f00E5A20d03e8C2` (Base Sepolia, verified) |
| Tiebreaker logic | `settleBid()` checks for tied highest bids, requests randomness |
| Orchestrator tracking | `hadTiebreaker = true` when settle tx triggers VRF event |
| Proof links | `vrfProofLinks[]` populated in results (Basescan tx link) |

## 4. Chainlink Functions

| Evidence | Details |
|---|---|
| Contract | `CREVerifier.sol` inherits `FunctionsClient` |
| Request path | `backend/src/services/cre.service.ts` → `requestOnChainQualityScore()` |
| DON subscription | `CHAINLINK_SUBSCRIPTIONID` env var — Base Sepolia DON |
| Callback | `fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err)` |
| Source code | `contracts/src/CREVerifier.sol` L45-L120 |

## 5. Chainlink Data Feeds (ETH/USD)

| Evidence | Details |
|---|---|
| Feed address | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` — ETH/USD, Base Sepolia |
| Usage | `CREVerifier.sol` reads ETH price in quality score normalization |
| Backend mirroring | `backend/src/services/chainlink-data-feeds.service.ts` |
| ABI | AggregatorV3Interface — `latestRoundData()` |

## Fee Model (Verified)

```
platformIncome = (winningBid * 0.05) + 1   // winner only
losers         → 100% refund via refundBid()
zero-bid leads → UNSOLD immediately, $0 fee, no VRF
```

## Results Persistence

- In-memory: `resultsStore: Map<runId, DemoResult>`
- On-disk: `demo-results.json` (atomic write on each update)
- API: `GET /api/demo/results/latest` + `GET /api/demo/results/:runId`
- All fields persisted: `cycles[], totalGas, totalSettled, totalPlatformIncome, vrfProofLinks[], totalTiebreakers`
