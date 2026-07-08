/**
 * Agent Service — LangChain orchestration layer for MCP agent.
 *
 * Uses ChatOpenAI pointed at Kimi K2.5's OpenAI-compatible API as the LLM,
 * with 10 DynamicStructuredTools. Falls back gracefully if Kimi is unavailable.
 *
 * NOTE: We use @langchain/openai (NOT @langchain/community ChatMoonshot)
 * because Kimi K2.5 exposes an OpenAI-compatible API at api.kimi.com that
 * supports tool calling. ChatMoonshot from @langchain/community targets
 * api.moonshot.cn and does NOT support tool calling.
 *
 * IMPORTANT: All LangChain imports are dynamic to avoid build failures when
 * packages are not installed (e.g. on Render deployment). The agent is only
 * available when KIMI_API_KEY is set AND packages are installed.
 *
 * Exports: runAgent(message, history) — called from mcp.routes.ts
 */
import { z } from 'zod';
import { buildSystemPrompt, getToolDef } from '@lead-engine/agent-tools';
import { prisma } from '../lib/prisma';

// ── Config ──

const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const KIMI_BASE_URL = process.env.KIMI_BASE_URL || 'https://api.kimi.com/coding/v1';
// The standalone MCP server listens on MCP_PORT (default 3002) — NOT the
// backend port 3001. Pointing here at 3001 silently routed agent tool calls
// back into the backend where no /rpc route exists.
const MCP_BASE = process.env.MCP_SERVER_URL || 'http://localhost:3002';
// Inbound auth token expected by the MCP server (Authorization: Bearer / X-Mcp-Token)
const MCP_SERVER_TOKEN = process.env.MCP_SERVER_TOKEN || process.env.MCP_API_KEY || '';

// ── Startup validation ──
if (!KIMI_API_KEY) {
    console.warn('[AgentService] ⚠️  KIMI_API_KEY is not set — LangChain agent will throw on first call.');
}
if (!MCP_SERVER_TOKEN) {
    console.warn('[AgentService] ⚠️  MCP_SERVER_TOKEN is not set — tool calls to MCP server will be unauthenticated.');
}

// ── PII sanitization (shared with mcp.routes.ts) ──

const PII_FIELDS = new Set([
    'phone', 'email', 'firstName', 'lastName', 'fullName', 'name',
    'address', 'streetAddress', 'street', 'city', 'zip', 'zipCode',
    'ssn', 'dateOfBirth', 'dob', 'ip', 'ipAddress',
    'contactName', 'contactEmail', 'contactPhone',
]);

function sanitizeLeadData(data: unknown): unknown {
    if (Array.isArray(data)) return data.map(sanitizeLeadData);
    if (data && typeof data === 'object') {
        const clean: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
            if (PII_FIELDS.has(key)) continue;
            clean[key] = sanitizeLeadData(value);
        }
        return clean;
    }
    return data;
}

// ── Local search (Prisma — direct DB access for search_leads) ──

async function localSearchLeads(params: {
    vertical?: string;
    state?: string;
    minPrice?: number;
    maxPrice?: number;
    limit?: number;
}) {
    const where: Record<string, unknown> = {};
    if (params.vertical) where.vertical = params.vertical;
    if (params.state) where.geo = { path: ['state'], equals: params.state };
    if (params.minPrice || params.maxPrice) {
        where.reservePrice = {};
        if (params.minPrice) (where.reservePrice as Record<string, unknown>).gte = params.minPrice;
        if (params.maxPrice) (where.reservePrice as Record<string, unknown>).lte = params.maxPrice;
    }

    const leads = await prisma.lead.findMany({
        where: where as any,
        take: Math.min(params.limit ?? 5, 10),
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            vertical: true,
            geo: true,
            reservePrice: true,
            qualityScore: true,
            status: true,
            createdAt: true,
            bids: { select: { id: true }, take: 100 },
        },
    });

    return sanitizeLeadData(leads.map((l: any) => ({
        ...l,
        bidCount: l.bids?.length ?? 0,
        bids: undefined,
    })));
}

// ── MCP tool executor ──

let rpcIdCounter = 0;

async function executeMcpTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    // Use local Prisma search for search_leads (faster, no network hop)
    if (name === 'search_leads') {
        return localSearchLeads(params as any);
    }

    // Build auth headers for the MCP server (expects Bearer <MCP_SERVER_TOKEN>
    // or X-Mcp-Token — see mcp-server/index.ts requireMcpToken)
    const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (MCP_SERVER_TOKEN) {
        authHeaders['Authorization'] = `Bearer ${MCP_SERVER_TOKEN}`;
        authHeaders['X-Mcp-Token'] = MCP_SERVER_TOKEN;
    }

    // The MCP server exposes a single JSON-RPC endpoint: POST /rpc
    // { jsonrpc: "2.0", id, method: <toolName>, params }
    try {
        const res = await fetch(`${MCP_BASE}/rpc`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: ++rpcIdCounter,
                method: name,
                params,
            }),
            signal: AbortSignal.timeout(20_000),
        });
        const rpcResponse: any = await res.json().catch(() => ({}));
        if (!res.ok || rpcResponse.error) {
            const message = rpcResponse?.error?.message || `HTTP ${res.status}`;
            return { error: `MCP tool ${name} failed: ${message}` };
        }
        return rpcResponse.result ?? rpcResponse;
    } catch (err: any) {
        return { error: `MCP tool ${name} failed: ${err.message}` };
    }
}

// ── System prompt (Phase B5: shared module in @lead-engine/agent-tools) ──

const SYSTEM_PROMPT = buildSystemPrompt({
    engineLine: 'You are powered by Kimi K2.5 via LangChain ReAct.',
    hasSuggestBidTool: true,
});

// ── Chat message interface (matches frontend + mcp.routes.ts) ──

interface ChatMessage {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCall?: { name: string; params: Record<string, unknown>; result?: unknown };
}

// ── Lazy-loaded LangChain modules ──

let langchainAvailable: boolean | null = null;
let _DynamicStructuredTool: any = null;
let _ChatOpenAI: any = null;
let _AgentExecutor: any = null;
let _createToolCallingAgent: any = null;
let _ChatPromptTemplate: any = null;
let _MessagesPlaceholder: any = null;
let _AIMessage: any = null;
let _HumanMessage: any = null;

async function loadLangChain(): Promise<boolean> {
    if (langchainAvailable !== null) return langchainAvailable;
    try {
        // Use require() to avoid TypeScript module resolution validation
        // (these packages may not be installed in all environments)
        const r = (m: string) => require(m); // eslint-disable-line @typescript-eslint/no-var-requires
        const coreTools = r('@langchain/core/tools');
        const openai = r('@langchain/openai');
        const agents = r('langchain/agents');
        const prompts = r('@langchain/core/prompts');
        const messages = r('@langchain/core/messages');
        _DynamicStructuredTool = coreTools.DynamicStructuredTool;
        _ChatOpenAI = openai.ChatOpenAI;
        _AgentExecutor = agents.AgentExecutor;
        _createToolCallingAgent = agents.createToolCallingAgent;
        _ChatPromptTemplate = prompts.ChatPromptTemplate;
        _MessagesPlaceholder = prompts.MessagesPlaceholder;
        _AIMessage = messages.AIMessage;
        _HumanMessage = messages.HumanMessage;
        langchainAvailable = true;
        console.log('[AgentService] LangChain modules loaded successfully');
    } catch (err: any) {
        langchainAvailable = false;
        console.warn('[AgentService] LangChain not available:', err.message);
    }
    return langchainAvailable;
}

// ── Build tools (requires LangChain) ──

function buildTools() {
    return [
        new _DynamicStructuredTool({
            name: 'search_leads',
            description: getToolDef('search_leads').description,
            schema: z.object({
                vertical: z.string().optional().describe('Lead vertical (solar, mortgage, roofing, insurance, etc.)'),
                state: z.string().optional().describe('US state code (e.g., CA, FL, TX)'),
                minPrice: z.number().optional().describe('Minimum reserve price in USDC'),
                maxPrice: z.number().optional().describe('Maximum reserve price in USDC'),
                limit: z.number().optional().default(5).describe('Max results to return (1-10)'),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('search_leads', params)),
        }),
        new _DynamicStructuredTool({
            name: 'get_bid_floor',
            description: getToolDef('get_bid_floor').description,
            schema: z.object({
                vertical: z.string().describe('Lead vertical (solar, mortgage, etc.)'),
                country: z.string().optional().default('US').describe('Country code'),
            }),
            func: async (params: Record<string, unknown>) => {
                // Call dataStreamsService directly — real on-chain Chainlink Data Feed
                const { dataStreamsService } = await import('./data-feeds.service');
                const floor = await dataStreamsService.getRealtimeBidFloor(
                    params.vertical as string,
                    (params.country as string) || 'US'
                );
                const index = await dataStreamsService.getLeadPriceIndex(params.vertical as string);
                return JSON.stringify({ floor, index });
            },
        }),
        new _DynamicStructuredTool({
            name: 'get_preferences',
            description: getToolDef('get_preferences').description,
            schema: z.object({}),
            func: async () => JSON.stringify(await executeMcpTool('get_preferences', {})),
        }),
        new _DynamicStructuredTool({
            name: 'set_auto_bid_rules',
            description: getToolDef('set_auto_bid_rules').description,
            schema: z.object({
                vertical: z.string().describe('Lead vertical'),
                autoBidEnabled: z.boolean().optional().default(true),
                autoBidAmount: z.number().describe('Bid amount in USDC'),
                minQualityScore: z.number().optional().describe('Min quality score 0-100'),
                dailyBudget: z.number().optional().describe('Daily budget cap in USDC'),
                geoInclude: z.array(z.string()).optional().describe('State codes to include'),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('set_auto_bid_rules', params)),
        }),
        new _DynamicStructuredTool({
            name: 'export_leads',
            description: getToolDef('export_leads').description,
            schema: z.object({
                format: z.enum(['csv', 'json']).optional().default('json'),
                status: z.string().optional().default('SOLD'),
                days: z.number().optional().default(30),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('export_leads', params)),
        }),
        new _DynamicStructuredTool({
            name: 'configure_crm_webhook',
            description: getToolDef('configure_crm_webhook').description,
            schema: z.object({
                url: z.string().describe('Webhook destination URL'),
                format: z.enum(['hubspot', 'zapier', 'generic']).optional().default('generic'),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('configure_crm_webhook', params)),
        }),
        new _DynamicStructuredTool({
            name: 'ping_lead',
            description: getToolDef('ping_lead').description,
            schema: z.object({
                leadId: z.string().describe('The lead ID'),
                action: z.enum(['status', 'evaluate']).optional().default('status'),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('ping_lead', params)),
        }),
        new _DynamicStructuredTool({
            name: 'suggest_vertical',
            description: getToolDef('suggest_vertical').description,
            schema: z.object({
                description: z.string().describe('Lead description text'),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('suggest_vertical', params)),
        }),
        new _DynamicStructuredTool({
            name: 'suggest_bid_amount',
            description: getToolDef('suggest_bid_amount').description,
            schema: z.object({
                vertical: z.string().describe('Lead vertical'),
                country: z.string().optional().default('US').describe('Country code'),
                qualityScore: z.number().optional().describe('Lead quality score 0-100'),
                bidCount: z.number().optional().describe('Current number of bids on the lead'),
            }),
            func: async (params: Record<string, unknown>) => {
                const { dataStreamsService } = await import('./data-feeds.service');
                const floor = await dataStreamsService.getRealtimeBidFloor(
                    params.vertical as string,
                    (params.country as string) || 'US'
                );
                const qs = (params.qualityScore as number) || 50;
                const bids = (params.bidCount as number) || 0;

                // Quality premium: high-quality leads warrant bids above floor
                const qualityMultiplier = 1 + (qs - 50) / 200; // QS 100 → 1.25x, QS 50 → 1.0x, QS 0 → 0.75x
                // Competition premium: more bids → bid higher to win
                const competitionMultiplier = 1 + Math.min(bids, 10) * 0.03; // +3% per bid, max +30%

                const suggested = parseFloat(
                    (floor.bidFloor * qualityMultiplier * competitionMultiplier).toFixed(2)
                );
                const aggressive = parseFloat(
                    (floor.bidCeiling * 0.7 * qualityMultiplier).toFixed(2)
                );

                return JSON.stringify({
                    suggestedBid: suggested,
                    aggressiveBid: aggressive,
                    floor: floor.bidFloor,
                    ceiling: floor.bidCeiling,
                    ethUsdPrice: floor.ethUsdPrice,
                    marketMultiplier: floor.marketMultiplier,
                    qualityMultiplier: parseFloat(qualityMultiplier.toFixed(3)),
                    competitionMultiplier: parseFloat(competitionMultiplier.toFixed(3)),
                    reasoning: `Floor $${floor.bidFloor} × quality ${qs}/100 × ${bids} competing bids`,
                });
            },
        }),
        new _DynamicStructuredTool({
            name: 'ace_policy_check',
            description: getToolDef('ace_policy_check').description,
            schema: z.object({
                walletAddress: z.string().describe('Ethereum wallet address to check (0x format)'),
            }),
            func: async (params: Record<string, unknown>) => {
                const { creService } = await import('./cre.service');
                const result = await creService.checkACECompliance(params.walletAddress as string);
                return JSON.stringify({
                    walletAddress: params.walletAddress,
                    compliant: result.compliant,
                    kycStatus: result.kycStatus ?? null,
                    reputationScore: result.reputationScore ?? null,
                    reason: result.reason ?? null,
                    source: 'ACECompliance@0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6',
                });
            },
        }),
        new _DynamicStructuredTool({
            name: 'batched_private_score_request',
            description: getToolDef('batched_private_score_request').description,
            schema: z.object({
                leadId: z.string().describe('The lead ID to score privately (UUID)'),
            }),
            func: async (params: Record<string, unknown>) => {
                const { executeBatchedPrivateScore } = await import('../lib/chainlink/batched-private-score');
                const leadId = params.leadId as string;
                const lead = await prisma.lead.findUnique({
                    where: { id: leadId },
                    select: {
                        id: true, tcpaConsentAt: true, geo: true, encryptedData: true,
                        parameters: true, source: true, qualityScore: true,
                    },
                });
                if (!lead) return JSON.stringify({ error: `Lead ${leadId} not found` });

                const geo = lead.geo as any;
                const lp = lead.parameters as any;
                const paramCount = lp ? Object.keys(lp).filter((k) => !k.startsWith('_') && lp[k] != null).length : 0;
                let encValid = false;
                if (lead.encryptedData) {
                    try { const p = JSON.parse(lead.encryptedData); encValid = !!(p.ciphertext && p.iv && p.tag); } catch { /* */ }
                }
                const scoringInput = {
                    tcpaConsentAt: lead.tcpaConsentAt,
                    geo: geo || null,
                    hasEncryptedData: !!lead.encryptedData,
                    encryptedDataValid: encValid,
                    parameterCount: paramCount,
                    source: (lead.source as string) || 'OTHER',
                    zipMatchesState: false,
                };

                const out = await executeBatchedPrivateScore(leadId, scoringInput, false);
                return JSON.stringify({
                    leadId,
                    score: out.result.score,
                    fraudBonus: out.result.fraudBonus,
                    aceCompliant: out.result.aceCompliant,
                    encrypted: out.envelope.encrypted,
                    latencyMs: out.latencyMs,
                    phase: out.phase,
                    isPhase2: true,
                });
            },
        }),
        new _DynamicStructuredTool({
            name: 'subscribe_to_live_leads',
            description: getToolDef('subscribe_to_live_leads').description,
            schema: z.object({
                verticals: z.array(z.string()).optional().describe('Filter by vertical (e.g. solar). Omit for all.'),
            }),
            func: async (params: Record<string, unknown>) => {
                const { aceDevBus } = await import('./ace.service');
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
                        resolve(JSON.stringify(res));
                    };

                    socket.on('marketplace:lead:new', (data: any) => {
                        if (verts && data.lead && !verts.includes(data.lead.vertical)) return;
                        aceDevBus.emit('ace:dev-log', { level: 'success', message: 'Agent subscribed to live lead via live stream', module: 'Agent' });
                        cleanup({ event: 'marketplace:lead:new', data });
                    });

                    socket.on('auction:updated', (data: any) => cleanup({ event: 'auction:updated', data }));
                    socket.on('ace:dev-log', (data: any) => cleanup({ event: 'ace:dev-log', data }));

                    // Timeout gracefully so the agent doesn't hang
                    setTimeout(() => cleanup({ status: 'timeout', message: 'No events received in 15 seconds. You can call subscribe again.' }), 15000);
                });
            },
        }),

        // ── StrategySpec lifecycle (Option A — primary agent path) ──
        new _DynamicStructuredTool({
            name: 'list_strategies',
            description: getToolDef('list_strategies').description,
            schema: z.object({}),
            func: async () => JSON.stringify(await executeMcpTool('list_strategies', {})),
        }),
        new _DynamicStructuredTool({
            name: 'draft_strategy',
            description: getToolDef('draft_strategy').description,
            schema: z.object({
                description: z.string().describe('Natural language buying rules and budget'),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('draft_strategy', params)),
        }),
        new _DynamicStructuredTool({
            name: 'create_strategy',
            description: getToolDef('create_strategy').description,
            schema: z.object({
                spec: z.any().describe('Validated StrategySpec JSON object'),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('create_strategy', params)),
        }),
        new _DynamicStructuredTool({
            name: 'activate_strategy',
            description: getToolDef('activate_strategy').description,
            schema: z.object({
                strategyId: z.string().describe('Strategy id from list_strategies or create_strategy'),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('activate_strategy', params)),
        }),
        new _DynamicStructuredTool({
            name: 'simulate_strategy',
            description: getToolDef('simulate_strategy').description,
            schema: z.object({
                strategyId: z.string(),
                days: z.number().optional().default(30),
                limit: z.number().optional().default(50),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('simulate_strategy', params)),
        }),
        new _DynamicStructuredTool({
            name: 'get_decision_traces',
            description: getToolDef('get_decision_traces').description,
            schema: z.object({
                limit: z.number().optional().default(20),
                leadId: z.string().optional(),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('get_decision_traces', params)),
        }),
        new _DynamicStructuredTool({
            name: 'register_agent',
            description: getToolDef('register_agent').description,
            schema: z.object({
                displayName: z.string(),
                walletAddress: z.string().optional(),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('register_agent', params)),
        }),
    ];
}

// ── Lazy-initialized executor (created once, reused across requests) ──

let executorInstance: any = null;

async function getExecutor(): Promise<any> {
    if (executorInstance) return executorInstance;

    if (!KIMI_API_KEY) {
        throw new Error('KIMI_API_KEY not set — cannot initialize LangChain agent');
    }

    const loaded = await loadLangChain();
    if (!loaded) {
        throw new Error('LangChain packages not installed — agent unavailable');
    }

    const tools = buildTools();

    const prompt = _ChatPromptTemplate.fromMessages([
        ['system', SYSTEM_PROMPT],
        new _MessagesPlaceholder('chat_history'),
        ['human', '{input}'],
        new _MessagesPlaceholder('agent_scratchpad'),
    ]);

    const llm = new _ChatOpenAI({
        openAIApiKey: KIMI_API_KEY,
        modelName: 'kimi-k2.5',
        temperature: 0.2,
        maxTokens: 4096,
        configuration: {
            baseURL: KIMI_BASE_URL,
        },
    });

    const agent = _createToolCallingAgent({ llm, tools, prompt });
    executorInstance = new _AgentExecutor({
        agent,
        tools,
        maxIterations: 5,
        returnIntermediateSteps: true,
    });

    return executorInstance;
}

// ── Main entry point ──

export async function runAgent(
    message: string,
    history: ChatMessage[] = [],
): Promise<{ messages: ChatMessage[]; toolCalls: Array<{ name: string; params: Record<string, unknown>; result?: unknown }>; mode: string }> {
    const executor = await getExecutor();

    // Convert recent chat history to LangChain message format
    // Keep last 6 user/assistant messages for context window
    const chatHistory = history.slice(-6).flatMap((h) => {
        if (h.role === 'user') return [new _HumanMessage(h.content)];
        if (h.role === 'assistant') return [new _AIMessage(h.content)];
        return []; // tool messages are internal traces, not part of conversation history
    });

    const result = await executor.invoke({
        input: message,
        chat_history: chatHistory,
    });

    // Extract tool call log from intermediate steps
    const toolCallLog: ChatMessage[] = [];
    const toolCallsForResponse: Array<{ name: string; params: Record<string, unknown>; result?: unknown }> = [];

    if (result.intermediateSteps) {
        for (const step of result.intermediateSteps) {
            const action = step.action;
            const observation = step.observation;

            let parsedResult: unknown;
            try {
                parsedResult = typeof observation === 'string' ? JSON.parse(observation) : observation;
            } catch {
                parsedResult = observation;
            }

            const tc = {
                name: action.tool,
                params: (action.toolInput as Record<string, unknown>) || {},
                result: parsedResult,
            };

            toolCallLog.push({
                role: 'tool',
                content: `Called \`${action.tool}\``,
                toolCall: tc,
            });
            toolCallsForResponse.push(tc);
        }
    }

    // Build response messages (matches shape from raw Kimi handler)
    const outputMessages: ChatMessage[] = [
        { role: 'user', content: message },
        ...toolCallLog,
        { role: 'assistant', content: result.output || 'Done.' },
    ];

    return {
        messages: outputMessages,
        toolCalls: toolCallsForResponse,
        mode: 'langchain',
    };
}
