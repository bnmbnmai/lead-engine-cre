// ============================================
// MCP Tool Definitions — Lead Engine CRE
// ============================================
// Each tool maps to a backend API call.
// Tools are exposed via JSON-RPC to AI agents.

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handler: string; // API endpoint
    method: 'GET' | 'POST' | 'PUT';
}

export const TOOLS: ToolDefinition[] = [
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
    },
    {
        name: 'place_bid',
        description: 'Place a bid on a lead. For commit-reveal auctions, first call with commitment hash. For direct bids, include amount.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId: { type: 'string', description: 'The lead ID to bid on' },
                amount: { type: 'number', description: 'Bid amount in USDC (for direct bids)' },
                commitment: { type: 'string', description: 'Bid commitment hash (for commit-reveal auctions)' },
            },
            required: ['leadId'],
        },
        handler: '/api/v1/bids',
        method: 'POST',
    },
    {
        name: 'get_bid_floor',
        description: 'Get real-time bid floor pricing for a vertical and country. Returns suggested minimum bid, ceiling, and market index.',
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
    },
    {
        name: 'get_preferences',
        description: 'Get the current buyer preference sets (per-vertical auto-bid, geo filters, budgets).',
        inputSchema: {
            type: 'object',
            properties: {},
        },
        handler: '/api/v1/bids/preferences/v2',
        method: 'GET',
    },
    {
        name: 'set_auto_bid_rules',
        description: 'Configure auto-bid rules for a vertical. The engine automatically bids on matching leads based on vertical, geo, quality score, and budget constraints.',
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
            },
            required: ['vertical', 'autoBidAmount'],
        },
        handler: '/api/v1/bids/preferences/v2',
        method: 'PUT',
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
        handler: '/api/v1/leads',
        method: 'GET',
    },
];

// Build a lookup map
export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

