# Pitch Deck — Lead Engine CRE

**Format:** 8-10 slides, 3-minute verbal walkthrough

---

## Slide 1: Title

**Lead Engine**
*Decentralized Real-Time Bidding for the $100B+ Lead Marketplace*

Built with Chainlink CRE + ACE | Chainlink Hackathon 2026

---

## Slide 2: Problem

**The lead marketplace is broken:**

- 🚫 **No Trust** — Buyers can't verify lead quality before purchase
- 🔓 **No Privacy** — PII exposed during bidding process
- ⚖️ **No Compliance** — Manual KYC/AML, no cross-border enforcement
- 💸 **No Transparency** — Opaque pricing, hidden fees, bid manipulation

> $100B+ market with zero on-chain verification

---

## Slide 3: Solution

**Lead Engine = Chainlink-powered trust layer for lead trading**

| Problem | Solution |
|---------|----------|
| No trust | CRE Functions verify quality on-chain |
| No privacy | ZK proofs + encrypted commit-reveal bids |
| No compliance | ACE automates KYC + jurisdiction enforcement |
| No transparency | NFT leads + USDC escrow with on-chain settlement |

---

## Slide 4: Architecture

*[Insert architecture mermaid diagram from README]*

**Stack:** React + Express + Prisma + Solidity + Chainlink CRE + ACE

---

## Slide 5: Chainlink Deep Dive

### CRE (Custom Functions)
- On-chain lead verification via `CREVerifier.sol`
- Quality scoring (0-10000) combining source, data, geo, vertical signals
- ZK fraud detection with `keccak256` commitment proofs

### ACE (Automated Compliance)
- Auto-KYC with on-chain caching + 1-year expiry
- State-level jurisdiction policies (17 cross-border state pairs)
- On-chain reputation system (0-10000) updated per transaction

---

## Slide 6: Demo Highlights

*[Screenshots or embedded video clips]*

1. Seller submits solar lead in FL → CRE scores 7200/10000
2. ACE blocks NY mortgage cross-border, allows FL→CA solar
3. Buyer places encrypted $35 bid → commitment verified on reveal
4. NFT minted → USDC escrow → settlement

---

## Slide 7: Traction & Testing

| Metric | Value |
|--------|-------|
| Test Coverage | 123 tests, 9 suites |
| Compliance Scenarios | 50+ (17 state pairs, 8 reputation values) |
| Load Capacity | 1000+ concurrent users, p99 < 2s |
| Smart Contracts | 6 (Sepolia + Base Sepolia) |
| Verticals | 6 (mortgage, solar, insurance, roofing, home services, B2B SaaS) |

---

## Slide 8: Market Opportunity

- **TAM:** $100B+ global lead generation market
- **Initial verticals:** Solar + mortgage (highest value per lead: $15-150)
- **Expansion:** Insurance, roofing, home services, B2B SaaS, auto, legal
- **Multi-chain:** Sepolia today → Base mainnet for low-cost production
- **Revenue:** 2.5% platform fee on every transaction via `RTBEscrow.sol`

---

## Slide 9: Post-Hackathon Roadmap

| Phase | Timeline | Deliverable |
|-------|----------|-------------|
| Alpha | Q1 2026 | Closed beta with 5 solar sellers + 20 buyers |
| Beta | Q2 2026 | Public launch on Base mainnet, full KYC integration |
| Growth | Q3 2026 | 3 additional verticals, API for programmatic bidding agents |
| Scale | Q4 2026 | International markets (UK, EU), enterprise compliance API |

---

## Slide 10: Links

| Resource | URL |
|---------|-----|
| **Repo** | github.com/bnmbnmai/lead-engine-cre |
| **Demo** | *[Vercel URL]* |
| **API** | *[Render URL]* |
| **Contracts** | *[Sepolia Etherscan links]* |
