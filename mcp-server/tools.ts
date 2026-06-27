// ============================================
// MCP Tool Definitions — Lead Engine CRE
// ============================================
// Phase B5: definitions now come from the canonical registry in
// @lead-engine/agent-tools (packages/agent-tools). This file only adapts
// them to the JSON-RPC proxy shape. Do NOT add tool definitions here —
// add them to the registry so the backend chat route and the LangChain
// agent see them too.

import { toMcpProxyTools, McpProxyToolDefinition } from '@lead-engine/agent-tools';

export type ToolDefinition = McpProxyToolDefinition;

// Only tools with a REST handler are proxyable. In-process tools
// (subscribe_to_live_leads, batched_private_score_request, ...) are
// implemented by the backend directly and excluded here.
export const TOOLS: ToolDefinition[] = toMcpProxyTools();

// Build a lookup map
export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));
