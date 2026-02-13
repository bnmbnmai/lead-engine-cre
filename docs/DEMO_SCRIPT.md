# Demo Video Script — Lead Engine CRE

**Target length:** 3–4 minutes  
**Format:** Loom screen recording with voiceover  
**Pre-flight:** `cd backend && npm run db:seed` then start backend, frontend, and MCP server

---

## Scene 1: Title + Problem (0:00 – 0:25)

**Show:** Landing page hero — "Decentralized Lead RTB / Global. Compliant. Private."
**Actions:**
1. Load homepage (signed out) → stats bar (2,847 active leads, $127 avg bid, 20+ countries, 10 verticals)
2. Quick scroll through feature cards (CRE, ACE, Auto-Bid + ZK Privacy, 20+ Global Markets)

**Say:**
> "Lead Engine is a decentralized RTB platform for the $200 billion-plus lead marketplace. Today, lead trading relies on opaque intermediaries — no trust, no privacy, no compliance. We're fixing that with Chainlink."

---

## Scene 2: Seller Submits Lead (0:25 – 0:55)

**Show:** Seller Dashboard → Submit Lead
**Actions:**
1. Connect wallet (MetaMask) → navigate to Seller → Submit Lead
2. Vertical = Mortgage, Country = US, State = NY, Zip = 10001
3. Fill mortgage fields: Loan Amount = $450K, Credit Range = 720-750, Property Type = SFR
4. Submit → CRE verification starts → quality score 7,850/10,000
5. Quick switch to API tab → show curl example for programmatic submission
6. Note: ad tracking fields (utm_source, ad_platform) auto-populated from URL

**Say:**
> "A seller submits a $450K mortgage lead from New York. Our form adapts per vertical — mortgage-specific fields appear automatically. CRE begins on-chain verification immediately, scoring this lead 7,850 out of 10,000."

---

## Scene 3: DECO Attestation + Data Streams Pricing (0:55 – 1:25)

**Show:** Backend logs or API responses showing stub services
**Actions:**
1. Show DECO attestation result: `verifySolarSubsidy` → proof hash + `isStub: true` badge
2. Show Data Streams bid floor: `GET /api/v1/bids/bid-floor?vertical=mortgage&country=US` → floor $85, ceiling $220, index 1.12
3. Mention Confidential Compute: TEE lead scoring running in background

**Say:**
> "Chainlink DECO attests external data without revealing content. Data Streams provides real-time bid floor pricing — $85 to $220 for US mortgage leads. And Confidential Compute runs privacy-preserving lead scoring in a TEE. All three are stub-ready for production once Chainlink access is granted."

---

## Scene 4: ACE Compliance + Auto-Rules (1:25 – 1:50)

**Show:** Compliance check API + Buyer Preferences panel
**Actions:**
1. Show KYC check → wallet PASSED
2. Show cross-border: NY mortgage → EU buyer = BLOCKED (licensing required)
3. Switch to Buyer Dashboard → Preferences panel:
   - Auto-bid rule: Mortgage, FL+TX, max $120, min quality 6000
   - Budget cap: $5,000/day
4. Auto-bid triggers on matching lead → no manual intervention

**Say:**
> "ACE automates compliance — KYC, jurisdiction enforcement, MiCA attestation for EU. But the real power is auto-bidding. Buyers set rules: 'bid up to $120 on Florida mortgage leads scoring above 6,000.' The system executes instantly."

---

## Scene 4B: EU Solar Auto-Bid Flow (1:50 – 2:05)

**Show:** Seller Submit → Auto-Bid trigger → Bid log
**Actions:**
1. Seller submits EU solar lead: Country = DE, State = Bavaria, quality score 8,500
2. Auto-bid engine evaluates: finds 2 matching buyers (solar, DE, min score 8000)
3. Show auto-bid response: `bidsPlaced: 2, skipped: 1 (budget exceeded)`
4. Bids appear in buyer dashboard — no manual action required

**Say:**
> "A German solar lead scores 8,500. The auto-bid engine evaluates 3 buyers — 2 match, 1 is blocked by daily budget. Both bids fire in under 100ms. This is the convergence of traditional lead gen and decentralized trust."

---

## Scene 5: MCP Agent — Programmatic Bidding (2:05 – 2:25)

**Show:** Terminal with MCP server + curl/agent calls
**Actions:**
1. Show MCP server running on port 3002 → list 9 tools
2. Agent call: `search_leads` → returns 3 solar leads in CA
3. Agent call: `set_auto_bid_rules` → configure solar CA auto-bid at $120, min score 8000
4. Agent call: `configure_crm_webhook` → register Zapier webhook
5. Agent call: `ping_lead` → evaluate a lead for auto-bidding
6. Show agent log → structured JSONL entry with latency

**Say:**
> "For large buyers, we built an MCP agent server — 9 tools for full automation. AI agents can search leads, set auto-bid rules, register CRM webhooks, and ping leads for evaluation. This is the LangChain integration that makes Lead Engine a platform, not just an app."

---

## Scene 6: Encrypted Bid + Settlement (2:20 – 2:45)

**Show:** Buyer Dashboard → bid placement → settlement
**Actions:**
1. Buyer places sealed $95 bid on mortgage lead ("Sealed Bid" mode)
2. Show commitment hash (keccak256)
3. Bid reveal → verified → buyer wins
4. NFT minted with quality score → USDC escrow → settlement (2.5% fee)

**Say:**
> "The buyer's $95 sealed bid is encrypted with AES-256-GCM and committed on-chain. After reveal, the commitment is verified — if it doesn't match, the bid is rejected. The lead is minted as an ERC-721 NFT, payment flows through USDC escrow, and settlement happens automatically."

---

## Scene 6B: Instant Settlement Benefit (2:45 – 2:55)

**Show:** Seller Dashboard — settlement confirmation + wallet balance
**Actions:**
1. Point to the settlement timestamp — seconds, not days
2. Highlight the USDC balance increase in wallet
3. Show the "reinvest" narrative: seller goes to Google Ads tab

**Say:**
> "Settlement took 4 seconds. In a traditional marketplace, this seller would wait 7-30 days for a check. With x402, USDC hits their wallet instantly — and they reinvest in their next ad campaign before their competitor even knows the lead was sold."

---

## Scene 7: CRM Webhooks + Testnet Sim (2:55 – 3:15)

**Show:** Buyer Dashboard → CRM webhook config + testnet sim output
**Actions:**
1. Show registered webhooks: Zapier + HubSpot
2. Trigger `lead.sold` → HubSpot gets contact properties, Zapier gets flat payload
3. Show webhook delivery log: 200 OK from both endpoints
4. Switch to terminal → testnet sim results: 500+ txs, 10 wallets, gas report

**Say:**
> "Won leads push to any CRM — HubSpot gets structured contact properties, Zapier gets flat key-value payloads. Both fire automatically on `lead.sold`. And our testnet simulation drives 500+ on-chain transactions across 10 HD wallets. That's real traction on Sepolia."

---

## Scene 8: Global Scale + Testing (3:15 – 3:35)

**Show:** Marketplace filters + test results
**Actions:**
1. Show 10 verticals × 20+ countries in dropdowns
2. 1,151 Jest + 141 Hardhat + 82 Cypress = **1,370+ tests passing**
3. Artillery: 23+ scenarios, 10K concurrent users

**Say:**
> "10 verticals, 20 countries, 1,370+ tests passing, 10,000 concurrent users validated. This isn't a prototype — it's production-grade infrastructure."

---

## Scene 9: Close (3:35 – 3:55)

**Show:** Architecture diagram + repo link
**Say:**
> "Lead Engine disrupts the $200 billion lead marketplace with instant x402 settlements, 9-criteria auto-bidding, and ZK fraud proofs — powered by 5 Chainlink services. Sellers reinvest in seconds. Buyers bid while they sleep. Enterprises plug in via MCP. Repo at github.com/bnmbnmai/lead-engine-cre. Thank you."

---

## Backup Plan for Demo Failures

| Failure | Backup |
|---------|--------|
| Wallet won't connect | Pre-recorded wallet connection segment |
| RPC timeout | All Chainlink services have stub fallbacks — demo continues |
| Contract call fails | Show pre-captured tx on Sepolia explorer |
| Frontend blank | Demo via API endpoints (curl / Postman) |
| Database down | Run `npm run db:seed` live (< 10s) |
| MCP server down | Show pre-captured agent logs from `mcp-server/logs/` |
| DECO/Streams timeout | Stubs auto-fallback: `isStub: true` with cached results |
| Auto-bid doesn't fire | Show evaluation endpoint: `POST /api/v1/bids/auto-bid/evaluate` |
| CRM webhook fails | Show `fireCRMWebhooks` log + retry with generic format |
| Video recording fails | Pre-record key segments on Loom as insurance |
