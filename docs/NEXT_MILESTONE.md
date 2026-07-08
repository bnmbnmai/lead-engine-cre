# Next Public Milestone — Path to Live (2026-07-08)

Supersedes the 2026-06-12 staging-first note. Canonical plan: [PATH_TO_LIVE.md](PATH_TO_LIVE.md).

## Decision

**Ship AgentRTB as an agent RTB platform (leads = vertical #1)** on staging/testnet first. Mainnet and audit wait for explicit triggers ([MAINNET_TRIGGER.md](MAINNET_TRIGGER.md)).

| Track | Role |
|-------|------|
| **AgentRTB (product)** | API/SDK, `lea_` / `lsa_`, SupplySpec + StrategySpec, fraud ingest — `VITE_AGENTRTB_MODE=true` |
| **LeadRTB (legacy demo)** | Staging-only demo shell — not production AgentRTB |

## Rung checklist

- [x] Two-sided + fraud packaged on `agentrtb-remediation`
- [ ] Staging deploy + `npm run smoke:agentrtb` ([STAGING_SMOKE.md](STAGING_SMOKE.md))
- [ ] Owned integrator bot traffic (`npm run bot:integrator`)
- [ ] Pilot commercial signal ([PILOT_COMMERCIAL.md](PILOT_COMMERCIAL.md))
- [ ] Mainnet only after trigger; audit only after TVL/partner trigger

## Explicitly deferred

- Ground-up rewrite
- Second vertical
- Production Kimi / demo panel
- Premature mainnet / audit
