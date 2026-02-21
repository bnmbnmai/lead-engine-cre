/**
 * vault-reconciliation-endpoint.test.ts
 *
 * Supertest integration tests for:
 *   POST /api/v1/vault/reconcile-all  (admin-only endpoint in vault.routes.ts)
 *
 * Uses the same pattern as admin-guard.test.ts:
 *   - Real authMiddleware + requireAdmin from middleware/auth
 *   - Real generateToken() to produce valid JWTs
 *   - Mock prisma.session.findFirst so tokens pass session validation
 *   - Mock reconcileAll from vault-reconciliation.service
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        session: {
            findFirst: jest.fn(),
            update: jest.fn().mockResolvedValue({}),
        },
        user: { findUnique: jest.fn().mockResolvedValue(null) },
    },
}));

jest.mock('../../src/services/vault-reconciliation.service', () => ({
    reconcileAll: jest.fn(),
    startVaultReconciliationJob: jest.fn(),
    stopVaultReconciliationJob: jest.fn(),
    isVaultReconciliationJobRunning: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/services/vault.service', () => ({
    getVaultInfo: jest.fn(),
    recordDeposit: jest.fn(),
    recordCacheWithdraw: jest.fn().mockResolvedValue({ success: true, balance: 100 }),
    verifyReserves: jest.fn(),
    getContractAddress: jest.fn().mockReturnValue('0xVAULT'),
    getContractAbi: jest.fn().mockReturnValue([]),
    reconcileVaultBalance: jest.fn(),
    VAULT_FEE: 1.0,
}));

jest.mock('../../src/services/ace.service', () => ({
    aceDevBus: { emit: jest.fn() },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import request from 'supertest';
import express from 'express';
import vaultRouter from '../../src/routes/vault.routes';
import { generateToken } from '../../src/middleware/auth';
import { prisma } from '../../src/lib/prisma';

const mockSessionFindFirst = prisma.session.findFirst as jest.MockedFunction<any>;
const mockReconcileAll = require('../../src/services/vault-reconciliation.service')
    .reconcileAll as jest.MockedFunction<any>;

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use('/', vaultRouter);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeToken(role: string) {
    return generateToken({ userId: 'user-1', walletAddress: '0xUSER', role });
}

function mockValidSession() {
    mockSessionFindFirst.mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        token: expect.any(String),
        expiresAt: new Date(Date.now() + 86_400_000),
    });
}

const syncedReport = {
    scanned: 3, synced: 3, drifted: 0, errors: 0,
    driftDetails: [], durationMs: 12, completedAt: new Date().toISOString(),
};
const driftedReport = {
    scanned: 3, synced: 2, drifted: 1, errors: 0,
    driftDetails: [
        { userAddress: '0xABC', dbBalance: 50, onChainBalance: 45, drift: 5, driftUsd: '$5.000000' },
    ],
    durationMs: 20, completedAt: new Date().toISOString(),
};

beforeEach(() => {
    jest.resetAllMocks();
    prisma.session.update = jest.fn().mockResolvedValue({});
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /reconcile-all (vault admin endpoint)', () => {
    test('returns 200 with full report when ADMIN and no drift', async () => {
        mockValidSession();
        mockReconcileAll.mockResolvedValueOnce(syncedReport);
        const res = await request(app)
            .post('/reconcile-all')
            .set('Authorization', `Bearer ${makeToken('ADMIN')}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.report.scanned).toBe(3);
        expect(res.body.report.drifted).toBe(0);
    });

    test('returns 207 Multi-Status when drift is detected', async () => {
        mockValidSession();
        mockReconcileAll.mockResolvedValueOnce(driftedReport);
        const res = await request(app)
            .post('/reconcile-all')
            .set('Authorization', `Bearer ${makeToken('ADMIN')}`);
        expect(res.status).toBe(207);
        expect(res.body.success).toBe(true);
        expect(res.body.report.drifted).toBe(1);
        expect(res.body.report.driftDetails).toHaveLength(1);
    });

    test('returns 403 when caller is authenticated as BUYER', async () => {
        mockValidSession();
        const res = await request(app)
            .post('/reconcile-all')
            .set('Authorization', `Bearer ${makeToken('BUYER')}`);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ROLE_REQUIRED');
    });

    test('returns 403 when caller is authenticated as SELLER', async () => {
        mockValidSession();
        const res = await request(app)
            .post('/reconcile-all')
            .set('Authorization', `Bearer ${makeToken('SELLER')}`);
        expect(res.status).toBe(403);
    });

    test('returns 401 when no Authorization header present', async () => {
        const res = await request(app).post('/reconcile-all');
        expect(res.status).toBe(401);
    });

    test('returns 500 when reconcileAll throws', async () => {
        mockValidSession();
        mockReconcileAll.mockRejectedValueOnce(new Error('DB exploded'));
        const res = await request(app)
            .post('/reconcile-all')
            .set('Authorization', `Bearer ${makeToken('ADMIN')}`);
        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Reconciliation failed');
        expect(res.body.detail).toBe('DB exploded');
    });

    test('reconcileAll is called exactly once per request', async () => {
        mockValidSession();
        mockReconcileAll.mockResolvedValueOnce(syncedReport);
        await request(app)
            .post('/reconcile-all')
            .set('Authorization', `Bearer ${makeToken('ADMIN')}`);
        expect(mockReconcileAll).toHaveBeenCalledTimes(1);
    });
});
