/**
 * Format converters — generate the per-consumer tool shapes from the
 * canonical registry.
 */

import { AGENT_TOOLS, AgentToolDef, JsonSchema, ToolSurface } from './registry';

function bySurface(surface?: ToolSurface): AgentToolDef[] {
    return surface ? AGENT_TOOLS.filter((t) => t.surfaces.includes(surface)) : AGENT_TOOLS;
}

/** mcp-server JSON-RPC proxy definition (only proxyable tools). */
export interface McpProxyToolDefinition {
    name: string;
    description: string;
    inputSchema: JsonSchema;
    handler: string;
    method: 'GET' | 'POST' | 'PUT';
}

/** Tools the MCP server can proxy to backend REST endpoints. */
export function toMcpProxyTools(): McpProxyToolDefinition[] {
    return AGENT_TOOLS
        .filter((t): t is AgentToolDef & { handler: string; method: 'GET' | 'POST' | 'PUT' } => !!t.handler && !!t.method)
        .map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            handler: t.handler,
            method: t.method,
        }));
}

/** OpenAI chat-completions function-calling format. */
export interface OpenAiFunctionTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: JsonSchema;
    };
}

export function toOpenAiFunctions(surface?: ToolSurface): OpenAiFunctionTool[] {
    return bySurface(surface).map((t) => ({
        type: 'function' as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
        },
    }));
}

/** Anthropic Messages API tool format (used by Kimi Code). */
export interface AnthropicTool {
    name: string;
    description: string;
    input_schema: JsonSchema;
}

export function toAnthropicTools(surface?: ToolSurface): AnthropicTool[] {
    return bySurface(surface).map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
    }));
}
