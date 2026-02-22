/**
 * socketBridge.ts — Single global socket subscription
 *
 * Mount `useSocketBridge()` ONCE in App.tsx. All marketplace socket events
 * are handled here and dispatched atomically to the Zustand auctionStore.
 *
 * v5 changes:
 *   - On reconnect, call forceRefreshLead() for ALL leads in the store
 *     (not just bulkLoad of IN_AUCTION leads) — catches leads that closed
 *     during the socket outage (they'd be SOLD/UNSOLD and not returned by
 *     the ?status=IN_AUCTION query).
 *   - After auction:closed and lead:status-changed, schedule a
 *     forceRefreshLead() 1 s later to reconcile any race conditions between
 *     the socket event and the DB write.
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
            });
        });

        const unsubAuctionUpdated = socketClient.on('auction:updated', (data) => {
            if (!data?.leadId) return;
            store().updateBid({
                leadId: data.leadId,
                remainingTime: data.remainingTime ?? undefined,
                serverTs: typeof data.serverTs === 'number' ? data.serverTs : undefined,
                bidCount: data.bidCount,
                highestBid: data.highestBid ?? undefined,
                isSealed: data.isSealed,
            });
        });

        const unsubClosed = socketClient.on('auction:closed', (data) => {
            if (!data?.leadId) return;
            store().closeLead(data.leadId, data.status === 'SOLD' ? 'SOLD' : 'UNSOLD');
            // v5: belt-and-suspenders — force API reconcile 1 s later in case socket
            // arrived before DB write completed (race condition on fast auction ends)
            setTimeout(() => void store().forceRefreshLead(data.leadId), 1_000);
        });

        const unsubStatusChanged = socketClient.on('lead:status-changed', (data: any) => {
            if (!data?.leadId) return;
            if (data.newStatus === 'SOLD' || data.newStatus === 'UNSOLD') {
                store().closeLead(data.leadId, data.newStatus);
                setTimeout(() => void store().forceRefreshLead(data.leadId), 1_000);
            }
        });

        const unsubLeadsUpdated = socketClient.on('leads:updated', (_data: any) => {
            void fetchAndBulkLoad();
        });

        // ── v4/v5: 8-second heartbeat ───────────────────────────────────────────
        // On disconnect: forceRefreshLead for ALL known leads (not just IN_AUCTION
        // bulk-fetch) so leads that closed during the outage get their final status.
        const heartbeatInterval = setInterval(() => {
            const rawSocket = socketClient.getSocket();
            if (rawSocket?.connected) {
                rawSocket.emit('ping');
            } else if (rawSocket && !rawSocket.connected) {
                if (import.meta.env.DEV) {
                    console.warn('[socketBridge] heartbeat: socket disconnected, reconnecting…');
                }
                socketClient.reconnect();
                // Full refresh: bulkLoad for live leads + forceRefresh for every known lead
                void fetchAndBulkLoad();
                const knownLeadIds = Array.from(store().leads.keys());
                for (const leadId of knownLeadIds) {
                    void store().forceRefreshLead(leadId);
                }
            }
        }, 8_000);

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
