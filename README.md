# Lead Engine CRE

[![CI](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml/badge.svg)](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml)
[![Chainlink CRE](https://img.shields.io/badge/Chainlink-CRE-brightgreen)](https://chain.link/convergence)
[![ACE Compliance](https://img.shields.io/badge/Compliance-ACE-blue)](https://chain.link/ace)
[![Confidential HTTP](https://img.shields.io/badge/Privacy-CHTT-green)](https://chain.link/cre)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-vercel.app-brightgreen)](https://lead-engine-cre-frontend.vercel.app)

[Live Demo](https://lead-engine-cre-frontend.vercel.app) | [X Profile](https://x.com/qasrn_exe) | Last Updated: February 23, 2026

---

## Overview

Lead Engine CRE is an on-chain marketplace for tokenized leads on Base Sepolia, transforming the $200B+ lead generation industry. Sellers submit leads, which are quality-scored via Chainlink CRE, minted as ACE-compliant LeadNFTs, and auctioned in sealed-bid formats. Buyers—manual or AI agents—compete with atomic USDC settlements via PersonalEscrowVault, ensuring fraud resistance, instant payouts, and verifiable provenance.

Key innovations include autonomous AI agents (e.g., Kimi-powered) using auto-bid rules for 24/7 participation, queue-based auction synchronization for real-time frontend updates, and privacy-preserving mechanics like commit-reveal bids. This "LeadFi" protocol addresses industry pain points: 30–50% fraud, delayed net terms, and manual matching.

Built for Chainlink Convergence 2026, it orchestrates six Chainlink services for a cohesive, real-world utility demo.

---

## Privacy & Confidential Computing

Sensitive PII is AES-256-GCM encrypted. CREVerifier uses Confidential HTTP (CHTT) Phase 2 for enclave-based scoring and fraud enrichment. Results are attested and decrypted backend-side. See `PRIVACY_INTEGRATION_AUDIT.md` for details.

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

    Nuances: Queue-based bidding ensures real-time desync-free updates; AI agents trigger via auto-rules post-injection.

Key Features

One-Click Demo: End-to-end lifecycle with real on-chain events (e.g., 7-cycle run: $189 settled, $16.45 income—see demo-results-db4763d9.json).
LeadNFTs: Tokenized leads with secondary tradability and royalties.
AI Agents: Kimi-powered agent assigned to buyer wallet (e.g., 0x7be5ce8824d5c1890bC09042837cEAc57a55fdad) uses set_auto_bid_rules for autonomous bidding; visible via 🤖 logs.
Sealed-Bid Auctions: Commit-reveal privacy, queue registry for sync, VRF ties.
Escrow & Automation: Atomic settlements, daily PoR, auto-refunds.
MCP Tools: 11 custom tools for agent workflows (search, bid, preferences).
Real-Time UX: Socket.IO updates, optimistic pending states, agent badges.

Edge Cases: Handles ties, low-escrow aborts, nonce contention via gas escalation.

Chainlink Integration
Six services across the lifecycle:

































ServiceRoleCREQuality scoring + CHTT enrichment.ACEPolicy-protected mint/transfer.AutomationPoR checks + lock refunds.VRF v2.5Fair tiebreakers.Functions (ZK)ZK-proof verification.Data FeedsPrice guards in escrow.
See CHAINLINK_SERVICES_AUDIT.md for audits.

Tech Stack

































LayerTechnologiesFrontendVite + React + Tailwind + Zustand + Socket.IOBackendExpress + Prisma + Socket.IO + LangChainSmart ContractsSolidity + Hardhat (Base Sepolia)AI AgentsMCP server with 11 tools; Kimi model integrationOraclesChainlink stackDatabaseRender Postgres

On-Chain Proofs
Contracts verified on Basescan (as of 2026-02-24):



































ContractAddressStatusPersonalEscrowVault0x56bB31bE214C54ebeCA55cd86d86512b94310F8CVerified, live activityLeadNFTv20x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155Verified, ACE attachedCREVerifier0xfec22A5159E077d7016AAb5fC3E91e0124393af8Verified, subscription 3063VRFTieBreaker0x86c8f348d816c35fc0bd364e4a9fa8a1e0fd930eVerifiedACELeadPolicy0x013f3219012030aC32cc293fB51a92eBf82a566FVerified
Certified run: db4763d9 (7 cycles, PoR passed). See onchain-activation-checklist.md.

Architecture
mermaidgraph TD
    Frontend["Frontend (React/Vite)"] --> Backend["Backend (Express/Prisma)"]
    Backend --> MCP["MCP Agent Server (LangChain + Tools)"]
    Backend --> Contracts["Contracts (Base Sepolia)"]
    Contracts --> Chainlink["Chainlink Services"]
    MCP --> Backend
Nuances: Queue registry for bid sync; fire-and-forget auto-bid evaluations.

Market Opportunity
$200B+ global lead-gen market (solar, roofing, etc.). Solves fraud (CRE), delays (atomic escrow), provenance (NFTs), matching (agents).
Implications: Potential for "lead derivatives"; regulatory edges via ACE.

Quick Start & Demo Guide

Clone repo: git clone https://github.com/bnmbnmai/lead-engine-cre
Setup env: Copy .env.example, add keys (e.g., DEPLOYER_PRIVATE_KEY).
Install: npm i (frontend/backend).
Run: npm run dev (local); deploy to Vercel/Render.
Demo: Use floating panel (enable via VITE_DEMO_MODE=true). See demo-polish-next-steps.md for curl triggers.

Edge Cases: Testnet faucets for USDC; monitor nonce errors.

Post-Hackathon Roadmap

Immediate: Full demo video, submission polish.
Short-Term: Third-party audit, mainnet migration (Base/Arbitrum via CCIP).
Scaling: Redis for leadLockRegistry (10k+ leads/day); BullMQ for bid queues; event-driven settlement.
Features: Multi-agent marketplace; lead derivatives; enterprise SDKs.
Long-Term: Generalized data exchange (health/KYC); agent-owned portfolios.

See ROADMAP.md for details.