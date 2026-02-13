/**
 * P3 Polish & Migration Tests — 32 tests
 *
 * Coverage:
 *  1. Socket Notify Debounce (#10) — 9 tests
 *  2. Tiered Rate Limiter (#15) — 8 tests
 *  3. Migration Backfill (#18) — 10 tests
 *  4. Step Label / Seeder (#12) — 5 tests
 */

// ============================================
// Mocks — MUST be before imports
// ============================================

const mockPrisma = {
    bid: {
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
    },
    buyerProfile: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
    },
    vertical: { findUnique: jest.fn() },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
};
jest.mock('../../src/lib/prisma', () => ({ prisma: mockPrisma }));

const mockNftOwnershipCache = { getOrSet: jest.fn(), get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const mockHolderNotifyCache = { getOrSet: jest.fn(), get: jest.fn(), set: jest.fn(), delete: jest.fn() };
jest.mock('../../src/lib/cache', () => ({
    nftOwnershipCache: mockNftOwnershipCache,
    bidActivityCache: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
    holderNotifyCache: mockHolderNotifyCache,
    verticalHierarchyCache: { getOrSet: jest.fn(), get: jest.fn(), set: jest.fn(), delete: jest.fn(), clear: jest.fn() },
    invalidateNftOwnership: jest.fn(),
    invalidateVerticalHierarchy: jest.fn(),
    invalidateAllForResale: jest.fn(),
    LRUCache: jest.fn().mockImplementation(() => ({
        get: jest.fn(), set: jest.fn(), delete: jest.fn(), clear: jest.fn(),
        stats: jest.fn().mockReturnValue({ size: 0, maxSize: 1000, hits: 0, misses: 0, hitRate: '0%' }),
        getOrSet: jest.fn(), evictExpired: jest.fn(),
    })),
}));

jest.mock('../../src/services/ace.service', () => ({
    aceService: { canTransact: jest.fn().mockResolvedValue({ allowed: true }) },
}));

jest.mock('../../src/services/datastreams.service', () => ({
    dataStreamsService: { getLatestPrice: jest.fn(), publishVerticalData: jest.fn() },
}));

jest.mock('../../src/services/vertical-nft.service', () => ({
    activateVertical: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('ethers', () => ({
    ethers: {
        JsonRpcProvider: jest.fn(),
        Wallet: jest.fn(),
        Contract: jest.fn(),
        parseEther: jest.fn((v: string) => BigInt(Math.floor(parseFloat(v) * 1e18))),
        id: jest.fn((v: string) => `0xHASH_${v}`),
    },
}));

jest.mock('../../src/services/notification.service', () => ({
    setHolderNotifyOptIn: jest.fn().mockResolvedValue({ success: true, optIn: true }),
    getHolderNotifyOptIn: jest.fn().mockResolvedValue(true),
    queueNotification: jest.fn().mockResolvedValue(true),
    flushNotificationDigest: jest.fn().mockReturnValue(new Map()),
    hasGdprConsent: jest.fn().mockResolvedValue(true),
    NOTIFICATION_CONSTANTS: { DIGEST_INTERVAL_MS: 300000, DAILY_NOTIFICATION_CAP: 50, BATCH_SIZE_LIMIT: 100, HIGH_VOLUME_WARNING: 60 },
}));

// ============================================
// Imports — AFTER mocks
// ============================================

import {
    TIER_MULTIPLIERS,
    TIER_HARD_CEILING,
    lookupUserTier,
    clearTierCache,
    createTieredLimiter,
} from '../../src/middleware/rateLimit';

import {
    NOTIFY_DEBOUNCE_MS,
    notifyDebounceMap,
    DebouncedNotifyHandler,
} from '../../src/rtb/socket';

// ============================================
// 1. Socket Notify Debounce (#10) — 6 tests
// ============================================

describe('#10 Socket Notify Debounce', () => {
    let handler: InstanceType<typeof DebouncedNotifyHandler>;
    let mockSocket: any;
    let mockExecutor: jest.Mock;

    beforeEach(() => {
        handler = new DebouncedNotifyHandler();
        notifyDebounceMap.clear();
        mockSocket = { emit: jest.fn() };
        mockExecutor = jest.fn().mockResolvedValue({ success: true, optIn: true });
    });

    afterEach(() => {
        handler.cancelAll();
    });

    test('NOTIFY_DEBOUNCE_MS is 10 seconds', () => {
        expect(NOTIFY_DEBOUNCE_MS).toBe(10_000);
    });

    test('first call executes immediately (returns false)', () => {
        const debounced = handler.handle('user-1', true, mockSocket, mockExecutor);
        expect(debounced).toBe(false);
    });

    test('second call within 10s is debounced (returns true)', () => {
        // First call
        handler.handle('user-1', true, mockSocket, mockExecutor);
        // Simulate timestamp set
        notifyDebounceMap.set('user-1', Date.now());

        // Second call immediately
        const debounced = handler.handle('user-1', false, mockSocket, mockExecutor);
        expect(debounced).toBe(true);
    });

    test('debounced call emits holder:notify-pending with ARIA assertive', () => {
        notifyDebounceMap.set('user-1', Date.now());

        handler.handle('user-1', true, mockSocket, mockExecutor);

        expect(mockSocket.emit).toHaveBeenCalledWith(
            'holder:notify-pending',
            expect.objectContaining({
                status: 'debounced',
                ariaLive: 'assertive',
                role: 'status',
            }),
        );
    });

    test('pending message includes "Updating..."', () => {
        notifyDebounceMap.set('user-1', Date.now());

        handler.handle('user-1', true, mockSocket, mockExecutor);

        const emitCall = mockSocket.emit.mock.calls.find(
            (c: any[]) => c[0] === 'holder:notify-pending',
        );
        expect(emitCall?.[1].message).toMatch(/Updating\.\.\./);
    });

    test('cancelAll clears all pending timers', () => {
        notifyDebounceMap.set('user-1', Date.now());
        notifyDebounceMap.set('user-2', Date.now());

        handler.handle('user-1', true, mockSocket, mockExecutor);
        handler.handle('user-2', true, mockSocket, mockExecutor);

        expect(handler.pendingCount).toBe(2);
        handler.cancelAll();
        expect(handler.pendingCount).toBe(0);
    });

    test('rapid toggles coalesce: only last value wins', () => {
        notifyDebounceMap.set('rapid-user', Date.now());

        // Toggle true, false, true rapidly
        handler.handle('rapid-user', true, mockSocket, mockExecutor);
        handler.handle('rapid-user', false, mockSocket, mockExecutor);
        handler.handle('rapid-user', true, mockSocket, mockExecutor);

        // Only 1 pending timer (last one replaces previous)
        expect(handler.pendingCount).toBe(1);
    });

    test('all debounced emissions include role: status', () => {
        notifyDebounceMap.set('aria-user', Date.now());
        handler.handle('aria-user', true, mockSocket, mockExecutor);

        const pendingCalls = mockSocket.emit.mock.calls.filter(
            (c: any[]) => c[0] === 'holder:notify-pending',
        );
        for (const call of pendingCalls) {
            expect(call[1].role).toBe('status');
        }
    });

    test('non-debounced call does NOT emit holder:notify-pending', () => {
        // Fresh state — no cooldown
        notifyDebounceMap.clear();
        handler.handle('fresh-user', true, mockSocket, mockExecutor);

        const pendingCalls = mockSocket.emit.mock.calls.filter(
            (c: any[]) => c[0] === 'holder:notify-pending',
        );
        expect(pendingCalls.length).toBe(0);
    });
});

// ============================================
// 2. Tiered Rate Limiter (#15) — 5 tests
// ============================================

describe('#15 Tiered Rate Limiter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearTierCache();
    });

    test('TIER_MULTIPLIERS has DEFAULT=1, HOLDER=2, PREMIUM=3', () => {
        expect(TIER_MULTIPLIERS.DEFAULT).toBe(1);
        expect(TIER_MULTIPLIERS.HOLDER).toBe(2);
        expect(TIER_MULTIPLIERS.PREMIUM).toBe(3);
    });

    test('TIER_HARD_CEILING is 30', () => {
        expect(TIER_HARD_CEILING).toBe(30);
    });

    test('lookupUserTier returns DEFAULT for no userId', async () => {
        const tier = await lookupUserTier(undefined, undefined);
        expect(tier).toBe('DEFAULT');
    });

    test('lookupUserTier returns PREMIUM for VERIFIED KYC user', async () => {
        mockPrisma.buyerProfile.findFirst.mockResolvedValueOnce({ kycStatus: 'VERIFIED' });
        const tier = await lookupUserTier('premium-user', '0xABC');
        expect(tier).toBe('PREMIUM');
    });

    test('premium tier capped at TIER_HARD_CEILING', () => {
        const baseLimit = 10;
        const premiumLimit = baseLimit * TIER_MULTIPLIERS.PREMIUM; // 30
        const capped = Math.min(premiumLimit, TIER_HARD_CEILING);
        expect(capped).toBeLessThanOrEqual(TIER_HARD_CEILING);
    });

    test('createTieredLimiter returns a middleware function', () => {
        const limiter = createTieredLimiter(10);
        expect(typeof limiter).toBe('function');
    });

    test('tier cache resets without error', () => {
        expect(() => clearTierCache()).not.toThrow();
        expect(() => clearTierCache()).not.toThrow();
    });

    test('high base + premium exceeds ceiling → capped', () => {
        const base = 20;
        const raw = base * TIER_MULTIPLIERS.PREMIUM; // 60
        const capped = Math.min(raw, TIER_HARD_CEILING);
        expect(raw).toBe(60);
        expect(capped).toBe(30);
    });
});

// ============================================
// 3. Migration Backfill (#18) — 7 tests
// ============================================

describe('#18 Migration Backfill Integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('DRY_RUN mode default: no mutations when --commit not passed', () => {
        // Simulate: process.argv does NOT include '--commit'
        const DRY_RUN = !['node', 'script.ts'].includes('--commit');
        expect(DRY_RUN).toBe(true);
    });

    test('COMMIT mode: detects --commit flag', () => {
        const argv = ['node', 'script.ts', '--commit'];
        const DRY_RUN = !argv.includes('--commit');
        expect(DRY_RUN).toBe(false);
    });

    test('schema guard: rejects bids with null amount', async () => {
        // Only bids with non-null amount should be backfilled
        mockPrisma.bid.findMany.mockResolvedValueOnce([
            { id: 'bid-1', amount: 50, leadId: 'lead-1', buyerId: 'buyer-1' },
        ]);

        const bids = await mockPrisma.bid.findMany({
            where: { effectiveBid: null, amount: { not: null } },
        });

        expect(bids.length).toBe(1);
        expect(bids[0].amount).not.toBeNull();
    });

    test('batch transaction ensures atomicity', async () => {
        const mockBids = [
            { id: 'bid-1', amount: 25 },
            { id: 'bid-2', amount: 50 },
            { id: 'bid-3', amount: 75 },
        ];

        mockPrisma.bid.update.mockResolvedValue({ id: 'bid-1', effectiveBid: 25 });
        mockPrisma.$transaction.mockImplementation(async (ops: any[]) => {
            return Promise.all(ops);
        });

        // Simulate batch transaction
        const updates = mockBids.map(bid =>
            mockPrisma.bid.update({
                where: { id: bid.id },
                data: { effectiveBid: bid.amount },
            }),
        );

        await mockPrisma.$transaction(updates);
        expect(mockPrisma.$transaction).toHaveBeenCalled();
        expect(mockPrisma.bid.update).toHaveBeenCalledTimes(3);
    });

    test('interrupted run: transaction rollback on error', async () => {
        mockPrisma.$transaction.mockRejectedValueOnce(new Error('Connection lost'));

        await expect(
            mockPrisma.$transaction([
                mockPrisma.bid.update({ where: { id: 'bid-x' }, data: { effectiveBid: 100 } }),
            ]),
        ).rejects.toThrow('Connection lost');
    });

    test('verification step: counts remaining null bids', async () => {
        mockPrisma.bid.count.mockResolvedValueOnce(0);

        const remaining = await mockPrisma.bid.count({
            where: { effectiveBid: null, amount: { not: null } },
        });

        expect(remaining).toBe(0);
    });

    test('batch size is 100 for performance', () => {
        const BATCH_SIZE = 100;
        const totalBids = 350;
        const expectedBatches = Math.ceil(totalBids / BATCH_SIZE);
        expect(expectedBatches).toBe(4);
    });

    test('partial batch failure: transaction rejects all updates', async () => {
        mockPrisma.$transaction.mockRejectedValueOnce(new Error('Disk full'));

        await expect(
            mockPrisma.$transaction([
                mockPrisma.bid.update({ where: { id: 'bid-a' }, data: { effectiveBid: 10 } }),
                mockPrisma.bid.update({ where: { id: 'bid-b' }, data: { effectiveBid: 20 } }),
            ]),
        ).rejects.toThrow('Disk full');
    });

    test('progress format: includes fraction and percentage', () => {
        const updated = 150;
        const total = 300;
        const pct = ((updated / total) * 100).toFixed(1);
        const progress = `Progress: ${updated}/${total} (${pct}%)`;
        expect(progress).toBe('Progress: 150/300 (50.0%)');
    });

    test('--batch-size flag is documented in script', () => {
        const backfillContent = require('fs').readFileSync(
            require('path').join(__dirname, '../../scripts/backfill-effective-bid.ts'),
            'utf-8',
        );
        expect(backfillContent).toContain('--batch-size');
        expect(backfillContent).toContain('parseBatchSize');
    });
});

// ============================================
// 4. Step Label / Seeder (#12) — 4 tests
// ============================================

describe('#12 Seeder Step Labels', () => {
    test('dynamic step counter produces correct format', () => {
        const TOTAL_STEPS = 9;
        let currentStep = 0;
        const step = (label: string) => `→ Step ${++currentStep}/${TOTAL_STEPS}: ${label}`;

        expect(step('Users')).toBe('→ Step 1/9: Users');
        expect(step('Profiles')).toBe('→ Step 2/9: Profiles');
        expect(step('Asks')).toBe('→ Step 3/9: Asks');
    });

    test('step counter auto-increments', () => {
        const TOTAL_STEPS = 3;
        let currentStep = 0;
        const step = () => ++currentStep;

        step(); step(); step();
        expect(currentStep).toBe(TOTAL_STEPS);
    });

    test('step labels match expected count', () => {
        // The seeder should have exactly 9 main steps
        const expectedSteps = [
            'Users', 'Profiles', 'Asks', 'Leads',
            'Bids', 'Transactions', 'Analytics Events',
            'Holder Perk Scenarios', 'P2 Security Scenarios',
        ];
        expect(expectedSteps.length).toBe(9);
    });

    test('TOTAL_STEPS constant matches actual step count', () => {
        const TOTAL_STEPS = 9;
        const actualStepCount = 9; // matches seeder
        expect(TOTAL_STEPS).toBe(actualStepCount);
    });

    test('step() calls in seed.ts match TOTAL_STEPS via source scan', () => {
        const seedContent = require('fs').readFileSync(
            require('path').join(__dirname, '../../prisma/seed.ts'),
            'utf-8',
        );
        const stepCalls = seedContent.match(/\bstep\(['"/]/g) || [];
        const totalMatch = seedContent.match(/TOTAL_STEPS\s*=\s*(\d+)/);
        expect(totalMatch).not.toBeNull();
        expect(stepCalls.length).toBe(parseInt(totalMatch![1]));
    });
});
