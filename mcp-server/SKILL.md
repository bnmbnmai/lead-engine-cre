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

### `set_auto_bid_rules`
Configure auto-bid rules for a vertical with score gates, geo, and budgets.

```json
{
  "method": "set_auto_bid_rules",
  "params": {
    "vertical": "solar",
    "autoBidEnabled": true,
    "autoBidAmount": 120,
    "minQualityScore": 8000,
    "maxBidPerLead": 150,
    "dailyBudget": 2000,
    "geoCountry": "US",
    "geoInclude": ["CA", "FL", "TX"],
    "acceptOffSite": false,
    "requireVerified": true
  }
}
```

### `configure_crm_webhook`
Register a CRM webhook (HubSpot, Zapier, or generic).

```json
{
  "method": "configure_crm_webhook",
  "params": {
    "url": "https://hooks.zapier.com/hooks/catch/12345/abcdef/",
    "format": "zapier",
    "events": ["lead.sold"]
  }
}
```

### `ping_lead`
Programmatic ping/post for a specific lead (status or trigger auto-bid evaluation).

```json
{
  "method": "ping_lead",
  "params": { "leadId": "lead_abc123", "action": "evaluate" }
}
```

## LangChain Autonomous Bidding Agent

Full autonomous agent with score-based rules, budget management, and CRM integration:

```python
# autonomous_bid_agent.py
from langchain.agents import Tool, AgentExecutor, create_openai_tools_agent
from langchain.chat_models import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
import requests

MCP_URL = "http://localhost:3002/rpc"
AGENT_ID = "auto-bid-agent-v2"

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

def search_leads(query: str) -> str:
    """Search for leads by vertical and state."""
    result = mcp_call("search_leads", {
        "vertical": "solar",
        "state": query[:2].upper(),
        "maxPrice": 200,
        "limit": 10,
    })
    leads = result.get("asks", [])
    return f"Found {len(leads)} leads: " + ", ".join(
        f"{l['id']} (${l.get('reservePrice', '?')})" for l in leads[:5]
    )

def setup_auto_bid(vertical_config: str) -> str:
    """Set up auto-bid rules. Input: 'solar,120,8000,CA|FL|TX'"""
    parts = vertical_config.split(",")
    vertical, amount = parts[0], float(parts[1])
    score = int(parts[2]) if len(parts) > 2 else 0
    states = parts[3].split("|") if len(parts) > 3 else []

    mcp_call("set_auto_bid_rules", {
        "vertical": vertical,
        "autoBidEnabled": True,
        "autoBidAmount": amount,
        "minQualityScore": score,
        "geoInclude": states,
        "dailyBudget": 2000,
        "acceptOffSite": False,
        "requireVerified": True,
    })
    return f"Auto-bid configured: {vertical} at ${amount}, min score {score}"

def register_crm(webhook_url: str) -> str:
    """Register a CRM webhook. Input: URL"""
    result = mcp_call("configure_crm_webhook", {
        "url": webhook_url,
        "format": "zapier",
        "events": ["lead.sold"],
    })
    return f"Webhook registered: {result}"

def ping_and_evaluate(lead_id: str) -> str:
    """Ping a lead and evaluate it for auto-bidding."""
    result = mcp_call("ping_lead", {
        "leadId": lead_id,
        "action": "evaluate",
    })
    return f"Evaluation result: {result}"

# Define tools
tools = [
    Tool(name="SearchLeads", func=search_leads,
         description="Search for leads by state code (e.g., 'CA')"),
    Tool(name="SetupAutoBid", func=setup_auto_bid,
         description="Set auto-bid rules: 'vertical,amount,minScore,STATE1|STATE2'"),
    Tool(name="RegisterCRM", func=register_crm,
         description="Register Zapier webhook URL for CRM push"),
    Tool(name="PingLead", func=ping_and_evaluate,
         description="Ping a lead and evaluate for auto-bidding"),
]

# Create agent
llm = ChatOpenAI(model="gpt-4", temperature=0)
prompt = ChatPromptTemplate.from_messages([
    ("system", """You are an autonomous lead bidding agent for the Lead Engine CRE platform.
    Your job is to:
    1. Set up auto-bid rules for specific verticals with quality score gates
    2. Register CRM webhooks so won leads flow to the buyer's CRM
    3. Search for and evaluate leads that match the buyer's criteria
    Always check bid floors before setting bid amounts.
    """),
    ("human", "{input}"),
])

agent = create_openai_tools_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# Example: Full autonomous setup
executor.invoke({
    "input": """Set up auto-bidding for solar leads:
    - Bid $120 on leads with quality score > 80 (8000)
    - Only CA, FL, TX
    - Daily budget $2000
    - Register Zapier webhook: https://hooks.zapier.com/hooks/catch/12345/abcdef/
    - Then search for CA solar leads and evaluate the top one
    """
})
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
