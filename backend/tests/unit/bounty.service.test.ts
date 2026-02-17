/**
 * Bounty Service Tests
 *
 * Unit tests for criteria matching, stacking cap, and release tracking.
 * Prisma is mocked — no database required.
 */

// Mock prisma before import
jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        vertical: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    },
}));

// Mock ethers (no on-chain in tests)
jest.mock('ethers', () => ({
    ethers: {
        keccak256: jest.fn(() => '0xmockhash'),
        toUtf8Bytes: jest.fn((s: string) => Buffer.from(s)),
        parseUnits: jest.fn((v: string) => BigInt(parseFloat(v) * 1e6)),
        formatUnits: jest.fn((v: bigint) => (Number(v) / 1e6).toString()),
        JsonRpcProvider: jest.fn(),
        Wallet: jest.fn(),
        Contract: jest.fn(),
    },
}));

import { prisma } from '../../src/lib/prisma';

// We need to test the BountyService methods directly.
// Since the module creates a singleton on import, and we've mocked ethers,
// the service will be in off-chain mode.
import { bountyService } from '../../src/services/bounty.service';

const prismaMock = prisma as jest.Mocked<typeof prisma>;

// ============================================
// Helper: create a mock vertical with bounty pools
// ============================================

function mockVertical(slug: string, bountyPools: any[]) {
    return {
        slug,
        name: slug,
        formConfig: { bountyPools },
    };
}

function makePool(overrides: any = {}) {
    return {
        poolId: 'pool-1',
        buyerId: 'buyer-1',
        buyerWallet: '0xBuyerWallet',
        amount: 100,
        totalReleased: 0,
        criteria: {},
        createdAt: new Date().toISOString(),
        active: true,
        ...overrides,
    };
}

function makeLead(overrides: any = {}) {
    return {
        id: 'lead-1',
        vertical: 'solar',
        qualityScore: 8000,
        state: 'CA',
        country: 'US',
        parameters: { creditScore: 720 },
        createdAt: new Date(),
        reservePrice: 50,
        ...overrides,
    };
}

// ============================================
// matchBounties Tests
// ============================================

describe('BountyService.matchBounties', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns empty array when vertical has no pools', async () => {
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [])
        );
        const result = await bountyService.matchBounties(makeLead());
        expect(result).toEqual([]);
    });

    it('returns empty array when lead has no vertical', async () => {
        const result = await bountyService.matchBounties(makeLead({ vertical: undefined }));
        expect(result).toEqual([]);
    });

    it('matches a pool with no criteria', async () => {
        const pool = makePool();
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [pool])
        );
        const result = await bountyService.matchBounties(makeLead());
        expect(result).toHaveLength(1);
        expect(result[0].poolId).toBe('pool-1');
        expect(result[0].amount).toBe(100);
    });

    it('filters by minQualityScore', async () => {
        const pool = makePool({ criteria: { minQualityScore: 9000 } });
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [pool])
        );
        // Lead has QS 8000, pool requires 9000
        const result = await bountyService.matchBounties(makeLead({ qualityScore: 8000 }));
        expect(result).toHaveLength(0);
    });

    it('passes minQualityScore when lead qualifies', async () => {
        const pool = makePool({ criteria: { minQualityScore: 7000 } });
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [pool])
        );
        const result = await bountyService.matchBounties(makeLead({ qualityScore: 8000 }));
        expect(result).toHaveLength(1);
    });

    it('filters by geoStates', async () => {
        const pool = makePool({ criteria: { geoStates: ['TX', 'NY'] } });
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [pool])
        );
        // Lead is in CA, pool wants TX or NY
        const result = await bountyService.matchBounties(makeLead({ state: 'CA' }));
        expect(result).toHaveLength(0);
    });

    it('passes geoStates when lead matches', async () => {
        const pool = makePool({ criteria: { geoStates: ['CA', 'NY'] } });
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [pool])
        );
        const result = await bountyService.matchBounties(makeLead({ state: 'CA' }));
        expect(result).toHaveLength(1);
    });

    it('filters by geoCountries', async () => {
        const pool = makePool({ criteria: { geoCountries: ['UK'] } });
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [pool])
        );
        const result = await bountyService.matchBounties(makeLead({ country: 'US' }));
        expect(result).toHaveLength(0);
    });

    it('filters by minCreditScore', async () => {
        const pool = makePool({ criteria: { minCreditScore: 750 } });
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [pool])
        );
        // Lead has creditScore 720, pool requires 750
        const result = await bountyService.matchBounties(
            makeLead({ parameters: { creditScore: 720 } })
        );
        expect(result).toHaveLength(0);
    });

    it('filters by maxLeadAge', async () => {
        const pool = makePool({ criteria: { maxLeadAge: 1 } }); // 1 hour
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [pool])
        );
        // Lead created 2 hours ago
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const result = await bountyService.matchBounties(makeLead({ createdAt: twoHoursAgo }));
        expect(result).toHaveLength(0);
    });

    it('skips inactive pools', async () => {
        const pool = makePool({ active: false });
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [pool])
        );
        const result = await bountyService.matchBounties(makeLead());
        expect(result).toHaveLength(0);
    });

    it('uses available balance (amount - totalReleased)', async () => {
        const pool = makePool({ amount: 100, totalReleased: 60 });
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [pool])
        );
        const result = await bountyService.matchBounties(makeLead());
        expect(result).toHaveLength(1);
        expect(result[0].amount).toBe(40); // 100 - 60
    });

    it('skips fully released pools', async () => {
        const pool = makePool({ amount: 100, totalReleased: 100 });
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [pool])
        );
        const result = await bountyService.matchBounties(makeLead());
        expect(result).toHaveLength(0);
    });

    it('AND logic: all criteria must pass', async () => {
        const pool = makePool({
            criteria: { minQualityScore: 7000, geoStates: ['CA'], minCreditScore: 700 },
        });
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [pool])
        );
        // Passes QS and credit, but wrong state
        const result = await bountyService.matchBounties(
            makeLead({ qualityScore: 8000, state: 'TX', parameters: { creditScore: 750 } })
        );
        expect(result).toHaveLength(0);
    });
});

// ============================================
// Stacking Cap Tests
// ============================================

describe('BountyService.matchBounties (stacking cap)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('caps total bounty at 2× leadPrice', async () => {
        const pools = [
            makePool({ poolId: 'pool-1', amount: 80 }),
            makePool({ poolId: 'pool-2', buyerId: 'buyer-2', amount: 60 }),
        ];
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', pools)
        );
        // Lead price = $50, cap = $100
        const result = await bountyService.matchBounties(makeLead({ reservePrice: 50 }));
        const total = result.reduce((s, m) => s + m.amount, 0);
        expect(total).toBeLessThanOrEqual(100);
        expect(result[0].amount).toBe(80);
        expect(result[1].amount).toBe(20); // capped to fill remaining
    });

    it('uses explicit leadPrice override for cap', async () => {
        const pools = [
            makePool({ poolId: 'pool-1', amount: 200 }),
        ];
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', pools)
        );
        // Reserve = 50, but winning bid = 150 → cap = 300
        const result = await bountyService.matchBounties(
            makeLead({ reservePrice: 50 }),
            150 // explicit leadPrice
        );
        expect(result[0].amount).toBe(200); // within 2×150 = 300 cap
    });

    it('sorts by amount descending before capping', async () => {
        const pools = [
            makePool({ poolId: 'pool-small', amount: 20 }),
            makePool({ poolId: 'pool-large', buyerId: 'buyer-2', amount: 80 }),
        ];
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', pools)
        );
        // Cap = 2 × 50 = 100
        const result = await bountyService.matchBounties(makeLead({ reservePrice: 50 }));
        // Should sort: pool-large (80) first, then pool-small (20)
        expect(result[0].poolId).toBe('pool-large');
        expect(result[1].poolId).toBe('pool-small');
    });

    it('returns all matches when no reserve price', async () => {
        const pools = [
            makePool({ poolId: 'pool-1', amount: 500 }),
            makePool({ poolId: 'pool-2', buyerId: 'buyer-2', amount: 300 }),
        ];
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', pools)
        );
        const result = await bountyService.matchBounties(
            makeLead({ reservePrice: null }),
            0 // no override
        );
        expect(result).toHaveLength(2);
        expect(result.reduce((s, m) => s + m.amount, 0)).toBe(800);
    });
});

// ============================================
// depositBounty Tests (off-chain mode)
// ============================================

describe('BountyService.depositBounty', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('creates a pool entry with UUID (not offchain-timestamp)', async () => {
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [])
        );
        (prismaMock.vertical.update as jest.Mock).mockResolvedValue({});

        const result = await bountyService.depositBounty('buyer-1', 'solar', 100);
        expect(result.success).toBe(true);
        expect(result.poolId).toBeDefined();
        // Should NOT be offchain-timestamp format
        expect(result.poolId).not.toMatch(/^offchain-/);
        expect(result.offChain).toBe(true);
    });

    it('stores buyerWallet in pool entry when provided', async () => {
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [])
        );
        (prismaMock.vertical.update as jest.Mock).mockResolvedValue({});

        await bountyService.depositBounty('buyer-1', 'solar', 100, undefined, '0xWallet');

        const updateCall = (prismaMock.vertical.update as jest.Mock).mock.calls[0][0];
        const pools = updateCall.data.formConfig.bountyPools;
        expect(pools[0].buyerWallet).toBe('0xWallet');
    });

    it('initializes totalReleased to 0', async () => {
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', [])
        );
        (prismaMock.vertical.update as jest.Mock).mockResolvedValue({});

        await bountyService.depositBounty('buyer-1', 'solar', 100);

        const updateCall = (prismaMock.vertical.update as jest.Mock).mock.calls[0][0];
        const pools = updateCall.data.formConfig.bountyPools;
        expect(pools[0].totalReleased).toBe(0);
    });
});

// ============================================
// getVerticalBountyTotal Tests (off-chain mode)
// ============================================

describe('BountyService.getVerticalBountyTotal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('sums active pool available balances', async () => {
        const pools = [
            makePool({ amount: 100, totalReleased: 30, active: true }),
            makePool({ poolId: 'pool-2', amount: 50, totalReleased: 0, active: true }),
        ];
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', pools)
        );
        const total = await bountyService.getVerticalBountyTotal('solar');
        expect(total).toBe(120); // (100-30) + (50-0)
    });

    it('excludes inactive pools', async () => {
        const pools = [
            makePool({ amount: 100, totalReleased: 0, active: true }),
            makePool({ poolId: 'pool-2', amount: 50, totalReleased: 0, active: false }),
        ];
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(
            mockVertical('solar', pools)
        );
        const total = await bountyService.getVerticalBountyTotal('solar');
        expect(total).toBe(100);
    });

    it('returns 0 for unknown vertical', async () => {
        (prismaMock.vertical.findUnique as jest.Mock).mockResolvedValue(null);
        const total = await bountyService.getVerticalBountyTotal('unknown');
        expect(total).toBe(0);
    });
});
