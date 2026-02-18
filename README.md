# Lead Engine CRE: Decentralized Real-Time Bidding for the $200B+ Lead Marketplace with Deep Chainlink Integration

[![CI](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml/badge.svg)](https://github.com/bnmbnmai/lead-engine-cre/actions/workflows/test.yml)
![Tests](https://img.shields.io/badge/tests-1288%20passing-brightgreen)
![Chainlink CRE](https://img.shields.io/badge/Chainlink-CRE-brightgreen)
![Chainlink ACE](https://img.shields.io/badge/Chainlink-ACE-blue)
![Chainlink Functions](https://img.shields.io/badge/Chainlink-Functions-purple)
![RTBEscrow](https://img.shields.io/badge/RTBEscrow-USDC%20Settlement-orange)

> **Built for Chainlink Convergence Hackathon 2026 · Mandatory CRE + ACE Track**

Lead Engine is the first **tokenized, real-time bidding marketplace for verified leads** — powered by seven **Chainlink** services. Sellers submit leads, **Chainlink CRE** scores them cryptographically, **ACE** clears compliance, and buyers compete in sealed-bid auctions settled instantly in USDC. Every purchased lead is minted as an **ERC-721 LeadNFT** with immutable quality proof, resale rights, and royalties.

| Chainlink Service | Role | Status |
|---|---|---|
| **CRE** | On-chain quality scoring (0–10,000) with ZK fraud proofs | Implemented |
| **ACE** | Auto-KYC, jurisdiction policy enforcement, reputation gating | Implemented |
| **Functions** | Bounty criteria matching triggered at auction close | Implemented |
| **VRF v2.5** | Provably fair tiebreaker for auction bids + bounty allocation | Implemented |
| **Data Feeds** | Real-time ETH/USD → dynamic bid floor prices per vertical | Implemented |
| **DECO** | zkTLS verification of off-site lead provenance | Stubbed for hackathon, full integration post-event |
| **Confidential HTTP** | Off-chain fraud signal aggregation in a TEE | Stubbed for hackathon, full integration post-event |

**Hackathon Focus:** CRE + ACE are fully integrated. Functions, VRF, and Data Feeds are functional with production contracts. DECO and Confidential HTTP are architecturally integrated as stubs ready for mainnet.

---

## Key Differentiators

- **PII never touches the blockchain** — non-PII previews only; full data revealed after escrow release
- **Sealed-bid commit-reveal auctions** — keccak256 commitments prevent front-running
- **Instant USDC settlement** — client-side RTBEscrow signing, zero chargebacks
- **LeadNFT provenance** — every lead = ERC-721 with quality proof and royalties
- **Buyer-Funded Bounties** — standing USDC pools per vertical with criteria (geo, QS, credit, age); 2x stacking cap; auto-release to sellers on match; refundable anytime
- **Unified Marketplace** — all open leads visible to sellers and buyers with real-time WebSocket streaming
- **MCP LangChain Agents** — 12-tool JSON-RPC server for autonomous bidding, monitoring, and portfolio management
- **CRO Lander System** — hosted lead capture forms with trust badges, social proof, auto-format validation, and A/B toggles
- **My Funnels Redesign** — horizontal gallery with per-funnel metrics, search, pinning, and mobile-first cards
- **Field-Level Filtering** — buyers filter and auto-bid on granular attributes (credit ranges, ZIP codes, roof condition, system size)
- **50+ Dynamic Verticals** — admin-created instantly, auto-synced to seller templates, no code changes

---

## Fraud Prevention

Traditional platforms lose billions to bots. Lead Engine stops them at the smart-contract level:

| Fraud Type | How It Works Today | How Lead Engine Stops It |
|---|---|---|
| **Click Fraud** | Bots fake ad clicks, submit junk forms | CRE + ZK fraud proofs reject or zero-score invalid leads |
| **Form Stuffing** | Bots auto-fill thousands of fake submissions | `CREVerifier.sol` enforces rules (credit, geo, TCPA) via ZK proof |
| **Lead Farming / Sybil** | One seller recycles leads across wallets | ACE auto-KYC + wallet reputation (0–10,000) + NFT royalty deterrence |
| **Recycled Leads** | Same lead resold 50 times | Every purchase mints a unique ERC-721 with immutable ownership |
| **Bounty Gaming** | Fabricating leads to drain bounty pools | Bounties release only after CRE scoring + auction completion + criteria match; 2x cap prevents over-incentivization |

---

## Lead Engine vs. Legacy

| Dimension | Legacy Marketplaces | Lead Engine |
|---|---|---|
| **Speed** | 7–30 day payouts | Instant USDC via on-chain escrow |
| **Trust** | Limited verification | CRE quality score (0–10,000) + ZK proofs |
| **Privacy** | Full PII on submit | Non-PII previews; full data only after purchase |
| **Compliance** | Manual reviews | ACE auto-KYC and jurisdiction policy engine |
| **Automation** | Basic rules | Field-level auto-bid + LangChain autonomous agents |
| **Provenance** | No audit trail | ERC-721 LeadNFT with full on-chain history |
| **Incentives** | Fixed pricing | Buyer Bounties — per-vertical pools with criteria-based auto-release |

---

## How a Lead Moves Through the System

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
    CRE-->>API: Score (0-10,000) + proof
    API->>ACE: KYC and jurisdiction check
    ACE-->>API: Cleared

    Note over RTB: 60-second sealed-bid auction

    RTB->>B: Non-PII preview (WebSocket)
    B->>RTB: Sealed bid (keccak256 commitment)

    Note over RTB: Auction closes, reveal phase

    B->>RTB: Reveal (amount + salt)
    RTB->>RTB: Verify commitments, pick winner

    B->>X: Winner pays USDC
    X->>S: Instant settlement (minus 2.5%)
    X->>B: Decrypted PII + mint LeadNFT

    API->>FN: matchBounties(lead, criteria)
    FN-->>API: Matching pools found
    BP->>S: Bounty bonus auto-released
```

### Service Integration Points

```mermaid
flowchart TB
    subgraph Seller["Seller Flow"]
        S1["Submit Lead"] --> S2["CRE Quality Score"]
        S2 --> S3["Mint LeadNFT"]
        S3 --> S4["Open Auction"]
    end

    subgraph Chainlink["Chainlink Services"]
        CRE["CRE Verifier<br/>Quality 0-10,000"]
        ACE["ACE Compliance<br/>KYC + Jurisdiction"]
        DF["Data Feeds<br/>ETH/USD Floor Price"]
        VRF["VRF v2.5<br/>Provably Fair Tiebreak"]
        FN["Functions<br/>Bounty Matching"]
    end

    subgraph Buyer["Buyer Flow"]
        B1["Connect Wallet"] --> B2["ACE KYC Check"]
        B2 --> B3["Place Sealed Bid"]
        B3 --> B4["Win Auction"]
        B4 --> B5["Fund Escrow via USDC"]
        B5 --> B6["Receive Decrypted PII"]
    end

    subgraph Settlement["On-Chain Settlement"]
        ESC["RTBEscrow.sol<br/>USDC Escrow"]
        NFT["LeadNFTv2.sol<br/>ERC-721 Provenance"]
    end

    S2 -.->|"zkProof + score"| CRE
    B2 -.->|"verifyKYC + canTransact"| ACE
    S4 -.->|"dynamic floor price"| DF
    B3 -.->|"tied bids"| VRF
    B4 -.->|"criteria match"| FN
    B5 -->|"approve + createAndFundEscrow"| ESC
    ESC -->|"instant USDC settlement"| S1
    B4 -->|"recordSale"| NFT
```

---

## Pricing and Fees

| Purchase Channel | Platform Fee | Convenience Fee | Bounty Cut | Total |
|---|---|---|---|---|
| Manual (browser bid / Buy It Now) | 2.5% | — | — | 2.5% |
| Auto-bid engine | 2.5% | $1.00 | — | 2.5% + $1 |
| API / MCP agent | 2.5% | $1.00 | — | 2.5% + $1 |
| Buyer Bounty release | — | — | 1% | 1% of bounty amount |

The $1 convenience fee covers gas and platform costs for server-side (non-MetaMask) purchases. The 1% bounty cut is taken when bounty funds are released to a seller.

---

## Chainlink Integration — Deep Dive

### CRE — Custom Runtime Environment

*Implemented.* On-chain lead quality scoring is the backbone of Lead Engine. Every lead is scored by `CREVerifier.sol` using ZK fraud proofs evaluated off-chain via **CRE** and posted on-chain.

- **Scoring dimensions:** TCPA consent freshness, geo verification, parameter completeness, encryption validity, source trust
- **Output:** Quality score (0–10,000), stored immutably on the LeadNFT
- **Contract:** `CREVerifier.sol` (deployed on Base Sepolia)

### ACE — Automated Compliance Engine

*Implemented.* Identity and jurisdiction gating for every wallet that touches the marketplace.

- **Wallet-level auto-KYC** with 1-year expiry + in-memory caching
- **Jurisdiction policy engine** per vertical — mortgage/insurance restricted by state, solar/roofing unrestricted
- **Reputation scoring** (0–10,000) with decay and boost mechanics
- **Contract:** `ACECompliance.sol` (deployed on Base Sepolia)

### Chainlink Functions — Off-Chain Bounty Matching

*Implemented.* `BountyMatcher.sol` runs bounty-criteria matching off-chain in the Chainlink DON and stores the verified result on-chain:

- Backend sends lead attributes + pool criteria → DON executes AND-logic matching (quality score, geo state/country, credit score, lead age)
- DON returns comma-separated matched pool IDs → contract splits and stores in `MatchResult`
- `VerticalBountyPool.releaseBounty()` can optionally gate releases behind `BountyMatcher.isMatchVerified()` (toggled via `setRequireFunctionsAttestation`)
- **Gas:** ~130k total (80k request + 50k callback) — all criteria evaluation runs off-chain
- Falls back to in-memory matching when Functions is disabled (`BOUNTY_FUNCTIONS_ENABLED=false`)
- **DON secrets** refreshed every 48h via GitHub Actions


### VRF v2.5 — Provably Fair Tie-Breaking

*Implemented.* **`VRFTieBreaker.sol`** requests Chainlink VRF v2.5 randomness when two or more parties are tied:

- **Auction ties** — when 2+ bidders submit identical highest effective bids, VRF selects the winner: `candidates[randomWord % count]`
- **Bounty allocation** — when 2+ bounty pools match a lead with equal amounts, VRF determines priority ordering
- Winner selection is auditable on-chain via the `TieResolved` event (includes `randomWord`, `winner`, `leadIdHash`)
- Graceful fallback: if VRF is unavailable or subscription unfunded, the backend uses deterministic ordering (earliest bid / existing sort)

### Data Feeds — Dynamic Bid Floor Pricing

*Implemented.* The ETH/USD Chainlink Price Feed on Base Sepolia (`0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1`) drives dynamic, market-responsive floor prices across the platform:

- **On-chain read:** `AggregatorV3Interface.latestRoundData()` returns ETH/USD with 8 decimals
- **Market multiplier:** Compares current price to a $2,500 baseline; clamped to ±20% deviation. Bullish markets raise floors, bearish markets lower them
- **Per-vertical base tables:** 10 verticals × 5 countries (US/CA/GB/DE/AU) with calibrated floor/ceiling pairs (e.g. solar US = $85/$200)
- **Auto-bid integration:** The auto-bid engine reads the floor and adjusts bids upward to `max(autoBidAmount, floor)`, capped by `maxBidPerLead`
- **MCP agent tools:** `get_bid_floor` and `suggest_bid_amount` let the LangChain agent query real-time floors and recommend quality-weighted bid amounts
- **Frontend:** `useFloorPrice` hook auto-refreshes every 60s; LeadCard shows a "Floor $XX" badge; AuctionPage shows a dedicated Market Floor stat card
- **Caching:** 60s in-memory TTL to avoid RPC spam; stale fallback when chain reads fail
- **Service:** `datastreams.service.ts` — Data Feeds integration (15 unit tests covering floor calc, multiplier clamping, fallback, multi-vertical)

### DECO — zkTLS Verification

*Stubbed for hackathon, full integration post-event.*

**DECO** will verify off-site lead provenance via zkTLS attestations — proving a lead was captured from a real landing page without revealing the page content. Architecture wired, awaiting DECO mainnet availability.

### Confidential HTTP

*Stubbed for hackathon, full integration post-event.*

**Confidential HTTP** will aggregate fraud signals from third-party APIs (phone validation, email reputation, IP geolocation) inside a TEE — enabling fraud checks on encrypted PII without exposing it to any party.

### Data Producer — Giving Back to the Ecosystem

Lead Engine publishes anonymized market metrics as a **public custom data feed** via `CustomLeadFeed.sol`: average quality score, volume settled, leads tokenized, fill rate. Other dApps can consume these on-chain.

---

## Trust and Provenance Layer

| Layer | Technology | Function |
|---|---|---|
| **Lead Quality** | CRE + CREVerifier.sol | Cryptographic quality scoring + ZK fraud rejection |
| **Identity** | ACE + ACECompliance.sol | Auto-KYC, jurisdiction gating, reputation |
| **Economic Deterrence** | LeadNFTv2.sol | Immutable ownership history + royalties on resale |
| **Settlement** | RTBEscrow.sol | Atomic USDC escrow, instant payout, zero chargebacks |
| **Bounty Incentives** | VerticalBountyPool.sol | Per-vertical USDC pools, criteria matching, auto-release |
| **Privacy** | AES-256-GCM + commit-reveal | PII encrypted at rest, sealed bids prevent front-running |

---

## Features

### Core Marketplace

- Real-time 60-second sealed-bid auctions with WebSocket streaming
- Non-PII previews with per-vertical field redaction
- Every lead minted as `LeadNFTv2.sol` (ERC-721)
- Auto-bid engine with field-level rules (vertical, geo, quality, budget, roof condition, system size)
- Buy It Now for unsold leads
- CRM webhooks (HubSpot, Zapier, custom)

### Buyer-Funded Bounties

Standing USDC pools per vertical with criteria-based auto-release:

| Criteria | Example |
|---|---|
| Geo (state/country) | CA, TX only |
| Min Quality Score | 7,000+ / 10,000 |
| Min Credit Score | 720+ |
| Max Lead Age | 24 hours or less |

Multiple buyers stack bounties on the same vertical (capped at 2x lead price). Matching pools auto-release to sellers as a bonus. Unmatched funds refundable anytime. On-chain via `VerticalBountyPool.sol`.

### MCP LangChain Agents

12-tool JSON-RPC server (port 3002) with a full **LangChain ReAct** autonomous bidding agent:

- `list_verticals`, `search_leads`, `get_lead`, `place_bid`, `get_my_bids`, `get_my_leads`
- `get_market_stats`, `set_autobid_rules`, `get_autobid_rules`
- `deposit_bounty`, `withdraw_bounty`, `get_bounty_info`

Buyers can run (or write their own) agents that watch the live non-PII stream and bid autonomously.

### CRO Lander System

Hosted lead capture forms with conversion optimization:

- **Social proof** — live lead count, recent activity feed
- **Auto-format validation** — phone, email, ZIP auto-correction on input
- **A/B toggles** — sellers enable/disable CRO features per funnel

### My Funnels Redesign

Horizontal gallery view with per-funnel conversion metrics, search and filtering across all funnels, pin favorites for quick access, and mobile-first responsive cards.

### Dynamic Verticals

50+ seeded verticals across solar, mortgage, roofing, insurance, home services, B2B SaaS, real estate, auto, legal, and financial services. New verticals are created instantly in the admin dashboard and auto-synced to seller templates, field schemas, and marketplace filters with zero code changes.

---

## Smart Contracts (10 deployed on Base Sepolia)

| Contract | Description |
|---|---|
| `CREVerifier.sol` | Quality scoring + ZK fraud proofs |
| `ACECompliance.sol` | KYC, jurisdiction, reputation |
| `RTBEscrow.sol` | Atomic USDC escrow settlement |
| `LeadNFTv2.sol` | ERC-721 tokenized leads |
| `BountyMatcher.sol` | Chainlink Functions bounty criteria matching |
| `VerticalBountyPool.sol` | Buyer-funded bounty pools |
| `CustomLeadFeed.sol` | Public market metrics feed |
| `VerticalNFT.sol` | Community vertical ownership |
| `VerticalAuction.sol` | Ascending auctions for verticals |
| `VRFTieBreaker.sol` | Chainlink VRF v2.5 provably fair tie-breaking |

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/bnmbnmai/lead-engine-cre.git
cd lead-engine-cre
npm install

# 2. Start everything (dev mode)
npm run dev
```

- **Frontend:** http://localhost:3000
- **Backend:** http://localhost:3001
- **MCP Agent:** http://localhost:3002

Hardhat node + contracts already deployed locally. Full configuration in `.env.example`.

### DON Secrets Renewal

**Chainlink Functions** DON secrets expire every 48 hours. Renewal is automated via GitHub Actions (`.github/workflows/renew-don-secrets.yml`, runs every 48h) or can be done manually:

```bash
cd contracts && npx ts-node scripts/upload-don-secrets.ts
```

---

## Hackathon Demo Flow (2 minutes)

1. **Buyer deposits bounty** — $75 pool on `solar.residential` with criteria: CA only, QS 7,000+
2. **Seller submits lead** — CRE scores (8,200/10,000) + ACE clears KYC
3. **Auction opens** — buyers (or LangChain agent) receive non-PII preview via WebSocket
4. **Sealed bids submitted** — keccak256 commitments prevent front-running
5. **Auction closes** — winner pays USDC via RTBEscrow, lead minted as LeadNFT
6. **Bounty auto-matches** — seller receives $75 bonus on top of winning bid

**Live demo:** https://lead-engine-cre-frontend.vercel.app
**Repo:** https://github.com/bnmbnmai/lead-engine-cre

---

## Post-Hackathon Roadmap

| Priority | Item | Current State |
|---|---|---|
| High | DECO zkTLS attestations for off-site lead provenance | Stubbed, full integration planned |
| High | Confidential HTTP for encrypted fraud signal aggregation | Stubbed, full integration planned |
| Medium | Secondary market for LeadNFT and VerticalNFT trading | Contracts ready |
| Medium | Cross-chain settlement (Arbitrum, Optimism, Polygon) | Architecture planned |
| Ready | VerticalNFT revenue-share flow (2% royalties) | Contracts deployed |
| Ready | Multi-language CRO landers | Frontend ready |

See `ROADMAP.md` for high-volume scaling considerations and enterprise features (target: 10k+ leads/day).


See `docs/MAINNET_MIGRATION.md` for the full migration plan.
