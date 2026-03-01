# API Endpoint Audit — Lead Engine CRE

**Date:** 2026-03-01  
**Backend entry:** `backend/src/index.ts` (17 route files)

---

## All Current Endpoints

### `/api/v1/auth` — auth.routes.ts (378 lines)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/nonce/:address` | SIWE nonce generation |
| POST | `/wallet` | Wallet authentication (SIWE) |
| GET | `/me` | Current user profile |
| POST | `/kyc/init` | Initialize KYC verification |
| POST | `/kyc/callback` | KYC webhook callback |
| POST | `/logout` | Logout / session destroy |
| POST | `/profile` | Create/update user profile |

### `/api/v1` — marketplace.routes.ts (2262 lines)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/asks` | List marketplace listings |
| POST | `/asks` | Create seller listing |
| GET | `/asks/:id` | Get listing detail |
| PUT | `/asks/:id` | Update listing |
| DELETE | `/asks/:id` | Delete listing |
| GET | `/asks/public/template-config` | Public form template config |
| POST | `/leads` | Submit lead (platform/API/offsite) |
| GET | `/leads` | List leads with filters |
| GET | `/leads/:id` | Get lead detail |
| DELETE | `/leads/:id` | Delete lead |
| POST | `/leads/:id/settle` | Settle lead transaction |
| GET | `/leads/scoring-data/:id` | CRE scoring data |
| POST | `/leads/:id/encrypt` | Encrypt lead PII |
| POST | `/leads/:id/decrypt` | Decrypt lead PII (winner-only) |
| POST | `/nfts/mint-lead` | Mint lead NFT |
| GET | `/nfts/by-wallet/:address` | Get NFTs by wallet |
| POST | `/nfts/:tokenId/transfer` | Transfer NFT |
| GET | `/form-templates` | List form templates |
| POST | `/form-templates/sync` | Sync form templates |

### `/api/v1/bids` — bidding.routes.ts (767 lines)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/` | Place sealed bid (commit) |
| POST | `/:bidId/reveal` | Reveal bid |
| GET | `/my` | Get user's bids |
| DELETE | `/:bidId` | Withdraw bid |
| PUT | `/preferences` | Update buyer preferences |
| GET | `/preferences` | Get buyer preferences |
| GET | `/preference-sets` | List preference sets |
| POST | `/preference-sets` | Create preference set |
| PUT | `/preference-sets/:id` | Update preference set |
| DELETE | `/preference-sets/:id` | Delete preference set |

### `/api/v1/analytics` — analytics.routes.ts (652 lines)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/overview` | Dashboard overview (role-based) |
| GET | `/leads` | Lead analytics (time series) |
| GET | `/bids` | Bid analytics |
| GET | `/revenue` | Revenue analytics |
| GET | `/geo` | Geo-distribution analytics |
| GET | `/verticals` | Vertical analytics |

### `/api/v1/demo` — integration.routes.ts (459 lines)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/e2e-bid` | Full E2E pipeline demo |
| POST | `/compliance-check` | ACE compliance check |
| POST | `/zk-verify` | ZK fraud verification |
| POST | `/auto-kyc` | Auto-KYC registration |
| POST | `/encrypt-test` | Privacy encrypt test |
| POST | `/decrypt-test` | Privacy decrypt test |
| POST | `/escrow-test` | Escrow service test |
| GET | `/data-feeds` | Data feeds test |

### `/api/v1/crm` — crm.routes.ts (502 lines)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/export` | Export leads (CSV/JSON) |
| POST | `/push` | Push leads to webhook |
| POST | `/webhooks` | Register CRM webhook |
| GET | `/webhooks` | List webhooks |
| DELETE | `/webhooks/:id` | Delete webhook |

### `/api/v1/lander` — lander.routes.ts (312 lines)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/export` | Generate hosted lander HTML |
| POST | `/preview` | Preview lander HTML (inline) |

### `/api/v1/demo-panel` — demo-panel.routes.ts (2337 lines)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/demo-login` | Demo persona login (buyer/seller) |
| POST | `/demo-admin-login` | Demo admin login |
| GET | `/demo-buyers-toggle` | Read demo buyers toggle |
| POST | `/demo-buyers-toggle` | Set demo buyers toggle |
| GET | `/cre-mode` | **Read CRE-Native Mode toggle** |
| POST | `/cre-mode` | **Set CRE-Native Mode toggle** |
| GET | `/demo-wallets` | Demo wallet addresses |
| POST | `/lead` | Inject single demo lead |
| POST | `/seed` | Seed marketplace data |
| POST | `/seed-bounties` | Seed demo bounties |
| POST | `/reset` | Reset demo data |
| POST | `/wipe` | Wipe all marketplace data |
| POST | `/start-auction` | Start demo auction |
| POST | `/leads/:leadId/decrypt-pii` | Decrypt PII for won lead |
| POST | `/full-e2e` | 1-click full E2E demo |
| GET | `/full-e2e/results` | E2E demo run results |

### `/api/v1/verticals` — vertical.routes.ts (1193 lines)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/hierarchy` | Full vertical tree |
| GET | `/flat` | Flat vertical list |
| POST | `/suggest` | AI vertical suggestion |
| GET | `/suggestions` | List suggestions (admin) |
| PUT | `/suggestions/:id/approve` | Approve suggestion |
| PUT | `/suggestions/:id/reject` | Reject suggestion |
| PATCH | `/suggestions/:id/status` | Update suggestion status |
| GET | `/:slug/form-config` | Vertical form config |
| GET | `/public/:slug/form-config` | Public form config |
| PUT | `/:slug/form-config` | Save form config |
| POST | `/` | Create vertical |
| GET | `/:slug` | Get vertical details |
| GET | `/:slug/compliance` | Vertical compliance rules |
| POST | `/:slug/auction` | Create vertical auction |

### `/api/v1/buyer` — buyer.routes.ts (30 lines)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/perks-overview` | Holder perks & stats |

### `/api/v1/buyer/vault` — vault.routes.ts (194 lines)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Vault balance + transactions |
| POST | `/deposit` | Record deposit |
| POST | `/withdraw` | Record withdrawal |
| GET | `/contract` | Contract address + ABI |
| GET | `/reserves` | Proof of Reserves |
| POST | `/verify-por` | Trigger PoR verification |
| POST | `/reconcile` | Reconcile vault state |
| GET | `/cleanup-legacy` | Clean up legacy records |

### `/api/v1/mcp` — mcp.routes.ts (845 lines)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | MCP server health |
| POST | `/rpc` | JSON-RPC proxy to MCP |
| POST | `/chat` | Kimi K2.5 agent chat |

### `/api/v1/bounties` — bounties.routes.ts (188 lines)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/available` | Available bounty totals |
| GET | `/pools/:vertical` | Bounty pools by vertical |
| POST | `/deposit` | Deposit to bounty pool |

### `/api/v1/auto-bid` — auto-bid.routes.ts (223 lines)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/preference-sets` | CRE DON preference sets |
| GET | `/pending-lead` | Pending lead for CRE eval |
| GET | `/evaluate-lead` | Combined lead + preferences |

### `/api/v1/ingest` — ingest.routes.ts (313 lines)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/traffic-platform` | Ingest lead from ad platform |
| GET | `/sample-payload` | Sample payload for UI |

### `/api/v1/cre` — cre.routes.ts (132 lines)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/status` | CRE mode + capabilities |
| GET | `/score` | CRE quality score for lead |
| POST | `/evaluate` | Trigger CRE buyer-rules eval |

### `/api/mock` — mock.routes.ts (153 lines)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/fraud-signal/:leadId` | Mock fraud signal for CHTT |

---

## Duplicates & Overlaps Found

### 1. ❌ CRE-Native Mode Config Key Mismatch (CRITICAL — FIXED)

| File | Config Key | Endpoint |
|------|-----------|----------|
| `demo-panel.routes.ts` | `creNativeDemoMode` | `/api/v1/demo-panel/cre-mode` |
| `cre.routes.ts` | ~~`creNativeModeEnabled`~~ → `creNativeDemoMode` | `/api/v1/cre/status` |

**Root cause:** `cre.routes.ts` was reading from a different PlatformConfig DB key (`creNativeModeEnabled`) than what the DemoPanel toggle writes (`creNativeDemoMode`). The toggle worked in the DemoPanel, but the CRE status endpoint (and Admin Dashboard) always saw `false`.

**Fix applied:** Changed `cre.routes.ts` to read from `creNativeDemoMode` — the same key the DemoPanel toggle writes. Single source of truth.

### 2. ✅ Lead Creation Paths (Intentionally Separate)

| Path | Source | Purpose |
|------|--------|---------|
| POST `/api/v1/leads` | marketplace.routes.ts | Real platform lead submission |
| POST `/api/v1/demo-panel/lead` | demo-panel.routes.ts | Demo lead injection with mock PII |
| POST `/api/v1/ingest/traffic-platform` | ingest.routes.ts | Ad platform webhook simulation |
| POST `/api/v1/demo/e2e-bid` | integration.routes.ts | Full pipeline demo (lead + bid + settle) |

**Verdict:** No consolidation needed. Each serves a distinct purpose with different validation, PII handling, and auction triggering logic.

### 3. ✅ Data Reset Endpoints (Intentionally Separate)

| Path | Purpose |
|------|---------|
| POST `/api/v1/demo-panel/reset` | Reset demo data only (source='DEMO') |
| POST `/api/v1/demo-panel/wipe` | Wipe ALL marketplace data (nuclear option) |

**Verdict:** Correct separation. `/reset` is safe for iterative demo use; `/wipe` is destructive with confirmation guard.

### 4. ✅ Preference Sets (Different Access Patterns)

| Path | File | Purpose |
|------|------|---------|
| GET `/api/v1/bids/preference-sets` | bidding.routes.ts | Buyer UI CRUD (auth required) |
| GET `/api/v1/auto-bid/preference-sets` | auto-bid.routes.ts | CRE DON read-only (API key auth) |

**Verdict:** No consolidation needed. The CRE DON endpoint has different auth (API key) and returns a different response shape optimized for workflow consumption.

### 5. ✅ Compliance Checks (Different Contexts)

| Path | File | Purpose |
|------|------|---------|
| POST `/api/v1/auth/kyc/init` | auth.routes.ts | User-initiated KYC flow |
| POST `/api/v1/demo/compliance-check` | integration.routes.ts | Dev/test compliance check |
| POST `/api/v1/demo/auto-kyc` | integration.routes.ts | Auto-register wallet on-chain |

**Verdict:** Each serves a different context (user flow, dev testing, automation). No overlap.

---

## Summary

| Category | Count |
|----------|-------|
| Route files | 17 |
| Total endpoints | ~95 |
| Duplicates found | 1 (config key mismatch — fixed) |
| False positives | 4 (intentional separation) |
| Changes made | `cre.routes.ts` config key aligned to `creNativeDemoMode` |
