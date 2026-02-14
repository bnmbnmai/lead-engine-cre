/**
 * MCP Agent Proxy Routes
 *
 * Proxies requests to the MCP JSON-RPC server (default: localhost:3002).
 * Also provides a demo /chat endpoint that simulates an agent reasoning loop.
 */
import { Router, Request, Response } from 'express';

const router = Router();
const MCP_BASE = process.env.MCP_SERVER_URL || 'http://localhost:3002';

// ── Tool definitions (mirrored for the demo chat) ──

const TOOL_NAMES = [
    'search_leads',
    'place_bid',
    'get_bid_floor',
    'export_leads',
    'get_preferences',
    'set_auto_bid_rules',
    'configure_crm_webhook',
    'ping_lead',
    'suggest_vertical',
] as const;

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

// ── POST /chat — demo agent reasoning loop ──
// Simulates a LangChain-style agent that:
//   1. Receives a user message
//   2. Decides which tool(s) to call
//   3. Executes tool calls via MCP /rpc
//   4. Returns the assistant response + tool call log

interface ChatMessage {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCall?: { name: string; params: Record<string, unknown>; result?: unknown };
}

// Simple keyword→tool mapping for the demo agent
function pickToolCalls(message: string): { name: string; params: Record<string, unknown> }[] {
    const lower = message.toLowerCase();
    const calls: { name: string; params: Record<string, unknown> }[] = [];

    // Search intent
    if (lower.includes('search') || lower.includes('find') || lower.includes('browse') || lower.includes('list') || lower.includes('show me')) {
        const params: Record<string, unknown> = { limit: 5 };
        // Extract vertical hints
        const verticals = ['solar', 'mortgage', 'roofing', 'insurance', 'hvac', 'plumbing', 'auto'];
        for (const v of verticals) {
            if (lower.includes(v)) { params.vertical = v; break; }
        }
        // Extract state hints
        const stateMatch = lower.match(/\b([A-Z]{2})\b/) || lower.match(/\b(california|texas|florida|new york)\b/i);
        if (stateMatch) {
            const stateMap: Record<string, string> = { california: 'CA', texas: 'TX', florida: 'FL', 'new york': 'NY' };
            params.state = stateMap[stateMatch[1].toLowerCase()] || stateMatch[1].toUpperCase();
        }
        calls.push({ name: 'search_leads', params });
    }

    // Bid floor intent
    if (lower.includes('floor') || lower.includes('pricing') || lower.includes('how much') || lower.includes('price')) {
        const params: Record<string, unknown> = {};
        const verticals = ['solar', 'mortgage', 'roofing', 'insurance', 'hvac'];
        for (const v of verticals) {
            if (lower.includes(v)) { params.vertical = v; break; }
        }
        if (!params.vertical) params.vertical = 'solar';
        calls.push({ name: 'get_bid_floor', params });
    }

    // Preferences intent
    if (lower.includes('preference') || lower.includes('auto-bid') || lower.includes('autobid') || lower.includes('settings')) {
        calls.push({ name: 'get_preferences', params: {} });
    }

    // Bid intent
    if ((lower.includes('bid') || lower.includes('place')) && lower.includes('lead')) {
        const idMatch = lower.match(/lead[_\s-]?([a-z0-9_-]+)/i) || lower.match(/clx[a-z0-9]+/i);
        if (idMatch) {
            calls.push({ name: 'place_bid', params: { leadId: idMatch[0], commitment: '0x_demo_hash' } });
        }
    }

    // Export intent
    if (lower.includes('export') || lower.includes('csv') || lower.includes('download')) {
        calls.push({ name: 'export_leads', params: { format: lower.includes('csv') ? 'csv' : 'json' } });
    }

    // Fallback: if nothing matched, search leads
    if (calls.length === 0) {
        calls.push({ name: 'search_leads', params: { limit: 5 } });
    }

    return calls;
}

router.post('/chat', async (req: Request, res: Response) => {
    const { message, history = [] } = req.body as { message: string; history?: ChatMessage[] };

    if (!message?.trim()) {
        res.status(400).json({ error: 'Message is required' });
        return;
    }

    const messages: ChatMessage[] = [...history];
    messages.push({ role: 'user', content: message });

    try {
        // Step 1: Determine tool calls
        const toolCalls = pickToolCalls(message);

        // Step 2: Execute each tool via MCP
        const toolResults: ChatMessage[] = [];
        for (const call of toolCalls) {
            try {
                const rpcResponse = await fetch(`${MCP_BASE}/rpc`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: `chat-${Date.now()}`,
                        method: call.name,
                        params: call.params,
                    }),
                    signal: AbortSignal.timeout(10000),
                });
                const rpcData: any = await rpcResponse.json();

                toolResults.push({
                    role: 'tool',
                    content: JSON.stringify(rpcData.result || rpcData.error || {}, null, 2),
                    toolCall: { name: call.name, params: call.params, result: rpcData.result || rpcData.error },
                });
            } catch {
                toolResults.push({
                    role: 'tool',
                    content: `Error calling ${call.name}: MCP server unreachable`,
                    toolCall: { name: call.name, params: call.params, result: { error: 'MCP server unreachable' } },
                });
            }
        }

        // Step 3: Generate assistant summary
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

        const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: toolSummaries.join('\n\n'),
        };

        res.json({
            messages: [...messages, ...toolResults, assistantMessage],
            toolCalls: toolResults.map((tr) => tr.toolCall),
        });
    } catch (err: any) {
        res.status(500).json({ error: 'Agent execution failed', details: err.message });
    }
});

export default router;
