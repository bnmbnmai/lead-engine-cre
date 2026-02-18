# Production Readiness Checklist — Lead Engine CRE

> Use this checklist before any production deployment or hackathon submission.

---

## 🔒 Security

- [ ] Slither: no HIGH/MEDIUM findings (`scripts/run-slither.ps1`)
- [ ] Snyk: no critical dependency vulnerabilities (`npm audit`)
- [ ] Private keys: NOT in Git, managed via env vars / GitHub Secrets
- [ ] CORS: restricted to production domain only
- [ ] CSP: helmet configured with strict directives
- [ ] Rate limiting: API endpoints protected (`middleware/rateLimit.ts`)
- [ ] PII encryption: AES-256-GCM for lead data at rest
- [ ] Commit-reveal: sealed bids verified on-chain
- [ ] ZK proofs: keccak256 commitment validation passing

## 📊 Monitoring

- [ ] Sentry DSN configured (backend + frontend)
- [ ] Sentry PII scrubbing: passwords, SSN, private keys redacted
- [ ] Health check: `/health` returns `status: ok`
- [ ] Uptime monitoring: external probe on `/health` (UptimeRobot, Render)
- [ ] Error alerting: Sentry alert rules for error rate > 1%

## 🧪 Testing

- [ ] Jest unit tests: all passing (`cd backend && npm test`)
- [ ] Security sim: 29/29 (`cd backend && npx jest tests/security-sim.test.ts`)
- [ ] Artillery load: 23+ scenarios, 10K peak (`npx artillery run tests/load/*.yml`)
- [ ] Cypress E2E: 53+ tests (`cd frontend && npx cypress run`)
- [ ] Contract tests: all passing (`npx hardhat test`)

## 🌐 Infrastructure

- [ ] Backend deployed on Render (auto-deploy from `main`)
- [ ] Frontend deployed on Vercel (auto-deploy from `main`)
- [ ] PostgreSQL provisioned (Render managed)
- [ ] Redis provisioned (for rate limiting + caching)
- [ ] SSL/TLS: HTTPS enforced on all endpoints

## 📜 Smart Contracts

- [ ] All 10 contracts deployed and verified on target network
- [ ] Constructor arguments documented
- [ ] Contract addresses updated in backend `.env`
- [ ] Chainlink CRE subscription funded (≥ 5 LINK)
- [ ] ACE policies registered for all target jurisdictions
- [ ] Escrow contract funded for test settlements

## 🔗 Integrations

- [ ] Alchemy RPC: API key valid, not rate-limited
- [ ] WalletConnect: project ID configured
- [ ] CRM webhooks: rate limiter + circuit breaker active
- [ ] MCP server: 12 tools responding on port 3002
- [ ] Socket.IO: WebSocket connections stable

## 🌍 i18n

- [ ] 8 locales configured (en, es, pt, zh, ar, de, fr, ja)
- [ ] Fallback to English working for untranslated keys
- [ ] RTL support: Arabic layout tested (stub)

## 📄 Documentation

- [ ] README.md: up to date with current metrics/features
- [ ] README.md § Setup & Deployment: env vars, deploy steps, troubleshooting
- [ ] MAINNET_MIGRATION.md: ready for post-hackathon
- [ ] BETA_PLAYBOOK.md: pilot plan documented
- [ ] AB_TEST_PLAN.md: experiment specs ready
- [ ] PITCH_DECK.md: current numbers match README

## 🚀 Final Pre-Submit

- [ ] `git status` clean (no uncommitted changes)
- [ ] All CI checks passing
- [ ] Demo URL accessible: https://lead-engine-cre.vercel.app
- [ ] API URL accessible: https://lead-engine-cre-api.onrender.com/health
- [ ] Loom video recorded and linked in PITCH_DECK
- [ ] Submission form completed with all required fields
