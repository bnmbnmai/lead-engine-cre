# Loom Demo Video Script — Lead Engine CRE

> **Target: < 5 minutes** | Record on [loom.com](https://www.loom.com) | Share unlisted link

---

## Pre-Recording Setup

1. Open browser tabs:
   - `https://lead-engine-cre.vercel.app` (frontend)
   - `https://lead-engine-cre-api.onrender.com/api/swagger` (Swagger)
   - `https://sepolia.etherscan.io/address/0xB93A1Ff499BdEaf74710F760Eb2B6bc5b62f8546` (LeadNFT)
2. Connect MetaMask (Sepolia) with test wallet
3. Terminal open with `mcp-server` running on port 3002

---

## Scene Breakdown (4:30 total)

### 🎬 0:00–0:20 — Hook (20s)

> *"Lead generation is a $200 billion market plagued by fraud, opacity, and slow settlements. Lead Engine CRE fixes all three — using Chainlink's newest services to create the world's first decentralized real-time bidding platform for leads."*

**Screen:** Homepage hero with "Decentralized Lead Intelligence" headline.

---

### 🎬 0:20–1:00 — Seller Flow (40s)

> *"Let me show you the seller experience. A solar installer in Boise submits a lead — name, email, interest in residential solar. Behind the scenes, three things happen instantly:"*

**Action:** Click "Become a Seller" → Fill lead form → Submit

> *"First, Chainlink CRE scores the lead quality — verifying the email, phone, and property data against off-chain sources. Second, ACE checks that both the seller and their jurisdiction are compliant — TCPA in the US, GDPR in Europe. Third, the lead is minted as an NFT on Base with a privacy-preserving hash."*

**Screen:** Show CRE quality badge, ACE compliance check, NFT minted toast.

---

### 🎬 1:00–1:40 — Auto-Bid Engine (40s)

> *"Now the magic — our 9-criteria auto-bid engine. Buyers set preferences: 'I want solar leads from Idaho, quality 70+, max $80 per lead.' When this Boise lead hits the marketplace..."*

**Action:** Show Buyer Preferences page → Toggle auto-bid ON

> *"...the engine instantly matches it against all active buyer rules. Budget checks, geo matching, vertical targeting, time-of-day weighting — all in under 200ms. The buyer's sealed bid is committed on-chain using our commit-reveal pattern."*

**Screen:** Auto-bid firing animation → Sealed bid committed toast.

---

### 🎬 1:40–2:20 — Auction + Settlement (40s)

> *"Once bids are revealed, the auction resolves — winner takes the lead. Here's where x402 instant settlements change everything:"*

**Action:** Show auction resolution → Escrow created → Released

> *"USDC is locked in our RTBEscrow contract. The seller gets paid in under 10 seconds — not 30 days like traditional networks. That cash goes straight back into their next ad campaign. It's an instant reinvestment loop that traditional lead gen can't match."*

**Screen:** Escrow flow on Etherscan showing EscrowCreated → EscrowReleased events.

---

### 🎬 2:20–2:50 — CRM Integration (30s)

> *"Buyers need leads in their CRM, not stuck in a dashboard. One click pushes to HubSpot, Salesforce, or any webhook — including Zapier for 5000+ integrations."*

**Action:** Click "Push to CRM" → Show webhook delivery → CSV export

> *"Rate-limited, retry-safe, with circuit breakers. Production-grade from day one."*

---

### 🎬 2:50–3:20 — MCP Agent (30s)

> *"For power users, our MCP agent server exposes 8 tools for AI-native bidding. Here's a LangChain agent autonomously setting auto-bid rules and configuring CRM webhooks."*

**Action:** Terminal showing MCP tool calls → Agent response

> *"search_leads, place_bid, set_auto_bid_rules, configure_crm_webhook — all via JSON-RPC. This is the future: AI agents buying leads 24/7."*

---

### 🎬 3:20–3:50 — Global Scale (30s)

> *"Lead Engine works across 20+ countries and 10 verticals. Our ACE compliance engine handles jurisdiction-specific rules automatically — TCPA, GDPR, MiCA, LGPD."*

**Action:** Show geo table in README or frontend map

> *"We've run 10,000 concurrent user load tests with Artillery, 53 Cypress E2E tests, and 29 security simulation scenarios. 166+ tests total."*

---

### 🎬 3:50–4:10 — Chainlink Deep Dive (20s)

> *"We use five Chainlink services: CRE for quality scoring, ACE for compliance, DECO for off-chain attestations, Data Streams for real-time bid floors, and Confidential Compute stubs for TEE-based scoring. This is the deepest Chainlink integration in the hackathon."*

**Screen:** Architecture diagram from README.

---

### 🎬 4:10–4:30 — Close (20s)

> *"Lead Engine CRE: decentralized, instant, compliant, autonomous. The $200 billion lead market deserves web3 infrastructure. We built it."*

**Screen:** Homepage with badges → GitHub repo → "Thank you" slide.

> *"Links in the description. Try the live demo at lead-engine-cre.vercel.app."*

---

## Post-Recording

1. Upload to Loom → Set to **unlisted**
2. Copy share link → Paste into `SUBMISSION_FORM.md`
3. Add link to `PITCH_DECK.md` slide 12
4. Tweet announcement (see `docs/X_PROMOTION.md`)
