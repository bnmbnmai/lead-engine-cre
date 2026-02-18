import { useState, useEffect, useCallback, useRef } from 'react';
import socketClient, { AuctionState, BidEvent, AuctionResolvedEvent } from '@/lib/socket';

interface UseAuctionOptions {
    leadId: string;
    onBidPlaced?: (event: BidEvent) => void;
    onResolved?: (event: AuctionResolvedEvent) => void;
}

export function useAuction({ leadId, onBidPlaced, onResolved }: UseAuctionOptions) {
    const [state, setState] = useState<AuctionState | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Stabilize callbacks with refs to avoid re-running the effect
    const onBidPlacedRef = useRef(onBidPlaced);
    onBidPlacedRef.current = onBidPlaced;
    const onResolvedRef = useRef(onResolved);
    onResolvedRef.current = onResolved;

    useEffect(() => {
        if (!leadId) return;

        // Reset error when leadId changes
        setError(null);

        // Connect and join auction room
        socketClient.connect();
        socketClient.joinAuction(leadId);
        setIsConnected(socketClient.isConnected());

        // Event handlers
        const unsubState = socketClient.on('auction:state', (s) => {
            if (s.leadId === leadId) {
                setState(s);
            }
        });

        const unsubPhase = socketClient.on('auction:phase', (data) => {
            if (data.leadId === leadId) {
                setState((prev) =>
                    prev ? { ...prev, phase: data.phase as AuctionState['phase'] } : prev
                );
            }
        });

        const unsubBid = socketClient.on('bid:new', (event) => {
            if (event.leadId === leadId) {
                setState((prev) =>
                    prev
                        ? {
                            ...prev,
                            bidCount: event.bidCount,
                            highestBid: event.highestBid,
                        }
                        : prev
                );
                onBidPlacedRef.current?.(event);
            }
        });

        const unsubResolved = socketClient.on('auction:resolved', (event) => {
            if (event.leadId === leadId) {
                setState((prev) => (prev ? { ...prev, phase: 'RESOLVED' } : prev));
                onResolvedRef.current?.(event);
            }
        });

        // When auction ends with no valid bids, server converts to UNSOLD
        // and emits lead:unsold instead of auction:resolved
        const unsubUnsold = socketClient.on('lead:unsold', (event: any) => {
            if (event.leadId === leadId) {
                setState((prev) => (prev ? { ...prev, phase: 'RESOLVED' } : prev));
                onResolvedRef.current?.(event);
            }
        });

        // Catch-all: any lead status change away from IN_AUCTION
        const unsubStatusChanged = socketClient.on('lead:status-changed', (event: any) => {
            if (event.leadId === leadId && event.newStatus !== 'IN_AUCTION') {
                setState((prev) => (prev ? { ...prev, phase: 'RESOLVED' } : prev));
                onResolvedRef.current?.(event);
            }
        });

        const unsubError = socketClient.on('error', (data) => {
            setError(data.message);
        });

        // Cleanup
        return () => {
            socketClient.leaveAuction(leadId);
            unsubState();
            unsubPhase();
            unsubBid();
            unsubResolved();
            unsubUnsold();
            unsubStatusChanged();
            unsubError();
        };
    }, [leadId]); // Only depends on leadId now

    const placeBid = useCallback(
        (data: { commitment?: string; amount?: number }) => {
            setError(null);
            return socketClient.placeBid({ leadId, ...data });
        },
        [leadId]
    );

    return {
        state,
        isConnected,
        error,
        placeBid,
    };
}

export default useAuction;
