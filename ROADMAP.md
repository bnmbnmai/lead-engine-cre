# Lead Engine CRE — Roadmap

**Tokenized, Privacy-First, AI-Driven Lead Marketplace on Chainlink CRE**

Current version: **v0.9.6 (28 February 2026)** — Full end-to-end prototype on Base Sepolia with CRE quality scoring, autonomous AI agent (Kimi K2.5 + LangChain), atomic USDC settlement via PersonalEscrowVault, Proof-of-Reserves automation, granular bounty pools, winner-only PII decryption, production bounty targeting workflow, auto-bid preferences UI, and vault orphaned lock recovery.

## Vision
Build the **institutional-grade infrastructure layer for private data RWAs** — turning high-value, sensitive leads (solar, roofing, HVAC, mortgage, insurance, health/KYC) into verifiable, tradable, privacy-preserving tokens with autonomous matching and derivatives.

---

## Phase 0: Hackathon Submission (Leveraging the Extended Deadline)

**Goal**: Submit one codebase eligible for **Privacy, CRE & AI, DeFi & Tokenization, and Autonomous Agents tracks simultaneously**.

### Priority Deliverables
- [x] **Privacy Track deep-dive** (new $16k track)
  - ✅ Winner-only PII decryption via `DecryptForWinner` CRE workflow (`encryptOutput: true`) — **COMPLETED 2026-02-27**
  - Confidential HTTP in CRE workflow for seller CRM enrichment (already built)
  - Sealed-bid auction commit-reveal privacy documented in README
- [x] **CRE Workflow mandatory upgrade** (required for every track)
  - Production CRE workflow: `EvaluateBuyerRulesAndMatch` — runs buyer vertical/geo/budget rules inside Confidential HTTP, outputs match score + queue placement. Uses `@chainlink/cre-sdk ^1.0.9` with `CronCapability`, `ConfidentialHTTPClient`, `consensusIdenticalAggregation`. Full 7-gate deterministic evaluation ported from `auto-bid.service.ts`.
  - `cre workflow simulate` command documented in README. Backend integration via `triggerBuyerRulesWorkflow()` in `cre.service.ts`.
  - ✅ **COMPLETED 2026-02-26** — See `cre-workflows/EvaluateBuyerRulesAndMatch/`
- [x] **System-wide CRE consistency** — `afterLeadCreated()` hook fires on ALL lead entry paths (API, webhook, demo, drip) — **COMPLETED 2026-02-27**
- [x] **Buyer persona experience** — Portfolio visibility (demo fallback in `GET /bids/my`), decrypted PII with CRE DON Attested badge, honest quality tooltips — **COMPLETED 2026-02-27**
- [x] **Granular vertical field bounties visibility** — Real API-backed BountyPanel in Buyer Dashboard with deposit/withdraw/criteria matching — **COMPLETED 2026-02-27**
- [ ] **Autonomous Agents Track (Moltbook)**
  - Integrate official `chainlink-agent-skills/cre-skills` into MCP agents (5-minute change).
  - Agents now explicitly call CRE workflow generation and runtime ops.
  - Register agent → have the agent post the project in m/chainlink-official by the deadline.
- [ ] **Data Streams quick win** (Data Feeds already exist)
  - Add one real-time stream (e.g., mortgage rates or weather for roofing) that triggers Automation → CRE workflow → dynamic bounty adjustment.
- [ ] **Video & Docs** (3–5 min public Loom)
  - Dedicated segment on the extended CRE-native architecture.
  - Include all required README links to Chainlink files.

**Expected outcome**: Strong positioning across multiple tracks, including potential recognition in the overall Top 10.

### Immediate Pre-Submission Polish
- [ ] **Demo Flow Phase Order Audit & Fix** — Ensure recycle → fund → banner sequencing is correct; defer "Demo Complete" banner until recycling finishes.
- [ ] **Final Documentation Sync** — Update `submission-checklist.md` and `final-submission-certification.md` with latest service count (12), feature additions, and fresh demo run data.
- [ ] **Seed Demo Bounties Button** — Add one-click button in Demo Control Panel to pre-populate bounty pools for hackathon judges, so the Seller Dashboard "Active Buyer Bounties" card is populated without manual API calls.

---

### Post-Hackathon Roadmap — Production & Institutional Expansion

**Near-Term Phase A: Real-World Lead Ingestion (Weeks 1–4 post-submission)**
- Mock → production endpoints for traffic platforms (Google Ads, Facebook Lead Ads, TikTok Lead Gen).
- Programmatic media buying integration (The Trade Desk / DV360) to auto-purchase lead inventory based on real-time CRE quality scores and auction pricing.
- Budget pacing and spend caps via Chainlink Data Feeds.

**Near-Term Phase B: Permanent PII & Buyer Experience (Weeks 5–8)**
- "Permanent Unlock" toggle in Buyer Portfolio: after first winner-only decrypt, store decrypted PII in buyer-specific encrypted vault (CRE enclave protected).
- **Bulk PII Unlock** — multi-select purchased leads and decrypt all in one action, reducing friction for high-volume buyers.
- Improved Auto-Bid Preferences UI: visual rule builder, drag-and-drop priority, live matching preview (real-time sample leads from CRE simulation).
- **Marketplace Bounty Boost Badges** — leads matching active bounty criteria display a "💰 Bounty Boost" badge on marketplace cards, signaling higher payout potential to sellers and increasing fill rates.

**Near-Term Phase C: Enterprise & Scale (Months 3–6)**
- White-label verticals: one-click marketplace rebranding for insurers, banks, or lead aggregators.
- Secondary NFT market for lead resale with 2% royalties.
- Fractional ownership via ERC-3643 compliance.
- Cross-chain settlement via CCIP for multi-chain USDC.

**Technical Foundations Already in Place:**
All current features (CRE workflow, ACE KYC, PersonalEscrowVault PoR, VRF tiebreakers, pure persona-wallet architecture) are production-grade and can be extended without breaking changes.

---

## Phase 1: Post-Hackathon MVP (Q2 2026 — 3 months)

**Target**: First paying customers (solar installers + mortgage brokers) on Base mainnet.

- Migrate to Base mainnet + Arbitrum via CCIP (atomic cross-chain lead settlement).
- Production security audit (already budgeted).
- Real lead ingestion webhook (Functions + Confidential HTTP from Google/FB Ads or seller CRM).
- Secondary marketplace for LeadNFTs (2% royalties, fractional ERC-3643 bundles).
- Agent staking & performance fees (AgentNFT ERC-721 + USDC in PersonalEscrowVault).
- Enterprise white-label (deploy private CRE workflows for large buyers).

**Key Chainlink integrations**:
- Full CRE orchestration (bidding rules, bounty matching, dispute resolution).
- Automation + Data Streams loop for real-time repricing.
- ACE policies extended to health/KYC verticals.

### High-Volume Scaling Considerations
The current architecture is designed for demo and early-production traffic. Scaling to 10,000+ leads per day across 50+ verticals requires the following infrastructure changes (several already implemented):

**Cursor-Based Pagination & Read Replicas.** Replace offset-based pagination with cursor-based pagination on `(createdAt, id)` composite indexes. Introduce a PostgreSQL read replica behind PgBouncer for all marketplace list queries (`GET /leads`, `/asks`, `/buyNow`) to keep write latency unaffected by read load.

**Distributed Bid Scheduling.** Auction resolution and bid-queue management transitioned to a distributed **BullMQ** job queue backed by **Redis** (completed February 2026). BullMQ workers operate independently of the API process, enabling horizontal scaling without data loss.

**Persistent Lead Lock Registry.** Migrated from in-memory `Map` to a **Redis-backed persistent store** with TTL = auction end time (completed February 2026). Supports tens of thousands of concurrent leads.

**Event-Driven Settlement.** Replace polling with contract event listeners (`BidLocked`, `AuctionClosed`) feeding a BullMQ queue. Each event enqueues exactly one settlement job.

**Async Job Queue.** Convert lead ingestion, CRE scoring, NFT minting, escrow settlement, and bounty matching into independent BullMQ workers with retry logic, dead-letter queues, and per-vertical concurrency limits.

**Batch Minting, Bid Batching & Gas Management.** Aggregate mints and `lockForBid` calls into multicall batches of 20–50. Use a nonce-managed hot wallet pool (5–10 wallets) and EIP-1559 dynamic gas escalation for 1–3+ TPS sustained throughput.

**WebSocket Sharding.** Add Redis adapter (`@socket.io/redis-adapter`) and per-vertical rooms for 1,000–5,000+ concurrent connections with ≤50ms p95 latency.

**Rate Limiting & Ingestion Throttling.** Deploy Redis-backed sliding-window rate limiting (`rate-limiter-flexible`) with per-seller, per-vertical caps (default 500 leads/day/vertical).

**Observability & Alerting.** Add correlation IDs across flows. Track key metrics (auction-close latency, CRE round-trip, settlement queue depth) via Prometheus. Alert on fill-rate drops >10%, CRE failures, or queue lag >30s.

---

## Phase 2: Institutional Expansion & Privacy Moat (Q3–Q4 2026)

**Privacy-first RWA data marketplace** (core asymmetric advantage)
- Full winner-only threshold decryption using Confidential Compute.
- Revocable encryption keys for GDPR “right to be forgotten”.
- GLEIF vLEI + World ID integration for reusable KYC/AML proofs (bonus special track eligibility).
- Private treasury & OTC settlement flows (institutional buyers value this).

**CRE workflow expansion**
- Move 80% of backend logic into CRE (gas savings 60–80%, institutional-grade auditability).
- `DisputeResolution` workflow (buyer disputes → Confidential HTTP to CRM → auto-refund).

**Enterprise Features**
- **Enterprise Branded Verticals.** White-label verticals with custom branding, dedicated lead pools, priority CRE scoring, and isolated auction rooms. VerticalNFT owners configure branded landing pages, custom form fields, and exclusive buyer access lists. Revenue-share royalties (2%) flow automatically.
- **Automatic Lead Requalification.** Unsold leads automatically re-listed when a matching autobid appears; SMS confirmation sent to original lead for re-engagement and instant sale.
- **Dispute & Arbitration Flow.** Oracle-backed (or DAO) review of CRE score, seller reputation, and response data; escrow held until full/partial refund or dismissal.
- **Analytics Dashboard.** Per-vertical and per-NFT tracking of fill rates, average sale price, buyer ROI, CRE score distribution, and time-to-close metrics. Exportable reports for sellers and buyers.
- **Fiat On-Ramp for Non-Crypto Buyers.** Stripe/Circle integration for credit-card or bank-transfer USDC purchases with custodial onboarding (no MetaMask required).
- **Ad Platform Integration.** One-time configuration for Google Ads, Facebook Lead Ads, etc.; captured leads auto-ingested, CRE-scored, and auctioned in real time.
- **Granular Vertical Field Bounty Hunting.** Buyers post field-specific bounties (e.g., “ZIP 90210 + excellent credit”); system auto-matches at ingestion and attaches rewards to auctions.

- **Monetization**
- 5% platform fee on settlements.
- Premium CRE workflow licensing for enterprises.
- Data subscription bundles (encrypted lead cohorts).

**Infrastructure & Observability**
- **Expanded Admin Dashboard** — system health monitoring, audit logs, wallet balance overview, demo run history, and real-time CRE workflow status. Consolidates operational visibility for platform operators.
- **Comprehensive Test Suite** — unit tests for all services (ace, cre, vrf, vault, auction), integration tests for critical flows (demo run, settlement, PII decryption), frontend component tests, and E2E tests with Playwright. Target 80% coverage.

---

## Phase 3: Ecosystem & Derivatives (2027+)

- **Prediction Markets crossover** — buyers create onchain markets on lead conversion rates, resolved via Data Streams + Functions + Automation.
- **Lead derivatives & options** (strike price tied to conversion prediction markets).
- **Agent-owned economy** — agents earn fees, can be delegated or traded.
- **Multi-chain expansion** via CCIP Private Transactions (privacy preserved across chains).
- **Enterprise ERP/CRM push** — settled leads land directly in Salesforce/HubSpot via Confidential HTTP.
- **Agent Chat Enhancements** — voice-of-buyer and voice-of-seller personas in the AI chat widget, enabling natural-language negotiation and real-time deal commentary.

**Long-term TAM impact**
- Capture 0.5–1% of the $14.5B+ lead-gen services market ($50–150M ARR opportunity).
- Become the **de-facto standard for tokenized sensitive data** (health, finance, insurance verticals).

---

## Technical Priorities Across Phases

| Priority | Feature                              | Chainlink Services             | Effort   | Impact                              |
|----------|--------------------------------------|--------------------------------|----------|-------------------------------------|
| High     | Confidential Compute winner decryption | CRE + Confidential HTTP       | Low      | Privacy Track + institutions        |
| High     | CRE `EvaluateBuyerRules` workflow    | CRE Workflow DON               | Low      | Mandatory for all tracks            |
| High     | Official `cre-skills` integration    | chainlink-agent-skills         | Very Low | Autonomous Agents Track             |
| Medium   | Data Streams dynamic bounties        | Streams + Automation           | Low      | Liveness & wow factor               |
| Medium   | CCIP cross-chain + private tx        | CCIP Private                   | Medium   | Multi-chain RWA                     |
| Medium   | Expanded admin dashboard             | —                              | Medium   | Operational visibility              |
| Medium   | Marketplace bounty boost badges      | Functions                      | Low      | Seller engagement + fill rates      |
| Medium   | Prediction market on conversion      | Functions + Streams            | Medium   | New asset class                     |
| Low      | World ID sybil resistance            | World ID + CRE                 | Low      | Special track bonus                 |

---

## Risk Management
- Privacy and regulatory compliance are addressed through client-side AES-256-GCM encryption, enclave-only compute, and ACE policy enforcement.
- Oracle dependencies incorporate multi-DON verification and structured dispute periods.
- Agent operations are supported by on-chain attestation and logging.

---

**We are not building another lead marketplace.**  
We are building the **Chainlink-native, privacy-first protocol for the entire sensitive data economy**.  

With the extended deadline and the new Privacy + Agents tracks, Lead Engine CRE is positioned for competitive success in the hackathon and as foundational infrastructure thereafter.

---

*Last updated: 28 February 2026*