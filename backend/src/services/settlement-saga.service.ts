/**
 * Settlement Saga (Phase B3 — outbox pattern)
 * --------------------------------------------
 * Auction closure used to mark the lead SOLD and then fire chain calls
 * inline (fire-and-forget). A crash between the DB write and the chain
 * settlement left funds in limbo with no durable record of what remained
 * to be done.
 *
 * Now the closure transaction writes an outbox row (SettlementSaga) and
 * moves the lead to SETTLING. This module executes the saga steps:
 *
 *   1. vaultSettle   — on-chain settle of the winner's vault lock
 *   2. loserRefunds  — on-chain refunds of losing bids' locks
 *   3. nftMint       — LeadNFT mint + recordSale + CRE score dispatch
 *   4. finalize      — lead SETTLING → SOLD, socket events, bounties,
 *                      analytics, conversion tracking
 *
 * Per-step status is persisted on the saga row so retries resume where
 * they left off. A terminal vaultSettle failure triggers compensation:
 * the winner's lock is refunded and the lead reverts to UNSOLD (Buy It
 * Now). If compensation itself fails, the saga is marked FAILED and the
 * refund goes to the settlement DLQ for manual reconciliation.
 */

import { Server } from 'socket.io';
import { Queue, Worker } from 'bullmq';
import { prisma } from '../lib/prisma';
import { redisClient } from '../lib/redis';
import { calculateFees, type BidSourceType } from '../lib/fees';
import { enqueueSettlementRetry } from '../lib/settlement-retry.queue';
import { fireConversionEvents, ConversionPayload } from './conversion-tracking.service';
import { bountyService } from './bounty.service';
import { aceDevBus } from './ace.service';
import * as vaultService from './vault.service';
import { nftService } from './nft.service';
import { creService } from './cre.service';

// ── Types ────────────────────────────────────

type StepStatus = 'PENDING' | 'DONE' | 'SKIPPED' | 'FAILED';

interface SagaSteps {
    vaultSettle?: StepStatus;
    loserRefunds?: StepStatus;
    nftMint?: StepStatus;
    finalize?: StepStatus;
}

/** Thrown by a step to indicate a retryable failure. */
class StepError extends Error {
    constructor(public step: keyof SagaSteps, message: string) {
        super(`[${step}] ${message}`);
    }
}

const MAX_SAGA_ATTEMPTS = Number(process.env.SETTLEMENT_SAGA_MAX_ATTEMPTS || 5);
const SAGA_QUEUE_NAME = 'settlement-saga';

// ── Queue / worker ───────────────────────────

const connection = redisClient;
export const settlementSagaQueue = connection
    ? new Queue<{ leadId: string }>(SAGA_QUEUE_NAME, { connection })
    : null;

let sagaWorker: Worker | null = null;
let sagaIo: Server | undefined;

export function initSettlementSagaWorker(io?: Server): void {
    sagaIo = io;
    if (!connection || sagaWorker) return;

    sagaWorker = new Worker<{ leadId: string }>(SAGA_QUEUE_NAME, async (job) => {
        await runSettlementSaga(job.data.leadId, sagaIo);
    }, { connection, concurrency: 2 });

    sagaWorker.on('failed', (job, err) => {
        console.error(`[SettlementSaga] queued run failed for ${job?.data?.leadId}: ${err.message}`);
    });

    console.log('[SettlementSaga] worker initialized');
}

export async function closeSettlementSagaQueue(): Promise<void> {
    if (sagaWorker) await sagaWorker.close();
    if (settlementSagaQueue) await settlementSagaQueue.close();
}

async function scheduleRetry(leadId: string, attempt: number): Promise<void> {
    const delay = 5_000 * 2 ** Math.min(attempt - 1, 5); // 5s, 10s, 20s, 40s, 80s, 160s cap
    if (settlementSagaQueue) {
        await settlementSagaQueue.add('run', { leadId }, {
            jobId: `saga:${leadId}:${attempt}`,
            delay,
            removeOnComplete: true,
            removeOnFail: true,
        });
        console.warn(`[SettlementSaga] ${leadId}: retry #${attempt} scheduled in ${delay / 1000}s`);
        return;
    }
    // No Redis — bounded in-process retry so dev environments still recover.
    setTimeout(() => {
        runSettlementSaga(leadId, sagaIo).catch((err) =>
            console.error(`[SettlementSaga] in-process retry failed for ${leadId}: ${err.message}`));
    }, delay);
}

// ── Saga runner ──────────────────────────────

/**
 * Execute (or resume) the settlement saga for a lead.
 * Idempotent: completed steps are skipped on re-runs; concurrent runs are
 * serialized by the RUNNING-state CAS below.
 */
export async function runSettlementSaga(leadId: string, io?: Server): Promise<void> {
    const saga = await prisma.settlementSaga.findUnique({ where: { leadId } });
    if (!saga) {
        console.error(`[SettlementSaga] no saga row for lead ${leadId}`);
        return;
    }
    if (saga.state === 'COMPLETED' || saga.state === 'COMPENSATED' || saga.state === 'FAILED') {
        return; // terminal
    }

    // CAS into RUNNING so concurrent workers don't double-execute. A stalled
    // RUNNING saga (crashed worker) is recovered by recoverStalledSagas().
    const claimed = await prisma.settlementSaga.updateMany({
        where: { id: saga.id, state: { in: ['PENDING', 'RUNNING'] }, attempts: saga.attempts },
        data: { state: 'RUNNING', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
        console.log(`[SettlementSaga] ${leadId}: another worker claimed this saga — skipping`);
        return;
    }
    const attempt = saga.attempts + 1;
    const steps: SagaSteps = (saga.steps as SagaSteps) || {};

    // Load the world (fresh on every attempt)
    const [lead, winningBid] = await Promise.all([
        prisma.lead.findUnique({
            where: { id: leadId },
            select: {
                id: true, vertical: true, reservePrice: true, qualityScore: true,
                geo: true, parameters: true, createdAt: true, sellerId: true,
                seller: { select: { user: { select: { walletAddress: true } } } },
            },
        }),
        prisma.bid.findUnique({
            where: { id: saga.winningBidId },
            include: { buyer: true },
        }),
    ]);
    if (!lead || !winningBid) {
        await persistSaga(saga.id, steps, 'FAILED', `lead or winning bid missing (lead=${!!lead}, bid=${!!winningBid})`);
        return;
    }

    const winAmount = Number(winningBid.amount);
    const sellerWallet = lead.seller?.user?.walletAddress || '';

    try {
        // ── Step 1: vaultSettle ──
        if (steps.vaultSettle !== 'DONE' && steps.vaultSettle !== 'SKIPPED') {
            const escrowRef = winningBid.escrowTxHash || '';
            const lockId = escrowRef.startsWith('vaultLock:') ? parseInt(escrowRef.split(':')[1], 10) : 0;

            if (lockId > 0 && sellerWallet) {
                const result = await vaultService.settleBid(lockId, sellerWallet, winningBid.buyerId, leadId);
                if (!result.success) {
                    throw new StepError('vaultSettle', result.error || 'settleBid failed');
                }
                console.log(`[SettlementSaga] ${leadId}: vault settled — lockId=${lockId}, txHash=${result.txHash}`);
                aceDevBus.emit('ace:dev-log', {
                    ts: new Date().toISOString(),
                    action: 'vault:settle-winner',
                    leadId, buyerId: winningBid.buyerId, lockId,
                    txHash: result.txHash, amount: winAmount,
                });
                steps.vaultSettle = 'DONE';
            } else {
                steps.vaultSettle = 'SKIPPED'; // no on-chain lock (demo/legacy bid) or no seller wallet
            }
            await persistSaga(saga.id, steps, 'RUNNING');
        }

        // ── Step 2: loserRefunds ──
        // Individual refund failures are routed to the durable settlement-retry
        // queue (their own backoff + DLQ) so they never block the saga.
        if (steps.loserRefunds !== 'DONE') {
            await refundLosers(leadId);
            steps.loserRefunds = 'DONE';
            await persistSaga(saga.id, steps, 'RUNNING');
        }

        // ── Step 3: nftMint ──
        // Non-critical: a mint failure schedules its own retry (BUG-08 path)
        // and must not hold the auction outcome hostage.
        if (steps.nftMint !== 'DONE') {
            await mintNft(leadId, winningBid, winAmount);
            steps.nftMint = 'DONE';
            await persistSaga(saga.id, steps, 'RUNNING');
        }

        // ── Step 4: finalize ──
        if (steps.finalize !== 'DONE') {
            await finalize(leadId, lead, winningBid, winAmount, io ?? sagaIo);
            steps.finalize = 'DONE';
        }

        await persistSaga(saga.id, steps, 'COMPLETED');
        console.log(`[SettlementSaga] ${leadId}: saga COMPLETED (attempt ${attempt})`);
    } catch (err: any) {
        const failedStep: keyof SagaSteps = err instanceof StepError ? err.step : 'finalize';
        steps[failedStep] = 'FAILED';
        console.error(`[SettlementSaga] ${leadId}: attempt ${attempt}/${MAX_SAGA_ATTEMPTS} failed at ${failedStep}: ${err.message}`);

        if (attempt >= MAX_SAGA_ATTEMPTS) {
            await compensate(saga.id, leadId, lead, winningBid, steps, io ?? sagaIo, err.message);
            return;
        }

        await persistSaga(saga.id, steps, 'RUNNING', err.message);
        await scheduleRetry(leadId, attempt);
    }
}

async function persistSaga(sagaId: string, steps: SagaSteps, state: 'RUNNING' | 'COMPLETED' | 'COMPENSATED' | 'FAILED', lastError?: string) {
    await prisma.settlementSaga.update({
        where: { id: sagaId },
        data: { steps: steps as object, state, ...(lastError !== undefined ? { lastError } : {}) },
    });
}

// ── Steps ────────────────────────────────────

async function refundLosers(leadId: string): Promise<void> {
    const loserBids = await prisma.bid.findMany({
        where: { leadId, status: 'OUTBID', amount: { not: null }, escrowRefunded: false },
    });

    for (const loserBid of loserBids) {
        try {
            const escrowRef = loserBid.escrowTxHash || '';
            let onChainRefunded = false;

            if (escrowRef.startsWith('vaultLock:')) {
                const lockId = parseInt(escrowRef.split(':')[1], 10);
                if (lockId > 0) {
                    const refundResult = await vaultService.refundBid(lockId, loserBid.buyerId, leadId);
                    onChainRefunded = refundResult.success;
                    if (!refundResult.success) {
                        console.error(`[SettlementSaga] refund failed for lockId=${lockId}: ${refundResult.error} — enqueuing retry`);
                        await enqueueSettlementRetry({
                            kind: 'refund', lockId,
                            buyerId: loserBid.buyerId, leadId, bidId: loserBid.id,
                        });
                    }
                }
            } else {
                onChainRefunded = true; // no vault lock — legacy bid: just mark DB
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
                leadId, bidId: loserBid.id, buyerId: loserBid.buyerId,
                vaultRefund: escrowRef.startsWith('vaultLock:') ? (onChainRefunded ? 'on-chain' : 'failed') : 'n/a',
            });
        } catch (refundErr: any) {
            console.error(`[SettlementSaga] escrow refund error for bid ${loserBid.id}: ${refundErr.message}`);
        }
    }

    if (loserBids.length > 0) {
        console.log(`[SettlementSaga] ${leadId}: processed ${loserBids.length} loser refunds`);
    }
}

async function mintNft(leadId: string, winningBid: any, winAmount: number): Promise<void> {
    try {
        const mintResult = await nftService.mintLeadNFT(leadId);
        if (mintResult.success && mintResult.tokenId) {
            console.log(`[SettlementSaga] ${leadId}: LeadNFT minted — tokenId=${mintResult.tokenId}, txHash=${mintResult.txHash}`);
            aceDevBus.emit('ace:dev-log', {
                ts: new Date().toISOString(),
                action: 'nft:mint:success',
                leadId, tokenId: mintResult.tokenId, txHash: mintResult.txHash,
            });

            const buyerWallet = winningBid.buyer?.walletAddress;
            if (buyerWallet) {
                const saleResult = await nftService.recordSaleOnChain(mintResult.tokenId, buyerWallet, winAmount);
                if (!saleResult.success) {
                    console.warn(`[SettlementSaga] recordSaleOnChain failed: ${saleResult.error}`);
                }
            }

            // Dispatch CRE quality score request (non-blocking)
            if (process.env.USE_BATCHED_PRIVATE_SCORE !== 'true') {
                creService.requestOnChainQualityScore(leadId, Number(mintResult.tokenId), leadId)
                    .then((r) => {
                        if (!r.submitted) console.warn(`[SettlementSaga] CRE skipped/failed: ${r.error}`);
                    })
                    .catch((err) => console.warn(`[SettlementSaga] CRE threw: ${err.message}`));
            }
        } else {
            // BUG-08: flag + dedicated mint-retry path; never blocks the saga
            console.warn(`[SettlementSaga] NFT mint failed (non-fatal): ${mintResult.error}`);
            await nftService.scheduleMintRetry(leadId, mintResult.error || 'unknown mint error');
        }
    } catch (mintErr: any) {
        console.error(`[SettlementSaga] NFT mint error (non-blocking): ${mintErr.message}`);
    }
}

async function finalize(leadId: string, lead: any, winningBid: any, winAmount: number, io?: Server): Promise<void> {
    // CAS: SETTLING → SOLD. count===0 means another run already finalized.
    const finalized = await prisma.lead.updateMany({
        where: { id: leadId, status: 'SETTLING' },
        data: { status: 'SOLD', winningBid: winningBid.amount, soldAt: new Date() },
    });
    if (finalized.count === 0) {
        console.log(`[SettlementSaga] ${leadId}: already finalized elsewhere`);
        return;
    }

    // Phase C3: record settlement attestation for agent reputation
    try {
        const { recordAgentSettlementAttestation } = await import('./agent-trace.service');
        await recordAgentSettlementAttestation(winningBid.buyerId, true);
    } catch { /* non-blocking */ }

    const fees = calculateFees(winAmount, (winningBid.source || 'MANUAL') as BidSourceType);
    const room = await prisma.auctionRoom.findUnique({ where: { leadId }, select: { vrfRequestId: true } });
    const vrfRequestId = room?.vrfRequestId ?? undefined;

    // ── Socket emissions (identical payloads to the pre-saga closure path) ──
    if (io) {
        const buyerWallet = winningBid.buyer?.walletAddress;
        if (buyerWallet) {
            io.emit('lead:escrow-required', {
                leadId,
                buyerId: winningBid.buyerId,
                buyerWallet,
                amount: Number(winningBid.amount),
            });
        }

        io.to(`auction_${leadId}`).emit('auction:resolved', {
            leadId,
            winnerId: winningBid.buyerId,
            winningAmount: Number(winningBid.amount),
            effectiveBid: Number(winningBid.effectiveBid ?? winningBid.amount),
            vrfRequestId,
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

        // SEALED-BID: losing bidders' identities and amounts are NEVER
        // broadcast — only the public outcome (winner + clearing price).
        const settleTxHash = winningBid.escrowTxHash ?? undefined;
        const totalBids = await prisma.bid.count({ where: { leadId } });
        io.emit('auction:closed', {
            leadId,
            status: 'SOLD',
            winnerId: winningBid.buyerId,
            winningAmount: Number(winningBid.amount),
            settleTxHash,
            bidCount: totalBids,
            remainingTime: 0,
            isClosed: true,
            serverTs: Date.now(),
        });
        console.log(`[AUCTION-CLOSED] leadId=${leadId} winner=${winningBid.buyerId} amount=${Number(winningBid.amount)} tx=${settleTxHash ?? '—'}`);
    }

    // ── Bounty release (non-blocking) ──
    try {
        const sellerWallet = lead.seller?.user?.walletAddress || '';
        if (sellerWallet && lead.vertical) {
            const geo = lead.geo || {};
            const matched = await bountyService.matchBounties(
                {
                    id: lead.id,
                    vertical: lead.vertical,
                    qualityScore: lead.qualityScore,
                    state: geo.state || null,
                    country: geo.country || null,
                    parameters: lead.parameters,
                    createdAt: lead.createdAt,
                    reservePrice: lead.reservePrice ? Number(lead.reservePrice) : null,
                },
                winAmount,
            );

            for (const bounty of matched) {
                const releaseResult = await bountyService.releaseBounty(
                    bounty.poolId, leadId, sellerWallet, bounty.amount, bounty.verticalSlug,
                );
                if (releaseResult.success && io) {
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
    } catch (bountyErr) {
        console.error('[SettlementSaga] bounty release error (non-blocking):', bountyErr);
    }

    // ── Analytics + conversion tracking ──
    await prisma.analyticsEvent.create({
        data: {
            eventType: 'auction_resolved',
            entityType: 'lead',
            entityId: leadId,
            metadata: { winnerId: winningBid.buyerId, amount: Number(winningBid.amount) },
        },
    }).catch((err) => console.warn(`[SettlementSaga] analytics write failed: ${err.message}`));

    const geo = lead.geo as any;
    const convPayload: ConversionPayload = {
        event: 'lead_sold',
        lead_id: leadId,
        sale_amount: winAmount,
        platform_fee: fees.platformFee,
        vertical: lead.vertical,
        geo: geo ? `${geo.country || 'US'}-${geo.state || ''}` : 'US',
        quality_score: 0,
        transaction_id: '',
        sold_at: new Date().toISOString(),
    };
    fireConversionEvents(lead.sellerId, convPayload).catch(console.error);
}

// ── Compensation ─────────────────────────────

/**
 * Terminal vaultSettle failure: refund the winner's lock and revert the
 * lead to UNSOLD (Buy It Now) so it can be re-sold. The winner was never
 * announced (finalize never ran), so this is invisible to other clients.
 */
async function compensate(
    sagaId: string,
    leadId: string,
    lead: any,
    winningBid: any,
    steps: SagaSteps,
    io: Server | undefined,
    reason: string,
): Promise<void> {
    console.error(`[SettlementSaga] ${leadId}: COMPENSATING after terminal failure: ${reason}`);

    // 1. Refund the winner's vault lock (when settle never landed)
    const escrowRef = winningBid.escrowTxHash || '';
    const lockId = escrowRef.startsWith('vaultLock:') ? parseInt(escrowRef.split(':')[1], 10) : 0;
    if (lockId > 0 && steps.vaultSettle !== 'DONE') {
        const refund = await vaultService.refundBid(lockId, winningBid.buyerId, leadId);
        if (!refund.success) {
            // Compensation failed → FAILED + DLQ; reconciliation job picks it up
            await persistSaga(sagaId, steps, 'FAILED', `compensation refund failed: ${refund.error} (original: ${reason})`);
            await enqueueSettlementRetry({
                kind: 'refund', lockId,
                buyerId: winningBid.buyerId, leadId, bidId: winningBid.id,
            });
            aceDevBus.emit('ace:dev-log', {
                ts: new Date().toISOString(),
                action: 'saga:failed',
                leadId, lockId,
                error: `settle AND compensation refund failed — manual reconciliation required`,
            });
            return;
        }
    }

    // 2. Revert DB state: winner bid expired, transaction failed, lead → UNSOLD
    const reservePrice = lead.reservePrice ? Number(lead.reservePrice) : null;
    const binPrice = reservePrice ? reservePrice * 1.2 : null;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
        prisma.bid.update({
            where: { id: winningBid.id },
            data: { status: 'EXPIRED', escrowRefunded: lockId > 0, processedAt: new Date() },
        }),
        prisma.transaction.updateMany({
            where: { leadId, buyerId: winningBid.buyerId, status: 'PENDING' },
            data: { status: 'FAILED' },
        }),
        prisma.lead.updateMany({
            where: { id: leadId, status: 'SETTLING' },
            data: { status: 'UNSOLD', winningBid: null, buyNowPrice: binPrice, expiresAt },
        }),
        prisma.auctionRoom.updateMany({
            where: { leadId },
            data: { phase: 'CANCELLED' },
        }),
    ]);

    await persistSaga(sagaId, steps, 'COMPENSATED', reason);

    if (io) {
        io.to(`auction_${leadId}`).emit('lead:unsold', {
            leadId, buyNowPrice: binPrice, expiresAt: expiresAt.toISOString(),
        });
        io.emit('lead:status-changed', {
            leadId, oldStatus: 'IN_AUCTION', newStatus: 'UNSOLD',
            buyNowPrice: binPrice, expiresAt: expiresAt.toISOString(),
        });
        io.emit('auction:closed', {
            leadId, status: 'UNSOLD', remainingTime: 0, isClosed: true, serverTs: Date.now(),
        });
    }

    aceDevBus.emit('ace:dev-log', {
        ts: new Date().toISOString(),
        action: 'saga:compensated',
        leadId, buyerId: winningBid.buyerId, lockId,
        reason,
    });
    console.warn(`[SettlementSaga] ${leadId}: COMPENSATED — winner refunded, lead reverted to UNSOLD`);
}

// ── Recovery sweep ───────────────────────────

/**
 * Re-run sagas stranded in PENDING/RUNNING (worker crash, missed retry).
 * Called from the resolveStuckAuctions sweep.
 */
export async function recoverStalledSagas(io?: Server): Promise<number> {
    const staleCutoff = new Date(Date.now() - 2 * 60 * 1000); // 2 min without progress
    const stalled = await prisma.settlementSaga.findMany({
        where: {
            state: { in: ['PENDING', 'RUNNING'] },
            updatedAt: { lte: staleCutoff },
        },
        select: { leadId: true },
        take: 20,
    });

    for (const saga of stalled) {
        console.warn(`[SettlementSaga] recovering stalled saga for lead ${saga.leadId}`);
        await runSettlementSaga(saga.leadId, io ?? sagaIo).catch((err) =>
            console.error(`[SettlementSaga] recovery run failed for ${saga.leadId}: ${err.message}`));
    }

    return stalled.length;
}
