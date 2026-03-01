# Demo Control Panel Audit

> **Generated**: 2026-03-01 · **File**: `frontend/src/components/demo/DemoPanel.tsx` (1112 lines) · **Backend**: `backend/src/routes/demo-panel.routes.ts` (2331 lines)

---

## 1. Complete Button & Section Inventory

### Section 1: Marketplace Data (`id="marketplace"`, default expanded)

| # | Button / Control | Handler | Backend Endpoint | Auth | Purpose | Status |
|---|---|---|---|---|---|---|
| 1 | **Seed Marketplace** | `handleSeed` | `POST /seed` | authMiddleware + publicDemoBypass | Creates 10 leads (mix IN_AUCTION/UNSOLD/SOLD), 5 asks, demo buyers. Disabled when already seeded. | ✅ Works |
| 2 | **Clear Demo Data** | `handleClear` | `POST /clear` | authMiddleware + publicDemoBypass | Deletes only `source='DEMO'` leads/bids/asks. Disabled when not seeded. | ✅ Works |
| 3 | **Inject Single Lead** | `handleInjectLead` | `POST /lead` | authMiddleware + publicDemoBypass | Injects one random lead into auction with CRE quality scoring. Triggers CRE-Native eval if enabled. | ✅ Works |
| 4 | **Sync Form Templates** | `handleSeedTemplates` | `POST /seed-templates` | authMiddleware + publicDemoBypass | Clears then re-applies all `FORM_CONFIG_TEMPLATES` to verticals. | ✅ Works |
| 5 | **🌱 Seed Demo Bounties** | `handleSeedBounties` | `POST /seed-bounties` | authMiddleware + publicDemoBypass | Seeds 5 bounty pools ($1,475 total) across solar/mortgage/roofing/insurance/auto. | ⚠️ See regression note |
| 6 | **Reset to Clean Demo State** | `handleReset` | `POST /reset` | authMiddleware + publicDemoBypass | Deletes non-sold + DEMO-sold leads, re-seeds verticals. Preserves real SOLD. | ✅ Works |
| 7 | **Clear All Marketplace Data** | `handleWipe` | `POST /wipe` | authMiddleware + **requireAdmin** | Nuclear wipe — ALL leads/bids/txns/asks regardless of source. | ✅ Works (admin only) |

### Section 2: Live Simulation (`id="simulation"`)

| # | Button / Control | Handler | Backend Endpoint | Auth | Purpose | Status |
|---|---|---|---|---|---|---|
| 8 | **Start Live Auction** | `handleStartAuction` | `POST /auction` | authMiddleware + publicDemoBypass | Creates one lead IN_AUCTION with 60s timer + 3 simulated bot bids at 5s/15s/30s. | ✅ Works |
| 9 | **Enable Demo Buyers** (toggle) | `handleToggleDemoBuyers` | `POST /demo-buyers-toggle` | authMiddleware + publicDemoBypass | Toggles bot buyer bids on/off (persisted in PlatformConfig). | ✅ Works |
| — | Drip info chip | — | — | — | Static info: "10 buyers · Continuous drip · ~12 leads/min simulated" | ℹ️ Informational only |

### Section 3: CRE Workflow Mode (`id="cre-workflow"`)

| # | Button / Control | Handler | Backend Endpoint | Auth | Purpose | Status |
|---|---|---|---|---|---|---|
| 10 | **CRE-Native** (toggle) | `handleToggleCreMode` | `POST /cre-mode` | — (api.demoCreModeToggle) | Toggles CRE DON 7-gate evaluation on injected leads. | ✅ Works |
| 11 | **Decrypt Lead Data** (conditional) | inline onClick | `POST /leads/:leadId/decrypt-pii` | authMiddleware | Winner-only PII decryption. Only shows after CRE eval result. | ✅ Works |
| — | CRE DON Executed result card | — | — | — | Animated display of CRE evaluation results (matched buyer rules). | ✅ Reactive UI |
| — | PII Decrypted card | — | — | — | Shows decrypted PII (name, email, phone, address) with CRE attestation. | ✅ Reactive UI |

### Section 4: On-Chain Settlement (`id="settlement"`)

| # | Button / Control | Handler | Backend Endpoint | Auth | Purpose | Status |
|---|---|---|---|---|---|---|
| 12 | **Complete Settlement on Testnet** | `handleSettle` | `POST /settle` | authMiddleware + publicDemoBypass | Releases escrow on-chain for most recent won auction. Creates escrow if missing (recovery path). Mints LeadNFT + records sale. | ✅ Works |
| — | Demo Seller Address | — | `GET /demo-wallets` | — | Displays the demo seller wallet address. | ℹ️ Informational |

### Section 5: ETH Pre-Fund (`id="ethfund"`)

| # | Button / Control | Handler | Backend Endpoint | Auth | Purpose | Status |
|---|---|---|---|---|---|---|
| 13 | **Fund All Wallets** | `handleFundEth` | `POST /fund-eth` | authMiddleware + **requireAdmin** | Tops up 11 demo wallets to 0.015 ETH each from deployer. Run-once setup. | ✅ Works (admin only) |

### Section 6: Full Reset & Recycle (`id="fullreset"`)

| # | Button / Control | Handler | Backend Endpoint | Auth | Purpose | Status |
|---|---|---|---|---|---|---|
| 14 | **🔄 Full Reset & Recycle** | `handleFullReset` | `POST /full-e2e/reset` | authMiddleware + **requireAdmin** | Emergency button: stops demo, cleans locked funds, prunes stale leads, emits reset-complete. | ✅ Works (admin only) |

### Section 7: Traffic Platform Ingestion (`id="traffic"`)

| # | Button / Control | Handler | Backend Endpoint | Auth | Purpose | Status |
|---|---|---|---|---|---|---|
| 15 | **Simulate Traffic Lead** | `handleSimulateTrafficLead` | `GET /ingest/sample-payload` + `POST /ingest/traffic-platform` | x-api-key header | Simulates webhook from Google Ads/Facebook/TikTok → CRE pipeline → live auction. | ✅ Works |

### Section 8: Analytics Mock Data (`id="analytics"`)

| # | Button / Control | Handler | Backend Endpoint | Auth | Purpose | Status |
|---|---|---|---|---|---|---|
| 16 | **Mock Charts** (toggle) | `handleToggleMock` | — (localStorage only) | — | Toggles Faker-generated charts in buyer/seller analytics dashboards. | ✅ Works (client-side) |

### Persona Switcher (always visible, not in accordion)

| # | Button / Control | Handler | Backend Endpoint | Auth | Purpose | Status |
|---|---|---|---|---|---|---|
| 17 | **Buyer** persona | `handlePersonaSwitch('buyer')` | `POST /demo-login` | — | JWT-based persona switch with KYC bypass + auto-SIWE. Navigates to `/buyer`. | ✅ Works |
| 18 | **Seller** persona | `handlePersonaSwitch('seller')` | `POST /demo-login` | — | JWT-based persona switch. Navigates to `/seller`. | ✅ Works |
| 19 | **Guest** persona | `handlePersonaSwitch('guest')` | — | — | Clears auth, reconnects socket as guest. Navigates to `/`. | ✅ Works |

### Admin Access (`id="admin"`)

| # | Button / Control | Handler | Backend Endpoint | Auth | Purpose | Status |
|---|---|---|---|---|---|---|
| 20 | **Login as Demo Admin** | `handleDemoAdminLogin` | `POST /demo-admin-login` | — | Uses admin/admin credentials, gets real ADMIN JWT. Navigates to `/admin/nfts`. | ✅ Works |

### Banners / Status Indicators (dynamic, not buttons)

| Banner | Trigger | Purpose |
|---|---|---|
| **LIVE DEMO** (red) | `demo:metrics` socket event | Shows active count, elapsed time, daily revenue while full E2E runs. |
| **Demo Running…** (blue) | `demo:status` socket running=true | Shown for first 30s before metrics fire. |
| **♻️ Recycling wallets** (amber) | `demo:recycle-progress` | Progress bar during USDC recovery after demo run. |
| **⚡ Demo Complete** (green) | `demo:results-ready` + recycle complete | Shows settled amount with "View →" link to results page. |

### Additional backend-only endpoints (no UI button)

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /status` | — | Returns seeded flag + counts. Called by `refreshStatus()`. |
| `GET /demo-wallets` | — | Returns seller, deployer, buyers wallet addresses. |
| `GET /demo-buyers-toggle` | authMiddleware + publicDemoBypass | Returns current toggle state. |
| `GET /cre-mode` | — | Returns CRE-Native mode status. |
| `POST /cre-mode` | — | Toggles CRE-Native mode. |
| `POST /full-e2e` | authMiddleware + publicDemoBypass | Starts the 1-click full E2E demo (async, streams via socket). |
| `POST /full-e2e/stop` | authMiddleware + publicDemoBypass | Aborts running demo. |
| `GET /full-e2e/results/latest` | — | Gets latest demo run results. |
| `GET /full-e2e/results/:runId` | — | Gets specific demo run results. |
| `GET /full-e2e/status` | — | Returns running/recycling/resultsReady status. |
| `POST /seed-agent` | x-demo-admin-key header | Seeds Kimi AI agent account (one-shot). |

---

## 2. Auth & Permission Summary

| Auth Pattern | Endpoints | Who Can Call |
|---|---|---|
| **No auth** | `/status`, `/demo-wallets`, `/cre-mode`, `/full-e2e/results/*`, `/full-e2e/status` | Anyone |
| **No auth** (body credentials) | `/demo-login`, `/demo-admin-login` | Anyone (credentials in body) |
| `authMiddleware + publicDemoBypass` | `/seed`, `/clear`, `/lead`, `/auction`, `/reset`, `/seed-templates`, `/seed-bounties`, `/settle`, `/demo-buyers-toggle`, `/full-e2e`, `/full-e2e/stop` | ADMIN JWT **or** valid `X-Api-Token` header |
| `authMiddleware + requireAdmin` | `/wipe`, `/fund-eth`, `/full-e2e/reset` | ADMIN JWT only |
| `x-demo-admin-key` | `/seed-agent` | Deployer key prefix |

---

## 3. Seed Demo Bounties Regression

> [!WARNING]
> **The "🌱 Seed Demo Bounties" button will fail from Buyer or Seller personas.** The backend `POST /seed-bounties` uses `authMiddleware + publicDemoBypass`. The `publicDemoBypass` middleware requires **either** an ADMIN JWT **or** a valid `X-Api-Token` header. When clicked from a Buyer/Seller persona, the request sends a Buyer/Seller JWT with no `X-Api-Token`, resulting in a **403 Forbidden**.

**Same issue affects**: Seed Marketplace, Clear Demo Data, Inject Single Lead, Sync Form Templates, Reset, Start Live Auction, Complete Settlement, Demo Buyers Toggle, Start Full E2E.

**Root cause**: The frontend `api.ts` methods use `apiFetch()` which sends the JWT from `localStorage('auth_token')`. The JWT role is whatever persona is active. The `publicDemoBypass` only passes if `user.role === 'ADMIN'` or X-Api-Token matches.

**Fix options**:
1. **Send `X-Api-Token` header** from the DemoPanel's `apiFetch` calls (cleanest — DemoPanel always has access to `VITE_TEST_API_TOKEN` env var)
2. Relax `publicDemoBypass` to allow any authenticated user in demo mode
3. Always use the demo-admin JWT when calling from DemoPanel

---

## 4. Recommendations for Judge-Ready Version

### Keep (Essential for Demo)

| Section | Items | Why |
|---|---|---|
| **Marketplace Data** | Seed Marketplace, Seed Demo Bounties, Reset | Core data setup |
| **Live Simulation** | Start Live Auction, Demo Buyers toggle | Live demo centerpiece |
| **CRE Workflow Mode** | CRE-Native toggle, CRE eval result card, PII decrypt | Chainlink integration showcase |
| **On-Chain Settlement** | Complete Settlement | On-chain proof |
| **Persona Switcher** | Buyer, Seller, Guest | Navigation essential |
| **Admin Access** | Login as Demo Admin | Admin panel access |

### Remove or Hide (Clutter for Judges)

| Item | Reason |
|---|---|
| **Clear Demo Data** | Redundant — "Reset" does the same job plus more |
| **Clear All Marketplace Data (Wipe)** | Destructive nuclear option — dangerous for demo, confusing for judges |
| **Inject Single Lead** | Subsumed by "Seed Marketplace" + "Start Live Auction" + "Simulate Traffic Lead" |
| **Sync Form Templates** | Backend operation — judges don't need this |
| **ETH Pre-Fund** | One-time setup — should be run before demo, not during |
| **Full Reset & Recycle** | Emergency-only — hide behind "Advanced" or remove |
| **Traffic Platform Ingestion** | Stretch feature — could keep if polished, but adds noise |
| **Analytics Mock Data** | Minor feature — toggle is confusing for judges |

### Ideal Streamlined Layout

```
┌─────────────────────────────────┐
│ 🧪 Demo Control Panel          │
│ Dev only · Ctrl+Shift+D        │
│ ● Seeded   12 leads   5 bids   │
├─────────────────────────────────┤
│ ▸ 🏪 MARKETPLACE DATA          │
│   [Seed Marketplace]  [accent] │
│   [🌱 Seed Demo Bounties]      │
│   [Reset Demo State]  [danger] │
├─────────────────────────────────┤
│ ▸ 🔨 LIVE AUCTION              │
│   [Start Live Auction] [accent]│
│   Toggle: Enable Demo Buyers   │
├─────────────────────────────────┤
│ ▸ ⛓️ CRE WORKFLOW              │
│   Toggle: CRE-Native Mode      │
│   [CRE eval result card]       │
│   [Decrypt Lead Data]          │
├─────────────────────────────────┤
│ ▸ 💰 ON-CHAIN SETTLEMENT       │
│   [Complete Settlement]         │
├─────────────────────────────────┤
│ ▸ 📡 TRAFFIC INGESTION         │
│   [Simulate Traffic Lead]       │
├─────────────────────────────────┤
│ PERSONA SWITCHER                │
│  [Buyer] [Seller] [Guest]       │
│  Active: Buyer                  │
├─────────────────────────────────┤
│ ▸ 🔐 ADMIN ACCESS              │
│   [Login as Demo Admin]         │
└─────────────────────────────────┘
```

### Priority Fixes Before Submission

1. **Fix auth regression** — DemoPanel buttons fail from non-ADMIN personas (see Section 3)
2. **Remove 1-Click Full E2E button from DemoPanel** — it's only used from the homepage, not needed here
3. **Remove Wipe button** — too dangerous, no confirmation dialog in current UI
4. **Consolidate Clear + Reset** — keep only Reset
5. **Hide ETH Pre-Fund and Full Reset** — move to an "Advanced" collapsed section or remove
