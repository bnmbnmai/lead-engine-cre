/**
 * useFloorPrice — React hook for Chainlink Data Feeds floor prices.
 *
 * Fetches real-time bid floor/ceiling pricing from the backend,
 * which reads ETH/USD from the Chainlink Price Feed on Base Sepolia
 * and derives per-vertical floors using a market multiplier.
 *
 * Usage:
 *   const { floor, ceiling, loading, ethUsdPrice } = useFloorPrice('solar', 'US');
 */

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

export interface FloorPriceData {
    bidFloor: number;
    bidCeiling: number;
    confidence: number;
    ethUsdPrice?: number;
    marketMultiplier?: number;
    isStub: boolean;
    stale: boolean;
    source: 'on-chain' | 'cached' | 'fallback';
}

/**
 * Fetch real-time floor price for a vertical + country.
 * Auto-refreshes every `refreshMs` milliseconds (default 60s).
 * Falls back gracefully if the endpoint is unreachable.
 */
export function useFloorPrice(
    vertical: string | undefined,
    country: string = 'US',
    refreshMs: number = 60_000
) {
    const [data, setData] = useState<FloorPriceData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!vertical) return;

        let cancelled = false;

        async function fetchFloor() {
            try {
                setLoading(true);
                const res = await api.getBidFloor(vertical!, country);
                if (!cancelled && res.data?.bidFloor) {
                    setData({
                        bidFloor: res.data.bidFloor.bidFloor,
                        bidCeiling: res.data.bidFloor.bidCeiling,
                        confidence: res.data.bidFloor.confidence,
                        ethUsdPrice: res.data.bidFloor.ethUsdPrice,
                        marketMultiplier: res.data.bidFloor.marketMultiplier,
                        isStub: res.data.bidFloor.isStub,
                        stale: res.data.bidFloor.stale,
                        source: res.data.bidFloor.source || 'on-chain',
                    });
                    setError(null);
                }
            } catch (err: any) {
                if (!cancelled) {
                    setError(err.message || 'Failed to fetch floor price');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        fetchFloor();

        // Auto-refresh at interval
        intervalRef.current = setInterval(fetchFloor, refreshMs);

        return () => {
            cancelled = true;
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [vertical, country, refreshMs]);

    return {
        floor: data?.bidFloor ?? null,
        ceiling: data?.bidCeiling ?? null,
        ethUsdPrice: data?.ethUsdPrice ?? null,
        marketMultiplier: data?.marketMultiplier ?? null,
        source: data?.source ?? null,
        isStub: data?.isStub ?? true,
        stale: data?.stale ?? false,
        loading,
        error,
        data,
    };
}
