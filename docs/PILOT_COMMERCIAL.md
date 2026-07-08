# Pilot Commercial Path (before mainnet)

**Goal:** Profitability *signal* before custody upgrade.  
**Rule:** First dollar or signed pilot → only then schedule mainnet ([MAINNET_TRIGGER.md](MAINNET_TRIGGER.md)).

## Offer (v1)

**AgentRTB clearing for programmatic leads**

| Item | Default |
|------|---------|
| What you sell | Access to sealed auctions + CRE quality gates + StrategySpec/SupplySpec APIs |
| Settlement for pilots | Invoice / ACH / prepaid credits (testnet escrow optional) |
| Take rate | 8–12% of cleared lead GMV (negotiate; floor 5%) |
| Or flat pilot | $500–2,000 / 30 days for API access + support via docs/webhooks |
| Included | Staging or dedicated env, `lsa_` / `lea_` keys, webhook delivery logs |
| Not included | Mainnet custody, custom UI, human marketplace onboarding, SLA beyond best-effort |

## Who to call first

1. Your own traffic / form funnel (owned bot counts for Rung 2)
2. One lead aggregator or agency that already posts leads via webhook
3. One CRM / dialer buyer that can consume webhooks and fund a vault later

## Pilot contract skeleton

```
Pilot: AgentRTB API access — 30 days
Parties: [Platform] / [Customer]
Volume: up to N leads/day or $X GMV
Fee: [take rate OR flat fee]
Settlement: invoice net-15 (off-chain)
Chain: Base Sepolia for optional escrow demos; mainnet not in scope
Fraud: TCPA proof + dedup + quality floor enforced at ingest
Termination: either party, 7 days notice; unused prepaid credits refunded pro-rata
```

## Pricing experiments (pick one per pilot)

- **A — Take rate only:** 10% of cleared sale price
- **B — Flat + take:** $750 pilot fee + 5% take
- **C — Prepaid credits:** $1,000 credit wallet; burn per cleared lead at list fee

## Exit criteria for Rung 3

- [ ] Invoice paid **or** signed pilot PDF/email, **or**
- [ ] Prepaid credits funded

Then open a calendar block for mainnet *only if* the pilot requires real USDC custody.

## Outreach one-liner

> AgentRTB is a two-sided programmatic lead exchange: your seller bot posts via SupplySpec + ingest; buyer bots bid via StrategySpec. CRE scores and sealed auctions sit in the middle. Pilots settle off-chain; on-chain escrow stays on testnet until you need real USDC.
