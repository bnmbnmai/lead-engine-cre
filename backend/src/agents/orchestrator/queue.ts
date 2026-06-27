/**
 * Agent pipeline BullMQ worker (Phase C2).
 */

import { Queue, Worker } from 'bullmq';
import { redisClient } from '../../lib/redis';
import type { PipelineInput } from './types';
import { runAgentPipeline } from './pipeline';

const QUEUE_NAME = 'agent-pipeline';

let queue: Queue | null = null;
let worker: Worker | null = null;

export function getAgentPipelineQueue(): Queue | null {
    if (!redisClient) return null;
    if (!queue) {
        queue = new Queue(QUEUE_NAME, { connection: redisClient });
    }
    return queue;
}

/** Enqueue a lead for the multi-agent pipeline. */
export async function enqueueAgentPipeline(input: PipelineInput): Promise<void> {
    const q = getAgentPipelineQueue();
    if (!q) {
        // No Redis — run inline (dev / single-instance)
        await runAgentPipeline(input);
        return;
    }
    await q.add('run', input, {
        jobId: `agent-pipeline-${input.leadId}`,
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
    });
}

export function initAgentPipelineWorker(): void {
    if (!redisClient || worker) return;

    worker = new Worker(
        QUEUE_NAME,
        async (job) => {
            if (job.name !== 'run') return;
            return await runAgentPipeline(job.data as PipelineInput);
        },
        { connection: redisClient, concurrency: 2 },
    );

    worker.on('failed', (job, err) => {
        console.error(`[AgentPipeline] job ${job?.id} failed: ${err.message}`);
    });

    console.log('[AgentPipeline] Worker initialized');
}

export async function closeAgentPipelineQueue(): Promise<void> {
    if (worker) await worker.close();
    if (queue) await queue.close();
}
