import { Queue, Worker, QueueEvents } from 'bullmq';
import { redisClient } from './redis';
import { resolveExpiredAuctions, resolveStuckAuctions, resolveExpiredBuyNow } from '../services/auction-closure.service';
import { Server } from 'socket.io';
import { aceDevBus } from '../services/ace.service';

const connection = redisClient;

// 1. Bid Queue
export const bidQueue = connection
    ? new Queue('bid-processing', { connection })
    : {
        add: async (name: string, data: any) => {
            console.warn('[BullMQ] Running in memory mode: bid-processing skipped to direct-call equivalent if implemented');
            return null;
        }
    };

// 2. Auction Monitor Queue
export const auctionQueue = connection
    ? new Queue('auction-monitor', { connection })
    : {
        add: async () => null,
        addBulk: async () => null
    };

let auctionWorker: Worker | null = null;

export function initQueues(io: Server) {
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
    auctionWorker = new Worker('auction-monitor', async (job) => {
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

    auctionWorker.on('failed', (job, err) => {
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
    if (connection) {
        // @ts-ignore
        await auctionQueue.close();
        // @ts-ignore
        await bidQueue.close();
    }
}
