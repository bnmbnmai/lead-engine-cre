# README vs Codebase Audit Report

> Generated: 2026-02-14  
> Scope: Every verifiable claim in `README.md` cross-referenced against the actual codebase.

---

## 🔴 Critical — Fix Before Submission

### 1. License Mismatch: MIT vs Proprietary

| Where | Says |
|-------|------|
| `package.json` line 8 | `"license": "MIT"` |
| README line 822 | **Proprietary** — All rights reserved |

**Impact:** Judges may flag the contradiction. If the project is proprietary, the root `package.json` must say `"license": "UNLICENSED"`.

---

### 2. Missing `.env.example` Files

README line 362–363 tells users to:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

**Neither file exists.** The `.gitignore` also references them:
```
!.env.example
!.env.local.example
```

`mcp-server/` also has no `.env` or `.env.example` despite README line 630 telling users to set env vars there.

**Impact:** Anyone cloning the repo cannot follow setup instructions.

---

### 3. Missing `docs/DEPLOYMENT.md`

README line 364 says:
> Edit both files with your keys **(see docs/DEPLOYMENT.md §7)**

`docs/DEPLOYMENT.md` does not exist in the repository.

**Impact:** Broken link / reference for judges.

---

### 4. Stale `test:load` Script in `backend/package.json`

```json
"test:load": "artillery run tests/load-test.yml"
```

`tests/load-test.yml` was deleted in the cleanup. This script will fail if run.

**Impact:** `npm run test:load` crashes. Either remove the script or point it at `../tests/load/artillery-rtb.yaml`.

---

### 5. `vitest` Still in `devDependencies`

`backend/package.json` line 70:
```json
"vitest": "^4.0.18"
```

We deleted `backend/vitest.config.ts` — this project uses **Jest**, not Vitest. This is dead weight (and confusing).

**Impact:** Unnecessary dependency; judges may wonder if the test suite is actually configured.

---

## 🟡 Inaccuracies — Should Fix

### 6. Contract Count: README Says 8, Actually 9

README line 9 badge: `contracts-8 deployed-orange`

Actual `.sol` files in `contracts/contracts/`:
1. `ACECompliance.sol`
2. `CREVerifier.sol`
3. `CustomLeadFeed.sol` ← **not in the contracts table**
4. `LeadNFT.sol`
5. `LeadNFTv2.sol`
6. `Marketplace.sol`
7. `RTBEscrow.sol`
8. `VerticalAuction.sol`
9. `VerticalNFT.sol`

**Fix:** Either add `CustomLeadFeed.sol` to the table or update the badge to 9.

---

### 7. Cypress Spec Count: README Says 3, Actually 7

README line 397 says `3 specs` and the Cypress details table lists 3 files.

Actual files in `frontend/cypress/e2e/`:
1. `auction-flows.cy.ts`
2. `copy-assertions.cy.ts`
3. `multi-wallet.cy.ts`
4. `nft-marketplace.cy.ts`
5. `stress-ui.cy.ts`
6. `ui-flows.cy.ts`
7. `vertical-nft.cy.ts`

**Fix:** Update to 7 specs and add the missing 4 to the details table.

---

### 8. Hardhat Test Count: README Says 8 Suites, Actually 11

README line 396 says `8 suites` and lists 8 in the details table.

Actual files in `contracts/test/`:
1. `ACECompliance.test.ts`
2. `Integration.test.ts`
3. `LeadNFT.test.ts`
4. `Marketplace.test.ts`
5. `VerticalAuction.test.ts` ← **not in table**
6. `VerticalNFT.advanced.test.ts`
7. `VerticalNFT.platform.test.ts` ← **not in table**
8. `VerticalNFT.test.ts` ← **not in table**
9. `e2e-chainlink-stubs.test.ts`
10. `e2e-reorg.test.ts`
11. `e2e-settlement.test.ts`

**Fix:** Update to 11 test files. Add VerticalAuction, VerticalNFT.platform, and VerticalNFT (standard) to the table.

---

### 9. VerticalAuction Described as "Sealed-bid" — Actually Ascending

README line 325:
> `VerticalAuction.sol` | Sepolia | *(Optional)* **Sealed-bid auctions** for vertical NFTs

We fixed the NatSpec in the contract itself earlier — `VerticalAuction.sol` uses **public ascending bids** with holder-priority mechanics, not sealed-bid commit-reveal. The README still says sealed-bid.

**Fix:** Change to "Ascending auctions for platform-minted vertical NFTs with holder-priority mechanics".

---

### 10. Auto-Bid Criteria: README Says 7, Code Has 9

README line 166 and 204 both say **7-criteria matching**.

`auto-bid.service.ts` actually matches on **9 criteria** (vertical, geo include, geo exclude, quality score gate, off-site toggle, verified-only, max bid per lead, daily budget, source filter).

**Fix:** Count the actual criteria and update.

---

### 11. Middleware Description Slightly Misleading

README project structure says:
```
├── middleware/     # Auth, rate-limiting, CORS
```

Actual files: `auth.ts`, `rateLimit.ts` — no dedicated CORS file. CORS is configured directly in `src/index.ts` and `rtb/socket.ts` via the `cors` npm package.

**Impact:** Minor, but "CORS" implies a dedicated file that doesn't exist.

---

### 12. Testing Commands Section Has Redundancy

README lines 492–496:
```bash
# Run all backend tests
cd backend && npx jest --verbose --forceExit

# Individual suites
cd backend && npx jest --verbose --forceExit        # Backend (requires DB)
```

These are identical — the first "all backend tests" and the "individual suite" backend line are the same command.

---

## 🟠 Scope Creep / Dead Weight

### 13. `backend/package.json` Has `artillery` in Dependencies

`artillery-plugin-expect` is in `dependencies` (not `devDependencies`):
```json
"artillery-plugin-expect": "^2.24.0"
```

Artillery is a dev/test tool, not a production dependency. This bloats the production build.

---

### 14. `analytics-mock.ts` Still in Services

`backend/src/services/analytics-mock.ts` — is this mock-only file needed in production? If analytics use real data in production, this file may be dead weight.

---

### 15. Root `package.json` Missing `db:seed` and `db:clear-mock`

README lines 382–383 claim these commands exist:
| `npm run db:seed` | Seed 200+ mock entries |
| `npm run db:clear-mock` | Remove only mock data |

They exist in `backend/package.json` but **not in the root** `package.json`. Users running from the root will get `missing script` errors. They must `cd backend` first.

**Fix:** Either add these to root package.json as workspace-forwarding scripts, or update the README to say `cd backend && npm run db:seed`.

---

### 16. `MARKETPLACE_ADDRESS` Missing from `render.yaml`

`render.yaml` references: `ACE_CONTRACT_ADDRESS`, `CRE_CONTRACT_ADDRESS`, `ESCROW_CONTRACT_ADDRESS`, `LEAD_NFT_ADDRESS`, `USDC_CONTRACT_ADDRESS`.

README line 600 also mentions `MARKETPLACE_ADDRESS` — but it's **not in `render.yaml`**.

---

## 🟢 Verified ✅ (No Issues)

| Claim | Status |
|-------|--------|
| Mermaid sequence diagram | ✅ Accurate — reflects sealed-bid + commit-reveal flow |
| CRE + ACE integration descriptions | ✅ Match actual stubs and service files |
| DECO/DataStreams/Confidential Compute stubs | ✅ All 3 exist in `backend/src/lib/chainlink/` |
| x402 payment descriptions | ✅ `x402.service.ts` and `RTBEscrow.sol` match |
| MCP server: 9 tools | ✅ `mcp-server/tools.ts` has exactly 9 tool definitions |
| Privacy suite (AES-256-GCM, commit-reveal) | ✅ `privacy.service.ts` implements correctly |
| PII protection | ✅ `piiProtection.ts` exists with per-vertical redaction |
| CI pipeline (5 parallel jobs) | ✅ `test.yml` has lint, backend, hardhat, cypress, artillery |
| Project structure tree (after corrections) | ✅ Matches dirs (minus `re-run-tests.sh` already removed) |
| WebSocket streaming | ✅ `rtb/socket.ts` (31KB) with Socket.io |
| Deploy instructions (Render + Vercel) | ✅ Match `render.yaml` and standard Vercel flow |
| Smart contract descriptions | ✅ All contracts match their descriptions (except VerticalAuction) |
| Architecture mermaid diagram | ✅ Nodes match actual services and components |
| Geo registry / jurisdiction policies | ✅ `lib/geo-registry.ts` + `lib/jurisdiction-policies.ts` exist |
| Data Producer / CustomLeadFeed | ✅ `CustomLeadFeed.sol` + `data-feed.stub.ts` exist |
| Proprietary license (no LICENSE file) | ✅ No LICENSE file in repo |

---

## Summary of Required Actions

| Priority | Issue | Effort |
|----------|-------|--------|
| 🔴 | Fix `license` in root `package.json` → `UNLICENSED` | 1 min |
| 🔴 | Create `backend/.env.example` + `frontend/.env.local.example` + `mcp-server/.env.example` | 10 min |
| 🔴 | Remove or update reference to `docs/DEPLOYMENT.md` | 1 min |
| 🔴 | Remove stale `test:load` script from `backend/package.json` | 1 min |
| 🔴 | Remove `vitest` from `backend/package.json` devDependencies | 1 min |
| 🟡 | Update badge + table to 9 contracts (add `CustomLeadFeed.sol`) | 2 min |
| 🟡 | Update Cypress spec count from 3 → 7 | 3 min |
| 🟡 | Update Hardhat suite count from 8 → 11 | 3 min |
| 🟡 | Fix VerticalAuction description (ascending, not sealed-bid) | 1 min |
| 🟡 | Recount auto-bid criteria (7 → actual count) | 2 min |
| 🟡 | Fix redundant test command block | 1 min |
| 🟠 | Move `artillery-plugin-expect` to devDependencies | 1 min |
| 🟠 | Add `db:seed` / `db:clear-mock` to root `package.json` or fix README | 2 min |
| 🟠 | Add `MARKETPLACE_ADDRESS` to `render.yaml` | 1 min |
