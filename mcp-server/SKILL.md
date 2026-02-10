---
name: lead-engine-cre-agent
description: Programmatic lead bidding via MCP — search, bid, export with CCIP-ready architecture
---

# Lead Engine CRE — Agent Skill

Enables AI agents to programmatically discover, bid on, and export CRE leads via the MCP JSON-RPC server.

## Quick Start

```bash
# 1. Start the backend API (port 3001)
cd backend && npm run dev

# 2. Start the MCP server (port 3002)
cd mcp-server && npm run dev

# 3. Test a tool call
curl -X POST http://localhost:3002/rpc \
  -H "Content-Type: application/json" \
  -H "X-Agent-Id: my-solar-agent" \
  -d '{"method":"search_leads","params":{"vertical":"solar","state":"CA"}}'
```

## Available Tools

### `search_leads`
Search and filter marketplace leads.

```json
{
  "method": "search_leads",
  "params": {
    "vertical": "solar",
    "state": "CA",
    "maxPrice": 150,
    "limit": 10
  }
}
```

### `place_bid`
Submit a bid on a lead.

```json
{
  "method": "place_bid",
  "params": {
    "leadId": "lead_abc123",
    "amount": 150
  }
}
```

### `get_bid_floor`
Get real-time bid floor pricing (Data Streams stub).

```json
{
  "method": "get_bid_floor",
  "params": { "vertical": "solar", "country": "US" }
}
```

### `export_leads`
Export leads for CRM integration.

```json
{
  "method": "export_leads",
  "params": { "format": "json", "status": "SOLD", "days": 7 }
}
```

### `get_preferences`
Read buyer preference sets (per-vertical auto-bid, geo, budgets).

```json
{ "method": "get_preferences", "params": {} }
```

## LangChain Integration Example

Autonomous solar bid agent that checks bid floors and places bids:

```python
# solar_bid_agent.py
from langchain.agents import Tool, AgentExecutor
from langchain.chat_models import ChatOpenAI
import requests

MCP_URL = "http://localhost:3002/rpc"
AGENT_ID = "solar-bid-agent-v1"

def mcp_call(method: str, params: dict) -> dict:
    """Call an MCP tool and return the result."""
    resp = requests.post(MCP_URL, json={
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }, headers={"X-Agent-Id": AGENT_ID})
    data = resp.json()
    if "error" in data:
        raise Exception(f"MCP error: {data['error']}")
    return data.get("result", {})

def search_solar_leads(query: str) -> str:
    """Search for solar leads in a given state."""
    # Parse state from query (e.g., "CA leads under $120")
    result = mcp_call("search_leads", {
        "vertical": "solar",
        "state": query[:2].upper(),
        "maxPrice": 200,
        "limit": 5,
    })
    leads = result.get("asks", [])
    return f"Found {len(leads)} solar leads: " + ", ".join(
        f"{l['id']} (${l.get('reservePrice', '?')})" for l in leads[:5]
    )

def get_solar_floor(country: str = "US") -> str:
    """Get current bid floor for solar leads."""
    result = mcp_call("get_bid_floor", {"vertical": "solar", "country": country})
    floor = result.get("bidFloor", {})
    return f"Solar bid floor: ${floor.get('bidFloor', '?')} - ${floor.get('bidCeiling', '?')}"

def place_solar_bid(lead_id: str) -> str:
    """Place a $150 bid on a solar lead."""
    result = mcp_call("place_bid", {"leadId": lead_id, "amount": 150})
    return f"Bid placed: {result}"

# Define tools
tools = [
    Tool(name="SearchSolarLeads", func=search_solar_leads,
         description="Search for solar leads by state"),
    Tool(name="GetSolarFloor", func=get_solar_floor,
         description="Get current solar bid floor price"),
    Tool(name="PlaceSolarBid", func=place_solar_bid,
         description="Place a $150 bid on a solar lead by ID"),
]

# Create agent
llm = ChatOpenAI(model="gpt-4", temperature=0)
agent = AgentExecutor.from_agent_and_tools(
    agent=...,  # Your agent config
    tools=tools,
    verbose=True,
)

# Run: "Find CA solar leads under $120 and bid on the best one"
agent.run("Find solar leads in California under $120 and place a bid on the cheapest one")
```

## Signless Abstraction

Agents use **API keys** instead of wallet signatures for authentication:

| Concern | Solution |
|---------|----------|
| **No wallet needed** | Agents authenticate via `Authorization: Bearer <API_KEY>` header |
| **No MetaMask popups** | Server-side signing for on-chain txs (DEPLOYER_PRIVATE_KEY) |
| **Rate limiting** | 100 req/min per API key (configurable in backend) |
| **Audit trail** | All agent actions logged with agent ID in `mcp-server/logs/` |

For on-chain settlement, the backend handles wallet signing transparently — agents never touch private keys.

## CCIP-Ready Architecture

The MCP server is designed for future Chainlink CCIP cross-chain bidding:

```
Agent (any chain) → MCP Server → Backend API → CCIP Message
                                                    ↓
                                    Destination Chain (Base Sepolia)
                                                    ↓
                                    Marketplace.sol → commitBid()
```

When CCIP access is available:
1. Agent calls `place_bid` with `{ chain: "arbitrum" }` param
2. MCP server routes to CCIP sender contract
3. Bid is delivered cross-chain to the destination marketplace
4. Settlement happens on the destination chain

## Error Handling

All errors include structured codes and retry guidance:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "retry_after_seconds": 5,
    "retry_guidance": "Retry this call after 5s"
  }
}
```

| Code | HTTP | Meaning |
|------|------|---------|
| `LEAD_NOT_FOUND` | 404 | Lead ID doesn't exist |
| `BID_TOO_LOW` | 400 | Bid below reserve price |
| `RATE_LIMITED` | 429 | Too many requests — retry after N seconds |
| `AUTH_FAILED` | 401 | Invalid or missing API key |
| `VALIDATION_ERROR` | 400 | Invalid params |
| `UPSTREAM_ERROR` | 500 | Backend returned error |
| `TIMEOUT` | 504 | Backend didn't respond within 15s |

## Agent Failure Patterns

| Failure | Recommended Action |
|---------|-------------------|
| `RATE_LIMITED` | Exponential backoff: 5s → 10s → 20s |
| `TIMEOUT` | Retry once after 3s; if repeated, check backend health at `/health` |
| `AUTH_FAILED` | Verify API key in env; keys don't expire but may be revoked |
| `BID_TOO_LOW` | Call `get_bid_floor` to recalibrate, then rebid |
| Network error | Check MCP server is running on port 3002 |
