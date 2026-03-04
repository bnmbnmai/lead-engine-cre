# Production Readiness Checklist — LeadRTB

> Use this checklist before any production deployment or hackathon submission.

---

## 🔒 Security

- [x] Private keys: NOT in Git, managed via env vars / GitHub Secrets
- [x] PII encryption: AES-256-GCM for lead data at rest
- [x] Commit-reveal: sealed bids verified on-chain
- [x] ZK proofs: keccak256 commitment validation passing
- [ ] Slither: no HIGH/MEDIUM findings (`scripts/run-slither.ps1`)
- [ ] Snyk: no critical dependency vulnerabilities (`npm audit`)
- [ ] CORS: restricted to production domain only
- [ ] CSP: helmet configured with strict directives

## 📊 Monitoring

- [x] Health check: `/health` returns `status: ok`
- [ ] Sentry DSN configured (backend + frontend)
- [ ] Uptime monitoring: external probe on `/health` (UptimeRobot, Render)

## 🧪 Testing

- [x] Jest unit tests: 994/994 passing, 40 suites (`cd backend && npm test`)
- [x] Contract tests: Hardhat test suite passing (`npx hardhat test`)
- [ ] Artillery load: 23+ scenarios configured (`tests/load/*.yml`)
- [ ] Cypress E2E: configured (`cd frontend && npx cypress run`)

## 🌐 Infrastructure

- [x] Backend deployed on Render (auto-deploy from `main`)
- [x] Frontend deployed on Vercel (auto-deploy from `main`)
- [x] PostgreSQL provisioned (Render managed)
- [x] Custom domains: `leadrtb.com` (frontend), `api.leadrtb.com` (backend)
- [ ] Redis provisioned (for rate limiting + caching) — currently in-memory fallback

## 📜 Smart Contracts

- [x] All 8 contracts deployed and source-verified on Base Sepolia Basescan
- [x] Contract addresses updated in backend `.env` and `CONTRACTS.md`
- [x] Chainlink Functions subscription funded (sub ID 581)
- [ ] Constructor arguments documented in `CONTRACTS.md`
- [ ] VRF subscription consumer added for new VRFTieBreaker address

## 🔗 Integrations

- [x] MCP server: 15 tools registered
- [x] Socket.IO: WebSocket connections stable
- [ ] Alchemy RPC: API key valid, not rate-limited
- [ ] CRM webhooks: rate limiter + circuit breaker active

## 📄 Documentation

- [x] README.md: up to date with current metrics/features
- [x] CONTRACTS.md: canonical address source, all 8 contracts
- [x] PITCH_DECK.md: current numbers match README
- [x] ENV_VARS.md: comprehensive env var reference
- [ ] MAINNET_MIGRATION.md: ready for post-hackathon

## 🚀 Final Pre-Submit

- [x] Demo URL accessible: https://leadrtb.com
- [x] API URL accessible: https://api.leadrtb.com/health
- [ ] `git status` clean (no uncommitted changes)
- [ ] All CI checks passing
- [ ] Loom video recorded and linked in README
- [ ] Submission form completed with all required fields
