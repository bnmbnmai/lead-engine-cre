# Pitch Deck — LeadRTB

**Format:** 12 slides, 3-minute verbal walkthrough

---

## Slide 1: Title

**LeadRTB**
*Decentralized Real-Time Bidding for the $200B+ Lead Marketplace*

Built with 12 Chainlink Service Integrations: CRE + ACE + Functions + VRF + Data Feeds + Confidential HTTP + CRE Workflows + Confidential Compute
Chainlink Hackathon 2026 — Convergence

---

## Slide 2: Problem

**The lead marketplace is broken:**

- 🚫 **No Trust** — Buyers can't verify lead quality before purchase
- 🔓 **No Privacy** — PII exposed during bidding process
- ⚖️ **No Compliance** — Manual KYC/AML, no cross-border enforcement
- 💸 **No Transparency** — Opaque pricing, hidden fees, bid manipulation
- 🌍 **No Global Infrastructure** — No standard for cross-border lead trading
- 🤖 **No Automation** — No API for programmatic bidding at scale

> $200B+ market with zero on-chain verification

---

## Slide 3: Solution

**LeadRTB = Chainlink-powered trust layer for lead trading**

| Problem | Solution |
|---------|----------|
| No trust | CRE Functions verify quality on-chain |
| No privacy | ZK proofs + encrypted commit-reveal bids + Confidential Compute |
| No compliance | ACE automates KYC + jurisdiction + MiCA enforcement |
| No transparency | NFT leads + USDC escrow with on-chain settlement |
| No global infra | 50+ verticals × 20+ countries out of the box |
| No automation | MCP agent server for programmatic bidding + CRM exports |

---

## Slide 4: Architecture

```
┌──────────── Frontend (Cloudflare) ─────────────┐
│  React + wagmi + vanilla CSS · WalletConnect │
└────────────────┬───────────────────────────┘
                 │
┌────────────────▼───────────────────────────┐
│  Backend (Render) ─ Express + Prisma + WS  │
│  RTB Engine · Privacy Suite · Escrow     │
│  Data Feeds · Confid HTTP · CRE Workflows│
└───┬───────────────────┬───────────────┬────┘
    │                   │               │
┌───▼──────────┐  ┌─────▼───────────┐  ┌▼──────────────┐
│  Chainlink   │  │  Smart Contracts│  │  MCP Server   │
│  CRE + ACE   │  │  CREVerifier    │  │  :3002        │
│  Functions   │  │  ACECompliance  │  │  15 Agent Tools│
│  Data Feeds  │  │  Marketplace    │  │  CCIP-ready   │
│  Confid HTTP │  │  PersonalEscrow │  │  JSON-RPC     │
└──────────────┘  │  LeadNFTv2      │  └───────────────┘
                  └─────────────────┘
```

**Stack:** React + Express + Prisma + Solidity + Chainlink (CRE + ACE + Functions + VRF + Data Feeds + Confidential HTTP + CRE Workflows)

---

## Slide 5: Chainlink Deep Dive

### CRE (Compute Runtime Environment)
- On-chain lead verification via `CREVerifier.sol`
- Quality scoring (0–10000): source credibility, data completeness, geo-demand
- ZK fraud detection with keccak256 commitment proofs

### ACE (Automated Compliance Engine)
- Auto-KYC with on-chain caching + 1-year expiry
- 17 cross-border state pairs with jurisdiction enforcement
- MiCA attestation for EU markets
- On-chain reputation system (0–10000)

### Data Feeds + Confidential HTTP + CRE Workflows
- **Data Feeds:** USDC/ETH price guard for PersonalEscrowVault deposit validation
- **Confidential HTTP:** TEE-based lead scoring with privacy-preserving buyer matching via CRE Confidential Compute
- **CRE Workflows:** `EvaluateBuyerRulesAndMatch` (7-gate DON evaluation) + `DecryptForWinner` (winner-only PII decryption with `encryptOutput: true`)
- Data Feeds live on-chain; Confidential HTTP and CRE Workflows production-ready with hybrid fallback

---

## Slide 6: Innovation Highlights

### 🤖 MCP Agent Server (Differentiator)
- JSON-RPC server for AI agents — search, bid, export programmatically
- LangChain integration example: autonomous solar bid agent
- **Signless abstraction:** agents use API keys, no wallet popups
- **CCIP-ready:** architecture for cross-chain bid forwarding
- Structured error codes + retry guidance for agent failures

### 🔒 Privacy-Preserving Auctions
- AES-256-GCM encrypted sealed bids
- Commit-reveal with `solidityPackedKeccak256`
- PII revealed only to winning bidder after settlement

### 🛡️ Off-Site Fraud Prevention
- Toggle-gated off-site leads with spoofing detection
- Toggle-flip exploit prevention + sanctioned country blocking
- Anomaly detection: flags accounts exceeding 80% off-site ratio

---

## Slide 7: Demo Highlights

1. **Landing page** — geo-enhanced hero with live stats across 20+ countries
2. **Mortgage lead** — seller submits $450K NY mortgage → CRE scores 7,850/10,000
3. **DECO + Data Feeds** — solar subsidy attestation + real-time bid floor $85–$220
4. **ACE auto-rules** — auto-bid: "FL mortgage, max $120, min quality 6,000"
5. **MCP agent** — AI places solar bid via JSON-RPC in 3 tool calls
6. **Encrypted bid** → commitment verified → NFT minted → USDC escrow settled
7. **CRM export** — "Push to CRM" button → CSV/JSON/webhook
8. **Testnet simulation** — 500+ on-chain txs, 10 HD wallets

---

## Slide 8: Traction & Testing

| Metric | Value |
|--------|-------|
| Verticals | 50+ (mortgage, solar, roofing, insurance, auto, home services, B2B SaaS, real estate, legal, financial, HVAC, and more) |
| Countries | 20+ (US, CA, GB, AU, DE, FR, BR, MX, AR, CL, IN, JP, KR, SG, ID, PH, AE, ZA, NG, KE) |
| Chainlink Services | 12 (CRE, ACE, Functions ×3, VRF, Data Feeds, Confidential HTTP, Confidential Compute, CRE Workflows ×2, ACE Policy Engine) |
| Security Sim | 29/29 tests passing (7 categories incl. off-site fraud, cross-border ACE) |
| Load Test | 23+ scenarios, 10K peak concurrent users (Artillery) |
| Testnet Sim | 500+ on-chain txs (mints, bids, escrows) via 10 HD wallets |
| Cypress E2E | 82 UI tests (seller, buyer, stress, copy assertions) |
| Smart Contracts | 8 (Base Sepolia, all source-verified on Basescan) |
| Mock Data | 200+ seeded entries across all verticals/geos |
| MCP Agent Tools | 15 (search, bid, bid-floor, export, preferences, auto-bid, CRM, ping, lead-status, vertical-fields, suggest-bid, bounty) |

---

## Slide 9: Market Opportunity

- **TAM:** $200B+ global lead generation market (Martal Group 2024)
- **Initial verticals:** Solar + mortgage (highest value: $15–150/lead)
- **Expansion:** Auto, insurance, real estate, B2B SaaS, legal, financial
- **Global reach:** 20+ countries from day one — US, EU, APAC, LATAM, Africa
- **Multi-chain:** Sepolia today → Base mainnet for low-cost production
- **Revenue:** 5% platform fee on every transaction via `PersonalEscrowVault.sol`
- **Moat:** Atomic escrow settlement + 10-gate auto-bid + MCP agent server + CCIP = no competitor has this stack

---

## Slide 10.5: Lead RTB Focus

The **core value proposition** is real-time lead bidding — not NFTs.

| Pillar | Detail |
|--------|--------|
| **RTB Engine** | Commit-reveal auction with auto-extend, 5-min to 24-hr durations, sealed bids |
| **Marketplace Search** | Keyword + vertical + geo + price filters, debounced UI, paginated API |
| **Analytics (Real-Time)** | API-first dashboards for sellers + buyers; mock fallback in dev, error banners in prod |
| **KYC Pipeline** | ACE-powered auto-KYC, status banners, "Verify Now" deep-links |
| **Data-Provider Ready** | API-key auth + webhook endpoints for 3rd-party data providers to submit leads |
| **Optional NFTs** | Vertical NFTs add provenance but can be disabled via `NFT_FEATURES_ENABLED=false` |
| **User Feedback** | Floating feedback widget for bug reports and feature requests |
| **Ad Conversion Tracking** | Campaign-level analytics with per-source revenue and conversion rates |

---

## Slide 10: Post-Hackathon Roadmap

| Phase | Timeline | Deliverable |
|-------|----------|-------------|
| Alpha | Q1 2026 | Closed beta with 5 solar sellers + 20 buyers |
| Beta | Q2 2026 | Public launch on Base mainnet, full KYC integration |
| Growth | Q3 2026 | Enterprise compliance API, MCP agent marketplace |
| Scale | Q4 2026 | CCIP cross-chain bidding live, 20+ verticals, APAC expansion |

---

## Slide 11: Why We Win

| Criteria | LeadRTB |
|----------|-------------|
| **Innovation** | 12 Chainlink service integrations + MCP agent server + CCIP-ready + atomic escrow settlement |
| **Technical depth** | 8 smart contracts (verified), ZK proofs, commit-reveal, TEE scoring, 7-gate auto-bid |
| **Completeness** | Full-stack: frontend, backend, contracts, agent server, sim scripts |
| **Traction** | 500+ testnet txs, 994 tests passing (40 suites), 10K concurrent users |
| **Market** | $200B+ TAM, 50+ verticals, 20+ countries, 5% revenue model |

---

## Slide 12: Links

| Resource | URL |
|---------|-----|
| **Repo** | https://github.com/bnmbnmai/lead-engine-cre |
| **Demo** | https://leadrtb.com |
| **API** | https://api.leadrtb.com |
| **Swagger** | https://api.leadrtb.com/api/swagger |
| **Video** | *(Recording before submission — check README for latest link)* |
| **Contracts** | [Basescan — All 8 Verified](https://sepolia.basescan.org/address/0x56bB31bE214C54ebeCA55cd86d86512b94310F8C) |
