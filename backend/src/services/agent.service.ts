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
import { prisma } from '../lib/prisma';

// ── Config ──

const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const KIMI_BASE_URL = process.env.KIMI_BASE_URL || 'https://api.kimi.com/coding/v1';
const MCP_BASE = process.env.MCP_SERVER_URL || 'http://localhost:3001';
const MCP_API_KEY = process.env.MCP_API_KEY || '';

// ── Startup validation ──
if (!KIMI_API_KEY) {
    console.warn('[AgentService] ⚠️  KIMI_API_KEY is not set — LangChain agent will throw on first call.');
}
if (!MCP_API_KEY) {
    console.warn('[AgentService] ⚠️  MCP_API_KEY is not set — tool calls to MCP server will be unauthenticated.');
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

async function executeMcpTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    // Use local Prisma search for search_leads (faster, no network hop)
    if (name === 'search_leads') {
        return localSearchLeads(params as any);
    }

    // Build auth headers for MCP server
    const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (MCP_API_KEY) {
        authHeaders['Authorization'] = `Bearer ${MCP_API_KEY}`;
        authHeaders['X-Api-Key'] = MCP_API_KEY;
    }

    // For all other tools, call MCP server
    try {
        const res = await fetch(`${MCP_BASE}/tools/${name}`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(params),
        });
        if (!res.ok) return { error: `MCP tool ${name} returned ${res.status}` };
        return await res.json();
    } catch (err: any) {
        return { error: `MCP tool ${name} failed: ${err.message}` };
    }
}

// ── System prompt (identical to SYSTEM_PROMPT in mcp.routes.ts) ──

const SYSTEM_PROMPT = `You are LEAD Engine AI, the autonomous bidding agent for the Lead Engine CRE platform — built for the Chainlink Block Magic Hackathon.
You are NOT Claude, NOT ChatGPT, and NOT any other third-party model. You are LEAD Engine AI.
You help buyers discover, evaluate, and bid on commercial real-estate leads on a blockchain-verified marketplace powered by Chainlink.
You have access to 10 MCP tools. Use them to answer the user's questions.

## CHAINLINK DATA FEEDS
Bid floor prices are powered by **Chainlink Data Feeds** reading real-time ETH/USD on Base Sepolia.
The ETH/USD price feed (0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1) drives a market multiplier
that modulates per-vertical floor/ceiling prices. This ensures competitive, market-aware pricing.
When asked about pricing, ALWAYS call get_bid_floor first to get the current market floor.
When suggesting bid amounts, use suggest_bid_amount for quality-weighted recommendations.

## STRICT PII RULES
- NEVER reveal phone numbers, emails, full names, street addresses, or any personally identifiable information.
- Only return non-sensitive fields: lead ID, vertical, state, reserve price, quality score, seller reputation, bid count.
- If a tool result contains PII, ignore those fields and only reference safe data.

## APP NAVIGATION
You can link users to pages inside the app. Use relative markdown links (no domain).
Available pages:

| Page | Path | When to suggest |
|------|------|-----------------|
| Marketplace | /marketplace | "browse leads", "show marketplace", "take me to marketplace" |
| Auction / Lead Detail | /auction/{leadId} | After listing leads or when user asks about a specific lead |
| Buyer Dashboard | /buyer | "show my dashboard", "go home" |
| My Bids | /buyer/bids | "show my bids", "bid history" |
| Purchased Leads (Portfolio) | /buyer/portfolio | "my purchased leads", "won leads", "my portfolio" |
| Auto Bid Rules | /buyer/preferences | "my auto bid rules", "auto-bid settings", "auto-bidding", "change my verticals", "my preferences" |
| Buyer Analytics | /buyer/analytics | "my stats", "analytics", "performance" |
| Integrations | /buyer/integrations | "integrations", "API keys", "webhooks" |
| Seller Dashboard | /seller | "seller dashboard" |
| Seller Leads | /seller/leads | "my listings", "my leads" (as seller) |
| Seller Funnels | /seller/funnels | "my funnels", "landing pages", "lead capture forms" |
| Submit Lead | /seller/submit | "submit a lead", "sell a lead" |
| Seller Analytics | /seller/analytics | "seller stats", "seller analytics" |

## FORMATTING RULES
- Be concise and use markdown formatting. Show numbers and data clearly.
- When listing leads, format each lead with a clickable link:
  **[Vertical — State — $Price](/auction/{leadId})** | Quality: X | Bids: Y
- After listing leads, add a call-to-action: "Click any lead above to view and bid." and optionally link to the full [Marketplace](/marketplace).
- When the user asks about a specific lead, include a **[🎯 Place Bid](/auction/{leadId})** link.
- When asked about pricing, check bid floors.
- Always explain what you found after calling a tool.
- If a search returns no results, suggest broadening the search (try different verticals or remove filters).

## SMART NAVIGATION
Proactively suggest relevant navigation after answering:
- After showing leads → "Want to see more? [Browse Marketplace](/marketplace)"
- After checking auto bid rules → "You can edit these in [Auto Bid Rules](/buyer/preferences)"
- After showing bids → "View your full bid history in [My Bids](/buyer/bids)"
- When user asks "where can I..." or "how do I..." → provide the appropriate nav link
- When user says "go to", "take me to", "open", "show me" → output a link to that page
- Always use the format: [Page Name](/path) — never use full URLs.`;

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
            description: 'Search lead marketplace. Returns matching leads with quality score, status, bid count.',
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
            description: 'Get real-time bid floor pricing from Chainlink Data Feeds for a vertical. Returns floor, ceiling, market multiplier, and ETH/USD price.',
            schema: z.object({
                vertical: z.string().describe('Lead vertical (solar, mortgage, etc.)'),
                country: z.string().optional().default('US').describe('Country code'),
            }),
            func: async (params: Record<string, unknown>) => {
                // Call dataStreamsService directly — real on-chain Chainlink Data Feed
                const { dataStreamsService } = await import('./datastreams.service');
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
            description: 'Get the current buyer auto bid rules (per-vertical, geo filters, budgets).',
            schema: z.object({}),
            func: async () => JSON.stringify(await executeMcpTool('get_preferences', {})),
        }),
        new _DynamicStructuredTool({
            name: 'set_auto_bid_rules',
            description: 'Configure auto-bid rules for a vertical. The engine auto-bids on matching leads.',
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
            description: 'Export leads as CSV or JSON for CRM integration.',
            schema: z.object({
                format: z.enum(['csv', 'json']).optional().default('json'),
                status: z.string().optional().default('SOLD'),
                days: z.number().optional().default(30),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('export_leads', params)),
        }),
        new _DynamicStructuredTool({
            name: 'place_bid',
            description: 'Place a sealed bid on a specific lead.',
            schema: z.object({
                leadId: z.string().describe('The lead ID to bid on'),
                commitment: z.string().describe('Bid commitment hash'),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('place_bid', params)),
        }),
        new _DynamicStructuredTool({
            name: 'configure_crm_webhook',
            description: 'Register a CRM webhook (HubSpot, Zapier, or generic).',
            schema: z.object({
                url: z.string().describe('Webhook destination URL'),
                format: z.enum(['hubspot', 'zapier', 'generic']).optional().default('generic'),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('configure_crm_webhook', params)),
        }),
        new _DynamicStructuredTool({
            name: 'ping_lead',
            description: 'Get full details and current status for a specific lead.',
            schema: z.object({
                leadId: z.string().describe('The lead ID'),
                action: z.enum(['status', 'evaluate']).optional().default('status'),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('ping_lead', params)),
        }),
        new _DynamicStructuredTool({
            name: 'suggest_vertical',
            description: 'AI-powered vertical classification from a lead description.',
            schema: z.object({
                description: z.string().describe('Lead description text'),
            }),
            func: async (params: Record<string, unknown>) => JSON.stringify(await executeMcpTool('suggest_vertical', params)),
        }),
        new _DynamicStructuredTool({
            name: 'suggest_bid_amount',
            description: 'Suggest an optimal bid amount based on Chainlink Data Feeds floor price, lead quality score, and competition. Use this when a user asks "how much should I bid?"',
            schema: z.object({
                vertical: z.string().describe('Lead vertical'),
                country: z.string().optional().default('US').describe('Country code'),
                qualityScore: z.number().optional().describe('Lead quality score 0-100'),
                bidCount: z.number().optional().describe('Current number of bids on the lead'),
            }),
            func: async (params: Record<string, unknown>) => {
                const { dataStreamsService } = await import('./datastreams.service');
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
