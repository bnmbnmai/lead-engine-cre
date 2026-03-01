# Environment Variables

All required and optional environment variables for LeadRTB.

## Backend (`backend/.env`)

### Core

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | ✅ | `development` | `production` / `development` / `test` |
| `PORT` | ✅ | `3001` | API server port |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | — | HMAC secret for auth tokens |
| `FRONTEND_URL` | ⚠️ | `*` | CORS allow-list origin (Vercel URL) |
| `DEMO_MODE` | ❌ | `false` | Enable demo-mode middleware bypass |

### Blockchain (Base Sepolia)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | ✅ | — | EOA signing key for on-chain txs |
| `PLATFORM_WALLET_ADDRESS` | ⚠️ | — | Platform fee recipient (deployer address) |
| `RPC_URL_BASE_SEPOLIA` | ✅ | `https://sepolia.base.org` | Base Sepolia JSON-RPC |
| `RPC_URL_SEPOLIA` | ❌ | — | Ethereum Sepolia fallback RPC |
| `ALCHEMY_API_KEY` | ❌ | — | Alchemy API key (premium RPC) |

### Smart Contracts

| Variable | Required | Default | Description |
|---|---|---|---|
| `RTB_ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA` | ✅ | — | PersonalEscrowVault proxy |
| `VAULT_ADDRESS_BASE_SEPOLIA` | ✅ | — | PersonalEscrowVault implementation |
| `USDC_CONTRACT_ADDRESS` | ✅ | — | USDC token (Base Sepolia) |
| `LEAD_NFT_CONTRACT_ADDRESS_BASE_SEPOLIA` | ✅ | — | LeadNFTv2 contract |
| `CRE_CONTRACT_ADDRESS_BASE_SEPOLIA` | ✅ | — | CREVerifier on-chain |
| `ACE_CONTRACT_ADDRESS` | ❌ | — | ACE ComplianceEngine (optional on-chain) |
| `ACE_COMPLIANCE_ADDRESS` | ❌ | — | ACE compliance policy (alias) |
| `VERTICAL_AUCTION_ADDRESS` | ❌ | — | VerticalAuction contract |
| `VERTICAL_NFT_ADDRESS` | ❌ | — | VerticalNFT contract |
| `VRF_TIE_BREAKER_ADDRESS` | ❌ | — | VRFTieBreaker contract |

### Chainlink Services

| Variable | Required | Default | Description |
|---|---|---|---|
| `CRE_API_KEY` | ⚠️ | — | API key for CRE workflow auth |
| `CRE_WORKFLOW_ENABLED` | ❌ | `false` | Enable live CRE DON workflows |
| `USE_CONFIDENTIAL_HTTP` | ❌ | `false` | Enable CHTT confidential HTTP |
| `USE_BATCHED_PRIVATE_SCORE` | ❌ | `false` | Enable batched private scoring |
| `CHAINLINK_PRICE_FEED_ADDRESS` | ❌ | hardcoded | ETH/USD Data Feed address |
| `VRF_SUBSCRIPTION_ID` | ❌ | — | VRF v2.5 subscription ID |
| `BOUNTY_MATCHER_ADDRESS` | ❌ | `0x897f...` | BountyMatcher (Functions) |
| `BOUNTY_FUNCTIONS_ENABLED` | ❌ | `true` | Enable Functions bounty matching |
| `BOUNTY_POOL_ADDRESS` | ❌ | — | Bounty pool contract |
| `FUNCTIONS_SUBSCRIPTION_ID` | ❌ | `581` | Chainlink Functions sub ID |

### Privacy & Encryption

| Variable | Required | Default | Description |
|---|---|---|---|
| `PRIVACY_ENCRYPTION_KEY` | ✅ | — | 64-char hex key for PII AES-256 encryption. **Set once — never regenerate** |

### AI Agent (MCP)

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | ❌ | — | OpenAI API key for AI agent |
| `OPENAI_BASE_URL` | ❌ | — | Custom OpenAI-compatible API base |
| `OPENAI_MODEL` | ❌ | `gpt-4o-mini` | Model for AI agent chat |
| `KIMI_API_KEY` | ❌ | — | Kimi (Moonshot) API key |
| `KIMI_BASE_URL` | ❌ | — | Kimi base URL |
| `MCP_API_KEY` | ❌ | — | MCP server auth key |
| `MCP_SERVER_URL` | ❌ | — | MCP server endpoint |

### Misc

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDIS_URL` | ❌ | — | Redis URL for caching (optional) |
| `CRM_WEBHOOK_URL` | ❌ | — | External CRM webhook for conversion events |
| `MAX_REAUCTIONS_PER_CYCLE` | ❌ | `3` | Max re-auctions per demo cycle |
| `VERTICAL_SUGGEST_THRESHOLD` | ❌ | `0.7` | Vertical auto-suggest confidence |
| `MARKETPLACE_ADDRESS` | ❌ | — | Marketplace contract (legacy) |
| `TEST_API_TOKEN` | ❌ | — | Pre-shared test/CI auth token |
| `RENDER_EXTERNAL_URL` | ❌ | — | Auto-set by Render (public URL) |

## Frontend (`frontend/.env.local`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_API_URL` | ✅ | `http://localhost:3001` | Backend API base URL |
| `VITE_WS_URL` | ❌ | same as API | WebSocket server URL |

## Legend

- ✅ **Required** — app will not start or will error without this
- ⚠️ **Recommended** — works without it but some features will be degraded
- ❌ **Optional** — only needed for specific features
