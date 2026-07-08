# Agent Developer Guide

AgentRTB is a **two-sided programmatic lead exchange**: seller agents supply via **SupplySpec** + ingest APIs; buyer agents bid via **StrategySpec** on CRE-verified, sealed auctions with vault escrow and winner-only PII.

See also: [`PRODUCT_THESIS.md`](PRODUCT_THESIS.md)

## Discovery

- `GET /.well-known/agent.json` — capabilities, endpoints, webhook events
- OpenAPI: `GET /api/swagger`

---

## Buyer quick start

```typescript
import { createAgentClient } from '@lead-engine/agent-sdk';

const client = createAgentClient({
  baseUrl: 'https://api.leadrtb.com',
  token: process.env.LEAD_ENGINE_JWT!, // or lea_... API key
});

await client.registerAgent('Solar Sniper Bot', '0xYourWallet');
const { apiKey } = await client.createApiKey('prod');
const sdk = createAgentClient({ baseUrl: 'https://api.leadrtb.com', token: apiKey });

const { spec } = await sdk.draftStrategyFromText(
  'Bid on California solar leads with quality above 70, max $50 per lead, $200 daily budget'
);
const { id } = await sdk.createStrategy(spec) as { id: string };
await sdk.activateStrategy(id);
await sdk.registerWebhook('https://your-app.com/hooks/agentrtb');
```

### Buyer authentication

| Token | How to obtain |
|-------|----------------|
| JWT | SIWE wallet login (`GET /api/v1/auth/nonce/{address}` → `POST /api/v1/auth/wallet`) |
| `lea_...` | `POST /api/v1/agent/api-keys` after `POST /api/v1/agent/register` |

Scopes: `read`, `bid`, `admin`, `simulate`. Store `lea_...` keys immediately — they cannot be retrieved again.

### StrategySpec

Versioned JSON validated by `@lead-engine/rules-engine`:

- **gates** — vertical, geo, `minQualityScore` (0–100 buyer scale), field filters
- **bidCurve** — `fixed`, `linear`, or `floorPlus`
- **budget** — hard money caps enforced server-side

**Always set `minQualityScore`** to avoid bidding on low-quality ingest that passed platform floors.

Lifecycle: draft → create → activate → simulate → traces (`GET /api/v1/agent/traces`).

### Buyer webhooks

`POST /api/v1/agent/webhooks` with events: `lead.matched`, `bid.placed`, `strategy.decision`, `auction.won`.

---

## Seller quick start

```bash
# 1. Register seller agent profile (JWT or wallet session)
POST /api/v1/seller-agent/register
{ "displayName": "Traffic Platform Bot" }

# 2. Mint lsa_ API key
POST /api/v1/seller-agent/api-keys
{ "label": "prod" }
# → store lsa_... immediately

# 3. Create and activate SupplySpec
POST /api/v1/supply
Authorization: Bearer lsa_...
{
  "spec": {
    "version": 1,
    "name": "Solar CA supply",
    "vertical": "solar.residential",
    "geoCountries": ["US"],
    "geoInclude": ["CA"],
    "reservePrice": 5,
    "dailyListingCap": 500,
    "hourlyListingCap": 100,
    "requiredFieldKeys": ["email", "phone"],
    "requireTcpaProof": true
  }
}
POST /api/v1/supply/:id/activate

# 4. Ingest leads
POST /api/v1/ingest/traffic-platform
Authorization: Bearer lsa_...
{
  "platform": "google_ads",
  "campaignId": "gads-solar-q1",
  "vertical": "solar.residential",
  "geo": { "country": "US", "state": "CA", "zip": "92101" },
  "tcpaConsentAt": "2026-06-12T10:00:00.000Z",
  "tcpaProof": { "consentId": "abc-123", "provider": "google_lead_form" },
  "fields": {
    "firstName": "Sarah",
    "email": "sarah@example.com",
    "phone": "(619) 555-0142",
    "roofAge": "5-10 years"
  }
}
```

Legacy traffic platforms may use `x-api-key: TRAFFIC_PLATFORM_API_KEY` instead of `lsa_`.

### Seller authentication

| Token | How to obtain |
|-------|----------------|
| `lsa_...` | `POST /api/v1/seller-agent/api-keys` after `POST /api/v1/seller-agent/register` |

Scopes: `read`, `supply`, `admin`.

### SupplySpec

Declarative listing policy (mirror of StrategySpec):

- vertical, geo allow/deny lists
- `reservePrice`, `maxReservePrice`, `auctionDurationSec`
- `dailyListingCap`, `hourlyListingCap`
- `requiredFieldKeys`, `minFieldCount`
- `requireTcpaProof`

CRUD: `GET/POST /api/v1/supply`, `PUT /api/v1/supply/:id`, activate/pause/archive.

### Ingest fraud requirements

API ingest **rejects** leads without:

| Control | Behavior |
|---------|----------|
| `tcpaConsentAt` + `tcpaProof` | Required on all API ingest (no server auto-stamp) |
| Phone/email dedup | HMAC fingerprints; duplicate within `DEDUP_WINDOW_HOURS` (default 72h) per vertical |
| Rate limits | Per `lsa_` key / seller (`INGEST_RATE_LIMIT_PER_HOUR`, default 100) |
| CRE `verifyLead` | Fail-closed before auction |
| `MIN_AUCTION_QUALITY_SCORE` | Platform floor (0–10000 internal); below → `CANCELLED` |

### Seller webhooks

`POST /api/v1/seller-agent/webhooks` with events:

| Event | When |
|-------|------|
| `lead.listed` | Lead passed fraud gates and entered `IN_AUCTION` |
| `auction.closed` | Auction ended (`SOLD` or `UNSOLD`) |
| `settlement.paid` | Lead sold; seller reputation updated |

Verify `X-AgentRTB-Signature` (HMAC-SHA256 of body with webhook secret).

### Seller reputation

- `GET /api/v1/seller-agent/leaderboard` — `reputationScore` (0–10000), `totalLeadsSold`
- Updated on settlement: +50 on sale, −25 on unsold close

---

## Shared stack

| Concern | Path |
|---------|------|
| Buyer bids | `bid.service.ts` |
| Settlement | `settlement-saga.service.ts` |
| Ingest fraud | `ingest-fraud.service.ts` |
| Rules | `@lead-engine/rules-engine` (StrategySpec + SupplySpec) |
| SDK | `@lead-engine/agent-sdk` |
| Buyer on-chain rep | `agent-registry.service.ts` |

## Local database bootstrap

```bash
cd backend && npm run db:bootstrap
```

Production: `prisma migrate deploy` (includes `20260613006000_two_sided_supply_fraud`).

## Environment (fraud)

| Variable | Purpose |
|----------|---------|
| `DEDUP_PEPPER` | HMAC pepper for phone/email hashes |
| `DEDUP_WINDOW_HOURS` | Dedup window (default 72) |
| `MIN_AUCTION_QUALITY_SCORE` | Platform floor (0–10000) |
| `INGEST_RATE_LIMIT_PER_HOUR` | Per-key ingest cap |
| `USE_CONFIDENTIAL_HTTP` | CHTT required in production ingest when `true` |

## Deferred (not v1)

Strategy marketplace as GTM, seller agent royalties, full A2A negotiation, Kimi chat as primary path.
