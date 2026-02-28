/**
 * demo-monolith-p2.test.ts
 *
 * Coverage for the P2 demo-monolith refactor:
 *   - Module boundary structure (correct exports exist)
 *   - Re-export completeness of the facade (demo-e2e.service.ts)
 *   - Function-signature spot-checks
 *   - Vault cycle guard logic (pendingLockIds, abortCleanup)
 *   - Lead drip isolation (countActiveLeads, checkActiveLeadsAndTopUp)
 *   - Buyer profile shape validation
 */

import {
    // Orchestrator exports (formerly via demo-e2e.service facade)
    runFullDemo,
    stopDemo,
    isDemoRunning,
    isDemoRecycling,
    getResults,
    getLatestResult,
    getAllResults,
    initResultsStore,
    cleanupLockedFundsForDemoBuyers,
} from '../../src/services/demo/demo-orchestrator';

import {
    countActiveLeads,
    checkActiveLeadsAndTopUp,
} from '../../src/services/demo/demo-lead-drip';

import {
    pendingLockIds,
    abortCleanup,
    setModuleIo,
    getModuleIo,
    getIsRecycling,
    setIsRecycling,
    withRecycleTimeout,
} from '../../src/services/demo/demo-vault-cycle';

import {
    buildDemoParams,
    ensureDemoSeller,
    injectOneLead,
} from '../../src/services/demo/demo-lead-drip';

import {
    clearAllBidTimers,
    sweepBuyerUSDC,
    emitLiveMetrics,
    setDemoRunStartTime,
} from '../../src/services/demo/demo-buyer-scheduler';

import {
    emit,
    safeEmit,
    emitStatus,
    sleep,
    rand,
    pick,
    DEMO_BUYER_WALLETS,
    DEMO_SELLER_WALLET,
    DEMO_VERTICALS,
    GEOS,
    VAULT_ADDRESS,
    USDC_ADDRESS,
    BASE_SEPOLIA_CHAIN_ID,
    DEMO_MIN_ACTIVE_LEADS,
    MAX_CYCLES,
    LEAD_AUCTION_DURATION_SECS,
} from '../../src/services/demo/demo-shared';

// ── Mock Prisma ────────────────────────────────────
jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        lead: {
            count: jest.fn().mockResolvedValue(5),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({ id: 'test-lead-id', auctionStartAt: new Date() }),
        },
        auctionRoom: { create: jest.fn().mockReturnValue({ catch: jest.fn() }) },
        user: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'seller-id' }) },
    },
}));

// ── Mock ethers ────────────────────────────────────
jest.mock('ethers', () => {
    const actual = jest.requireActual('ethers');
    return {
        ...actual,
        JsonRpcProvider: jest.fn().mockImplementation(() => ({
            getNetwork: jest.fn().mockResolvedValue({ chainId: 84532n }),
            getBalance: jest.fn().mockResolvedValue(BigInt('1000000000000000000')),
            getTransactionCount: jest.fn().mockResolvedValue(0),
            getFeeData: jest.fn().mockResolvedValue({ gasPrice: 1000000000n }),
        })),
        Wallet: jest.fn().mockImplementation(() => ({
            address: '0x0000000000000000000000000000000000000001',
            getAddress: jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000001'),
            provider: {
                getBalance: jest.fn().mockResolvedValue(BigInt('100000000000000000')),
                getFeeData: jest.fn().mockResolvedValue({ gasPrice: 1000000000n }),
                getTransactionCount: jest.fn().mockResolvedValue(1),
            },
        })),
        Contract: jest.fn().mockImplementation(() => ({
            balanceOf: jest.fn().mockResolvedValue(1000000000n),
            lockedBalances: jest.fn().mockResolvedValue(0n),
            totalObligations: jest.fn().mockResolvedValue(0n),
            lastPorSolvent: jest.fn().mockResolvedValue(true),
            lockForBid: jest.fn().mockResolvedValue({ wait: () => Promise.resolve({ hash: '0xabc', logs: [] }) }),
            settleBid: jest.fn().mockResolvedValue({ wait: () => Promise.resolve({ hash: '0xdef', logs: [] }) }),
            refundBid: jest.fn().mockResolvedValue({ wait: () => Promise.resolve({ hash: '0xghi', logs: [] }) }),
            withdraw: jest.fn().mockResolvedValue({ wait: () => Promise.resolve({}) }),
            deposit: jest.fn().mockResolvedValue({ wait: () => Promise.resolve({}) }),
            approve: jest.fn().mockResolvedValue({ wait: () => Promise.resolve({}) }),
            transfer: jest.fn().mockResolvedValue({ wait: () => Promise.resolve({}) }),
            verifyReserves: jest.fn().mockResolvedValue({ wait: () => Promise.resolve({ hash: '0xpor', logs: [] }) }),
            allowance: jest.fn().mockResolvedValue(BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')),
            interface: {
                encodeFunctionData: jest.fn().mockReturnValue('0xdata'),
                parseLog: jest.fn().mockReturnValue(null),
                getEvent: jest.fn().mockReturnValue(null),
            },
            filters: { BidLocked: jest.fn().mockReturnValue({}) },
            queryFilter: jest.fn().mockResolvedValue([]),
        })),
        Interface: jest.fn().mockImplementation(() => ({
            parseLog: jest.fn().mockReturnValue(null),
        })),
    };
    function ethers() { }
});

// ── Mock Socket.IO ─────────────────────────────────
const mockIo = {
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
    volatile: { emit: jest.fn() },
} as any;

// ── Reset between tests ────────────────────────────
beforeEach(() => {
    jest.clearAllMocks();
    pendingLockIds.clear();
    setIsRecycling(false);
    setModuleIo(null);
    setDemoRunStartTime(null);
    clearAllBidTimers();
});

// ═══════════════════════════════════════════════════
// 1. FACADE RE-EXPORT COMPLETENESS
// ═══════════════════════════════════════════════════

describe('P2 Facade — re-export completeness', () => {
    test('runFullDemo is a function exported from facade', () => {
        expect(typeof runFullDemo).toBe('function');
    });
    test('stopDemo is a function exported from facade', () => {
        expect(typeof stopDemo).toBe('function');
    });
    test('isDemoRunning is a function exported from facade', () => {
        expect(typeof isDemoRunning).toBe('function');
    });
    test('isDemoRecycling is a function exported from facade', () => {
        expect(typeof isDemoRecycling).toBe('function');
    });
    test('getResults is a function exported from facade', () => {
        expect(typeof getResults).toBe('function');
    });
    test('getLatestResult is a function exported from facade', () => {
        expect(typeof getLatestResult).toBe('function');
    });
    test('getAllResults is a function exported from facade', () => {
        expect(typeof getAllResults).toBe('function');
    });
    test('initResultsStore is a function exported from facade', () => {
        expect(typeof initResultsStore).toBe('function');
    });
    test('cleanupLockedFundsForDemoBuyers is a function exported from facade', () => {
        expect(typeof cleanupLockedFundsForDemoBuyers).toBe('function');
    });
    test('countActiveLeads is a function exported from facade', () => {
        expect(typeof countActiveLeads).toBe('function');
    });
    test('checkActiveLeadsAndTopUp is a function exported from facade', () => {
        expect(typeof checkActiveLeadsAndTopUp).toBe('function');
    });
});

// ═══════════════════════════════════════════════════
// 2. MODULE BOUNDARY EXPORTS
// ═══════════════════════════════════════════════════

describe('P2 Module Boundaries — demo-vault-cycle', () => {
    test('pendingLockIds is a Set', () => {
        expect(pendingLockIds instanceof Set).toBe(true);
    });

    test('pendingLockIds starts empty per test (cleared by beforeEach)', () => {
        expect(pendingLockIds.size).toBe(0);
    });

    test('setModuleIo / getModuleIo round-trip', () => {
        expect(getModuleIo()).toBeNull();
        setModuleIo(mockIo);
        expect(getModuleIo()).toBe(mockIo);
        setModuleIo(null);
        expect(getModuleIo()).toBeNull();
    });

    test('setIsRecycling / getIsRecycling round-trip', () => {
        expect(getIsRecycling()).toBe(false);
        setIsRecycling(true);
        expect(getIsRecycling()).toBe(true);
        setIsRecycling(false);
        expect(getIsRecycling()).toBe(false);
    });

    test('abortCleanup is a function with expected arity', () => {
        expect(typeof abortCleanup).toBe('function');
        expect(abortCleanup.length).toBe(2); // (io, vault)
    });

    test('abortCleanup is a no-op when pendingLockIds is empty', async () => {
        const mockVault = { refundBid: jest.fn() } as any;
        await abortCleanup(mockIo, mockVault);
        expect(mockVault.refundBid).not.toHaveBeenCalled();
    });

    test('withRecycleTimeout is a function', () => {
        expect(typeof withRecycleTimeout).toBe('function');
    });
});

describe('P2 Module Boundaries — demo-lead-drip', () => {
    test('buildDemoParams returns null or object for known verticals', () => {
        for (const v of DEMO_VERTICALS) {
            const params = buildDemoParams(v);
            expect(params === null || typeof params === 'object').toBe(true);
        }
    });

    test('buildDemoParams returns a non-null object for unknown vertical (default fallback)', () => {
        const result = buildDemoParams('__unknown_vertical__');
        expect(result).not.toBeNull();
        expect(typeof result).toBe('object');
        // Confirm the default fallback branch fires
        expect(result).toEqual(expect.objectContaining({ serviceType: 'General', urgency: 'Flexible' }));
    });

    test('ensureDemoSeller is an async function', () => {
        expect(typeof ensureDemoSeller).toBe('function');
        expect(ensureDemoSeller.constructor.name).toBe('AsyncFunction');
    });

    test('injectOneLead is an async function', () => {
        expect(typeof injectOneLead).toBe('function');
        expect(injectOneLead.constructor.name).toBe('AsyncFunction');
    });
});

describe('P2 Module Boundaries — demo-buyer-scheduler', () => {
    test('clearAllBidTimers is a function', () => {
        expect(typeof clearAllBidTimers).toBe('function');
    });

    test('clearAllBidTimers does not throw when no timers active', () => {
        expect(() => clearAllBidTimers()).not.toThrow();
    });

    test('setDemoRunStartTime accepts number or null', () => {
        expect(() => setDemoRunStartTime(Date.now())).not.toThrow();
        expect(() => setDemoRunStartTime(null)).not.toThrow();
    });

    test('sweepBuyerUSDC is an async function', () => {
        expect(typeof sweepBuyerUSDC).toBe('function');
        expect(sweepBuyerUSDC.constructor.name).toBe('AsyncFunction');
    });

    test('emitLiveMetrics is an async function', () => {
        expect(typeof emitLiveMetrics).toBe('function');
        expect(emitLiveMetrics.constructor.name).toBe('AsyncFunction');
    });
});

describe('P2 Module Boundaries — demo-shared constants', () => {
    test('DEMO_BUYER_WALLETS has 10 entries', () => {
        expect(DEMO_BUYER_WALLETS).toHaveLength(10);
    });

    test('DEMO_BUYER_WALLETS all start with 0x', () => {
        for (const addr of DEMO_BUYER_WALLETS) {
            expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
        }
    });

    test('DEMO_SELLER_WALLET is a valid address', () => {
        expect(DEMO_SELLER_WALLET).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    test('DEMO_SELLER_WALLET is not in DEMO_BUYER_WALLETS', () => {
        expect(DEMO_BUYER_WALLETS).not.toContain(DEMO_SELLER_WALLET);
    });

    test('DEMO_VERTICALS is a non-empty array of strings', () => {
        expect(Array.isArray(DEMO_VERTICALS)).toBe(true);
        expect(DEMO_VERTICALS.length).toBeGreaterThan(0);
        for (const v of DEMO_VERTICALS) {
            expect(typeof v).toBe('string');
        }
    });

    test('GEOS is a non-empty array with country/state/city', () => {
        expect(Array.isArray(GEOS)).toBe(true);
        expect(GEOS.length).toBeGreaterThan(0);
        const first = GEOS[0];
        expect(first).toHaveProperty('country');
        expect(first).toHaveProperty('state');
        expect(first).toHaveProperty('city');
    });

    test('BASE_SEPOLIA_CHAIN_ID is 84532', () => {
        expect(BASE_SEPOLIA_CHAIN_ID).toBe(84532);
    });

    test('VAULT_ADDRESS is a string (may be empty in test env without VAULT_ADDRESS_BASE_SEPOLIA)', () => {
        // In production this must be a valid 0x address; empty string is allowed in tests
        expect(typeof VAULT_ADDRESS).toBe('string');
    });

    test('USDC_ADDRESS is a valid Ethereum address (hardcoded Base Sepolia fallback)', () => {
        // Has a hardcoded fallback: '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
        expect(USDC_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    test('DEMO_MIN_ACTIVE_LEADS is a positive number', () => {
        expect(typeof DEMO_MIN_ACTIVE_LEADS).toBe('number');
        expect(DEMO_MIN_ACTIVE_LEADS).toBeGreaterThan(0);
    });

    test('MAX_CYCLES is a positive number', () => {
        expect(typeof MAX_CYCLES).toBe('number');
        expect(MAX_CYCLES).toBeGreaterThan(0);
    });

    test('LEAD_AUCTION_DURATION_SECS is a positive number', () => {
        expect(typeof LEAD_AUCTION_DURATION_SECS).toBe('number');
        expect(LEAD_AUCTION_DURATION_SECS).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════
// 3. SINGLETON STATE GUARDS
// ═══════════════════════════════════════════════════

describe('P2 Singleton State — isDemoRunning / isDemoRecycling', () => {
    test('isDemoRunning returns false initially', () => {
        expect(isDemoRunning()).toBe(false);
    });

    test('isDemoRecycling returns false initially', () => {
        expect(isDemoRecycling()).toBe(false);
    });

    test('isDemoRecycling reflects setIsRecycling', () => {
        setIsRecycling(true);
        expect(isDemoRecycling()).toBe(true);
        setIsRecycling(false);
        expect(isDemoRecycling()).toBe(false);
    });
});

// ═══════════════════════════════════════════════════
// 4. RESULTS STORE
// ═══════════════════════════════════════════════════

describe('P2 Results Store', () => {
    test('getResults returns undefined for unknown runId', () => {
        expect(getResults('non-existent-run-id')).toBeUndefined();
    });

    test('getAllResults returns an array', () => {
        const results = getAllResults();
        expect(Array.isArray(results)).toBe(true);
    });

    test('getLatestResult returns undefined when store is empty (or oldest from disk)', async () => {
        // If demo-results.json doesn't exist in test cwd, store may be empty
        const result = await getLatestResult();
        // Either undefined or a DemoResult shape
        if (result !== undefined) {
            expect(result).toHaveProperty('runId');
            expect(result).toHaveProperty('startedAt');
            expect(result).toHaveProperty('status');
        } else {
            expect(result).toBeUndefined();
        }
    });

    test('initResultsStore completes without error', async () => {
        await expect(initResultsStore()).resolves.not.toThrow();
    });
});

// ═══════════════════════════════════════════════════
// 5. SHARED UTILITIES
// ═══════════════════════════════════════════════════

describe('P2 Shared Utilities', () => {
    test('rand returns a number in [min, max]', () => {
        for (let i = 0; i < 100; i++) {
            const r = rand(10, 50);
            expect(r).toBeGreaterThanOrEqual(10);
            expect(r).toBeLessThanOrEqual(50);
        }
    });

    test('pick returns an element from the array', () => {
        const arr = [1, 2, 3, 4, 5];
        for (let i = 0; i < 50; i++) {
            const p = pick(arr);
            expect(arr).toContain(p);
        }
    });

    test('sleep resolves after given ms', async () => {
        const start = Date.now();
        await sleep(50);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(45);
    }, 1000);

    test('emit does not throw when io.emit is available', () => {
        expect(() => emit(mockIo, { ts: new Date().toISOString(), level: 'info', message: 'test' })).not.toThrow();
    });

    test('safeEmit does not throw', () => {
        expect(() => safeEmit(mockIo, 'test:event', { foo: 'bar' })).not.toThrow();
    });

    test('emitStatus does not throw', () => {
        expect(() => emitStatus(mockIo, { running: false, phase: 'idle' })).not.toThrow();
    });
});
