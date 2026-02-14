# Lead Engine CRE — Loom Demo Script

## Pre-Recording Setup

1. Open two browser tabs:
   - **Tab 1**: `http://localhost:3000` (frontend)
   - **Tab 2**: `http://localhost:3001/api/docs` (Swagger)
2. Have MetaMask with two wallets:
   - **Wallet A** (0xOwner) — holds the "mortgage" vertical NFT
   - **Wallet B** (0xBuyer) — standard buyer, no NFTs
3. Terminal visible for test results

---

## Act 1: The Problem (30s)

> "The $200B lead generation market runs on trust — but there's no way to verify lead quality, prevent fraud, or enforce compliance automatically. Lead Engine fixes this with Chainlink."

- Show landing page hero
- Point to the 10 verticals listed

---

## Act 2: Chainlink Integration (60s)

### CRE Functions (30s)
> "CRE Functions run our lead verification on-chain — quality scoring, fraud detection, and geo-parameter matching."

- Navigate to a lead detail page
- Show the quality score badge (0-10000)
- Click "Verify on Chain" → show tx hash

### ACE Compliance (30s)
> "ACE handles all compliance automatically — KYC validation, jurisdiction enforcement, and cross-border restrictions."

- Show the compliance badge on the auction page
- Switch to Swagger → hit `POST /api/compliance/check`
- Show the response: `{ passed: true, checks: [...] }`

---

## Act 3: NFT Perk Flywheel (90s)

### Step 1: AI Suggestion → Mint (20s)
> "Our AI suggests new verticals. High-confidence suggestions auto-propose for admin review."

- Navigate to Admin → Vertical Management
- Show a PROPOSED vertical with confidence 0.92
- Click "Mint NFT" → show tx confirmation

### Step 2: Holder Perks via PerksPanel (30s)
> "NFT holders get priority bidding — a pre-ping window and 1.2× bid multiplier. Everything is managed from a unified Perks Panel."

- Switch to **Wallet A** (holder)
- Navigate to Buyer Dashboard
- **Show `PerksPanel`** with:
  - Multiplier badge: hover → tooltip shows "Your bids are weighted at 1.2×"
  - Pre-Ping badge: hover → tooltip shows "7s exclusive early access"
  - Win stats: total bids, won, win rate percentage
- Toggle **Notification opt-in** switch ON → show ARIA `role="status"` feedback
- Toggle **GDPR Consent** switch → show functional backend update
- Scroll to embedded **HolderWinRateChart** → point out 30-day holder advantage

### Step 3: Holder Wins Close Bid via Multiplier (30s)
> "Watch how the multiplier tips a close race in the holder's favor."

- Start a new auction (admin API): reserve $50, 5-minute sealed-bid window
- **Wallet A** bids $80 during pre-ping → effective bid = $96 (1.2×)
  - Show `HolderBidPlaced` event in console
- Switch to **Wallet B** → try bidding during pre-ping → "Holders only" error
- Pre-ping expires → **Wallet B** bids $95 → rejected (effective $95 < $96)
- **Wallet B** bids $97 → accepted (new high bid)
- **Wallet A** re-bids $85 during public window → effective $102 → wins
- Show settlement: Wallet A wins, **pays $85 (raw), not $102**
- Point out gas: "Settlement uses cached storage reads — ~10.5K gas saved"

### Step 4: Analytics (10s)
> "Holders track their advantage with the embedded win-rate analytics chart."

- Scroll to `HolderWinRateChart` in PerksPanel showing 30-day trend
- Collapse the PerksPanel (click header) → show accordion behavior
- Re-expand to show content restored

---

## Act 3.5: x402 Instant Settlement (30s)

> "Traditional marketplaces hold seller funds for 7-30 days. With x402, USDC hits the seller's wallet in under 10 seconds."

- After auction resolves (Act 3, Step 3), show terminal:
  ```
  ⚡ Phase 2.5: x402 Settlement (auction winner → seller)
  💳 x402 Settlement: Auction #1 settlement
     📊 Before — Buyer: 9,880.00 USDC | Seller: 0.00 USDC
     ✅ x402 createEscrow → fundEscrow → releaseEscrow
     📊 After  — Buyer: 9,830.00 USDC | Seller: 48.75 USDC
     💰 Seller received: 48.75 USDC (after 2.5% platform fee)
     ✅ x402 payment of 50 USDC sent from Buyer → Seller
  ```
- Point out: "Escrow create, fund, and release — three transactions, under 10 seconds total."
- Show: `simulation-results.txt` with the full payment audit trail

---

## Act 4: Trust Infrastructure (60s)

### Real-Time Analytics Toggle (20s)
> "Analytics dashboards now pull live data from purchases. Toggle between mock and real with one click."

- Navigate to Buyer Dashboard → Analytics
- Click **◉ Real Data** toggle → green **Live Data** badge appears
- Place a bid in another tab → chart auto-updates via WebSocket (`analytics:update`)
- Toggle back to mock → show side-by-side comparison

### GDPR & Notifications (15s)
> "All notifications are GDPR-compliant — users must opt in, and we batch to prevent fatigue. Daily cap of 50 notifications per user."

- Show the PerksPanel notification toggle with GDPR consent gate
- Point out: "GDPR consent checked before every enqueue — no silent notifications"

### Spam Prevention (15s)
> "Rate limiting is tiered — holders get 2× the rate limit, but hard-capped at 30/min. All thresholds are configurable via env vars."

- Show terminal: rapid bid sequence → blocked at 5 bids/min threshold
- Show rate limit headers in response
- Mention: "Config centralized in `perks.env.ts` — 15+ constants, all env-backed"

### Gas Optimization (15s)
> "We cache holder status on-chain to save ~2,100 gas per repeat bid, and settleAuction caches 6 storage values in local variables for another ~10.5K gas saving."

- Show contract code: `holderCache` mapping + `holderCacheSet`
- Show `settleAuction` local variable caching pattern
- Show `batchCheckHolders` function signature

---

## Act 5: Test Results & Simulation (45s)

> "338 Vitest tests, all passing. Plus a multi-wallet simulation that exercises the full on-chain lifecycle."

- Run in terminal: `npx vitest run`
- Show the green wall of 338 passing tests
- Then run: `cd contracts && npx hardhat run scripts/simulate-full-cycle.ts --network hardhat`
- Show 8-wallet simulation output:
  - Phase 1: KYC + minting
  - Phase 2: Commit-reveal auction
  - **Phase 2.5: x402 settlement** (highlight this)
  - Phase 3: Buy-now purchase
  - **Phase 3.5: x402 settlement** (highlight this)
  - Phase 4-5: VerticalAuction + NFT resale
  - Phase 6: RTBEscrow lifecycle
- Show x402 Payment Summary at the end: "Total USDC moved: 100"
- Point out: "All 8 phases run in under 5 seconds on local Hardhat"

---

## Act 5.5: Data Producer — We Give Back to Chainlink (15s)

> "Most dApps just consume Chainlink data. We also publish back. Our CustomLeadFeed contract pushes anonymized platform metrics — average quality scores, settlement volume, leads tokenized — as a custom on-chain data feed that any dApp can consume."

- Show `CustomLeadFeed.sol` in editor — highlight `latestAnswer()` getter
- Show `data-feed.stub.ts` — highlight the CRE cron workflow comment
- Point out: "Built on the official custom-data-feed template. Daily push, 40K gas, zero PII."

---

## Act 6: Business Case (15s)

> "The flywheel works: Mint → Perks → Revenue → Resale → Royalties → Reinvest. Every NFT sale grows the ecosystem, and Chainlink ensures the trust layer is bulletproof."

- Show the Mermaid flywheel diagram in the README
- Show the **Resolved Gaps** table — "All 9 audit issues resolved"
- Show the **Perk Flow Diagram** (sequence diagram) — NFT lease → priority bidding lifecycle
- End on the **Flywheel Retention** business note — "65% lower churn via priority perks"

---

## Total Runtime: ~5 minutes

## Post-Recording Checklist
- [ ] Verify all wallet interactions recorded clearly
- [ ] Check audio levels on narration
- [ ] Add captions for accessibility
- [ ] Upload to Loom with "Lead Engine CRE — Chainlink Hackathon 2026" title
