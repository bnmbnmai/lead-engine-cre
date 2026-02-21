/**
 * vault-reconciliation-p2.test.ts
 *
 * Unit tests for vault-reconciliation.service.ts:
 *   - reconcileAll(): drift detection, alert emission, summary events, error handling
 *   - Job lifecycle: startVaultReconciliationJob(), stopVaultReconciliationJob()
 */

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        escrowVault: { findMany: jest.fn() },
        user: { findMany: jest.fn() },
    },
}));

jest.mock('../../src/services/vault.service', () => ({
    reconcileVaultBalance: jest.fn(),
}));

const mockAceDevBusEmit = jest.fn();
jest.mock('../../src/services/ace.service', () => ({
    aceDevBus: { emit: (...args: any[]) => mockAceDevBusEmit(...args) },
}));

import {
    reconcileAll,
    startVaultReconciliationJob,
    stopVaultReconciliationJob,
    isVaultReconciliationJobRunning,
    DRIFT_THRESHOLD_USD,
    RECONCILE_INTERVAL_MS,
} from '../../src/services/vault-reconciliation.service';
import { prisma } from '../../src/lib/prisma';
import { reconcileVaultBalance } from '../../src/services/vault.service';

const mockVaultFindMany = prisma.escrowVault.findMany as jest.MockedFunction<any>;
const mockUserFindMany = prisma.user.findMany as jest.MockedFunction<any>;
const mockReconcile = reconcileVaultBalance as jest.MockedFunction<typeof reconcileVaultBalance>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const synced = (wallet: string, bal = 50) => ({
    dbBalance: bal, onChainBalance: bal, drift: 0, driftUsd: '$0.000000', synced: true,
});
const drifted = (wallet: string, db = 50, chain = 45) => {
    const drift = Math.abs(db - chain);
    return { dbBalance: db, onChainBalance: chain, drift, driftUsd: `$${drift.toFixed(6)}`, synced: false };
};

beforeEach(() => {
    jest.resetAllMocks();
    stopVaultReconciliationJob();
});

// ── Constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
    test('DRIFT_THRESHOLD_USD is $0.01', () => {
        expect(DRIFT_THRESHOLD_USD).toBe(0.01);
    });
    test('RECONCILE_INTERVAL_MS is 5 minutes', () => {
        expect(RECONCILE_INTERVAL_MS).toBe(5 * 60 * 1000);
    });
});

// ── reconcileAll() ───────────────────────────────────────────────────────────

describe('reconcileAll()', () => {
    test('returns correct shape when no vaults exist', async () => {
        mockVaultFindMany.mockResolvedValueOnce([]);
        mockUserFindMany.mockResolvedValueOnce([]);
        const r = await reconcileAll();
        expect(r).toMatchObject({ scanned: 0, synced: 0, drifted: 0, errors: 0, driftDetails: [] });
        expect(typeof r.durationMs).toBe('number');
        expect(typeof r.completedAt).toBe('string');
    });

    test('counts synced wallets when all balances match', async () => {
        mockVaultFindMany.mockResolvedValueOnce([
            { userId: 'u1', balance: 50 },
            { userId: 'u2', balance: 100 },
        ]);
        mockUserFindMany.mockResolvedValueOnce([
            { id: 'u1', walletAddress: '0xAAA' },
            { id: 'u2', walletAddress: '0xBBB' },
        ]);
        mockReconcile
            .mockResolvedValueOnce(synced('0xAAA', 50))
            .mockResolvedValueOnce(synced('0xBBB', 100));
        const r = await reconcileAll();
        expect(r.scanned).toBe(2);
        expect(r.synced).toBe(2);
        expect(r.drifted).toBe(0);
    });

    test('detects drift and records DriftRecord', async () => {
        mockVaultFindMany.mockResolvedValueOnce([{ userId: 'u1', balance: 50 }]);
        mockUserFindMany.mockResolvedValueOnce([{ id: 'u1', walletAddress: '0xDRIFT' }]);
        mockReconcile.mockResolvedValueOnce(drifted('0xDRIFT', 50, 45));
        const r = await reconcileAll();
        expect(r.drifted).toBe(1);
        expect(r.driftDetails).toHaveLength(1);
        expect(r.driftDetails[0]).toMatchObject({ userAddress: '0xDRIFT', dbBalance: 50, onChainBalance: 45 });
    });

    test('emits vault:reconcile-drift-alert for each drifted wallet', async () => {
        mockVaultFindMany.mockResolvedValueOnce([{ userId: 'u1', balance: 50 }]);
        mockUserFindMany.mockResolvedValueOnce([{ id: 'u1', walletAddress: '0xDRIFT2' }]);
        mockReconcile.mockResolvedValueOnce(drifted('0xDRIFT2', 50, 45));
        await reconcileAll();
        const alerts = mockAceDevBusEmit.mock.calls.filter(
            ([ev, p]: any) => ev === 'ace:dev-log' && p.action === 'vault:reconcile-drift-alert'
        );
        expect(alerts).toHaveLength(1);
        expect(alerts[0][1]).toMatchObject({ severity: 'ALERT', userAddress: '0xDRIFT2', drift: 5 });
    });

    test('emits vault:reconcile-summary after every run', async () => {
        mockVaultFindMany.mockResolvedValueOnce([]);
        mockUserFindMany.mockResolvedValueOnce([]);
        await reconcileAll();
        const summary = mockAceDevBusEmit.mock.calls.find(
            ([ev, p]: any) => ev === 'ace:dev-log' && p.action === 'vault:reconcile-summary'
        );
        expect(summary).toBeDefined();
        expect(summary![1]).toMatchObject({ scanned: 0, synced: 0, drifted: 0, errors: 0 });
    });

    test('summary severity is WARNING when drift detected', async () => {
        mockVaultFindMany.mockResolvedValueOnce([{ userId: 'u1', balance: 50 }]);
        mockUserFindMany.mockResolvedValueOnce([{ id: 'u1', walletAddress: '0xD' }]);
        mockReconcile.mockResolvedValueOnce(drifted('0xD', 50, 40));
        await reconcileAll();
        const s = mockAceDevBusEmit.mock.calls.find(([ev, p]: any) => p.action === 'vault:reconcile-summary');
        expect(s![1].severity).toBe('WARNING');
    });

    test('summary severity is INFO when all synced', async () => {
        mockVaultFindMany.mockResolvedValueOnce([{ userId: 'u1', balance: 25 }]);
        mockUserFindMany.mockResolvedValueOnce([{ id: 'u1', walletAddress: '0xS' }]);
        mockReconcile.mockResolvedValueOnce(synced('0xS', 25));
        await reconcileAll();
        const s = mockAceDevBusEmit.mock.calls.find(([ev, p]: any) => p.action === 'vault:reconcile-summary');
        expect(s![1].severity).toBe('INFO');
    });

    test('drift below $0.01 threshold counts as synced, no alert emitted', async () => {
        mockVaultFindMany.mockResolvedValueOnce([{ userId: 'u1', balance: 50 }]);
        mockUserFindMany.mockResolvedValueOnce([{ id: 'u1', walletAddress: '0xTINY' }]);
        mockReconcile.mockResolvedValueOnce({
            dbBalance: 50, onChainBalance: 50.001, drift: 0.001, driftUsd: '$0.001000', synced: false,
        });
        const r = await reconcileAll();
        expect(r.drifted).toBe(0);
        expect(r.synced).toBe(1);
        const alerts = mockAceDevBusEmit.mock.calls.filter(([ev, p]: any) => p.action === 'vault:reconcile-drift-alert');
        expect(alerts).toHaveLength(0);
    });

    test('skips users with null walletAddress', async () => {
        mockVaultFindMany.mockResolvedValueOnce([{ userId: 'u1', balance: 50 }]);
        mockUserFindMany.mockResolvedValueOnce([{ id: 'u1', walletAddress: null }]);
        const r = await reconcileAll();
        expect(r.scanned).toBe(0);
        expect(mockReconcile).not.toHaveBeenCalled();
    });

    test('increments errors and continues when reconcileVaultBalance throws', async () => {
        mockVaultFindMany.mockResolvedValueOnce([
            { userId: 'u1', balance: 10 },
            { userId: 'u2', balance: 20 },
        ]);
        mockUserFindMany.mockResolvedValueOnce([
            { id: 'u1', walletAddress: '0xERR' },
            { id: 'u2', walletAddress: '0xOK' },
        ]);
        mockReconcile
            .mockRejectedValueOnce(new Error('RPC timeout'))
            .mockResolvedValueOnce(synced('0xOK', 20));
        const r = await reconcileAll();
        expect(r.errors).toBe(1);
        expect(r.synced).toBe(1);
    });

    test('returns early with errors=1 when escrowVault DB query throws', async () => {
        mockVaultFindMany.mockRejectedValueOnce(new Error('DB down'));
        const r = await reconcileAll();
        expect(r.errors).toBe(1);
        expect(r.scanned).toBe(0);
    });

    test('returns early with errors=1 when user DB query throws', async () => {
        mockVaultFindMany.mockResolvedValueOnce([{ userId: 'u1', balance: 10 }]);
        mockUserFindMany.mockRejectedValueOnce(new Error('User table error'));
        const r = await reconcileAll();
        expect(r.errors).toBe(1);
        expect(r.scanned).toBe(0);
    });

    test('counts error when reconcileVaultBalance returns a non-config error string', async () => {
        mockVaultFindMany.mockResolvedValueOnce([{ userId: 'u1', balance: 10 }]);
        mockUserFindMany.mockResolvedValueOnce([{ id: 'u1', walletAddress: '0xERR2' }]);
        mockReconcile.mockResolvedValueOnce({
            dbBalance: 10, onChainBalance: 0, drift: 0, driftUsd: '$0.00',
            synced: false, error: 'RPC call failed',
        });
        const r = await reconcileAll();
        expect(r.errors).toBe(1);
        expect(r.synced).toBe(0);
    });

    test('treats VAULT_ADDRESS not configured as synced (no on-chain comparison)', async () => {
        mockVaultFindMany.mockResolvedValueOnce([{ userId: 'u1', balance: 10 }]);
        mockUserFindMany.mockResolvedValueOnce([{ id: 'u1', walletAddress: '0xNC' }]);
        mockReconcile.mockResolvedValueOnce({
            dbBalance: 10, onChainBalance: 10, drift: 0, driftUsd: '$0.000000',
            synced: true, error: 'VAULT_ADDRESS not configured',
        });
        const r = await reconcileAll();
        expect(r.errors).toBe(0);
        expect(r.synced).toBe(1);
    });

    test('handles mixed synced and drifted wallets', async () => {
        mockVaultFindMany.mockResolvedValueOnce([
            { userId: 'u1', balance: 10 },
            { userId: 'u2', balance: 20 },
            { userId: 'u3', balance: 30 },
        ]);
        mockUserFindMany.mockResolvedValueOnce([
            { id: 'u1', walletAddress: '0xA' },
            { id: 'u2', walletAddress: '0xB' },
            { id: 'u3', walletAddress: '0xC' },
        ]);
        mockReconcile
            .mockResolvedValueOnce(synced('0xA', 10))
            .mockResolvedValueOnce(drifted('0xB', 20, 15))
            .mockResolvedValueOnce(synced('0xC', 30));
        const r = await reconcileAll();
        expect(r.scanned).toBe(3);
        expect(r.synced).toBe(2);
        expect(r.drifted).toBe(1);
        expect(r.driftDetails[0].userAddress).toBe('0xB');
    });

    test('completedAt is a valid ISO string', async () => {
        mockVaultFindMany.mockResolvedValueOnce([]);
        mockUserFindMany.mockResolvedValueOnce([]);
        const r = await reconcileAll();
        expect(new Date(r.completedAt).toISOString()).toBe(r.completedAt);
    });
});

// ── Job Lifecycle ─────────────────────────────────────────────────────────────

describe('job lifecycle', () => {
    test('isVaultReconciliationJobRunning() returns false initially', () => {
        expect(isVaultReconciliationJobRunning()).toBe(false);
    });

    test('startVaultReconciliationJob() is no-op in test env (NODE_ENV=test)', () => {
        startVaultReconciliationJob();
        expect(isVaultReconciliationJobRunning()).toBe(false);
    });

    test('stopVaultReconciliationJob() is idempotent when job is not running', () => {
        expect(() => stopVaultReconciliationJob()).not.toThrow();
        expect(isVaultReconciliationJobRunning()).toBe(false);
    });
});
