# A/B Test Plan — Copy & Onboarding

## Copy A/B Tests

### Test 1: Hero Headline — Market Size Framing

| Variant | Headline |
|---------|----------|
| **A (Control)** | "Decentralized Real-Time Bidding for the $200B+ Lead Marketplace" |
| **B** | "Sell Leads Globally. Get Paid in Seconds." |
| **C** | "Auto-Bid on Verified Leads Across 20+ Countries" |

**Metric:** Wallet connect rate (primary), scroll depth past hero (secondary)
**Segment:** All anonymous visitors, 33/33/33 split
**Duration:** 14 days or 500 wallet connects

---

### Test 2: Seller CTA — Settlement Speed vs. Revenue

| Variant | CTA |
|---------|-----|
| **A (Control)** | "Start Selling Leads" |
| **B** | "Get Paid in Seconds — List Your First Lead" |
| **C** | "Turn Ad Spend into Instant Revenue" |

**Metric:** Seller lead submission rate
**Segment:** Users who connected wallet + selected "seller" role
**Duration:** 14 days or 200 submissions

---

### Test 3: Buyer CTA — Automation vs. ROI

| Variant | CTA |
|---------|-----|
| **A (Control)** | "Browse Leads" |
| **B** | "Set Rules. Auto-Bid. Sleep." |
| **C** | "Cut Your CPA by 40% — Start Auto-Bidding" |

**Metric:** First bid placement rate, time-to-first-bid
**Segment:** Users who connected wallet + selected "buyer" role
**Duration:** 14 days or 300 bids

---

### Test 4: Preferences Page Tooltip Content

| Variant | Tooltip |
|---------|---------|
| **A (Control)** | Current: "Getting started with auto-bid" (paragraph format) |
| **B** | Checklist: "✅ Pick vertical → ✅ Set geo → ✅ Set budget → ✅ Enable auto-bid" |
| **C** | Social proof: "Solar buyers using auto-bid see 40% lower CPA on average" |

**Metric:** Auto-bid enable rate, daily-budget-set rate
**Segment:** First-time visitors to /buyer/preferences (tooltip not dismissed)
**Duration:** 14 days or 100 preference saves

---

## Onboarding Wizard Tests

### Test 5: Guided 3-Step Wizard vs. Freeform

| Variant | Experience |
|---------|------------|
| **A (Control)** | Current: Preferences form with dismissable tooltip |
| **B** | 3-step wizard: 1) Pick vertical → 2) Set geo + budget → 3) Enable auto-bid |

**Metric:** Preference set completion rate, time-to-first-auto-bid
**Segment:** New buyers (0 preference sets)
**Duration:** 21 days or 150 completions

**Wizard Mockup (Variant B):**

```
Step 1/3: What verticals do you buy?
  [Mortgage] [Solar] [Insurance] [Auto] [+More]

Step 2/3: Where and how much?
  Geo: [US] [CA] [DE] [...]    Budget: [$___/day]
  Quality gate: [____/10,000]

Step 3/3: Ready to auto-bid?
  [Enable Auto-Bid]  ← big green CTA
  "Your rules run 24/7 — bid on leads while you sleep."
```

---

### Test 6: Seller Onboarding — Skip vs. Instant Payout Narrative

| Variant | First-time seller experience |
|---------|------------------------------|
| **A (Control)** | Direct to "Submit Lead" form |
| **B** | 2-screen intro: "Submit → Auction → USDC in your wallet in seconds" with animated timeline |

**Metric:** First lead submission rate, time-to-first-submission
**Segment:** New sellers (0 leads submitted)
**Duration:** 14 days or 100 first submissions

---

## Implementation Priority

| Test | Effort | Impact | Priority |
|------|--------|--------|----------|
| Test 2 (Seller CTA) | Low (copy swap) | High (revenue) | **P0** |
| Test 3 (Buyer CTA) | Low (copy swap) | High (conversions) | **P0** |
| Test 4 (Tooltip) | Low (copy swap) | Medium (activation) | **P1** |
| Test 1 (Hero) | Low (copy swap) | Medium (top-funnel) | **P1** |
| Test 5 (Wizard) | Medium (new component) | High (onboarding) | **P1** |
| Test 6 (Seller intro) | Medium (new screens) | Medium (seller activation) | **P2** |

## Tracking

All tests tracked via `data-testid` attributes + event logging:
- `hero_cta_click`, `seller_cta_click`, `buyer_cta_click`
- `tooltip_view`, `tooltip_dismiss`, `autobid_enable`
- `wizard_step_1_complete`, `wizard_step_2_complete`, `wizard_step_3_complete`
- `first_lead_submitted`, `first_bid_placed`
