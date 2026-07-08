/**
 * MCP Agent Proxy Routes
 *
 * Proxies requests to the MCP JSON-RPC server (default: localhost:3002).
 * The /chat endpoint uses Kimi K2.5 (Moonshot AI) as the reasoning LLM.
 * Tool calls are executed via the MCP JSON-RPC server.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { toAnthropicTools, buildSystemPrompt } from '@lead-engine/agent-tools';

const router = Router();

// All MCP proxy routes require an authenticated session. Tool execution
// performs real actions (bids, auto-bid rules, exports) so anonymous
// access is never allowed.
router.use(authMiddleware);

const MCP_BASE = process.env.MCP_SERVER_URL || 'http://localhost:3002';
// Shared secret for INBOUND auth at the MCP server (MCP_SERVER_TOKEN there).
// Falls back to MCP_API_KEY for backwards compatibility.
const MCP_SERVER_TOKEN = process.env.MCP_SERVER_TOKEN || process.env.MCP_API_KEY || '';

if (!MCP_SERVER_TOKEN) {
    console.warn('[mcp.routes] ⚠️  MCP_SERVER_TOKEN not set — outbound MCP server calls will be unauthenticated.');
}

/** Build auth headers for outbound calls to the MCP server. */
function mcpHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
    if (MCP_SERVER_TOKEN) {
        h['Authorization'] = `Bearer ${MCP_SERVER_TOKEN}`;
        h['X-Mcp-Token'] = MCP_SERVER_TOKEN;
    }
    return h;
}

// ── Kimi K2.5 (Moonshot AI) Configuration ──
// Set KIMI_API_KEY in your hosting platform's environment variables
// (Render, Fly, Railway, etc.). Never commit the real key.
// If unset, the /chat endpoint falls back to keyword-based demo mode.
const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const KIMI_BASE_URL = 'https://api.kimi.com/coding';

// ── MCP tool definitions for the LLM (Phase B5: canonical registry) ──
// Definitions live in @lead-engine/agent-tools (packages/agent-tools) and
// are shared with the MCP server proxy and the LangChain agent. The 'chat'
// surface includes every proxyable tool plus the in-process tools this
// route implements (batched_private_score_request, subscribe_to_live_leads).

const ANTHROPIC_TOOLS = toAnthropicTools('chat');
const SYSTEM_PROMPT = buildSystemPrompt();

// ── GET /tools — list available MCP tools ──

router.get('/tools', async (_req: Request, res: Response) => {
    try {
        const response = await fetch(`${MCP_BASE}/tools`, {
            headers: mcpHeaders(),
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
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MCP_RPC !== 'true') {
        return res.status(403).json({
            jsonrpc: '2.0',
            id: req.body?.id || null,
            error: {
                code: -32601,
                message: 'MCP RPC disabled in production. Use REST API with lea_ API keys.',
            },
        });
    }

    const authHeader = req.headers.authorization || '';
    const callerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    try {
        const response = await fetch(`${MCP_BASE}/rpc`, {
            method: 'POST',
            headers: mcpHeaders({
                ...(req.headers['x-agent-id'] ? { 'X-Agent-Id': req.headers['x-agent-id'] as string } : {}),
                ...(callerToken ? { 'X-Caller-Authorization': `Bearer ${callerToken}` } : {}),
            }),
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

// ── PII sanitization — strip sensitive fields from tool results ──

const PII_FIELDS = new Set([
    'phone', 'email', 'firstName', 'lastName', 'fullName', 'name',
    'address', 'streetAddress', 'street', 'city', 'zip', 'zipCode',
    'ssn', 'dateOfBirth', 'dob', 'ip', 'ipAddress',
    'contactName', 'contactEmail', 'contactPhone',
]);

function sanitizeLeadData(data: any): any {
    if (Array.isArray(data)) return data.map(sanitizeLeadData);
    if (data && typeof data === 'object') {
        const clean: any = {};
        for (const [key, value] of Object.entries(data)) {
            if (PII_FIELDS.has(key)) continue;
            clean[key] = sanitizeLeadData(value);
        }
        return clean;
    }
    return data;
}

async function searchLeadsLocal(params: Record<string, unknown>): Promise<any> {
    const where: any = { status: 'IN_AUCTION' };
    if (params.vertical) where.vertical = { contains: params.vertical as string, mode: 'insensitive' };
    if (params.state) where.geo = { path: ['state'], equals: params.state };
    if (params.minPrice || params.maxPrice) {
        where.reservePrice = {};
        if (params.minPrice) where.reservePrice.gte = Number(params.minPrice);
        if (params.maxPrice) where.reservePrice.lte = Number(params.maxPrice);
    }
    const limit = Math.min(Number(params.limit) || 5, 10);
    const leads = await prisma.lead.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
            seller: { select: { reputationScore: true, isVerified: true, companyName: true } },
            _count: { select: { bids: true } },
        },
    });
    return sanitizeLeadData({ leads });
}

/**
 * Guard for place_bid (shared with the LangChain path — see agent-guards.ts):
 * auction-state check + budget caps (maxBidPerLead / dailyBudget) before
 * delegating to the MCP server. Prevents the agent from bidding on a closed
 * lead or blowing past its configured spend limits.
 */
async function mcpPlaceBid(params: Record<string, unknown>): Promise<unknown> {
    const leadId = params.leadId as string | undefined;
    if (!leadId) return { error: 'place_bid: leadId is required' };

    const { checkAgentBidGuards, decodeCommitmentAmount, resolveAgentBuyerUserId } = await import('../services/agent-guards');
    const guard = await checkAgentBidGuards({
        leadId,
        buyerUserId: await resolveAgentBuyerUserId(),
        amount: decodeCommitmentAmount(params.commitment as string | undefined),
    });
    if (!guard.allowed) {
        return { error: `place_bid: ${guard.reason}` };
    }

    // Guard passed — delegate to MCP server
    const rpcResponse = await fetch(`${MCP_BASE}/rpc`, {
        method: 'POST',
        headers: mcpHeaders(),
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `place-bid-${Date.now()}`,
            method: 'place_bid',
            params,
        }),
        signal: AbortSignal.timeout(10000),
    });
    const rpcData: any = await rpcResponse.json();
    return sanitizeLeadData(rpcData.result || rpcData.error || {});
}

async function executeMcpTool(name: string, params: Record<string, unknown>): Promise<any> {
    // For search_leads, prefer local DB query to get real lead IDs
    if (name === 'search_leads') {
        try {
            return await searchLeadsLocal(params);
        } catch (err) {
            console.warn('[MCP] Local search_leads failed, falling back to MCP server:', err);
        }
    }

    // place_bid demoted (Option A) — direct LLM bidding replaced by StrategySpec executor
    if (name === 'place_bid') {
        return {
            error: 'place_bid is deprecated for agent buyers. Create and activate a StrategySpec (create_strategy → activate_strategy) so the deterministic executor places sealed bids.',
        };
    }

    // query_open_granular_bounties — query the bounty service in-process
    if (name === 'query_open_granular_bounties') {
        try {
            const { bountyService } = await import('../services/bounty.service');
            const vertical = params.vertical as string | undefined;
            return await bountyService.getAvailableBounties(vertical);
        } catch (err: any) {
            return { error: `query_open_granular_bounties failed: ${err.message}` };
        }
    }

    // batched_private_score_request — Phase 2 CHTT batched confidential score
    if (name === 'batched_private_score_request') {
        const { executeBatchedPrivateScore } = await import('../lib/chainlink/batched-private-score');
        const { computeCREQualityScore } = await import('../lib/chainlink/cre-quality-score');
        const leadId = params.leadId as string | undefined;
        if (!leadId) return { error: 'batched_private_score_request: leadId is required' };

        const lead = await prisma.lead.findUnique({
            where: { id: leadId },
            select: {
                id: true, tcpaConsentAt: true, geo: true, encryptedData: true,
                parameters: true, source: true, qualityScore: true, isVerified: true,
            },
        });
        if (!lead) return { error: `batched_private_score_request: lead ${leadId} not found` };

        const geo = lead.geo as any;
        const params2 = lead.parameters as any;
        const paramCount = params2 ? Object.keys(params2).filter((k) => !k.startsWith('_') && params2[k] != null).length : 0;
        let encValid = false;
        if (lead.encryptedData) { try { const p = JSON.parse(lead.encryptedData); encValid = !!(p.ciphertext && p.iv && p.tag); } catch { /* */ } }

        const scoringInput = {
            tcpaConsentAt: lead.tcpaConsentAt,
            geo: geo || null,
            hasEncryptedData: !!lead.encryptedData,
            encryptedDataValid: encValid,
            parameterCount: paramCount,
            source: (lead.source as string) || 'OTHER',
            zipMatchesState: false,
        };

        try {
            const out = await executeBatchedPrivateScore(leadId, scoringInput, false);
            return {
                leadId,
                score: out.result.score,
                fraudBonus: out.result.fraudBonus,
                aceCompliant: out.result.aceCompliant,
                encrypted: out.envelope.encrypted,
                latencyMs: out.latencyMs,
                phase: out.phase,
                isPhase2: true,
            };
        } catch (err: any) {
            return { error: `batched_private_score_request failed: ${err.message}` };
        }
    }

    if (name === 'subscribe_to_live_leads') {
        const { aceDevBus } = await import('../services/ace.service');
        const io = require('socket.io-client');
        return new Promise((resolve) => {
            const socket = io(process.env.API_BASE_URL || 'http://localhost:3001');
            const verts = params.verticals as string[] | undefined;

            aceDevBus.emit('ace:dev-log', {
                level: 'info',
                message: `Agent subscribed to live stream ${verts ? `(${verts.join(',')})` : '(all verticals)'}`,
                module: 'Agent',
            });

            const cleanup = (res: any) => {
                socket.disconnect();
                resolve(res);
            };

            socket.on('marketplace:lead:new', (data: any) => {
                if (verts && data.lead && !verts.includes(data.lead.vertical)) return;
                aceDevBus.emit('ace:dev-log', { level: 'success', message: 'Agent received new lead via live stream', module: 'Agent' });
                cleanup({ event: 'marketplace:lead:new', data });
            });

            socket.on('auction:updated', (data: any) => cleanup({ event: 'auction:updated', data }));
            socket.on('ace:dev-log', (data: any) => cleanup({ event: 'ace:dev-log', data }));

            setTimeout(() => cleanup({ status: 'timeout', message: 'No events received in 15 seconds. You can call subscribe again.' }), 15000);
        });
    }

    const rpcResponse = await fetch(`${MCP_BASE}/rpc`, {
        method: 'POST',
        headers: mcpHeaders(),
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `chat-${Date.now()}`,
            method: name,
            params,
        }),
        signal: AbortSignal.timeout(10000),
    });
    const rpcData: any = await rpcResponse.json();
    const result = rpcData.result || rpcData.error || {};
    return sanitizeLeadData(result);
}

router.post('/chat', async (req: Request, res: Response) => {
    const { message, history = [] } = req.body as { message: string; history?: ChatMessage[] };

    if (!message?.trim()) {
        res.status(400).json({ error: 'Message is required' });
        return;
    }

    if (!KIMI_API_KEY) {
        return fallbackChat(req, res, message, history);
    }

    // ── Priority 1: LangChain agent ──
    try {
        const { runAgent } = await import('../services/agent.service');
        const result = await runAgent(message, history);
        res.json(result);
        return;
    } catch (err: any) {
        console.warn('[MCP] LangChain agent failed, falling back to raw Kimi:', err.message);
    }

    // ── Priority 2: Raw Kimi ReAct loop ──

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
            const _stopReason = completion.stop_reason;

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

    if (lower.includes('bounty') || lower.includes('bounties') || lower.includes('demand signal') || lower.includes('buyer demand')) {
        const params: Record<string, unknown> = {};
        for (const v of ['solar', 'mortgage', 'roofing', 'insurance', 'hvac']) {
            if (lower.includes(v)) { params.vertical = v; break; }
        }
        calls.push({ name: 'query_open_granular_bounties', params });
    }

    if (calls.length === 0) {
        calls.push({ name: 'search_leads', params: { limit: 5 } });
    }

    return calls;
}

// ── Navigation intent detection ──

const NAV_ROUTES: { keywords: string[]; path: string; label: string; response: string }[] = [
    { keywords: ['marketplace', 'browse leads', 'browse the marketplace'], path: '/marketplace', label: 'Marketplace', response: '🏪 Here you go — [Open Marketplace](/marketplace)' },
    { keywords: ['my dashboard', 'go home', 'home', 'dashboard'], path: '/buyer', label: 'Dashboard', response: '🏠 [Go to Dashboard](/buyer)' },
    { keywords: ['my bids', 'bid history', 'bids i placed'], path: '/buyer/bids', label: 'My Bids', response: '📋 [View My Bids](/buyer/bids)' },
    { keywords: ['portfolio', 'purchased leads', 'won leads', 'my leads'], path: '/buyer/portfolio', label: 'Portfolio', response: '💼 [View My Portfolio](/buyer/portfolio) — your purchased leads' },
    { keywords: ['auto-bid', 'autobid', 'preference', 'auto bid', 'settings', 'bidding rules'], path: '/buyer/preferences', label: 'Preferences', response: '⚙️ [Open Preferences](/buyer/preferences) — manage your auto-bid rules and verticals' },
    { keywords: ['my analytics', 'my stats', 'my performance', 'buyer analytics'], path: '/buyer/analytics', label: 'Analytics', response: '📊 [View Analytics](/buyer/analytics)' },
    { keywords: ['integration', 'api key', 'webhook'], path: '/buyer/integrations', label: 'Integrations', response: '🔗 [Open Integrations](/buyer/integrations) — API keys, webhooks, and agent config' },
    { keywords: ['seller dashboard', 'sell dashboard'], path: '/seller', label: 'Seller Dashboard', response: '🏢 [Open Seller Dashboard](/seller)' },
    { keywords: ['seller leads', 'my listings'], path: '/seller/leads', label: 'Seller Leads', response: '📄 [View Seller Leads](/seller/leads)' },
    { keywords: ['funnel', 'landing page', 'lead capture', 'form builder'], path: '/seller/funnels', label: 'Funnels', response: '📝 [Open Funnels](/seller/funnels) — manage lead capture forms' },
    { keywords: ['submit lead', 'sell a lead', 'submit a lead'], path: '/seller/submit', label: 'Submit Lead', response: '📤 [Submit a Lead](/seller/submit)' },
    { keywords: ['seller analytics', 'seller stats'], path: '/seller/analytics', label: 'Seller Analytics', response: '📈 [View Seller Analytics](/seller/analytics)' },
];

function detectNavIntent(message: string): string | null {
    const lower = message.toLowerCase();
    // Only trigger for navigation-like phrases
    const navPhrases = ['go to', 'take me', 'open', 'navigate', 'show me my', 'where is', 'where can i find'];
    const isNavRequest = navPhrases.some((p) => lower.includes(p));
    if (!isNavRequest) return null;

    for (const route of NAV_ROUTES) {
        if (route.keywords.some((kw) => lower.includes(kw))) {
            return route.response;
        }
    }
    return null;
}

async function fallbackChat(_req: Request, res: Response, message: string, history: ChatMessage[]) {
    const messages: ChatMessage[] = [...history, { role: 'user', content: message }];

    // ── Check for pure navigation intent first ──
    const navResponse = detectNavIntent(message);
    if (navResponse) {
        res.json({
            messages: [...messages, { role: 'assistant' as const, content: navResponse }],
            toolCalls: [],
            mode: 'fallback',
        });
        return;
    }


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
                // MCP may return asks or leads — extract actual leads for auction links
                const items = result?.leads || result?.asks || [];
                if (items.length === 0) return '📭 No leads found matching your criteria. Try a different vertical or remove geo filters.';

                // Build links: prefer nested leads (with real lead IDs) over asks
                const lines = items.slice(0, 5).map((item: any, i: number) => {
                    // If item has nested leads (it's an ask), pick the first active lead
                    const nestedLead = item.leads?.find((l: any) => l.status === 'IN_AUCTION') || item.leads?.[0];
                    const linkId = nestedLead?.id || item.id || '';
                    // Determine if linking to a lead or an ask
                    const isLead = nestedLead || item.status === 'IN_AUCTION' || item.auctionStartAt;
                    const linkPath = isLead ? `/auction/${linkId}` : `/marketplace/ask/${item.id}`;

                    const vert = item.vertical || 'Unknown';
                    const state = item.geoTargets?.states?.[0] || item.geo?.state || 'N/A';
                    const price = item.reservePrice ? `$${item.reservePrice}` : '?';
                    const quality = item.qualityScore ? ` | Quality: ${(Number(item.qualityScore) / 100).toFixed(0)}%` : '';
                    const bids = item._count?.bids != null ? ` | Bids: ${item._count.bids}` : '';
                    const verified = item.isVerified ? ' | ✅ Verified' : '';
                    const seller = item.seller?.reputationScore ? ` | ⭐ ${(Number(item.seller.reputationScore) / 100).toFixed(0)}` : '';
                    return `  ${i + 1}. **[${vert} — ${state} — ${price}](${linkPath})**${quality}${bids}${verified}${seller}`;
                });

                return `🔍 Found **${items.length}** leads:\n${lines.join('\n')}\n\n_Click any lead above to view details and place a bid._`;
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
