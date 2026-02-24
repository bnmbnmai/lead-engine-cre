# MCP Agent Server — Lead Engine CRE

![Chainlink](https://img.shields.io/badge/Chainlink-CRE-brightgreen)
![Tools](https://img.shields.io/badge/Tools-13-blue)
![Protocol](https://img.shields.io/badge/Protocol-JSON--RPC%202.0-orange)

The Lead Engine CRE MCP (Model Context Protocol) server exposes **13 tools** over JSON-RPC 2.0, enabling AI agents — including the Kimi/LangChain buyer agent — to search leads, subscribe to live live-streams, place sealed bids, manage auto-bid rules, configure CRM webhooks, query granular bounties, and suggest vertical classifications.

---

## Overview

| Field | Value |
|---|---|
| Protocol | JSON-RPC 2.0 |
| Default Port | `3002` |
| Transport | HTTP POST (`/`) |
| Auth | Bearer token (same JWT as REST API) |
| Source | `mcp-server/tools.ts`, `mcp-server/server.ts` |
| Tool Count | **13** |

The MCP server is a thin proxy: each tool maps to a backend REST call (`/api/v1/*`). Authentication, rate limiting, and business logic all live in the backend.

---

## Connection

### JSON-RPC Endpoint

```
POST http://localhost:3002/
Content-Type: application/json
Authorization: Bearer <JWT>
```

### List Available Tools

```bash
curl -X POST http://localhost:3002/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Call a Tool

```bash
curl -X POST http://localhost:3002/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "query_open_granular_bounties",
      "arguments": { "vertical": "solar", "state": "CA" }
    }
  }'
```

### Production Endpoint (Render)

```
https://lead-engine-api.onrender.com
```
*(The MCP server runs in-process with the backend on Render — no separate port in production.)*

---

## Tool Reference

| # | Tool | Method | Endpoint | Required Args | Purpose |
|---|---|---|---|---|---|
| 1 | `search_leads` | GET | `/api/v1/asks` | — | Search available leads by vertical, state, price |
| 2 | `place_bid` | POST | `/api/v1/bids` | `leadId`, `commitment` | Place a sealed commit-reveal bid |
| 3 | `get_bid_floor` | GET | `/api/v1/bids/bid-floor` | `vertical` | Get suggested min/max bid for a vertical |
| 4 | `export_leads` | GET | `/api/v1/crm/export` | — | Export leads as CSV/JSON for CRM |
| 5 | `get_preferences` | GET | `/api/v1/bids/preferences/v2` | — | Get current auto-bid rules |
| 6 | `get_vertical_fields` | GET | `/api/v1/verticals/{vertical}/fields` | `vertical` | Get biddable field definitions for a vertical |
| 7 | `set_auto_bid_rules` | PUT | `/api/v1/bids/preferences/v2` | `vertical`, `autoBidAmount` | Configure auto-bid rules with field-level filters |
| 8 | `search_leads_advanced` | POST | `/api/v1/marketplace/leads/search` | `vertical` | Advanced search with field-level filter rules |
| 9 | `configure_crm_webhook` | POST | `/api/v1/crm/webhooks` | `url` | Register HubSpot/Zapier/generic webhook |
| 10 | `ping_lead` | GET | `/api/v1/leads` | `leadId` | Get full lead details and auction state |
| 11 | `suggest_vertical` | POST | `/api/v1/verticals/suggest` | `description` | AI-classify a lead description into a vertical |
| 12 | `query_open_granular_bounties` | GET | `/api/v1/bounties/available` | — | Query active USDC bounty pools (Chainlink Functions) |
| 13 | `subscribe_to_live_leads` | POST | `/api/v1/mcp/subscribe` | — | Subscribe to real-time events via Socket.io streams for instant agent reactivity |

---

## Tool Details

### 1. `search_leads`

Search active marketplace listings.

```json
{
  "name": "search_leads",
  "arguments": {
    "vertical": "solar",
    "state": "CA",
    "minPrice": 50,
    "maxPrice": 300,
    "status": "ACTIVE",
    "limit": 20,
    "offset": 0
  }
}
```

### 2. `place_bid`

Sealed commit-reveal bid. Generate commitment with `keccak256(abi.encode(amountWei, salt))`.

```json
{
  "name": "place_bid",
  "arguments": {
    "leadId": "cuid_lead_xyz",
    "commitment": "0xabc123..."
  }
}
```

### 7. `set_auto_bid_rules`

Complete auto-bid config with field-level filters. Call `get_vertical_fields` first to discover available filter keys.

```json
{
  "name": "set_auto_bid_rules",
  "arguments": {
    "vertical": "solar",
    "autoBidEnabled": true,
    "autoBidAmount": 150,
    "minQualityScore": 7000,
    "maxBidPerLead": 250,
    "dailyBudget": 2000,
    "geoInclude": ["CA", "TX", "FL"],
    "fieldFilters": {
      "creditScore": { "op": ">=", "value": "680" },
      "systemSize": { "op": ">=", "value": "8" },
      "roofType": { "op": "includes", "value": "[\"Asphalt\",\"Metal\"]" }
    }
  }
}
```

### 12. `query_open_granular_bounties`

Query USDC bounty pools before placing a bid — factor the bonus revenue into your bid strategy. Matching is verified on-chain via Chainlink Functions (`BountyMatcher` contract).

```json
{
  "name": "query_open_granular_bounties",
  "arguments": {
    "vertical": "solar",
    "state": "CA",
    "minScore": 7000
  }
}
```

**Example response:**
```json
{
  "vertical": "solar",
  "totalAvailableUSDC": 450,
  "poolCount": 2,
  "pools": [
    {
      "poolId": "pool_abc123",
      "availableUSDC": 250,
      "criteria": {
        "minQualityScore": 6000,
        "geoStates": ["CA", "TX"],
        "minCreditScore": 640,
        "maxLeadAge": 24
      }
    },
    {
      "poolId": "pool_def456",
      "availableUSDC": 200,
      "criteria": {
        "minQualityScore": 7500,
        "geoStates": ["CA"],
        "minCreditScore": null,
        "maxLeadAge": 48
      }
    }
  ],
  "contractAddress": "0x...",
  "matcherAddress": "0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D",
  "functionsEnabled": true
}
```

**Agent strategy pattern:**
```
totalBounty = query_open_granular_bounties(vertical, state).totalAvailableUSDC
effectiveCeiling = maxBid + totalBounty
→ Bid up to effectiveCeiling if bounty criteria are met
```

### 13. `subscribe_to_live_leads`

Establish a Socket.IO connection to wait for the next real-time event representing a new lead, an auction update, or a dev log. Essential for instant reactivity, mitigating the need for agents to constantly poll `search_leads`. The tool blocks until an event is received (or a 15-second timeout occurs), returning the event data and immediately unsubscribing.

```json
{
  "name": "subscribe_to_live_leads",
  "arguments": {
    "verticals": ["solar", "mortgage"]
  }
}
```

**Example response:**
```json
{
  "event": "marketplace:lead:new",
  "data": {
    "lead": {
      "id": "cuid_abc",
      "vertical": "solar",
      "reservePrice": 150
    }
  }
}
```

---

## Kimi / LangChain Integration

The Kimi K2.5 buyer agent connects via the MCP client in `backend/src/services/mcp.service.ts`. At startup, it fetches the tool list and wraps each as a structured LangChain tool.

### Environment Setup

```bash
# .env
KIMI_API_KEY=sk-...                     # Moonshot AI key
KIMI_AGENT_WALLET=0x28C2105E59D80a15...  # Dedicated agent wallet
KIMI_AGENT_USER_ID=<from seed script>
KIMI_AGENT_BUYER_PROFILE_ID=<from seed script>
MCP_SERVER_URL=http://localhost:3002
```

### Seeding the Agent Buyer

```bash
npx ts-node backend/src/scripts/seed-agent-buyer.ts
# Prints KIMI_AGENT_USER_ID and KIMI_AGENT_BUYER_PROFILE_ID — copy to .env
```

### Agent Trigger Flow

```
Lead submitted
→ Socket.IO broadcasts lead:new
→ Kimi agent via LangChain MCP client calls:
    1. get_bid_floor(vertical)
    2. query_open_granular_bounties(vertical, state)  ← bounty-aware bidding
    3. search_leads(vertical, state) [optional confirmation]
    4. set_auto_bid_rules(vertical, ...) [if rules not set]
    5. place_bid(leadId, commitment)
→ bidding.service processes bid
→ On-chain commit recorded
→ [auction close] reveal + settlement
```

---

## Live Event Subscriptions

Agents can subscribe to real-time lead and auction events via **Socket.IO** (same server as the API):

```javascript
import { io } from 'socket.io-client';

const socket = io('wss://lead-engine-api.onrender.com', {
  auth: { token: JWT }
});

// New lead available
socket.on('lead:new', (lead) => {
  // lead.id, lead.vertical, lead.reservePrice, lead.geo
  // Trigger: get_bid_floor → place_bid
});

// Auction state update
socket.on('auction:update', (data) => {
  // data.leadId, data.status, data.remainingMs, data.bidCount
});

// Auction closed
socket.on('auction:closed', (data) => {
  // data.leadId, data.winnerId, data.finalPrice
});

// Agent bid logged
socket.on('ace:dev-log', (entry) => {
  // entry.type, entry.message, entry.agentId
});
```

---

## Security Notes

### API Key Authentication
All MCP tool calls require a valid JWT in the `Authorization: Bearer <token>` header. Tokens are issued via `POST /api/v1/auth/login` and expire after 7 days.

### Rate Limiting
Backend applies `generalLimiter` middleware to all `/api/v1/*` routes. Aggressive polling (e.g., fast `search_leads` loops) will be rate-limited.

### PII Isolation
Tools never return raw PII fields. The `search_leads` and `ping_lead` tools route through `redactLeadForPreview()` — only vertical-safe parameters (e.g., `creditScore`, `roofType`) are returned. `firstName`, `email`, `phone` are never exposed.

### Sealed Bids
`place_bid` accepts only a commitment hash — not the bid amount. The actual amount is AES-256-GCM encrypted on the backend and only revealed at auction close. This prevents front-running by other agents.

---

## File Structure

```
mcp-server/
├── server.ts        — JSON-RPC 2.0 HTTP server, tool dispatch
├── tools.ts         — 12 tool definitions (name, schema, endpoint)
├── client.ts        — MCP client (used by backend/LangChain)
└── README.md        — This file
```

See [GRANULAR_BOUNTIES.md](../docs/GRANULAR_BOUNTIES.md) for the full Chainlink Functions bounty architecture.
