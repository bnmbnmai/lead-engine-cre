# Lead Engine CRE

[![CI](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml/badge.svg)](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml)
[![Chainlink CRE](https://img.shields.io/badge/Chainlink-CRE-brightgreen)](https://chain.link/convergence)
[![ACE Compliance](https://img.shields.io/badge/Compliance-ACE-blue)](https://chain.link/ace)
[![Confidential HTTP](https://img.shields.io/badge/Privacy-CHTT-green)](https://chain.link/cre)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-vercel.app-brightgreen)](https://lead-engine-cre-frontend.vercel.app)

[Live Demo](https://lead-engine-cre-frontend.vercel.app) | Last Updated: February 23, 2026

---

## Overview

Lead Engine CRE is an on-chain marketplace for tokenized leads on Base Sepolia, transforming the $200B+ lead generation industry. Sellers submit leads, which are quality-scored via Chainlink CRE, minted as ACE-compliant LeadNFTs, and auctioned in sealed-bid formats. Buyers—manual or AI agents—compete with atomic USDC settlements via PersonalEscrowVault, ensuring fraud resistance, instant payouts, and verifiable provenance.

Key innovations include autonomous AI agents (e.g., Kimi-powered) using auto-bid rules for 24/7 participation, queue-based auction synchronization for real-time frontend updates, and privacy-preserving mechanics like commit-reveal bids. This "LeadFi" protocol addresses industry pain points: 30–50% fraud, delayed net terms, and manual matching.

Built for Chainlink Convergence 2026, it orchestrates six Chainlink services for a cohesive, real-world utility demo.

---

## Privacy & Confidential Computing

Sensitive PII is AES-256-GCM encrypted (`privacy.service.ts`). CREVerifier uses Confidential HTTP (CHTT) Phase 2 for enclave-based scoring and fraud enrichment. Results are attested and decrypted backend-side. See [`docs/PRIVACY_TRACK.md`](docs/PRIVACY_TRACK.md) for the full code path walkthrough (line numbers, encryption details, sealed-bid pattern, Privacy Track qualification).

Implications: GDPR/CCPA compliance scaffolding, with edge cases like reveal-only-to-winner minimizing exposure.

---

## How a Lead Moves Through the System

```mermaid
graph TD
    A["Lead Submission (Lander/API/Demo)"] --> B["CRE Verification + Quality Scoring"]
    B --> C["Mint LeadNFTv2 (ACE-Protected)"]
    C --> D["Marketplace Listing + Auction Starts"]
    D --> E["Sealed Bids (Manual/Agents via Queue Registry)"]
    E --> F["Auction Ends (VRF Tiebreaker if Needed)"]
    F --> G["Settlement via PersonalEscrowVault"]
    G --> H["Refunds + PII Reveal to Winner"]
    H --> I["Chainlink Automation PoR Check"]
    I --> J["NFT Transfer + Provenance Update"]
```

> Queue-based bidding ensures real-time desync-free updates; AI agents trigger via auto-rules post-injection.

---

## Key Features

- **One-Click Demo** — End-to-end lifecycle with real on-chain events (e.g., 7-cycle run: $189 settled, $16.45 income — see `demo-results-db4763d9.json`)
- **LeadNFTs** — Tokenized leads with secondary tradability and royalties
- **AI Agents** — Kimi-powered agent (`0x7be5ce88…`) uses `set_auto_bid_rules` for autonomous bidding; visible via 🤖 logs
- **Sealed-Bid Auctions** — Commit-reveal privacy, queue registry for sync, VRF tiebreakers
- **Escrow & Automation** — Atomic settlements, daily PoR, auto-refunds
- **MCP Tools** — 12 custom tools for agent workflows (search, bid, preferences, granular bounties)
- **Granular Bounties** — On-chain USDC bounty pools matched via Chainlink Functions + stable AES-256-GCM encryption
- **Real-Time UX** — Socket.IO updates, optimistic pending states, agent badges

> Edge cases handled: ties, low-escrow aborts, nonce contention via gas escalation.

---

## Chainlink Integration

Six services across the lifecycle:

| Service | Role |
|---|---|
| CRE | Quality scoring + CHTT enrichment |
| ACE | Policy-protected mint/transfer |
| Automation | PoR checks + lock refunds |
| VRF v2.5 | Fair tiebreakers |
| Functions (Bounty) | Granular bounty criteria matching (BountyMatcher) |
| Functions (ZK) | ZK-proof verification via CHTT Phase 2 |
| Data Feeds | Price guards in escrow |

See [`CHAINLINK_SERVICES_AUDIT.md`](CHAINLINK_SERVICES_AUDIT.md) for the full service audit table with contract addresses, key functions, backend files, and Basescan links.

See [`mcp-server/README.md`](mcp-server/README.md) for the full 12-tool MCP agent server documentation.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | Vite + React + Tailwind + Zustand + Socket.IO |
| Backend | Express + Prisma + Socket.IO + LangChain |
| Oracles | Chainlink CRE, ACE, Automation, VRF v2.5, Functions, Data Feeds |
| Smart Contracts | Solidity + Hardhat (Base Sepolia) |
| AI Agents | MCP server with 12 tools; Kimi model integration |
| Database | Render Postgres |

---

## On-Chain Proofs

Contracts verified on Basescan as of 2026-02-24:

| Contract | Address | Status |
|---|---|---|
| PersonalEscrowVault | `0x56bB31bE214C54ebeCA55cd86d86512b94310F8C` | Verified, live activity (1,477 txns) |
| LeadNFTv2 | `0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155` | Verified, ACE attached |
| CREVerifier | `0xfec22A5159E077d7016AAb5fC3E91e0124393af8` | Verified, Functions sub 581 |
| VRFTieBreaker | `0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930e` | Verified |
| ACECompliance | `0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6` | Verified |
| ACELeadPolicy | `0x013f3219012030aC32cc293fB51a92eBf82a566F` | Verified |
| BountyMatcher | `0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D` | Verified, deployed 2026-02-24 |

See [`CONTRACTS.md`](CONTRACTS.md) for Basescan links and full audit details.

Certified run: `db4763d9` (7 cycles, PoR passed).

---

## Architecture

```mermaid
graph TD
    Frontend["Frontend (React/Vite)"] --> Backend["Backend (Express/Prisma)"]
    Backend --> MCP["MCP Agent Server (LangChain + Tools)"]
    Backend --> Contracts["Contracts (Base Sepolia)"]
    Contracts --> Chainlink["Chainlink Services"]
    MCP --> Backend
```

> Queue registry for bid sync; fire-and-forget auto-bid evaluations per injected lead.

---

## Market Opportunity

$200B+ global lead-gen market (solar, roofing, HVAC, mortgage, insurance). Solves fraud (CRE), delayed payouts (atomic escrow), lack of provenance (NFTs), and manual matching (agents).

Potential for "lead derivatives" and regulatory edges via ACE compliance enforcement.

---

## Quick Start & Demo Guide

1. Clone: `git clone https://github.com/bnmbnmai/lead-engine-cre`
2. Setup env: copy `.env.example`, add keys (e.g., `DEPLOYER_PRIVATE_KEY`)
3. Install: `npm i` in both `frontend/` and `backend/`
4. Run locally: `npm run dev`
5. Demo: enable floating panel via `VITE_DEMO_MODE=true` (Vercel env var)

See `demo-polish-next-steps.md` for curl triggers and faucet notes.

---

## Post-Hackathon Roadmap

- **Immediate** — Full demo video, submission polish
- **Short-Term** — Third-party audit, mainnet migration (Base/Arbitrum via CCIP)
- **Scaling** — Redis for `leadLockRegistry` (10k+ leads/day); BullMQ for bid queues; event-driven settlement
- **Features** — Multi-agent marketplace; lead derivatives; enterprise SDKs
- **Long-Term** — Generalized data exchange (health/KYC); agent-owned portfolios

See `ROADMAP.md` for full details.