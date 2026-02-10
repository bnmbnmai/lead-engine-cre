# Pitch Deck — Lead Engine CRE

**Format:** 10 slides, 3-minute verbal walkthrough

---

## Slide 1: Title

**Lead Engine**
*Decentralized Real-Time Bidding for the $100B+ Lead Marketplace*

Built with Chainlink CRE + ACE | Chainlink Hackathon 2026 — Convergence

---

## Slide 2: Problem

**The lead marketplace is broken:**

- 🚫 **No Trust** — Buyers can't verify lead quality before purchase
- 🔓 **No Privacy** — PII exposed during bidding process
- ⚖️ **No Compliance** — Manual KYC/AML, no cross-border enforcement
- 💸 **No Transparency** — Opaque pricing, hidden fees, bid manipulation
- 🌍 **No Global Infrastructure** — No standard for cross-border lead trading

> $100B+ market with zero on-chain verification

---

## Slide 3: Solution

**Lead Engine = Chainlink-powered trust layer for lead trading**

| Problem | Solution |
|---------|----------|
| No trust | CRE Functions verify quality on-chain |
| No privacy | ZK proofs + encrypted commit-reveal bids |
| No compliance | ACE automates KYC + jurisdiction + MiCA enforcement |
| No transparency | NFT leads + USDC escrow with on-chain settlement |
| No global infra | 10 verticals × 15+ countries out of the box |

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
└────────┬───────────────────┬───────────────┘
         │                   │
┌────────▼────────┐  ┌──────▼──────────────┐
│  Chainlink      │  │  Smart Contracts    │
│  CRE Functions  │  │  CREVerifier        │
│  ACE Compliance │  │  ACECompliance      │
└─────────────────┘  │  LeadNFTv2          │
                     │  RTBEscrow           │
                     │  Marketplace         │
                     └─────────────────────┘
```

**Stack:** React + Express + Prisma + Solidity + Chainlink CRE + ACE

---

## Slide 5: Chainlink Deep Dive

### CRE (Compute Runtime Environment)
- On-chain lead verification via `CREVerifier.sol`
- Quality scoring (0–10000): source credibility, data completeness, geo-demand, vertical signals
- ZK fraud detection with `keccak256` commitment proofs
- Parameter matching without revealing PII

### ACE (Automated Compliance Engine)
- Auto-KYC with on-chain caching + 1-year expiry
- State-level jurisdiction policies (17 cross-border state pairs)
- MiCA attestation for EU markets
- On-chain reputation system (0–10000) updated per transaction

---

## Slide 6: Innovation Highlights

### Off-Site Fraud Prevention
- **Toggle-gated off-site leads** — sellers control acceptance per ask
- **Source spoofing detection** — validates PLATFORM claims against session data
- **Toggle-flip exploit prevention** — retroactive bid rejection
- **Sanctioned country blocking** — KP, IR, SY, CU auto-blocked
- **Anomaly detection** — flags accounts exceeding 80% off-site ratio

### Privacy-Preserving Auctions
- AES-256-GCM encrypted sealed bids
- Commit-reveal with `solidityPackedKeccak256` — tamper-proof
- PII revealed only to winning bidder after settlement

---

## Slide 7: Demo Highlights

*[Screenshots or embedded video clips]*

1. **Landing page** — "Decentralized Lead RTB / Global. Compliant. Private." with live stats
2. **Seller submits** solar lead from Germany → CRE scores 7200/10000
3. **ACE blocks** NY mortgage cross-border, allows DE→US solar
4. **Off-site toggle** — disable off-site leads, spoofing detected
5. **Buyer places** encrypted $35 bid → commitment verified on reveal
6. **NFT minted** → USDC escrow → automated settlement

---

## Slide 8: Traction & Testing

| Metric | Value |
|--------|-------|
| Verticals | 10 (mortgage, solar, roofing, insurance, auto, home services, B2B SaaS, real estate, legal, financial) |
| Countries | 15+ (US, CA, GB, AU, DE, FR, BR, MX, IN, JP, KR, SG, AE, ZA, NG) |
| Security Sim | 29/29 tests passing (7 categories incl. off-site fraud, cross-border ACE) |
| Load Test | 13 scenarios, 1500 peak concurrent users (Artillery) |
| Cypress E2E | 38 UI tests (seller flows, buyer flows, off-site toggle, hybrid roles) |
| Smart Contracts | 5 (Sepolia + Base Sepolia) |
| Mock Data | 200+ entries seeded via Faker.js across all verticals/geos |

---

## Slide 9: Market Opportunity

- **TAM:** $100B+ global lead generation market
- **Initial verticals:** Solar + mortgage (highest value per lead: $15–150)
- **Expansion:** Auto, insurance, real estate, B2B SaaS, legal, financial
- **Global reach:** 15+ countries from day one — US, EU, APAC, LATAM, Africa
- **Multi-chain:** Sepolia today → Base mainnet for low-cost production
- **Revenue:** 2.5% platform fee on every transaction via `RTBEscrow.sol`

---

## Slide 10: Post-Hackathon Roadmap

| Phase | Timeline | Deliverable |
|-------|----------|-------------|
| Alpha | Q1 2026 | Closed beta with 5 solar sellers + 20 buyers |
| Beta | Q2 2026 | Public launch on Base mainnet, full KYC integration |
| Growth | Q3 2026 | Enterprise compliance API, automated bidding agents |
| Scale | Q4 2026 | International expansion (UK, EU, APAC), 20+ verticals |

---

## Slide 11: Links

| Resource | URL |
|---------|-----|
| **Repo** | github.com/bnmbnmai/lead-engine-cre |
| **Demo** | *[Vercel URL]* |
| **API** | *[Render URL]* |
| **Swagger** | *[Render URL]/api/swagger* |
| **Contracts** | *[Sepolia Etherscan links]* |
