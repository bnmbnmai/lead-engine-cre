# Staging Deploy + Smoke (AgentRTB)

## Deploy (Render / staging)

1. Deploy branch `agentrtb-remediation` (Blueprint build runs `npx prisma migrate deploy`).
2. Confirm migrations include:
   - `20260613005000_agent_webhooks`
   - `20260613006000_two_sided_supply_fraud`
3. Frontend: `VITE_AGENTRTB_MODE=true`. Do **not** set `VITE_DEMO_MODE=true` on production AgentRTB.
4. Backend env (minimum for smoke):

```bash
JWT_SECRET=...
PRIVACY_ENCRYPTION_KEY=...
DEDUP_PEPPER=...                 # HMAC pepper for phone/email dedup
MIN_AUCTION_QUALITY_SCORE=0      # raise later (e.g. 5000); 0 for first smoke
INGEST_RATE_LIMIT_PER_HOUR=100
TRAFFIC_PLATFORM_API_KEY=...     # optional legacy path; prefer lsa_
USE_CONFIDENTIAL_HTTP=false      # optional on staging
AGENT_REGISTRY_ADDRESS=          # optional
```

5. Health: `GET /api/health` (or your existing health route) and `GET /.well-known/agent.json`.

## Smoke script (seller → auction → buyer strategy)

Against local or staging API:

```bash
# Local
cd backend && npm run smoke:agentrtb

# Staging
API_URL=https://your-staging.onrender.com npm run smoke:agentrtb
```

What it does:

1. Demo-login seller + buyer JWTs
2. Register seller agent → mint `lsa_` key → create/activate SupplySpec
3. Ingest lead with TCPA proof (expects `201` or documented fraud rejection)
4. Register buyer agent → mint `lea_` key → create/activate StrategySpec
5. Enqueue pipeline / confirm lead `IN_AUCTION` and strategy visible
6. Print settlement note (full sealed-bid settle may need vault funds + auction timer)

## Owned integrator bot (Rung 2)

```bash
cd backend && npm run bot:integrator
# or
API_URL=https://your-staging.onrender.com npm run bot:integrator
```

Loops: ingest sample leads with unique phones/emails under SupplySpec caps. Use as “non-you” traffic until a real partner connects.

## Exit criteria (Rung 1)

- [ ] Staging API serves `/.well-known/agent.json` with buyer + seller endpoints
- [ ] `smoke:agentrtb` completes without 5xx
- [ ] Ingest without TCPA → 400; duplicate contact → 409
- [ ] Buyer StrategySpec activates; seller SupplySpec activates
