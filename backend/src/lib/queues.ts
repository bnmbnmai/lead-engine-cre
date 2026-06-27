import { Queue, Worker, QueueEvents } from 'bullmq';
import { redisClient } from './redis';
import { resolveExpiredAuctions, resolveStuckAuctions, resolveExpiredBuyNow } from '../services/auction-closure.service';
import { Server } from 'socket.io';
import { aceDevBus } from '../services/ace.service';
import { initSettlementRetryWorker, closeSettlementRetryQueue } from './settlement-retry.queue';
import { initSettlementSagaWorker, closeSettlementSagaQueue } from '../services/settlement-saga.service';
import { initAgentPipelineWorker, closeAgentPipelineQueue } from '../agents/orchestrator/queue';

const connection = redisClient;

// 1. Bid Queue
export const bidQueue = connection
    ? new Queue('bid-processing', { connection })
    : {
        add: async (name: string, data: any) => {
            console.warn('[BullMQ] Running in memory mode: bid-processing skipped to direct-call equivalent if implemented');
            return null;
        },
        close: async () => null
    };

// 2. Auction Monitor Queue
export const auctionQueue = connection
    ? new Queue('auction-monitor', { connection })
    : {
        add: async () => null,
        addBulk: async () => null,
        close: async () => null
    };

let auctionWorker: Worker | null = null;

export function initQueues(io: Server) {
    initSettlementRetryWorker();
    initSettlementSagaWorker(io);
    initAgentPipelineWorker();

    if (!connection) {
        console.warn('[BullMQ] REDIS_URL not set. Falling back to in-memory queues/intervals.');
        // Fallback setInterval (Legacy behavior)
        setInterval(async () => {
            try {
                await resolveExpiredAuctions(io);
                await resolveExpiredBuyNow(io);
                await resolveStuckAuctions(io);
            } catch (err) {
                console.error('In-memory Auction monitor error:', err);
            }
        }, 2000);
        return;
    }

    console.log('[BullMQ] Initializing queues and workers...');

    // Worker that processes auction closures
    auctionWorker = new Worker('auction-monitor', async (job: any) => {
        if (job.name === 'resolve-auctions') {
            await resolveExpiredAuctions(io);
            await resolveExpiredBuyNow(io);
            await resolveStuckAuctions(io);
        }
    }, {
        connection,
        concurrency: 1 // prevent race conditions
    });

    auctionWorker.on('completed', () => {
        // Silent success
    });

    auctionWorker.on('failed', (job: any, err: any) => {
        console.error(`[BullMQ] Auction monitor job failed: ${err.message}`);
        aceDevBus.emit('ace:dev-log', {
            type: 'ERROR',
            message: `BullMQ Worker Failed: ${err.message}`,
            timestamp: new Date().toISOString(),
            wallet: 'SYSTEM'
        });
    });

    // Schedule the repeatable job
    auctionQueue.add('resolve-auctions', {}, {
        repeat: { every: 2000 },
        jobId: 'singleton-auction-monitor'
    });

    // Reconciliation sweep (Phase D2) — every 5 minutes
    setInterval(async () => {
        try {
            const { runReconciliationSweep } = await import('../services/reconciliation.service');
            const r = await runReconciliationSweep();
            if (r.stuckSettling > 0 || r.stalledSagas > 0) {
                console.warn(`[Reconcile] stuckSettling=${r.stuckSettling} stalledSagas=${r.stalledSagas}`);
            }
        } catch (err: any) {
            console.error('[Reconcile] sweep failed:', err.message);
        }
    }, 5 * 60 * 1000);

    aceDevBus.emit('ace:dev-log', {
        type: 'INFO',
        message: 'BullMQ queues initialized for scalable background processing',
        timestamp: new Date().toISOString(),
        wallet: 'SYSTEM'
    });
}

// Graceful shutdown
export async function closeQueues() {
    if (auctionWorker) await auctionWorker.close();
    await closeSettlementRetryQueue();
    await closeSettlementSagaQueue();
    await closeAgentPipelineQueue();
    if (connection) {
        await auctionQueue.close();
        await bidQueue.close();
    }
}
