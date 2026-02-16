/**
 * useSocketEvents — subscribe to Socket.io events with auto-cleanup and polling fallback
 *
 * Usage:
 *   useSocketEvents({
 *     'marketplace:lead:new': (data) => setLeads(prev => [data.lead, ...prev]),
 *     'marketplace:bid:update': (data) => updateBidCount(data),
 *   }, fetchData);
 *
 * When the socket is disconnected, falls back to calling `pollFn` every 10 seconds.
 */

import { useEffect, useState, useRef } from 'react';
import socketClient from '@/lib/socket';
import { useInterval } from './useInterval';

const POLL_INTERVAL_MS = 10_000; // 10s fallback

type EventHandler = (...args: any[]) => void;
type EventMap = Record<string, EventHandler>;

interface UseSocketEventsOptions {
    /** If true, connect socket on mount (requires auth). Default: true */
    autoConnect?: boolean;
    /** Enable polling fallback when disconnected. Default: true */
    enablePolling?: boolean;
    /** Custom poll interval in ms. Default: 10000 */
    pollInterval?: number;
}

export function useSocketEvents(
    handlers: EventMap,
    pollFn?: () => void,
    options: UseSocketEventsOptions = {},
) {
    const {
        autoConnect = true,
        enablePolling = true,
        pollInterval = POLL_INTERVAL_MS,
    } = options;

    const [isConnected, setIsConnected] = useState(socketClient.isConnected());
    const [lastEvent, setLastEvent] = useState<string | null>(null);
    const handlersRef = useRef(handlers);

    // Keep handlers ref current without re-subscribing
    useEffect(() => {
        handlersRef.current = handlers;
    }, [handlers]);

    // Socket connection + event subscriptions
    useEffect(() => {
        if (autoConnect && !socketClient.isConnected()) {
            try {
                socketClient.connect();
            } catch {
                // Auth token may not be available (public user)
            }
        }

        // Track connection state
        const checkConnection = setInterval(() => {
            setIsConnected(socketClient.isConnected());
        }, 2000);

        // Subscribe to each event
        const unsubscribers: (() => void)[] = [];

        Object.entries(handlersRef.current).forEach(([event]) => {
            const wrappedHandler = (...args: any[]) => {
                setLastEvent(event);
                // Always read the latest handler from the ref to avoid stale closures
                handlersRef.current[event]?.(...args);
            };
            const unsub = socketClient.on(event as any, wrappedHandler as any);
            unsubscribers.push(unsub);
        });

        return () => {
            clearInterval(checkConnection);
            unsubscribers.forEach((unsub) => unsub());
        };
    }, [autoConnect]); // Only re-run if autoConnect changes

    // Polling fallback when disconnected
    useInterval(
        () => {
            if (!isConnected && pollFn) {
                pollFn();
            }
        },
        enablePolling && pollFn ? pollInterval : null,
    );

    return { isConnected, lastEvent };
}

export default useSocketEvents;
