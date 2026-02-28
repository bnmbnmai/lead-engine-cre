# Lead Engine CRE — Submission Checklist
# Chainlink Services Evidence
# Generated: 2026-02-22

## 1. Chainlink CRE (Credit Risk Engine)

| Evidence | Details |
|---|---|
| Contract: CREVerifier | `contracts/contracts/CREVerifier.sol` — Chainlink Functions consumer |
| Deployed at | `0xfec22A5159E077d7016AAb5fC3E91e0124393af8` (Base Sepolia, [verified](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8)) |
| Dispatch log | `[CRE-DISPATCH]` — `backend/src/services/demo/demo-orchestrator.ts` (BuyItNow path) |
| On-chain call | `creService.requestOnChainQualityScore(leadId, tokenId)` — `backend/src/services/cre.service.ts` |
| Callback | `fulfillRequest()` in `CREVerifier.sol` stores quality score on-chain |
| Frontend badge | `QualityScore` component reads `lead.qualityScore` from DB (set by callback) |

## 2. Chainlink Automation

| Evidence | Details |
|---|---|
| Contract: PersonalEscrowVault | `contracts/contracts/PersonalEscrowVault.sol` |
| Deployed at | `0x56bB31bE214C54ebeCA55cd86d86512b94310F8C` (Base Sepolia, [verified](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C)) |
| Automation hooks | `checkUpkeep()` / `performUpkeep()` — daily Proof-of-Reserves, expired bid refunds |
| Backend reconciliation | `backend/src/services/vault-reconciliation.service.ts` — mirrors on-chain PoR |
| Safety gate | 7-day expiry on bid locks, auto-refund via `performUpkeep()` |

## 3. Chainlink VRF (Tiebreaker)

| Evidence | Details |
|---|---|
| Contract: VRFTieBreaker | `contracts/contracts/VRFTieBreaker.sol` — VRF v2.5 consumer |
| Deployed at | `0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e` (Base Sepolia, [verified](https://sepolia.basescan.org/address/0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e)) |
| Tiebreaker logic | `requestResolution()` → `requestRandomWords()`; winner = `randomWord % candidates.length` |
| Backend service | `backend/src/services/vrf.service.ts` — `requestTieBreak()` |
| Proof links | VRF fulfillment tx hashes logged in demo results |

## 4. Chainlink Functions

| Evidence | Details |
|---|---|
| Contract | `CREVerifier.sol` inherits `FunctionsClient` |
| Request path | `backend/src/services/cre.service.ts` → `requestOnChainQualityScore()` |
| DON subscription | `581` — Base Sepolia DON |
| Callback | `fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err)` |
| Source code | `contracts/contracts/CREVerifier.sol` |

## 5. Chainlink Data Feeds (ETH/USD)

| Evidence | Details |
|---|---|
| Feed address | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` — ETH/USD, Base Sepolia |
| Usage | `PersonalEscrowVault.sol` integrates `AggregatorV3Interface` for escrow deposit price guard |
| Backend mirroring | `backend/src/services/data-feeds.service.ts` |
| ABI | AggregatorV3Interface — `latestRoundData()` |

## Fee Model (Verified)

```
platformIncome = (winningBid * 0.05) + 1   // winner only
losers         → 100% refund via refundBid()
zero-bid leads → UNSOLD immediately, $0 fee, no VRF
```

## 6. CRE Workflow: EvaluateBuyerRulesAndMatch

| Evidence | Details |
|---|---|
| Workflow entry | `cre-workflows/EvaluateBuyerRulesAndMatch/main.ts` — `@chainlink/cre-sdk ^1.0.9` |
| SDK usage | `CronCapability`, `ConfidentialHTTPClient`, `consensusIdenticalAggregation`, `Runner.newRunner<Config>` |
| Gate evaluation | 7 deterministic gates: vertical, geo country, geo state include/exclude, quality score, off-site toggle, verified-only, field filters |
| Confidential HTTP | `ConfidentialHTTPClient` fetches preference sets + lead data with vault DON secret `{{.creApiKey}}` |
| Backend integration | `cre.service.ts:triggerBuyerRulesWorkflow(leadId)` — hybrid fallback with `CRE_WORKFLOW_ENABLED` env var |
| API endpoints | `GET /api/v1/auto-bid/preference-sets`, `GET /api/v1/auto-bid/pending-lead` — served by `auto-bid.routes.ts` |
| Vault secrets | `secrets.yaml`: `creApiKey` → `CRE_API_KEY_ALL`, `aesEncryptionKey` → `AES_KEY_ALL` |
| Simulate command | `cd cre-workflows && cre workflow simulate ./EvaluateBuyerRulesAndMatch --target=staging-settings` |
| Project config | `project.yaml`: Base Sepolia RPC, `workflow.yaml`: staging + production targets |

## Results Persistence

- In-memory: `resultsStore: Map<runId, DemoResult>`
- On-disk: `demo-results.json` (atomic write on each update)
- API: `GET /api/demo/results/latest` + `GET /api/demo/results/:runId`
- All fields persisted: `cycles[], totalGas, totalSettled, totalPlatformIncome, vrfProofLinks[], totalTiebreakers`

## 7. CRE Workflow: DecryptForWinner

| Evidence | Details |
|---|---|
| Workflow entry | `cre-workflows/DecryptForWinner/main.ts` — `@chainlink/cre-sdk ^1.0.9` |
| SDK usage | `ConfidentialHTTPClient`, `encryptOutput: true` |
| Backend endpoint | `POST /leads/:leadId/decrypt-pii` — verifies `escrowReleased: true` |
| Frontend integration | 🔓 Decrypt PII button in DemoPanel, BuyerDashboard, BuyerPortfolio |

## 8. Buyer Persona Experience

| Evidence | Details |
|---|---|
| Persona access | DemoPanel + "Run Full Demo" button accessible to all personas (env-gated, not role-gated) |
| Pure persona-wallet | Buyer persona authenticates as AI-agent wallet (`0x424CaC…`), Seller as `0x9Bb1…` — no MetaMask override, no synthetic fallbacks |
| Won leads in Dashboard | BuyerDashboard `Purchased Leads` table includes CRE Quality column with Shield badge |
| Won leads in Portfolio | BuyerPortfolio table + card views include CRE Quality badge + ACE KYC Verified status card + Decrypt PII button |
| NFT ID fallback | Shows vault lock ID with Basescan link or "Mint Pending" when `nftTokenId` is null |
| PII decryption | Inline PII display (name, email, phone) with "CRE DON Attested" badge — `POST /leads/:leadId/decrypt-pii` with wallet-based ownership check |
| ACE KYC badge | Portfolio stats row shows "ACE KYC Status: KYC Verified / Chainlink ACE Compliant" |
| Tooltip honesty | All quality-score tooltips use "CRE DON Match + Quality Score (pending on-chain scoring)" |

## 9. System-Wide CRE Consistency

| Evidence | Details |
|---|---|
| Centralized hook | `cre.service.ts:afterLeadCreated(leadId)` — fire-and-forget `triggerBuyerRulesWorkflow()` |
| marketplace.routes (Seller submit) | `afterLeadCreated(lead.id)` after CRE verify gate |
| marketplace.routes (Public submit) | `afterLeadCreated(lead.id)` after CRE verify gate |
| integration.routes (e2e-bid) | `afterLeadCreated(lead.id)` after CRE verify gate |
| demo-panel.routes (seed) | `afterLeadCreated(lead.id)` in seed loop |
| demo-panel.routes (POST /lead) | `afterLeadCreated(lead.id)` after auction room |
| demo-panel.routes (POST /demo-auction) | `afterLeadCreated(lead.id)` after auction room |
| demo-lead-drip (demo mode) | via `onLeadInjected` callback in `demo-orchestrator.ts` |
| Guard | `CRE_WORKFLOW_ENABLED=true` env var (default false) |

## 10. Real Quality Score Flow

| Evidence | Details |
|---|---|
| On-chain dispatch | `requestOnChainQualityScore(leadId, tokenId)` in demo-orchestrator after NFT mint |
| DON callback | `CREVerifier.fulfillRequest()` stores quality score in DB |
| DemoResult population | `demo-orchestrator.ts` reads `lead.qualityScore` from DB after settlement |
| Frontend display | DemoResults shows real score when available, "Pending" badge when not |
| Per-cycle download | Each cycle row has Download button → JSON with leadId, qualityScore, gates |

