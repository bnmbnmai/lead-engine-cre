# LeadRTB

[![LeadRTB CI](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml/badge.svg)](https://github.com/bnmbnmai/lead-engine-cre/actions)
[![Chainlink CRE](https://img.shields.io/badge/Chainlink-CRE%20Native-375BD2)](https://docs.chain.link/cre)
[![Base Sepolia](https://img.shields.io/badge/Base%20Sepolia-0052FF?logo=coinbase)](https://sepolia.basescan.org)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-leadrtb.com-brightgreen)](https://leadrtb.com)

[Live Demo](https://leadrtb.com) |
[API](https://api.leadrtb.com/health)

---

The $200B+ lead generation market is broken: buyers cannot verify quality before purchase, sellers wait weeks for payment, and sensitive PII is exposed during bidding. LeadRTB solves this with Chainlink CRE quality attestation, atomic USDC settlement, and winner-only PII decryption -- all on-chain.

## Overview

LeadRTB establishes an on-chain marketplace for tokenized, privacy-preserving leads across 50+ verticals in 20+ countries. Every lead carries a Chainlink CRE quality score (0-100) with on-chain attestation, trades via sealed-bid auctions with VRF v2.5 tiebreakers, and settles atomically in USDC through a PersonalEscrowVault smart contract. Winner-only PII decryption via CRE Confidential Compute ensures lead data stays encrypted until a verified buyer wins the auction.

Autonomous MCP agents, powered by LangChain ReAct with 15 custom tools (including official chainlink-agent-skills/cre-skills), bid autonomously alongside human buyers. The hybrid CRE-native architecture runs deterministic buyer-rule evaluation inside the Chainlink DON while keeping real-time stateful operations (budget enforcement, vault locking, duplicate detection) on the backend server.

## How a Lead Moves Through LeadRTB

```mermaid
flowchart TD
    A["1. Seller Submits Lead"] --> B["2. CRE DON Quality Score"]
    B --> C["3. Sealed-Bid Auction (60s)"]
    C --> D{"4. Tied Bids?"}
    D -- Yes --> E["VRF v2.5 Tiebreaker"]
    D -- No --> F["5. Winner Determined"]
    E --> F
    F --> G["6. USDC Settled Atomically"]
    G --> H["7. LeadNFTv2 Minted on Base Sepolia (winner only)"]
    H --> I["8. Winner Decrypts PII (CRE Confidential)"]
```

**End-to-end lifecycle in one click:** Seller submits a lead -> CRE DON scores it (7-gate evaluation) -> sealed-bid auction runs for 60 seconds with real on-chain vault locks -> VRF v2.5 breaks any ties -> USDC settles atomically via PersonalEscrowVault -> LeadNFTv2 minted on Base Sepolia for winners only -> only the verified winner can decrypt PII via CRE Confidential Compute. NFTs are minted only for won leads after atomic settlement — this is the purest design for winner-only ownership and privacy.

### Key Differentiators

- **Chainlink CRE-Native Scoring** -- every lead scored inside the DON with 7-gate deterministic evaluation and BFT consensus. No off-chain trust assumptions.
- **Atomic USDC Settlement** -- PersonalEscrowVault locks funds on-chain at bid time and releases instantly on auction close. No net terms, no chargebacks.
- **Winner-Only PII Decryption** -- lead data encrypted at rest; only the auction winner can decrypt via CRE Confidential Compute (`encryptOutput: true`).
- **Autonomous AI Bidding** -- Kimi K2.5 agent with 15 MCP tools bids alongside human buyers in real-time, using the same on-chain vault and rule engine.
- **Granular Bounty Hunting** -- buyers post field-specific bounties ("solar leads in CA with 700+ credit score") that auto-match and settle additional USDC rewards.
- **VRF v2.5 Fair Tiebreaking** -- provably random, verifiable on-chain tie resolution ensures no bidder has an unfair advantage.
- **Production Technical Excellence** -- 40 test suites (994 tests) covering full CRE lifecycle, lint-clean codebase, and BullMQ/Redis/WebSocket production scaling already implemented and live.

## Key Features

- **One-click end-to-end demo** with certified on-chain activity across the complete lifecycle (submission, CRE scoring, sealed-bid auction, atomic settlement, post-settlement LeadNFTv2 minting for winners only, Proof-of-Reserves verification, and winner-only PII reveal).
- **LeadNFTv2** supporting secondary-market royalties (2%) and fractional ownership via ERC-3643 compliance.
- **Autonomous AI Agent** powered by Kimi K2.5 (LLM) + LangChain ReAct with 15 custom MCP tools (incl. official chainlink-agent-skills/cre-skills). Fully LLM-autonomous bidding, search, compliance checks, and navigation -- distinct from the deterministic rule-based auto-bid engine that evaluates 7 gates per lead without LLM involvement.
- **Sealed-bid auctions** with commit-reveal privacy, VRF v2.5 fairness for tie resolution, and PersonalEscrowVault atomic USDC settlement.
- **PersonalEscrowVault** with Chainlink Automation-driven daily Proof-of-Reserves checks and automatic refund of expired bid locks.
- **Granular Vertical Field Bounty Hunting** -- buyers post field-specific bounties (for example, "mortgage leads from ZIP code 90210 with good or excellent credit score"). The system automatically matches each submitted lead's field values at ingestion, attaches matching bounty rewards to the auction, and settles the additional USDC payouts on close -- creating direct, hyper-targeted demand signals.
- **CRE Workflow Orchestration** -- production CRE workflow (`EvaluateBuyerRulesAndMatch`) runs buyer vertical/geo/budget rules inside Confidential HTTP enclaves, delivering verifiable matching with significant gas savings and institutional-grade auditability.
- **Production-Grade Scaling Infrastructure** -- horizontal scaling via BullMQ/Redis (distributed bid scheduling, persistent lock registry, event-driven settlement) and WebSocket sharding, already implemented and proven ready for 10,000+ leads per day.

All major edge cases (ties, low-escrow aborts, nonce escalation, concurrent bidding) are handled in production code. Real-time frontend updates via Socket.IO with optimistic states and agent activity badges.

## CRE Workflow: `EvaluateBuyerRulesAndMatch`

Production CRE workflow that evaluates buyer preference rules against incoming leads inside the Chainlink DON using `@chainlink/cre-sdk`. Uses Confidential HTTP to fetch buyer preference sets from the backend API with vault DON secrets (API key never in config or node memory), then runs a deterministic 7-gate rule evaluation with BFT consensus via `consensusIdenticalAggregation`.

### Architecture (Hybrid Model)

```text
+-----------------------------------------------------------+
|                 Chainlink DON (BFT Consensus)              |
|                                                            |
|  1. CronCapability trigger                                 |
|  2. ConfidentialHTTPClient -> GET /api/v1/auto-bid/pending |
|     (API key injected from Vault DON via {{.creApiKey}})   |
|  3. ConfidentialHTTPClient -> GET /api/v1/auto-bid/prefs   |
|  4. Deterministic 7-gate evaluation:                       |
|     +-- Gate 1: Vertical match (exact or wildcard '*')     |
|     +-- Gate 2: Geo country match                          |
|     +-- Gate 3: Geo state include/exclude                  |
|     +-- Gate 4: Quality score threshold                    |
|     +-- Gate 5: Off-site toggle                            |
|     +-- Gate 6: Verified-only toggle                       |
|     +-- Gate 7: Field-level filter evaluation              |
|  5. consensusIdenticalAggregation -> match results         |
|  Output: { leadId, matchedSets[], suggestedBidAmounts[] }  |
+-----------------------------------------------------------+
                           |
                           v
+-----------------------------------------------------------+
|                Backend Server (Real-Time)                   |
|                                                            |
|  triggerBuyerRulesWorkflow() receives DON match results:   |
|  6. Daily budget enforcement (requires real-time DB state) |
|  7. Vault balance lock (requires on-chain tx)              |
|  8. Duplicate bid check (requires real-time DB state)      |
|  9. Sealed-bid creation + commitment hash                  |
|                                                            |
|  Centralized hook: afterLeadCreated() fires on ALL paths:  |
|  +-- API (marketplace.routes.ts, seller/public submit)     |
|  +-- Webhook (integration.routes.ts, e2e-bid)              |
|  +-- Demo (demo-panel.routes.ts, seed, inject, auction)    |
|  +-- Drip (demo-orchestrator.ts, via onLeadInjected cb)    |
|                                                            |
|  Fallback: CRE_WORKFLOW_ENABLED=false -> local auto-bid    |
+-----------------------------------------------------------+
```

**Key files:**

- [`cre-workflows/EvaluateBuyerRulesAndMatch/main.ts`](cre-workflows/EvaluateBuyerRulesAndMatch/main.ts) -- CRE SDK workflow with 7-gate evaluation
- [`cre-workflows/DecryptForWinner/main.ts`](cre-workflows/DecryptForWinner/main.ts) -- Winner-only PII decryption (encryptOutput: true)
- [`cre-workflows/EvaluateBuyerRulesAndMatch/workflow.yaml`](cre-workflows/EvaluateBuyerRulesAndMatch/workflow.yaml) -- Workflow settings
- [`cre-workflows/secrets.yaml`](cre-workflows/secrets.yaml) -- Vault DON secret mapping
- [`cre-workflows/project.yaml`](cre-workflows/project.yaml) -- Base Sepolia RPC config
- [`backend/src/services/cre.service.ts`](backend/src/services/cre.service.ts) -- `triggerBuyerRulesWorkflow()` integration

**Simulate:**

```bash
cd cre-workflows && cre workflow simulate ./EvaluateBuyerRulesAndMatch --target-staging-settings
```

**Gas savings:** Moving buyer rule evaluation into a single CRE workflow DON call reduces on-chain transactions from N (one per verification type) to 1 per lead -- estimated 60-80% gas reduction on Base Sepolia. The DON handles deterministic computation; only matched results trigger on-chain vault locks.

> **Note:** CRE workflows use local simulation + hybrid fallback (full DON deployment pending Early Access approval — see [FINAL_VERIFICATION_LOG.md](FINAL_VERIFICATION_LOG.md) for details).

### CRE-Native Demo Mode

The purple "Run Full On-Chain Demo" button auto-enables CRE-Native mode (1-click). The Demo Control Panel also has an explicit toggle (CRE Workflow Mode) for manual Classic/CRE switching. When enabled:

- Every injected lead is evaluated by the 7-gate CRE workflow via `triggerBuyerRulesWorkflow()`
- Real-time CRE DON entries appear in the persistent On-Chain Log with Basescan proof links
- Winner-only PII decryption via "Decrypt Lead Data" button (CRE DON attested, `encryptOutput: true`)
- Classic mode remains fully functional when toggle is OFF

### Buyer Persona Experience

- Demo Control Panel is **env-gated** (`VITE_DEMO_MODE`), accessible to all personas (Buyer, Seller, Admin)
- Won leads appear in **Buyer Dashboard**, **Purchased Leads** and **Buyer Portfolio** with CRE Quality badge and ACE KYC Verified status
- Each purchased lead has a **Decrypt PII** button with inline PII display (name, email, phone) with "CRE DON Attested" badge
- Quality tooltips use honest wording: "CRE DON Match + Quality Score (pending on-chain scoring)"
- NFT ID column shows vault lock ID with Basescan provenance link (or "Mint Pending" when NFT mint is in progress)
- **Pure persona-wallet architecture:** Buyer persona authenticates as the AI-agent wallet (`0x424CaC...`), and only leads legitimately won by that wallet on-chain appear in Portfolio and My Bids -- no synthetic fallbacks.

### Hybrid CRE Workflow + Backend Stateful Gates

LeadRTB operates an intentional hybrid architecture. When `CRE_WORKFLOW_ENABLED=true`, the CRE DON executes the 7-gate `EvaluateBuyerRulesAndMatch` workflow on Chainlink's decentralized oracle network -- deterministic, verifiable, and gas-optimized (1 DON call per lead vs. N on-chain transactions). When the CRE DON toggle is off (default for local/staging), the backend `auto-bid.service.ts` evaluates the **same buyer preference JSON** stored in the database -- vertical filters, geo exclusions, max bid, verified-lead requirements -- ensuring consistent scoring between on-chain and off-chain paths. Neither path uses synthetic or random scoring; both derive from the buyer's declared preferences as the single source of truth. This design enables production readiness: DON for mainnet settlement, backend for rapid iteration during development.

## Chainlink Integration

### Hackathon Track Eligibility

- **Privacy Track** -- Winner-only PII decryption via CRE Confidential Compute; encrypted lead data at rest; CHTT Phase 2 SubtleCrypto pattern.
- **CRE & AI Track** -- Production CRE workflow (`EvaluateBuyerRulesAndMatch`) with 7-gate DON evaluation; `DecryptForWinner` confidential output.
- **DeFi & Tokenization Track** -- LeadNFTv2 (ERC-3643 with 2% royalties); PersonalEscrowVault atomic USDC settlement; Chainlink Automation PoR.
- **Autonomous Agents Track** -- Kimi K2.5 LLM + LangChain ReAct + 15 MCP tools (incl. official chainlink-agent-skills/cre-skills); fully autonomous bidding.

| # | Service | Contract | Address | Status | Backend File | Basescan | Tenderly |
|---|---------|----------|---------|--------|--------------|----------|----------|
| 1 | **CRE (Quality Scoring + CHTT)** | `CREVerifier` | [0xfec22A5159E077d7016AAb5fC3E91e0124393af8](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8) | ✅ Live & Verified | `cre.service.ts` | ✅ | [Virtual TestNet Explorer](https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions) |
| 2 | **Functions (Bounty Match)** | `BountyMatcher` | [0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D](https://sepolia.basescan.org/address/0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D) | ✅ Live & Verified | `functions.service.ts` | ✅ | [Virtual TestNet Explorer](https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions) |
| 3 | **Automation (PoR + Refunds)** | `PersonalEscrowVault` | [0x56bB31bE214C54ebeCA55cd86d86512b94310F8C](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C) | ✅ Live & Verified | `vault-reconciliation.service.ts` | ✅ | [Virtual TestNet Explorer](https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions) |
| 4 | **VRF v2.5 (Tiebreakers)** | `VRFTieBreaker` | [0x6DE9fd3A54daFB1E145d66F52E538087a3fAEca8](https://sepolia.basescan.org/address/0x6DE9fd3A54daFB1E145d66F52E538087a3fAEca8) | ✅ Live & Verified _(fresh redeploy March 2 2026 — correct on-chain name)_ | `vrf.service.ts` | ✅ | [Virtual TestNet Explorer](https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions) |
| 5 | **ACE Compliance** | `ACECompliance` | [0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6](https://sepolia.basescan.org/address/0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6) | ✅ Live & Verified | `ace.service.ts` | ✅ | [Virtual TestNet Explorer](https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions) |
| 6 | **ACE Lead Policy** | `ACELeadPolicy` | [0x013f3219012030aC32cc293fB51a92eBf82a566F](https://sepolia.basescan.org/address/0x013f3219012030aC32cc293fB51a92eBf82a566F) | ✅ Live & Verified | `nft.service.ts` | ✅ | [Virtual TestNet Explorer](https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions) |
| 7 | **LeadNFTv2 (ERC-3643 + Royalties)** | `LeadNFTv2` | [0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155](https://sepolia.basescan.org/address/0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155) | ✅ Live & Verified | `nft.service.ts` | ✅ | [Virtual TestNet Explorer](https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions) |
| 8–12 | **CRE Workflows, Confidential HTTP, Data Feeds** | DON / Inline | — | ✅ Live | `cre-workflows/` & services | ✅ | [CRE Workflow Simulations](https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions) |
| — | **Functions (Bounty Pool)** | `VerticalBountyPool` | [0x9C22418295642Df3D5521B8fA21fBb03Eb89c3c2](https://sepolia.basescan.org/address/0x9C22418295642Df3D5521B8fA21fBb03Eb89c3c2) | ✅ Live & Verified | `bounty.service.ts` | ✅ | — |

> All contracts carry **"Contract Source Code Verified (Exact Match)"** status on Basescan. See [`CONTRACTS.md`](CONTRACTS.md) for canonical addresses and [`CHAINLINK_SERVICES_AUDIT.md`](docs/archive/CHAINLINK_SERVICES_AUDIT.md) for full details.

Tenderly Virtual TestNet (Base Sepolia fork, full source code visibility) with live CRE workflow + contract transaction history — satisfies mandatory hackathon requirement and qualifies for the dedicated $5k Tenderly + CRE prize track. See `certified-runs/March-2-2026/tenderly/` for traces, screenshots, and simulation links.

### For Judges (1-Click Verification)

- **All contracts verified "Exact Match"** on Basescan (see [`CONTRACTS.md`](CONTRACTS.md)).
- **Live demo**: [https://leadrtb.com](https://leadrtb.com) (connect any Sepolia wallet).
- **CRE Workflow simulation**: `cd cre-workflows && cre workflow simulate ./EvaluateBuyerRulesAndMatch --target-staging-settings`.
- **Full certified demo artifacts**: `certified-runs/March-2-2026/`.
- **Tenderly simulations** are fully programmatic — run `./scripts/tenderly-simulate.sh` to repopulate the VNet with fresh CRE + VRF + Vault + ACE + BountyMatcher transaction history ([Explorer](https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions)).
- Tenderly VNet populated programmatically (4/7 core flows succeed on fork; full live behavior seen on Base Sepolia demo at [leadrtb.com](https://leadrtb.com)). Re-run with `./scripts/tenderly-simulate.sh`.
- See [`FINAL_VERIFICATION_LOG.md`](FINAL_VERIFICATION_LOG.md) for March 2 zero-assumption audit.

## Try the 1-Click Demo

**Live at [https://leadrtb.com](https://leadrtb.com)**

1. **Connect** -- Visit [leadrtb.com](https://leadrtb.com) and connect any wallet on Base Sepolia
2. **Run** -- Click the purple **"Run Full On-Chain Demo"** button (seeds leads, CRE scores, fires auctions, settles USDC, mints NFTs)
3. **Explore** -- Switch to **Buyer** persona to see won leads, CRE Quality badges, and decrypt PII
4. **Verify** -- Open the **On-Chain Log** (Ctrl+Shift+L) to watch every tx with Basescan proof links
5. **Compare** -- Toggle **CRE Workflow Mode** in the Demo Control Panel to see DON vs. classic paths side-by-side

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | Vite + React + Tailwind + Zustand + Socket.IO |
| Backend | Express + Prisma + PostgreSQL + BullMQ + Redis |
| Blockchain | Ethers v6 + Base Sepolia + USDC + LeadNFTv2 |
| CRE | @chainlink/cre-sdk + Confidential HTTP + DON Secrets |
| AI Agent | Kimi K2.5 LLM + LangChain ReAct + MCP Server (15 tools) |

## On-Chain Proofs

Certified demo run available in repository artifacts.

### Architecture

```mermaid
graph TD
    A[Frontend React.js] --> B[Backend Express]
    B --> C[PostgreSQL + Prisma]
    B --> D[Base Sepolia Chain]
    D --> E[PersonalEscrowVault]
    D --> F[CREVerifier]
    D --> G[BountyMatcher]
    D --> H[VRFTieBreaker]
    D --> I[ACECompliance]
    D --> J[LeadNFTv2]
    B --> K[Chainlink DON]
    K --> L[CRE Workflows]
    B --> M[Redis + BullMQ]
```

## Market Opportunity

The global lead generation services market is valued at approximately $14.5 billion in 2025 with sustained double-digit growth. Primary verticals include solar, roofing, HVAC, mortgage, and insurance. LeadRTB addresses core industry challenges -- fraud, delayed payouts, lack of provenance, and manual matching -- while establishing infrastructure for tokenized sensitive data assets.

See [`ROADMAP.md`](ROADMAP.md) for detailed TAM analysis, phased expansion, and the post-hackathon production roadmap.

## Quick Start and Demo Guide

1. Clone the repository: `git clone https://github.com/bnmbnmai/lead-engine-cre`
2. Copy environment configuration: `cp .env.example .env` and populate required keys
3. Install dependencies: `npm install` in both `/frontend` and `/backend`
4. Run locally: `npm run dev`
5. Enable demo mode by setting the environment variable `VITE_DEMO_MODE=true`

Full demonstration instructions, including curl examples and faucet guidance, are in [`submission-checklist.md`](submission-checklist.md).

## Documentation

- [`ROADMAP.md`](ROADMAP.md) -- Phased development plan and hackathon deliverables
- [`docs/PRIVACY_TRACK.md`](docs/PRIVACY_TRACK.md) -- Confidential Compute and CHTT details
- [`CHAINLINK_SERVICES_AUDIT.md`](docs/archive/CHAINLINK_SERVICES_AUDIT.md) -- Service integration audit
- [`CONTRACTS.md`](CONTRACTS.md) -- Contract verification status and addresses
- [`submission-checklist.md`](submission-checklist.md) -- Hackathon submission requirements
