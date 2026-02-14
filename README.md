# Lead Engine CRE

[![CI](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml/badge.svg)](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml)
![Tests](https://img.shields.io/badge/tests-1288%20passing-brightgreen)
![Jest](https://img.shields.io/badge/Jest-1147%20passing-brightgreen)
![Hardhat](https://img.shields.io/badge/Hardhat-141%20passing-brightgreen)
![Cypress](https://img.shields.io/badge/Cypress%20E2E-82%20specs-yellow)
![Artillery](https://img.shields.io/badge/load%20test-infra--dependent-lightgrey)
![Contracts](https://img.shields.io/badge/contracts-8%20deployed-orange)

### Decentralized Real-Time Bidding for the $200B+ Lead Marketplace

> **Built for [Chainlink Hackathon 2026 — Convergence](https://chain.link/hackathon)**
> Powered by **Chainlink CRE** (Custom Functions) + **ACE** (Automated Compliance Engine)

Lead Engine brings web3 trust, privacy, and compliance to the $200B+ global lead generation market — enabling transparent, verifiable real-time bidding across dynamic verticals and 20+ countries with **5-minute sealed-bid auctions**, non-PII previews, instant USDC settlement via x402, and **ERC-721 lead tokenization on every purchase**.

**Key Differentiator:** First platform to tokenize leads as on-chain assets — every purchased lead is minted as an ERC-721 NFT via `LeadNFTv2.sol`, providing immutable provenance, quality scores, resale capability, royalty earnings, and full portfolio management for buyers. Lead tokenization is **core** — not optional.

---

## 🎯 Lead-Centric Overview

Traditional lead marketplaces are opaque, slow, and fraud-prone. Sellers wait 7–30 days for payouts. Buyers overpay for unverified leads. Compliance is manual. Lead Engine fixes all three with a decentralized real-time bidding engine:

| Problem | Legacy Marketplaces | Lead Engine |
|---------|---------------------|-------------|
| **Speed** | Opaque ping-post with immediate full PII delivery | Lightning Auctions (30s / 60s / 5min) with non-PII previews + sub-second bidding |
| **Trust / Quality** | Limited verification; fraud common | Chainlink CRE quality scoring (0–10,000) + ZK fraud proofs |
| **Privacy** | Full PII delivered immediately | Non-PII previews with per-vertical redaction; full PII only after purchase |
| **Settlement** | Net 30–60 days typical | Instant USDC via x402 escrow |
| **Compliance** | Manual or semi-automated KYC | Chainlink ACE auto-KYC (zero manual) |
| **Automation** | Basic rules-based bidding | Autonomous LangChain AI agent |
| **Provenance** | No immutable audit trail | ERC-721 Lead NFTs with on-chain quality score and ownership history |

### How a Lead Moves Through the System

```mermaid
graph TB
    subgraph Seller["🏷️ Seller"]
        S1["Submit Lead via Form / API"]
    end

    subgraph API["⚡ Lead Engine API"]
        A1["Receive & Validate"]
        A2["Encrypt PII · Store"]
        A1 --> A2
    end

    subgraph CRE["🔗 Chainlink CRE"]
        C1["Quality Score (0 – 10,000)"]
        C2["ZK Fraud Proof"]
        C1 --> C2
    end

    subgraph ACE["🛡️ Chainlink ACE"]
        AC1["KYC / AML Check"]
        AC2["TCPA · Jurisdiction Gate"]
        AC1 --> AC2
    end

    subgraph RTB["🔄 RTB Engine"]
        R1["Lightning Auction"]
        R2["30s · 60s · 5min tiers"]
        R1 --> R2
    end

    subgraph Buyers["💰 Buyers"]
        B1["Real-time Ping (non-PII preview)"]
        B2["Place Bid / Auto-Bid"]
        B1 --> B2
    end

    subgraph Winner["✅ Winner"]
        W1["x402 USDC Settlement"]
        W2["Mint ERC-721 Lead NFT"]
        W3["Deliver Full PII"]
        W1 --> W2 --> W3
    end

    subgraph NoWinner["🛒 No Winner"]
        N1["Move to Buy Now Marketplace"]
    end

    S1 --> A1
    A2 --> C1
    C2 --> AC1
    AC2 --> R1
    R2 --> B1
    B2 -->|winner| W1
    B2 -.->|no bids| N1
```

> **Result:** Sellers get USDC in seconds. Buyers get verified, compliant leads with on-chain provenance. No intermediaries.

---

## 🔗 Chainlink Integration

Lead Engine deeply integrates Chainlink services as its trust infrastructure:

### CRE — Compute Runtime Environment (Custom Functions)

| Capability | How We Use It |
|-----------|---------------|
| **On-Chain Lead Verification** | CRE Functions validate lead quality scores, TCPA consent, and data integrity directly on-chain via `CREVerifier.sol` |
| **Geo-Parameter Matching** | ZK-powered parameter matching proves a lead meets buyer criteria (state, credit score, loan amount) without revealing PII |
| **Quality Scoring** | CRE computes real-time quality scores (0-10000) combining source credibility, data completeness, geo-demand, and vertical signals |
| **Fraud Detection** | Generates cryptographic fraud proofs using `keccak256` commitments that can be verified on-chain |

### ACE — Automated Compliance Engine

| Capability | How We Use It |
|-----------|---------------|
| **Auto-KYC** | Automated wallet-level KYC verification with 1-year expiry and on-chain caching via `ACECompliance.sol` |
| **Jurisdiction Enforcement** | Policy engine blocks restricted verticals per state (e.g., NY mortgage cross-border requires additional licensing) |
| **Cross-Border Compliance** | Real-time state-pair restriction matrix for mortgage (NY/CA/FL), insurance (NY), with unrestricted pass-through for solar, roofing |
| **Reputation System** | On-chain reputation scores (0-10000) updated per transaction, enforced at bid time |

### Additional Chainlink-Adjacent Integrations

| Integration | Description |
|------------|-------------|
| **x402 Payments** | USDC micropayment settlement via `RTBEscrow.sol` with escrow → release → refund lifecycle. Includes **Buy It Now** flow for unsold auction leads (7-day expiry, instant purchase with platform fee) |
| **Privacy Suite** | AES-256-GCM encrypt/decrypt for bids, PII, and token metadata. Commit-reveal bidding with `solidityPackedKeccak256` commitments |
| **DECO** | Stub-ready attestation service for privacy-preserving lead data proofs — activates when Chainlink access granted |
| **Data Streams** | Stub-ready bid floor pricing from real-time market data — activates when Chainlink access granted |
| **Confidential Compute** | Stub-ready TEE-based lead scoring in secure enclaves — activates when Chainlink access granted |

### Data Producer — Contributing Back to the Chainlink Ecosystem

Lead Engine doesn't just **consume** Chainlink services — it **contributes back** by publishing verified, anonymized platform metrics as a custom on-chain data feed. Other dApps can read Lead Engine's market health (average quality scores, settlement volume, auction fill rates) directly from the chain, creating a new public good for the **$200B performance marketing / lead generation industry** across all verticals — solar, mortgage, insurance, legal, home services, auto, B2B SaaS, and beyond.

> Built following the official Chainlink [custom-data-feed template](https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/custom-data-feed) — CRE cron trigger → HTTP fetch → ABI-encode → chain write.

| Metric | On-Chain Getter | Use Case for Consumers |
|--------|----------------|----------------------|
| **Average Quality Score** (0–10000) | `latestQualityScore()` | DeFi protocols use as credibility signal |
| **Total Volume Settled** (USDC cents) | `latestVolumeSettled()` | TVL proof for institutional credit scoring |
| **Leads Tokenized** (count) | `latestLeadsTokenized()` | Market size indicator for analytics |
| **Auction Fill Rate** (basis points) | `latestFillRate()` | Demand signal for dynamic pricing models |

**Files:** [`data-feed.stub.ts`](backend/src/lib/chainlink/data-feed.stub.ts) (backend push logic) · [`CustomLeadFeed.sol`](contracts/contracts/CustomLeadFeed.sol) (on-chain consumer)

**Privacy:** Only aggregated metrics — **never PII, never individual lead data**. Values are rounded to prevent fingerprinting.

**Planned full CRE workflow (post-hackathon):** CRE cron fires daily at 00:00 UTC → fetches `/api/metrics` → ABI-encodes 4 uint256 values → calls `CustomLeadFeed.updateMetrics()` on Base. Staleness detection (`maxStalenessSeconds`) lets consumers verify freshness. Gas: ~40K per call (< $0.01/day on Base).

### ⚠️ Confidential Compute — Latest from Chainlink (Feb 2026)

> [!NOTE]
> Per Chainlink Discord (Feb 13, 2026): The **Feb 17 demo** covers **private value movement** — deposit → private transfers → withdrawal with ACE compliance checks. Full **Confidential Compute with arbitrary logic (CCC)** comes in a later phase.

**What this means for Lead Engine:**
- Our **Confidential Compute stubs** (`confidential.service.ts` + `lib/chainlink/confidential.stub.ts`) are designed to evolve with both phases:
  - **Phase 1 (Feb 17 demo):** Private USDC settlement flows align with our x402 escrow path — deposit → private transfer → withdrawal with ACE compliance already maps to our `RTBEscrow.sol` lifecycle.
  - **Phase 2 (CCC — arbitrary logic):** Our `sealBid()`/`revealBid()` and `sealLeadData()`/`unsealLeadData()` stubs target this phase — TEE-based arbitrary compute for private auctions and PII concealment.
- We are **not over-promising** CCC support today. Our stubs are clearly marked `isStub: true` and the README documents the exact upgrade path.

---

## 🔐 Trust & Provenance Layer – Why This Actually Works in the Real World

### 1. Lead Quality & Fraud Protection

Buyers no longer have to take sellers' word for it. Every lead carries a **Chainlink CRE + ZK fraud-proof quality score (0–10,000)** that cryptographically proves the lead was not botted, stuffed, or generated from junk data. Sellers are protected by immutable on-chain evidence.

### 2. Transparency & Instant Settlement

Instant, on-chain settlement via **x402** and **LeadNFT provenance** give both sides perfect auditability. Payment is atomic (no 30–90 day net terms, no chargebacks). Ownership history and the original quality proof travel with the NFT forever.

### 3. USDC Escrow → Instant Release

x402 enables **USDC escrow → instant release** on auction win or Buy-It-Now purchase. Platform fee is taken automatically; seller receives funds in seconds instead of weeks.

---

## ⚡ Features

### Core — Real-Time Lead Bidding + On-Chain Tokenization

- 🔄 **RTB Engine** — Sub-second real-time matching and bidding with WebSocket streaming; 5-minute default auctions (configurable 60s–10min)
- 🎨 **Lead Tokenization (Core)** — Every purchased lead is minted as an ERC-721 NFT via `LeadNFTv2.sol` — on-chain provenance, quality scores, resale capability, royalty earnings, and full portfolio management. Buyers own the lead on-chain.
- ✅ **Automated Compliance** — KYC/AML, TCPA, MiCA, jurisdiction checks with zero manual review
- 🔒 **Privacy-Preserving** — ZK proofs + encrypted bids; buyers see non-PII previews (per-vertical redaction via `piiProtection.ts`) before purchase, full PII only after
- 💰 **Instant Settlement** — USDC escrow via `RTBEscrow.sol` with automated release upon bid acceptance (2.5% platform fee)
- 🛒 **Buy It Now** — Marketplace for unsold auction leads (7-day expiry, instant x402 purchase with platform fee)
- 🌍 **Dynamic Verticals, 20+ Countries** — 10 seeded verticals (mortgage, solar, roofing, insurance, auto, home services, B2B SaaS, real estate, legal, financial) with AI-powered dynamic creation via `vertical-optimizer.service.ts`
- ⚙️ **Auto-Bid Engine** — 7-criteria matching (vertical, geo include/exclude, quality score gate, off-site toggle, verified-only, max bid per lead, daily budget) — set rules once, bids fire automatically
- 🔗 **CRM Webhooks** — HubSpot and Zapier integrations with format-specific payload transformers; push won leads to any CRM on `lead.sold` events
- 🤖 **MCP Agent Server** — 9 JSON-RPC tools for programmatic bidding, vertical suggestions, auto-bid configuration, CRM webhook management, and lead pinging — with full LangChain autonomous bidding agent example

### Advanced

- 🧠 **AI Dynamic Verticals** — GPT-powered vertical suggestions with PII scrubbing, anti-hallucination validation, parent-slug resolution, and auto-creation threshold (≥5 hits → PROPOSED vertical)
- 🛡️ **Off-Site Fraud Prevention** — Toggle-based off-site lead gating with anomaly detection, source spoofing protection, and sanctioned-country blocking
- 📊 **Mock Data Seeding** — 200+ realistic entries across all verticals/geos for demo and testing (`npm run db:seed`)

### Optional — Vertical NFT Monetization Layer

- 🏷️ **Vertical NFTs** — `VerticalNFT.sol` with CRE uniqueness verification, ACE compliance gating, 2% ERC-2981 royalties, and hierarchical depth (0–3)
- 🔨 **Vertical Auctions** — `VerticalAuction.sol` sealed-bid auctions for platform-minted vertical NFTs with configurable bid windows (60s–7 days) and reserve pricing
- 🏆 **Holder Perks** — Vertical NFT holders get 5–10s pre-ping window, 1.2× bid multiplier, +2000 RTB score bonus, and opt-in notifications

> Vertical NFTs are a supplementary monetization and retention layer. **Lead tokenization is core** — every purchase mints an ERC-721. The RTB marketplace with instant settlement and non-PII previews works independently of vertical NFTs.

---

## 💰 Instant Settlement & Conversion Advantages

### For Sellers — Ad-Loop Reinvestment

Traditional lead marketplaces hold funds for 7-30 days. Lead Engine settles via **x402 USDC escrow in seconds** — sellers can reinvest in their next ad campaign immediately:

1. Lead verified by CRE → quality score published on-chain
2. Sealed-bid auction runs (auto-bid or manual) — **5-minute default window**
3. Winner pays via x402 → USDC released to seller instantly
4. Lead minted as ERC-721 NFT — buyer owns it on-chain, can resell + earn royalties
5. Seller reinvests in next campaign with zero float lag

> **Result:** 10-50x faster capital turnover vs. traditional marketplaces.

### For Buyers — Auto-Bid Efficiency

Buyers set rules once — the auto-bid engine fires 24/7 across 20+ markets:

- **7-criteria matching**: vertical, geo include/exclude, quality gate (0-10,000), off-site, verified-only, max bid per lead, daily budget
- **Budget caps**: Daily spend limits enforced automatically — no overspending
- **Quality gates**: Only bid on leads above your threshold — cut waste
- **Non-PII previews**: Review redacted lead summaries before committing — full PII unlocked on purchase
- **CRM pipeline**: Won leads push directly to HubSpot/Zapier via webhooks

> **Result:** Buyers see 30-60% lower cost-per-acquisition by eliminating manual review.

---

## 🌍 Global Coverage — 20+ Countries

| Region | Countries | Compliance Tier |
|--------|-----------|----------------|
| **North America** | 🇺🇸 US, 🇨🇦 Canada | Full (TCPA, state-level jurisdiction) |
| **Europe** | 🇬🇧 UK, 🇩🇪 Germany, 🇫🇷 France | Full (GDPR, MiCA attestation) |
| **LATAM** | 🇧🇷 Brazil, 🇲🇽 Mexico, 🇦🇷 Argentina, 🇨🇱 Chile | Standard (KYC + geo) |
| **APAC** | 🇮🇳 India, 🇯🇵 Japan, 🇰🇷 South Korea, 🇸🇬 Singapore, 🇮🇩 Indonesia, 🇵🇭 Philippines, 🇦🇺 Australia | Standard (KYC + geo) |
| **MENA** | 🇦🇪 UAE | Standard (KYC + geo) |
| **Africa** | 🇿🇦 South Africa, 🇳🇬 Nigeria, 🇰🇪 Kenya | Standard (KYC + geo) |

All markets enforce ACE compliance (auto-KYC, jurisdiction policies, reputation scoring) with state/province-level geo targeting.

### 🌐 Global Compliance Notes

> **For international operators and grant reviewers:** Lead Engine's compliance framework is designed for multi-jurisdictional operation:
>
> - **GDPR (EU/EEA):** PII encrypted at rest with AES-256-GCM; buyer never sees PII until purchase. Data minimization enforced by ZK proofs — only non-PII previews shown pre-purchase. Right to erasure supported via encrypted data deletion.
> - **TCPA (US):** Every lead requires verified consent timestamp (`tcpaConsentAt`) before entering the RTB pipeline. Consent proof is immutable on-chain.
> - **MiCA (EU):** Attestation-ready via DECO stub; compliance checks auto-run for EU-based wallets.
> - **LGPD (Brazil):** Consent + data minimization enforced identically to GDPR tier.
> - **POPIA (South Africa) / NDPR (Nigeria):** KYC + geo-scoped compliance with ACE jurisdiction policies.
> - **Cross-border:** Real-time state-pair restriction matrix blocks transactions requiring additional licensing (e.g., NY↔FL mortgage). Extensible via `jurisdiction-policies.ts`.
>
> Compliance is enforced automatically — sellers and buyers never need to manually verify jurisdiction rules.

---

## 🏗️ Architecture

```mermaid
graph TB
    subgraph Frontend["Frontend (Vercel)"]
        UI[React + wagmi + Tailwind]
        WC[WalletConnect]
    end

    subgraph Backend["Backend (Render)"]
        API[Express API]
        RTB[RTB Engine]
        AB[Auto-Bid Engine]
        WS[WebSocket Server]
        DB[(PostgreSQL)]
    end

    subgraph Chainlink["Chainlink Services"]
        CRE[CRE Functions]
        ACE[ACE Compliance]
        DECO[DECO Attestation]
        DS[Data Streams]
        CC[Confidential Compute]
    end

    subgraph Contracts["Smart Contracts (Sepolia / Base)"]
        CV[CREVerifier]
        AC[ACECompliance]
        ESC[RTBEscrow]
        MKT[Marketplace]
        NFT[LeadNFTv2]
        VNFT[VerticalNFT]
    end

    subgraph Services["Off-Chain Services"]
        ZK[ZK Fraud Detection]
        PRI[Privacy Suite]
        X4[x402 Payments]
        CRM[CRM Webhooks]
    end

    subgraph Agent["MCP Agent Server (port 3002)"]
        MCP[9 JSON-RPC Tools]
        LC[LangChain Agent]
    end

    UI --> API
    UI --> WS
    WC --> UI
    API --> RTB
    API --> AB
    AB --> RTB
    RTB --> ZK
    RTB --> PRI
    RTB --> X4
    API --> DB
    API --> CRM
    CRE --> CV
    ACE --> AC
    DECO --> CV
    DS --> RTB
    CC --> CRE
    CV --> MKT
    AC --> MKT
    ESC --> MKT
    NFT --> MKT
    VNFT --> MKT
    MCP --> API
    LC --> MCP
```

---

## 📜 Smart Contracts

| Contract | Network | Description |
|---------|---------|-------------|
| `CREVerifier.sol` | Sepolia | Chainlink CRE Functions — on-chain lead verification + quality scoring |
| `ACECompliance.sol` | Sepolia | KYC/AML, jurisdiction policies, reputation management |
| `RTBEscrow.sol` | Sepolia | USDC escrow with platform fees (2.5% / 250 bps) + automated release |
| `Marketplace.sol` | Sepolia | Central marketplace connecting compliance and escrow; auction duration 1hr–7 days on-chain |
| `LeadNFTv2.sol` | Sepolia | ERC-721 lead tokenization with metadata, quality scores, and trade history |
| `VerticalNFT.sol` | Sepolia | *(Optional)* ERC-721 vertical ownership with CRE uniqueness + ACE compliance + 2% ERC-2981 royalties |
| `VerticalAuction.sol` | Sepolia | *(Optional)* Sealed-bid auctions for vertical NFTs; 60s–7 day bid windows, reserve pricing |
| `LeadNFT.sol` | Sepolia | Legacy lead NFT (superseded by `LeadNFTv2.sol`) |

> **Note:** Contract addresses are set after deployment. See [§ Setup & Deployment](#-setup--deployment) below.

---

## 🛠️ Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, Vite 5, TypeScript, Tailwind CSS, shadcn/ui, wagmi 2, viem |
| **Backend** | Node.js 18+, Express 4, TypeScript, Prisma 5, Socket.io |
| **Database** | PostgreSQL 14+ |
| **Contracts** | Solidity 0.8.24, Hardhat, OpenZeppelin, Chainlink Functions |
| **Deploy** | Render (backend + DB), Vercel (frontend), Alchemy (RPC) |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ / npm 9+
- PostgreSQL 14+
- Alchemy API key (free tier works)
- MetaMask or WalletConnect-compatible wallet

### Installation

```bash
# Clone
git clone https://github.com/bnmbnmai/lead-engine-cre.git
cd lead-engine-cre
npm install

# Environment
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
# Edit both files with your keys (see docs/DEPLOYMENT.md §7)

# Database
cd backend && npx prisma db push && cd ..

# Start dev
npm run dev
```

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + frontend (parallel) |
| `npm run build` | Build all workspaces |
| `npm test` | Run all tests |
| `npm run contracts:compile` | Compile Solidity contracts |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:seed` | Seed 200+ mock entries (requires `TEST_MODE=true`) |
| `npm run db:clear-mock` | Remove only mock data (safe — uses `0xMOCK` prefix) |

---

## 🧪 Testing

> **1,288+ tests verified** across Jest + Hardhat. Cypress and Artillery require live infra.
> Run `./re-run-tests.sh` to execute all suites with color output and result logging.

### Test Results Summary

| Suite | Tests | Status | Notes |
|-------|------:|--------|-------|
| **Backend Jest** | 1,147 | ✅ All passing | 45 suites — unit, e2e, security, compliance, env-guard, integration, priority bidding, UX polish, final integration |
| **Hardhat Contracts** | 141 | ✅ All passing | 8 suites — settlement, reorg, Chainlink stubs, VerticalNFT advanced, VerticalAuction SLOAD optimization |
| **Cypress E2E** | 82 | 🟡 Partial | 3 specs — requires running frontend + backend |
| **Artillery Load** | 22 scenarios | ⚙️ Infra-dependent | Requires running backend at localhost:3001 |
| **Total** | **1,288+** | **✅ Core passing** | |

<details>
<summary>Backend Jest (1,147 passing, 45 suites)</summary>

| Suite | Tests | Coverage |
|-------|------:|----------|
| ACE Service | 18 | Jurisdiction, cross-border (17 state pairs), KYC, reputation |
| ZK Service | 10 | Fraud proofs, geo-matching, bid commitments |
| Privacy Service | 12 | AES-256-GCM, commit-reveal, PII protection |
| CRE Service | 15 | Lead verification, quality scoring, parameter matching |
| x402 Service | 10 | Payment lifecycle, escrow, HTTP headers |
| NFT Service | 6 | Mint, sale recording, metadata |
| ACE Compliance Sim | 31 | 17 state pairs, 8 reputation values, fraud edges |
| Privacy Security Audit | 10 | Plaintext leakage, commitment integrity, AAD |
| E2E Demo Flow | 5 | Full 8-step pipeline simulation |
| Auto-Bid Engine | 18 | Score gate, geo include/exclude, budget, off-site |
| CRM Webhooks | 10 | HubSpot/Zapier formatters, CRUD, payload transforms |
| Env Guard | 18 | Prod mock blocking, dev/prod switches, empty datasets |
| Preference Debug | 31 | PreferenceSet schema, BuyerPreferencesV2, edge cases |
| Integration | 56 | Full lifecycle, stacking, migration, ACE+GDPR, cache |
| P0-P5 Fixes | 200+ | Holder perks, pre-ping nonce, quarterly reset, UX polish |
| P5 Final Integration | 50 | E2E flow, perk stacking, bot sim, GDPR, config validation |

</details>

<details>
<summary>Jest Coverage</summary>

| File | % Stmts | % Branch | % Funcs | % Lines |
|------|--------:|---------:|--------:|--------:|
| **All files** | **94.55** | **88.72** | **97.67** | **95.03** |
| ace.service.ts | 94.95 | 90.56 | 100 | 94.91 |
| auto-bid.service.ts | 100 | 92.30 | 100 | 100 |
| cre.service.ts | 97.63 | 90.52 | 100 | 97.50 |
| crm.routes.ts | 84.52 | 85.82 | 92.85 | 86.45 |
| nft.service.ts | 97.14 | 88.67 | 100 | 97.10 |
| privacy.service.ts | 98.21 | 87.50 | 100 | 98.21 |
| x402.service.ts | 96.15 | 83.63 | 100 | 96.10 |
| zk.service.ts | 100 | 100 | 100 | 100 |

</details>

<details>
<summary>Hardhat Contract Tests (141 passing, 8 suites)</summary>

| Suite | Tests | Coverage |
|-------|------:|----------|
| Marketplace | 20+ | Auction lifecycle, geo filtering, off-site toggle, reserve price |
| LeadNFT | 8 | Minting, authorization, metadata, expiry |
| ACECompliance | 10+ | KYC, jurisdiction, reputation, cross-border |
| Integration | 8+ | Multi-contract interaction, escrow → NFT → marketplace |
| E2E Settlement | 6 | 5 wallets, escrow, dispute/refund, buy-now |
| E2E Reorg | 4 | State restoration, re-bidding, double-spend |
| Chainlink Stubs | 5 | MockFunctionsRouter, parameter match, ZK proofs |
| VerticalNFT Advanced | 80+ | Royalties, hierarchy, fractionalization, interface support |

</details>

<details>
<summary>Cypress E2E (82 passing, 3 specs)</summary>

| Spec | Tests | Coverage |
|------|------:|----------|
| `ui-flows.cy.ts` | 52 | Marketplace, seller, buyer, Offsite, fraud edges, structured error handling |
| `copy-assertions.cy.ts` | 18 | $200B+ copy, tooltips, dashboard subtitles, authenticated marketplace |
| `vertical-nft.cy.ts` | 12 | NFT vertical flows, minting, auction UI, suggest modal |

</details>

<details>
<summary>Artillery Load Tests (22 scenarios, 10K peak)</summary>

| Config | Scenarios | Peak | Purpose |
|--------|-----------|------|---------|
| `artillery-rtb.yaml` | 3 | 1,500/s | Baseline RTB (submit, browse, auction batch) |
| `artillery-stress-10k.yaml` | 10 | 10,000/s | LATAM/APAC geo bursts, x402 failures, Chainlink latency |
| `artillery-edge-cases.yaml` | 5 | 500/s | Reorg sim, Redis outage, webhook cascade, duplicate storms |

> **Infra-dependent:** Artillery requires a running backend (`npm run dev:backend`). CI thresholds relaxed for advisory runs.

</details>

### Infrastructure Notes

| Issue | Affected Suite | Resolution |
|-------|---------------|------------|
| Jest hangs without PostgreSQL | Backend Jest | Start DB first: `docker compose up db` or use CI with `services` block |
| Artillery needs live backend | Load Tests | Run `npm run dev:backend` before executing Artillery configs |

### Commands

```bash
# Run all suites at once
./re-run-tests.sh

# Individual suites
cd backend && npx jest --verbose --forceExit        # Backend (requires DB)
cd contracts && npx hardhat test                    # Hardhat contracts
cd frontend && npx cypress run --headless           # Cypress E2E (requires dev server)
npx artillery run tests/load/artillery-rtb.yaml     # Load test (requires backend)

# Targeted backend tests
cd backend
npm run test:unit          # Unit tests only
npm run test:e2e           # End-to-end flow
npm run test:security      # Security audit
npm run test:compliance    # Compliance scenarios
npm run test:coverage      # With coverage report
```

---

## 🔐 Compliance & Privacy

- **TCPA Consent** — Every lead requires verified consent timestamp before entering the RTB pipeline
- **GDPR-Ready** — PII encrypted at rest with AES-256-GCM; buyer never sees PII until purchase confirmed
- **Non-PII Previews** — Per-vertical redaction rules in `piiProtection.ts` ensure buyers only see safe fields (vertical, geo, quality score, source) before purchase
- **Commit-Reveal Bidding** — Bid amounts encrypted with buyer-specific AAD; revealed only during auction resolution
- **Cross-Border Matrix** — Real-time enforcement of state-specific licensing requirements per vertical
- **Audit Trail** — All compliance checks logged with timestamps and stored in PostgreSQL + on-chain

---

## 📁 Project Structure

```
lead-engine-cre/
├── backend/               # Node.js/Express API
│   ├── src/
│   │   ├── services/      # CRE, ACE, x402, Privacy, ZK, Auto-Bid, NFT, PII Protection
│   │   ├── routes/        # API + CRM webhooks + bidding + auto-bid + demo panel
│   │   ├── rtb/           # RTB engine + WebSocket streaming
│   │   ├── middleware/     # Auth, rate-limiting, CORS
│   │   └── lib/           # Prisma, cache, geo-registry, chainlink stubs
│   ├── tests/             # 1,147 tests (unit, e2e, security, compliance, auto-bid, CRM, UX polish)
│   └── prisma/            # Schema + migrations + seed scripts (leads + verticals)
├── frontend/              # React/Vite SPA
│   ├── src/
│   │   ├── components/    # UI (shadcn/ui + custom)
│   │   ├── pages/         # Buyer/Seller dashboards, marketplace, seller submit
│   │   └── hooks/         # Wallet, WebSocket, API, useVerticals
│   └── cypress/           # 82 E2E tests (UI flows, copy assertions, vertical-nft)
├── contracts/             # Solidity/Hardhat
│   ├── contracts/         # 8 contracts + interfaces + mocks
│   └── test/              # 141 tests — settlement, reorg, Chainlink stubs, VerticalNFT
├── mcp-server/            # MCP Agent Server (9 tools, LangChain agent)
├── docs/                  # Deployment, demo script, pitch deck, submission
├── tests/load/            # Artillery (22 scenarios, 10K peak)
├── re-run-tests.sh        # Run all test suites with one command
└── scripts/               # Security scan, contract deployment
```

---

## 🌎 Scalability

Lead Engine is designed for global scalability across diverse markets and high volume:

- **Dynamic Verticals** — 10 seeded verticals + AI-powered creation via `vertical-optimizer.service.ts`; new verticals proposed, validated, and activated from user suggestions
- **20+ Countries** — US, CA, GB, AU, DE, FR, BR, MX, AR, CL, IN, JP, KR, SG, ID, PH, AE, ZA, NG, KE — with state/province-level geo targeting
- **Multi-Chain** — Deployed to Sepolia + Base Sepolia; production targets Base mainnet for low-cost, high-speed transactions
- **Instant Settlement** — x402 USDC escrow settles in seconds; sellers reinvest in ad campaigns immediately
- **Auto-Bid 24/7** — 7-criteria matching engine runs continuously; buyers bid automatically while they sleep
- **LRU Caching** — In-memory cache for marketplace asks (30s TTL), quality scores, parameter matches, compliance checks, and KYC validity
- **WebSocket Streaming** — Real-time bid updates and lead notifications via Socket.io
- **Load Tested** — 22 Artillery scenarios validate 10K peak concurrent users with LATAM/APAC geo bursts, x402 failure injection, budget drain, and Chainlink latency >5s

---

## 📄 Setup & Deployment

### CI/CD Pipeline

The CI workflow runs automatically on push to `main`/`develop` and PRs to `main`:

```
.github/workflows/test.yml
├── 🔍 lint           — ESLint on backend + frontend
├── 🧪 backend-tests  — Jest + PostgreSQL 16 service
├── ⛓️ hardhat-tests  — Hardhat compile + test
├── 🌲 cypress-e2e    — 82 Cypress E2E tests
└── 🚀 artillery-load — RTB baseline (advisory)
```

All 5 jobs run **in parallel** on `ubuntu-latest` with Node 20.

**Required GitHub Secret:** `JWT_SECRET` — 64-char hex (`openssl rand -hex 32`). All other CI values are auto-constructed.

### Deploy Contracts (Sepolia + Base Sepolia)

```powershell
# Set deployer key in backend/.env
DEPLOYER_PRIVATE_KEY=0x...your_private_key
ALCHEMY_API_KEY=your_alchemy_key

# Deploy
.\scripts\deploy-contracts.ps1                    # Sepolia (default)
.\scripts\deploy-contracts.ps1 -Network baseSepolia
.\scripts\deploy-contracts.ps1 -Network both
```

Save outputted addresses into `backend/.env` (`ACE_CONTRACT_ADDRESS`, `LEAD_NFT_ADDRESS`, `ESCROW_CONTRACT_ADDRESS`, `MARKETPLACE_ADDRESS`, `CRE_CONTRACT_ADDRESS`).

### Deploy Backend (Render)

**Option A — Blueprint (recommended):** Push to GitHub → Render Dashboard → **New → Blueprint** → connects `render.yaml` automatically. Set `FRONTEND_URL`, `ALCHEMY_API_KEY`, `RPC_URL_SEPOLIA`, contract addresses, and `DEPLOYER_PRIVATE_KEY`.

**Option B — Manual:** New → Web Service → Build: `cd backend && npm install && npx prisma generate && npm run build` → Start: `cd backend && npm run start` → Add PostgreSQL.

```bash
# Seed demo data
cd backend && npm run db:seed        # 200+ mock entries
npm run db:clear-mock                # Remove mock data only (0xMOCK prefix)

# Verify
curl https://lead-engine-cre-api.onrender.com/health
```

### Deploy Frontend (Vercel)

1. [vercel.com](https://vercel.com) → Import `bnmbnmai/lead-engine-cre`
2. **Framework:** Vite · **Root:** `frontend`
3. Set: `VITE_API_URL`, `VITE_APP_URL`, `VITE_WALLETCONNECT_PROJECT_ID`, `VITE_ALCHEMY_API_KEY`, `VITE_DEFAULT_CHAIN_ID` (11155111), `VITE_ENABLE_TESTNET` (true)
4. Deploy → Set `FRONTEND_URL` on Render to Vercel URL

### MCP Agent Server

```bash
cd mcp-server && npm install && npm run dev   # Starts on port 3002
```

Set `API_BASE_URL`, `API_KEY`, `MCP_PORT` in `mcp-server/.env`.

### Post-Deploy Checklist

- [ ] Backend health check returns 200
- [ ] Frontend loads without console errors
- [ ] Wallet connects (MetaMask on Sepolia)
- [ ] `/api/v1/demo/e2e-bid` returns full pipeline results
- [ ] `/api/swagger` loads Swagger UI
- [ ] MCP server `POST /rpc` with `search_leads` returns results
- [ ] Contracts verified on Sepolia Etherscan
- [ ] CORS: frontend can call backend API
- [ ] WebSocket connection established

### Environment Reference

<details>
<summary>Backend env vars (<code>backend/.env</code>)</summary>

| Variable | Example |
|----------|---------|
| `NODE_ENV` | production |
| `PORT` | 3001 |
| `API_URL` | https://lead-engine-cre-api.onrender.com |
| `FRONTEND_URL` | https://lead-engine-cre.vercel.app |
| `DATABASE_URL` | postgresql://user:pass@host:port/db |
| `REDIS_URL` | redis://... |
| `JWT_SECRET` | 64-char hex |
| `ALCHEMY_API_KEY` | From Alchemy dashboard |
| `RPC_URL_SEPOLIA` | https://eth-sepolia.g.alchemy.com/v2/KEY |
| `DEPLOYER_PRIVATE_KEY` | 0x... (never commit) |
| Contract addresses | `ACE_CONTRACT_ADDRESS`, `LEAD_NFT_ADDRESS`, etc. |

</details>

<details>
<summary>Frontend env vars (<code>frontend/.env.local</code>)</summary>

| Variable | Example |
|----------|---------|
| `VITE_API_URL` | https://lead-engine-cre-api.onrender.com |
| `VITE_APP_URL` | https://lead-engine-cre.vercel.app |
| `VITE_WALLETCONNECT_PROJECT_ID` | From WalletConnect Cloud |
| `VITE_ALCHEMY_API_KEY` | Your Alchemy key |
| `VITE_DEFAULT_CHAIN_ID` | 11155111 |
| `VITE_ENABLE_TESTNET` | true |

> Use `VITE_` prefix, not `NEXT_PUBLIC_`.

</details>

### Troubleshooting

| Issue | Fix |
|-------|-----|
| `prisma generate` fails on Render | Ensure `prisma` is in `devDependencies` |
| Frontend proxy 404 | Production uses absolute API URL (not `/api` proxy) |
| Wallet won't connect on Vercel | Set `VITE_WALLETCONNECT_PROJECT_ID` |
| Contract deploy fails | Check deployer has Sepolia ETH |
| CORS blocked | Set `FRONTEND_URL` on Render (no trailing slash) |
| Mock data not appearing | Set `TEST_MODE=true` in env |
| `insufficient funds for gas` | Fund wallet: [faucets.chain.link](https://faucets.chain.link) |
| Artillery timeout | Advisory only (`continue-on-error: true`) — CI stays green |

---

## 🏆 Hackathon — Convergence 2026

**Category:** Chainlink CRE + ACE
**Theme:** Convergence — bridging traditional lead generation with decentralized trust infrastructure

**What we built:** A decentralized lead marketplace serving the **$200B+ lead generation market** using **5 Chainlink services** as its trust layer: CRE for on-chain verification and quality scoring, ACE for automated compliance, DECO for privacy-preserving attestation, Data Streams for real-time bid floor pricing, and Confidential Compute for TEE-based lead scoring — enabling trustless, privacy-preserving real-time bidding with **instant x402 settlements**, **non-PII buyer previews**, **ERC-721 lead tokenization**, and **auto-bid automation** across dynamic verticals and 20+ countries.

**Chainlink Depth:**
| Service | Status | Integration |
|---------|--------|-------------|
| **CRE (Functions)** | ✅ Live | `CREVerifier.sol` — on-chain parameter matching, quality scoring, geo-validation |
| **ACE (Compliance)** | ✅ Live | `ACECompliance.sol` — KYC, jurisdiction matrix, reputation system |
| **DECO** | 🔌 Stub-ready | `deco.service.ts` (attestation) + `lib/chainlink/deco.stub.ts` (zkTLS KYC); activates when access granted |
| **Data Streams** | 🔌 Stub-ready | `datastreams.service.ts` — bid floor pricing; activates when access granted |
| **Confidential Compute** | 🔌 Stub-ready | `confidential.service.ts` (scoring) + `lib/chainlink/confidential.stub.ts` (private bids & lead data); activates when access granted |
| **Data Producer** | 🔌 Stub-ready | `CustomLeadFeed.sol` + `data-feed.stub.ts` — publishes anonymized metrics back to CRE as a custom data feed |

**Key differentiators:**
1. **First platform to tokenize leads** — every purchased lead becomes an ERC-721 NFT via `LeadNFTv2.sol` with on-chain provenance, quality scores, resale, and royalties. **This is core, not optional.**
2. Privacy-preserving commit-reveal bidding with ZK fraud detection and **non-PII buyer previews**
3. Cross-border compliance engine with state-level enforcement across 20+ countries
4. **Dynamic verticals** — AI-powered vertical suggestions with PII scrubbing, anti-hallucination validation, and auto-creation
5. **Autonomous bidding** — 7-criteria auto-bid engine + MCP agent server with 9 tools + LangChain integration
6. **CRM pipeline** — HubSpot and Zapier webhook integrations for enterprise buyers
7. Optional **vertical NFT** monetization layer for vertical ownership and holder perks — supplementary, not core

---

## 🔐 Privacy & Compliance Roadmap (DECO + Confidential Compute)

Lead Engine ships with **production-patterned stubs** for Chainlink's next-generation privacy services. These stubs are fully typed, tested under the same patterns as live services (`isStub: true`, simulated latency, deterministic results), and designed as **drop-in replacements** when mainnet access is granted.

### DECO zkTLS — KYC Verification

> **File:** [`deco.stub.ts`](backend/src/lib/chainlink/deco.stub.ts)

Uses DECO's zkTLS protocol to verify KYC identity claims directly from issuer websites **without revealing PII to the platform**.

| Method | Purpose |
|--------|---------|
| `verifyIdentity()` | Generic zkTLS KYC — proves an identity claim from any issuer URL |
| `verifyNMLSLicense()` | Mortgage-vertical: proves valid NMLS broker license for a given state |
| `screenSanctions()` | OFAC/SDN sanctions screening without exposing personal data |
| `batchVerify()` | Run multiple checks in parallel (license + sanctions + business reg) |

**How it works:**
1. Seller/buyer provides an issuer URL (e.g., NMLS, state portal, Treasury OFAC)
2. DECO opens a TLS session with the issuer and extracts the relevant field
3. A ZK proof proves the identity claim is valid
4. Platform receives `verified: boolean` + attestation proof — **never raw PII**

> [!IMPORTANT]
> Ready for mainnet integration when Chainlink DECO access is granted. Swap stub methods for real DECO SDK calls — interfaces are drop-in.

---

### Confidential Compute — Private Bids & Private Lead Data

> **File:** [`confidential.stub.ts`](backend/src/lib/chainlink/confidential.stub.ts)

Uses TEE (Trusted Execution Environment) enclaves for privacy-preserving auctions and lead data handling.

#### Private Bids

| Method | Purpose |
|--------|---------|
| `sealBid()` | Encrypt bid inside TEE → returns envelope + commitment hash for on-chain commit-reveal |
| `revealBid()` | Decrypt and verify bid in TEE → proves the revealed amount matches the original commitment |

**Flow:** Buyer submits `sealBid(wallet, leadId, amount)` → gets `commitment` for on-chain → auction ends → `revealBid()` decrypts inside TEE → commitment validated → winner determined. **Bid amounts are never visible outside the enclave until reveal.**

#### Private Lead Data

| Method | Purpose |
|--------|---------|
| `sealLeadData()` | Encrypt full PII inside TEE → returns sealed payload + non-PII preview for marketplace |
| `unsealLeadData()` | Decrypt PII after payment confirmation → verifies integrity via content hash |

**Flow:** Seller submits lead → `sealLeadData()` encrypts PII, derives non-PII preview inside TEE → buyers see only `{ vertical, geo, qualityScore, source }` → buyer wins auction → x402 escrow confirms payment → `unsealLeadData(paymentTxId)` releases full PII. **Raw PII never leaves the enclave until payment is confirmed.**

> [!IMPORTANT]
> Ready for mainnet integration when Chainlink Confidential Compute access is granted. Swap stub methods for real CC SDK calls — interfaces are drop-in.

---

### Integration Status

| Stub | File | Methods | Mainnet Path |
|------|------|---------|-------------|
| **DECO zkTLS KYC** | `lib/chainlink/deco.stub.ts` | 4 | Replace `simulateLatency()` + `deterministicBool()` with real DECO SDK calls |
| **Confidential Compute Privacy** | `lib/chainlink/confidential.stub.ts` | 4 | Replace `mockSeal()`/`mockUnseal()` with TEE-sealed key operations |
| **DECO Attestation** *(existing)* | `services/deco.service.ts` | 3 | General web data attestation (solar subsidies, compliance docs) |
| **Confidential Scoring** *(existing)* | `services/confidential.service.ts` | 3 | TEE-based lead scoring + preference matching |

> All stubs coexist. The `lib/chainlink/` stubs are domain-specific (KYC, privacy); the `services/` stubs are general-purpose (attestation, scoring).

---

## 🗺️ v2 Roadmap

| Feature | Description |
|---------|-------------|
| **Sponsored / Branded Verticals** | Enterprise sponsors claim branded vertical slots with custom landing pages and priority placement |
| **Pay-Per-Call & Live Transfers** | Real-time phone lead routing with per-call billing and warm-transfer support |
| **Secondary Lead Marketplace** | Buyers resell purchased leads (with provenance via lead NFTs) in a secondary market |
| **Chainlink Data Provider Loop** | Feed aggregated, anonymized lead pricing data back to Chainlink as a verified data source |
| **Enterprise White-Label API** | Full API + SDK for enterprises to embed Lead Engine's RTB, compliance, and settlement into their own platforms |

---

## ⚠️ Known Gaps & Mitigations

| Gap | Risk | Mitigation | Status |
|-----|------|------------|--------|
| ACE compliance is **fail-open** | Non-compliant holder gets perks during ACE downtime | Logged + alert; manual review queue | 🟡 Acceptable |
| Cross-border compliance is US-centric | Limited international coverage | `jurisdiction-policies.ts` extensible per country | 🟡 Extensible |
| GDPR consent = `holderNotifyOptIn` field | Single boolean, no granular consent | V2 will add consent categories | 🟡 V2 |
| Notification daily cap is per-process (in-memory) | Resets on server restart | Move to Redis counter in V2 | 🟡 V2 |
| Hierarchy depth hard-capped at 5 | Deep nesting rejected at creation | `MAX_HIERARCHY_DEPTH` enforced in vertical optimizer | 🟢 Enforced |
| Holder cache in contract **not invalidated on transfer** | Stale holder status until next bid | Cache is per-auction (short-lived); re-checked on new auction | 🟢 Low risk |
| Pre-ping nonce is stored as plaintext | Nonce is audit trail, not a secret | Nonce is `crypto.randomBytes(16)`, used for deterministic pre-ping only | 🟢 By design |

---

## 📜 License

**Proprietary** — All rights reserved. This software is not open source. Unauthorized copying, modification, distribution, or use of this software, via any medium, is strictly prohibited without express written permission from the author.

© 2026 Lead Engine CRE. All rights reserved.
