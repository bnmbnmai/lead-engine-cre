/**
 * socketBridge.ts — Single global socket subscription
 *
 * Mount `useSocketBridge()` ONCE in App.tsx (inside GlobalOverlays or directly
 * in the App component). All marketplace socket events are handled here and
 * dispatched atomically to the Zustand auctionStore.
 *
 * This eliminates BUG-A (stale closures in per-page useSocketEvents) and
 * BUG-B (per-card listeners missing events for un-mounted cards).
 *
 * Events handled:
 *   marketplace:lead:new    → store.addLead()
 *   marketplace:bid:update  → store.updateBid()
 *   auction:updated         → store.updateBid()  (server-authoritative, drift-corrected)
 *   auction:closed          → store.closeLead()  (atomic — all cards freeze simultaneously)
 *   lead:status-changed     → store.closeLead()  if SOLD|UNSOLD
 *   leads:updated           → re-fetch active leads from REST API → store.bulkLoad()
 *
 * v4 addition:
 *   WS Heartbeat — emits a client-side 'ping' every 8 s to keep the WebSocket
 *   alive through load balancers / reverse proxies that drop idle connections
 *   during long demo runs. The socket.io server ignores unknown events.
 */

import { useEffect } from 'react';
import socketClient from '@/lib/socket';
import { useAuctionStore } from '@/store/auctionStore';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function fetchAndBulkLoad() {
    try {
        const res = await fetch(`${API_BASE}/api/v1/leads?status=IN_AUCTION&limit=50`);
        if (!res.ok) return;
        const data = await res.json();
        const leads = data.leads ?? data ?? [];
        if (Array.isArray(leads) && leads.length > 0) {
            useAuctionStore.getState().bulkLoad(leads);
        }
    } catch { /* non-fatal */ }
}

/** Mount once at App level to wire all marketplace socket events → Zustand store */
export function useSocketBridge(): void {
    useEffect(() => {
        const store = useAuctionStore.getState;

        const unsubNew = socketClient.on('marketplace:lead:new', (data: any) => {
            if (!data?.lead?.id) return;
            store().addLead(data.lead);
        });

        const unsubBidUpdate = socketClient.on('marketplace:bid:update', (data: any) => {
            if (!data?.leadId) return;
            store().updateBid({
                leadId: data.leadId,
                bidCount: data.bidCount,
                highestBid: data.highestBid,
                // marketplace:bid:update has no serverTs — no drift correction needed
            });
        });

        const unsubAuctionUpdated = socketClient.on('auction:updated', (data) => {
            if (!data?.leadId) return;
            store().updateBid({
                leadId: data.leadId,
                remainingTime: data.remainingTime ?? undefined,
                // serverTs from backend is now a number (ms epoch) — enables drift correction
                serverTs: typeof data.serverTs === 'number' ? data.serverTs : undefined,
                bidCount: data.bidCount,
                highestBid: data.highestBid ?? undefined,
                isSealed: data.isSealed,
            });
        });

        const unsubClosed = socketClient.on('auction:closed', (data) => {
            if (!data?.leadId) return;
            store().closeLead(data.leadId, data.status === 'SOLD' ? 'SOLD' : 'UNSOLD');
        });

        const unsubStatusChanged = socketClient.on('lead:status-changed', (data: any) => {
            if (!data?.leadId) return;
            if (data.newStatus === 'SOLD' || data.newStatus === 'UNSOLD') {
                // Deduplicated by store.closeLead's idempotency check
                store().closeLead(data.leadId, data.newStatus);
            }
        });

        const unsubLeadsUpdated = socketClient.on('leads:updated', (_data: any) => {
            // Backend signals replenishment complete — refresh store from API
            void fetchAndBulkLoad();
        });

        // ── v4: 8-second heartbeat ping ────────────────────────────────────────
        // Keeps the WebSocket alive through load balancers / reverse proxies that
        // silently drop idle connections during long (30-min) demo runs.
        // socket.io server ignores unknown events — this is purely a transport keepalive.
        const heartbeatInterval = setInterval(() => {
            const rawSocket = socketClient.getSocket();
            if (rawSocket?.connected) {
                rawSocket.emit('ping');
            } else if (rawSocket && !rawSocket.connected) {
                // Socket exists but disconnected — trigger reconnect immediately
                if (import.meta.env.DEV) {
                    console.warn('[socketBridge] heartbeat: socket disconnected, reconnecting…');
                }
                socketClient.reconnect();
                // After reconnect, do a full refresh so nothing was missed during the gap
                void fetchAndBulkLoad();
            }
        }, 8_000);
        // ───────────────────────────────────────────────────────────────────────

        return () => {
            unsubNew();
            unsubBidUpdate();
            unsubAuctionUpdated();
            unsubClosed();
            unsubStatusChanged();
            unsubLeadsUpdated();
            clearInterval(heartbeatInterval);
        };
    }, []); // empty deps — mounts once for the lifetime of the app
}
