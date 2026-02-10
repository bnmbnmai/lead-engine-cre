import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/lib/api';

// ============================================
// Types (mirror backend stub types)
// ============================================

interface StubMeta {
    isStub: true;
    latencyMs: number;
    timestamp: string;
}

interface DECOAttestation extends StubMeta {
    attestationId: string;
    isValid: boolean;
    confidence: number;
    reason?: string;
}

interface BidFloorData extends StubMeta {
    vertical: string;
    country: string;
    bidFloor: number;
    bidCeiling: number;
    confidence: number;
    stale: boolean;
}

interface PriceIndexData {
    vertical: string;
    indexValue: number;
    change24h: number;
    volume24h: number;
    isStub: true;
}

interface ConfidentialScore extends StubMeta {
    leadId: string;
    score: number;
    tier: 'PREMIUM' | 'STANDARD' | 'BASIC' | 'LOW';
    computedInTEE: boolean;
    degraded: boolean;
}

// ============================================
// useDECOAttestation
// ============================================

interface UseDECOOptions {
    url: string;
    selector?: string;
    enabled?: boolean;
}

export function useDECOAttestation({ url, selector = 'body', enabled = true }: UseDECOOptions) {
    const [data, setData] = useState<DECOAttestation | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const attest = useCallback(async () => {
        if (!url) return;
        setIsLoading(true);
        setError(null);

        try {
            // In production, this would call a dedicated /api/v1/deco/attest endpoint.
            // For the stub, we simulate the response client-side.
            const mockResult: DECOAttestation = {
                attestationId: `deco_${Date.now().toString(16)}`,
                isValid: Math.random() > 0.2,
                confidence: parseFloat((0.85 + Math.random() * 0.15).toFixed(3)),
                latencyMs: Math.round(100 + Math.random() * 200),
                timestamp: new Date().toISOString(),
                isStub: true,
            };
            // Simulate network delay
            await new Promise((r) => setTimeout(r, mockResult.latencyMs));
            setData(mockResult);
        } catch {
            setError('DECO attestation failed');
        } finally {
            setIsLoading(false);
        }
    }, [url, selector]);

    useEffect(() => {
        if (enabled) attest();
    }, [enabled, attest]);

    return { data, isLoading, error, refetch: attest, isStub: true as const };
}

// ============================================
// useRealtimeBidFloor
// ============================================

interface UseBidFloorOptions {
    vertical: string;
    country?: string;
    pollIntervalMs?: number;
    enabled?: boolean;
}

export function useRealtimeBidFloor({
    vertical,
    country = 'US',
    pollIntervalMs = 10000,
    enabled = true,
}: UseBidFloorOptions) {
    const [bidFloor, setBidFloor] = useState<BidFloorData | null>(null);
    const [priceIndex, setPriceIndex] = useState<PriceIndexData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchBidFloor = useCallback(async () => {
        if (!vertical) return;
        setIsLoading(true);
        setError(null);

        try {
            const { data: result } = await api.apiFetch<{
                bidFloor: BidFloorData;
                priceIndex: PriceIndexData;
            }>(`/api/v1/bids/bid-floor?vertical=${vertical}&country=${country}`);

            if (result) {
                setBidFloor(result.bidFloor);
                setPriceIndex(result.priceIndex);
            }
        } catch {
            setError('Failed to fetch bid floor');
        } finally {
            setIsLoading(false);
        }
    }, [vertical, country]);

    useEffect(() => {
        if (!enabled) return;

        fetchBidFloor();

        if (pollIntervalMs > 0) {
            intervalRef.current = setInterval(fetchBidFloor, pollIntervalMs);
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [enabled, fetchBidFloor, pollIntervalMs]);

    return { bidFloor, priceIndex, isLoading, error, refetch: fetchBidFloor, isStub: true as const };
}

// ============================================
// useConfidentialScore
// ============================================

interface UseConfidentialScoreOptions {
    leadId: string;
    enabled?: boolean;
}

export function useConfidentialScore({ leadId, enabled = true }: UseConfidentialScoreOptions) {
    const [data, setData] = useState<ConfidentialScore | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const compute = useCallback(async () => {
        if (!leadId) return;
        setIsLoading(true);
        setError(null);

        try {
            // Stub: simulate TEE score computation client-side
            const latencyMs = Math.round(150 + Math.random() * 350);
            await new Promise((r) => setTimeout(r, latencyMs));

            const rawScore = parseInt(leadId.replace(/\D/g, '').slice(0, 4) || '50', 10) % 100;
            const score = Math.max(10, rawScore);

            const tier: ConfidentialScore['tier'] =
                score >= 85 ? 'PREMIUM' :
                    score >= 65 ? 'STANDARD' :
                        score >= 40 ? 'BASIC' : 'LOW';

            setData({
                leadId,
                score,
                tier,
                computedInTEE: true,
                degraded: false,
                latencyMs,
                timestamp: new Date().toISOString(),
                isStub: true,
            });
        } catch {
            setError('Confidential computation failed');
        } finally {
            setIsLoading(false);
        }
    }, [leadId]);

    useEffect(() => {
        if (enabled) compute();
    }, [enabled, compute]);

    return { data, isLoading, error, refetch: compute, isStub: true as const };
}
