# LeadRTB — Roadmap

**Tokenized, Privacy-First, AI-Driven Lead Marketplace on Chainlink CRE**

Current version: **v1.0.2 (6 March 2026)** — Production-ready prototype on Base Sepolia with 12 Chainlink service integrations, CRE quality scoring, autonomous AI agent (Kimi K2.5 + LangChain + official chainlink-agent-skills), atomic USDC settlement via PersonalEscrowVault, Proof-of-Reserves automation, granular bounty pools, winner-only PII decryption (real encrypted data for hosted lander/API leads), unified CRE lead processing pipeline, production bounty targeting workflow, streamlined Demo Control Panel, vault orphaned lock recovery, Admin Overview Dashboard with real-time CRE status, and comprehensive endpoint audit (~95 endpoints across 17 route files).

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
- [x] **Autonomous Agents Track (Moltbook)** — **COMPLETED 2026-03-01**
  - ✅ Integrated official `smartcontractkit/chainlink-agent-skills/cre-skills` into `.agents/skills/`
  - ✅ Registered 3 CRE tools (`get_cre_score`, `trigger_cre_evaluation`, `get_cre_workflow_status`) in MCP server (15 total tools)
  - ✅ Backend `/api/v1/cre/*` routes created
  - Agent registration on Moltbook pending (quick step before submission)
- [x] **Video & Docs** — 5-minute YouTube demo + full README overhaul — **COMPLETED 2026-03-04**
  - [Watch the Demo Video](https://youtu.be/0J2GWDbXsFs)
  - Video-first README with benefit-driven opening, slim Chainlink table, judge-friendly structure
- _Deprioritized for March 8 submission (moved to post-hackathon Phase B):_
  - ~~Data Streams quick win~~ — Requires additional infrastructure; deferred.

**Expected outcome**: Strong positioning across multiple tracks, including potential recognition in the overall Top 10.

### Immediate Pre-Submission Polish — ✅ COMPLETED 2026-03-01
- [x] **Seed Demo Bounties Button** — One-click button in Demo Control Panel to pre-populate bounty pools — **COMPLETED 2026-02-28**
- [x] **Admin Panel Discoverability** — Quick Switch link + auto-redirect after Demo Admin login — **COMPLETED 2026-02-28**
- [x] **Persona-Mismatch UX** — Smart persona switching on guard pages — **COMPLETED 2026-02-28**
- [x] **Demo Control Panel Streamlining** — Clean, judge-ready layout with 6 sections — **COMPLETED 2026-03-01**
- [x] **CRE Scoring Consistency** — All demo leads use `verifyLead()` for consistent 75–95 scores + encrypted PII — **COMPLETED 2026-03-01**
- [x] **Final Documentation Sync** — All docs updated to 12 services, Base Sepolia addresses, correct demo URL — **COMPLETED 2026-03-01**
- [x] **Archive Cleanup** — Audit/investigation files moved to `docs/archive/` — **COMPLETED 2026-03-01**
- [x] **Official Agent Skills Integration** — `chainlink-agent-skills/cre-skills` + MCP tool registration — **COMPLETED 2026-03-01**
- [x] **Admin Overview Dashboard** — `/admin` landing page with marketplace stats, system health, 12 Chainlink services with real-time CRE-Native Mode status, PersonalEscrowVault, deployed contracts, recent demo runs — **COMPLETED 2026-03-01**
- [x] **Admin Navigation Cleanup** — Sidebar reordered to Overview → Form Builder → Verticals; NFT Admin removed; all redirects updated — **COMPLETED 2026-03-01**
- [x] **Admin Dashboard CRE Status Fix** — CRE-Native Mode now reads from canonical `creNativeDemoMode` config key (same as DemoPanel toggle) — **COMPLETED 2026-03-01**
- [x] **Comprehensive Endpoint Audit** — Documented all ~95 endpoints across 17 route files in `endpoint_audit.md`; fixed CRE config key mismatch (root cause of stale status) — **COMPLETED 2026-03-01**
- [x] **Backend Build Fix** — Resolved TS2554 errors in `cre.routes.ts` for successful Render deployment — **COMPLETED 2026-03-01**

### Final Fixes — ✅ COMPLETED 2026-03-04
- [x] **Documentation polish & YouTube video integration** — README overhaul (video-first hero, benefit-driven opening, slim Chainlink table), CONTRACTS.md cleanup, FINAL_VERIFICATION_LOG.md sync — **COMPLETED 2026-03-04**
- [x] **Unified CRE lead processing pipeline** — `afterLeadCreated()` fires unconditionally on all lead paths (API, webhook, demo, drip). Every lead goes through CRE quality scoring regardless of entry point — **COMPLETED 2026-03-04** (commit `918aae6`)
- [x] **Real PII decryption for hosted lander/API leads** — `POST /leads/:leadId/decrypt-pii` now decrypts actual `lead.encryptedData` via `privacyService.decryptLeadPII()`. Falls back to synthetic PII only for demo-drip leads — **COMPLETED 2026-03-04** (commit `0f640d7`)
- [x] **NFT Basescan token links** — Fixed env var mismatch (`VITE_LEAD_NFT_ADDRESS` → `VITE_LEAD_NFT_ADDRESS_SEPOLIA`); removed zero-address fallback — **COMPLETED 2026-03-04** (commit `729abf1`)
- [x] **Real Chainlink Automation** — Upkeep (ID `21294876…55922`, 10 LINK, Active) registered on PersonalEscrowVaultUpkeep for 24h PoR checks and expired-lock refunds. Backend detects upkeep and reduces off-chain cron to 30-min safety net. No performUpkeep actions triggered yet on testnet (expected) — **COMPLETED 2026-03-04**
- [x] **Unified LeadNFTv2 minting for all winners** — `resolveAuction()` in `auction-closure.service.ts` now calls `mintLeadNFT()` + `recordSaleOnChain()` + CRE dispatch after vault settlement, ensuring every winner (demo or manual hosted-lander) receives a real NFT. Portfolio UI links to LeadNFTv2 contract on Basescan — **COMPLETED 2026-03-06**

---

### Post-Hackathon Roadmap — Production & Institutional Expansion

**Near-Term Phase A: Real-World Lead Ingestion (Weeks 1–4 post-submission)**
- Mock → production endpoints for traffic platforms (Google Ads, Facebook Lead Ads, TikTok Lead Gen).
- Programmatic media buying integration (The Trade Desk / DV360) to auto-purchase lead inventory based on real-time CRE quality scores and auction pricing.
- Budget pacing and spend caps via Chainlink Data Feeds.

**Post-Hackathon Priority: Shared Evaluator Module**
- Extract the deterministic 7-gate evaluation logic into `shared-evaluator.ts`, imported by both the local fallback in `auto-bid.service.ts` and the CRE workflow `EvaluateBuyerRulesAndMatch`. This eliminates logic drift risk and ensures 100% equivalence between the local pre-auction quality score and the DON workflow output. _Rationale: With the unified CRE pipeline now live (commit `918aae6`), both paths converge on the same `afterLeadCreated()` hook — a shared evaluator module is the next logical step to guarantee deterministic parity._

**Near-Term Phase B: Permanent PII & Buyer Experience (Weeks 5–8)** ⬅️ _Next high-priority feature post-submission_
- 🔥 **Permanent PII Unlock** toggle in Buyer Portfolio: after first winner-only decrypt, store decrypted PII in buyer-specific encrypted vault (CRE enclave protected). _Status: Winner-only PII decryption is **live and verified** (commit `0f640d7`) — real encrypted PII decrypted via `privacyService.decryptLeadPII()` for hosted lander/API leads, synthetic PII fallback for demo-drip only. Persistent buyer vault toggle UI remains post-hackathon._
- **Bulk PII Unlock** — multi-select purchased leads and decrypt all in one action, reducing friction for high-volume buyers.
- Improved Auto-Bid Preferences UI: visual rule builder, drag-and-drop priority, live matching preview (real-time sample leads from CRE simulation).
- _Moved from Phase 0:_ **Data Streams dynamic bounties** — Add real-time stream (mortgage rates or weather) that triggers Automation → CRE workflow → dynamic bounty adjustment.
- _Moved from Phase 2:_ **DisputeResolution CRE workflow** — buyer disputes → Confidential HTTP to CRM → auto-refund.

**Near-Term Phase C: Enterprise & Scale (Months 3–6)**
- White-label verticals: one-click marketplace rebranding for insurers, banks, or lead aggregators.
- Secondary NFT market for lead resale with 2% royalties. _Note: ERC-2981 royalty standard is on-chain in LeadNFTv2; secondary marketplace UI not yet built._
- Fractional ownership via ERC-3643 compliance. _Note: No ERC-3643 code exists yet — roadmap only._
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
The current architecture is designed for demo and early-production traffic. Scaling to 10,000+ leads per day across 50+ verticals requires the following infrastructure changes (status annotated per March 2026 audit):

**Cursor-Based Pagination & Read Replicas.** _(Planned)_ Replace offset-based pagination with cursor-based pagination on `(createdAt, id)` composite indexes. Introduce a PostgreSQL read replica behind PgBouncer for all marketplace list queries (`GET /leads`, `/asks`, `/buyNow`) to keep write latency unaffected by read load.

**Distributed Bid Scheduling.** _(Implemented)_ Auction resolution and bid-queue management transitioned to a distributed **BullMQ** job queue backed by **Redis** (February 2026). BullMQ workers operate independently of the API process, enabling horizontal scaling without data loss. Falls back to in-memory `setInterval` when `REDIS_URL` is not set. See `backend/src/lib/queues.ts`.

**Persistent Lead Lock Registry.** _(Partially implemented)_ BullMQ queues and optional Redis caching are in place, but the core `leadLockRegistry` in `demo-orchestrator.ts` remains an in-memory `Map`. Full migration to a Redis-backed persistent store with TTL = auction end time is pending.

**Event-Driven Settlement.** _(Partially implemented)_ `BidLocked` events are parsed for post-hoc log scanning (`vault.service.ts`, `demo-orchestrator.ts`, `unlock-vault.ts`). However, real-time contract event listeners feeding a BullMQ queue are not yet wired — settlement still uses polling via `resolveExpiredAuctions()` on a 2-second BullMQ repeatable job.

**Async Job Queue.** _(Partially implemented)_ BullMQ is used for auction resolution only (`queues.ts`). Lead ingestion, CRE scoring, NFT minting, escrow settlement, and bounty matching still run synchronously in request handlers. Dead-letter queues and per-vertical concurrency limits are not yet implemented.

**Batch Minting, Bid Batching & Gas Management.** _(Partially implemented)_ Nonce management exists via `getNextNonce()` in `demo-shared.ts` (single-wallet serialization queue). Multicall batch aggregation and hot wallet pool (5–10 wallets) are not yet implemented.

**WebSocket Sharding.** _(Planned)_ Add Redis adapter (`@socket.io/redis-adapter`) and per-vertical rooms for 1,000–5,000+ concurrent connections with ≤50ms p95 latency.

**Rate Limiting & Ingestion Throttling.** _(Planned)_ Deploy Redis-backed sliding-window rate limiting (`rate-limiter-flexible`) with per-seller, per-vertical caps. Basic in-code bid spam prevention exists via `checkActivityThreshold` in `socket.ts`.

**Observability & Alerting.** _(Planned)_ Add correlation IDs across flows. Track key metrics (auction-close latency, CRE round-trip, settlement queue depth) via Prometheus. Alert on fill-rate drops >10%, CRE failures, or queue lag >30s.

---

## Phase 2: Institutional Expansion & Privacy Moat (Q3–Q4 2026)

**Privacy-first RWA data marketplace** (core asymmetric advantage)
- Full winner-only threshold decryption using Confidential Compute.
- Revocable encryption keys for GDPR “right to be forgotten”.
- Reusable KYC/AML proof integration for institutional buyers (reducing onboarding friction for regulated verticals).
- Private treasury & OTC settlement flows (institutional buyers value this).

**CRE workflow expansion**
- Move 80% of backend logic into CRE (gas savings 60–80%, institutional-grade auditability).
- ~~`DisputeResolution` workflow~~ — _Moved to Near-Term Phase B for March 8 submission window._

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
- ✅ **Expanded Admin Dashboard** — system health monitoring, 12 Chainlink service statuses with real-time CRE-Native Mode, marketplace stats, PersonalEscrowVault status, deployed contracts table, and recent demo runs. **COMPLETED 2026-03-01**
- ✅ **API Endpoint Audit** — documented all ~95 endpoints across 17 route files; eliminated config key mismatch causing stale CRE status. See `docs/archive/endpoint_audit.md`. **COMPLETED 2026-03-01**
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
| ✅ Done  | Confidential Compute winner decryption | CRE + Confidential HTTP       | Low      | Institutional buyer confidence      |
| ✅ Done  | CRE `EvaluateBuyerRules` workflow    | CRE Workflow DON               | Low      | Core matching infrastructure        |
| ✅ Done  | Official `cre-skills` integration    | chainlink-agent-skills         | Very Low | Autonomous agent capabilities       |
| ⚡ Partial | Permanent PII Unlock               | CRE + Confidential Compute     | Medium   | Buyer retention — decryption live, vault toggle pending |
| ✅ Done  | Unified CRE lead processing          | CRE Workflow DON               | Low      | All lead paths use same pipeline    |
| ✅ Done  | Real PII decryption (hosted lander)  | Privacy / Confidential         | Low      | Correct E2E decrypt for real leads  |
| Deferred | Data Streams dynamic bounties        | Streams + Automation           | Low      | Liveness & wow factor               |
| Medium   | CCIP cross-chain + private tx        | CCIP Private                   | Medium   | Multi-chain RWA                     |
| ✅ Done  | Expanded admin dashboard             | —                              | Medium   | Operational visibility              |
| Medium   | Prediction market on conversion      | Functions + Streams            | Medium   | New asset class                     |
| Low      | Sybil resistance layer                | Identity verification          | Low      | Fraud prevention at scale           |

---

## Risk Management
- Privacy and regulatory compliance are addressed through client-side AES-256-GCM encryption, enclave-only compute, and ACE policy enforcement.
- Oracle dependencies incorporate multi-DON verification and structured dispute periods.
- Agent operations are supported by on-chain attestation and logging.

---

**We are not building another lead marketplace.**  
We are building the **Chainlink-native, privacy-first protocol for the entire sensitive data economy**.  

LeadRTB is production-ready infrastructure for the tokenized sensitive data economy, with a clear path from hackathon prototype to institutional-grade marketplace.

---

*Last updated: 6 March 2026 (unified LeadNFTv2 minting for all winners, documentation polish, YouTube video integration, unified CRE pipeline, real PII decryption, NFT token link fix)*