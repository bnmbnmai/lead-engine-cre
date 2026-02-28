/**
 * setupMocks.ts — Custom Cypress command that intercepts all API routes
 * with seeded mock data. Call `cy.mockApi()` in beforeEach to enable.
 *
 * NOTE: Uses full absolute URLs (http://localhost:3001/...) as the second
 *       parameter to cy.intercept(method, urlPattern, response) to match
 *       cross-origin API calls. Glob patterns (*) work with the string form.
 */

import {
    mockOverview,
    mockLeads,
    mockAsks,
    mockBids,
    mockPreferenceSets,
    mockLeadAnalytics,
    mockBidAnalytics,
    mockSellerUser,
    mockBuyerUser,
    mockAdminUser,
    mockChainlinkFeed,
    mockChainlinkLatencyFeed,
    mockPaymentReceipt,
    mockPaymentFailure,
    mockSettlement,
} from './mockData';

interface MockApiOptions {
    latency?: number;
    empty?: boolean;
    role?: 'seller' | 'buyer' | 'admin';
    /** Simulate Chainlink oracle 504 timeout */
    failChainlink?: boolean;
    /** Simulate >5s Chainlink latency (stale price) */
    slowChainlink?: boolean;
    /** Simulate escrow payment failure (insufficient funds) */
    failPayment?: boolean;
}

const API = 'http://localhost:3001/api/v1';

Cypress.Commands.add('mockApi', (options: MockApiOptions = {}) => {
    const delay = options.latency || 0;
    const empty = options.empty || false;

    const stored = localStorage.getItem('le_auth_user');
    const role = options.role || (stored ? JSON.parse(stored).role : 'buyer');
    const isSeller = role === 'seller' || role === 'admin';
    const isAdmin = role === 'admin';

    // Auth
    cy.intercept('GET', `${API}/auth/me`, {
        statusCode: 200,
        body: isAdmin ? mockAdminUser : isSeller ? mockSellerUser : mockBuyerUser,
        delay,
    }).as('getMe');

    // Overview
    cy.intercept('GET', `${API}/analytics/overview*`, {
        statusCode: 200,
        body: empty ? { stats: {} } : mockOverview,
        delay,
    }).as('getOverview');

    // Leads
    cy.intercept('GET', `${API}/leads*`, {
        statusCode: 200,
        body: empty ? { leads: [], total: 0, page: 1, limit: 10 } : mockLeads,
        delay,
    }).as('getLeads');

    // Asks
    cy.intercept('GET', `${API}/asks*`, {
        statusCode: 200,
        body: empty ? { asks: [], total: 0 } : mockAsks,
        delay,
    }).as('getAsks');

    // Bids (my)
    cy.intercept('GET', `${API}/bids/my*`, {
        statusCode: 200,
        body: empty ? { bids: [], total: 0 } : mockBids,
        delay,
    }).as('getMyBids');

    // Bids (all)
    cy.intercept('GET', `${API}/bids*`, {
        statusCode: 200,
        body: empty ? { bids: [], total: 0 } : mockBids,
        delay,
    }).as('getBids');

    // Bid Floor — Chainlink oracle pricing
    if (options.failChainlink) {
        cy.intercept('GET', `${API}/bids/bid-floor*`, {
            statusCode: 504,
            body: { error: 'Gateway Timeout — Chainlink oracle unreachable' },
        }).as('getBidFloor');
    } else if (options.slowChainlink) {
        cy.intercept('GET', `${API}/bids/bid-floor*`, {
            statusCode: 200,
            body: { floor: 50, currency: 'USDC', source: 'chainlink-stale', stale: true },
            delay: 6000, // >5s simulates real Chainlink latency
        }).as('getBidFloor');
    } else {
        cy.intercept('GET', `${API}/bids/bid-floor*`, {
            statusCode: 200,
            body: { floor: 50, currency: 'USDC', source: 'chainlink-mock' },
            delay,
        }).as('getBidFloor');
    }

    // Chainlink Oracle Feed (direct)
    cy.intercept('GET', `${API}/chainlink*`, {
        statusCode: options.failChainlink ? 504 : 200,
        body: options.failChainlink
            ? { error: 'Chainlink DON timeout' }
            : options.slowChainlink
                ? mockChainlinkLatencyFeed
                : mockChainlinkFeed,
        delay: options.slowChainlink ? 6000 : delay,
    }).as('getChainlinkFeed');

    // Preference Sets
    cy.intercept('GET', `${API}/bids/preferences*`, {
        statusCode: 200,
        body: empty ? { sets: [] } : mockPreferenceSets,
        delay,
    }).as('getPreferenceSets');

    cy.intercept('PUT', `${API}/bids/preferences*`, {
        statusCode: 200,
        body: { success: true },
        delay,
    }).as('savePreferenceSets');

    // Lead Analytics
    cy.intercept('GET', `${API}/analytics/leads*`, {
        statusCode: 200,
        body: empty ? { chartData: [], byVertical: {} } : mockLeadAnalytics,
        delay,
    }).as('getLeadAnalytics');

    // Bid Analytics
    cy.intercept('GET', `${API}/analytics/bids*`, {
        statusCode: 200,
        body: empty ? { chartData: [], byVertical: {} } : mockBidAnalytics,
        delay,
    }).as('getBidAnalytics');

    // Seller Profile
    cy.intercept('GET', `${API}/seller/profile*`, {
        statusCode: 200,
        body: isSeller
            ? { profile: { id: 'sp-001', companyName: 'Test Seller Co', verified: true, verticals: ['solar', 'mortgage', 'roofing'] } }
            : { profile: null },
        delay,
    }).as('getSellerProfile');

    cy.intercept('POST', `${API}/seller/profile*`, {
        statusCode: 201,
        body: { success: true, profile: { id: 'sp-001', companyName: 'Test Seller Co', verified: true } },
        delay,
    }).as('createSellerProfile');



    // Lead Submit
    cy.intercept('POST', `${API}/leads*`, {
        statusCode: 201,
        body: { lead: mockLeads.leads[0], message: 'Lead created successfully' },
        delay,
    }).as('submitLead');

    // Ask Create
    cy.intercept('POST', `${API}/asks*`, {
        statusCode: 201,
        body: { ask: mockAsks.asks[0], message: 'Ask created successfully' },
        delay,
    }).as('createAsk');

    // Bid Place — escrow payment simulation
    if (options.failPayment) {
        cy.intercept('POST', `${API}/bids*`, {
            statusCode: 402,
            body: mockPaymentFailure,
        }).as('placeBid');
    } else {
        cy.intercept('POST', `${API}/bids*`, {
            statusCode: 201,
            body: { bid: mockBids.bids[0], message: 'Bid placed successfully' },
            delay,
        }).as('placeBid');
    }

    // escrow Payment endpoint
    cy.intercept('POST', `${API}/payments*`, {
        statusCode: options.failPayment ? 402 : 200,
        body: options.failPayment ? mockPaymentFailure : mockPaymentReceipt,
        delay,
    }).as('processPayment');

    // Settlement
    cy.intercept('GET', `${API}/settlements*`, {
        statusCode: 200,
        body: empty ? { settlements: [] } : { settlements: [mockSettlement] },
        delay,
    }).as('getSettlements');

    // CRM
    cy.intercept('GET', `${API}/crm*`, {
        statusCode: 200,
        body: { webhooks: [], exports: [] },
        delay,
    }).as('getCRM');

    cy.intercept('POST', `${API}/crm*`, {
        statusCode: 200,
        body: { success: true },
        delay,
    }).as('postCRM');

    // Catch-all (register BEFORE specific overrides so they take priority)
    // Cypress matches last-registered-first, so intercepts below override this.
    cy.intercept(`${API}/**`, {
        statusCode: 200,
        body: {},
        delay,
    });

    // Verticals Hierarchy (registered AFTER catch-all for priority)
    cy.intercept('GET', `${API}/verticals/hierarchy*`, {
        statusCode: 200,
        body: {
            tree: [
                { id: 'solar', slug: 'solar', name: 'Solar', depth: 0, sortOrder: 0, status: 'active', children: [] },
                { id: 'mortgage', slug: 'mortgage', name: 'Mortgage', depth: 0, sortOrder: 1, status: 'active', children: [] },
                { id: 'roofing', slug: 'roofing', name: 'Roofing', depth: 0, sortOrder: 2, status: 'active', children: [] },
                { id: 'insurance', slug: 'insurance', name: 'Insurance', depth: 0, sortOrder: 3, status: 'active', children: [] },
                { id: 'auto', slug: 'auto', name: 'Auto', depth: 0, sortOrder: 4, status: 'active', children: [] },
                { id: 'legal', slug: 'legal', name: 'Legal', depth: 0, sortOrder: 5, status: 'active', children: [] },
                { id: 'home_services', slug: 'home_services', name: 'Home Services', depth: 0, sortOrder: 6, status: 'active', children: [] },
                { id: 'real_estate', slug: 'real_estate', name: 'Real Estate', depth: 0, sortOrder: 7, status: 'active', children: [] },
                { id: 'financial', slug: 'financial', name: 'Financial', depth: 0, sortOrder: 8, status: 'active', children: [] },
                { id: 'b2b_saas', slug: 'b2b_saas', name: 'B2B SaaS', depth: 0, sortOrder: 9, status: 'active', children: [] },
            ],
        },
        delay,
    }).as('getVerticals');

    // Verticals Flat (registered AFTER catch-all for priority)
    cy.intercept('GET', `${API}/verticals/flat*`, {
        statusCode: 200,
        body: {
            verticals: [
                { slug: 'solar', name: 'Solar' },
                { slug: 'mortgage', name: 'Mortgage' },
                { slug: 'roofing', name: 'Roofing' },
                { slug: 'insurance', name: 'Insurance' },
                { slug: 'auto', name: 'Auto' },
            ],
            total: 5,
        },
        delay,
    }).as('getVerticalsFlat');
});

declare global {
    namespace Cypress {
        interface Chainable {
            mockApi(options?: MockApiOptions): Chainable<void>;
        }
    }
}

