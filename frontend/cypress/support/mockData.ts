/**
 * Seeded mock data for Cypress E2E tests.
 * Provides realistic API responses so dashboards, marketplace,
 * and preferences pages render fully without a running backend.
 */

// ── Overview / Analytics Stats ──────────────────────────────
export const mockOverview = {
    stats: {
        totalLeads: 247,
        soldLeads: 189,
        conversionRate: 76.5,
        totalRevenue: 48250,
        activeBids: 34,
        wonBids: 22,
        totalSpend: 31400,
        avgBidPrice: 165,
    },
};

// ── Leads ───────────────────────────────────────────────────
export const mockLeads = {
    leads: [
        {
            id: 'lead-001',
            vertical: 'solar',
            status: 'IN_AUCTION',
            source: 'PLATFORM',
            qualityScore: 8500,
            state: 'CA',
            country: 'US',
            region: 'West',
            createdAt: new Date().toISOString(),
            contact: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
        },
        {
            id: 'lead-002',
            vertical: 'mortgage',
            status: 'IN_AUCTION',
            source: 'API',
            qualityScore: 7200,
            state: 'TX',
            country: 'US',
            region: 'South',
            createdAt: new Date().toISOString(),
            contact: { firstName: 'John', lastName: 'Smith', email: 'john@example.com' },
        },
        {
            id: 'lead-003',
            vertical: 'roofing',
            status: 'SOLD',
            source: 'PLATFORM',
            qualityScore: 9100,
            state: 'FL',
            country: 'US',
            region: 'Southeast',
            createdAt: new Date().toISOString(),
            contact: { firstName: 'Bob', lastName: 'Builder', email: 'bob@example.com' },
        },
        {
            id: 'lead-004',
            vertical: 'solar',
            status: 'IN_AUCTION',
            source: 'OFFSITE',
            qualityScore: 6800,
            state: 'NY',
            country: 'US',
            region: 'Northeast',
            createdAt: new Date().toISOString(),
            contact: { firstName: 'Alice', lastName: 'Green', email: 'alice@example.com' },
        },
        {
            id: 'lead-005',
            vertical: 'insurance',
            status: 'IN_AUCTION',
            source: 'API',
            qualityScore: 7800,
            state: 'SP',
            country: 'BR',
            region: 'Southeast',
            createdAt: new Date().toISOString(),
            contact: { firstName: 'Carlos', lastName: 'Silva', email: 'carlos@example.com' },
        },
        {
            id: 'lead-006',
            vertical: 'mortgage',
            status: 'SOLD',
            source: 'PLATFORM',
            qualityScore: 8900,
            state: 'NSW',
            country: 'AU',
            region: 'East',
            createdAt: new Date().toISOString(),
            contact: { firstName: 'Sarah', lastName: 'Chen', email: 'sarah@example.com' },
        },
    ],
    total: 6,
    page: 1,
    limit: 10,
};

// ── Asks (Auction Listings) ─────────────────────────────────
export const mockAsks = {
    asks: [
        {
            id: 'ask-001',
            vertical: 'solar',
            status: 'ACTIVE',
            reservePrice: 150,
            targetCountry: 'US',
            targetStates: ['CA', 'TX', 'FL'],
            acceptOffSite: true,
            bidsCount: 5,
            createdAt: new Date().toISOString(),
        },
        {
            id: 'ask-002',
            vertical: 'mortgage',
            status: 'ACTIVE',
            reservePrice: 200,
            targetCountry: 'US',
            targetStates: ['NY', 'NJ', 'CT'],
            acceptOffSite: false,
            bidsCount: 3,
            createdAt: new Date().toISOString(),
        },
        {
            id: 'ask-003',
            vertical: 'roofing',
            status: 'ACTIVE',
            reservePrice: 120,
            targetCountry: 'AU',
            targetStates: ['NSW', 'VIC'],
            acceptOffSite: true,
            bidsCount: 2,
            createdAt: new Date().toISOString(),
        },
        {
            id: 'ask-004',
            vertical: 'insurance',
            status: 'ACTIVE',
            reservePrice: 180,
            targetCountry: 'BR',
            targetStates: ['SP', 'RJ'],
            acceptOffSite: false,
            bidsCount: 1,
            createdAt: new Date().toISOString(),
        },
    ],
    total: 4,
};

// ── Bids ────────────────────────────────────────────────────
export const mockBids = {
    bids: [
        {
            id: 'bid-001',
            leadId: 'lead-001',
            amount: 175,
            status: 'Won',
            vertical: 'solar',
            createdAt: new Date().toISOString(),
        },
        {
            id: 'bid-002',
            leadId: 'lead-002',
            amount: 210,
            status: 'Pending',
            vertical: 'mortgage',
            createdAt: new Date().toISOString(),
        },
        {
            id: 'bid-003',
            leadId: 'lead-003',
            amount: 130,
            status: 'Lost',
            vertical: 'roofing',
            createdAt: new Date().toISOString(),
        },
        {
            id: 'bid-004',
            leadId: 'lead-004',
            amount: 160,
            status: 'Pending',
            vertical: 'solar',
            createdAt: new Date().toISOString(),
        },
        {
            id: 'bid-005',
            leadId: 'lead-006',
            amount: 195,
            status: 'Won',
            vertical: 'mortgage',
            createdAt: new Date().toISOString(),
        },
    ],
    total: 5,
};

// ── Preference Sets ─────────────────────────────────────────
export const mockPreferenceSets = {
    sets: [
        {
            id: 'pref-001',
            vertical: 'solar',
            country: 'US',
            regions: ['CA', 'TX', 'FL'],
            maxBid: 200,
            dailyBudget: 1000,
            qualityGate: 7000,
            autoBid: true,
            acceptOffSite: true,
        },
        {
            id: 'pref-002',
            vertical: 'mortgage',
            country: 'AU',
            regions: ['NSW', 'VIC'],
            maxBid: 250,
            dailyBudget: 800,
            qualityGate: 8000,
            autoBid: false,
            acceptOffSite: false,
        },
    ],
};

// ── Lead Analytics ──────────────────────────────────────────
export const mockLeadAnalytics = {
    chartData: [
        { date: '2026-01-01', leads: 12, revenue: 1800 },
        { date: '2026-01-08', leads: 18, revenue: 2700 },
        { date: '2026-01-15', leads: 24, revenue: 3600 },
        { date: '2026-01-22', leads: 20, revenue: 3000 },
        { date: '2026-01-29', leads: 32, revenue: 4800 },
        { date: '2026-02-05', leads: 28, revenue: 4200 },
    ],
    byVertical: {
        solar: { leads: 45, revenue: 8100 },
        mortgage: { leads: 38, revenue: 7600 },
        roofing: { leads: 22, revenue: 3300 },
        insurance: { leads: 15, revenue: 2700 },
    },
};

// ── Bid Analytics ───────────────────────────────────────────
export const mockBidAnalytics = {
    chartData: [
        { date: '2026-01-01', bids: 8, spend: 1200 },
        { date: '2026-01-08', bids: 14, spend: 2100 },
        { date: '2026-01-15', bids: 11, spend: 1650 },
        { date: '2026-01-22', bids: 19, spend: 2850 },
        { date: '2026-01-29', bids: 16, spend: 2400 },
        { date: '2026-02-05', bids: 22, spend: 3300 },
    ],
    byVertical: {
        solar: { bids: 30, spend: 5250 },
        mortgage: { bids: 24, spend: 4800 },
        roofing: { bids: 12, spend: 1800 },
        insurance: { bids: 8, spend: 1440 },
    },
};

// ── Mock User Profiles ──────────────────────────────────────
export const mockSellerUser = {
    user: {
        id: 'seller-001',
        walletAddress: '0xSeller1234567890abcdef',
        role: 'SELLER',
        kycStatus: 'VERIFIED',
        profile: { companyName: 'Test Corp', verticals: ['solar', 'mortgage'] },
    },
};

export const mockBuyerUser = {
    user: {
        id: 'buyer-001',
        walletAddress: '0xBuyer1234567890abcdef',
        role: 'BUYER',
        kycStatus: 'VERIFIED',
        profile: { companyName: 'Buy Co', verticals: ['solar', 'roofing'] },
    },
};

export const mockAdminUser = {
    user: {
        id: 'admin-001',
        walletAddress: '0xAdmin1234567890abcdef',
        role: 'ADMIN',
        kycStatus: 'VERIFIED',
        profile: { companyName: 'Lead Engine Admin', verticals: ['solar', 'mortgage', 'roofing', 'insurance', 'auto'] },
    },
};

// ── Chainlink Oracle Price Feeds ────────────────────────────
export const mockChainlinkFeed = {
    roundId: '110680464442257320877',
    answer: '185042000000', // $1,850.42 ETH/USD (8 decimals)
    startedAt: Math.floor(Date.now() / 1000) - 60,
    updatedAt: Math.floor(Date.now() / 1000) - 30,
    answeredInRound: '110680464442257320877',
    decimals: 8,
    description: 'ETH / USD',
    source: 'chainlink-mock',
};

export const mockChainlinkLatencyFeed = {
    ...mockChainlinkFeed,
    // Simulates a stale price (>5 min old)
    updatedAt: Math.floor(Date.now() / 1000) - 360,
    answer: '184500000000',
};

// ── x402 Payment Responses ──────────────────────────────────
export const mockPaymentReceipt = {
    txHash: '0xabc123def456789012345678901234567890abcdef1234567890abcdef123456',
    status: 'confirmed',
    blockNumber: 18_500_123,
    gasUsed: '65000',
    effectiveGasPrice: '25000000000',
    from: '0xBuyer1234567890abcdef',
    to: '0xEscrow1234567890abcdef',
    amount: '175000000', // 175 USDC (6 decimals)
    currency: 'USDC',
    chain: 'base-sepolia',
    timestamp: new Date().toISOString(),
};

export const mockPaymentFailure = {
    error: 'Payment Required',
    code: 'X402_INSUFFICIENT_FUNDS',
    resolution: 'Deposit at least 175 USDC to your connected wallet.',
    action: { label: 'Add Funds', href: '/wallet/deposit' },
    requiredAmount: '175000000',
    walletBalance: '50000000',
};

// ── Ethers.js Wallet Mock States ────────────────────────────
export const mockWallets = {
    seller: {
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
        chainId: 11155111, // Sepolia
        chainName: 'Sepolia',
        balance: '2500000000000000000', // 2.5 ETH
        usdcBalance: '5000000000', // 5000 USDC
    },
    buyer1: {
        address: '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
        chainId: 11155111,
        chainName: 'Sepolia',
        balance: '1800000000000000000',
        usdcBalance: '3200000000',
    },
    buyer2: {
        address: '0xdD2FD4581271e230360230F9337D5c0430Bf44C0',
        chainId: 11155111,
        chainName: 'Sepolia',
        balance: '900000000000000000',
        usdcBalance: '1500000000',
    },
    admin: {
        address: '0xAd01n1234567890abcdef1234567890abcdef1234',
        chainId: 11155111,
        chainName: 'Sepolia',
        balance: '5000000000000000000',
        usdcBalance: '10000000000',
    },
};

// ── Settlement Transaction Data ─────────────────────────────
export const mockSettlement = {
    id: 'settle-001',
    auctionId: 'ask-001',
    leadId: 'lead-001',
    winnerId: 'buyer-001',
    sellerId: 'seller-001',
    amount: 175,
    currency: 'USDC',
    txHash: '0xabc123def456789012345678901234567890abcdef1234567890abcdef123456',
    status: 'SETTLED',
    chain: 'base-sepolia',
    blockNumber: 18_500_123,
    settledAt: new Date().toISOString(),
    escrowContract: '0xEscrow1234567890abcdef',
    nftTokenId: '42',
};
