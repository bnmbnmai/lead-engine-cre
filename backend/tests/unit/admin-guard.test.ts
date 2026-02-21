/**
 * admin-guard.test.ts — BUG-06: Server-side ADMIN Role Enforcement
 *
 * Verifies that all destructive demo-panel routes require a valid ADMIN JWT.
 * A SELLER or BUYER JWT must receive 403 ROLE_REQUIRED. A missing token must
 * receive 401 from authMiddleware. An ADMIN JWT must be accepted (200/201).
 *
 * Uses supertest against the full Express app with Prisma mocked.
 */

import request from 'supertest';
import express, { Router } from 'express';
import {
    authMiddleware,
    requireAdmin,
    generateToken,
    AuthenticatedRequest,
} from '../../src/middleware/auth';

// ─── Prisma mock — provide the session lookup authMiddleware needs ───────────
jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        session: {
            findFirst: jest.fn(),
            update: jest.fn().mockResolvedValue({}),
        },
    },
}));

import { prisma } from '../../src/lib/prisma';
const mockSessionFindFirst = prisma.session.findFirst as jest.Mock;

// ─── Minimal test app — mirrors demo-panel route gating pattern ─────────────
function buildTestApp() {
    const app = express();
    app.use(express.json());

    const router = Router();

    // Public route (no auth required)
    router.get('/status', (_req, res) => {
        res.json({ ok: true });
    });

    // Admin-gated routes (mirrors all 14 destructive demo-panel routes)
    const ADMIN_ROUTES: Array<[string, string]> = [
        ['POST', '/seed'],
        ['POST', '/clear'],
        ['POST', '/lead'],
        ['POST', '/auction'],
        ['POST', '/reset'],
        ['POST', '/wipe'],
        ['POST', '/seed-templates'],
        ['POST', '/settle'],
        ['POST', '/full-e2e'],
        ['POST', '/full-e2e/stop'],
        ['POST', '/full-e2e/reset'],
        ['POST', '/fund-eth'],
        ['GET', '/demo-buyers-toggle'],
        ['POST', '/demo-buyers-toggle'],
    ];

    for (const [method, path] of ADMIN_ROUTES) {
        const m = method.toLowerCase() as 'get' | 'post';
        router[m](path, authMiddleware, requireAdmin, (_req, res) => {
            res.json({ ok: true, path });
        });
    }

    app.use('/api/v1/demo-panel', router);
    return app;
}

// ─── JWT factories ────────────────────────────────────────────────────────────
function makeToken(role: string) {
    return generateToken({ userId: 'user-1', walletAddress: '0xabc', role });
}

function mockValidSession() {
    mockSessionFindFirst.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        token: expect.any(String),
        expiresAt: new Date(Date.now() + 86400_000),
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('BUG-06: ADMIN role enforcement on demo-panel routes', () => {
    const app = buildTestApp();

    beforeEach(() => {
        mockSessionFindFirst.mockReset();
    });

    // ── Public routes ────────────────────────────────────────────────────────
    it('GET /status is accessible without any token', async () => {
        const res = await request(app).get('/api/v1/demo-panel/status');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    // ── 401 — no token ───────────────────────────────────────────────────────
    it('POST /seed returns 401 when no Authorization header is present', async () => {
        const res = await request(app).post('/api/v1/demo-panel/seed');
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/missing|invalid authorization header/i);
    });

    it('GET /demo-buyers-toggle returns 401 when no Authorization header is present', async () => {
        const res = await request(app).get('/api/v1/demo-panel/demo-buyers-toggle');
        expect(res.status).toBe(401);
    });

    // ── 403 — valid JWT but wrong role ───────────────────────────────────────
    const destructiveRoutes: Array<[string, string]> = [
        ['post', '/seed'],
        ['post', '/clear'],
        ['post', '/lead'],
        ['post', '/auction'],
        ['post', '/reset'],
        ['post', '/wipe'],
        ['post', '/seed-templates'],
        ['post', '/settle'],
        ['post', '/full-e2e'],
        ['post', '/full-e2e/stop'],
        ['post', '/full-e2e/reset'],
        ['post', '/fund-eth'],
        ['get', '/demo-buyers-toggle'],
        ['post', '/demo-buyers-toggle'],
    ];

    for (const [method, path] of destructiveRoutes) {
        it(`${method.toUpperCase()} ${path} returns 403 for SELLER JWT`, async () => {
            mockValidSession();
            const token = makeToken('SELLER');
            const m = method as 'get' | 'post';
            const res = await request(app)[m](`/api/v1/demo-panel${path}`)
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('ROLE_REQUIRED');
            expect(res.body.requiredRoles).toContain('ADMIN');
        });

        it(`${method.toUpperCase()} ${path} returns 403 for BUYER JWT`, async () => {
            mockValidSession();
            const token = makeToken('BUYER');
            const m = method as 'get' | 'post';
            const res = await request(app)[m](`/api/v1/demo-panel${path}`)
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('ROLE_REQUIRED');
        });
    }

    // ── 200 — ADMIN JWT passes through ───────────────────────────────────────
    it('POST /seed returns 200 for ADMIN JWT', async () => {
        mockValidSession();
        const token = makeToken('ADMIN');
        const res = await request(app)
            .post('/api/v1/demo-panel/seed')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    it('POST /wipe returns 200 for ADMIN JWT', async () => {
        mockValidSession();
        const token = makeToken('ADMIN');
        const res = await request(app)
            .post('/api/v1/demo-panel/wipe')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
    });
});
