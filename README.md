# Lead Engine CRE: Decentralized Real-Time Bidding for the $200B+ Lead Marketplace with Deep Chainlink Integration

[![CI](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml/badge.svg)](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml)
![Tests](https://img.shields.io/badge/tests-1288%20passing-brightgreen)
![Chainlink CRE](https://img.shields.io/badge/Chainlink-CRE-brightgreen)
![Chainlink ACE](https://img.shields.io/badge/Chainlink-ACE-blue)
![Chainlink Functions](https://img.shields.io/badge/Chainlink-Functions-purple)
![RTBEscrow](https://img.shields.io/badge/RTBEscrow-USDC%20Settlement-orange)

> **Built for [Chainlink Convergence Hackathon 2026](https://chain.link) · Mandatory CRE + ACE Track**

Lead Engine is the first **tokenized, real-time bidding marketplace for verified leads** — powered by seven Chainlink services. Sellers submit leads, Chainlink CRE scores them cryptographically, ACE clears compliance, and buyers compete in sealed-bid auctions settled instantly in USDC. Every purchased lead is minted as an **ERC-721 LeadNFT** with immutable quality proof, resale rights, and royalties.

- **CRE** — on-chain quality scoring (0–10,000) with ZK fraud proofs
- **ACE** — auto-KYC, jurisdiction policy enforcement, reputation gating
- **Chainlink Functions** — bounty criteria matching triggered at auction close
- **VRF** — cryptographic tiebreaker when multiple bids share the highest amount
- **Data Streams** — real-time bidding floor prices per vertical
- **DECO** — zkTLS verification of off-site lead provenance *(stubbed for hackathon, full integration post-event)*
- **Confidential HTTP** — off-chain fraud signal aggregation *(stubbed for hackathon, full integration post-event)*

**🎯 Hackathon Focus:** CRE + ACE are fully integrated and battle-tested. Functions, VRF, and Data Streams are functional with production contracts. DECO and Confidential HTTP are architecturally integrated as stubs ready for mainnet.

---

## 🏅 Key Differentiators

- **PII never touches the blockchain** — non-PII previews only; full data revealed after escrow release
- **Sealed-bid commit-reveal auctions** — keccak256 commitments prevent front-running
- **Instant USDC settlement** — client-side RTBEscrow signing, zero chargebacks
- **LeadNFT provenance** — every lead = ERC-721 with quality proof + royalties
- **Buyer-Funded Bounties** — standing USDC pools per vertical with criteria (geo, QS, credit, age). 2× stacking cap. Multiple buyers stack. Auto-release to sellers on match. Refundable anytime.
- **Unified Marketplace** — all open leads visible to sellers and buyers with real-time WebSocket streaming
- **MCP LangChain Agents** — 12-tool JSON-RPC server (port 3002) for autonomous bidding, monitoring, and portfolio management
- **CRO Lander System** — hosted lead capture forms with trust badges, social proof, auto-format validation, and A/B toggles
- **My Funnels Redesign** — horizontal gallery with per-funnel metrics, search, pinning, and mobile-first cards
- **Field-Level Filtering** — buyers filter and auto-bid on granular attributes (credit ranges, ZIP codes, roof condition, system size)
- **50+ Dynamic Verticals** — admin-created instantly, auto-synced to seller templates, no code changes

---

## 🛡️ Battle-Tested Against Click, Lead & Form Fraud

| Fraud Type | How It Works Today | How Lead Engine Stops It |
|---|---|---|
| **Click Fraud** | Bots fake ad clicks → junk forms | CRE + ZK fraud proofs reject or zero-score invalid leads |
| **Form Stuffing** | Bots auto-fill thousands of fakes | `CREVerifier.sol` enforces rules (credit, geo, TCPA) via ZK proof |
| **Lead Farming / Sybil** | One seller recycling leads across wallets | ACE auto-KYC + wallet reputation (0–10,000) + NFT royalty deterrence |
| **Recycled Leads** | Same lead resold 50× | Every purchase mints a unique ERC-721 with immutable ownership history |
| **Bounty Gaming** | Fabricating leads to drain bounty pools | Bounties only release after CRE scoring + auction completion + criteria match. 2× cap prevents over-incentivization |

---

## 🎯 Lead Engine vs. Legacy

| Dimension | Legacy Marketplaces | Lead Engine |
|---|---|---|
| **Speed** | 7–30 day payouts | Instant USDC via on-chain escrow |
| **Trust** | Limited verification | CRE quality score (0–10,000) + ZK proofs |
| **Privacy** | Full PII on submit | Non-PII previews → full data after purchase |
| **Compliance** | Manual reviews | ACE auto-KYC & jurisdiction policy engine |
| **Automation** | Basic rules | Field-level auto-bid + LangChain autonomous agents |
| **Provenance** | No audit trail | ERC-721 LeadNFT with full on-chain history |
| **Incentives** | Fixed pricing | Buyer Bounties — per-vertical pools with criteria-based auto-release |

---

## 🔄 How a Lead Moves Through the System

```mermaid
sequenceDiagram
    participant BP as 💰 Buyer Bounty Pool
    participant S as 🟢 Seller
    participant API as ⚡ Lead Engine API
    participant CRE as 🔗 Chainlink CRE
    participant ACE as 🔵 Chainlink ACE
    participant FN as ⚙️ Chainlink Functions
    participant RTB as 🟪 RTB Engine
    participant B as 👤 Buyer
    participant X as 🟩 RTBEscrow

    Note over BP: Buyer funds pool ($75, solar, CA, credit>720)

    S->>API: Submit lead (non-PII preview)
    API->>CRE: Quality score + ZK fraud check
    CRE-->>API: Score (0–10,000) + proof
    API->>ACE: KYC & jurisdiction check
    ACE-->>API: ✅ Cleared

    Note over RTB: 60-second sealed-bid auction

    RTB->>B: Non-PII preview (WebSocket)
    B->>RTB: Sealed bid (keccak256 commitment)

    Note over RTB: Auction closes → reveal phase

    B->>RTB: Reveal (amount + salt)
    RTB->>RTB: Verify commitments, pick winner

    B->>X: Winner pays USDC
    X->>S: Instant settlement (minus 2.5%)
    X->>B: Decrypted PII + mint LeadNFT

    API->>FN: matchBounties(lead, criteria)
    FN-->>API: Matching pools found
    BP->>S: 🎁 Bounty bonus auto-released
```

---

## 💰 Pricing & Fees

| Purchase Channel | Platform Fee | Convenience Fee | Bounty Cut | Total |
|---|---|---|---|---|
| Manual (browser bid / Buy It Now) | 2.5% | — | — | 2.5% |
| Auto-bid engine | 2.5% | $1.00 | — | 2.5% + $1 |
| API / MCP agent | 2.5% | $1.00 | — | 2.5% + $1 |
| Buyer Bounty release | — | — | 1% | 1% of bounty amount |

The $1 convenience fee covers gas and platform costs for server-side (non-MetaMask) purchases. The 1% bounty cut is taken when bounty funds are released to a seller.

---

## 🔗 Chainlink Integration — Deep Dive

### CRE — Custom Runtime Environment ✅ Implemented

On-chain lead quality scoring is the backbone of Lead Engine. Every lead submitted to the platform is scored by `CREVerifier.sol` using ZK fraud proofs evaluated off-chain via CRE and posted on-chain.

- **Scoring dimensions:** TCPA consent freshness, geo verification, parameter completeness, encryption validity, source trust
- **Output:** Quality score (0–10,000), stored immutably on the LeadNFT
- **Contract:** `CREVerifier.sol` (deployed on Base Sepolia)

### ACE — Automated Compliance Engine ✅ Implemented

Identity and jurisdiction gating for every wallet that touches the marketplace.

- **Wallet-level auto-KYC** with 1-year expiry + in-memory caching
- **Jurisdiction policy engine** per vertical — mortgage/insurance restricted by state, solar/roofing unrestricted
- **Reputation scoring** (0–10,000) with decay and boost mechanics
- **Contract:** `ACECompliance.sol` (deployed on Base Sepolia)

### Chainlink Functions ✅ Implemented

Bounty criteria matching runs through Chainlink Functions at auction resolution:

- `matchBounties()` evaluates lead attributes against all active pool criteria
- Triggered automatically when an auction closes with a winner
- Matching pools release funds to the seller as a bonus
- **DON secrets** refreshed every 48h via GitHub Actions

### VRF — Verifiable Random Function ✅ Implemented

When two or more bids tie at the same highest amount, VRF provides a provably fair, cryptographically random tiebreaker. No coin flips — just math.

### Data Streams ✅ Implemented

Real-time bidding floor prices per vertical, used by the auto-bid engine to set competitive reserve minimums. Published as a custom data feed.

### DECO — zkTLS Verification ⚠️ Stubbed

*Stubbed for hackathon, full integration post-event.*

DECO will verify off-site lead provenance via zkTLS attestations — proving a lead was captured from a real landing page without revealing the page content. Architecture wired, awaiting DECO mainnet availability.

### Confidential HTTP ⚠️ Stubbed

*Stubbed for hackathon, full integration post-event.*

Confidential HTTP will aggregate fraud signals from third-party APIs (phone validation, email reputation, IP geolocation) inside a TEE — enabling fraud checks on encrypted PII without exposing it to any party.

### Data Producer — Giving Back to the Ecosystem

Lead Engine publishes anonymized market metrics as a **public custom data feed** via `CustomLeadFeed.sol`: average quality score, volume settled, leads tokenized, fill rate. Other dApps can consume these on-chain.

---

## 🔐 Trust & Provenance Layer

| Layer | Technology | What It Does |
|---|---|---|
| **Lead Quality** | CRE + CREVerifier.sol | Cryptographic quality scoring + ZK fraud rejection |
| **Identity** | ACE + ACECompliance.sol | Auto-KYC, jurisdiction gating, reputation |
| **Economic Deterrence** | LeadNFTv2.sol | Immutable ownership history + royalties on resale |
| **Settlement** | RTBEscrow.sol | Atomic USDC escrow → instant payout, zero chargebacks |
| **Bounty Incentives** | VerticalBountyPool.sol | Per-vertical USDC pools, criteria matching, auto-release |
| **Privacy** | AES-256-GCM + commit-reveal | PII encrypted at rest, sealed bids prevent front-running |

---

## ⚡ Features

### Core Marketplace

- Real-time 60-second sealed-bid auctions with WebSocket streaming
- Non-PII previews with per-vertical field redaction
- Every lead minted as `LeadNFTv2.sol` (ERC-721)
- Auto-bid engine with field-level rules (vertical, geo, quality, budget, roof condition, system size, etc.)
- Buy It Now for unsold leads
- CRM webhooks (HubSpot, Zapier, custom)

### Buyer-Funded Bounties

Standing USDC pools per vertical with criteria-based auto-release:

| Criteria | Example |
|---|---|
| Geo (state/country) | CA, TX only |
| Min Quality Score | ≥7,000/10,000 |
| Min Credit Score | ≥720 |
| Max Lead Age | ≤24 hours |

Multiple buyers stack bounties on the same vertical (capped at 2× lead price). Matching pools auto-release to sellers as a bonus. Unmatched funds refundable anytime. On-chain via `VerticalBountyPool.sol`.

### MCP LangChain Agents

**12-tool JSON-RPC server** (port 3002) with a full LangChain ReAct autonomous bidding agent:

- `list_verticals`, `search_leads`, `get_lead`, `place_bid`, `get_my_bids`, `get_my_leads`
- `get_market_stats`, `set_autobid_rules`, `get_autobid_rules`
- `deposit_bounty`, `withdraw_bounty`, `get_bounty_info`

Buyers can run (or write their own) agents that watch the live non-PII stream and bid autonomously.

### CRO Lander System

Hosted lead capture forms with conversion optimization built in:

- **Trust badges** — Chainlink verification seal, on-chain quality guarantee
- **Social proof** — live lead count, recent activity feed
- **Auto-format validation** — phone, email, ZIP auto-correction on input
- **A/B toggles** — sellers enable/disable CRO features per funnel

### My Funnels Redesign

Horizontal gallery view with:
- Per-funnel conversion metrics and lead counts
- Search and filtering across all funnels
- Pin favorites for quick access
- Mobile-first responsive cards

### Dynamic Verticals

50+ seeded verticals across solar, mortgage, roofing, insurance, home services, B2B SaaS, real estate, auto, legal, and financial services. New verticals created instantly in the admin dashboard — auto-synced to seller templates, field schemas, and marketplace filters with zero code changes.

---

## 📜 Smart Contracts (10 deployed on Base Sepolia)

| Contract | Description | Status |
|---|---|---|
| `CREVerifier.sol` | Quality scoring + ZK fraud proofs | ✅ Deployed |
| `ACECompliance.sol` | KYC, jurisdiction, reputation | ✅ Deployed |
| `RTBEscrow.sol` | Atomic USDC escrow settlement | ✅ Deployed |
| `LeadNFTv2.sol` | ERC-721 tokenized leads | ✅ Deployed |
| `VerticalBountyPool.sol` | Buyer-funded bounty pools | ✅ Deployed |
| `CustomLeadFeed.sol` | Public market metrics feed | ✅ Deployed |
| `VerticalNFT.sol` | Community vertical ownership | ✅ Deployed |
| `VerticalAuction.sol` | Ascending auctions for verticals | ✅ Deployed |

---

## 🚀 Quick Start

```bash
# 1. Clone & install
git clone https://github.com/bnmbnmai/lead-engine-cre.git
cd lead-engine-cre
npm install

# 2. Start everything (dev mode)
npm run dev
```

- **Frontend:** http://localhost:3000
- **Backend:** http://localhost:3001
- **MCP Agent:** http://localhost:3002

Hardhat node + contracts already deployed locally.
Full configuration in `.env.example` and deployment instructions in `DEPLOY.md`.

### 🔑 DON Secrets Renewal

Chainlink Functions DON secrets expire every 72 hours. Renewal is automated via GitHub Actions (`.github/workflows/renew-don-secrets.yml`, runs every 48h) or can be done manually:

```bash
cd contracts && npx ts-node scripts/upload-don-secrets.ts
```

---

## 🏆 Hackathon Demo Flow (2 minutes)

1. **Buyer deposits bounty** → $75 pool on `solar.residential` with criteria: CA only, QS ≥7,000
2. **Seller submits lead** → CRE scores (8,200/10,000) + ACE clears KYC
3. **Auction opens** → buyers (or LangChain agent) receive non-PII preview via WebSocket
4. **Sealed bids submitted** → keccak256 commitments prevent front-running
5. **Auction closes** → winner pays USDC via RTBEscrow → lead minted as LeadNFT
6. **Bounty auto-matches** → seller receives $75 bonus on top of winning bid 🎁

**Live demo:** https://lead-engine-cre-frontend.vercel.app
**Repo:** https://github.com/bnmbnmai/lead-engine-cre

---

## 🗺️ Post-Hackathon Roadmap

| Priority | Item | Status |
|---|---|---|
| 🔴 | DECO zkTLS attestations for off-site lead provenance | Stubbed → full integration |
| 🔴 | Confidential HTTP for encrypted fraud signal aggregation | Stubbed → full integration |
| 🟡 | Secondary market for LeadNFT and VerticalNFT trading | Contracts ready |
| 🟡 | Cross-chain settlement (Arbitrum, Optimism, Polygon) | Architecture planned |
| 🟢 | VerticalNFT revenue-share flow (2% royalties) | Contracts deployed |
| 🟢 | Multi-language CRO landers | Frontend ready |

See `ROADMAP.md` for the full breakdown.
