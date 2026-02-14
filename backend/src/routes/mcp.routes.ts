/**
 * MCP Agent Proxy Routes
 *
 * Proxies requests to the MCP JSON-RPC server (default: localhost:3002).
 * The /chat endpoint uses Kimi K2.5 (Moonshot AI) as the reasoning LLM.
 * Tool calls are executed via the MCP JSON-RPC server.
 */
import { Router, Request, Response } from 'express';

const router = Router();
const MCP_BASE = process.env.MCP_SERVER_URL || 'http://localhost:3002';

// ── Kimi K2.5 (Moonshot AI) Configuration ──
// Set KIMI_API_KEY in your hosting platform's environment variables
// (Render, Fly, Railway, etc.). Never commit the real key.
// If unset, the /chat endpoint falls back to keyword-based demo mode.
const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const KIMI_BASE_URL = 'https://api.kimi.com/coding';

// ── MCP tool definitions for the LLM ──

const MCP_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'search_leads',
            description: 'Search and filter available leads in the marketplace by vertical, state, price range.',
            parameters: {
                type: 'object',
                properties: {
                    vertical: { type: 'string', description: 'Lead vertical (solar, mortgage, roofing, insurance, etc.)' },
                    state: { type: 'string', description: 'US state code (e.g., CA, FL, TX)' },
                    minPrice: { type: 'number', description: 'Minimum reserve price in USDC' },
                    maxPrice: { type: 'number', description: 'Maximum reserve price in USDC' },
                    limit: { type: 'number', description: 'Max results to return', default: 5 },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'get_bid_floor',
            description: 'Get real-time bid floor pricing for a vertical. Returns floor, ceiling, and market index.',
            parameters: {
                type: 'object',
                properties: {
                    vertical: { type: 'string', description: 'Lead vertical (solar, mortgage, etc.)' },
                    country: { type: 'string', description: 'Country code', default: 'US' },
                },
                required: ['vertical'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'get_preferences',
            description: 'Get the current buyer auto-bid preference sets (per-vertical, geo filters, budgets).',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'set_auto_bid_rules',
            description: 'Configure auto-bid rules for a vertical. The engine auto-bids on matching leads.',
            parameters: {
                type: 'object',
                properties: {
                    vertical: { type: 'string', description: 'Lead vertical' },
                    autoBidEnabled: { type: 'boolean', default: true },
                    autoBidAmount: { type: 'number', description: 'Bid amount in USDC' },
                    minQualityScore: { type: 'number', description: 'Min quality score 0-10000' },
                    dailyBudget: { type: 'number', description: 'Daily budget cap in USDC' },
                    geoInclude: { type: 'array', items: { type: 'string' }, description: 'State codes to include' },
                },
                required: ['vertical', 'autoBidAmount'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'export_leads',
            description: 'Export leads as CSV or JSON for CRM integration.',
            parameters: {
                type: 'object',
                properties: {
                    format: { type: 'string', enum: ['csv', 'json'], default: 'json' },
                    status: { type: 'string', default: 'SOLD' },
                    days: { type: 'number', default: 30 },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'place_bid',
            description: 'Place a sealed bid on a specific lead.',
            parameters: {
                type: 'object',
                properties: {
                    leadId: { type: 'string', description: 'The lead ID to bid on' },
                    commitment: { type: 'string', description: 'Bid commitment hash' },
                },
                required: ['leadId', 'commitment'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'configure_crm_webhook',
            description: 'Register a CRM webhook (HubSpot, Zapier, or generic).',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'Webhook destination URL' },
                    format: { type: 'string', enum: ['hubspot', 'zapier', 'generic'], default: 'generic' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'ping_lead',
            description: 'Get full details and current status for a specific lead.',
            parameters: {
                type: 'object',
                properties: {
                    leadId: { type: 'string', description: 'The lead ID' },
                    action: { type: 'string', enum: ['status', 'evaluate'], default: 'status' },
                },
                required: ['leadId'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'suggest_vertical',
            description: 'AI-powered vertical classification from a lead description.',
            parameters: {
                type: 'object',
                properties: {
                    description: { type: 'string', description: 'Lead description text' },
                },
                required: ['description'],
            },
        },
    },
];

const SYSTEM_PROMPT = `You are an autonomous lead bidding agent for the Lead Engine CRE platform.
You help buyers discover, evaluate, and bid on commercial real-estate leads.
You have access to 9 MCP tools. Use them to answer the user's questions.
Be concise and use markdown formatting. Show numbers and data clearly.
When the user asks about leads, search for them. When asked about pricing, check bid floors.
Always explain what you found after calling a tool.`;

// ── Anthropic-format tool definitions for Kimi Code ──

const ANTHROPIC_TOOLS = MCP_TOOLS.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
}));

// ── GET /tools — list available MCP tools ──

router.get('/tools', async (_req: Request, res: Response) => {
    try {
        const response = await fetch(`${MCP_BASE}/tools`, {
            signal: AbortSignal.timeout(5000),
        });
        const data = await response.json();
        res.json(data);
    } catch (err: any) {
        res.status(502).json({ error: 'MCP server unreachable', details: err.message });
    }
});

// ── POST /rpc — proxy JSON-RPC to MCP server ──

router.post('/rpc', async (req: Request, res: Response) => {
    try {
        const response = await fetch(`${MCP_BASE}/rpc`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(req.headers['x-agent-id'] ? { 'X-Agent-Id': req.headers['x-agent-id'] as string } : {}),
            },
            body: JSON.stringify(req.body),
            signal: AbortSignal.timeout(15000),
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err: any) {
        const isTimeout = err.name === 'AbortError';
        res.status(isTimeout ? 504 : 502).json({
            jsonrpc: '2.0',
            id: req.body?.id || null,
            error: { code: isTimeout ? -32001 : -32603, message: isTimeout ? 'MCP server timeout' : 'MCP server unreachable' },
        });
    }
});

// ── POST /chat — Kimi K2.5 agent with MCP tool execution ──

interface ChatMessage {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCall?: { name: string; params: Record<string, unknown>; result?: unknown };
}

async function callKimi(messages: any[], system: string): Promise<any> {
    const response = await fetch(`${KIMI_BASE_URL}/v1/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': KIMI_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'kimi-k2.5',
            max_tokens: 4096,
            system,
            messages,
            tools: ANTHROPIC_TOOLS,
            temperature: 0.2,
        }),
        signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Kimi API error ${response.status}: ${err}`);
    }

    return response.json();
}

async function executeMcpTool(name: string, params: Record<string, unknown>): Promise<any> {
    const rpcResponse = await fetch(`${MCP_BASE}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `chat-${Date.now()}`,
            method: name,
            params,
        }),
        signal: AbortSignal.timeout(10000),
    });
    const rpcData: any = await rpcResponse.json();
    return rpcData.result || rpcData.error || {};
}

router.post('/chat', async (req: Request, res: Response) => {
    const { message, history = [] } = req.body as { message: string; history?: ChatMessage[] };

    if (!message?.trim()) {
        res.status(400).json({ error: 'Message is required' });
        return;
    }

    // If no Kimi API key, fall back to keyword-based demo
    if (!KIMI_API_KEY) {
        return fallbackChat(req, res, message, history);
    }

    try {
        // Build conversation for Kimi (Anthropic format: no system in messages)
        const llmMessages: any[] = [];

        // Include recent history (keep it concise)
        for (const h of history.slice(-6)) {
            if (h.role === 'user' || h.role === 'assistant') {
                llmMessages.push({ role: h.role, content: h.content });
            }
        }
        llmMessages.push({ role: 'user', content: message });

        const toolCallLog: ChatMessage[] = [];
        let iterations = 0;
        const MAX_ITERATIONS = 5;

        // ReAct loop: Kimi decides tools → execute → feed back → repeat
        while (iterations < MAX_ITERATIONS) {
            iterations++;
            const completion = await callKimi(llmMessages, SYSTEM_PROMPT);

            // Anthropic format: response has content[] array with text and tool_use blocks
            const contentBlocks = completion.content || [];
            const stopReason = completion.stop_reason;

            // Extract text content
            const textBlocks = contentBlocks.filter((b: any) => b.type === 'text');
            const toolUseBlocks = contentBlocks.filter((b: any) => b.type === 'tool_use');

            // Push assistant message to conversation
            llmMessages.push({ role: 'assistant', content: contentBlocks });

            // If Kimi called tools, execute them
            if (toolUseBlocks.length > 0) {
                const toolResultBlocks: any[] = [];

                for (const tu of toolUseBlocks) {
                    const toolName = tu.name;
                    const toolParams = tu.input || {};

                    const result = await executeMcpTool(toolName, toolParams);

                    // Log for frontend
                    toolCallLog.push({
                        role: 'tool',
                        content: `Called \`${toolName}\``,
                        toolCall: { name: toolName, params: toolParams, result },
                    });

                    // Anthropic tool_result format
                    toolResultBlocks.push({
                        type: 'tool_result',
                        tool_use_id: tu.id,
                        content: JSON.stringify(result),
                    });
                }

                // Feed all tool results back
                llmMessages.push({ role: 'user', content: toolResultBlocks });
                continue;
            }

            // No tool calls = final answer
            const finalText = textBlocks.map((b: any) => b.text).join('\n') || 'Done.';
            const outputMessages: ChatMessage[] = [
                { role: 'user', content: message },
                ...toolCallLog,
                { role: 'assistant', content: finalText },
            ];

            res.json({
                messages: outputMessages,
                toolCalls: toolCallLog.map((t) => t.toolCall),
                mode: 'kimi-k2.5',
            });
            return;
        }

        // Max iterations reached
        res.json({
            messages: [
                { role: 'user', content: message },
                ...toolCallLog,
                { role: 'assistant', content: 'I executed several tools but reached the iteration limit. Here are the results above.' },
            ],
            toolCalls: toolCallLog.map((t) => t.toolCall),
            mode: 'kimi-k2.5',
        });
    } catch (err: any) {
        console.error('Kimi chat error:', err.message);
        // Fall back to keyword-based if Kimi fails
        return fallbackChat(req, res, message, history);
    }
});

// ── Keyword-based fallback (when KIMI_API_KEY is not set or Kimi is unreachable) ──

function pickToolCalls(message: string): { name: string; params: Record<string, unknown> }[] {
    const lower = message.toLowerCase();
    const calls: { name: string; params: Record<string, unknown> }[] = [];

    if (lower.includes('search') || lower.includes('find') || lower.includes('browse') || lower.includes('list') || lower.includes('show me')) {
        const params: Record<string, unknown> = { limit: 5 };
        const verticals = ['solar', 'mortgage', 'roofing', 'insurance', 'hvac', 'plumbing', 'auto'];
        for (const v of verticals) { if (lower.includes(v)) { params.vertical = v; break; } }
        const stateMatch = lower.match(/\b([A-Z]{2})\b/) || lower.match(/\b(california|texas|florida|new york)\b/i);
        if (stateMatch) {
            const stateMap: Record<string, string> = { california: 'CA', texas: 'TX', florida: 'FL', 'new york': 'NY' };
            params.state = stateMap[stateMatch[1].toLowerCase()] || stateMatch[1].toUpperCase();
        }
        calls.push({ name: 'search_leads', params });
    }

    if (lower.includes('floor') || lower.includes('pricing') || lower.includes('how much') || lower.includes('price')) {
        const params: Record<string, unknown> = {};
        for (const v of ['solar', 'mortgage', 'roofing', 'insurance', 'hvac']) {
            if (lower.includes(v)) { params.vertical = v; break; }
        }
        if (!params.vertical) params.vertical = 'solar';
        calls.push({ name: 'get_bid_floor', params });
    }

    if (lower.includes('preference') || lower.includes('auto-bid') || lower.includes('autobid') || lower.includes('settings')) {
        calls.push({ name: 'get_preferences', params: {} });
    }

    if (lower.includes('export') || lower.includes('csv') || lower.includes('download')) {
        calls.push({ name: 'export_leads', params: { format: lower.includes('csv') ? 'csv' : 'json' } });
    }

    if (calls.length === 0) {
        calls.push({ name: 'search_leads', params: { limit: 5 } });
    }

    return calls;
}

async function fallbackChat(_req: Request, res: Response, message: string, history: ChatMessage[]) {
    const messages: ChatMessage[] = [...history, { role: 'user', content: message }];

    try {
        const toolCalls = pickToolCalls(message);
        const toolResults: ChatMessage[] = [];

        for (const call of toolCalls) {
            try {
                const result = await executeMcpTool(call.name, call.params);
                toolResults.push({
                    role: 'tool',
                    content: JSON.stringify(result, null, 2),
                    toolCall: { name: call.name, params: call.params, result },
                });
            } catch {
                toolResults.push({
                    role: 'tool',
                    content: `Error calling ${call.name}: MCP server unreachable`,
                    toolCall: { name: call.name, params: call.params, result: { error: 'MCP server unreachable' } },
                });
            }
        }

        const toolSummaries = toolResults.map((tr) => {
            const tc = tr.toolCall!;
            const result = tc.result as any;
            if (tc.name === 'search_leads') {
                const leads = result?.asks || result?.leads || [];
                if (leads.length === 0) return '📭 No leads found matching your criteria.';
                return `🔍 Found **${leads.length}** leads:\n${leads.slice(0, 5).map((l: any, i: number) =>
                    `  ${i + 1}. ${l.vertical || 'Unknown'} — ${l.geo?.state || 'N/A'} — Reserve: $${l.reservePrice || '?'}`
                ).join('\n')}`;
            }
            if (tc.name === 'get_bid_floor') {
                return `💰 Bid floor for **${tc.params.vertical}**: $${result?.floor || '?'} (ceiling: $${result?.ceiling || '?'})`;
            }
            if (tc.name === 'get_preferences') {
                return `⚙️ Current preferences loaded (${Object.keys(result || {}).length} fields)`;
            }
            if (tc.name === 'export_leads') {
                return `📥 Export ready (format: ${tc.params.format})`;
            }
            return `✅ \`${tc.name}\` executed successfully`;
        });

        res.json({
            messages: [...messages, ...toolResults, { role: 'assistant' as const, content: toolSummaries.join('\n\n') }],
            toolCalls: toolResults.map((tr) => tr.toolCall),
            mode: 'fallback',
        });
    } catch (err: any) {
        res.status(500).json({ error: 'Agent execution failed', details: err.message });
    }
}

export default router;
