/**
 * CRE Match-Result Ingestion Tests (Phase B5 — DON feedback loop)
 *
 * Verifies:
 * - HMAC signing/verification of the canonical payload string
 * - exactly-once ingestion (UNIQUE leadId → replays no-op)
 * - SKIP LOCKED claim (concurrent ingest no-ops instead of double-bidding)
 * - matched sets are dispatched to the auto-bid engine RESTRICTED to the
 *   DON-matched preference set IDs (real-time gates still apply)
 */

// ── Mocks ───────────────────────────────────

const mockQueryRaw = jest.fn();
const mockCreMatchCreate = jest.fn();
const mockCreMatchUpdate = jest.fn();
const mockLeadFindUnique = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../src/lib/prisma', () => ({
    prisma: {
        creMatchResult: {
            create: (...a: any[]) => mockCreMatchCreate(...a),
            update: (...a: any[]) => mockCreMatchUpdate(...a),
        },
        lead: { findUnique: (...a: any[]) => mockLeadFindUnique(...a) },
        $transaction: (...a: any[]) => mockTransaction(...a),
    },
}));

const mockEvaluateLeadForAutoBid = jest.fn();
jest.mock('../src/services/auto-bid.service', () => ({
    evaluateLeadForAutoBid: (...a: any[]) => mockEvaluateLeadForAutoBid(...a),
}));

const mockRunStrategies = jest.fn();
jest.mock('../src/agents/strategy/runner', () => ({
    runStrategiesForLead: (...a: any[]) => mockRunStrategies(...a),
}));

import {
    ingestMatchResults,
    signMatchResults,
    verifyMatchResultSignature,
    matchResultSigningString,
    MatchResultEntry,
} from '../src/services/cre-match-ingest.service';

const LEAD_ID = 'lead-b5-1';
const SECRET = 'test-cre-secret';

const matchedEntry: MatchResultEntry = {
    preferenceSetId: 'pref-1',
    buyerId: 'buyer-1',
    matched: true,
    reason: 'all gates passed',
    bidAmount: 25,
};
const unmatchedEntry: MatchResultEntry = {
    preferenceSetId: 'pref-2',
    buyerId: 'buyer-2',
    matched: false,
    reason: 'Gate 2: country mismatch',
};

function submission(results: MatchResultEntry[] = [matchedEntry, unmatchedEntry]) {
    return {
        leadId: LEAD_ID,
        source: 'DON' as const,
        evaluatedAt: '2026-06-13T00:00:00.000Z',
        results,
    };
}

beforeEach(() => {
    jest.clearAllMocks();

    // Default: transaction callback runs against a tx client whose raw query
    // claims the lead and whose create succeeds.
    mockTransaction.mockImplementation(async (fn: any) =>
        fn({
            $queryRaw: (...a: any[]) => mockQueryRaw(...a),
            creMatchResult: { create: (...a: any[]) => mockCreMatchCreate(...a) },
        }),
    );
    mockQueryRaw.mockResolvedValue([{ id: LEAD_ID }]);
    mockCreMatchCreate.mockResolvedValue({ id: 'cmr-1' });
    mockCreMatchUpdate.mockResolvedValue({});
    mockLeadFindUnique.mockResolvedValue({
        id: LEAD_ID,
        vertical: 'solar',
        geo: { country: 'US', state: 'CA' },
        source: 'API',
        qualityScore: 8000,
        isVerified: true,
        reservePrice: 10,
        parameters: {},
    });
    mockEvaluateLeadForAutoBid.mockResolvedValue({
        leadId: LEAD_ID,
        bidsPlaced: [{ buyerId: 'buyer-1', preferenceSetId: 'pref-1', amount: 25, reason: 'auto-bid' }],
        skipped: [],
    });
    mockRunStrategies.mockResolvedValue([]);
});

// ── Signature scheme ────────────────────────

describe('match-result signing', () => {
    it('produces a stable canonical string independent of result order', () => {
        const a = matchResultSigningString({ leadId: LEAD_ID, evaluatedAt: 't', results: [matchedEntry, unmatchedEntry] });
        const b = matchResultSigningString({ leadId: LEAD_ID, evaluatedAt: 't', results: [unmatchedEntry, matchedEntry] });
        expect(a).toEqual(b);
    });

    it('verifies a signature produced by signMatchResults', () => {
        const s = submission();
        const sig = signMatchResults(s, SECRET);
        expect(verifyMatchResultSignature(s, sig, SECRET)).toBe(true);
    });

    it('rejects a signature over tampered results', () => {
        const s = submission();
        const sig = signMatchResults(s, SECRET);
        const tampered = submission([{ ...matchedEntry, buyerId: 'attacker' }, unmatchedEntry]);
        expect(verifyMatchResultSignature(tampered, sig, SECRET)).toBe(false);
    });

    it('rejects a signature made with the wrong secret', () => {
        const s = submission();
        const sig = signMatchResults(s, 'wrong-secret');
        expect(verifyMatchResultSignature(s, sig, SECRET)).toBe(false);
    });

    it('rejects an empty signature', () => {
        expect(verifyMatchResultSignature(submission(), '', SECRET)).toBe(false);
    });
});

// ── Ingestion ───────────────────────────────

describe('ingestMatchResults', () => {
    it('claims the lead, records the outbox row, and dispatches restricted auto-bid', async () => {
        const outcome = await ingestMatchResults(submission());

        expect(outcome).toEqual({ accepted: true, reason: 'processed', bidsPlaced: 1 });

        // Outbox row created with the DON payload
        expect(mockCreMatchCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ leadId: LEAD_ID, source: 'DON', matchedSets: 1 }),
            }),
        );

        // Auto-bid restricted to the DON-matched preference sets only
        expect(mockEvaluateLeadForAutoBid).toHaveBeenCalledWith(
            expect.objectContaining({ id: LEAD_ID, vertical: 'solar' }),
            { onlyPreferenceSetIds: ['pref-1'] },
        );

        // Outcome persisted
        expect(mockCreMatchUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { leadId: LEAD_ID },
                data: expect.objectContaining({ bidsPlaced: 1 }),
            }),
        );
    });

    it('no-ops when a previous ingest already won (UNIQUE leadId)', async () => {
        mockCreMatchCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

        const outcome = await ingestMatchResults(submission());

        expect(outcome).toEqual({ accepted: false, reason: 'already-ingested', bidsPlaced: 0 });
        expect(mockEvaluateLeadForAutoBid).not.toHaveBeenCalled();
    });

    it('no-ops when the lead row is locked by a concurrent ingest (SKIP LOCKED)', async () => {
        mockQueryRaw.mockResolvedValue([]); // SKIP LOCKED returned no row

        const outcome = await ingestMatchResults(submission());

        expect(outcome).toEqual({ accepted: false, reason: 'lead-locked-by-concurrent-ingest', bidsPlaced: 0 });
        expect(mockCreMatchCreate).not.toHaveBeenCalled();
        expect(mockEvaluateLeadForAutoBid).not.toHaveBeenCalled();
    });

    it('records a no-match result without dispatching bids', async () => {
        const outcome = await ingestMatchResults(submission([unmatchedEntry]));

        expect(outcome).toEqual({ accepted: true, reason: 'no-matches', bidsPlaced: 0 });
        expect(mockEvaluateLeadForAutoBid).not.toHaveBeenCalled();
        expect(mockCreMatchUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ where: { leadId: LEAD_ID } }),
        );
    });

    it('still reports accepted when the lead vanished after the claim', async () => {
        mockLeadFindUnique.mockResolvedValue(null);

        const outcome = await ingestMatchResults(submission());

        expect(outcome).toEqual({ accepted: true, reason: 'lead-not-found', bidsPlaced: 0 });
        expect(mockEvaluateLeadForAutoBid).not.toHaveBeenCalled();
    });
});
