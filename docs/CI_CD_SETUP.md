# CI/CD Setup Guide

## Quick Start

The workflow runs automatically on every push to `main`/`develop` and on PRs to `main`.

```
.github/workflows/test.yml
├── 🔍 lint           (5m)  — ESLint on backend + frontend
├── 🧪 backend-tests  (10m) — Jest + PostgreSQL 16 service
├── ⛓️ hardhat-tests  (10m) — Hardhat compile + test
├── 🌲 cypress-e2e    (10m) — 112 Cypress E2E tests
└── 🚀 artillery-load (15m) — RTB baseline (advisory)
```

All 5 jobs run **in parallel** on `ubuntu-latest` with Node 20.

---

## Required GitHub Secrets

Go to **repo → Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Required? | Value |
|--------|-----------|-------|
| `JWT_SECRET` | Recommended | 64-char hex: `openssl rand -hex 32` |

> **That's it.** The workflow injects safe CI defaults for everything else (`DATABASE_URL` is auto-constructed from the PostgreSQL service container, Alchemy keys aren't needed for local Hardhat tests).

### Optional Secrets (only for deploy workflows)

| Secret | Purpose |
|--------|---------|
| `ALCHEMY_API_KEY` | Sepolia forking in Hardhat (not used in CI tests) |
| `DEPLOYER_PRIVATE_KEY` | Contract deployment (not used in test workflow) |
| `ETHERSCAN_API_KEY` | Contract verification |

---

## Simulated Run Logs

### ✅ All Jobs Passing

```
CI — Lead Engine CRE / 🔍 Lint                              ✅ 47s
CI — Lead Engine CRE / 🧪 Backend (Jest)                    ✅ 3m 12s
CI — Lead Engine CRE / ⛓️ Contracts (Hardhat)               ✅ 2m 45s
CI — Lead Engine CRE / 🌲 Cypress E2E                       ✅ 2m 08s
CI — Lead Engine CRE / 🚀 Artillery (Load)                  ✅ 6m 31s
────────────────────────────────────────────────────────────
Total: 5/5 jobs passed                                       ✅ 6m 31s (parallel)
```

### 🧪 Backend Job Detail

```
Run npx jest --verbose --forceExit --detectOpenHandles --ci

  PASS  tests/unit/bid.service.test.ts
  PASS  tests/unit/lead.service.test.ts
  PASS  tests/unit/auth.service.test.ts
  PASS  tests/e2e/api.test.ts
  PASS  tests/compliance/gdpr.test.ts
  PASS  tests/security/xss.test.ts

Test Suites: 12 passed, 12 total
Tests:       151 passed, 151 total
Snapshots:   0 total
Time:        34.2s
```

### ⛓️ Hardhat Job Detail

```
Run npx hardhat test

  LeadNFT
    ✓ mints lead NFT with correct metadata (245ms)
    ✓ prevents duplicate minting (98ms)
    ✓ transfers ownership on sale (112ms)

  EscrowSettlement
    ✓ creates escrow with correct USDC amount (189ms)
    ✓ releases funds after confirmation (156ms)

  62 passing (28s)
```

### 🌲 Cypress Job Detail

```
Run npx cypress run --headless

  ✔  All specs passed!                        01:04
     Spec                    Tests  Pass  Fail
     copy-assertions.cy.ts   18     18    -
     multi-wallet.cy.ts      21     21    -
     stress-ui.cy.ts         21     21    -
     ui-flows.cy.ts          52     52    -
  ──────────────────────────────────────────
  Total                      112    112    -
```

### 🚀 Artillery Job Detail

```
Run npx artillery run tests/load/artillery-rtb.yaml

Phase 1: ramp-up     (30s, 1→50 vusers/s)  ✓
Phase 2: sustained   (60s, 50 vusers/s)    ✓
Phase 3: peak        (120s, 100 vusers/s)  ✓
Phase 4: cool-down   (60s, 50→1 vusers/s)  ✓

All VUs finished. Summary:
  Scenarios launched:  12,510
  Requests completed:  25,035
  p99 latency:         4ms
  p95 latency:         2ms
  Apdex:               1.0 (excellent)
```

---

## Edge Case: Job Failures

### Timeout Failure

```
CI — Lead Engine CRE / 🚀 Artillery (Load)
  ❌ Error: The job running on runner ... has exceeded 15 minutes.
  ℹ️  This job has continue-on-error: true — overall CI still passes.
```

**Fix:** Artillery is advisory (`continue-on-error: true`). If it times out, the CI badge stays green.

### Dependency Conflict

```
CI — Lead Engine CRE / 🧪 Backend (Jest)
  npm ERR! ERESOLVE could not resolve @prisma/client@^5.10.2
```

**Fix:** Delete `package-lock.json`, run `npm install` locally, commit the updated lockfile.

### PostgreSQL Connection Refused

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Fix:** The `services.postgres.options` health check ensures the DB is ready. If it still fails, increase `--health-retries` from 5 to 10.

### Cypress Binary Missing

```
No version of Cypress is installed
```

**Fix:** The workflow caches `~/.cache/Cypress` keyed by lockfile hash. On first run or lockfile change, Cypress auto-downloads (~250MB, ~30s).

---

## Adding a New Test Suite

1. Add a new job to `.github/workflows/test.yml`
2. Set `timeout-minutes` (prevents infinite hangs)
3. Use `if: always()` on artifact upload steps
4. Use `continue-on-error: true` for advisory jobs
