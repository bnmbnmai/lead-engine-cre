# Loom Demo Video Script — Lead Engine CRE

> **Target: 4:30** | Record on [loom.com](https://www.loom.com) | Share unlisted link
> **Pacing note:** Speak at ~140 wpm (slower than conversational). Pause 1–2s on screen transitions. Global audiences need time to read UI text — hold each screen 3–5s before narrating.

---

## Pre-Recording Setup

1. Open browser tabs:
   - `https://lead-engine-cre.vercel.app` (frontend)
   - `https://lead-engine-cre-api.onrender.com/api/swagger` (Swagger)
   - `https://sepolia.etherscan.io/address/0xB93A1Ff499BdEaf74710F760Eb2B6bc5b62f8546` (LeadNFT)
2. Connect MetaMask (Sepolia) with test wallet
3. Terminal with `mcp-server` running on port 3002
4. Second terminal ready for `npx cypress run --headless` (optional live demo)

---

## Scene Breakdown (4:30)

### 🎬 0:00–0:20 — Hook (20s)

> *"The $200 billion lead generation market runs on trust — but has none. Lead Engine CRE fixes that with Chainlink, creating the first decentralized real-time bidding platform for leads. Let me show you."*

**Screen:** Homepage hero → hold 3s on "Decentralized Lead Intelligence" headline + stats bar.
**Pacing:** Slow, confident. Let the hero speak for itself.

---

### 🎬 0:20–1:00 — Seller Flow × 10 Verticals (40s)

> *"Start with the seller. A solar installer in Boise submits a lead. Watch the form — it adapts to each of our 10 verticals."*

**Action:** Click "Become a Seller" → Select vertical dropdown → **quickly cycle through 3 verticals** (Solar → Mortgage → Insurance) to show field changes → Submit solar lead.

> *"Behind the scenes: Chainlink CRE scores the lead, ACE verifies compliance — TCPA for the US, GDPR for Europe — and the lead mints as an NFT on Base with a privacy-preserving hash. Three services, one click."*

**Screen:** Show CRE quality badge → ACE check → NFT minted toast. Hold each for 2s.

---

### 🎬 1:00–1:40 — Multi-Wallet Auction (40s)

> *"Now the auction. I'll switch wallets to show the full buyer experience."*

**Action:** Disconnect seller wallet → Connect buyer wallet (different MetaMask account) → Buyer Preferences page.

> *"This buyer sets auto-bid rules: solar leads, Idaho, quality 70+, max $80. Our 9-criteria engine runs in under 200ms — budget, geo, vertical, time-of-day weighting, all checked. The sealed bid commits on-chain using commit-reveal."*

**Screen:** Auto-bid config → bid fires → sealed commitment toast.
**Key moment:** The wallet switch must be visible — judge should see two distinct addresses.

---

### 🎬 1:40–2:10 — Settlement + Reinvestment Loop (30s)

> *"Bids reveal. Winner takes the lead. Now the x402 moment —"*

**Action:** Show auction resolution → Escrow created → Released on Etherscan.

> *"USDC settles in 4 seconds. Not 30 days. The seller reinvests that cash into their next Google Ads campaign before their competitor even knows the lead was sold. That's the reinvestment loop that traditional lead gen can't match."*

**Screen:** Hold on Etherscan tx with EscrowCreated → EscrowReleased events (2s each).

---

### 🎬 2:10–2:40 — CRM + MCP Agent (30s)

> *"Won leads push to HubSpot, Salesforce, or any webhook — one click. But for power users..."*

**Action:** Quick CRM push → switch to terminal.

> *"...our MCP agent server exposes 8 tools. AI agents search leads, set auto-bid rules, and configure CRM webhooks — all via JSON-RPC. This is LangChain buying leads 24/7."*

**Screen:** Terminal showing `search_leads` → `set_auto_bid_rules` → agent response.

---

### 🎬 2:40–3:10 — Global Scale + Compliance (30s)

> *"Lead Engine works across 20+ countries and all 10 verticals — solar, mortgage, insurance, roofing, HVAC, legal, auto, home services, health, and real estate."*

**Action:** Show marketplace filters → cycle country dropdown (US → DE → BR → JP).

> *"ACE handles TCPA, GDPR, MiCA, LGPD automatically. Cross-border trades get jurisdiction checks in real time — a New York mortgage can't sell to an unlicensed EU buyer."*

**Screen:** Compliance block screen if applicable, or show compliance badge.

---

### 🎬 3:10–3:40 — Testing & CI/CD (30s)

> *"This isn't a prototype. We run 325 automated tests on every push."*

**Action:** Show GitHub Actions badge in README → briefly flash test results.

> *"112 Cypress E2E tests with full wallet mocking — Chainlink latency simulation, payment failures, mid-session wallet switching. 151 Jest tests. 62 Hardhat contract tests. 10,000 concurrent user load tests with Artillery. All automated via GitHub Actions CI/CD with PostgreSQL service containers."*

**Screen:** Hold on README badges (2s) → Quick flash of CI actions tab.
**Pacing tip:** This is a speed section — rattle off numbers with confidence.

---

### 🎬 3:40–4:05 — Chainlink Deep Dive (25s)

> *"Five Chainlink services power Lead Engine:"*

**Action:** Show architecture diagram from README.

> *"CRE for quality scoring. ACE for automated compliance. DECO for off-chain attestations without revealing PII. Data Streams for real-time bid floors. And Confidential Compute stubs for TEE-based scoring. This is the deepest Chainlink integration in the hackathon."*

**Screen:** Architecture diagram — hold full 5s. Judges need to read it.

---

### 🎬 4:05–4:30 — Close (25s)

> *"Lead Engine CRE: decentralized, instant, compliant, autonomous. The $200 billion lead market deserves web3 infrastructure — and here it is."*

**Screen:** Homepage with badges → GitHub repo.

> *"Live demo at lead-engine-cre.vercel.app. GitHub link in the description. Thank you."*

**End:** Hold on GitHub URL for 3s → fade.

---

## Judge Appeal Checklist

Use this to verify every judging criterion is visibly demonstrated in the video:

| Criterion | Demonstrated In | Timestamp |
|-----------|----------------|-----------|
| **Chainlink integration depth** | 5 services named + architecture diagram | 3:40–4:05 |
| **Working product** | Live seller submit → buyer bid → settlement | 0:20–2:10 |
| **Innovation / novelty** | Commit-reveal bidding, x402 instant settlement, MCP agent | 1:00–2:40 |
| **Technical complexity** | Multi-wallet, 9-criteria auto-bid, CRE+ACE pipeline | 1:00–1:40 |
| **Completeness** | 10 verticals, 20+ countries, CRM, webhooks | 0:20, 2:40 |
| **Testing / quality** | 325 tests, CI/CD, load tests | 3:10–3:40 |
| **UX / design** | Clean UI, vertical-adaptive forms, toast notifications | Throughout |
| **Business viability** | $200B market, reinvestment loop, instant settlements | 0:00, 1:40 |

---

## Backup Plan for Demo Failures

| Failure | Recovery |
|---------|----------|
| Wallet won't connect | Pre-recorded wallet segment (15s clip) |
| RPC timeout | All Chainlink stubs auto-fallback — demo continues seamlessly |
| Contract call fails | Pre-captured Sepolia explorer tx |
| Frontend blank | Demo via Swagger API (tab already open) |
| Database down | `npm run db:seed` live (< 10s) |
| MCP server crash | Pre-captured terminal logs |
| Auto-bid misfire | Show evaluation endpoint directly |
| Video pacing too fast | Practice run-through 2× before recording |

---

## Pacing Guide for Global Audiences

| Section | Words | WPM Target | Notes |
|---------|-------|------------|-------|
| Hook | ~35 | 130 | Slow, deliberate — set tone |
| Seller flow | ~75 | 140 | Speed up during vertical cycling |
| Multi-wallet | ~70 | 140 | Pause on wallet address change |
| Settlement | ~60 | 135 | Slow on "4 seconds" emphasis |
| CRM + MCP | ~55 | 150 | Fastest section — energy bump |
| Global scale | ~55 | 140 | Steady, authoritative |
| Testing | ~65 | 155 | Rattle off numbers confidently |
| Chainlink deep | ~50 | 130 | Slow — let diagram speak |
| Close | ~30 | 120 | Slowest — memorable ending |
