# Staging deploy runbook (AgentRTB)

Use after merging or deploying `agentrtb-remediation`.

## Render / host checklist

1. Set branch to `agentrtb-remediation` (or merge PR #1 to `main` when ready).
2. Build must run `npx prisma migrate deploy` (already in `backend` build script).
3. Confirm new migrations apply:
   - `20260613005000_agent_webhooks`
   - `20260613006000_two_sided_supply_fraud`
4. Env (add if missing):

```
DEDUP_PEPPER=<openssl rand -hex 32>
MIN_AUCTION_QUALITY_SCORE=0
INGEST_RATE_LIMIT_PER_HOUR=100
VITE_AGENTRTB_MODE=true
VITE_DEMO_MODE=false
```

5. After deploy:

```bash
curl -sS "$API_URL/.well-known/agent.json" | head
API_URL=$API_URL npm run smoke:agentrtb --prefix backend
API_URL=$API_URL MAX_LEADS=5 npm run bot:integrator --prefix backend
```

## Local verified (2026-07-08)

- Embedded Postgres + `prisma db push`
- `npm run smoke:agentrtb` — TCPA 400, ingest IN_AUCTION, dedup 409, StrategySpec activate, pipeline 200
- `npm run bot:integrator` — owned seller traffic path

Remote staging URL is environment-specific; paste into your host dashboard and re-run the same commands with `API_URL`.
