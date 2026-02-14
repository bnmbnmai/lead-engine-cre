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
//   API_BASE_URL   - Backend URL (default: http://localhost:3001)
//   API_KEY        - Agent API key for authentication
//   MCP_PORT       - Port for this server (default: 3002)

const API_BASE = process.env.API_BASE_URL || 'https://lead-engine-api-0jdu.onrender.com';
const API_KEY = process.env.API_KEY || '';
const PORT = parseInt(process.env.MCP_PORT || '3002');

const app = express();
app.use(express.json());

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

app.get('/tools', (_req: Request, res: Response) => {
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

app.post('/rpc', async (req: Request, res: Response) => {
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

    const params = rpc.params || {};

    try {
        // Build the upstream request
        let url: string;
        let fetchOpts: RequestInit;

        if (tool.method === 'GET') {
            const query = new URLSearchParams();
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined && v !== null) query.set(k, String(v));
            }
            url = `${API_BASE}${tool.handler}?${query}`;
            fetchOpts = {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'X-Agent-Id': agentId || 'unknown',
                    'X-Request-Id': requestId,
                },
            };
        } else {
            url = `${API_BASE}${tool.handler}`;
            fetchOpts = {
                method: tool.method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`,
                    'X-Agent-Id': agentId || 'unknown',
                    'X-Request-Id': requestId,
                },
                body: JSON.stringify(params),
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
