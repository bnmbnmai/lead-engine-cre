# Test Verification Checklist — Lead Engine CRE

> Run these commands locally to verify all test suites before submission.

---

## Quick Run (All Tests)

```powershell
# Backend unit + integration (11 test files)
cd backend; npx jest --forceExit --verbose 2>&1 | Tee-Object test-results/backend.txt

# Security simulation
cd backend; npx jest tests/security/privacy-audit.test.ts --verbose

# Auto-bid engine
cd backend; npx jest tests/auto-bid.test.ts --verbose

# CRM webhooks (rate limit + circuit breaker)
cd backend; npx jest tests/crm-webhooks.test.ts --verbose

# ZK service
cd backend; npx jest tests/unit/zk.service.test.ts --verbose

# Artillery load (full)
artillery run tests/load/artillery-rtb.yaml --output test-results/artillery-rtb.json
artillery run tests/load/artillery-edge-cases.yaml --output test-results/artillery-edge.json
artillery run tests/load/artillery-stress-10k.yaml --output test-results/artillery-stress.json

# Cypress E2E (53+ tests)
cd frontend; npx cypress run --spec "cypress/e2e/**/*.cy.ts"

# Smart contracts
npx hardhat test
```

---

## Test Inventory

### Backend (Jest) — 11 Files

| File | Category | Tests |
|------|----------|-------|
| `unit/ace.service.test.ts` | ACE compliance | KYC, jurisdiction, MiCA |
| `unit/cre.service.test.ts` | CRE verification | Quality scoring, fraud detection |
| `unit/nft.service.test.ts` | LeadNFT | Minting, metadata, ownership |
| `unit/privacy.service.test.ts` | Privacy suite | AES-256-GCM, commit-reveal |
| `unit/x402.service.test.ts` | x402 settlement | Escrow create/release/refund |
| `unit/zk.service.test.ts` | ZK proofs | Commitment verification |
| `compliance/ace-simulation.test.ts` | Integration | Cross-border rules, reputation |
| `e2e/demo-flow.test.ts` | E2E | Full demo workflow |
| `security/privacy-audit.test.ts` | Security | 29 scenarios, 7 categories |
| `auto-bid.test.ts` | Auto-bid | 9-criteria matching, budget caps |
| `crm-webhooks.test.ts` | CRM | Webhooks, rate limits, circuit breaker |

### Artillery (Load) — 3 Configs

| Config | Scenarios | Peak |
|--------|-----------|------|
| `artillery-rtb.yaml` | RTB flow, bid placement, auction | 1K concurrent |
| `artillery-edge-cases.yaml` | Geo-burst, off-site flood, concurrent bids | 2K concurrent |
| `artillery-stress-10k.yaml` | Full stress test | 10K concurrent |

### Cypress (E2E) — 4 Spec Files

| Spec | Tests | Coverage |
|------|-------|----------|
| `ui-flows.cy.ts` | Seller submit, buyer bid, auction | Core flows |
| `multi-wallet.cy.ts` | Multiple wallets, role switching | Auth |
| `stress-ui.cy.ts` | Rapid navigation, concurrent actions | Performance |
| `copy-assertions.cy.ts` | Marketing copy, stats, tooltips | Content |

### Smart Contracts (Hardhat) — 5 Contracts

| Contract | Coverage |
|----------|----------|
| `CREVerifier.sol` | Verification, scoring |
| `ACECompliance.sol` | KYC, jurisdiction |
| `LeadNFTv2.sol` | Minting, transfer |
| `RTBEscrow.sol` | Create, release, refund |
| `Marketplace.sol` | Listing, bidding |

---

## Edge Cases Covered

| Edge Case | Test File | What's Tested |
|-----------|-----------|---------------|
| **Geo-burst** (20+ countries concurrent) | `artillery-edge-cases.yaml` | 2K concurrent from mixed geos, no 5xx |
| **Webhook rate limit** | `crm-webhooks.test.ts` | 60/min per webhook, sliding window |
| **Webhook circuit breaker** | `crm-webhooks.test.ts` | 5 failures → trip, 5min cooldown |
| **ZK proof failure** | `unit/zk.service.test.ts` | Invalid commitment, hash mismatch |
| **Off-site flood** | `artillery-edge-cases.yaml` | 80%+ off-site ratio triggers anomaly |
| **Cross-border ACE block** | `compliance/ace-simulation.test.ts` | NY→EU block, TCPA compliance |
| **Duplicate lead prevention** | `auto-bid.test.ts` | Same lead, multiple auto-bid triggers |
| **Budget exhaustion** | `auto-bid.test.ts` | Daily budget exceeded mid-auction |
| **Concurrent sealed bids** | `artillery-rtb.yaml` | 100+ bids on same lead simultaneously |
| **PII encryption at rest** | `security/privacy-audit.test.ts` | AES-256-GCM roundtrip validation |

---

## CI Secrets Required

Add these to **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Required | Purpose |
|--------|----------|---------|
| `ALCHEMY_API_KEY` | Optional | RPC provider for contract tests |
| `RPC_URL_SEPOLIA` | Optional | Sepolia endpoint for integration tests |
| `SENTRY_DSN` | Optional | Error monitoring (backend) |

> All secrets are optional — tests use stubs/mocks when secrets are absent.

---

## Expected Results

| Suite | Count | Threshold |
|-------|-------|-----------|
| Backend Jest | 90+ | 0 failures |
| Security Sim | 29/29 | 0 failures |
| Cypress E2E | 53+ | 0 failures |
| Artillery RTB | 23+ scenarios | P95 < 500ms, 0% error rate |
| Hardhat | All passing | 0 failures |
| **Total** | **166+** | — |
