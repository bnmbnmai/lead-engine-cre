/**
 * Agent Service — LangChain orchestration layer for MCP agent.
 *
 * Uses ChatMoonshot (Kimi K2.5) as the LLM with 9 DynamicStructuredTools.
 * Falls back gracefully if LangChain or Kimi is unavailable.
 *
 * Exports: runAgent(message, history) — called from mcp.routes.ts
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatMoonshot } from '@langchain/community/chat_models/moonshot';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

// ── Config ──

const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const MCP_BASE = process.env.MCP_SERVER_URL || 'https://lead-engine-mcp.onrender.com';

// ── PII sanitization (mirrors mcp.routes.ts) ──

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

// ── Local search (Prisma) ──

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

// ── MCP JSON-RPC execution ──

async function executeMcpTool(name: string, params: Record<string, unknown>): Promise<any> {
    if (name === 'search_leads') {
        try {
            return await searchLeadsLocal(params);
        } catch (err) {
            console.warn('[Agent] Local search_leads failed, falling back to MCP:', err);
        }
    }

    const rpcResponse = await fetch(`${MCP_BASE}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `agent-${Date.now()}`,
            method: name,
            params,
        }),
        signal: AbortSignal.timeout(10000),
    });
    const rpcData: any = await rpcResponse.json();
    return sanitizeLeadData(rpcData.result || rpcData.error || {});
}

// ── Tool definitions ──

const tools = [
    new DynamicStructuredTool({
        name: 'search_leads',
        description: 'Search and filter available leads in the marketplace by vertical, state, price range.',
        schema: z.object({
            vertical: z.string().optional().describe('Lead vertical (solar, mortgage, roofing, insurance, etc.)'),
            state: z.string().optional().describe('US state code (e.g., CA, FL, TX)'),
            minPrice: z.number().optional().describe('Minimum reserve price in USDC'),
            maxPrice: z.number().optional().describe('Maximum reserve price in USDC'),
            limit: z.number().default(5).describe('Max results to return'),
        }),
        func: async (params) => JSON.stringify(await executeMcpTool('search_leads', params)),
    }),
    new DynamicStructuredTool({
        name: 'get_bid_floor',
        description: 'Get real-time bid floor pricing for a vertical. Returns floor, ceiling, and market index.',
        schema: z.object({
            vertical: z.string().describe('Lead vertical (solar, mortgage, etc.)'),
            country: z.string().default('US').describe('Country code'),
        }),
        func: async (params) => JSON.stringify(await executeMcpTool('get_bid_floor', params)),
    }),
    new DynamicStructuredTool({
        name: 'get_preferences',
        description: 'Get the current buyer auto-bid preference sets (per-vertical, geo filters, budgets).',
        schema: z.object({}),
        func: async () => JSON.stringify(await executeMcpTool('get_preferences', {})),
    }),
    new DynamicStructuredTool({
        name: 'set_auto_bid_rules',
        description: 'Configure auto-bid rules for a vertical. The engine auto-bids on matching leads.',
        schema: z.object({
            vertical: z.string().describe('Lead vertical'),
            autoBidEnabled: z.boolean().default(true),
            autoBidAmount: z.number().describe('Bid amount in USDC'),
            minQualityScore: z.number().optional().describe('Min quality score 0-100'),
            dailyBudget: z.number().optional().describe('Daily budget cap in USDC'),
            geoInclude: z.array(z.string()).optional().describe('State codes to include'),
        }),
        func: async (params) => JSON.stringify(await executeMcpTool('set_auto_bid_rules', params)),
    }),
    new DynamicStructuredTool({
        name: 'export_leads',
        description: 'Export leads as CSV or JSON for CRM integration.',
        schema: z.object({
            format: z.enum(['csv', 'json']).default('json'),
            status: z.string().default('SOLD'),
            days: z.number().default(30),
        }),
        func: async (params) => JSON.stringify(await executeMcpTool('export_leads', params)),
    }),
    new DynamicStructuredTool({
        name: 'place_bid',
        description: 'Place a sealed bid on a specific lead.',
        schema: z.object({
            leadId: z.string().describe('The lead ID to bid on'),
            commitment: z.string().describe('Bid commitment hash'),
        }),
        func: async (params) => JSON.stringify(await executeMcpTool('place_bid', params)),
    }),
    new DynamicStructuredTool({
        name: 'configure_crm_webhook',
        description: 'Register a CRM webhook (HubSpot, Zapier, or generic).',
        schema: z.object({
            url: z.string().describe('Webhook destination URL'),
            format: z.enum(['hubspot', 'zapier', 'generic']).default('generic'),
        }),
        func: async (params) => JSON.stringify(await executeMcpTool('configure_crm_webhook', params)),
    }),
    new DynamicStructuredTool({
        name: 'ping_lead',
        description: 'Get full details and current status for a specific lead.',
        schema: z.object({
            leadId: z.string().describe('The lead ID'),
            action: z.enum(['status', 'evaluate']).default('status'),
        }),
        func: async (params) => JSON.stringify(await executeMcpTool('ping_lead', params)),
    }),
    new DynamicStructuredTool({
        name: 'suggest_vertical',
        description: 'AI-powered vertical classification from a lead description.',
        schema: z.object({
            description: z.string().describe('Lead description text'),
        }),
        func: async (params) => JSON.stringify(await executeMcpTool('suggest_vertical', params)),
    }),
];

// ── System prompt (same as mcp.routes.ts) ──

const SYSTEM_PROMPT = `You are LEAD Engine AI, the autonomous bidding agent for the Lead Engine CRE platform — built for the Chainlink Block Magic Hackathon.
You are NOT Claude, NOT ChatGPT, and NOT any other third-party model. You are LEAD Engine AI.
You help buyers discover, evaluate, and bid on commercial real-estate leads on a blockchain-verified marketplace powered by Chainlink.
You have access to 9 MCP tools. Use them to answer the user's questions.

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
| Buyer Preferences | /buyer/preferences | "my preferences", "auto-bid settings", "auto-bidding", "change my verticals" |
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
- After checking preferences → "You can edit these in [Preferences](/buyer/preferences)"
- After showing bids → "View your full bid history in [My Bids](/buyer/bids)"
- When user asks "where can I..." or "how do I..." → provide the appropriate nav link
- When user says "go to", "take me to", "open", "show me" → output a link to that page
- Always use the format: [Page Name](/path) — never use full URLs.`;

// ── LangChain Prompt Template ──

const prompt = ChatPromptTemplate.fromMessages([
    ['system', SYSTEM_PROMPT],
    new MessagesPlaceholder('chat_history'),
    ['human', '{input}'],
    new MessagesPlaceholder('agent_scratchpad'),
]);

// ── Lazy-initialized executor ──

let executorInstance: AgentExecutor | null = null;

function getExecutor(): AgentExecutor {
    if (executorInstance) return executorInstance;

    const llm = new ChatMoonshot({
        apiKey: KIMI_API_KEY,
        model: 'kimi-k2.5',
        temperature: 0.2,
        maxTokens: 4096,
    });

    const agent = createToolCallingAgent({ llm, tools, prompt });
    executorInstance = new AgentExecutor({
        agent,
        tools,
        maxIterations: 5,
        returnIntermediateSteps: true,
    });

    return executorInstance;
}

// ── Chat message interface (matches mcp.routes.ts) ──

interface ChatMessage {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCall?: { name: string; params: Record<string, unknown>; result?: unknown };
}

// ── Main entry point ──

export async function runAgent(
    message: string,
    history: ChatMessage[] = [],
): Promise<{ messages: ChatMessage[]; toolCalls: any[]; mode: string }> {
    const executor = getExecutor();

    // Convert chat history to LangChain message format
    const chatHistory = history.slice(-6).flatMap((h) => {
        if (h.role === 'user') return [new HumanMessage(h.content)];
        if (h.role === 'assistant') return [new AIMessage(h.content)];
        return []; // skip tool messages in history
    });

    const result = await executor.invoke({
        input: message,
        chat_history: chatHistory,
    });

    // Extract tool call log from intermediate steps
    const toolCallLog: ChatMessage[] = [];
    const toolCallsForResponse: any[] = [];

    if (result.intermediateSteps) {
        for (const step of result.intermediateSteps) {
            const action = step.action;
            const observation = step.observation;

            let parsedResult: any;
            try {
                parsedResult = typeof observation === 'string' ? JSON.parse(observation) : observation;
            } catch {
                parsedResult = observation;
            }

            const tc = {
                name: action.tool,
                params: action.toolInput || {},
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
