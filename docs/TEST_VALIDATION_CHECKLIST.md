# Test Validation Checklist — Lead Engine CRE

> All 166+ tests audited and confirmed relevant. **No pruning needed** — every test covers an active, distinct feature.

---

## Test Inventory (23 files)

### Backend Unit Tests (6 files, ~68 tests)

| File | Tests | Coverage | Status |
|------|-------|----------|--------|
| `unit/ace.service.test.ts` | 14 | Jurisdiction, KYC, cross-border, reputation, edge cases | ✅ Active |
| `unit/cre.service.test.ts` | 12 | Lead verification, quality scoring, parameter matching | ✅ Active |
| `unit/nft.service.test.ts` | 7 | Mint fallback, sale recording, metadata, quality update | ✅ Active |
| `unit/privacy.service.test.ts` | 14 | AES-GCM encrypt/decrypt, bid commit-reveal, token metadata, commitments | ✅ Active |
| `unit/x402.service.test.ts` | 10 | Payment lifecycle, escrow, refund, headers, double-settle | ✅ Active |
| `unit/zk.service.test.ts` | 11 | Fraud proof, local verify, geo-parameter match, bid commitment | ✅ Active |

### Backend Integration Tests (5 files, ~72 tests)

| File | Tests | Coverage | Status |
|------|-------|----------|--------|
| `auto-bid.test.ts` | 18 | 9-criteria engine: quality gate, geo include/exclude, budget, verified-only, multi-buyer, vertical rules, duplicate prevention | ✅ Active |
| `crm-webhooks.test.ts` | 10 | Register (generic/HubSpot/Zapier), list, delete, payload format, rate-limit aware | ✅ Active |
| `compliance/ace-simulation.test.ts` | 29 | Cross-border matrix (17 state pairs), reputation thresholds (7), off-site fraud (3), jurisdiction policy (2) | ✅ Active |
| `security/privacy-audit.test.ts` | 10 | No plaintext leakage, commitment integrity, AAD binding, PII at rest, key sensitivity | ✅ Active |
| `e2e/demo-flow.test.ts` | 5 | Full 8-step pipeline, non-compliant buyer, ZK+privacy cross-service, geo-match | ✅ Active |

### Cypress E2E (4 files, ~53 tests)

| File | Tests | Coverage | Status |
|------|-------|----------|--------|
| `ui-flows.cy.ts` | 15 | Seller submit, buyer dashboard, marketplace, wallet connect | ✅ Active |
| `multi-wallet.cy.ts` | 8 | Wallet switching, balance display, multi-account flows | ✅ Active |
| `copy-assertions.cy.ts` | 18 | Copy accuracy, i18n placeholders, benefits messaging | ✅ Active |
| `stress-ui.cy.ts` | 12 | Rapid clicks, large dataset rendering, concurrent actions | ✅ Active |

### Contract Tests (7 files, ~15 tests)

| File | Tests | Coverage | Status |
|------|-------|----------|--------|
| `ACECompliance.test.ts` | 3 | Verify user, blacklist, jurisdiction block | ✅ Active |
| `LeadNFT.test.ts` | 3 | Mint, verify, sell lifecycle | ✅ Active |
| `Marketplace.test.ts` | 3 | List, sealed bid, auction resolve | ✅ Active |
| `e2e-settlement.test.ts` | 6 | Escrow create/fund/release/refund/dispute | ✅ Active |
| `e2e-reorg.test.ts` | 4 | Confirmation safety, block reorg handling | ✅ Active |
| `e2e-chainlink-stubs.test.ts` | 5 | CRE verification, Functions router mock, DON response | ✅ Active |
| `Integration.test.ts` | 3 | Cross-contract interactions | ✅ Active |

### Load Tests (1 file)

| File | Scenarios | Coverage | Status |
|------|-----------|----------|--------|
| `backend/tests/load-test.yml` | 10K peak | Health, leads, bids, analytics endpoints | ✅ Active |

---

## Pruning Analysis

After full audit, **no tests should be pruned**. Here's why:

| Candidate | Decision | Reason |
|-----------|----------|--------|
| `unit/privacy` vs `security/privacy-audit` | **Keep both** | Unit tests cover individual functions; security audit tests cross-cutting concerns (no leakage, AAD binding) |
| `unit/ace` vs `compliance/ace-simulation` | **Keep both** | Unit tests cover service methods; simulation covers cross-border matrix (17 state pairs × verticals) |
| `copy-assertions.cy.ts` (post-i18n) | **Keep** | Tests verify i18n placeholder rendering, not hardcoded strings — still valid after i18n expansion |
| `e2e-chainlink-stubs.test.ts` (post-CRE work) | **Keep** | Tests mock Chainlink Functions router — needed for CI where no Chainlink subscription exists |
| `unit/nft` (7 tests, minimal) | **Keep** | Covers off-chain fallback path which is critical for hackathon demo without deployed contracts |

---

## Edge Case Handling

| Edge Case | Impact | Resolution |
|-----------|--------|------------|
| **i18n expansion** (de, fr, ja) | `copy-assertions.cy.ts` tests English locale only | ✅ Tests check key presence, not hardcoded strings — valid |
| **Sentry optional** | Frontend build could fail if import broken | ✅ `sentry.ts` uses `Function('m','return import(m)')` — no static import |
| **Prisma mock** | All backend tests mock Prisma | ✅ No DB required for Jest — tests run anywhere |
| **Contract deploy** | Hardhat tests assume local network | ✅ Uses Hardhat network (chain 31337) by default |
| **Artillery target** | Requires running backend on localhost:3001 | ⚠️ Script warns if backend not running |

---

## How to Run

### Windows (PowerShell)
```powershell
# All suites
.\scripts\test-validate.ps1

# Specific suite
.\scripts\test-validate.ps1 -Suite backend
.\scripts\test-validate.ps1 -Suite contracts
```

### Linux/macOS (Bash)
```bash
chmod +x scripts/test-validate.sh
bash scripts/test-validate.sh           # all
bash scripts/test-validate.sh backend   # specific
```

### Individual Commands
```bash
# Backend Jest (with coverage)
cd backend && npm test -- --coverage --forceExit

# Frontend build
cd frontend && npm run build

# Cypress headless
cd frontend && npx cypress run --headless

# Artillery smoke
artillery run backend/tests/load-test.yml

# Hardhat contracts
cd contracts && npx hardhat test
```
