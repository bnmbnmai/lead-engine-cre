# Submission Checklist — Chainlink Hackathon 2026

## Repository

- [ ] Code pushed to `github.com/bnmbnmai/lead-engine-cre`
- [ ] `README.md` complete with CRE/ACE emphasis
- [ ] `.env.example` files present (no secrets committed)
- [ ] `.gitignore` covers `node_modules/`, `.env`, `dist/`, `artifacts/`
- [ ] All 123 tests passing (`cd backend && npm test`)
- [ ] Contracts compile cleanly (`cd contracts && npx hardhat compile`)
- [ ] Frontend builds (`cd frontend && npm run build`)

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
- [ ] Demo endpoints functional (`/api/v1/demo/e2e-bid`)
- [ ] CORS configured (frontend ↔ backend)
- [ ] WebSocket connected

## Demo Video

- [ ] Recorded (3-4 min) per `docs/DEMO_SCRIPT.md`
- [ ] Uploaded to YouTube/Loom (unlisted)
- [ ] Covers: lead submission → CRE verify → ACE compliance → encrypted bid → settlement → NFT
- [ ] Shows Chainlink CRE + ACE usage explicitly
- [ ] Backup segments pre-recorded

## Pitch Deck

- [ ] 8-10 slides per `docs/PITCH_DECK.md`
- [ ] Problem → Solution → Architecture → Chainlink → Demo → Market → Roadmap
- [ ] Exported as PDF or Google Slides link

## Submission Form

- [ ] Project name: **Lead Engine CRE**
- [ ] Category: **Chainlink CRE + ACE**
- [ ] Description: Decentralized RTB platform for lead marketplace with on-chain verification and compliance
- [ ] GitHub repo URL
- [ ] Demo video URL
- [ ] Live frontend URL
- [ ] Live backend URL
- [ ] Contract addresses (Sepolia)
- [ ] Team info

## Final Pre-Flight

- [ ] Test the live demo end-to-end one more time
- [ ] Readme renders properly on GitHub
- [ ] All links in submission form work
- [ ] Video plays without issues
- [ ] Double-check submission deadline
