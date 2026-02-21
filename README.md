# Lead Engine CRE

**On-chain tokenized lead marketplace with autonomous AI agents on Base.**

[![CI](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml/badge.svg)](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml)
![Tests](https://img.shields.io/badge/tests-1288%20passing-brightgreen)
![Chainlink CRE](https://img.shields.io/badge/Chainlink-CRE-brightgreen)
![Chainlink ACE](https://img.shields.io/badge/Chainlink-ACE-blue)
![Chainlink Automation](https://img.shields.io/badge/Automation-PoR%20%2B%20Refunds-orange)
![Chainlink Functions](https://img.shields.io/badge/Chainlink-Functions-purple)
![Base Sepolia](https://img.shields.io/badge/Deployed-Base%20Sepolia-blue)
![Live Demo](https://img.shields.io/badge/Live%20Demo-vercel.app-brightgreen)

[Live Demo](https://lead-engine-cre-frontend.vercel.app) | [GitHub](https://github.com/bnmbnmai/lead-engine-cre)

---

## Overview

Lead Engine CRE is an on-chain marketplace for tokenized leads. Sellers mint high-quality leads as tradable LeadNFTs. Buyers participate in real-time sealed-bid auctions with instant USDC settlement and verifiable provenance through Chainlink.

Autonomous MCP agents, powered by LangChain ReAct and 11 integrated tools, continuously hunt and bid on leads according to buyer-defined rules for verticals, quality scores, budgets, and geo-targeting.

Built for the **Chainlink Convergence Hackathon 2026** (CRE + ACE track), the platform demonstrates production-grade integration across the Chainlink ecosystem while addressing core inefficiencies in lead generation: fraud, delayed payouts, lack of provenance, and poor matching.

---

## How a Lead Moves Through the System

```mermaid
graph TD
    A["Lead Submission<br>Lander / API / Demo"] --> B["CRE Verification + ZK Scoring"]
    B --> C["Mint LeadNFT on Base Sepolia"]
    C --> D["Marketplace Listing + Auction Starts"]
    D --> E["Sealed Bids from Buyers or Autonomous Agents"]
    E --> F["Auction Ends"]
    F --> G["Winner Settlement via PersonalEscrowVault"]
    G --> H["Losers Refunded"]
    H --> I["Chainlink Automation PoR Check"]
    I --> J["PII Reveal to Winner"]
    J --> K["LeadNFT Ownership Transferred"]
    K --> L["Optional Secondary Sale with Royalties"]
```

---

## Key Features

- **One-click full on-chain demo** showcasing the complete lifecycle: lead creation, NFT minting, autonomous bidding, settlement, PoR verification, and results persistence
- **LeadNFTs with built-in royalties** for recurring creator revenue
- **Autonomous MCP agents** that operate 24/7 using buyer-configured preferences and LangChain ReAct reasoning
- **Programmable buyer bounties** funded per vertical and executed via Chainlink Functions
- **PersonalEscrowVault** with Chainlink Automation for Proof of Reserves and automatic lock expiry
- **Sealed-bid auctions** with commit-reveal privacy and Chainlink VRF for fair tie resolution
- **Dynamic verticals** with drag-and-drop form builder and field-level auto-bid rules
- **Real-time analytics** with structured Socket.IO events and continuous vault reconciliation monitoring

---

## Chainlink Integration

Lead Engine uses six Chainlink services in production flows:

| Service | Role |
|---------|------|
| **CRE** | On-chain quality scoring with ZK proofs for lead verification and parameter matching |
| **ACE** | TCPA consent management, jurisdiction validation, and compliance checks |
| **Automation** | Proof of Reserves every 24 hours and automatic refund of expired bid locks |
| **VRF v2.5** | Verifiable random tiebreaker for equal bids |
| **Functions** | Dynamic bounty matching and payout execution |
| **Data Feeds** | Real-time price references for bidding logic |

This integration enables trust-minimized, verifiable lead transactions at scale.

---

## Architecture

```mermaid
graph TD
    Frontend["Frontend<br>Vite / React / Tailwind<br>Marketplace, Dashboards, Demo Panel, Admin"]
    Backend["Backend<br>Express + Socket.IO + Prisma<br>Demo Orchestrator + Services"]
    MCP["MCP Agent Server<br>LangChain ReAct + 11 Tools"]
    Contracts["Smart Contracts<br>Base Sepolia<br>LeadNFTv2, PersonalEscrowVault, CREVerifier, VRFTieBreaker, VerticalBountyPool"]
    Chainlink["Chainlink<br>CRE, ACE, Automation, VRF, Functions, Data Feeds"]

    Frontend --> Backend
    Backend --> MCP
    Backend --> Contracts
    Contracts --> Chainlink
```

---

## Market Opportunity

The global lead generation market exceeds **$200 billion annually**. Key verticals such as solar, roofing, HVAC, mortgage, and insurance are experiencing rapid growth but remain highly fragmented and inefficient.

Sellers face high fraud rates and delayed payouts. Buyers waste time and capital on low-quality leads. Lead Engine addresses these challenges with atomic settlement, verifiable quality scoring, recurring royalties through LeadNFTs, and autonomous demand generation via AI agents.

---

## Post-Hackathon Vision

- Secondary marketplace for trading LeadNFTs
- Enterprise white-label version for large lead buyers
- Fiat on-ramps and direct CRM integrations (HubSpot, Salesforce)
- Expanded autonomous agent capabilities for multi-vertical orchestration
- Institutional lead portfolio tokenization as RWAs

---

## Getting Started

Detailed local development instructions are available in the repository.

The platform is fully deployed and functional on **Base Sepolia**.

---

## Built With

| Layer | Technology |
|-------|-----------|
| **Blockchain** | Base Sepolia |
| **Smart Contracts** | Solidity + Hardhat |
| **Backend** | Node.js, Express, Socket.IO, Prisma |
| **Frontend** | React, Vite, Tailwind, ethers.js |
| **AI Agents** | LangChain ReAct + Moonshot Kimi (OpenAI-compatible) |
| **Oracles** | Full Chainlink stack (CRE, ACE, Automation, VRF, Functions, Data Feeds) |

---

*Lead Engine CRE provides a new infrastructure layer for the lead economy — transparent, instant, and autonomous.*

*Built for the Chainlink Convergence Hackathon 2026.*