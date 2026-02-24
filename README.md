# Lead Engine CRE

[![CI](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml/badge.svg)](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml)
[![Chainlink CRE](https://img.shields.io/badge/Chainlink-CRE-brightgreen)](https://chain.link/convergence)
[![ACE Compliance](https://img.shields.io/badge/Compliance-ACE-blue)](https://chain.link/ace)
[![Confidential HTTP](https://img.shields.io/badge/Privacy-CHTT-green)](https://chain.link/cre)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-vercel.app-brightgreen)](https://lead-engine-cre-frontend.vercel.app)

[Live Demo](https://lead-engine-cre-frontend.vercel.app) | Last Updated: 24 February 2026

---

## Overview

Lead Engine CRE establishes an on-chain marketplace for tokenized, privacy-preserving leads on Base Sepolia. Sellers submit high-value leads that undergo verifiable quality scoring and fraud-signal enrichment via Chainlink Confidential Compute and Confidential HTTP. Leads are minted as ACE-compliant LeadNFTs and offered through sealed-bid auctions with atomic USDC settlement via PersonalEscrowVault.

Autonomous MCP agents, powered by LangChain ReAct and 11 custom tools, execute continuous bidding according to buyer-configured rules for verticals, geography, quality thresholds, and budgets. The architecture integrates six Chainlink services across the full lead lifecycle, delivering fraud resistance, instant payouts, verifiable provenance, and compliance enforcement.

Built for Chainlink Convergence 2026, the platform positions sensitive lead data as institutional-grade private data RWAs and is eligible for the Privacy Track, CRE & AI Track, DeFi & Tokenization Track, and Autonomous Agents Track on Moltbook.

---

## Privacy & Confidential Computing

All personal identifiable information is protected with client-side AES-256-GCM encryption. The CREVerifier contract leverages Chainlink Confidential HTTP (CHTT) Phase 2 for enclave-based quality scoring and HMAC fraud-signal enrichment. Results are returned with enclave attestations and decrypted only by authorized backend processes.

Winner-only decryption of lead PII is handled via Confidential Compute (early access through CRE). Full technical details and compliance scaffolding for GDPR/CCPA are documented in `PRIVACY_INTEGRATION_AUDIT.md`.

---

## How a Lead Moves Through the System

```mermaid
graph TD
    A["Lead Submission (Lander / API / Demo)"] --> B["CRE Verification + Quality Scoring"]
    B --> C["Mint LeadNFTv2 (ACE-Protected)"]
    C --> D["Marketplace Listing + Auction Starts"]
    D --> E["Sealed Bids (Manual or Autonomous Agents)"]
    E --> F["Auction Ends (VRF Tiebreaker if Needed)"]
    F --> G["Settlement via PersonalEscrowVault"]
    G --> H["Refunds + Winner-Only PII Reveal"]
    H --> I["Chainlink Automation PoR Check"]
    I --> J["NFT Transfer + Provenance Update"]

  ### Key Features

- **One-click end-to-end demo** with real on-chain activity (certified cycles with PoR verification)
- **LeadNFTv2** with secondary-market royalties and fractional ownership support
- **Autonomous MCP agents** operating 24/7 with configurable auto-bid rules
- **Sealed-bid auctions** with commit-reveal privacy and VRF fairness
- **PersonalEscrowVault** with Automation-driven Proof-of-Reserves and auto-refunds
- **Real-time frontend updates** via Socket.IO with optimistic states and agent activity badges

All major edge cases (ties, low-escrow aborts, nonce escalation) are handled in production code.  

### Chainlink Integration

| Service | Role |
|---|---|
| **CRE** | Quality scoring, Confidential HTTP enrichment, and workflow orchestration |
| **ACE** | Policy-protected minting and transfers on LeadNFTv2 |
| **Automation** | Daily Proof-of-Reserves and automatic expired-bid refunds |
| **VRF v2.5** | Verifiable random tiebreaker for equal bids |
| **Functions (ZK)** | ZK-proof verification and external data requests |
| **Data Feeds** | USDC/ETH price guards in escrow (Data Streams integration planned for dynamic repricing) |

### Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Vite + React + Tailwind + Zustand + Socket.IO |
| **Backend** | Express + Prisma + Socket.IO + LangChain |
| **Smart Contracts** | Solidity 0.8.27 + Hardhat (Base Sepolia) |
| **AI Agents** | MCP server with 11 custom tools; official Chainlink agent skills integration |
| **Oracles** | Chainlink CRE, ACE, Automation, VRF v2.5, Functions, Data Feeds |
| **Database** | Render Postgres (with planned read replicas) |

### On-Chain Proofs
All contracts are deployed and source-verified on Base Sepolia (as of 24 February 2026):
| Contract | Address | Status |
|---|---|---|
| **PersonalEscrowVault** | `0x56bB31bE214C54ebeCA55cd86d86512b94310F8C` | Verified, live activity |
| **LeadNFTv2** | `0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155` | Verified, ACE policy attached |
| **CREVerifier** | `0xfec22A5159E077d7016AAb5fC3E91e0124393af8` | Verified, subscription active |
| **VRFTieBreaker** | `0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e` | Verified |
| **ACELeadPolicy** | `0x013f3219012030aC32cc293fB51a92eBf82a566F` | Verified |

Certified demo run available in repository artifacts.

### Architecture

```mermaid
graph TD
    Frontend["Frontend (React/Vite)"] --> Backend["Backend (Express/Prisma)"]
    Backend --> MCP["MCP Agent Server (LangChain + Tools)"]
    Backend --> Contracts["Smart Contracts (Base Sepolia)"]
    Contracts --> Chainlink["Chainlink Services"]
    MCP --> Backend
```

### Market Opportunity
The global lead generation services market is valued at approximately $14.5 billion in 2025 with sustained double-digit growth. Primary verticals include solar, roofing, HVAC, mortgage, and insurance. Lead Engine CRE addresses core industry challenges—fraud, delayed payouts, lack of provenance, and manual matching—while establishing infrastructure for tokenized sensitive data assets.

See `ROADMAP.md` for detailed TAM analysis and phased expansion.

### Quick Start & Demo Guide

1. **Clone the repository:** `git clone https://github.com/bnmbnmai/lead-engine-cre`
2. **Copy environment configuration:** `cp .env.example .env` and populate required keys
3. **Install dependencies:** `npm install` in both `/frontend` and `/backend`
4. **Run locally:** `npm run dev`
5. **Enable demo mode** on Vercel by setting the environment variable `VITE_DEMO_MODE=true`

Full demonstration instructions, including curl examples and faucet guidance, are in `demo-polish-next-steps.md`.

### Documentation

- [`ROADMAP.md`](ROADMAP.md) — Phased development plan and hackathon deliverables
- [`PRIVACY_INTEGRATION_AUDIT.md`](PRIVACY_INTEGRATION_AUDIT.md) — Confidential Compute and CHTT details
- [`CHAINLINK_SERVICES_AUDIT.md`](CHAINLINK_SERVICES_AUDIT.md) — Service integration audit
- [`onchain-activation-checklist.md`](onchain-activation-checklist.md) — Contract verification status
- [`submission-checklist.md`](submission-checklist.md) — Hackathon submission requirements
