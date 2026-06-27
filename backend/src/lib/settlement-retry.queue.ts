/**
 * Settlement retry queue (Phase A4)
 * ----------------------------------
 * On-chain settle/refund operations that fail during auction closure used to
 * be log-and-drop, leaving orphaned vault locks. This module gives them a
 * durable BullMQ queue with exponential backoff; jobs that exhaust their
 * attempts land in a dead-letter queue (DLQ) for manual reconciliation.
 *
 * Without Redis it degrades to a bounded in-process retry (best effort).
 */
import { Queue, Worker } from 'bullmq';
import { redisClient } from './redis';
import { aceDevBus } from '../services/ace.service';

const connection = redisClient;

export type SettlementJob =
    | {
        kind: 'settle';
        lockId: number;
        sellerWallet: string;
        buyerId: string;
        leadId: string;
    }
    | {
        kind: 'refund';
        lockId: number;
        buyerId: string;
        leadId: string;
        bidId?: string;
    };

const QUEUE_NAME = 'settlement-retry';
const DLQ_NAME = 'settlement-dlq';
const MAX_ATTEMPTS = 5;

export const settlementRetryQueue = connection ? new Queue<SettlementJob>(QUEUE_NAME, { connection }) : null;
export const settlementDlq = connection ? new Queue<SettlementJob>(DLQ_NAME, { connection }) : null;

let retryWorker: Worker | null = null;

async function processJob(job: SettlementJob): Promise<void> {
    const vaultService = await import('../services/vault.service');

    if (job.kind === 'settle') {
        const result = await vaultService.settleBid(job.lockId, job.sellerWallet, job.buyerId, job.leadId);
        if (!result.success) {
            throw new Error(`settleBid(lockId=${job.lockId}) failed: ${result.error}`);
        }
        console.log(`[SettlementRetry] settle succeeded on retry — lockId=${job.lockId}, txHash=${result.txHash}`);
        return;
    }

    const result = await vaultService.refundBid(job.lockId, job.buyerId, job.leadId);
    if (!result.success) {
        throw new Error(`refundBid(lockId=${job.lockId}) failed: ${result.error}`);
    }
    console.log(`[SettlementRetry] refund succeeded on retry — lockId=${job.lockId}, txHash=${result.txHash}`);

    if (job.bidId) {
        const { prisma } = await import('./prisma');
        await prisma.bid.update({
            where: { id: job.bidId },
            data: { escrowRefunded: true },
        }).catch((err: any) => {
            console.error(`[SettlementRetry] refund succeeded but DB flag update failed for bid ${job.bidId}: ${err.message}`);
        });
    }
}

/**
 * Enqueue a failed settle/refund for durable retry with exponential backoff.
 * jobId is derived from the operation so re-enqueues are idempotent.
 */
export async function enqueueSettlementRetry(job: SettlementJob): Promise<void> {
    const jobId = `${job.kind}:${job.lockId}:${job.leadId}`;

    if (settlementRetryQueue) {
        await settlementRetryQueue.add(job.kind, job, {
            jobId,
            attempts: MAX_ATTEMPTS,
            backoff: { type: 'exponential', delay: 5_000 }, // 5s, 10s, 20s, 40s, 80s
            removeOnComplete: true,
            removeOnFail: false, // kept for inspection; also copied to DLQ
        });
        console.warn(`[SettlementRetry] enqueued ${jobId} for retry (max ${MAX_ATTEMPTS} attempts)`);
        return;
    }

    // No Redis: bounded in-process retry so dev environments still recover.
    console.warn(`[SettlementRetry] Redis unavailable — falling back to in-process retry for ${jobId}`);
    let attempt = 0;
    const tryOnce = async () => {
        attempt += 1;
        try {
            await processJob(job);
        } catch (err: any) {
            if (attempt >= MAX_ATTEMPTS) {
                console.error(`[SettlementRetry] DLQ(no-redis): ${jobId} exhausted ${MAX_ATTEMPTS} attempts: ${err.message} — NEEDS MANUAL RECONCILIATION`);
                return;
            }
            setTimeout(tryOnce, 5_000 * 2 ** (attempt - 1));
        }
    };
    setTimeout(tryOnce, 5_000);
}

export function initSettlementRetryWorker(): void {
    if (!connection || retryWorker) return;

    retryWorker = new Worker<SettlementJob>(QUEUE_NAME, async (job) => {
        await processJob(job.data);
    }, { connection, concurrency: 2 });

    retryWorker.on('failed', async (job, err) => {
        if (!job) return;
        const exhausted = job.attemptsMade >= (job.opts.attempts ?? MAX_ATTEMPTS);
        console.error(`[SettlementRetry] attempt ${job.attemptsMade}/${job.opts.attempts} failed for ${job.id}: ${err.message}`);

        if (exhausted && settlementDlq) {
            await settlementDlq.add('dead-letter', job.data, { jobId: `dlq:${job.id}` }).catch(() => { });
            console.error(`[SettlementRetry] DLQ: ${job.id} exhausted all attempts — NEEDS MANUAL RECONCILIATION`);
            aceDevBus.emit('ace:dev-log', {
                type: 'ERROR',
                message: `Settlement DLQ: ${job.id} exhausted retries (${err.message})`,
                timestamp: new Date().toISOString(),
                wallet: 'SYSTEM',
            });
        }
    });

    console.log('[SettlementRetry] worker initialized (exponential backoff + DLQ)');
}

export async function closeSettlementRetryQueue(): Promise<void> {
    if (retryWorker) await retryWorker.close();
    if (settlementRetryQueue) await settlementRetryQueue.close();
    if (settlementDlq) await settlementDlq.close();
}
