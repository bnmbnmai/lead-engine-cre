import { useState, useEffect, useCallback } from 'react';
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

    useEffect(() => {
        if (!leadId) return;

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
                onBidPlaced?.(event);
            }
        });

        const unsubResolved = socketClient.on('auction:resolved', (event) => {
            if (event.leadId === leadId) {
                setState((prev) => (prev ? { ...prev, phase: 'RESOLVED' } : prev));
                onResolved?.(event);
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
            unsubError();
        };
    }, [leadId, onBidPlaced, onResolved]);

    const placeBid = useCallback(
        (data: { commitment?: string; amount?: number }) => {
            setError(null);
            socketClient.placeBid({ leadId, ...data });
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
