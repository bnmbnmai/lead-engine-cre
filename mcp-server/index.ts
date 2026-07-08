import express, { Request, Response } from 'express';
import { TOOLS, TOOL_MAP } from './tools';
import { logAgentAction, generateRequestId, formatErrorResponse, ERROR_CODES } from './agent-logger';

// ============================================
// Lead Engine CRE — MCP Agent Server
// ============================================
// JSON-RPC server for AI agent integration.
// Proxies tool calls to the main API backend.
//
// Usage:
//   npx ts-node index.ts
//   # or
//   npm run dev
//
// Env:
//   API_BASE_URL     - Backend URL (default: http://localhost:3001)
//   API_KEY          - Agent API key for OUTBOUND backend authentication
//   MCP_SERVER_TOKEN - Shared secret REQUIRED on inbound /rpc and /tools calls
//   MCP_PORT         - Port for this server (default: 3002)

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';
const API_KEY = process.env.API_KEY || '';
const MCP_SERVER_TOKEN = process.env.MCP_SERVER_TOKEN || '';
const PORT = parseInt(process.env.MCP_PORT || '3002');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!MCP_SERVER_TOKEN && IS_PRODUCTION) {
    // Fail closed: never run an unauthenticated tool server in production.
    throw new Error('[MCP] MCP_SERVER_TOKEN must be set in production — inbound RPC would otherwise be unauthenticated');
}

const app = express();
app.use(express.json());

// ── Inbound authentication ──
// Tools place bids, change auto-bid rules, and export data; the RPC
// surface must never be open. Callers send the shared token via
// Authorization: Bearer <MCP_SERVER_TOKEN> or X-Mcp-Token.
import crypto from 'crypto';

function timingSafeEqualStr(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

function requireMcpToken(req: Request, res: Response, next: () => void): void {
    if (!MCP_SERVER_TOKEN) {
        // Non-production with no token configured: allow (local dev)
        next();
        return;
    }
    const header = (req.headers.authorization || '') as string;
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    const provided = bearer || ((req.headers['x-mcp-token'] as string) || '');
    if (!provided || !timingSafeEqualStr(provided, MCP_SERVER_TOKEN)) {
        res.status(401).json({ error: 'Invalid or missing MCP server token' });
        return;
    }
    next();
}

// ── Health check ──

app.get('/health', (_req: Request, res: Response) => {
    res.json({
        status: 'ok',
        service: 'lead-engine-mcp-server',
        tools: TOOLS.map((t) => t.name),
        timestamp: new Date().toISOString(),
    });
});

// ── List available tools ──

app.get('/tools', requireMcpToken, (_req: Request, res: Response) => {
    res.json({
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
        })),
    });
});

// ── JSON-RPC endpoint ──

interface RPCRequest {
    jsonrpc?: string;
    id?: string | number;
    method: string;
    params?: Record<string, unknown>;
}

/**
 * Schema adapter for set_auto_bid_rules.
 *
 * The agent sends a single-vertical rule:
 *   { vertical, autoBidAmount, autoBidEnabled?, minQualityScore?, dailyBudget?,
 *     maxBidPerLead?, geoCountry?, geoInclude?, geoExclude?, acceptOffSite?,
 *     requireVerified?, fieldFilters? }
 *
 * The backend's PUT /api/v1/bids/preferences/v2 expects the COMPLETE list:
 *   { preferenceSets: [...] } — sets missing from the payload are DELETED.
 *
 * So: fetch current sets, merge the incoming rule into the matching vertical's
 * set (or append a new set), and return the full list as the request body.
 *
 * NOTE: the backend expects minQualityScore on the 0–100 scale.
 */
async function adaptSetAutoBidRules(
    params: Record<string, unknown>,
    agentId: string | undefined,
    requestId: string,
): Promise<{ body: unknown } | { error: string; status: number }> {
    const vertical = params.vertical as string | undefined;
    if (!vertical) return { error: 'set_auto_bid_rules: "vertical" is required', status: 400 };

    const headers = {
        'Authorization': `Bearer ${API_KEY}`,
        'X-Agent-Id': agentId || 'unknown',
        'X-Request-Id': requestId,
    };

    const current = await fetch(`${API_BASE}/api/v1/bids/preferences/v2`, {
        headers,
        signal: AbortSignal.timeout(10000),
    });
    if (!current.ok) {
        return { error: `Failed to load current preference sets (HTTP ${current.status})`, status: 502 };
    }
    const { sets } = (await current.json()) as { sets: Array<Record<string, unknown>> };

    // Tool schema uses minQualityScore 0–10000 (internal scale); the v2
    // endpoint validates 0–100 (buyer-facing scale). Convert when needed.
    let minQualityScore = params.minQualityScore as number | undefined;
    if (minQualityScore !== undefined && minQualityScore > 100) {
        minQualityScore = Math.round(minQualityScore / 100);
    }

    const incoming: Record<string, unknown> = {
        label: `${vertical} (agent)`,
        vertical,
        autoBidEnabled: params.autoBidEnabled ?? true,
        autoBidAmount: params.autoBidAmount,
        ...(minQualityScore !== undefined ? { minQualityScore } : {}),
        ...(params.maxBidPerLead !== undefined ? { maxBidPerLead: params.maxBidPerLead } : {}),
        ...(params.dailyBudget !== undefined ? { dailyBudget: params.dailyBudget } : {}),
        ...(params.geoCountry !== undefined ? { geoCountries: [params.geoCountry] } : {}),
        ...(params.geoInclude !== undefined ? { geoInclude: params.geoInclude } : {}),
        ...(params.geoExclude !== undefined ? { geoExclude: params.geoExclude } : {}),
        ...(params.acceptOffSite !== undefined ? { acceptOffSite: params.acceptOffSite } : {}),
        ...(params.requireVerified !== undefined ? { requireVerified: params.requireVerified } : {}),
        ...(params.fieldFilters !== undefined ? { fieldFilters: params.fieldFilters } : {}),
    };

    const existingIdx = (sets || []).findIndex((s) => s.vertical === vertical);
    const merged = [...(sets || [])];
    if (existingIdx >= 0) {
        // Preserve id + unspecified fields of the existing set
        merged[existingIdx] = { ...merged[existingIdx], ...incoming, id: merged[existingIdx].id };
    } else {
        merged.push(incoming);
    }

    return { body: { preferenceSets: merged } };
}

app.post('/rpc', requireMcpToken, async (req: Request, res: Response) => {
    const rpc = req.body as RPCRequest;
    const requestId = generateRequestId();
    const start = Date.now();

    // Extract agent ID from header (for logging)
    const agentId = req.headers['x-agent-id'] as string | undefined;

    // Validate request
    if (!rpc.method) {
        res.status(400).json({
            jsonrpc: '2.0',
            id: rpc.id || null,
            ...formatErrorResponse(ERROR_CODES.VALIDATION_ERROR, 'Missing "method" field'),
        });
        return;
    }

    const tool = TOOL_MAP.get(rpc.method);
    if (!tool) {
        res.status(404).json({
            jsonrpc: '2.0',
            id: rpc.id || null,
            ...formatErrorResponse(ERROR_CODES.VALIDATION_ERROR, `Unknown tool: ${rpc.method}. Available: ${TOOLS.map((t) => t.name).join(', ')}`),
        });
        return;
    }

    const params = { ...(rpc.params || {}) } as Record<string, unknown>;

    if (rpc.method === 'place_bid') {
        res.status(400).json({
            jsonrpc: '2.0',
            id: rpc.id || null,
            ...formatErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                'place_bid is removed. Use create_strategy → activate_strategy for deterministic bidding.',
            ),
        });
        return;
    }

    try {
        // ── Tool adapters ─────────────────────────────────────────────
        // Some tools need request-shape translation before the generic proxy.
        let handlerPath = tool.handler;
        let method: 'GET' | 'POST' | 'PUT' = tool.method;
        let bodyOverride: unknown = undefined;

        // ping_lead with action=evaluate triggers auto-bid evaluation instead
        // of a status read.
        if (tool.name === 'ping_lead' && params.action === 'evaluate') {
            handlerPath = '/api/v1/bids/auto-bid/evaluate';
            method = 'POST';
            bodyOverride = { leadId: params.leadId };
        }

        // set_auto_bid_rules: the backend PUT /preferences/v2 endpoint expects
        // the FULL list of preference sets ({ preferenceSets: [...] }) and
        // deletes any set missing from the payload. Adapter: read current
        // sets, merge the incoming single-vertical rule, write back the
        // complete list.
        if (tool.name === 'set_auto_bid_rules') {
            const adapted = await adaptSetAutoBidRules(params, agentId, requestId);
            if ('error' in adapted) {
                res.status(adapted.status).json({
                    jsonrpc: '2.0',
                    id: rpc.id || null,
                    ...formatErrorResponse(ERROR_CODES.UPSTREAM_ERROR, adapted.error),
                });
                return;
            }
            bodyOverride = adapted.body;
        }

        // ── Path-parameter substitution ──────────────────────────────
        // Handlers may contain {param} placeholders (e.g. /verticals/{vertical}/fields).
        // Substitute from params and exclude those keys from the query/body.
        const consumedPathParams = new Set<string>();
        handlerPath = handlerPath.replace(/\{(\w+)\}/g, (_m, key: string) => {
            consumedPathParams.add(key);
            const value = params[key];
            return encodeURIComponent(value === undefined || value === null ? '' : String(value));
        });
        for (const key of consumedPathParams) {
            const value = params[key];
            if (value === undefined || value === null || value === '') {
                res.status(400).json({
                    jsonrpc: '2.0',
                    id: rpc.id || null,
                    ...formatErrorResponse(ERROR_CODES.VALIDATION_ERROR, `Missing required parameter: ${key}`),
                });
                return;
            }
        }
        const remainingParams = Object.fromEntries(
            Object.entries(params).filter(([k]) => !consumedPathParams.has(k)),
        );

        // ── Build the upstream request ───────────────────────────────
        let url: string;
        let fetchOpts: RequestInit;

        // Caller identity: prefer forwarded user token over shared service API_KEY
        const callerAuth = (req.headers['x-caller-authorization'] as string) || '';
        const upstreamAuth = callerAuth || (API_KEY ? `Bearer ${API_KEY}` : '');

        if (method === 'GET') {
            const query = new URLSearchParams();
            for (const [k, v] of Object.entries(remainingParams)) {
                if (v !== undefined && v !== null) query.set(k, String(v));
            }
            const qs = query.toString();
            url = `${API_BASE}${handlerPath}${qs ? `?${qs}` : ''}`;
            fetchOpts = {
                method: 'GET',
                headers: {
                    ...(upstreamAuth ? { Authorization: upstreamAuth } : {}),
                    'X-Agent-Id': agentId || 'unknown',
                    'X-Request-Id': requestId,
                },
            };
        } else {
            url = `${API_BASE}${handlerPath}`;
            fetchOpts = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(upstreamAuth ? { Authorization: upstreamAuth } : {}),
                    'X-Agent-Id': agentId || 'unknown',
                    'X-Request-Id': requestId,
                },
                body: JSON.stringify(bodyOverride ?? remainingParams),
            };
        }

        const response = await fetch(url, {
            ...fetchOpts,
            signal: AbortSignal.timeout(15000),
        });

        const latencyMs = Date.now() - start;
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const errorCode = response.status === 429 ? ERROR_CODES.RATE_LIMITED
                : response.status === 401 ? ERROR_CODES.AUTH_FAILED
                    : response.status === 404 ? ERROR_CODES.LEAD_NOT_FOUND
                        : ERROR_CODES.UPSTREAM_ERROR;

            const retryAfter = response.status === 429 ? 5 : undefined;

            logAgentAction({
                timestamp: new Date().toISOString(),
                requestId,
                tool: rpc.method,
                agentId,
                params: params as Record<string, unknown>,
                status: response.status === 429 ? 'retry' : 'error',
                latencyMs,
                error: { code: errorCode, message: (data as any).error || response.statusText },
            });

            res.status(response.status).json({
                jsonrpc: '2.0',
                id: rpc.id || null,
                ...formatErrorResponse(errorCode, (data as any).error || response.statusText, retryAfter),
            });
            return;
        }

        logAgentAction({
            timestamp: new Date().toISOString(),
            requestId,
            tool: rpc.method,
            agentId,
            params: params as Record<string, unknown>,
            status: 'success',
            latencyMs,
            response: data,
        });

        res.json({
            jsonrpc: '2.0',
            id: rpc.id || null,
            result: data,
        });
    } catch (err: any) {
        const latencyMs = Date.now() - start;
        const isTimeout = err.name === 'AbortError' || err.message?.includes('timeout');

        logAgentAction({
            timestamp: new Date().toISOString(),
            requestId,
            tool: rpc.method,
            agentId,
            params: params as Record<string, unknown>,
            status: 'error',
            latencyMs,
            error: { code: isTimeout ? ERROR_CODES.TIMEOUT : ERROR_CODES.UPSTREAM_ERROR, message: err.message },
        });

        res.status(isTimeout ? 504 : 500).json({
            jsonrpc: '2.0',
            id: rpc.id || null,
            ...formatErrorResponse(
                isTimeout ? ERROR_CODES.TIMEOUT : ERROR_CODES.UPSTREAM_ERROR,
                err.message,
                isTimeout ? 3 : undefined
            ),
        });
    }
});

// ── Start server ──

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║       Lead Engine CRE — MCP Agent Server             ║
╚══════════════════════════════════════════════════════╝

  Port:       ${PORT}
  Backend:    ${API_BASE}
  Health:     http://localhost:${PORT}/health
  Tools:      http://localhost:${PORT}/tools
  RPC:        POST http://localhost:${PORT}/rpc

  Available tools:
${TOOLS.map((t) => `    • ${t.name} — ${t.description.slice(0, 60)}...`).join('\n')}
`);
});

export { app };
