// ============================================
// Chainlink Data Streams Service — STUB
// ============================================
// Low-latency, pull-based price/market data for real-time global bids.
// When access is granted, swap stub for real Data Streams SDK.

const STREAM_LATENCY_P50 = 20;
const STREAM_LATENCY_P95 = 80;

interface BidFloorResult {
    vertical: string;
    country: string;
    bidFloor: number;       // USDC
    bidCeiling: number;     // USDC
    confidence: number;     // 0–1
    timestamp: string;
    latencyMs: number;
    isStub: true;
    stale: boolean;
}

interface PriceIndexResult {
    vertical: string;
    indexValue: number;     // Normalized 0–1000
    change24h: number;      // Percentage
    volume24h: number;      // USDC
    timestamp: string;
    isStub: true;
}

type PriceFeedCallback = (data: BidFloorResult) => void;

// ── Market data tables (mock) ──

const BASE_PRICES: Record<string, Record<string, { floor: number; ceiling: number }>> = {
    solar: { US: { floor: 85, ceiling: 200 }, CA: { floor: 70, ceiling: 160 }, GB: { floor: 55, ceiling: 130 }, DE: { floor: 60, ceiling: 140 }, AU: { floor: 75, ceiling: 170 } },
    mortgage: { US: { floor: 25, ceiling: 80 }, CA: { floor: 20, ceiling: 65 }, GB: { floor: 18, ceiling: 55 }, DE: { floor: 15, ceiling: 50 }, AU: { floor: 22, ceiling: 60 } },
    roofing: { US: { floor: 40, ceiling: 120 }, CA: { floor: 35, ceiling: 100 }, GB: { floor: 30, ceiling: 90 }, DE: { floor: 25, ceiling: 80 }, AU: { floor: 38, ceiling: 110 } },
    insurance: { US: { floor: 15, ceiling: 55 }, CA: { floor: 12, ceiling: 45 }, GB: { floor: 10, ceiling: 40 }, DE: { floor: 8, ceiling: 35 }, AU: { floor: 14, ceiling: 50 } },
    home_services: { US: { floor: 20, ceiling: 70 }, CA: { floor: 18, ceiling: 60 }, GB: { floor: 15, ceiling: 50 }, DE: { floor: 12, ceiling: 45 }, AU: { floor: 19, ceiling: 65 } },
    b2b_saas: { US: { floor: 50, ceiling: 250 }, CA: { floor: 45, ceiling: 200 }, GB: { floor: 40, ceiling: 180 }, DE: { floor: 35, ceiling: 160 }, AU: { floor: 48, ceiling: 220 } },
    real_estate: { US: { floor: 30, ceiling: 100 }, CA: { floor: 25, ceiling: 85 }, GB: { floor: 22, ceiling: 75 }, DE: { floor: 20, ceiling: 70 }, AU: { floor: 28, ceiling: 95 } },
    auto: { US: { floor: 20, ceiling: 65 }, CA: { floor: 18, ceiling: 55 }, GB: { floor: 15, ceiling: 50 }, DE: { floor: 12, ceiling: 45 }, AU: { floor: 19, ceiling: 60 } },
    legal: { US: { floor: 60, ceiling: 300 }, CA: { floor: 50, ceiling: 250 }, GB: { floor: 45, ceiling: 220 }, DE: { floor: 40, ceiling: 200 }, AU: { floor: 55, ceiling: 270 } },
    financial: { US: { floor: 35, ceiling: 150 }, CA: { floor: 30, ceiling: 130 }, GB: { floor: 25, ceiling: 110 }, DE: { floor: 22, ceiling: 100 }, AU: { floor: 33, ceiling: 140 } },
};

const DEFAULT_PRICES = { floor: 20, ceiling: 80 };

// ── Helpers ──

function simulateStreamLatency(): Promise<number> {
    // Log-normal distribution — mostly p50 with occasional p95 spikes
    const u = Math.random();
    const ms = u < 0.95
        ? STREAM_LATENCY_P50 + Math.random() * (STREAM_LATENCY_P95 - STREAM_LATENCY_P50) * 0.3
        : STREAM_LATENCY_P95 + Math.random() * 120; // tail
    return new Promise((resolve) => setTimeout(() => resolve(Math.round(ms)), ms));
}

function jitter(base: number, pct: number = 0.08): number {
    return parseFloat((base * (1 + (Math.random() * 2 - 1) * pct)).toFixed(2));
}

// ── Cached state for fallback ──

const lastKnown = new Map<string, BidFloorResult>();

// ── Service ──

class DataStreamsService {
    private subscriptions = new Map<string, NodeJS.Timeout>();

    /**
     * Get real-time bid floor for a vertical + country.
     * Returns cached stale value if stream is unavailable.
     */
    async getRealtimeBidFloor(vertical: string, country: string = 'US'): Promise<BidFloorResult> {
        const key = `${vertical}:${country}`;
        console.log(`[DATA_STREAMS STUB] getRealtimeBidFloor: ${key}`);

        try {
            const latencyMs = await simulateStreamLatency();
            const prices = BASE_PRICES[vertical]?.[country] || DEFAULT_PRICES;

            const result: BidFloorResult = {
                vertical,
                country,
                bidFloor: jitter(prices.floor),
                bidCeiling: jitter(prices.ceiling),
                confidence: parseFloat((0.85 + Math.random() * 0.15).toFixed(3)),
                timestamp: new Date().toISOString(),
                latencyMs,
                isStub: true,
                stale: false,
            };

            lastKnown.set(key, result);
            console.log(`[DATA_STREAMS STUB] floor=$${result.bidFloor} ceiling=$${result.bidCeiling} latency=${latencyMs}ms`);
            return result;
        } catch {
            // Fallback to cached
            const cached = lastKnown.get(key);
            if (cached) {
                console.warn(`[DATA_STREAMS STUB] stream unavailable — returning STALE cached value`);
                return { ...cached, stale: true, timestamp: new Date().toISOString() };
            }
            // No cache — return defaults
            console.warn(`[DATA_STREAMS STUB] no cache — returning defaults`);
            return {
                vertical, country,
                bidFloor: DEFAULT_PRICES.floor,
                bidCeiling: DEFAULT_PRICES.ceiling,
                confidence: 0,
                timestamp: new Date().toISOString(),
                latencyMs: 0,
                isStub: true,
                stale: true,
            };
        }
    }

    /**
     * CRE Lead Price Index — aggregated market index per vertical.
     * Similar to a stock index but for lead pricing.
     */
    async getLeadPriceIndex(vertical: string): Promise<PriceIndexResult> {
        console.log(`[DATA_STREAMS STUB] getLeadPriceIndex: ${vertical}`);

        const prices = BASE_PRICES[vertical]?.['US'] || DEFAULT_PRICES;
        const midpoint = (prices.floor + prices.ceiling) / 2;
        const indexValue = Math.round((midpoint / 300) * 1000); // Normalize to 0–1000

        return {
            vertical,
            indexValue: jitter(indexValue, 0.03),
            change24h: parseFloat(((Math.random() * 10) - 5).toFixed(2)),
            volume24h: Math.round(10000 + Math.random() * 90000),
            timestamp: new Date().toISOString(),
            isStub: true,
        };
    }

    /**
     * Subscribe to a simulated price feed — pushes updates at interval.
     * Returns a subscription ID to unsubscribe later.
     */
    subscribePriceFeed(
        vertical: string,
        country: string,
        callback: PriceFeedCallback,
        intervalMs: number = 5000
    ): string {
        const feedId = `feed_${vertical}_${country}_${Date.now()}`;
        console.log(`[DATA_STREAMS STUB] subscribePriceFeed: ${feedId} interval=${intervalMs}ms`);

        const timer = setInterval(async () => {
            const data = await this.getRealtimeBidFloor(vertical, country);
            callback(data);
        }, intervalMs);

        this.subscriptions.set(feedId, timer);
        return feedId;
    }

    /**
     * Unsubscribe from a price feed.
     */
    unsubscribePriceFeed(feedId: string): boolean {
        const timer = this.subscriptions.get(feedId);
        if (timer) {
            clearInterval(timer);
            this.subscriptions.delete(feedId);
            console.log(`[DATA_STREAMS STUB] unsubscribed: ${feedId}`);
            return true;
        }
        return false;
    }

    /**
     * Clean up all subscriptions.
     */
    destroy(): void {
        for (const [id, timer] of this.subscriptions) {
            clearInterval(timer);
            console.log(`[DATA_STREAMS STUB] cleaned up: ${id}`);
        }
        this.subscriptions.clear();
    }
}

export const dataStreamsService = new DataStreamsService();
export type { BidFloorResult, PriceIndexResult };
