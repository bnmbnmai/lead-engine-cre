/**
 * BUG-10 — Active Lead Minimum Enforcement Tests
 *
 * Covers:
 *  1. countActiveLeads() queries the correct Prisma filter
 *  2. checkActiveLeadsAndTopUp(): no-op when active >= minimum
 *  3. checkActiveLeadsAndTopUp(): injects exactly (min - active) leads when below threshold
 *  4. checkActiveLeadsAndTopUp(): no over-drip when already at minimum
 *  5. checkActiveLeadsAndTopUp(): respects abort signal (stops injecting mid-top-up)
 *  6. checkActiveLeadsAndTopUp(): respects deadline (does nothing when expired)
 *  7. checkActiveLeadsAndTopUp(): handles countActiveLeads DB error gracefully (non-fatal)
 *  8. checkActiveLeadsAndTopUp(): handles injectOneLead failure gracefully (continues loop)
 *  9. checkActiveLeadsAndTopUp(): emits warn socket event when below minimum
 * 10. checkActiveLeadsAndTopUp(): increments createdRef.value for each injected lead
 * 11. createdRef.value mutation is thread-safe between calls (sequential top-ups don't double-count)
 * 12. threshold=0 activeLeads: injects DEMO_MIN_ACTIVE_LEADS leads
 */

// ── Prisma mock ────────────────────────────────────────────────────────────────
let mockLeadCount = jest.fn<Promise<number>, any[]>();
let mockLeadCreate = jest.fn();
let mockAuctionRoomCreate = jest.fn();
let mockSellerFindFirst = jest.fn();

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        lead: {
            count: (...args: any[]) => mockLeadCount(...args),
            create: (...args: any[]) => mockLeadCreate(...args),
        },
        auctionRoom: {
            create: (...args: any[]) => mockAuctionRoomCreate(...args),
        },
        sellerProfile: {
            findFirst: (...args: any[]) => mockSellerFindFirst(...args),
        },
    },
}));

// ── aceDevBus mock ────────────────────────────────────────────────────────────
jest.mock('../../src/services/ace.service', () => ({
    aceDevBus: { emit: jest.fn() },
}));

// ── perks.env mock — set known values ─────────────────────────────────────────
const MOCK_MIN = 4; // Use a small number so tests run fast
jest.mock('../../src/config/perks.env', () => ({
    DEMO_LEAD_DRIP_INTERVAL_MS: 4500,
    DEMO_INITIAL_LEADS: 3,
    DEMO_MIN_ACTIVE_LEADS: 4, // 4 in tests (not 8) for speed
    LEAD_AUCTION_DURATION_SECS: 60,
}));

// ── CRE score mock ─────────────────────────────────────────────────────────────
jest.mock('../../src/lib/chainlink/cre-quality-score', () => ({
    computeCREQualityScore: jest.fn().mockReturnValue(7000),
}));

// ── ethers mock ───────────────────────────────────────────────────────────────
jest.mock('ethers', () => ({
    ethers: {
        JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
        Wallet: jest.fn().mockImplementation(() => ({})),
        keccak256: jest.fn(() => '0x' + '0'.repeat(64)),
        toUtf8Bytes: jest.fn((s: string) => Buffer.from(s)),
    },
}));

import { checkActiveLeadsAndTopUp, countActiveLeads } from '../../src/services/demo-e2e.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAbortSignal(aborted = false): AbortSignal {
    const ctrl = new AbortController();
    if (aborted) ctrl.abort();
    return ctrl.signal;
}

function makeFuture(ms = 60_000): number {
    return Date.now() + ms;
}

const SELLER_ID = 'seller-bug10';

/**
 * Minimal I/O spy — tracks all socket emissions
 */
function makeIo() {
    const events: Array<{ event: string; payload: any }> = [];
    return {
        io: { emit: jest.fn((e: string, p: any) => events.push({ event: e, payload: p })) },
        events,
    };
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();

    // Default: lead.create returns a minimal lead
    mockLeadCreate.mockResolvedValue({
        id: `lead-${Math.random().toString(36).slice(2)}`,
        auctionStartAt: new Date(),
        auctionEndAt: new Date(Date.now() + 60_000),
    });
    mockAuctionRoomCreate.mockResolvedValue({});
    mockSellerFindFirst.mockResolvedValue({ id: SELLER_ID });
    mockLeadCount.mockResolvedValue(MOCK_MIN); // Default: already at minimum
});

// ── countActiveLeads ──────────────────────────────────────────────────────────

describe('countActiveLeads', () => {
    it('calls prisma.lead.count with status=IN_AUCTION and auctionEndAt > now', async () => {
        mockLeadCount.mockResolvedValueOnce(5);
        const result = await countActiveLeads();
        expect(result).toBe(5);
        expect(mockLeadCount).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    status: 'IN_AUCTION',
                    auctionEndAt: expect.objectContaining({ gt: expect.any(Date) }),
                }),
            })
        );
    });

    it('returns 0 when no active leads', async () => {
        mockLeadCount.mockResolvedValueOnce(0);
        expect(await countActiveLeads()).toBe(0);
    });
});

// ── checkActiveLeadsAndTopUp ──────────────────────────────────────────────────

describe('checkActiveLeadsAndTopUp', () => {
    it('is a no-op when active leads >= DEMO_MIN_ACTIVE_LEADS', async () => {
        mockLeadCount.mockResolvedValueOnce(MOCK_MIN); // already at minimum
        const { io } = makeIo();
        const ref = { value: 0 };
        await checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, makeAbortSignal(), makeFuture());

        expect(mockLeadCreate).not.toHaveBeenCalled();
        expect(ref.value).toBe(0);
    });

    it('is a no-op when active leads > DEMO_MIN_ACTIVE_LEADS', async () => {
        mockLeadCount.mockResolvedValueOnce(MOCK_MIN + 3); // above minimum
        const { io } = makeIo();
        const ref = { value: 10 };
        await checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, makeAbortSignal(), makeFuture());

        expect(mockLeadCreate).not.toHaveBeenCalled();
        expect(ref.value).toBe(10); // unchanged
    });

    it('injects exactly (min - active) leads when below threshold', async () => {
        const active = 2; // 2 active, min = 4 → need 2 more
        mockLeadCount.mockResolvedValueOnce(active);
        const { io } = makeIo();
        const ref = { value: 5 };
        await checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, makeAbortSignal(), makeFuture());

        expect(mockLeadCreate).toHaveBeenCalledTimes(MOCK_MIN - active); // 2 calls
        expect(ref.value).toBe(5 + (MOCK_MIN - active)); // 7
    });

    it('injects DEMO_MIN_ACTIVE_LEADS leads when 0 active', async () => {
        mockLeadCount.mockResolvedValueOnce(0);
        const { io } = makeIo();
        const ref = { value: 0 };
        await checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, makeAbortSignal(), makeFuture());

        expect(mockLeadCreate).toHaveBeenCalledTimes(MOCK_MIN); // 4 calls
        expect(ref.value).toBe(MOCK_MIN);
    });

    it('does NOT over-drip (never injects more than needed)', async () => {
        const active = MOCK_MIN - 1; // need exactly 1
        mockLeadCount.mockResolvedValueOnce(active);
        const { io } = makeIo();
        const ref = { value: 20 };
        await checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, makeAbortSignal(), makeFuture());

        expect(mockLeadCreate).toHaveBeenCalledTimes(1);
        expect(ref.value).toBe(21);
    });

    it('respects abort signal — stops mid top-up', async () => {
        const active = 0; // need MOCK_MIN injections
        mockLeadCount.mockResolvedValueOnce(active);

        // Abort after first inject
        const ctrl = new AbortController();
        let createCallCount = 0;
        mockLeadCreate.mockImplementation(async () => {
            createCallCount++;
            if (createCallCount >= 1) ctrl.abort(); // abort on first inject
            return {
                id: 'lead-aborted',
                auctionStartAt: new Date(),
                auctionEndAt: new Date(Date.now() + 60_000),
            };
        });

        const { io } = makeIo();
        const ref = { value: 0 };
        await checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, ctrl.signal, makeFuture());

        // Only 1 lead injected before abort (the loop checks signal.aborted at top of each iteration)
        expect(mockLeadCreate).toHaveBeenCalledTimes(1);
    });

    it('respects deadline — does nothing when already past deadline', async () => {
        const { io } = makeIo();
        const ref = { value: 0 };
        const expiredDeadline = Date.now() - 1000; // already expired
        await checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, makeAbortSignal(), expiredDeadline);

        // Should return immediately without querying DB or injecting
        expect(mockLeadCount).not.toHaveBeenCalled();
        expect(mockLeadCreate).not.toHaveBeenCalled();
    });

    it('handles countActiveLeads DB error gracefully — does NOT throw', async () => {
        mockLeadCount.mockRejectedValueOnce(new Error('DB timeout'));
        const { io } = makeIo();
        const ref = { value: 0 };
        await expect(
            checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, makeAbortSignal(), makeFuture())
        ).resolves.toBeUndefined();

        expect(mockLeadCreate).not.toHaveBeenCalled();
    });

    it('handles injectOneLead failure gracefully — continues the loop', async () => {
        const active = 0; // need MOCK_MIN injections
        mockLeadCount.mockResolvedValueOnce(active);

        // First create fails, second succeeds
        mockLeadCreate
            .mockRejectedValueOnce(new Error('Prisma error'))
            .mockResolvedValue({
                id: 'lead-recovery',
                auctionStartAt: new Date(),
                auctionEndAt: new Date(Date.now() + 60_000),
            });

        const { io } = makeIo();
        const ref = { value: 0 };
        // Should NOT throw even though first inject failed
        await expect(
            checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, makeAbortSignal(), makeFuture())
        ).resolves.toBeUndefined();

        // MOCK_MIN total attempts (first fails, rest succeed)
        expect(mockLeadCreate).toHaveBeenCalledTimes(MOCK_MIN);
    });

    it('emits a warn socket event when active leads are below minimum', async () => {
        mockLeadCount.mockResolvedValueOnce(1);
        const { io, events } = makeIo();
        const ref = { value: 0 };
        await checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, makeAbortSignal(), makeFuture());

        // Check that a 'demo:log' warn event was emitted (via the emit() helper)
        const warnEvents = events.filter(e => e.event === 'demo:log' && e.payload?.level === 'warn');
        expect(warnEvents.length).toBeGreaterThanOrEqual(1);
        const msg = warnEvents[0].payload.message as string;
        expect(msg).toContain('below minimum');
    });

    it('increments createdRef.value once per successful inject', async () => {
        mockLeadCount.mockResolvedValueOnce(0); // inject MOCK_MIN leads
        const { io } = makeIo();
        const ref = { value: 7 };
        await checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, makeAbortSignal(), makeFuture());
        expect(ref.value).toBe(7 + MOCK_MIN);
    });

    it('sequential calls do not double-count (idempotent once at minimum)', async () => {
        // First call: 0 active → injects MOCK_MIN
        mockLeadCount.mockResolvedValueOnce(0);
        const { io } = makeIo();
        const ref = { value: 0 };
        await checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, makeAbortSignal(), makeFuture());
        expect(ref.value).toBe(MOCK_MIN);

        // Second call: now at minimum → no more creates
        mockLeadCount.mockResolvedValueOnce(MOCK_MIN);
        await checkActiveLeadsAndTopUp(io as any, SELLER_ID, ref, makeAbortSignal(), makeFuture());
        expect(mockLeadCreate).toHaveBeenCalledTimes(MOCK_MIN); // no additional calls
    });
});
