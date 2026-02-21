import crypto from 'crypto';

// ============================================
// Chainlink Data Producer — Custom Data Feed Stub
// ============================================
// Publishes anonymized, aggregated platform metrics back to the
// Chainlink ecosystem via CRE cron + chain write.
//
// Architecture (post-hackathon):
//   CRE Cron  →  HTTP fetch /api/metrics  →  ABI-encode  →  CustomLeadFeed.sol
//
// This follows the official Chainlink custom-data-feed template:
// https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/custom-data-feed
//
// ⚡ Ready for mainnet integration when CRE cron workflows are available.
//    Replace the stub push logic with the real CRE SDK workflow runner.
//
// PRIVACY: Only aggregated metrics are published — never PII, never
// individual lead data, never wallet addresses. All values are counts,
// averages, or totals that cannot be reversed to identify individuals.

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const MAX_STALENESS_SECONDS = 86400; // 1 day
const PUSH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Types ──

export interface PlatformMetrics {
    /** Average lead quality score across all verified leads (0–10000) */
    averageQualityScore: number;
    /** Total USDC volume settled through the platform (in cents, to avoid decimals) */
    totalVolumeSettledCents: number;
    /** Total number of leads tokenized as ERC-721 NFTs */
    totalLeadsTokenized: number;
    /** Auction fill rate — percentage of auctions that resulted in a sale (basis points 0–10000) */
    auctionFillRateBps: number;
    /** When these metrics were last computed (ISO string) */
    updatedAt: string;
    /** Whether the metrics are from a degraded fallback (DB failure) */
    degraded: boolean;
    /** Always true in stub mode */
    isStub: true;
}

export interface PushResult {
    /** Whether the on-chain push succeeded */
    success: boolean;
    /** Simulated transaction hash */
    txHash: string;
    /** Metrics that were pushed */
    metrics: PlatformMetrics;
    /** Total attempts including retries */
    attempts: number;
    /** Latency in ms */
    latencyMs: number;
    isStub: true;
}

// ── Last-known-good cache (fallback for DB failures) ──

let cachedMetrics: PlatformMetrics | null = null;

// ── Helpers ──

function roundToNearest(value: number, nearest: number): number {
    return Math.round(value / nearest) * nearest;
}

function simulateLatency(): Promise<number> {
    const ms = 50 + Math.random() * 200;
    return new Promise((resolve) => setTimeout(() => resolve(Math.round(ms)), ms));
}

// ── Core Functions ──

/**
 * Collect anonymized platform metrics from the database.
 *
 * In production, this queries Prisma for:
 *   - AVG(qualityScore) across all leads with status IN (SOLD, UNSOLD, IN_AUCTION)
 *   - SUM(amount) from Transaction table where status = 'COMPLETED'
 *   - COUNT(*) from Lead where winningBid IS NOT NULL (tokenized = purchased)
 *   - (SOLD count) / (total auctions) for fill rate
 *
 * Stub: returns deterministic metrics derived from current timestamp.
 *
 * PRIVACY NOTE: Only aggregated values are returned. No lead IDs,
 * wallet addresses, or PII fields are included in the output.
 */
export async function collectPlatformMetrics(): Promise<PlatformMetrics> {
    console.log('[DATA-FEED STUB] collectPlatformMetrics: aggregating anonymized platform data');

    try {
        // ── Stub: deterministic metrics from timestamp ──
        // In production, replace with Prisma queries:
        //
        // const avgScore = await prisma.lead.aggregate({
        //     _avg: { qualityScore: true },
        //     where: { status: { in: ['SOLD', 'UNSOLD', 'IN_AUCTION'] } },
        // });
        //
        // const totalSettled = await prisma.transaction.aggregate({
        //     _sum: { amount: true },
        //     where: { status: 'COMPLETED' },
        // });
        //
        // const totalTokenized = await prisma.lead.count({
        //     where: { winningBid: { not: null } },
        // });
        //
        // const totalAuctions = await prisma.auctionRoom.count();
        // const soldAuctions = await prisma.auctionRoom.count({
        //     where: { status: 'SETTLED' },
        // });

        const dayHash = crypto.createHash('md5')
            .update(`metrics:${Math.floor(Date.now() / PUSH_INTERVAL_MS)}`)
            .digest('hex');

        const rawScore = parseInt(dayHash.slice(0, 4), 16) % 4000 + 5500;
        const avgQualityScore = roundToNearest(rawScore, 10); // Round to nearest 10

        const metrics: PlatformMetrics = {
            averageQualityScore: avgQualityScore,
            totalVolumeSettledCents: parseInt(dayHash.slice(4, 10), 16) % 500000 + 100000,
            totalLeadsTokenized: parseInt(dayHash.slice(10, 14), 16) % 2000 + 500,
            auctionFillRateBps: parseInt(dayHash.slice(14, 16), 16) % 3000 + 6000, // 60-90%
            updatedAt: new Date().toISOString(),
            degraded: false,
            isStub: true,
        };

        // Cache for fallback
        cachedMetrics = metrics;

        console.log(`[DATA-FEED STUB] metrics: avgScore=${metrics.averageQualityScore} settled=$${(metrics.totalVolumeSettledCents / 100).toFixed(2)} tokenized=${metrics.totalLeadsTokenized} fillRate=${(metrics.auctionFillRateBps / 100).toFixed(1)}%`);
        return metrics;
    } catch (_err) {
        // DB failure → return last-known-good cache
        console.warn('[DATA-FEED STUB] DB query failed — returning cached metrics');

        if (cachedMetrics) {
            return { ...cachedMetrics, degraded: true, updatedAt: new Date().toISOString() };
        }

        // No cache available — return safe zeroes
        return {
            averageQualityScore: 0,
            totalVolumeSettledCents: 0,
            totalLeadsTokenized: 0,
            auctionFillRateBps: 0,
            updatedAt: new Date().toISOString(),
            degraded: true,
            isStub: true,
        };
    }
}

/**
 * Push platform metrics on-chain via CRE cron workflow.
 *
 * Production flow (per custom-data-feed template):
 *   1. CRE cron triggers this function daily
 *   2. HTTP-fetch our own /api/metrics endpoint (or call collectPlatformMetrics directly)
 *   3. ABI-encode: (uint256 avgScore, uint256 volumeCents, uint256 tokenized, uint256 fillRate)
 *   4. CRE chain-write → CustomLeadFeed.updateMetrics(avgScore, volumeCents, tokenized, fillRate)
 *
 * Stub: simulates the push with retry logic.
 *
 * @see https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/custom-data-feed
 *
 * TODO: Replace with real CRE SDK workflow runner:
 * ```typescript
 * import { CREWorkflowRunner } from '@chainlink/cre-sdk';
 *
 * const runner = new CREWorkflowRunner({
 *     nodeUrl: process.env.CRE_NODE_URL,
 *     subscriptionId: process.env.CRE_SUBSCRIPTION_ID,
 * });
 *
 * await runner.execute({
 *     trigger: 'cron',
 *     schedule: '0 0 * * *', // Daily at midnight UTC
 *     actions: [
 *         { type: 'http_fetch', url: `${process.env.API_URL}/api/metrics` },
 *         { type: 'abi_encode', schema: '(uint256,uint256,uint256,uint256)' },
 *         { type: 'chain_write', contract: CUSTOM_LEAD_FEED_ADDRESS, method: 'updateMetrics' },
 *     ],
 * });
 * ```
 */
export async function pushLeadMetrics(): Promise<PushResult> {
    console.log('[DATA-FEED STUB] pushLeadMetrics: starting daily push cycle');

    const startTime = Date.now();
    const metrics = await collectPlatformMetrics();

    // Staleness check
    const metricsAge = (Date.now() - new Date(metrics.updatedAt).getTime()) / 1000;
    if (metricsAge > MAX_STALENESS_SECONDS) {
        console.warn(`[DATA-FEED STUB] Metrics are ${metricsAge.toFixed(0)}s old (max ${MAX_STALENESS_SECONDS}s) — pushing anyway with warning`);
    }

    // Retry loop with exponential backoff
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[DATA-FEED STUB] Push attempt ${attempt}/${MAX_RETRIES}`);

            const latency = await simulateLatency();

            // Simulate ABI encoding (what would happen in production)
            // ethers.AbiCoder.defaultAbiCoder().encode(
            //     ['uint256', 'uint256', 'uint256', 'uint256'],
            //     [metrics.averageQualityScore, metrics.totalVolumeSettledCents,
            //      metrics.totalLeadsTokenized, metrics.auctionFillRateBps]
            // );

            // Simulate success (~90% of the time)
            const pushHash = crypto.createHash('sha256')
                .update(`push:${attempt}:${metrics.updatedAt}:${Date.now()}`)
                .digest('hex');

            const simulatedSuccess = parseInt(pushHash.slice(0, 2), 16) > 25; // ~90%

            if (!simulatedSuccess) {
                throw new Error(`SIMULATED_TX_REVERT (attempt ${attempt})`);
            }

            const txHash = `0x${pushHash.slice(0, 64)}`;
            console.log(`[DATA-FEED STUB] Push succeeded: tx=${txHash.slice(0, 18)}… latency=${latency}ms`);

            return {
                success: true,
                txHash,
                metrics,
                attempts: attempt,
                latencyMs: Date.now() - startTime,
                isStub: true,
            };
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.warn(`[DATA-FEED STUB] Push attempt ${attempt} failed: ${lastError.message}`);

            if (attempt < MAX_RETRIES) {
                const backoffMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);
                console.log(`[DATA-FEED STUB] Retrying in ${backoffMs}ms…`);
                await new Promise((r) => setTimeout(r, backoffMs));
            }
        }
    }

    // All retries exhausted
    console.error(`[DATA-FEED STUB] All ${MAX_RETRIES} push attempts failed — skipping this cycle`);

    return {
        success: false,
        txHash: '',
        metrics,
        attempts: MAX_RETRIES,
        latencyMs: Date.now() - startTime,
        isStub: true,
    };
}

/**
 * Schedule a daily metric push (stub: logs intent, no real cron).
 *
 * In production, this would be replaced by a CRE cron trigger
 * configured in the workflow YAML — no application-level scheduling needed.
 *
 * For demo purposes, calling this sets a 24h interval that logs
 * what *would* happen each cycle.
 */
export function scheduleDailyPush(): NodeJS.Timeout {
    console.log('[DATA-FEED STUB] scheduleDailyPush: registering daily push (stub — logs only)');
    console.log(`[DATA-FEED STUB] Next push at: ${new Date(Date.now() + PUSH_INTERVAL_MS).toISOString()}`);
    console.log('[DATA-FEED STUB] In production, replace with CRE cron workflow:');
    console.log('[DATA-FEED STUB]   trigger: cron | schedule: "0 0 * * *" | action: chain_write');

    // In production, this interval is not needed — CRE cron handles scheduling.
    // This exists only for demo/hackathon so the stub can be exercised.
    const timer = setInterval(async () => {
        console.log('[DATA-FEED STUB] Daily push cycle triggered');
        const result = await pushLeadMetrics();
        console.log(`[DATA-FEED STUB] Daily push result: success=${result.success} attempts=${result.attempts}`);
    }, PUSH_INTERVAL_MS);

    // Don't block process exit
    timer.unref();

    return timer;
}
