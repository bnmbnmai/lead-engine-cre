# Pitch Deck — Lead Engine CRE

**Format:** 12 slides, 3-minute verbal walkthrough

---

## Slide 1: Title

**Lead Engine**
*Decentralized Real-Time Bidding for the $100B+ Lead Marketplace*

Built with Chainlink CRE + ACE + DECO + Data Streams + Confidential Compute
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

> $100B+ market with zero on-chain verification

---

## Slide 3: Solution

**Lead Engine = Chainlink-powered trust layer for lead trading**

| Problem | Solution |
|---------|----------|
| No trust | CRE Functions verify quality on-chain |
| No privacy | ZK proofs + encrypted commit-reveal bids + Confidential Compute |
| No compliance | ACE automates KYC + jurisdiction + MiCA enforcement |
| No transparency | NFT leads + USDC escrow with on-chain settlement |
| No global infra | 10 verticals × 15+ countries out of the box |
| No automation | MCP agent server for programmatic bidding + CRM exports |

---

## Slide 4: Architecture

```
┌──────────── Frontend (Vercel) ─────────────┐
│  React + wagmi + Tailwind · WalletConnect  │
└────────────────┬───────────────────────────┘
                 │
┌────────────────▼───────────────────────────┐
│  Backend (Render) ─ Express + Prisma + WS  │
│  RTB Engine · Privacy Suite · x402         │
│  DECO Stub · Data Streams · Confid Compute │
└───┬───────────────────┬───────────────┬────┘
    │                   │               │
┌───▼──────────┐  ┌─────▼───────────┐  ┌▼──────────────┐
│  Chainlink   │  │  Smart Contracts│  │  MCP Server   │
│  CRE + ACE   │  │  CREVerifier    │  │  :3002        │
│  DECO        │  │  ACECompliance  │  │  5 Agent Tools│
│  Data Streams│  │  LeadNFTv2      │  │  CCIP-ready   │
│  Confid Comp │  │  RTBEscrow      │  │  JSON-RPC     │
└──────────────┘  │  Marketplace    │  └───────────────┘
                  └─────────────────┘
```

**Stack:** React + Express + Prisma + Solidity + Chainlink (CRE + ACE + DECO + Data Streams + Confidential Compute)

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

### DECO + Data Streams + Confidential Compute
- **DECO:** Web data attestation without content disclosure (e.g., solar subsidy proof)
- **Data Streams:** Real-time bid floor pricing — 10 verticals × 5 countries
- **Confidential Compute:** TEE-based lead scoring with privacy-preserving buyer matching
- All three running as production-ready stubs with deterministic mocks and fallbacks

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

1. **Landing page** — geo-enhanced hero with live stats across 15+ countries
2. **Mortgage lead** — seller submits $450K NY mortgage → CRE scores 7,850/10,000
3. **DECO + Data Streams** — solar subsidy attestation + real-time bid floor $85–$220
4. **ACE auto-rules** — auto-bid: "FL mortgage, max $120, min quality 6,000"
5. **MCP agent** — AI places solar bid via JSON-RPC in 3 tool calls
6. **Encrypted bid** → commitment verified → NFT minted → USDC escrow settled
7. **CRM export** — "Push to CRM" button → CSV/JSON/webhook
8. **Testnet simulation** — 500+ on-chain txs, 10 HD wallets

---

## Slide 8: Traction & Testing

| Metric | Value |
|--------|-------|
| Verticals | 10 (mortgage, solar, roofing, insurance, auto, home services, B2B SaaS, real estate, legal, financial) |
| Countries | 15+ (US, CA, GB, AU, DE, FR, BR, MX, IN, JP, KR, SG, AE, ZA, NG) |
| Chainlink Services | 5 (CRE, ACE, DECO, Data Streams, Confidential Compute) |
| Security Sim | 29/29 tests passing (7 categories incl. off-site fraud, cross-border ACE) |
| Load Test | 13 scenarios, 1,500 peak concurrent users (Artillery) |
| Testnet Sim | 500+ on-chain txs (mints, bids, escrows) via 10 HD wallets |
| Cypress E2E | 38 UI tests (seller, buyer, off-site toggle, hybrid roles) |
| Smart Contracts | 5 (Sepolia + Base Sepolia) |
| Mock Data | 200+ seeded entries across all verticals/geos |
| MCP Agent Tools | 5 (search, bid, bid-floor, export, preferences) |

---

## Slide 9: Market Opportunity

- **TAM:** $100B+ global lead generation market
- **Initial verticals:** Solar + mortgage (highest value: $15–150/lead)
- **Expansion:** Auto, insurance, real estate, B2B SaaS, legal, financial
- **Global reach:** 15+ countries from day one — US, EU, APAC, LATAM, Africa
- **Multi-chain:** Sepolia today → Base mainnet for low-cost production
- **Revenue:** 2.5% platform fee on every transaction via `RTBEscrow.sol`
- **Moat:** MCP agent server + CCIP cross-chain bidding = programmatic scale no competitor has

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

| Criteria | Lead Engine |
|----------|-------------|
| **Innovation** | 5 Chainlink services + MCP agent server + CCIP-ready |
| **Technical depth** | 5 smart contracts, ZK proofs, commit-reveal, TEE scoring |
| **Completeness** | Full-stack: frontend, backend, contracts, agent server, sim scripts |
| **Traction** | 500+ testnet txs, 29 security tests, 1,500 concurrent users |
| **Market** | $100B TAM, 10 verticals, 15 countries, 2.5% revenue model |

---

## Slide 12: Links

| Resource | URL |
|---------|-----|
| **Repo** | https://github.com/bnmbnmai/lead-engine-cre |
| **Demo** | https://lead-engine-cre.vercel.app |
| **API** | https://lead-engine-cre-api.onrender.com |
| **Swagger** | https://lead-engine-cre-api.onrender.com/api/swagger |
| **Video** | *[Loom URL — record before submission]* |
| **Contracts** | *[Sepolia Etherscan — verify before submission]* |
