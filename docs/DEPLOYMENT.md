# Deployment Guide — Lead Engine CRE

## Prerequisites

- Node.js 18+, npm 9+
- PostgreSQL 14+ or Render PostgreSQL
- Alchemy account (free tier: [alchemy.com](https://alchemy.com))
- MetaMask wallet with Sepolia ETH ([faucet.chainlink.com](https://faucets.chain.link))
- GitHub account

---

## 1. Deploy Contracts (Sepolia + Base Sepolia)

### 1a. Set deployer key

```bash
# In backend/.env
DEPLOYER_PRIVATE_KEY=0x...your_private_key
ALCHEMY_API_KEY=your_alchemy_key
```

### 1b. Deploy

```powershell
# Deploy to Sepolia (default)
.\scripts\deploy-contracts.ps1

# Deploy to Base Sepolia
.\scripts\deploy-contracts.ps1 -Network baseSepolia

# Deploy to both
.\scripts\deploy-contracts.ps1 -Network both
```

### 1c. Save addresses

Copy the outputted contract addresses into `backend/.env`:

```env
ACE_CONTRACT_ADDRESS=0x...
LEAD_NFT_ADDRESS=0x...
ESCROW_CONTRACT_ADDRESS=0x...
MARKETPLACE_ADDRESS=0x...
CRE_CONTRACT_ADDRESS=0x...
```

### 1d. Fund Chainlink Functions subscription

1. Go to [functions.chain.link](https://functions.chain.link)
2. Create a subscription on Sepolia
3. Fund with LINK
4. Add `CRE_CONTRACT_ADDRESS` as consumer
5. Note the subscription ID → set `CRE_SUBSCRIPTION_ID` in env

---

## 2. Deploy Backend (Render)

### Option A: Render Blueprint (recommended)

1. Push code to GitHub (`bnmbnmai/lead-engine-cre`)
2. Go to [dashboard.render.com](https://dashboard.render.com)
3. Click **New → Blueprint**
4. Connect the repo → Render reads `render.yaml` automatically
5. Set the `sync: false` env vars manually:
   - `FRONTEND_URL` → your Vercel URL (set after step 3)
   - `ALCHEMY_API_KEY`, `RPC_URL_SEPOLIA` → from Alchemy
   - Contract addresses from step 1c
   - `DEPLOYER_PRIVATE_KEY` → same deployer wallet
6. Deploy

### Option B: Manual setup

1. New → Web Service → Connect repo
2. **Build:** `cd backend && npm install && npx prisma generate && npm run build`
3. **Start:** `cd backend && npm run start`
4. Add PostgreSQL (New → PostgreSQL)
5. Set env vars per `docs/ENV_HANDOFF.md`

### Seed Mock Data (for demo)

```bash
cd backend
npm run db:seed        # Seeds 200+ mock entries
npm run db:clear-mock  # Removes only mock data (0xMOCK prefix)
```

### Verify

```bash
curl https://lead-engine-cre-api.onrender.com/health
# Expected: {"status":"ok"}

curl https://lead-engine-cre-api.onrender.com/api/v1/bids/bid-floor?vertical=solar&country=US
# Expected: bid floor data with isStub: true

open https://lead-engine-cre-api.onrender.com/api/swagger
```

---

## 3. Deploy Frontend (Vercel)

1. Go to [vercel.com](https://vercel.com)
2. **Import** → Select `bnmbnmai/lead-engine-cre`
3. **Framework Preset:** Vite
4. **Root Directory:** `frontend`
5. **Environment Variables:**

| Variable | Value |
|---------|-------|
| `VITE_API_URL` | `https://lead-engine-cre-api.onrender.com` |
| `VITE_APP_URL` | `https://lead-engine-cre.vercel.app` |
| `VITE_WALLETCONNECT_PROJECT_ID` | From WalletConnect Cloud |
| `VITE_ALCHEMY_API_KEY` | Your Alchemy key |
| `VITE_DEFAULT_CHAIN_ID` | `11155111` (Sepolia) |
| `VITE_ENABLE_TESTNET` | `true` |

> **Note:** Vite app — use `VITE_` prefix, not `NEXT_PUBLIC_`.

6. Deploy
7. Go back to Render → set `FRONTEND_URL` to the Vercel URL

---

## 4. MCP Agent Server (Local)

The MCP server runs locally during development and demos:

```bash
cd mcp-server
npm install
npm run dev   # Starts on port 3002
```

### Environment

```env
# mcp-server/.env (create this)
API_BASE_URL=http://localhost:3001     # or Render URL for remote
API_KEY=your_api_key_here              # matches backend auth
MCP_PORT=3002
```

### Verify

```bash
# Health check
curl http://localhost:3002/health

# List tools
curl http://localhost:3002/tools

# Test tool call
curl -X POST http://localhost:3002/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"search_leads","params":{"vertical":"solar","state":"CA"}}'
```

---

## 5. Post-Deploy Checklist

- [ ] Backend health check returns 200
- [ ] Frontend loads without console errors
- [ ] Landing page hero renders with stats bar
- [ ] Wallet connects (MetaMask on Sepolia)
- [ ] No sidebar visible before login
- [ ] `/api/v1/demo/e2e-bid` returns full pipeline results
- [ ] `/api/v1/demo/compliance-check` shows ACE enforcement
- [ ] `/api/v1/bids/bid-floor?vertical=solar&country=US` returns bid floor
- [ ] `/api/v1/crm/export?format=json` returns lead export
- [ ] `/api/swagger` loads Swagger UI
- [ ] MCP server: `POST /rpc` with `search_leads` returns results
- [ ] Contracts verified on Sepolia Etherscan
- [ ] CORS: frontend can call backend API
- [ ] WebSocket connection established
- [ ] Mock data seeded (200+ entries)
- [ ] "Push to CRM" button visible on Buyer Dashboard

---

## 6. Run Full Test Suite (Pre-Submission)

```bash
# Backend type-check
cd backend && npx tsc --noEmit

# Frontend build
cd frontend && npm run build

# MCP server type-check
cd mcp-server && npx tsc --noEmit

# Security compliance sim (29 tests)
cd backend && npx ts-node --compiler-options '{"module":"commonjs"}' ../scripts/security-compliance-sim.ts

# Testnet simulation (dry run)
npx ts-node scripts/testnet-sim.ts --network hardhat --bids 20 --wallets 3 --dry-run

# Artillery load test (13 scenarios, 1500 peak)
cd backend && npm run test:load

# Cypress E2E (38 UI tests)
cd frontend && npx cypress run
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `prisma generate` fails on Render | Ensure `prisma` is in `devDependencies` and `npm install` runs first |
| Frontend proxy 404 | In production, frontend calls absolute API URL (not `/api` proxy) |
| Wallet won't connect on Vercel | Ensure `VITE_WALLETCONNECT_PROJECT_ID` is set |
| Contract deploy fails | Check deployer has Sepolia ETH |
| CORS blocked | Set `FRONTEND_URL` on Render to exact Vercel domain (no trailing slash) |
| `ERR_UNKNOWN_FILE_EXTENSION` | Use `--compiler-options '{"module":"commonjs"}'` flag |
| Mock data not appearing | Ensure `TEST_MODE=true` is set in env |
| MCP server 401 | Set `API_KEY` in `mcp-server/.env` matching backend auth |
| DECO/Streams timeout | Stubs auto-fallback with cached data — check `DECO_TIMEOUT_MS` env |
| Agent logs missing | Ensure `mcp-server/logs/` directory is writable |
