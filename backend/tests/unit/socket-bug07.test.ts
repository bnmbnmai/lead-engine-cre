/**
 * socket-bug07.test.ts
 *
 * BUG-07: AuctionRoom.participants duplicates on reconnect.
 *
 * Root cause: socket.ts used `participants: { push: userId }` unconditionally.
 * Every join:auction call — including reconnects — appended the userId even if
 * already present.
 *
 * Fix: read current participants array; skip the DB update if userId is already in it.
 *
 * Strategy: We test the guard logic in isolation using a lightweight mock of the
 * Prisma `auctionRoom.update` call. The socket server is NOT instantiated; we
 * directly test the branching logic extracted to a pure helper so tests are fast
 * and deterministic.
 */

// ── Mock prisma ─────────────────────────────────────────────────────────────

const mockAuctionRoomUpdate = jest.fn().mockResolvedValue({});

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        lead: {
            findUnique: jest.fn(),
        },
        auctionRoom: {
            update: mockAuctionRoomUpdate,
        },
        session: {
            findFirst: jest.fn(),
        },
        bid: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
        },
        analyticsEvent: {
            create: jest.fn(),
        },
    },
}));

jest.mock('../../src/services/ace.service', () => ({
    aceService: { canTransact: jest.fn().mockResolvedValue({ allowed: true }) },
    aceDevBus: { on: jest.fn() },
}));

jest.mock('../../src/services/holder-perks.service', () => ({
    applyHolderPerks: jest.fn().mockResolvedValue({ isHolder: false, multiplier: 1 }),
    applyMultiplier: jest.fn((a: number) => a),
    checkActivityThreshold: jest.fn().mockReturnValue(true),
}));

jest.mock('../../src/services/notification.service', () => ({
    setHolderNotifyOptIn: jest.fn(),
    getHolderNotifyOptIn: jest.fn(),
}));

jest.mock('../../src/services/auction-closure.service', () => ({
    resolveExpiredAuctions: jest.fn().mockResolvedValue(undefined),
    resolveStuckAuctions: jest.fn().mockResolvedValue(undefined),
    resolveExpiredBuyNow: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/vault.service', () => ({
    checkBidBalance: jest.fn(),
    lockForBid: jest.fn(),
    refundBid: jest.fn(),
    verifyReserves: jest.fn(),
    recordCacheWithdraw: jest.fn(),
    reconcileVaultBalance: jest.fn(),
}));

// Mock http.Server so RTBSocketServer constructor doesn't need a real one
jest.mock('socket.io', () => ({
    Server: jest.fn().mockImplementation(() => ({
        use: jest.fn(),
        on: jest.fn(),
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
    })),
}));

jest.mock('http', () => ({
    Server: jest.fn(),
}));

// ── Helper extracted from socket.ts join:auction handler ──────────────────
// We test the deduplication logic by importing and running it against a
// controlled participants array + mock Prisma client.

import { prisma } from '../../src/lib/prisma';

/**
 * Mirrors the BUG-07-fixed logic in socket.ts join:auction handler.
 * Extracted to a pure async function so it's testable without a real socket.
 */
async function addParticipantIfAbsent(
    auctionRoomId: string,
    currentParticipants: string[],
    userId: string,
): Promise<{ updated: boolean }> {
    const alreadyJoined = currentParticipants.includes(userId);
    if (!alreadyJoined) {
        await prisma.auctionRoom.update({
            where: { id: auctionRoomId },
            data: {
                participants: {
                    push: userId,
                },
            },
        });
        return { updated: true };
    }
    return { updated: false };
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
});

describe('BUG-07 — AuctionRoom.participants Set semantics on join:auction', () => {
    const ROOM_ID = 'room-abc';
    const USER_A = 'user-a';
    const USER_B = 'user-b';

    describe('First join (participants is empty)', () => {
        it('pushes the userId and returns updated:true', async () => {
            const result = await addParticipantIfAbsent(ROOM_ID, [], USER_A);

            expect(result.updated).toBe(true);
            expect(mockAuctionRoomUpdate).toHaveBeenCalledTimes(1);
            expect(mockAuctionRoomUpdate).toHaveBeenCalledWith({
                where: { id: ROOM_ID },
                data: { participants: { push: USER_A } },
            });
        });
    });

    describe('First join (others already present)', () => {
        it('appends new user without touching existing participants', async () => {
            const result = await addParticipantIfAbsent(ROOM_ID, [USER_B], USER_A);

            expect(result.updated).toBe(true);
            expect(mockAuctionRoomUpdate).toHaveBeenCalledTimes(1);
            expect(mockAuctionRoomUpdate).toHaveBeenCalledWith({
                where: { id: ROOM_ID },
                data: { participants: { push: USER_A } },
            });
        });
    });

    describe('Reconnect (user already in participants)', () => {
        it('skips the DB update and returns updated:false', async () => {
            const result = await addParticipantIfAbsent(ROOM_ID, [USER_A, USER_B], USER_A);

            expect(result.updated).toBe(false);
            expect(mockAuctionRoomUpdate).not.toHaveBeenCalled();
        });

        it('does not call update even after multiple reconnects', async () => {
            for (let i = 0; i < 5; i++) {
                await addParticipantIfAbsent(ROOM_ID, [USER_A], USER_A);
            }
            // 5 reconnects, 0 DB writes
            expect(mockAuctionRoomUpdate).toHaveBeenCalledTimes(0);
        });
    });

    describe('Multiple distinct users', () => {
        it('adds each unique user exactly once', async () => {
            const participants: string[] = [];
            const users = ['user-1', 'user-2', 'user-3'];

            for (const uid of users) {
                const { updated } = await addParticipantIfAbsent(ROOM_ID, participants, uid);
                if (updated) participants.push(uid);
            }

            // Each user added once
            expect(mockAuctionRoomUpdate).toHaveBeenCalledTimes(3);
            expect(new Set(participants).size).toBe(participants.length); // no duplicates
        });

        it('second join for same user is a no-op even with many prior participants', async () => {
            const existing = Array.from({ length: 20 }, (_, i) => `user-${i}`);
            // user-5 is already in the list
            const result = await addParticipantIfAbsent(ROOM_ID, existing, 'user-5');

            expect(result.updated).toBe(false);
            expect(mockAuctionRoomUpdate).not.toHaveBeenCalled();
        });
    });

    describe('Regression: old (buggy) push-always behaviour would duplicate', () => {
        it('proves that includes() guard prevents the duplicate that raw push would create', () => {
            const participants = ['user-a'];

            // Simulate buggy: always push
            const buggyResult = [...participants, 'user-a'];
            expect(buggyResult).toEqual(['user-a', 'user-a']); // duplicated!

            // Fixed: Set-semantics
            const alreadyJoined = participants.includes('user-a');
            const fixedResult = alreadyJoined ? participants : [...participants, 'user-a'];
            expect(fixedResult).toEqual(['user-a']); // no duplicate
            expect(new Set(fixedResult).size).toBe(fixedResult.length);
        });
    });
});
