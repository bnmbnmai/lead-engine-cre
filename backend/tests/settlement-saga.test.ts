/**
 * Settlement Saga Tests (Phase B3)
 *
 * Verifies the outbox-pattern settlement state machine:
 * - happy path with no vault lock (steps SKIPPED → finalize → SOLD)
 * - on-chain settle success path
 * - retryable settle failure (saga stays RUNNING, step FAILED)
 * - terminal failure → compensation (winner refunded, lead → UNSOLD)
 * - failed compensation → saga FAILED + refund routed to durable retry queue
 * - idempotency: terminal sagas are never re-executed
 */

// ── Mocks ───────────────────────────────────

const mockSagaFindUnique = jest.fn();
const mockSagaUpdateMany = jest.fn();
const mockSagaUpdate = jest.fn();
const mockLeadFindUnique = jest.fn();
const mockLeadUpdateMany = jest.fn();
const mockBidFindUnique = jest.fn();
const mockBidFindMany = jest.fn();
const mockBidUpdate = jest.fn();
const mockBidCount = jest.fn();
const mockTxUpdateMany = jest.fn();
const mockRoomFindUnique = jest.fn();
const mockRoomUpdateMany = jest.fn();
const mockAnalyticsCreate = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../src/lib/prisma', () => ({
    prisma: {
        settlementSaga: {
            findUnique: (...a: any[]) => mockSagaFindUnique(...a),
            updateMany: (...a: any[]) => mockSagaUpdateMany(...a),
            update: (...a: any[]) => mockSagaUpdate(...a),
        },
        lead: {
            findUnique: (...a: any[]) => mockLeadFindUnique(...a),
            updateMany: (...a: any[]) => mockLeadUpdateMany(...a),
        },
        bid: {
            findUnique: (...a: any[]) => mockBidFindUnique(...a),
            findMany: (...a: any[]) => mockBidFindMany(...a),
            update: (...a: any[]) => mockBidUpdate(...a),
            count: (...a: any[]) => mockBidCount(...a),
        },
        transaction: { updateMany: (...a: any[]) => mockTxUpdateMany(...a) },
        auctionRoom: {
            findUnique: (...a: any[]) => mockRoomFindUnique(...a),
            updateMany: (...a: any[]) => mockRoomUpdateMany(...a),
        },
        analyticsEvent: { create: (...a: any[]) => mockAnalyticsCreate(...a) },
        $transaction: (...a: any[]) => mockTransaction(...a),
    },
}));

jest.mock('../src/lib/redis', () => ({ redisClient: null }));

const mockVaultSettle = jest.fn();
const mockVaultRefund = jest.fn();
jest.mock('../src/services/vault.service', () => ({
    settleBid: (...a: any[]) => mockVaultSettle(...a),
    refundBid: (...a: any[]) => mockVaultRefund(...a),
}));

const mockEnqueueRetry = jest.fn();
jest.mock('../src/lib/settlement-retry.queue', () => ({
    enqueueSettlementRetry: (...a: any[]) => mockEnqueueRetry(...a),
}));

jest.mock('../src/services/nft.service', () => ({
    nftService: {
        mintLeadNFT: jest.fn().mockResolvedValue({ success: false, error: 'not configured' }),
        recordSaleOnChain: jest.fn().mockResolvedValue({ success: true }),
        scheduleMintRetry: jest.fn().mockResolvedValue(undefined),
    },
}));
jest.mock('../src/services/cre.service', () => ({
    creService: { requestOnChainQualityScore: jest.fn().mockResolvedValue({ submitted: false }) },
}));
jest.mock('../src/services/bounty.service', () => ({
    bountyService: {
        matchBounties: jest.fn().mockResolvedValue([]),
        releaseBounty: jest.fn().mockResolvedValue({ success: true }),
    },
}));
jest.mock('../src/services/conversion-tracking.service', () => ({
    fireConversionEvents: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/ace.service', () => ({
    aceDevBus: { emit: jest.fn() },
}));

import { runSettlementSaga } from '../src/services/settlement-saga.service';

// ── Fixtures ────────────────────────────────

const LEAD_ID = 'lead_saga_1';

function makeSaga(overrides: any = {}) {
    return {
        id: 'saga_1',
        leadId: LEAD_ID,
        winningBidId: 'bid_win',
        state: 'PENDING',
        steps: {},
        attempts: 0,
        lastError: null,
        ...overrides,
    };
}

function makeLead() {
    return {
        id: LEAD_ID,
        vertical: 'solar',
        reservePrice: 100,
        qualityScore: 90,
        geo: { country: 'US', state: 'CA' },
        parameters: {},
        createdAt: new Date(),
        sellerId: 'seller_1',
        seller: { user: { walletAddress: '0xSellerWallet' } },
    };
}

function makeWinningBid(overrides: any = {}) {
    return {
        id: 'bid_win',
        leadId: LEAD_ID,
        buyerId: 'buyer_1',
        amount: 150,
        effectiveBid: 150,
        source: 'MANUAL',
        escrowTxHash: null,
        buyer: { id: 'buyer_1', walletAddress: '0xBuyerWallet' },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockSagaUpdateMany.mockResolvedValue({ count: 1 });
    mockSagaUpdate.mockResolvedValue({});
    mockLeadFindUnique.mockResolvedValue(makeLead());
    mockLeadUpdateMany.mockResolvedValue({ count: 1 });
    mockBidFindUnique.mockResolvedValue(makeWinningBid());
    mockBidFindMany.mockResolvedValue([]); // no losers by default
    mockBidUpdate.mockResolvedValue({});
    mockBidCount.mockResolvedValue(1);
    mockTxUpdateMany.mockResolvedValue({ count: 1 });
    mockRoomFindUnique.mockResolvedValue({ vrfRequestId: null });
    mockRoomUpdateMany.mockResolvedValue({ count: 1 });
    mockAnalyticsCreate.mockResolvedValue({});
    mockTransaction.mockResolvedValue([]);
    mockVaultSettle.mockResolvedValue({ success: true, txHash: '0xsettle' });
    mockVaultRefund.mockResolvedValue({ success: true, txHash: '0xrefund' });
});

/** Last state written via settlementSaga.update */
function lastSagaState(): string | undefined {
    const calls = mockSagaUpdate.mock.calls;
    return calls.length ? calls[calls.length - 1][0]?.data?.state : undefined;
}

// ── Tests ───────────────────────────────────

describe('Settlement Saga (Phase B3)', () => {
    describe('happy path', () => {
        it('completes with SKIPPED vault step when winner has no vault lock', async () => {
            mockSagaFindUnique.mockResolvedValue(makeSaga());

            await runSettlementSaga(LEAD_ID);

            expect(mockVaultSettle).not.toHaveBeenCalled();
            // finalize: SETTLING → SOLD CAS
            expect(mockLeadUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: LEAD_ID, status: 'SETTLING' },
                data: expect.objectContaining({ status: 'SOLD' }),
            }));
            expect(lastSagaState()).toBe('COMPLETED');
        });

        it('settles the winner vault lock on-chain when present', async () => {
            mockSagaFindUnique.mockResolvedValue(makeSaga());
            mockBidFindUnique.mockResolvedValue(makeWinningBid({ escrowTxHash: 'vaultLock:42' }));

            await runSettlementSaga(LEAD_ID);

            expect(mockVaultSettle).toHaveBeenCalledWith(42, '0xSellerWallet', 'buyer_1', LEAD_ID);
            expect(lastSagaState()).toBe('COMPLETED');
        });

        it('refunds losing bids with vault locks', async () => {
            mockSagaFindUnique.mockResolvedValue(makeSaga());
            mockBidFindMany.mockResolvedValue([
                { id: 'bid_lose', buyerId: 'buyer_2', escrowTxHash: 'vaultLock:43', escrowRefunded: false },
            ]);

            await runSettlementSaga(LEAD_ID);

            expect(mockVaultRefund).toHaveBeenCalledWith(43, 'buyer_2', LEAD_ID);
            expect(mockBidUpdate).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'bid_lose' },
                data: { escrowRefunded: true },
            }));
            expect(lastSagaState()).toBe('COMPLETED');
        });

        it('emits the same closure socket events as the legacy path', async () => {
            mockSagaFindUnique.mockResolvedValue(makeSaga());
            const emitted: string[] = [];
            const io: any = {
                emit: (event: string) => { emitted.push(event); },
                to: () => ({ emit: (event: string) => { emitted.push(event); } }),
            };

            await runSettlementSaga(LEAD_ID, io);

            expect(emitted).toContain('auction:resolved');
            expect(emitted).toContain('lead:status-changed');
            expect(emitted).toContain('auction:closed');
        });
    });

    describe('retry behaviour', () => {
        it('marks the step FAILED and keeps the saga RUNNING on a retryable settle failure', async () => {
            mockSagaFindUnique.mockResolvedValue(makeSaga());
            mockBidFindUnique.mockResolvedValue(makeWinningBid({ escrowTxHash: 'vaultLock:42' }));
            mockVaultSettle.mockResolvedValue({ success: false, error: 'RPC timeout' });

            await runSettlementSaga(LEAD_ID);

            // Saga persisted as RUNNING with the failed step + error recorded
            const lastCall = mockSagaUpdate.mock.calls[mockSagaUpdate.mock.calls.length - 1][0];
            expect(lastCall.data.state).toBe('RUNNING');
            expect(lastCall.data.steps.vaultSettle).toBe('FAILED');
            expect(lastCall.data.lastError).toContain('RPC timeout');
            // Lead must NOT be finalized
            expect(mockLeadUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: 'SOLD' }),
            }));
        });

        it('resumes from persisted steps (vaultSettle DONE is not re-executed)', async () => {
            mockSagaFindUnique.mockResolvedValue(makeSaga({
                attempts: 1,
                state: 'RUNNING',
                steps: { vaultSettle: 'DONE', loserRefunds: 'DONE', nftMint: 'DONE' },
            }));
            mockBidFindUnique.mockResolvedValue(makeWinningBid({ escrowTxHash: 'vaultLock:42' }));

            await runSettlementSaga(LEAD_ID);

            expect(mockVaultSettle).not.toHaveBeenCalled();
            expect(lastSagaState()).toBe('COMPLETED');
        });
    });

    describe('compensation', () => {
        it('refunds the winner and reverts the lead to UNSOLD on terminal settle failure', async () => {
            // attempts = MAX-1 so this run is the terminal attempt
            mockSagaFindUnique.mockResolvedValue(makeSaga({ attempts: 4, state: 'RUNNING' }));
            mockBidFindUnique.mockResolvedValue(makeWinningBid({ escrowTxHash: 'vaultLock:42' }));
            mockVaultSettle.mockResolvedValue({ success: false, error: 'reverted on-chain' });

            await runSettlementSaga(LEAD_ID);

            // Compensating refund of the winner's lock
            expect(mockVaultRefund).toHaveBeenCalledWith(42, 'buyer_1', LEAD_ID);
            // Compensation DB transaction ran (bid expired, tx failed, lead → UNSOLD)
            expect(mockTransaction).toHaveBeenCalled();
            expect(lastSagaState()).toBe('COMPENSATED');
        });

        it('marks the saga FAILED and queues a durable refund when compensation also fails', async () => {
            mockSagaFindUnique.mockResolvedValue(makeSaga({ attempts: 4, state: 'RUNNING' }));
            mockBidFindUnique.mockResolvedValue(makeWinningBid({ escrowTxHash: 'vaultLock:42' }));
            mockVaultSettle.mockResolvedValue({ success: false, error: 'reverted on-chain' });
            mockVaultRefund.mockResolvedValue({ success: false, error: 'refund reverted too' });

            await runSettlementSaga(LEAD_ID);

            expect(lastSagaState()).toBe('FAILED');
            expect(mockEnqueueRetry).toHaveBeenCalledWith(expect.objectContaining({
                kind: 'refund',
                lockId: 42,
                buyerId: 'buyer_1',
                leadId: LEAD_ID,
            }));
        });
    });

    describe('idempotency', () => {
        it.each(['COMPLETED', 'COMPENSATED', 'FAILED'] as const)(
            'does nothing when the saga is already %s',
            async (state) => {
                mockSagaFindUnique.mockResolvedValue(makeSaga({ state }));

                await runSettlementSaga(LEAD_ID);

                expect(mockSagaUpdateMany).not.toHaveBeenCalled();
                expect(mockVaultSettle).not.toHaveBeenCalled();
                expect(mockLeadUpdateMany).not.toHaveBeenCalled();
            },
        );

        it('bails when another worker claims the saga (CAS count 0)', async () => {
            mockSagaFindUnique.mockResolvedValue(makeSaga());
            mockSagaUpdateMany.mockResolvedValue({ count: 0 });

            await runSettlementSaga(LEAD_ID);

            expect(mockVaultSettle).not.toHaveBeenCalled();
            expect(mockSagaUpdate).not.toHaveBeenCalled();
        });

        it('skips finalize when another run already moved the lead off SETTLING', async () => {
            mockSagaFindUnique.mockResolvedValue(makeSaga());
            mockLeadUpdateMany.mockResolvedValue({ count: 0 }); // CAS lost

            const io: any = { emit: jest.fn(), to: () => ({ emit: jest.fn() }) };
            await runSettlementSaga(LEAD_ID, io);

            expect(io.emit).not.toHaveBeenCalled();
            expect(lastSagaState()).toBe('COMPLETED');
        });

        it('returns silently when no saga row exists', async () => {
            mockSagaFindUnique.mockResolvedValue(null);
            await expect(runSettlementSaga(LEAD_ID)).resolves.toBeUndefined();
        });
    });
});
