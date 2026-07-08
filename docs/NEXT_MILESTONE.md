# Next Public Milestone — Path to Live (2026-07-08)

Supersedes the 2026-06-12 staging-first note. Canonical plan: [PATH_TO_LIVE.md](PATH_TO_LIVE.md).

## Decision

**Ship AgentRTB as an agent RTB platform (leads = vertical #1)** on staging/testnet first. Mainnet and audit wait for explicit triggers ([MAINNET_TRIGGER.md](MAINNET_TRIGGER.md)).

| Track | Role |
|-------|------|
| **AgentRTB (product)** | API/SDK, `lea_` / `lsa_`, SupplySpec + StrategySpec, fraud ingest — `VITE_AGENTRTB_MODE=true` |
| **LeadRTB (legacy demo)** | Staging-only demo shell — not production AgentRTB |

## Rung checklist

- [x] Two-sided + fraud packaged on `agentrtb-remediation` (PR #1)
- [x] Local smoke: `npm run smoke:agentrtb` (TCPA / dedup / SupplySpec / StrategySpec)
- [x] Owned integrator bot: `npm run bot:integrator`
- [x] Pilot commercial package: [PILOT_COMMERCIAL.md](PILOT_COMMERCIAL.md)
- [x] Mainnet/audit triggers documented: [MAINNET_TRIGGER.md](MAINNET_TRIGGER.md)
- [ ] Remote staging host deploy (see [STAGING_DEPLOY_RUNBOOK.md](STAGING_DEPLOY_RUNBOOK.md))
- [ ] First paid or signed pilot (execute outreach from PILOT_COMMERCIAL)

## Explicitly deferred

- Ground-up rewrite
- Second vertical
- Production Kimi / demo panel
- Premature mainnet / audit
