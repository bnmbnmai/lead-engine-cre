/**
 * Auto-Bid Service Tests
 *
 * Unit tests for the auto-bid engine's matching logic, including:
 * - Quality score gating ("bid if score > 80")
 * - Geo include/exclude filtering
 * - Daily budget enforcement
 * - Off-site lead rejection
 * - Multi-buyer concurrent auto-bid
 * - Vertical-specific rules (solar vs mortgage)
 */

import { evaluateLeadForAutoBid, LeadData } from '../src/services/auto-bid.service';

// ============================================
// Mock Prisma
// ============================================

const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockAggregate = jest.fn();

jest.mock('../src/lib/prisma', () => ({
    prisma: {
        buyerPreferenceSet: { findMany: (...args: any[]) => mockFindMany(...args) },
        bid: {
            findFirst: (...args: any[]) => mockFindFirst(...args),
            create: (...args: any[]) => mockCreate(...args),
            aggregate: (...args: any[]) => mockAggregate(...args),
        },
        analyticsEvent: { create: jest.fn().mockResolvedValue({}) },
    },
}));

// ============================================
// Helpers
// ============================================

function makeLead(overrides: Partial<LeadData> = {}): LeadData {
    return {
        id: 'lead_test_1',
        vertical: 'solar',
        geo: { country: 'US', state: 'CA' },
        source: 'PLATFORM',
        qualityScore: 9000,
        isVerified: true,
        reservePrice: 100,
        ...overrides,
    };
}

function makePrefSet(overrides: any = {}) {
    return {
        id: 'pref_1',
        vertical: 'solar',
        isActive: true,
        autoBidEnabled: true,
        autoBidAmount: 120,
        minQualityScore: null,
        geoCountry: 'US',
        geoInclude: [],
        geoExclude: [],
        acceptOffSite: true,
        requireVerified: false,
        maxBidPerLead: null,
        dailyBudget: null,
        label: 'Solar — US',
        priority: 0,
        buyerProfile: {
            userId: 'buyer_1',
            user: { id: 'buyer_1', walletAddress: '0xBuyer1' },
        },
        ...overrides,
    };
}

// ============================================
// Tests
// ============================================

beforeEach(() => {
    jest.clearAllMocks();
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'bid_1' });
    mockAggregate.mockResolvedValue({ _sum: { amount: 0 } });
});

describe('Auto-Bid Service', () => {
    describe('Quality Score Gate', () => {
        it('should bid when lead score exceeds minimum', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ minQualityScore: 8000 }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ qualityScore: 9000 }));

            expect(result.bidsPlaced).toHaveLength(1);
            expect(result.bidsPlaced[0].amount).toBe(120);
            expect(result.skipped).toHaveLength(0);
        });

        it('should skip when lead score is below minimum (bid if score > 80 = 8000)', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ minQualityScore: 8000 }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ qualityScore: 7500 }));

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped).toHaveLength(1);
            expect(result.skipped[0].reason).toContain('Quality 7500 < min 8000');
        });

        it('should bid when no quality score gate is set', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ minQualityScore: null }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ qualityScore: null }));

            expect(result.bidsPlaced).toHaveLength(1);
        });
    });

    describe('Geo Include/Exclude Filtering', () => {
        it('should bid when state is in include list', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ geoInclude: ['CA', 'FL', 'TX'] }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ geo: { country: 'US', state: 'CA' } }));

            expect(result.bidsPlaced).toHaveLength(1);
        });

        it('should skip when state is NOT in include list', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ geoInclude: ['FL', 'TX'] }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ geo: { country: 'US', state: 'CA' } }));

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped[0].reason).toContain('State CA not in include list');
        });

        it('should skip when state is in exclude list', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ geoExclude: ['NY', 'CA'] }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ geo: { country: 'US', state: 'CA' } }));

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped[0].reason).toContain('State CA in exclude list');
        });

        it('should skip when country does not match', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ geoCountry: 'CA' }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ geo: { country: 'US', state: 'CA' } }));

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped[0].reason).toContain('Country mismatch');
        });
    });

    describe('Off-Site Lead Rejection', () => {
        it('should reject off-site lead when acceptOffSite is false', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ acceptOffSite: false }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ source: 'OFFSITE' }));

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped[0].reason).toBe('Off-site leads rejected');
        });

        it('should accept off-site lead when acceptOffSite is true', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ acceptOffSite: true }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ source: 'OFFSITE' }));

            expect(result.bidsPlaced).toHaveLength(1);
        });
    });

    describe('Daily Budget Enforcement', () => {
        it('should skip when daily budget would be exceeded', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ dailyBudget: 200, autoBidAmount: 120 }),
            ]);
            // Already spent $150 today
            mockAggregate.mockResolvedValue({ _sum: { amount: 150 } });

            const result = await evaluateLeadForAutoBid(makeLead());

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped[0].reason).toContain('Daily budget exceeded');
        });

        it('should bid when within daily budget', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ dailyBudget: 500, autoBidAmount: 120 }),
            ]);
            mockAggregate.mockResolvedValue({ _sum: { amount: 100 } });

            const result = await evaluateLeadForAutoBid(makeLead());

            expect(result.bidsPlaced).toHaveLength(1);
        });
    });

    describe('Verified-Only Toggle', () => {
        it('should skip unverified lead when requireVerified is true', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ requireVerified: true }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ isVerified: false }));

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped[0].reason).toBe('Requires verified lead');
        });
    });

    describe('Reserve Price Check', () => {
        it('should skip when bid amount is below reserve', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ autoBidAmount: 50 }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ reservePrice: 100 }));

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped[0].reason).toContain('Bid $50 < reserve $100');
        });
    });

    describe('Multi-Buyer Concurrent Auto-Bid', () => {
        it('should place bids for multiple matching buyers on the same lead', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({
                    id: 'pref_1',
                    autoBidAmount: 120,
                    buyerProfile: { userId: 'buyer_1', user: { id: 'buyer_1', walletAddress: '0xA' } },
                }),
                makePrefSet({
                    id: 'pref_2',
                    autoBidAmount: 130,
                    buyerProfile: { userId: 'buyer_2', user: { id: 'buyer_2', walletAddress: '0xB' } },
                }),
                makePrefSet({
                    id: 'pref_3',
                    autoBidAmount: 110,
                    buyerProfile: { userId: 'buyer_3', user: { id: 'buyer_3', walletAddress: '0xC' } },
                }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead());

            expect(result.bidsPlaced).toHaveLength(3);
            expect(result.bidsPlaced.map((b) => b.buyerId)).toEqual(['buyer_1', 'buyer_2', 'buyer_3']);
        });
    });

    describe('Vertical-Specific Rules (Solar vs Mortgage)', () => {
        it('should only match preference sets for the correct vertical', async () => {
            // findMany already filters by vertical, so only matching sets returned
            mockFindMany.mockResolvedValue([
                makePrefSet({ id: 'solar_pref', vertical: 'solar', autoBidAmount: 120 }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ vertical: 'solar' }));

            expect(result.bidsPlaced).toHaveLength(1);
            expect(result.bidsPlaced[0].preferenceSetId).toBe('solar_pref');
        });

        it('should return empty when no preference sets match the vertical', async () => {
            mockFindMany.mockResolvedValue([]);

            const result = await evaluateLeadForAutoBid(makeLead({ vertical: 'mortgage' }));

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped).toHaveLength(0);
        });
    });

    describe('Duplicate Bid Prevention', () => {
        it('should skip if buyer already bid on this lead', async () => {
            mockFindMany.mockResolvedValue([makePrefSet()]);
            mockFindFirst.mockResolvedValue({ id: 'existing_bid' });

            const result = await evaluateLeadForAutoBid(makeLead());

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped[0].reason).toBe('Already bid on this lead');
        });
    });

    describe('Max Bid Per Lead Cap', () => {
        it('should skip when bid exceeds max per lead', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ autoBidAmount: 200, maxBidPerLead: 150 }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead());

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped[0].reason).toContain('Bid $200 > max per lead $150');
        });
    });
});
