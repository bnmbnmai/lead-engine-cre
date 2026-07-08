/**
 * Canonical MCP tool registry (Phase B5).
 *
 * Single source of truth for every tool exposed to AI agents. Consumed by:
 *   - mcp-server/tools.ts        → JSON-RPC proxy definitions (handler + method)
 *   - backend mcp.routes.ts      → OpenAI function format + Anthropic tool format
 *   - backend agent.service.ts   → LangChain tool names/descriptions
 *
 * Before B5 these three surfaces each carried hand-maintained copies that had
 * already drifted (different descriptions, missing tools, stale schemas).
 */

export type JsonSchema = Record<string, unknown>;

/**
 * Where a tool can actually be executed:
 *   - 'rpc'        served by the MCP server JSON-RPC proxy (requires handler)
 *   - 'chat'       executable by the backend raw-Kimi chat loop (proxy or in-process)
 *   - 'langchain'  bound as a LangChain DynamicStructuredTool in agent.service
 */
export type ToolSurface = 'rpc' | 'chat' | 'langchain';

export interface AgentToolDef {
    name: string;
    description: string;
    /** JSON Schema for the tool input. */
    inputSchema: JsonSchema;
    /**
     * Backend REST endpoint the MCP server proxies to. Tools without a
     * handler are implemented in-process (e.g. socket subscriptions) and are
     * NOT served by the JSON-RPC proxy.
     */
    handler?: string;
    method?: 'GET' | 'POST' | 'PUT';
    surfaces: ToolSurface[];
}

/** Default surfaces for REST-proxied tools. */
const ALL: ToolSurface[] = ['rpc', 'chat', 'langchain'];

export const AGENT_TOOLS: AgentToolDef[] = [
    {
        name: 'search_leads',
        description: 'Search and filter available leads in the marketplace. Returns leads matching the given criteria with pricing, geo, and quality data.',
        inputSchema: {
            type: 'object',
            properties: {
                vertical: { type: 'string', description: 'Lead vertical (solar, mortgage, roofing, insurance, etc.)' },
                state: { type: 'string', description: 'US state code (e.g., CA, FL, TX)' },
                minPrice: { type: 'number', description: 'Minimum reserve price in USDC' },
                maxPrice: { type: 'number', description: 'Maximum reserve price in USDC' },
                status: { type: 'string', enum: ['ACTIVE', 'IN_AUCTION', 'ALL'], default: 'ACTIVE' },
                limit: { type: 'number', default: 20, maximum: 100 },
                offset: { type: 'number', default: 0 },
            },
        },
        handler: '/api/v1/asks',
        method: 'GET',
        surfaces: ALL,
    },
    {
        name: 'get_bid_floor',
        description: 'Get real-time bid floor pricing for a vertical and country. Returns suggested minimum bid, ceiling, and market index powered by Chainlink Data Feeds.',
        inputSchema: {
            type: 'object',
            properties: {
                vertical: { type: 'string', description: 'Lead vertical (solar, mortgage, etc.)' },
                country: { type: 'string', default: 'US', description: 'Country code' },
            },
            required: ['vertical'],
        },
        handler: '/api/v1/bids/bid-floor',
        method: 'GET',
        surfaces: ALL,
    },
    {
        name: 'export_leads',
        description: 'Export leads as CSV or JSON for CRM integration.',
        inputSchema: {
            type: 'object',
            properties: {
                format: { type: 'string', enum: ['csv', 'json'], default: 'json' },
                status: { type: 'string', default: 'SOLD' },
                days: { type: 'number', default: 30 },
                vertical: { type: 'string' },
            },
        },
        handler: '/api/v1/crm/export',
        method: 'GET',
        surfaces: ALL,
    },
    {
        name: 'get_preferences',
        description: 'Get the current buyer preference sets including field-level rules (per-vertical auto-bid, geo filters, budgets, and granular field filters like roof_condition=Excellent or system_size>=10).',
        inputSchema: { type: 'object', properties: {} },
        handler: '/api/v1/bids/preferences/v2',
        method: 'GET',
        surfaces: ALL,
    },
    {
        name: 'get_vertical_fields',
        description: 'Get biddable fields for a vertical. Returns field definitions (key, label, type, options) that can be used as fieldFilters in set_auto_bid_rules. Only fields marked as biddable and non-PII are returned.',
        inputSchema: {
            type: 'object',
            properties: {
                vertical: { type: 'string', description: 'Vertical slug (e.g., solar, mortgage, roofing)' },
            },
            required: ['vertical'],
        },
        handler: '/api/v1/verticals/{vertical}/fields',
        method: 'GET',
        surfaces: ALL,
    },
    {
        name: 'set_auto_bid_rules',
        description: 'Configure auto-bid rules for a vertical, including granular field-level filters. The engine automatically places sealed commit-reveal bids on matching leads. Use get_vertical_fields first to discover available filter fields for a vertical.',
        inputSchema: {
            type: 'object',
            properties: {
                vertical: { type: 'string', description: 'Lead vertical (solar, mortgage, roofing, etc.)' },
                autoBidEnabled: { type: 'boolean', description: 'Enable/disable auto-bidding for this vertical', default: true },
                autoBidAmount: { type: 'number', description: 'Fixed bid amount in USDC when auto-bid fires' },
                minQualityScore: { type: 'number', description: 'Minimum quality score (0-10000). E.g., "bid if score > 80" = 8000', minimum: 0, maximum: 10000 },
                maxBidPerLead: { type: 'number', description: 'Maximum bid amount per lead in USDC' },
                dailyBudget: { type: 'number', description: 'Daily budget cap in USDC' },
                geoCountry: { type: 'string', description: 'Target country code (e.g., US, CA, BR)', default: 'US' },
                geoInclude: { type: 'array', items: { type: 'string' }, description: 'State/region codes to include (e.g., ["CA", "FL", "TX"])' },
                geoExclude: { type: 'array', items: { type: 'string' }, description: 'State/region codes to exclude' },
                acceptOffSite: { type: 'boolean', description: 'Accept off-site leads', default: true },
                requireVerified: { type: 'boolean', description: 'Only bid on verified leads', default: false },
                fieldFilters: {
                    type: 'object',
                    description: 'Granular field-level filters. Keys are field keys from get_vertical_fields (e.g., "roof_condition", "system_size"). Values are {op, value} objects.',
                    additionalProperties: {
                        type: 'object',
                        properties: {
                            op: { type: 'string', enum: ['==', '!=', '>=', '<=', '>', '<', 'includes', '!includes', 'between', 'contains', 'startsWith'], description: 'Filter operator' },
                            value: { type: 'string', description: 'Filter value. For "includes"/"!includes" use JSON array string e.g. \'["Good","Excellent"]\'. For "between" use JSON array e.g. \'[10, 50]\'.' },
                        },
                        required: ['op', 'value'],
                    },
                },
            },
            required: ['vertical', 'autoBidAmount'],
        },
        handler: '/api/v1/bids/preferences/v2',
        method: 'PUT',
        surfaces: ALL,
    },
    {
        name: 'search_leads_advanced',
        description: 'Advanced lead search with field-level filters. Search leads by vertical, geo, pricing filters AND granular field-level rules (e.g., roof_condition=Excellent, system_size>=10). Use get_vertical_fields to discover available filter fields.',
        inputSchema: {
            type: 'object',
            properties: {
                vertical: { type: 'string', description: 'Lead vertical to search in' },
                state: { type: 'string', description: 'US state code (e.g., CA, FL)' },
                minPrice: { type: 'number', description: 'Minimum reserve price in USDC' },
                maxPrice: { type: 'number', description: 'Maximum reserve price in USDC' },
                filterRules: {
                    type: 'array',
                    description: 'Field-level filter rules',
                    items: {
                        type: 'object',
                        properties: {
                            fieldKey: { type: 'string', description: 'Field key from get_vertical_fields' },
                            operator: { type: 'string', enum: ['EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'CONTAINS', 'STARTS_WITH'] },
                            value: { type: 'string', description: 'Filter value (JSON-encoded for arrays)' },
                        },
                        required: ['fieldKey', 'operator', 'value'],
                    },
                },
                limit: { type: 'number', default: 20, maximum: 100 },
                offset: { type: 'number', default: 0 },
            },
            required: ['vertical'],
        },
        handler: '/api/v1/marketplace/leads/search',
        method: 'POST',
        surfaces: ALL,
    },
    {
        name: 'configure_crm_webhook',
        description: 'Register a CRM webhook (HubSpot, Zapier, or generic) to receive lead data on events like lead.sold.',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Webhook destination URL (e.g., HubSpot API endpoint or Zapier catch hook)' },
                format: { type: 'string', enum: ['hubspot', 'zapier', 'generic'], default: 'generic', description: 'CRM format for payload transformation' },
                events: { type: 'array', items: { type: 'string' }, default: ['lead.sold'], description: 'Events to trigger webhook (e.g., lead.sold, lead.created)' },
            },
            required: ['url'],
        },
        handler: '/api/v1/crm/webhooks',
        method: 'POST',
        surfaces: ALL,
    },
    {
        name: 'ping_lead',
        description: 'Programmatic ping/post for a specific lead. Returns full lead details, current bid status, and auction state. Use for automated lead intake pipelines.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId: { type: 'string', description: 'The lead ID to ping/query' },
                action: { type: 'string', enum: ['status', 'evaluate'], default: 'status', description: 'Action: "status" returns current state, "evaluate" triggers auto-bid evaluation' },
            },
            required: ['leadId'],
        },
        // {leadId} is substituted by the /rpc path-param logic. action=evaluate
        // is rerouted to POST /api/v1/bids/auto-bid/evaluate by the adapter.
        handler: '/api/v1/leads/{leadId}',
        method: 'GET',
        surfaces: ALL,
    },
    {
        name: 'suggest_vertical',
        description: 'Analyze a lead description and suggest the best vertical classification. Uses AI with rule-based fallback. PII is auto-scrubbed before processing.',
        inputSchema: {
            type: 'object',
            properties: {
                description: { type: 'string', description: 'Lead description text (PII is automatically scrubbed)' },
                vertical: { type: 'string', description: 'Optional hint for parent vertical slug (e.g., "home_services")' },
                leadId: { type: 'string', description: 'Optional source lead ID for tracking suggestion origin' },
            },
            required: ['description'],
        },
        handler: '/api/v1/verticals/suggest',
        method: 'POST',
        surfaces: ALL,
    },
    {
        name: 'query_open_granular_bounties',
        description: 'Query active USDC bounty pools for a vertical. Returns total available bounty, pool count, and per-pool criteria (min quality score, geo states, min credit score, max lead age). Use this before placing a bid to estimate bonus revenue on top of the winning bid. Bounty matching is verified on-chain via Chainlink Functions (BountyMatcher contract).',
        inputSchema: {
            type: 'object',
            properties: {
                vertical: { type: 'string', description: 'Lead vertical slug (solar, mortgage, roofing, etc.). Omit to get all verticals with active bounties.' },
                state: { type: 'string', description: 'Optional 2-letter US state filter (e.g., CA, FL). Returns only pools that accept this state.' },
                minScore: { type: 'number', description: 'Optional minimum quality score (0–10000). Returns only pools whose minQualityScore is ≤ this value, i.e. pools the lead can match.' },
            },
        },
        handler: '/api/v1/bounties/available',
        method: 'GET',
        surfaces: ALL,
    },

    // ── Backend in-process tools (no REST proxy handler) ──

    {
        name: 'batched_private_score_request',
        description: 'Request a Phase 2 batched confidential quality score for a lead. Runs quality score + ZK fraud signal + ACE compliance in a single DON enclave computation and stores an AES-GCM encrypted envelope in the lead record. Returns the composite score and ACE compliance result without any PII.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId: { type: 'string', description: 'The lead ID to score privately' },
            },
            required: ['leadId'],
        },
        // In-process: handled by the backend chat route, not the JSON-RPC proxy.
        surfaces: ['chat', 'langchain'],
    },
    {
        name: 'subscribe_to_live_leads',
        description: 'Subscribe to real-time events for new leads and auction updates via Socket.IO. Use this to wait for live events. Returns the first event received.',
        inputSchema: {
            type: 'object',
            properties: {
                verticals: { type: 'array', items: { type: 'string' }, description: 'Filter by vertical (e.g. solar). Omit for all.' },
            },
        },
        // In-process: a long-lived Socket.IO subscription cannot be proxied
        // over a one-shot JSON-RPC call. The backend implements this tool via
        // socket.io-client with a bounded wait.
        surfaces: ['chat', 'langchain'],
    },

    // ── LangChain-only tools (computed in-process by agent.service) ──

    {
        name: 'suggest_bid_amount',
        description: 'Suggest an optimal bid amount based on Chainlink Data Feeds floor price, lead quality score, and competition. Use this when a user asks "how much should I bid?"',
        inputSchema: {
            type: 'object',
            properties: {
                vertical: { type: 'string', description: 'Lead vertical' },
                country: { type: 'string', default: 'US', description: 'Country code' },
                qualityScore: { type: 'number', description: 'Lead quality score 0-100' },
                bidCount: { type: 'number', description: 'Current number of bids on the lead' },
            },
            required: ['vertical'],
        },
        surfaces: ['langchain'],
    },
    {
        name: 'ace_policy_check',
        description: 'Check a wallet address against the on-chain ACECompliance registry (Chainlink ACE). Returns whether the wallet is compliant (KYC passed, not sanctioned), its KYC status code, and reputation score. Use before submitting a lead or placing a bid to confirm eligibility.',
        inputSchema: {
            type: 'object',
            properties: {
                walletAddress: { type: 'string', description: 'Ethereum wallet address to check (0x format)' },
            },
            required: ['walletAddress'],
        },
        surfaces: ['langchain'],
    },

    // ── Official Chainlink CRE Skills (chainlink-agent-skills/cre-skills) ──

    {
        name: 'get_cre_score',
        description: 'Get the CRE (Chainlink Runtime Environment) quality score for a lead. Returns the on-chain verified score (0–10000), verification status, scoring breakdown, and DON attestation metadata. Powered by CREVerifier contract via Chainlink Functions.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId: { type: 'string', description: 'The lead ID to retrieve CRE quality score for' },
            },
            required: ['leadId'],
        },
        handler: '/api/v1/cre/score',
        method: 'GET',
        surfaces: ALL,
    },
    {
        name: 'trigger_cre_evaluation',
        description: 'Trigger CRE buyer-rules workflow evaluation for a specific lead. Runs the EvaluateBuyerRulesAndMatch CRE workflow (7-gate deterministic evaluation: vertical, geo, quality, off-site, verified, field filters) via Chainlink DON with ConfidentialHTTPClient and consensusIdenticalAggregation. Returns matched buyer preference sets and suggested bid amounts.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId: { type: 'string', description: 'The lead ID to evaluate against buyer preference rules' },
            },
            required: ['leadId'],
        },
        handler: '/api/v1/cre/evaluate',
        method: 'POST',
        surfaces: ALL,
    },
    {
        name: 'get_cre_workflow_status',
        description: 'Get the current CRE workflow mode status. Returns whether CRE-Native mode is enabled (DON-executed buyer matching), the CRE subscription ID, workflow health, and available CRE capabilities (quality scoring, buyer rules, winner decryption).',
        inputSchema: { type: 'object', properties: {} },
        handler: '/api/v1/cre/status',
        method: 'GET',
        surfaces: ALL,
    },

    // ── AgentRTB StrategySpec lifecycle (Option A — primary agent path) ──

    {
        name: 'list_strategies',
        description: 'List your versioned buyer strategies (StrategySpec documents). Returns id, name, status, and current version for each.',
        inputSchema: { type: 'object', properties: {} },
        handler: '/api/v1/strategies',
        method: 'GET',
        surfaces: ALL,
    },
    {
        name: 'draft_strategy',
        description: 'Draft a StrategySpec from natural language (LLM advisory only — does not activate or spend). Returns a validated spec JSON to review before create_strategy.',
        inputSchema: {
            type: 'object',
            properties: {
                description: { type: 'string', description: 'Natural language description of buying rules and budget' },
            },
            required: ['description'],
        },
        handler: '/api/v1/strategies/draft',
        method: 'POST',
        surfaces: ALL,
    },
    {
        name: 'create_strategy',
        description: 'Create a new buyer strategy from a StrategySpec JSON document. Strategy stays DRAFT until activate_strategy.',
        inputSchema: {
            type: 'object',
            properties: {
                spec: { type: 'object', description: 'Full StrategySpec object (version, name, gates, bidCurve, budget)' },
            },
            required: ['spec'],
        },
        handler: '/api/v1/strategies',
        method: 'POST',
        surfaces: ALL,
    },
    {
        name: 'activate_strategy',
        description: 'Activate a strategy so the deterministic executor places sealed bids on matching leads.',
        inputSchema: {
            type: 'object',
            properties: {
                strategyId: { type: 'string', description: 'Strategy id from list_strategies or create_strategy' },
            },
            required: ['strategyId'],
        },
        handler: '/api/v1/strategies/{strategyId}/activate',
        method: 'POST',
        surfaces: ALL,
    },
    {
        name: 'simulate_strategy',
        description: 'Backtest a strategy against historical leads (no bids placed). Returns would-bid counts and estimated spend.',
        inputSchema: {
            type: 'object',
            properties: {
                strategyId: { type: 'string' },
                days: { type: 'number', default: 30 },
                limit: { type: 'number', default: 50 },
            },
            required: ['strategyId'],
        },
        handler: '/api/v1/agent/simulate',
        method: 'POST',
        surfaces: ALL,
    },
    {
        name: 'get_decision_traces',
        description: 'Fetch recent agent decision traces (scout/evaluator/compliance/bidder stages) for audit and debugging.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', default: 20 },
                leadId: { type: 'string', description: 'Optional filter by lead id' },
            },
        },
        handler: '/api/v1/agent/traces',
        method: 'GET',
        surfaces: ALL,
    },
    {
        name: 'register_agent',
        description: 'Register an agent profile for this buyer account (display name, optional wallet for on-chain reputation).',
        inputSchema: {
            type: 'object',
            properties: {
                displayName: { type: 'string' },
                walletAddress: { type: 'string', description: 'Optional wallet for AgentRegistry attestation' },
            },
            required: ['displayName'],
        },
        handler: '/api/v1/agent/register',
        method: 'POST',
        surfaces: ALL,
    },
];

/** Lookup by tool name. */
export const AGENT_TOOL_MAP = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export function getToolDef(name: string): AgentToolDef {
    const def = AGENT_TOOL_MAP.get(name);
    if (!def) throw new Error(`[agent-tools] Unknown tool: ${name}`);
    return def;
}
