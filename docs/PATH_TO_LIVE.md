# Path to Live — Decision Memo

**Date:** 2026-07-08  
**Status:** Active  
**Related:** [PRODUCT_THESIS.md](PRODUCT_THESIS.md), [MAINNET_TRIGGER.md](MAINNET_TRIGGER.md), [PILOT_COMMERCIAL.md](PILOT_COMMERCIAL.md)

## Locked thesis

- **Architecture (#2):** Agent RTB platform — SupplySpec + StrategySpec, CRE scoring, sealed auction, vault settlement.
- **Revenue wedge (#1):** Leads only until volume clears.
- **No rewrite.** Package and ship `agentrtb-remediation`; do not greenfield.

## Trust ladder (do not skip)

| Rung | Gate | Exit criteria |
|------|------|----------------|
| 1 | Staging API live | Seller ingest → buyer StrategySpec bid → settle smoke passes |
| 2 | Integrator on testnet | Non-you or owned bot traffic through API |
| 3 | Pilot money | Invoice, prepaid credits, or signed pilot (see PILOT_COMMERCIAL) |
| 4 | Mainnet | Only when real USDC custody is required (see MAINNET_TRIGGER) |
| 5 | Audit | Only when TVL or partner compliance requires it |

**Live ≠ mainnet ≠ audited.** Climb one rung at a time.

## Explicit non-goals (90 days)

- Ground-up rewrite for “agent economy purity”
- Second vertical before leads clear volume
- Production Kimi chat / demo panel / marketplace hero UI
- Audit-then-mainnet-then-customers ordering
- Expanding CRE/CHTT surface for narrative alone

## Near-term packaging

1. PR: AgentRTB two-sided + fraud on `agentrtb-remediation`
2. Staging deploy + `npm run smoke:agentrtb` (seller → buyer → settle)
3. Owned integrator bot: `npm run bot:integrator`
4. Pilot commercial path before any mainnet schedule

## Success bar (this quarter)

One seller + one buyer path live on staging/testnet, plus a pilot commercial signal — **not** “maximally useful for the entire agent economy.”
