# Lead Engine CRE: Decentralized Real-Time Lead Marketplace with Chainlink Integration

[![CI](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml/badge.svg)](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml)
![Chainlink CRE](https://img.shields.io/badge/Chainlink-CRE-brightgreen)
![Chainlink ACE](https://img.shields.io/badge/Chainlink-ACE-blue)
![Chainlink Automation](https://img.shields.io/badge/Chainlink-Automation-orange)
![Chainlink Functions](https://img.shields.io/badge/Chainlink-Functions-purple)
![On-Chain Vault](https://img.shields.io/badge/Vault-USDC%20Escrow-teal)

> **Chainlink Convergence 2026 Submission — Mandatory CRE + ACE Track.** Tokenizing the $200B+ lead industry with verifiable quality, on-chain compliance, and automated settlements—powered by 8+ Chainlink services for fraud-proof, efficient RTB.

### Recent Updates

> **Feb 18, 2026:** On-chain personal escrow vaults with Chainlink PoR for verifiable reserves and Automation for auto-refunds/expirations. Pricing refined to 5% settlement cut + $1/action for competitive edge.

---

## Overview

Lead Engine CRE revolutionizes lead generation: Sellers submit via AI-optimized CRO landers; Chainlink CRE zk-scores quality (0–10k); ACE auto-KYC gates access; buyers pre-fund on-chain vaults, bid sealed with MCP agents; 60s auctions settle in USDC with VRF ties and auto-refunds. Undercuts legacy platforms (5–7% fees vs 10–30%) with instant, verifiable payouts—driving explosive network effects.

> **Judges:** Dive into our [live demo](https://lead-engine-cre-frontend.vercel.app) for seeded leads, vault funding, autobids, and PoR checks. See how we flip industry pain with Chainlink depth.

---

## Features

- **On-Chain Personal Escrow Vaults** — Frictionless USDC pools for bids/bounties/autobids. Gas sponsored, $1/action fee, 5% settlement cut—auto-deduct/refund via Automation.
- **Verifiable Reserves (PoR)** — Chainlink Proof of Reserves attests solvency, with 24h automated verifications for unbreakable trust.
- **Sealed RTB Auctions** — 60s timed, VRF fair ties, Data Feeds dynamic floors. Handles dotted sub-verticals (e.g., `home_services.plumbing`) with lazy ACE policies.
- **AI-Powered Autobidding** — LangChain MCP agents (12 tools) execute field-level strategies from vaults.
- **Targeted Bounties** — Fund vertical pools (e.g., $75 for solar in CA, credit>720)—Functions match, Automation expires unclaimed.
- **LeadNFT Assets** — ERC-721 with 2% royalties, PII decryption only for winners.
- **Fraud Defenses** — CRE zkProofs, DECO/Confidential HTTP stubs for advanced signals.
- **Demo Tools** — Persona switches, data seeding, Chainlink Services Dev Log for real-time insights.

> Explore `docs/FEATURES.md` for specs.

---

## Architecture

Seller submits → CRE/ACE verify → Vault lock → Sealed bid/settle → Release/refund. Backend sponsors gas; on-chain core ensures trust.

### Chainlink Spotlight

8 services orchestrate decentralization:

| Service | Role |
|---|---|
| **CRE** | zkProof quality scoring |
| **ACE** | Auto-KYC/policies |
| **Data Feeds** | Floor pricing |
| **VRF v2.5** | Tie resolution |
| **Functions** | Bounty matching |
| **Automation** | PoR checks, refund expirations |
| **PoR** | Reserve proofs |
| **DECO/Confidential HTTP** | Fraud stubs |

---

## Why We Win: Differentiators

| Legacy Pain | CRE Solution |
|---|---|
| High fees/chargebacks | 5–7% effective with auto-refunds |
| Fraud/opacity | CRE zk-scores + PoR reserves |
| Slow payouts | Instant USDC via vaults |
| Manual checks | ACE auto-compliance |
| No automation | Automation for PoR/expirations |
| Centralized holds | On-chain vaults, sponsored gas |

---

## Fraud Mitigation

| Type | Defense | Impact |
|---|---|---|
| Stuffing | CRE zkProofs + limits | Blocks invalid leads |
| Recycling | LeadNFT timestamps | Ensures uniqueness |
| Disputes | On-chain settlements | No chargebacks |
| Mismanagement | PoR verifications | Proves reserves |
| Expirations | Automation refunds | Clears stuck funds |

> Full matrix in `docs/FRAUD.md` (12+ types).

---

## Pricing: Simple & Competitive

$1/action convenience fee (bids/bounties/autobids) + 5% settlement cut (wins/matches). Vault-automated for zero friction.

| Channel | Convenience Fee | Platform Cut | Effective |
|---|---|---|---|
| Manual bid | $1/bid | 5% on win | 5–6% |
| Auto-bid | $1/execution | 5% on win | 5–6% |
| API/MCP | $1/bid | 5% on win | 5–6% |
| Buy It Now | $1 | 5% | 6% |
| Bounty Release | $1/post | 5% on match | 5–6% |

> Fees cover sponsorship/ops, deducted from vault. Refunds fee-free.

---

## Quick Start & Demo

1. **Clone:** `git clone https://github.com/bnmbnmai/lead-engine-cre`
2. **Install:** `yarn`
3. **Env:** Copy `.env.example` → `.env`, set keys (e.g., `VAULT_ADDRESS_BASE_SEPOLIA`, `AUTOMATION_REGISTRY`, `POR_FEED_ADDRESS`)
4. **Backend:** `cd backend && prisma db push && yarn dev`
5. **Frontend:** `cd frontend && yarn dev`
6. **Agents:** `cd mcp-server && yarn dev` (LLM key required)
7. **Contracts:** `cd contracts && yarn deploy:base-sepolia`

### Demo Flow (Buyer Persona)

1. Fund vault ($100+ USDC)
2. Post bounty → Set autobid rules
3. Place sealed bid on lead
4. Win: Auto-settle (5% cut)
5. Check PoR status → Withdraw balance

**Live:** https://lead-engine-cre-frontend.vercel.app

---

## Deployment

Vercel (frontend) + Render (backend). Contracts on Base Sepolia.

**Key env:**

| Variable | Purpose |
|---|---|
| `VAULT_ADDRESS_BASE_SEPOLIA` | PersonalEscrowVault contract |
| `AUTOMATION_REGISTRY` | Chainlink Automation registry |
| `POR_FEED_ADDRESS` | Proof-of-Reserves feed |
| `USDC_CONTRACT_ADDRESS` | ERC-20 payment token |
| `PLATFORM_WALLET_ADDRESS` | Fee recipient |

> See `.env.example`. Run `prisma db push` post-schema changes.

---

## Roadmap

| Priority | Items |
|---|---|
| **High** | DECO/Confidential HTTP fraud signals · Cross-chain support |
| **Medium** | Secondary NFT markets · Advanced PoR Feed audits |
| **Ready** | On-Chain Vaults with PoR/Automation · Multi-language landers · NFT royalties (2%) |

> Details in `ROADMAP.md`