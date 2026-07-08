/**
 * socketBridge.ts — Single global socket subscription
 *
 * Mount `useSocketBridge()` ONCE in App.tsx.
 *
 * v7 GOLDEN STANDARD: Pure server-authoritative phase machine.
 * All phase transitions flow exclusively from server socket events:
 *
 *   auction:closing-soon → store.setClosingSoon(leadId)
 *   auction:updated      → store.updateBid() — drives phase from remainingTime
 *   auction:closed       → store.closeLead()  — forces phase='closed'
 *
 * Local-clock guards removed entirely (v6 regression source).
 * Heartbeat (5 s): ping + stale-lead reconciliation via forceRefreshLead.
 */

import { useEffect } from 'react';
import socketClient from '@/lib/socket';
import { useAuctionStore } from '@/store/auctionStore';
import { autoRevealSealedBids } from '@/utils/sealedBid';

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

        // SEALED-BID: bid amounts and bidder identities are never stored or
        // displayed during a live auction — only counts. The server no longer
        // sends them pre-close; dropping the fields here is defence-in-depth.
        const unsubBidUpdate = socketClient.on('marketplace:bid:update', (data: any) => {
            if (!data?.leadId) return;
            store().updateBid({
                leadId: data.leadId,
                bidCount: data.bidCount,
            });
        });

        const unsubAuctionUpdated = socketClient.on('auction:updated', (data) => {
            if (!data?.leadId) return;
            // v7: updateBid drives auctionPhase from server remainingTime — no local clock
            store().updateBid({
                leadId: data.leadId,
                remainingTime: data.remainingTime ?? undefined,
                serverTs: typeof data.serverTs === 'number' ? data.serverTs : undefined,
                bidCount: data.bidCount,
                isSealed: data.isSealed,
            });
        });

        // v7: New event — server signals ≤10 s remaining
        const unsubClosingSoon = socketClient.on('auction:closing-soon', (data: any) => {
            if (!data?.leadId) return;
            store().setClosingSoon(data.leadId);
        });

        // Commit-reveal (Phase B2): when the server opens the reveal window,
        // auto-reveal any sealed bids this tab committed (salt + amount live
        // in sessionStorage — never sent before this moment).
        const unsubRevealPhase = socketClient.on('auction:reveal-phase', (data) => {
            if (!data?.leadId) return;
            void autoRevealSealedBids(data.leadId);
        });

        const unsubClosed = socketClient.on('auction:closed', (data) => {
            if (!data?.leadId) return;
            // R-04 micro-fix: pass winningAmount so closeLead can write the authoritative price.
            store().closeLead(
                data.leadId,
                data.status === 'SOLD' ? 'SOLD' : 'UNSOLD',
                typeof data.winningAmount === 'number' ? data.winningAmount : null,
            );
            // Belt-and-suspenders: API reconcile 1 s later (confirms SOLD/UNSOLD status)
            setTimeout(() => void store().forceRefreshLead(data.leadId), 1_000);
        });

        const unsubStatusChanged = socketClient.on('lead:status-changed', (data: any) => {
            if (!data?.leadId) return;
            if (data.newStatus === 'SOLD' || data.newStatus === 'UNSOLD') {
                store().closeLead(data.leadId, data.newStatus);
                setTimeout(() => void store().forceRefreshLead(data.leadId), 1_000);
            }
        });

        // SEALED-BID: auction:bid:pending previously routed live bid AMOUNTS
        // into the store (price signal leak). Only the pending-bid signal is
        // consumed now — no amount is stored or displayed pre-close.
        const unsubBidPending = socketClient.on('auction:bid:pending', (data: any) => {
            if (!data?.leadId) return;
            store().updateBid({ leadId: data.leadId });
        });

        const unsubLeadsUpdated = socketClient.on('leads:updated', (_data: any) => {
            void fetchAndBulkLoad();
        });

        // ── 5-second heartbeat ──────────────────────────────────────────────
        // Ping server on every tick.
        // On disconnect: reconnect + full refresh for all known leads.
        // v7: no local-clock stale scan — phases are driven by server events only.
        const heartbeatInterval = setInterval(() => {
            const rawSocket = socketClient.getSocket();
            const storeState = store();

            if (rawSocket?.connected) {
                rawSocket.emit('ping');
            } else if (rawSocket && !rawSocket.connected) {
                if (import.meta.env.DEV) {
                    console.warn('[socketBridge] heartbeat: socket disconnected, reconnecting…');
                }
                socketClient.reconnect();
                // Full refresh on reconnect — drives phase from API status
                void fetchAndBulkLoad();
                const knownLeadIds = Array.from(storeState.leads.keys());
                for (const leadId of knownLeadIds) {
                    void storeState.forceRefreshLead(leadId);
                }
            }
        }, 5_000);

        return () => {
            unsubNew();
            unsubBidUpdate();
            unsubAuctionUpdated();
            unsubClosingSoon();
            unsubRevealPhase();
            unsubClosed();
            unsubStatusChanged();
            unsubLeadsUpdated();
            unsubBidPending();
            clearInterval(heartbeatInterval);
        };
    }, []);
}
