# AgentRTB Product Thesis

## One sentence

**AgentRTB is a two-sided programmatic lead exchange: seller agents supply via SupplySpec + ingest APIs; buyer agents bid via StrategySpec; CRE scores and sealed auctions sit in the middle.**

## What we are building

| Side | Agent type | Policy document | Runtime |
|------|------------|-----------------|---------|
| **Supply** | Traffic platforms, seller ops bots | **SupplySpec** JSON | Ingest API + deterministic listing executor |
| **Demand** | CRM, ad platforms, buyer ops bots | **StrategySpec** JSON | Orchestrator + deterministic bid executor |
| **Core** | (platform) | — | CRE verify, CHTT fraud signals, sealed bids, vault, settlement saga |

## What we are not building (v1)

- Human buyer marketplace as the hero product
- Kimi chat / LLM direct bidding as the primary path
- Strategy marketplace as GTM
- Seller agent royalties, full A2A negotiation
- Customer-support-driven onboarding

## Repo tracks

| Track | Purpose | When to use |
|-------|---------|-------------|
| **AgentRTB (product)** | API/SDK, `lea_` / `lsa_` keys, webhooks, `/status` UI | Production: `VITE_AGENTRTB_MODE=true` |
| **LeadRTB (legacy demo)** | Hackathon marketplace UI, demo panel, on-chain log | Staging only: `VITE_DEMO_MODE=true`, not production |

The auction core (CRE, bids, settlement) is shared. Branding splits **AgentRTB** (programmatic agents) vs **LeadRTB** (historical demo shell).

## Fraud posture (seller agents)

Programmatic supply is guarded in layers:

1. **Identity** — `lsa_` scoped API keys, seller agent profiles
2. **Ingest** — TCPA proof required, phone/email dedup, rate limits, SupplySpec caps
3. **Scoring** — CRE `verifyLead`, optional CHTT in production, `MIN_AUCTION_QUALITY_SCORE`
4. **Market** — buyer StrategySpec quality gates, reserve price, sealed bids, seller reputation on settlement

Buyers cannot be forced to bid on junk. Sellers who stuff forms lose reputation and auction utility.

## Integration paths

**Buyer:** register → `lea_` key → StrategySpec → activate → webhooks → traces

**Seller:** register → `lsa_` key → SupplySpec → activate → `POST /api/v1/ingest/traffic-platform` → webhooks

Discovery: `GET /.well-known/agent.json`, OpenAPI at `/api/swagger`.

## Path to live

- [PATH_TO_LIVE.md](PATH_TO_LIVE.md) — staged ladder (staging → integrator → pilot → mainnet)
- [STAGING_SMOKE.md](STAGING_SMOKE.md) — deploy + `npm run smoke:agentrtb`
- [PILOT_COMMERCIAL.md](PILOT_COMMERCIAL.md) — invoice / take-rate before mainnet
- [MAINNET_TRIGGER.md](MAINNET_TRIGGER.md) — when (not if) to touch mainnet/audit

## Canonical packages

- `@lead-engine/rules-engine` — StrategySpec + SupplySpec schemas
- `@lead-engine/agent-sdk` — REST client (buyer + seller methods)
- `docs/AGENT_DEVELOPER_GUIDE.md` — integration guide
