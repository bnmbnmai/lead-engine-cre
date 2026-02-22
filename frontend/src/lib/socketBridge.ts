/**
 * socketBridge.ts — Single global socket subscription
 *
 * Mount `useSocketBridge()` ONCE in App.tsx. All marketplace socket events
 * are handled here and dispatched atomically to the Zustand auctionStore.
 *
 * v6 changes:
 *   - auction:updated: if remainingTime <= 0, call forceReconcileLead immediately
 *     (closes the "local clock drained but auction:closed not yet arrived" window).
 *   - Heartbeat 8 s → 5 s for faster stale detection.
 *   - Heartbeat also scans ALL known leads and calls forceReconcileLead for any
 *     where liveRemainingMs === 0 && !isClosed (stale-lead cleanup).
 *   - On reconnect: forceRefreshLead for all known leads (unchanged from v5).
 *   - After auction:closed and lead:status-changed: 1 s delayed forceRefreshLead
 *     for belt-and-suspenders reconcile (unchanged from v5).
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
            // v6: if server reports time drained, immediately reconcile
            // (closes the window between local timer reaching 0 and auction:closed arriving)
            const remaining = data.remainingTime ?? null;
            if (remaining !== null && remaining <= 0) {
                void store().forceReconcileLead(data.leadId);
            }
        });

        const unsubClosed = socketClient.on('auction:closed', (data) => {
            if (!data?.leadId) return;
            store().closeLead(data.leadId, data.status === 'SOLD' ? 'SOLD' : 'UNSOLD');
            // v5/v6: belt-and-suspenders — force API reconcile 1 s later in case socket
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

        // ── v6: 5-second heartbeat ──────────────────────────────────────────────
        // Reduced from 8 s for faster stale detection.
        // On each tick: scan for leads whose time drained but auction:closed hasn't
        // arrived yet, and force-reconcile them.
        // On disconnect: forceRefreshLead for ALL known leads.
        const heartbeatInterval = setInterval(() => {
            const rawSocket = socketClient.getSocket();
            const storeState = store();

            if (rawSocket?.connected) {
                rawSocket.emit('ping');

                // v6: stale-lead scan — find leads with drained timer but still open
                const now = Date.now();
                for (const [leadId, slice] of storeState.leads.entries()) {
                    if (!slice.isClosed) {
                        const endMs = slice.auctionEndAt
                            ? new Date(slice.auctionEndAt).getTime()
                            : null;
                        const timedOut = endMs != null && endMs <= now;
                        const drainedLocally = slice.liveRemainingMs === 0;
                        if (timedOut || drainedLocally) {
                            void storeState.forceReconcileLead(leadId);
                        }
                    }
                }
            } else if (rawSocket && !rawSocket.connected) {
                if (import.meta.env.DEV) {
                    console.warn('[socketBridge] heartbeat: socket disconnected, reconnecting…');
                }
                socketClient.reconnect();
                // Full refresh: bulkLoad for live leads + forceRefresh for every known lead
                void fetchAndBulkLoad();
                const knownLeadIds = Array.from(storeState.leads.keys());
                for (const leadId of knownLeadIds) {
                    void storeState.forceRefreshLead(leadId);
                }
            }
        }, 5_000); // v6: 5 s (was 8 s)

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
