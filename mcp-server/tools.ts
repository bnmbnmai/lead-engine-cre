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
];

// Build a lookup map
export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));
