/**
 * CRE Match-Result Ingestion (Phase B5 — DON → backend feedback loop)
 * --------------------------------------------------------------------
 * Before B5 the EvaluateBuyerRulesAndMatch workflow evaluated leads on the
 * DON but its consensus output went nowhere — the backend independently
 * re-evaluated every lead on its own trigger (cron split-brain, double
 * evaluation, no audit of what the DON decided).
 *
 * Now both evaluators converge here:
 *   - DON path:   workflow POSTs its consensus matches to
 *                 /api/v1/auto-bid/match-results (HMAC-signed)
 *   - local path: cre.service's mirror calls ingestMatchResults() directly
 *
 * Exactly-once semantics:
 *   1. The lead row is claimed with SELECT ... FOR UPDATE SKIP LOCKED —
 *      a concurrent ingest for the same lead skips instead of blocking.
 *   2. CreMatchResult has a UNIQUE(leadId) constraint — the first ingest
 *      wins; replays and the losing evaluator become no-ops.
 *
 * Bid placement still goes through the auto-bid engine (restricted to the
 * matched preference sets), so real-time gates — floor pricing, budgets,
 * vault locks, duplicate checks — are always enforced server-side.
 */

import crypto from 'crypto';
import { prisma } from '../lib/prisma';

export interface MatchResultEntry {
    preferenceSetId: string;
    buyerId: string;
    matched: boolean;
    reason?: string;
    bidAmount?: number;
}

export interface MatchResultSubmission {
    leadId: string;
    /** 'DON' for workflow-originated results, 'LOCAL' for the backend mirror. */
    source: 'DON' | 'LOCAL';
    evaluatedAt: string;
    results: MatchResultEntry[];
}

export interface IngestOutcome {
    accepted: boolean;
    reason: string;
    bidsPlaced: number;
}

/**
 * Canonical string covered by the HMAC signature. The sender (workflow or
 * mirror) builds the exact same string, so JSON key-ordering is irrelevant.
 */
export function matchResultSigningString(s: { leadId: string; evaluatedAt: string; results: MatchResultEntry[] }): string {
    const entries = s.results
        .map((r) => `${r.preferenceSetId}:${r.buyerId}:${r.matched ? 1 : 0}`)
        .sort()
        .join(',');
    return `${s.leadId}|${s.evaluatedAt}|${entries}`;
}

/** HMAC-SHA256 over the canonical signing string, hex-encoded. */
export function signMatchResults(s: { leadId: string; evaluatedAt: string; results: MatchResultEntry[] }, secret: string): string {
    return crypto.createHmac('sha256', secret).update(matchResultSigningString(s)).digest('hex');
}

export function verifyMatchResultSignature(
    s: { leadId: string; evaluatedAt: string; results: MatchResultEntry[] },
    signature: string,
    secret: string,
): boolean {
    const expected = signMatchResults(s, secret);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature || '', 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Ingest one evaluator's match results for a lead, exactly once.
 */
export async function ingestMatchResults(submission: MatchResultSubmission): Promise<IngestOutcome> {
    const { leadId, source, results } = submission;
    const matchedSets = results.filter((r) => r.matched);

    // ── Claim phase: row lock + unique outbox row, in one transaction ──
    let claimed = false;
    try {
        claimed = await prisma.$transaction(async (tx) => {
            // SKIP LOCKED: if another ingest currently holds this lead, we are
            // the losing duplicate — bail out without blocking the pool.
            const rows = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT "id" FROM "Lead"
                WHERE "id" = ${leadId}
                FOR UPDATE SKIP LOCKED
            `;
            if (rows.length === 0) return false;

            // UNIQUE(leadId): throws P2002 if a previous ingest already won.
            await tx.creMatchResult.create({
                data: {
                    leadId,
                    source,
                    payload: results as object[],
                    matchedSets: matchedSets.length,
                },
            });
            return true;
        });
    } catch (err: any) {
        if (err?.code === 'P2002') {
            return { accepted: false, reason: 'already-ingested', bidsPlaced: 0 };
        }
        throw err;
    }

    if (!claimed) {
        return { accepted: false, reason: 'lead-locked-by-concurrent-ingest', bidsPlaced: 0 };
    }

    console.log(`[CRE-INGEST] ${source} match results accepted for lead ${leadId}: ${matchedSets.length}/${results.length} matched`);

    // ── Dispatch phase ──
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
        return { accepted: true, reason: 'lead-not-found', bidsPlaced: 0 };
    }

    const geo = lead.geo as any;
    const leadData = {
        id: lead.id,
        vertical: lead.vertical,
        geo: {
            country: geo?.country || 'US',
            state: geo?.state || geo?.region,
            city: geo?.city,
            zip: geo?.zip,
        },
        source: (lead.source as string) || 'DIRECT',
        qualityScore: (lead as any).qualityScore ?? null,
        isVerified: lead.isVerified ?? false,
        reservePrice: Number(lead.reservePrice ?? 0),
        parameters: (lead as any).parameters ?? null,
    };

    // Preference-set bids: restricted to the sets the evaluator matched.
    let prefSetBids = 0;
    if (matchedSets.length > 0) {
        const { evaluateLeadForAutoBid } = await import('./auto-bid.service');
        const autoBidResult = await evaluateLeadForAutoBid(leadData, {
            onlyPreferenceSetIds: matchedSets.map((m) => m.preferenceSetId),
        });
        prefSetBids = autoBidResult.bidsPlaced.length;
    }

    const bidsPlaced = prefSetBids;

    // Notify matched buyers (strategy executor may also bid via orchestrator)
    const matchedBuyerIds = [...new Set(matchedSets.map((m) => m.buyerId))];
    if (matchedBuyerIds.length > 0) {
        try {
            const { fireAgentWebhooks } = await import('./agent-webhook.service');
            for (const buyerId of matchedBuyerIds) {
                await fireAgentWebhooks(buyerId, 'lead.matched', {
                    leadId,
                    vertical: lead.vertical,
                    source: submission.source,
                    matchedPreferenceSetIds: matchedSets
                        .filter((m) => m.buyerId === buyerId)
                        .map((m) => m.preferenceSetId),
                });
            }
        } catch { /* non-blocking */ }
    }

    await prisma.creMatchResult.update({
        where: { leadId },
        data: { bidsPlaced, processedAt: new Date() },
    });

    return {
        accepted: true,
        reason: matchedSets.length === 0 ? 'no-matches' : 'processed',
        bidsPlaced,
    };
}
