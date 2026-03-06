# Autonomous Agents Track

LeadRTB — Kimi K2.5 AI agent with 15 MCP tools bidding alongside human buyers

---

## Why LeadRTB Wins This Track

LeadRTB deploys a **fully autonomous AI bidding agent** powered by Kimi K2.5 + LangChain ReAct that participates in real-time lead auctions using the same on-chain vault, rule engine, and CRE workflows as human buyers — with 15 MCP tools including official `chainlink-agent-skills/cre-skills`.

## Agent Architecture

- **Kimi K2.5 LLM + LangChain ReAct** — Multi-step reasoning agent that discovers leads, evaluates quality scores, places bids, and monitors auction outcomes autonomously.
- **15 MCP Tools** — Including `get_marketplace_leads`, `place_bid`, `get_my_bids`, `check_vault_balance`, `get_cre_score`, `trigger_cre_evaluation`, `get_cre_workflow_status`, and more. Full tool definitions in `mcp-server/tools.ts`.
- **Official `chainlink-agent-skills/cre-skills`** — Integrated from `smartcontractkit/chainlink-agent-skills` repo. 3 CRE-specific tools registered in the MCP server.
- **Same On-Chain Infrastructure** — Agent bids lock USDC in `PersonalEscrowVault`, pass ACE compliance, and go through the same auction-closure path as human users. No shortcuts or bypasses.

## Evidence

- **MCP Server:** `mcp-server/` — 8 files, standalone Node.js process with 15 registered tools
- **Agent Chat Widget:** Embedded in the frontend — users can converse with the agent in real-time
- **Backend Agent Service:** `agent.service.ts` (29 KB) — full ReAct loop with tool execution
- **Live demo:** [leadrtb.com](https://leadrtb.com) — open the AI Agent chat widget to interact

<!-- Screenshot: AI Agent MCP chat widget bidding on a lead -->
