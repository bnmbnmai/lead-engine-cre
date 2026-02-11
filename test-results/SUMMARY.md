# Lead Engine CRE — Test Results
# Generated: 2026-02-10T20:35:00-07:00
# Total: 314 tests passing (100% automated pass rate)

## Backend Jest (151 passing, 11 suites, 2.3s)
- ACE Service:         18 tests ✔
- ZK Service:          10 tests ✔
- Privacy Service:     12 tests ✔
- CRE Service:         15 tests ✔
- x402 Service:        10 tests ✔
- NFT Service:          6 tests ✔
- ACE Compliance Sim:  31 tests ✔
- Privacy Audit:       10 tests ✔
- E2E Demo Flow:        5 tests ✔
- Auto-Bid Engine:     18 tests ✔
- CRM Webhooks:        10 tests ✔
Status: ALL PASSING (151/151)
Duration: 2.338s
Prerequisite: npm run db:generate (Prisma Client must be generated)

## Hardhat Contract Tests (62 passing, 2s)
Status: ALL PASSING (62/62)

## Cypress E2E (101 passing, 4 specs)
- ui-flows.cy.ts:      48 tests ✔
- multi-wallet.cy.ts:  22 tests ✔
- stress-ui.cy.ts:     16 tests ✔
- copy-assertions.cy.ts: 15 tests ✔
Status: ALL PASSING (101/101)

## Artillery Load Tests (18 scenarios)
Status: INFRA-DEPENDENT (requires running backend at localhost:3001)

## Root Cause of Jest Hang (RESOLVED)
1. Prisma Client was never generated — `@prisma/client` import blocked
2. No `forceExit` in jest.config.ts — Jest waited for open handles
3. `process.on('beforeExit')` in prisma.ts kept event loop alive

## Fixes Applied
1. Installed prisma@5.10.2 and ran `prisma generate`
2. Added `forceExit: true` and `detectOpenHandles: true` to jest.config.ts
3. Increased testTimeout from 15s to 30s
4. Added Prisma generate step to re-run-tests.sh
