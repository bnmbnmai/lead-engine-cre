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
- [ ] Cypress E2E: 38 UI tests
- [ ] Artillery load test: 13 scenarios, 1,500 peak concurrent users
- [ ] Mock data seeded: 200+ entries (`cd backend && npm run db:seed`)
- [ ] Testnet sim: 500+ on-chain txs (`npx ts-node scripts/testnet-sim.ts --dry-run`)
- [ ] MCP tools test: `curl -X POST localhost:3002/rpc -d '{"method":"search_leads","params":{"vertical":"solar"}}'`

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
- [ ] 5 tools: search_leads, place_bid, get_bid_floor, export_leads, get_preferences
- [ ] `SKILL.md` with LangChain example, signless abstraction, CCIP notes
- [ ] Agent logger writes to `mcp-server/logs/`
- [ ] Error codes documented: RATE_LIMITED, BID_TOO_LOW, AUTH_FAILED, etc.

## CRM Exports

- [ ] `GET /api/v1/crm/export?format=csv|json` — download endpoint
- [ ] `POST /api/v1/crm/push` — webhook integration
- [ ] "Push to CRM" button on Buyer Dashboard (CSV/JSON/webhook dropdown)

## Live Deployment

- [ ] **Backend** live on Render → `https://lead-engine-cre-api.onrender.com`
- [ ] **Frontend** live on Vercel → `https://lead-engine-cre.vercel.app`
- [ ] **MCP Server** — document as local-only for hackathon (port 3002)
- [ ] Health check returns 200 (`/health`)
- [ ] Swagger UI functional (`/api/swagger`)
- [ ] Demo endpoints: `/api/v1/demo/e2e-bid`, `/api/v1/demo/compliance-check`
- [ ] CRM export: `/api/v1/crm/export?format=json`
- [ ] Bid floor: `/api/v1/bids/bid-floor?vertical=solar&country=US`
- [ ] CORS configured (frontend ↔ backend)
- [ ] WebSocket connected
- [ ] Mock data seeded on live DB

## Demo Video

- [ ] Recorded (3–4 min) per `docs/DEMO_SCRIPT.md`
- [ ] Uploaded to Loom (unlisted)
- [ ] Covers 9 scenes: landing → mortgage submit → DECO/Streams → ACE auto-rules → MCP agent → encrypted bid → CRM export → global scale → close
- [ ] Shows all 5 Chainlink services
- [ ] Shows MCP agent programmatic bidding
- [ ] Shows CRM "Push to CRM" button
- [ ] Backup segments pre-recorded

## Pitch Deck

- [ ] 12 slides per `docs/PITCH_DECK.md`
- [ ] "Why We Win" criteria slide included
- [ ] Exported as PDF or Google Slides link
- [ ] Innovation highlights: MCP agent, DECO/Streams/Confidential Compute, ZK privacy, CCIP-ready

## Submission Form

- [ ] Project name: **Lead Engine CRE**
- [ ] Category: **Chainlink CRE + ACE**
- [ ] Description: Decentralized RTB platform for the global lead marketplace with on-chain verification (CRE + ACE + DECO + Data Streams + Confidential Compute), privacy-preserving auctions, MCP agent server for programmatic bidding, and CRM integration — 10 verticals, 15+ countries, 500+ testnet txs
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
- [ ] No LICENSE file in repo (proprietary)
- [ ] All links in submission form work
- [ ] Video plays without issues
- [ ] Pitch deck exported and linked
- [ ] Double-check submission deadline
