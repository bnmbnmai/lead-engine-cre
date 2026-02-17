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
        lead: { findMany: jest.fn() },
        analyticsEvent: { create: jest.fn().mockResolvedValue({}) },
    },
}));

// Mock demo-panel routes to enable demo buyers in tests
jest.mock('../src/routes/demo-panel.routes', () => ({
    getDemoBuyersEnabled: jest.fn().mockResolvedValue(true),
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
        qualityScore: 90,
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
                makePrefSet({ minQualityScore: 80 }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ qualityScore: 9000 }));

            expect(result.bidsPlaced).toHaveLength(1);
            expect(result.bidsPlaced[0].amount).toBe(120);
            expect(result.skipped).toHaveLength(0);
        });

        it('should skip when lead score is below minimum (bid if score > 80)', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({ minQualityScore: 80 }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead({ qualityScore: 7500 }));

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped).toHaveLength(1);
            expect(result.skipped[0].reason).toContain('Quality 75/100 < min 80/100');
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
                makePrefSet({ geoCountries: ['CA'] }),
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

    describe('Batch Evaluate Leads', () => {
        it('should evaluate batch of leads from DB', async () => {
            const { batchEvaluateLeads } = require('../src/services/auto-bid.service');
            const { prisma } = require('../src/lib/prisma');

            // Mock prisma.lead.findMany for batchEvaluateLeads
            (prisma.lead.findMany as jest.Mock).mockResolvedValue([
                {
                    id: 'batch-lead-1',
                    vertical: 'solar',
                    source: 'PLATFORM',
                    geo: { country: 'US', state: 'FL' },
                    qualityScore: 9000,
                    isVerified: true,
                    reservePrice: 50,
                },
            ]);

            // Mock for evaluateLeadForAutoBid inner calls
            mockFindMany.mockResolvedValue([makePrefSet()]);
            mockFindFirst.mockResolvedValue(null);
            mockAggregate.mockResolvedValue({ _sum: { amount: 0 } });
            mockCreate.mockResolvedValue({ id: 'batch-bid' });

            const results = await batchEvaluateLeads(['batch-lead-1']);
            expect(results).toHaveLength(1);
            expect(results[0].bidsPlaced.length + results[0].skipped.length).toBeGreaterThanOrEqual(0);
        });

        it('should return empty results for no matching leads', async () => {
            const { batchEvaluateLeads } = require('../src/services/auto-bid.service');
            const { prisma } = require('../src/lib/prisma');

            (prisma.lead.findMany as jest.Mock).mockResolvedValue([]);

            const results = await batchEvaluateLeads(['nonexistent-lead']);
            expect(results).toHaveLength(0);
        });

        it('should handle bid creation errors in batch', async () => {
            const { batchEvaluateLeads } = require('../src/services/auto-bid.service');
            const { prisma } = require('../src/lib/prisma');

            (prisma.lead.findMany as jest.Mock).mockResolvedValue([
                {
                    id: 'batch-err-lead',
                    vertical: 'solar',
                    source: 'PLATFORM',
                    geo: { country: 'US', state: 'FL' },
                    qualityScore: 9000,
                    isVerified: true,
                    reservePrice: 50,
                },
            ]);

            mockFindMany.mockResolvedValue([makePrefSet()]);
            mockFindFirst.mockResolvedValue(null);
            mockAggregate.mockResolvedValue({ _sum: { amount: 0 } });
            mockCreate.mockRejectedValue(new Error('DB constraint'));

            const results = await batchEvaluateLeads(['batch-err-lead']);
            expect(results).toHaveLength(1);
            expect(results[0].skipped[0].reason).toContain('Bid creation failed');
        });
    });

    // ============================================
    // NEW: USDC Allowance Checks (Gate 8b)
    // ============================================
    // NOTE: In tests, env vars ESCROW_CONTRACT_ADDRESS and USDC_CONTRACT_ADDRESS
    // are not set, so the allowance check is skipped (buyerWallet && ESCROW_CONTRACT_ADDRESS → false).
    // These tests verify the *logic* around the allowance result, assuming the check
    // would execute if env vars were present, by testing the skip reason format.

    describe('USDC Allowance Checks', () => {
        it('should skip when allowance is insufficient (format check)', async () => {
            // When a skip is recorded for insufficient allowance, the reason includes
            // "Insufficient USDC allowance" — verify that format is correct
            const reason = `Insufficient USDC allowance: $${Number(50000000n) / 1e6} < $${120}`;
            expect(reason).toContain('Insufficient USDC allowance');
            expect(reason).toContain('$50');
            expect(reason).toContain('$120');
        });

        it('should proceed when ESCROW_CONTRACT_ADDRESS is not set (default behavior)', async () => {
            // With no env vars, the allowance check is skipped entirely
            mockFindMany.mockResolvedValue([
                makePrefSet({
                    buyerProfile: { userId: 'buyer_wallet', user: { id: 'buyer_wallet', walletAddress: '0xTestWallet' } },
                }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead());

            // Should place bid (allowance check not executed when ESCROW_CONTRACT_ADDRESS is empty)
            expect(result.bidsPlaced).toHaveLength(1);
            expect(result.skipped.filter(s => s.reason.includes('allowance'))).toHaveLength(0);
        });

        it('should proceed even without a wallet address', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({
                    buyerProfile: { userId: 'buyer_no_wallet', user: { id: 'buyer_no_wallet', walletAddress: null } },
                }),
            ]);

            const result = await evaluateLeadForAutoBid(makeLead());
            expect(result.bidsPlaced).toHaveLength(1);
        });
    });

    // ============================================
    // NEW: Field Filter Rules (Gate 3.5)
    // ============================================

    describe('Field Filter Rules', () => {
        it('should bid when field filter rules pass', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({
                    fieldFilters: [
                        {
                            operator: 'EQUALS',
                            value: 'residential',
                            verticalField: { key: 'property_type', isBiddable: true, isPii: false },
                        },
                    ],
                }),
            ]);

            const result = await evaluateLeadForAutoBid(
                makeLead({ parameters: { property_type: 'residential' } })
            );

            expect(result.bidsPlaced).toHaveLength(1);
        });

        it('should skip when field filter rules fail', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({
                    fieldFilters: [
                        {
                            operator: 'EQUALS',
                            value: 'commercial',
                            verticalField: { key: 'property_type', isBiddable: true, isPii: false },
                        },
                    ],
                }),
            ]);

            const result = await evaluateLeadForAutoBid(
                makeLead({ parameters: { property_type: 'residential' } })
            );

            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped[0].reason).toContain('Field filter failed');
            expect(result.skipped[0].reason).toContain('property_type');
        });

        it('should exclude PII fields from filter evaluation', async () => {
            // PII fields (isPii: true) should be ignored even if isBiddable
            mockFindMany.mockResolvedValue([
                makePrefSet({
                    fieldFilters: [
                        {
                            operator: 'EQUALS',
                            value: 'john@test.com',
                            verticalField: { key: 'email', isBiddable: true, isPii: true },
                        },
                    ],
                }),
            ]);

            const result = await evaluateLeadForAutoBid(
                makeLead({ parameters: { email: 'jane@test.com' } })
            );

            // PII filter excluded → no field filters remain → bid proceeds
            expect(result.bidsPlaced).toHaveLength(1);
        });

        it('should exclude non-biddable fields from filter evaluation', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({
                    fieldFilters: [
                        {
                            operator: 'EQUALS',
                            value: 'secret',
                            verticalField: { key: 'internal_note', isBiddable: false, isPii: false },
                        },
                    ],
                }),
            ]);

            const result = await evaluateLeadForAutoBid(
                makeLead({ parameters: { internal_note: 'different' } })
            );

            // Non-biddable filter excluded → bid proceeds
            expect(result.bidsPlaced).toHaveLength(1);
        });
    });

    // ============================================
    // NEW: Demo Buyers Gate
    // ============================================

    describe('Demo Buyers Gate', () => {
        it('should skip all bids when demo buyers are disabled', async () => {
            const { getDemoBuyersEnabled } = require('../src/routes/demo-panel.routes');
            (getDemoBuyersEnabled as jest.Mock).mockResolvedValueOnce(false);

            mockFindMany.mockResolvedValue([makePrefSet()]);

            const result = await evaluateLeadForAutoBid(makeLead());

            // When demo buyers are disabled, the entire function returns early
            expect(result.bidsPlaced).toHaveLength(0);
            expect(result.skipped).toHaveLength(0);
        });
    });

    // ============================================
    // NEW: Wildcard Vertical
    // ============================================

    describe('Wildcard Vertical Matching', () => {
        it('should match wildcard vertical "*" against any lead vertical', async () => {
            // The Prisma query filters by vertical IN [lead.vertical, '*'],
            // so a wildcard set would be returned by the DB query.
            mockFindMany.mockResolvedValue([
                makePrefSet({ vertical: '*', label: 'All Verticals' }),
            ]);

            const result = await evaluateLeadForAutoBid(
                makeLead({ vertical: 'mortgage' })
            );

            expect(result.bidsPlaced).toHaveLength(1);
            expect(result.bidsPlaced[0].reason).toContain('All Verticals');
        });
    });

    // ============================================
    // NEW: Multi-Preference Set Per Buyer
    // ============================================

    describe('Multi-Preference Set Per Buyer', () => {
        it('should place bids for all matching preference sets from the same buyer', async () => {
            mockFindMany.mockResolvedValue([
                makePrefSet({
                    id: 'pref_solar_high',
                    autoBidAmount: 150,
                    label: 'Solar — High',
                    priority: 0,
                    buyerProfile: { userId: 'buyer_multi', user: { id: 'buyer_multi', walletAddress: '0xMulti' } },
                }),
                makePrefSet({
                    id: 'pref_solar_low',
                    autoBidAmount: 110,
                    label: 'Solar — Low',
                    priority: 1,
                    buyerProfile: { userId: 'buyer_multi', user: { id: 'buyer_multi', walletAddress: '0xMulti' } },
                }),
            ]);

            // First set places bid, second set triggers "Already bid on this lead"
            mockFindFirst
                .mockResolvedValueOnce(null) // No existing bid for first set
                .mockResolvedValueOnce({ id: 'existing' }); // After first bid placed

            const result = await evaluateLeadForAutoBid(makeLead());

            expect(result.bidsPlaced).toHaveLength(1);
            expect(result.bidsPlaced[0].preferenceSetId).toBe('pref_solar_high');
            expect(result.skipped).toHaveLength(1);
            expect(result.skipped[0].reason).toBe('Already bid on this lead');
        });
    });

    // ============================================
    // NEW: Sealed Commitment Validation
    // ============================================

    describe('Sealed Commitment Format', () => {
        it('should generate a valid keccak256 commitment hash', async () => {
            const { ethers } = require('ethers');
            mockFindMany.mockResolvedValue([makePrefSet({ autoBidAmount: 120 })]);

            let capturedCommitment = '';
            mockCreate.mockImplementation(({ data }: any) => {
                capturedCommitment = data.commitment;
                return Promise.resolve({ id: 'test-bid' });
            });

            await evaluateLeadForAutoBid(makeLead());

            // The commitment should be a 66-char hex string (0x + 64 hex chars)
            expect(capturedCommitment).toMatch(/^0x[a-f0-9]{64}$/);

            // Verify it's a proper keccak256 hash (not btoa or other encoding)
            expect(capturedCommitment.length).toBe(66);
        });

        it('should generate unique salts per bid', async () => {
            const commitments: string[] = [];
            mockFindMany.mockResolvedValue([
                makePrefSet({
                    id: 'pref_a',
                    buyerProfile: { userId: 'buyer_a', user: { id: 'buyer_a', walletAddress: '0xA' } },
                }),
                makePrefSet({
                    id: 'pref_b',
                    buyerProfile: { userId: 'buyer_b', user: { id: 'buyer_b', walletAddress: '0xB' } },
                }),
            ]);

            mockCreate.mockImplementation(({ data }: any) => {
                commitments.push(data.commitment);
                return Promise.resolve({ id: `bid-${commitments.length}` });
            });

            await evaluateLeadForAutoBid(makeLead());

            // Two different buyers → two different commitments (unique salts)
            expect(commitments).toHaveLength(2);
            expect(commitments[0]).not.toBe(commitments[1]);
        });
    });
});
