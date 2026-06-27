/**
 * Auction Closure Service
 *
 * Extracted from socket.ts so auction resolution can be triggered from:
 *   1. WebSocket AuctionMonitor (every 2s)
 *   2. HTTP GET /leads (on-demand, before returning results)
 *   3. Server startup (one-time sweep for orphaned leads)
 *
 * All functions are idempotent — safe to call concurrently.
 */

import { Server } from 'socket.io';
import { prisma } from '../lib/prisma';
import { calculateFees, type BidSourceType } from '../lib/fees';
import { applyHolderPerks, applyMultiplier } from '../services/holder-perks.service';
import {
    isVrfConfigured, requestTieBreak, waitForResolution, getResolution,
    ResolveType, startVrfResolutionWatcher,
} from '../services/vrf.service';
import { acquireLock, releaseLock } from '../lib/redis';
import { isAwaitingReveals, REVEAL_WINDOW_MS } from './bid.service';
import { runSettlementSaga, recoverStalledSagas } from './settlement-saga.service';

// Phase B3: how long auction closure blocks waiting for the on-chain VRF
// tie-break before falling back to the deterministic (earliest-bid) winner.
// Must stay well under the 120s Redis closure lock TTL.
const VRF_TIE_TIMEOUT_MS = Number(process.env.VRF_TIE_TIMEOUT_MS || 45_000);

// ============================================
// Resolve Expired Auctions
// ============================================

/**
 * Find and resolve all IN_AUCTION leads whose auction window has expired.
 *
 * Safety: an extra in-process check ensures the auction is at least 58 000 ms
 * old before we close it — this prevents any edge-case where the monitor fires
 * within the last 2 s of the window due to clock drift or rapid polling.
 *
 * @param io  Optional Socket.IO server for broadcasting events. Omit for HTTP-only calls.
 * @returns   Number of auctions resolved.
 */
export async function resolveExpiredAuctions(io?: Server): Promise<number> {
    const now = new Date();

    const expiredAuctions = await prisma.lead.findMany({
        where: {
            status: 'IN_AUCTION',
            auctionEndAt: { lte: now },
        },
        select: { id: true, vertical: true, reservePrice: true, auctionEndAt: true },
    });

    let resolved = 0;
    for (const lead of expiredAuctions) {
        // Safety gate: skip if auction expired < 2s ago (tight window matches AuctionMonitor's 2s poll).
        const expiredAtMs = lead.auctionEndAt ? new Date(lead.auctionEndAt).getTime() : 0;
        const ageMs = Date.now() - expiredAtMs;
        if (ageMs < 2_000) {
            // Not yet 2s since auctionEndAt — skip this tick, resolve on the next.
            // (AuctionMonitor polls every 2s so 2s gate ensures exactly 1 extra poll before close)
            continue;
        }

        console.log(`[AuctionClosure] Auction for lead ${lead.id} closed after full 60 s (age: ${Math.round(ageMs / 1000)}s)`);
        await resolveAuction(lead.id, io);
        resolved++;
    }

    return resolved;
}


// ============================================
// Resolve Stuck Auctions (Safety Net)
// ============================================

/**
 * Catch edge-case stuck leads: null auctionEndAt or 5+ min stale.
 * These arise from incomplete creation or orphaned restarts.
 * @param io  Optional Socket.IO server for broadcasting events.
 * @returns   Number of stuck auctions resolved.
 */
export async function resolveStuckAuctions(io?: Server): Promise<number> {
    const now = new Date();

    // Recover leads stranded in CLOSING (worker crashed mid-resolution).
    // After 5 minutes the CAS claim is considered stale and is reverted so
    // the regular expired-auction sweep can retry resolution.
    const recovered = await prisma.lead.updateMany({
        where: {
            status: 'CLOSING',
            auctionEndAt: { lte: new Date(now.getTime() - 5 * 60 * 1000) },
        },
        data: { status: 'IN_AUCTION' },
    });
    if (recovered.count > 0) {
        console.warn(`[AuctionClosure] Recovered ${recovered.count} lead(s) stranded in CLOSING — will retry resolution`);
    }

    // Phase B3: resume settlement sagas stranded in PENDING/RUNNING
    // (worker crashed mid-settlement or a scheduled retry was lost).
    try {
        const resumed = await recoverStalledSagas(io);
        if (resumed > 0) {
            console.warn(`[AuctionClosure] Resumed ${resumed} stalled settlement saga(s)`);
        }
    } catch (sagaErr: any) {
        console.error('[AuctionClosure] Saga recovery sweep failed:', sagaErr.message);
    }

    const stuckAuctions = await prisma.lead.findMany({
        where: {
            status: 'IN_AUCTION',
            OR: [
                { auctionEndAt: null },
                { auctionEndAt: { lte: new Date(now.getTime() - 5 * 60 * 1000) } },
            ],
        },
        select: { id: true, vertical: true, reservePrice: true },
    });

    for (const lead of stuckAuctions) {
        console.log(`[AuctionClosure] Resolving stuck lead ${lead.id} (null/stale auctionEndAt)`);
        await convertToUnsold(lead.id, lead, io);
        if (io) {
            io.emit('auction:resolved', { leadId: lead.id, outcome: 'NO_WINNER' });
            io.emit('lead:status-changed', { leadId: lead.id, oldStatus: 'IN_AUCTION', newStatus: 'UNSOLD' });  // BUG-3 fix: was 'lead:status-change' (missing -d)
        }
    }

    return stuckAuctions.length;
}

// ============================================
// Resolve Buy It Now Expiry
// ============================================

/**
 * Transition stale UNSOLD leads past their expiresAt to EXPIRED.
 * @param io  Optional Socket.IO server for broadcasting events.
 * @returns   Number of leads expired.
 */
export async function resolveExpiredBuyNow(io?: Server): Promise<number> {
    const now = new Date();

    const expiredBinLeads = await prisma.lead.findMany({
        where: {
            status: 'UNSOLD',
            expiresAt: { lte: now },
        },
        select: { id: true },
    });

    if (expiredBinLeads.length === 0) return 0;

    await prisma.lead.updateMany({
        where: {
            id: { in: expiredBinLeads.map((l) => l.id) },
            status: 'UNSOLD',
        },
        data: { status: 'EXPIRED' },
    });

    if (io) {
        for (const lead of expiredBinLeads) {
            io.emit('lead:bin-expired', { leadId: lead.id });
        }
    }

    console.log(`[AuctionClosure] Expired ${expiredBinLeads.length} stale Buy It Now leads`);
    return expiredBinLeads.length;
}

// ============================================
// Core: Resolve Single Auction
// ============================================

async function resolveAuction(leadId: string, io?: Server) {
    // ── Reveal window (Phase B2 commit-reveal) ──
    // When commit-only sealed bids exist, hold resolution open for the
    // configured reveal window after auctionEndAt so buyers can reveal via
    // POST /bids/:id/reveal. New bids are still rejected (auctionEndAt past).
    // The resolver re-attempts on its normal schedule until the window ends.
    const leadForWindow = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { auctionEndAt: true, status: true },
    });
    if (leadForWindow?.status === 'IN_AUCTION'
        && await isAwaitingReveals(leadId, leadForWindow.auctionEndAt)) {
        await prisma.auctionRoom.updateMany({
            where: { leadId, phase: 'BIDDING' },
            data: { phase: 'REVEAL' },
        });
        if (io) {
            io.emit('auction:reveal-phase', {
                leadId,
                revealEndsAt: new Date(new Date(leadForWindow.auctionEndAt!).getTime() + REVEAL_WINDOW_MS).toISOString(),
            });
        }
        console.log(`[AuctionClosure] ${leadId}: awaiting sealed-bid reveals — deferring resolution`);
        return;
    }

    // ── Multi-instance guard: Redis lock (best-effort) ──
    const lockToken = await acquireLock(`auction-close:${leadId}`, 120_000);
    if (!lockToken) {
        console.log(`[AuctionClosure] ${leadId}: another instance holds the closure lock — skipping`);
        return;
    }

    // ── Compare-and-swap status gate: IN_AUCTION → CLOSING ──
    // Exactly ONE caller can win this transition; concurrent resolvers see
    // count === 0 and bail. This is the primary idempotency barrier.
    const claimed = await prisma.lead.updateMany({
        where: { id: leadId, status: 'IN_AUCTION' },
        data: { status: 'CLOSING' },
    });
    if (claimed.count === 0) {
        await releaseLock(`auction-close:${leadId}`, lockToken);
        console.log(`[AuctionClosure] ${leadId}: already CLOSING/closed elsewhere — skipping`);
        return;
    }

    try {
        const lead = await prisma.lead.findUnique({
            where: { id: leadId },
            select: {
                id: true,
                vertical: true,
                reservePrice: true,
                qualityScore: true,
                geo: true,
                parameters: true,
                createdAt: true,
                sellerId: true,
                seller: { select: { user: { select: { walletAddress: true } } } },
            },
        });

        if (!lead) {
            console.error(`[AuctionClosure] resolveAuction: lead ${leadId} not found`);
            return;
        }

        // ── Auto-reveal PENDING sealed bids ──
        const pendingBids = await prisma.bid.findMany({
            where: { leadId, status: 'PENDING', commitment: { not: null } },
        });

        for (const bid of pendingBids) {
            try {
                // If bid already has amount, just reveal it
                if (bid.amount != null && Number(bid.amount) > 0) {
                    const perks = await applyHolderPerks(lead.vertical, bid.buyerId);
                    const effectiveBid = perks.isHolder
                        ? applyMultiplier(Number(bid.amount), perks.multiplier)
                        : Number(bid.amount);
                    await prisma.bid.update({
                        where: { id: bid.id },
                        data: { status: 'REVEALED', effectiveBid, processedAt: new Date() },
                    });
                    console.log(`[AuctionClosure] Auto-revealed bid ${bid.id} (had amount): $${Number(bid.amount)} (effective: $${effectiveBid})`);
                    continue;
                }

                // Try base64 decode for legacy demo format
                const decoded = Buffer.from(bid.commitment!, 'base64').toString('utf-8');
                const [amountStr] = decoded.split(':');
                const amount = parseFloat(amountStr);
                if (isNaN(amount) || amount <= 0) {
                    await prisma.bid.update({
                        where: { id: bid.id },
                        data: { status: 'EXPIRED', processedAt: new Date() },
                    });
                    continue;
                }

                const perks = await applyHolderPerks(lead.vertical, bid.buyerId);
                const effectiveBid = perks.isHolder
                    ? applyMultiplier(amount, perks.multiplier)
                    : amount;

                await prisma.bid.update({
                    where: { id: bid.id },
                    data: {
                        status: 'REVEALED',
                        amount,
                        effectiveBid,
                        processedAt: new Date(),
                    },
                });
                console.log(`[AuctionClosure] Auto-revealed bid ${bid.id}: $${amount} (effective: $${effectiveBid})`);
            } catch (err: any) {
                console.warn(`[AuctionClosure] Failed to auto-reveal bid ${bid.id}:`, err.message);
                await prisma.bid.update({
                    where: { id: bid.id },
                    data: { status: 'EXPIRED', processedAt: new Date() },
                });
            }
        }

        // Rank revealed bids
        const rankedBids = await prisma.bid.findMany({
            where: {
                leadId,
                status: 'REVEALED',
                amount: { not: null },
            },
            orderBy: [
                { effectiveBid: { sort: 'desc', nulls: 'last' } },
                { isHolder: 'desc' },
                { amount: 'desc' },
                { createdAt: 'asc' },
            ],
            include: { buyer: true },
        });

        // No valid bids → Buy It Now
        if (rankedBids.length === 0) {
            await convertToUnsold(leadId, lead, io);
            return;
        }

        const reservePrice = lead.reservePrice ? Number(lead.reservePrice) : 0;

        // Filter bids that meet reserve
        const eligibleBids = rankedBids.filter(bid => {
            if (reservePrice > 0 && Number(bid.amount) < reservePrice) {
                console.log(`[AuctionClosure] ${leadId}: bid $${Number(bid.amount).toFixed(2)} < reserve $${reservePrice.toFixed(2)} — skipping`);
                return false;
            }
            return true;
        });

        // ── VRF Tie-Breaking (Phase B3: blocking with timeout fallback) ──
        // Detect ties: 2+ bids with the same top effectiveBid.
        // Strategy:
        //   1. Request the on-chain VRF tie-break and BLOCK for up to
        //      VRF_TIE_TIMEOUT_MS so the announced winner IS the VRF winner.
        //   2. On fulfillment: select the matching bid, persist vrfRequestId +
        //      vrfWinner to AuctionRoom before the winner transaction commits.
        //   3. On timeout/error: fall back to the deterministic winner
        //      (earliest createdAt) and leave the background watcher running
        //      so VRF provenance still lands in AuctionRoom for audit.
        let winningBid: typeof rankedBids[0] | null = null;
        let vrfRequestId: string | null = null;

        if (eligibleBids.length === 0) {
            // No eligible bids
        } else if (eligibleBids.length === 1) {
            winningBid = eligibleBids[0];
        } else {
            const topEffective = Number(eligibleBids[0].effectiveBid ?? eligibleBids[0].amount);
            const tiedBids = eligibleBids.filter(
                b => Number(b.effectiveBid ?? b.amount) === topEffective
            );

            if (tiedBids.length === 1) {
                // Clear winner — no tie
                winningBid = tiedBids[0];
            } else {
                // TIE DETECTED — deterministic fallback first, VRF may override below
                winningBid = tiedBids[0];

                const candidates = tiedBids
                    .map(b => b.buyer?.walletAddress)
                    .filter((w): w is string => !!w);

                if (candidates.length >= 2 && isVrfConfigured()) {
                    console.log(
                        `[AuctionClosure] ${leadId}: ${tiedBids.length}-way tie at $${topEffective}` +
                        ` — requesting VRF tie-break (blocking up to ${VRF_TIE_TIMEOUT_MS / 1000}s)`
                    );
                    try {
                        const txHash = await requestTieBreak(leadId, candidates, ResolveType.AUCTION_TIE);
                        if (txHash) {
                            if (io) {
                                io.emit('auction:vrf-requested', { leadId, txHash, candidateCount: candidates.length });
                            }

                            const vrfWinnerAddr = await waitForResolution(leadId, VRF_TIE_TIMEOUT_MS);
                            if (vrfWinnerAddr) {
                                const resolution = await getResolution(leadId);
                                vrfRequestId = resolution ? resolution.requestId.toString() : null;

                                const vrfBid = tiedBids.find(
                                    b => b.buyer?.walletAddress?.toLowerCase() === vrfWinnerAddr.toLowerCase()
                                );
                                if (vrfBid) {
                                    winningBid = vrfBid;
                                    console.log(`[AuctionClosure] ${leadId}: VRF selected winner ${vrfWinnerAddr} (requestId=${vrfRequestId})`);
                                } else {
                                    console.warn(`[AuctionClosure] ${leadId}: VRF winner ${vrfWinnerAddr} not among tied bids — keeping deterministic fallback`);
                                }

                                await prisma.auctionRoom.updateMany({
                                    where: { leadId },
                                    data: { vrfWinner: vrfWinnerAddr, ...(vrfRequestId ? { vrfRequestId } : {}) },
                                });
                                if (io) {
                                    io.emit('auction:vrf-resolved', {
                                        leadId,
                                        vrfWinner: vrfWinnerAddr,
                                        requestId: vrfRequestId ?? undefined,
                                    });
                                }
                            } else {
                                // Timeout — deterministic fallback wins; the background
                                // watcher still records VRF provenance when it lands.
                                console.warn(`[AuctionClosure] ${leadId}: VRF timed out after ${VRF_TIE_TIMEOUT_MS / 1000}s — using earliest bid as tiebreaker`);
                                startVrfResolutionWatcher(leadId, io).catch(() => { });
                            }
                        }
                    } catch (vrfErr: any) {
                        console.warn(`[AuctionClosure] ${leadId}: VRF tie-break failed (non-fatal): ${vrfErr.message}`);
                    }
                } else {
                    console.warn(
                        `[AuctionClosure] ${leadId}: VRF unavailable (configured=${isVrfConfigured()},` +
                        ` candidates=${candidates.length}) — using earliest bid as tiebreaker`
                    );
                }
            }
        }

        if (!winningBid) {
            console.log(`[AuctionClosure] ${leadId}: no bid meets reserve — converting to Buy It Now`);
            await convertToUnsold(leadId, lead, io);
            return;
        }

        // Calculate fees
        const winAmount = Number(winningBid.amount);
        const fees = calculateFees(winAmount, (winningBid.source || 'MANUAL') as BidSourceType);

        // ── Winner transaction + settlement-saga outbox (Phase B3) ──
        // The lead moves to SETTLING (not SOLD) and the saga row is created in
        // the SAME transaction. If the process dies right after this commit,
        // the recovery sweep finds the saga and resumes settlement — no more
        // "DB says sold, chain never settled" split-brain.
        await prisma.$transaction([
            prisma.bid.update({
                where: { id: winningBid.id },
                data: { status: 'ACCEPTED', processedAt: new Date() },
            }),
            prisma.bid.updateMany({
                where: {
                    leadId,
                    id: { not: winningBid.id },
                    status: 'REVEALED',
                },
                data: { status: 'OUTBID', processedAt: new Date() },
            }),
            // BUG-09: persist vrfRequestId so Judge View can show VRF provenance
            ...(vrfRequestId
                ? [prisma.auctionRoom.updateMany({ where: { leadId }, data: { vrfRequestId } })]
                : []),
            prisma.bid.updateMany({
                where: {
                    leadId,
                    status: 'PENDING',
                },
                data: { status: 'EXPIRED', processedAt: new Date() },
            }),
            prisma.lead.update({
                where: { id: leadId },
                data: { status: 'SETTLING' },
            }),
            prisma.auctionRoom.updateMany({
                where: { leadId },
                data: { phase: 'RESOLVED' },
            }),
            // Idempotent: upsert on (leadId, buyerId) — a pre-bid escrow may
            // already have created a PENDING transaction for this buyer, and a
            // concurrent closure attempt must never create a duplicate charge.
            prisma.transaction.upsert({
                where: { leadId_buyerId: { leadId, buyerId: winningBid.buyerId } },
                create: {
                    leadId,
                    buyerId: winningBid.buyerId,
                    amount: winningBid.amount!,
                    platformFee: fees.platformFee,
                    convenienceFee: fees.convenienceFee || undefined,
                    convenienceFeeType: fees.convenienceFeeType,
                    status: 'PENDING',
                },
                update: {
                    amount: winningBid.amount!,
                    platformFee: fees.platformFee,
                    convenienceFee: fees.convenienceFee || undefined,
                    convenienceFeeType: fees.convenienceFeeType,
                },
            }),
            // Outbox: durable record of the settlement work that remains
            prisma.settlementSaga.upsert({
                where: { leadId },
                create: { leadId, winningBidId: winningBid.id },
                update: { winningBidId: winningBid.id, state: 'PENDING', steps: {}, attempts: 0, lastError: null },
            }),
        ]);

        console.log(`[AuctionClosure] ${leadId} winner determined (${winningBid.buyerId}) — running settlement saga`);

        // ── Execute the saga inline (first attempt) ──
        // vault settle → loser refunds → NFT mint → finalize (SETTLING → SOLD
        // + socket events + bounties + analytics). Failures self-schedule
        // retries with backoff; terminal failures compensate (winner refund +
        // lead → UNSOLD).
        await runSettlementSaga(leadId, io);
    } catch (error) {
        console.error('[AuctionClosure] Auction resolution error:', error);
        // Revert the CAS claim so the next sweep can retry this auction.
        // (Only if still CLOSING — a partial success may have set SOLD/UNSOLD.)
        try {
            await prisma.lead.updateMany({
                where: { id: leadId, status: 'CLOSING' },
                data: { status: 'IN_AUCTION' },
            });
        } catch (revertErr) {
            console.error(`[AuctionClosure] CRITICAL: failed to revert CLOSING status for ${leadId}:`, revertErr);
        }
    } finally {
        await releaseLock(`auction-close:${leadId}`, lockToken);
    }
}

// ============================================
// Convert to UNSOLD (Buy It Now)
// ============================================

async function convertToUnsold(leadId: string, lead: any, io?: Server) {
    const reservePrice = lead.reservePrice ? Number(lead.reservePrice) : null;
    const binPrice = reservePrice ? reservePrice * 1.2 : null;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.$transaction([
        prisma.lead.update({
            where: { id: leadId },
            data: {
                status: 'UNSOLD',
                buyNowPrice: binPrice,
                expiresAt,
            },
        }),
        prisma.auctionRoom.updateMany({
            where: { leadId },
            data: { phase: 'CANCELLED' },
        }),
        prisma.bid.updateMany({
            where: { leadId, status: { in: ['PENDING', 'REVEALED'] } },
            data: { status: 'EXPIRED', processedAt: new Date() },
        }),
    ]);

    if (io) {
        io.to(`auction_${leadId}`).emit('lead:unsold', {
            leadId,
            buyNowPrice: binPrice,
            expiresAt: expiresAt.toISOString(),
        });

        io.emit('marketplace:new-bin', {
            leadId,
            vertical: lead.vertical,
            buyNowPrice: binPrice,
            auctionDuration: lead.ask?.auctionDuration ?? 60,
            expiresAt: expiresAt.toISOString(),
        });

        io.emit('lead:status-changed', {
            leadId,
            oldStatus: 'IN_AUCTION',
            newStatus: 'UNSOLD',
            buyNowPrice: binPrice,
            expiresAt: expiresAt.toISOString(),
        });

        // ── AUCTION-SYNC: authoritative closure broadcast (no winner) ──
        io.emit('auction:closed', {
            leadId,
            status: 'UNSOLD',
            remainingTime: 0,
            isClosed: true,
            serverTs: Date.now(),  // BUG-1 fix: epoch ms, not ISO string
        });
        console.log(`[AUCTION-CLOSED] leadId=${leadId} status=UNSOLD buyNowPrice=${binPrice ?? '—'}`);
    }

    // Log analytics
    await prisma.analyticsEvent.create({
        data: {
            eventType: 'lead_unsold_bin_created',
            entityType: 'lead',
            entityId: leadId,
            metadata: { buyNowPrice: binPrice, reservePrice },
        },
    });

    console.log(`[AuctionClosure] ${leadId} → UNSOLD (Buy It Now: $${binPrice?.toFixed(2) ?? 'N/A'})`);
}
