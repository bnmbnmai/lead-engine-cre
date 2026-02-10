# Submission Checklist — Chainlink Hackathon 2026

## Repository

- [ ] Code pushed to `github.com/bnmbnmai/lead-engine-cre`
- [ ] `README.md` complete with CRE/ACE emphasis, proprietary license
- [ ] `.env.example` files present (no secrets committed)
- [ ] `.gitignore` covers `node_modules/`, `.env`, `dist/`, `artifacts/`
- [ ] Backend type-checks (`cd backend && npx tsc --noEmit`)
- [ ] Contracts compile cleanly (`cd contracts && npx hardhat compile`)
- [ ] Frontend builds (`cd frontend && npm run build`)

## Testing Verification

- [ ] Security compliance sim: 29/29 passing (`cd backend && npx ts-node --compiler-options '{"module":"commonjs"}' ../scripts/security-compliance-sim.ts`)
- [ ] Cypress E2E: 38 UI tests (`cd frontend && npx cypress run`)
- [ ] Artillery load test configured: 13 scenarios, 1500 peak (`cd backend && npm run test:load`)
- [ ] Mock data seeded: 200+ entries (`cd backend && npm run db:seed`)
- [ ] Mock data clearable: (`cd backend && npm run db:clear-mock`)

## Smart Contracts

- [ ] Deployed to **Sepolia** (all 5 contracts)
- [ ] Deployed to **Base Sepolia** (optional, for multi-chain demo)
- [ ] Verified on Etherscan / Basescan
- [ ] Contract addresses documented in README
- [ ] Chainlink Functions subscription funded with LINK
- [ ] `CREVerifier` added as subscription consumer

## Live Deployment

- [ ] **Backend** live on Render → `https://_____.onrender.com`
- [ ] **Frontend** live on Vercel → `https://_____.vercel.app`
- [ ] Health check returns 200 (`/health`)
- [ ] Swagger UI functional (`/api/swagger`)
- [ ] Demo endpoints functional (`/api/v1/demo/e2e-bid`, `/api/v1/demo/compliance-check`)
- [ ] CORS configured (frontend ↔ backend)
- [ ] WebSocket connected
- [ ] Mock data seeded on live DB

## Demo Video

- [ ] Recorded (3–4 min) per `docs/DEMO_SCRIPT.md`
- [ ] Uploaded to YouTube/Loom (unlisted)
- [ ] Covers all 9 scenes: landing hero → seller submit (DE/solar) → CRE verify → ACE cross-border → off-site fraud toggle → encrypted bid → settlement → global scale → close
- [ ] Shows Chainlink CRE + ACE usage explicitly
- [ ] Shows 10 verticals and 15+ country coverage
- [ ] Backup segments pre-recorded

## Pitch Deck

- [ ] 11 slides per `docs/PITCH_DECK.md`
- [ ] Problem → Solution → Architecture → Chainlink → Innovation → Demo → Traction → Market → Roadmap
- [ ] Exported as PDF or Google Slides link
- [ ] Innovation slide highlights: off-site fraud prevention, ZK privacy, global compliance

## Submission Form

- [ ] Project name: **Lead Engine CRE**
- [ ] Category: **Chainlink CRE + ACE**
- [ ] Description: Decentralized RTB platform for the global lead marketplace with on-chain verification, automated compliance, and privacy-preserving auctions — 10 verticals, 15+ countries
- [ ] GitHub repo URL
- [ ] Demo video URL
- [ ] Live frontend URL
- [ ] Live backend URL
- [ ] Swagger API docs URL
- [ ] Contract addresses (Sepolia)
- [ ] Team info

## Final Pre-Flight

- [ ] Test the live demo end-to-end one more time
- [ ] README renders properly on GitHub (mermaid diagram, tables, badges)
- [ ] No LICENSE file in repo (proprietary)
- [ ] All links in submission form work
- [ ] Video plays without issues
- [ ] Double-check submission deadline
