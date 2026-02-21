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
import { fireConversionEvents, ConversionPayload } from '../services/conversion-tracking.service';
import { bountyService } from '../services/bounty.service';
import { isVrfConfigured, requestTieBreak, ResolveType, startVrfResolutionWatcher } from '../services/vrf.service';
import { aceDevBus } from '../services/ace.service';
import * as vaultService from '../services/vault.service';

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
        // Safety gate: only close if the auction expired at least 58 s ago relative to now.
        // auctionEndAt is set to (startTime + 60 s), so this guard fires at ~60 s.
        const expiredAtMs = lead.auctionEndAt ? new Date(lead.auctionEndAt).getTime() : 0;
        const ageMs = Date.now() - expiredAtMs;
        if (ageMs < 58_000) {
            // Not yet 58 s since auctionEndAt — skip this tick, resolve on the next.
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
            io.emit('lead:status-change', { leadId: lead.id, newStatus: 'UNSOLD' });
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

        // ── VRF Tie-Breaking (BUG-09: non-blocking) ──
        // Detect ties: 2+ bids with the same top effectiveBid.
        // Strategy:
        //   1. Pick deterministic fallback winner immediately (earliest createdAt) so
        //      auction closure is NEVER blocked.
        //   2. If VRF is configured and 2+ wallet addresses are available, fire
        //      requestTieBreak() and launch startVrfResolutionWatcher() in the
        //      background. The watcher will update AuctionRoom.vrfWinner and emit
        //      'auction:vrf-resolved' once the on-chain callback lands (~15-90 s).
        //   3. Persist vrfRequestId immediately to AuctionRoom (before response).
        let winningBid: typeof rankedBids[0] | null = null;
        let vrfRequestId: string | null = null; // BUG-09: captured for DB + socket

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
                // TIE DETECTED
                console.log(
                    `[AuctionClosure] ${leadId}: ${tiedBids.length}-way tie at $${topEffective}` +
                    ` — deterministic fallback selected immediately, VRF requested async`
                );

                // Step 1 — pick deterministic fallback now (earliest createdAt, already sorted)
                winningBid = tiedBids[0];

                // Step 2 — fire VRF async if configured
                const candidates = tiedBids
                    .map(b => b.buyer?.walletAddress)
                    .filter((w): w is string => !!w);

                if (candidates.length >= 2 && isVrfConfigured()) {
                    // requestTieBreak submits the on-chain tx and returns the tx hash.
                    // We do NOT await the resolution here — that would block closure.
                    requestTieBreak(leadId, candidates, ResolveType.AUCTION_TIE)
                        .then(txHash => {
                            if (txHash) {
                                // vrfRequestId not yet available synchronously — the watcher
                                // will read it from the contract once fulfilled.
                                console.log(`[AuctionClosure] ${leadId}: VRF tx submitted (${txHash}), watcher started`);
                                // Emit requested event immediately so Judge View shows pending state
                                if (io) {
                                    io.emit('auction:vrf-requested', { leadId, txHash, candidateCount: candidates.length });
                                }
                                // Launch background watcher — non-blocking, swallows errors
                                startVrfResolutionWatcher(leadId, io).catch(() => { });
                            }
                        })
                        .catch((err: any) => {
                            console.warn(`[AuctionClosure] ${leadId}: VRF requestTieBreak failed (non-fatal):`, err.message);
                        });
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
                data: {
                    status: 'SOLD',
                    winningBid: winningBid.amount,
                    soldAt: new Date(),
                },
            }),
            prisma.auctionRoom.updateMany({
                where: { leadId },
                data: { phase: 'RESOLVED' },
            }),
            prisma.transaction.create({
                data: {
                    leadId,
                    buyerId: winningBid.buyerId,
                    amount: winningBid.amount!,
                    platformFee: fees.platformFee,
                    convenienceFee: fees.convenienceFee || undefined,
                    convenienceFeeType: fees.convenienceFeeType,
                    status: 'PENDING',
                },
            }),
        ]);

        console.log(`[AuctionClosure] ${leadId} resolved. Winner: ${winningBid.buyerId}`);

        // ── On-chain vault settlement for the winner ──
        // Transfer locked bid amount → seller, convenience fee → platform wallet
        try {
            const winnerEscrowRef = winningBid.escrowTxHash || '';
            const sellerWallet = (lead as any).seller?.user?.walletAddress || '';
            if (winnerEscrowRef.startsWith('vaultLock:') && sellerWallet) {
                const lockId = parseInt(winnerEscrowRef.split(':')[1], 10);
                if (lockId > 0) {
                    const settleResult = await vaultService.settleBid(lockId, sellerWallet, winningBid.buyerId, leadId);
                    if (settleResult.success) {
                        console.log(`[AuctionClosure] Vault settlement successful: lockId=${lockId}, txHash=${settleResult.txHash}`);
                        aceDevBus.emit('ace:dev-log', {
                            ts: new Date().toISOString(),
                            action: 'vault:settle-winner',
                            leadId,
                            buyerId: winningBid.buyerId,
                            lockId,
                            txHash: settleResult.txHash,
                            amount: winAmount,
                        });
                    } else {
                        console.error(`[AuctionClosure] Vault settlement FAILED for lockId=${lockId}: ${settleResult.error}`);
                        aceDevBus.emit('ace:dev-log', {
                            ts: new Date().toISOString(),
                            action: 'vault:settle-winner:error',
                            leadId,
                            buyerId: winningBid.buyerId,
                            lockId,
                            error: settleResult.error,
                        });
                    }
                }
            }
        } catch (settleErr: any) {
            // Non-blocking: DB already recorded the win — settlement can be retried
            console.error('[AuctionClosure] Vault settlement error (non-blocking):', settleErr.message);
        }

        // ── Bounty Release ──
        // Match active buyer bounty pools and auto-release to seller
        try {
            const sellerWallet = (lead as any).seller?.user?.walletAddress || '';
            if (sellerWallet && lead.vertical) {
                const geo = (lead as any).geo || {};
                const matched = await bountyService.matchBounties(
                    {
                        id: lead.id,
                        vertical: lead.vertical,
                        qualityScore: (lead as any).qualityScore,
                        state: geo.state || null,
                        country: geo.country || null,
                        parameters: (lead as any).parameters,
                        createdAt: (lead as any).createdAt,
                        reservePrice: lead.reservePrice ? Number(lead.reservePrice) : null,
                    },
                    winAmount // Use winning bid (not reserve) for stacking cap
                );

                for (const bounty of matched) {
                    const releaseResult = await bountyService.releaseBounty(
                        bounty.poolId,
                        leadId,
                        sellerWallet,
                        bounty.amount,
                        bounty.verticalSlug
                    );
                    if (releaseResult.success) {
                        console.log(`[AuctionClosure] Bounty $${bounty.amount} released from pool ${bounty.poolId} to seller ${sellerWallet.slice(0, 10)}...`);
                        if (io) {
                            io.emit('bounty:released', {
                                leadId,
                                poolId: bounty.poolId,
                                buyerId: bounty.buyerId,
                                amount: bounty.amount,
                                verticalSlug: bounty.verticalSlug,
                                txHash: releaseResult.txHash,
                            });
                        }
                    }
                }

                if (matched.length > 0) {
                    const totalBounty = matched.reduce((sum, m) => sum + m.amount, 0);
                    console.log(`[AuctionClosure] ${matched.length} bounties released for lead ${leadId}, total: $${totalBounty.toFixed(2)}`);
                }
            }
        } catch (bountyErr) {
            // Bounty release is non-blocking — don't fail the auction resolution
            console.error('[AuctionClosure] Bounty release error (non-blocking):', bountyErr);
        }

        // ── Vault + Escrow Refund: Auto-refund losers ──
        // Losers get their vault deductions refunded (bid amount + $1 fee)
        try {
            const loserBids = await prisma.bid.findMany({
                where: {
                    leadId,
                    status: 'OUTBID',
                    amount: { not: null },
                    escrowRefunded: false,
                },
            });

            for (const loserBid of loserBids) {
                try {
                    console.log(`[AuctionClosure] Auto-refunding escrow for loser bid ${loserBid.id}`);
                    aceDevBus.emit('ace:dev-log', {
                        ts: new Date().toISOString(),
                        action: 'escrow:refund:call',
                        leadId,
                        bidId: loserBid.id,
                        buyerId: loserBid.buyerId,
                    });

                    // On-chain vault refund via lockId stored in escrowTxHash
                    // Attempt on-chain refund FIRST, then mark DB only on success
                    const escrowRef = loserBid.escrowTxHash || '';
                    let onChainRefunded = false;
                    if (escrowRef.startsWith('vaultLock:')) {
                        const lockId = parseInt(escrowRef.split(':')[1], 10);
                        if (lockId > 0) {
                            const refundResult = await vaultService.refundBid(lockId, loserBid.buyerId, leadId);
                            onChainRefunded = refundResult.success;
                            if (!refundResult.success) {
                                console.error(`[AuctionClosure] On-chain refund failed for lockId=${lockId}: ${refundResult.error}`);
                            }
                        }
                    } else {
                        // No vault lock — legacy bid or no amount: skip on-chain, just mark DB
                        onChainRefunded = true;
                    }

                    if (onChainRefunded) {
                        await prisma.bid.update({
                            where: { id: loserBid.id },
                            data: { escrowRefunded: true },
                        });
                    }

                    aceDevBus.emit('ace:dev-log', {
                        ts: new Date().toISOString(),
                        action: onChainRefunded ? 'escrow:refund:success' : 'escrow:refund:partial',
                        leadId,
                        bidId: loserBid.id,
                        buyerId: loserBid.buyerId,
                        vaultRefund: escrowRef.startsWith('vaultLock:') ? (onChainRefunded ? 'on-chain' : 'failed') : 'n/a',
                    });
                } catch (refundErr: any) {
                    console.error(`[AuctionClosure] Escrow refund failed for bid ${loserBid.id}:`, refundErr.message);
                    aceDevBus.emit('ace:dev-log', {
                        ts: new Date().toISOString(),
                        action: 'escrow:refund:error',
                        leadId,
                        bidId: loserBid.id,
                        error: refundErr.message,
                    });
                }
            }

            if (loserBids.length > 0) {
                console.log(`[AuctionClosure] Refunded ${loserBids.length} pre-bid escrows for lead ${leadId}`);
            }
        } catch (refundBatchErr) {
            console.error('[AuctionClosure] Batch escrow refund error (non-blocking):', refundBatchErr);
        }

        // Escrow deferred to buyer's MetaMask (TD-01)
        const buyerWallet = winningBid.buyer?.walletAddress;

        if (io) {
            if (buyerWallet) {
                console.log(`[AuctionClosure] Escrow deferred to buyer's wallet — buyer=${buyerWallet.slice(0, 10)}, lead=${leadId}`);
                io.emit('lead:escrow-required', {
                    leadId,
                    buyerId: winningBid.buyerId,
                    buyerWallet,
                    amount: Number(winningBid.amount),
                });
            } else {
                console.warn(`[AuctionClosure] Buyer wallet missing — escrow must be created manually, lead=${leadId}`);
            }

            io.to(`auction_${leadId}`).emit('auction:resolved', {
                leadId,
                winnerId: winningBid.buyerId,
                winningAmount: Number(winningBid.amount),
                effectiveBid: Number(winningBid.effectiveBid ?? winningBid.amount),
                // BUG-09: include VRF provenance fields — undefined when no tie
                vrfRequestId: vrfRequestId ?? undefined,
                vrfPending: vrfRequestId ? true : undefined,
            });

            io.emit('lead:status-changed', {
                leadId,
                oldStatus: 'IN_AUCTION',
                newStatus: 'SOLD',
            });

            io.emit('analytics:update', {
                type: 'purchase',
                leadId,
                buyerId: winningBid.buyerId,
                amount: Number(winningBid.amount),
                vertical: lead.vertical || 'unknown',
                timestamp: new Date().toISOString(),
            });
        }

        // Log analytics
        await prisma.analyticsEvent.create({
            data: {
                eventType: 'auction_resolved',
                entityType: 'lead',
                entityId: leadId,
                metadata: {
                    winnerId: winningBid.buyerId,
                    amount: Number(winningBid.amount),
                },
            },
        });

        // Fire seller conversion tracking — non-blocking
        const fullLead = await prisma.lead.findUnique({
            where: { id: leadId },
            select: { sellerId: true, vertical: true, geo: true },
        });
        if (fullLead) {
            const geo = fullLead.geo as any;
            const convPayload: ConversionPayload = {
                event: 'lead_sold',
                lead_id: leadId,
                sale_amount: winAmount,
                platform_fee: fees.platformFee,
                vertical: fullLead.vertical,
                geo: geo ? `${geo.country || 'US'}-${geo.state || ''}` : 'US',
                quality_score: 0,
                transaction_id: '',
                sold_at: new Date().toISOString(),
            };
            fireConversionEvents(fullLead.sellerId, convPayload).catch(console.error);
        }
    } catch (error) {
        console.error('[AuctionClosure] Auction resolution error:', error);
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
