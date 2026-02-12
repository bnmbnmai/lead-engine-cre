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

### Step 2: Holder Perks (30s)
> "NFT holders get priority bidding — a pre-ping window and 1.2× bid multiplier."

- Switch to **Wallet A** (holder)
- Navigate to Mortgage vertical
- **Show `HolderPerksBadge`** with priority badge and countdown
- Hover multiplier → show tooltip: "Your $100 bid competes as $120"
- Toggle notification switch ON → show ARIA polite feedback

### Step 3: Auction Demo (30s)
> "Watch what happens when a holder bids during the pre-ping window."

- Start a new auction (admin API)
- **Wallet A** bids $80 during pre-ping → effective bid $96
- Switch to **Wallet B** → try bidding during pre-ping → "Holders only" error
- Pre-ping expires → **Wallet B** bids $95 → still loses (effective $95 < $96)
- Show settlement: Wallet A wins, pays $80 (raw), not $96

### Step 4: Analytics (10s)
> "Holders can track their advantage with the win-rate analytics chart."

- Scroll to `HolderWinRateChart` showing 30-day trend
- Point out the advantage percentage in the header

---

## Act 4: Trust Infrastructure (45s)

### GDPR & Notifications (15s)
> "All notifications are GDPR-compliant — users must opt in, and we batch to prevent fatigue."

- Show the notification toggle with GDPR consent gate
- Show Shield icon when consent is missing

### Spam Prevention (15s)
> "Rate limiting is tiered — holders get 2× the rate limit, but hard-capped at 30/min."

- Show terminal: rapid bid sequence → blocked at threshold
- Show rate limit headers in response

### Gas Optimization (15s)
> "We cache holder status on-chain to save ~2,100 gas per repeat bid, and offer batch holder checks for frontend pre-validation."

- Show contract code: `holderCache` mapping
- Show `batchCheckHolders` function signature

---

## Act 5: Test Results (30s)

> "214 Jest tests, 133 Hardhat tests, 107 Cypress E2E — all passing. Zero regressions."

- Run in terminal: `npx jest --verbose`
- Show the green wall of 214 passing tests
- Show test categories: lifecycle, stacking, ACE+GDPR, cross-border, cache

---

## Act 6: Business Case (15s)

> "The flywheel works: Mint → Perks → Revenue → Resale → Royalties → Reinvest. Every NFT sale grows the ecosystem, and Chainlink ensures the trust layer is bulletproof."

- Show the Mermaid flywheel diagram in the README
- End on the "Known Gaps" table — show transparency

---

## Total Runtime: ~4.5 minutes

## Post-Recording Checklist
- [ ] Verify all wallet interactions recorded clearly
- [ ] Check audio levels on narration
- [ ] Add captions for accessibility
- [ ] Upload to Loom with "Lead Engine CRE — Chainlink Hackathon 2026" title
