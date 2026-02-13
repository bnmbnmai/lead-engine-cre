# Submission Checklist — Chainlink Hackathon 2026

## Repository

- [ ] Code pushed to `github.com/bnmbnmai/lead-engine-cre`
- [ ] `README.md` complete with CRE/ACE/DECO/Data Streams/Confidential Compute emphasis, proprietary license
- [ ] `.env.example` files present (backend, contracts, mcp-server — no secrets committed)
- [ ] `.gitignore` covers `node_modules/`, `.env`, `dist/`, `artifacts/`, `mcp-server/logs/`
- [ ] Backend type-checks (`cd backend && npx tsc --noEmit`)
- [ ] MCP server type-checks (`cd mcp-server && npx tsc --noEmit`)
- [ ] Contracts compile cleanly (`cd contracts && npx hardhat compile`)
- [ ] Frontend builds (`cd frontend && npm run build`)

## Testing Verification

- [ ] Security compliance sim: 29/29 passing
- [ ] Auto-bid engine: 18/18 passing
- [ ] CRM webhooks: 10/10 passing (rate limit + circuit breaker)
- [ ] Cypress E2E: 82 UI tests
- [ ] On-chain E2E: settlement (6), reorg (4), Chainlink stubs (5)
- [ ] Artillery load test: 23+ scenarios, 10K peak concurrent users
- [ ] Mock data seeded: 200+ entries (`cd backend && npm run db:seed`)
- [ ] Testnet sim: 500+ on-chain txs (`npx ts-node scripts/testnet-sim.ts --dry-run`)
- [ ] MCP tools test: `curl -X POST localhost:3002/rpc -d '{"method":"search_leads","params":{"vertical":"solar"}}'`
- [ ] GitHub Actions CI: all 5 jobs passing (backend, frontend, Cypress, Artillery, contracts)

## Smart Contracts

- [ ] Deployed to **Sepolia** (all 5 contracts)
- [ ] Deployed to **Base Sepolia** (optional)
- [ ] Verified on Etherscan / Basescan
- [ ] Contract addresses documented in README and `backend/.env`
- [ ] Chainlink Functions subscription funded with LINK
- [ ] `CREVerifier` added as subscription consumer

## Chainlink Service Stubs

- [ ] DECO stub: `backend/src/services/deco.service.ts` — attestation + fallback
- [ ] Data Streams stub: `backend/src/services/datastreams.service.ts` — bid floor pricing
- [ ] Confidential Compute stub: `backend/src/services/confidential.service.ts` — TEE scoring
- [ ] All stubs return `isStub: true` for UI badging
- [ ] Bid floor endpoint: `GET /api/v1/bids/bid-floor`

## MCP Agent Server

- [ ] `mcp-server/` builds and runs on port 3002
- [ ] 9 tools: search_leads, place_bid, get_bid_floor, export_leads, get_preferences, set_auto_bid_rules, configure_crm_webhook, ping_lead, get_lead_status
- [ ] `SKILL.md` with LangChain autonomous bidding agent, signless abstraction, CCIP notes
- [ ] Agent logger writes to `mcp-server/logs/`
- [ ] Error codes documented: RATE_LIMITED, BID_TOO_LOW, AUTH_FAILED, etc.

## CRM Exports

- [ ] `GET /api/v1/crm/export?format=csv|json` — download endpoint
- [ ] `POST /api/v1/crm/push` — legacy webhook push
- [ ] `POST /api/v1/crm/webhooks` — register HubSpot/Zapier/generic webhook
- [ ] `GET /api/v1/crm/webhooks` — list registered webhooks
- [ ] `DELETE /api/v1/crm/webhooks/:id` — remove webhook
- [ ] "Push to CRM" button on Buyer Dashboard (CSV/JSON/webhook dropdown)

## Live Deployment

- [ ] **Backend** live on Render → `https://lead-engine-cre-api.onrender.com`
- [ ] **Frontend** live on Vercel → `https://lead-engine-cre.vercel.app`
- [ ] **MCP Server** — document as local-only for hackathon (port 3002)
- [ ] Health check returns 200 (`/health`)
- [ ] Swagger UI functional (`/api/swagger`)
- [ ] Demo endpoints: `/api/v1/demo/e2e-bid`, `/api/v1/demo/compliance-check`
- [ ] Auto-bid evaluate: `POST /api/v1/bids/auto-bid/evaluate`
- [ ] CRM webhooks: `POST /api/v1/crm/webhooks`
- [ ] CRM export: `/api/v1/crm/export?format=json`
- [ ] Bid floor: `/api/v1/bids/bid-floor?vertical=solar&country=US`
- [ ] CORS configured (frontend ↔ backend)
- [ ] WebSocket connected
- [ ] Mock data seeded on live DB

## Demo Video

- [ ] Recorded (< 5 min) per `docs/LOOM_SCRIPT.md`
- [ ] Uploaded to Loom (unlisted)
- [ ] 8 scenes: hook → seller flow → auto-bid engine → auction/settlement → CRM → MCP agent → global scale → Chainlink deep dive → close
- [ ] Shows all 5 Chainlink services (CRE, ACE + DECO, Streams, Confidential stubs)
- [ ] Shows auto-bid engine firing on Boise solar lead
- [ ] Shows MCP agent: set_auto_bid_rules + configure_crm_webhook + ping_lead
- [ ] Shows CRM webhook delivery (HubSpot + Zapier) + CSV export
- [ ] Shows instant x402 USDC settlement (< 10s)
- [ ] Backup segments pre-recorded

## Pitch Deck

- [ ] 12 slides per `docs/PITCH_DECK.md`
- [ ] "Why We Win" criteria slide included
- [ ] Exported as PDF or Google Slides link
- [ ] Innovation highlights: MCP agent, DECO/Streams/Confidential Compute, ZK privacy, CCIP-ready

## Lead RTB Focus

- [ ] Marketplace search wired (keyword + vertical + geo + price)
- [ ] Analytics dashboards use real API data (mock fallback in dev only)
- [ ] Feedback widget rendered for authenticated users
- [ ] KYC "Verify Now" banner + deep-link in seller flows
- [ ] NFT features toggleable via env vars (`NFT_FEATURES_ENABLED`, `VITE_NFT_ENABLED`)
- [ ] Admin sidebar with NFT Admin + Verticals links
- [ ] Ad Conversions page accessible from seller sidebar
- [ ] NFT deprecation notice displayed on Admin NFTs page

## Submission Form

- [ ] Project name: **Lead Engine CRE**
- [ ] Category: **Chainlink CRE + ACE**
- [ ] Description: Decentralized RTB platform for the global lead marketplace with on-chain verification (CRE + ACE + DECO + Data Streams + Confidential Compute), privacy-preserving auctions, autonomous bidding (9-criteria auto-bid engine + MCP agent server with 9 tools + LangChain integration), CRM pipeline (HubSpot + Zapier webhooks), and cross-border compliance — 10 verticals, 20+ countries, 1,370+ tests, 500+ testnet txs, Sentry monitoring, CI/CD pipeline
- [ ] GitHub repo URL: `https://github.com/bnmbnmai/lead-engine-cre`
- [ ] Demo video URL (Loom)
- [ ] Live frontend URL: `https://lead-engine-cre.vercel.app`
- [ ] Live backend URL: `https://lead-engine-cre-api.onrender.com`
- [ ] Swagger API docs: `https://lead-engine-cre-api.onrender.com/api/swagger`
- [ ] Contract addresses (Sepolia)
- [ ] Team info

## Final Pre-Flight

- [ ] Test live demo end-to-end one more time
- [ ] README renders properly on GitHub (mermaid diagram, tables, badges)
- [ ] CI badge green on README
- [ ] No LICENSE file in repo (proprietary)
- [ ] All links in submission form work
- [ ] Video plays without issues
- [ ] Pitch deck exported and linked
- [ ] X/Twitter thread posted (see `docs/X_PROMOTION.md`)
- [ ] Double-check submission deadline
