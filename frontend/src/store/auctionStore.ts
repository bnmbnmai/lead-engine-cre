/**
 * auctionStore.ts — Zustand global auction state store
 *
 * Single source of truth for all live lead/auction UI state.
 * Populated by socketBridge.ts (one global subscription at App level).
 * LeadCard and HomePage read from here — zero per-card socket listeners.
 *
 * Clock-drift correction:
 *   effectiveRemaining = serverRemainingMs − (Date.now() − serverTs)
 * This compensates for network latency so all clients converge on the
 * same countdown regardless of when the packet arrived.
 *
 * Debug: window.__AUCTION_DEBUG__ = true  (or import.meta.env.DEV)
 * Every store action prints:
 *   [store:addLead]    <id>  auctionEndAt=…
 *   [store:updateBid]  <id>  remaining=…ms  bidCount=…  isSealed=…
 *   [store:closeLead]  <id>  status=SOLD|UNSOLD
 *   [store:removeLead] <id>  (8 s overlay expired)
 */

import { create } from 'zustand';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LeadSlice {
    id: string;
    vertical: string;
    geo: { state?: string; city?: string; country?: string };
    source: string;
    status: string;
    reservePrice: number;
    isVerified: boolean;
    qualityScore?: number | null;
    chttEnriched?: boolean;
    chttScore?: number;
    aceCompliant?: boolean | null;
    auctionEndAt?: string;
    auctionStartAt?: string;
    auctionDuration?: number;
    _count?: { bids: number };
    auctionRoom?: { bidCount?: number; highestBid?: number };
    parameters?: { _bountyTotal?: number };
    seller?: {
        id: string;
        companyName: string;
        reputationScore: number;
        isVerified: boolean;
    };
    // Live auction state (updated by socket)
    isClosed: boolean;
    isSealed: boolean;
    liveBidCount: number | null;
    liveHighestBid: number | null;
    /** Server-corrected remaining ms — updated on every auction:updated */
    liveRemainingMs: number | null;
}

type AuctionEndFeedback = 'SOLD' | 'UNSOLD';

interface AuctionStoreState {
    /** All known leads, keyed by lead ID */
    leads: Map<string, LeadSlice>;
    /** 8-second "Auction Ended" overlay map, keyed by lead ID */
    auctionEndFeedbackMap: Map<string, AuctionEndFeedback>;
    /** Insertion-order IDs for stable list rendering */
    leadOrder: string[];

    // ── Actions ─────────────────────────────────────────────────────────────
    /**
     * Add a new lead (from marketplace:lead:new or API bulk-load).
     * Idempotent: if the lead already exists it is NOT overwritten
     * (use updateBid/closeLead for state changes on existing leads).
     */
    addLead: (lead: Omit<LeadSlice, 'isClosed' | 'isSealed' | 'liveBidCount' | 'liveHighestBid' | 'liveRemainingMs'>) => void;
    /**
     * Bulk-load leads from an API response (used by HomePage on mount/refetch).
     * Merges with existing store state — does not replace closed/sealed leads.
     */
    bulkLoad: (leads: any[]) => void;
    /**
     * Update bid state for a lead from auction:updated or marketplace:bid:update.
     * Applies clock-drift correction using serverTs (ms epoch from backend).
     */
    updateBid: (data: {
        leadId: string;
        remainingTime?: number | null;
        serverTs?: number;   // ms epoch — for drift correction
        bidCount?: number;
        highestBid?: number | null;
        isSealed?: boolean;
    }) => void;
    /**
     * Mark a lead as closed. Schedules a 8-second overlay then removes from list.
     */
    closeLead: (leadId: string, status: AuctionEndFeedback) => void;
    /** Remove a lead from the store entirely (called after 8s overlay) */
    removeLead: (leadId: string) => void;
    /** Get ordered list of leads for rendering, optionally including closed ones */
    getOrderedLeads: () => LeadSlice[];
}

// ─── Debug helper ────────────────────────────────────────────────────────────

function dbg(action: string, ...args: unknown[]) {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    if (import.meta.env.DEV || win?.__AUCTION_DEBUG__) {
        console.debug(`[store:${action}]`, ...args);
    }
}

// ─── Conversion helper ───────────────────────────────────────────────────────

function apiLeadToSlice(lead: any): LeadSlice {
    return {
        id: lead.id,
        vertical: lead.vertical,
        geo: lead.geo ?? {},
        source: lead.source ?? 'PLATFORM',
        status: lead.status,
        reservePrice: lead.reservePrice,
        isVerified: lead.isVerified ?? false,
        qualityScore: lead.qualityScore,
        chttEnriched: lead.chttEnriched,
        chttScore: lead.chttScore,
        aceCompliant: lead.aceCompliant,
        auctionEndAt: lead.auctionEndAt,
        auctionStartAt: lead.auctionStartAt,
        auctionDuration: lead.auctionDuration,
        _count: lead._count,
        auctionRoom: lead.auctionRoom,
        parameters: lead.parameters,
        seller: lead.seller,
        isClosed: lead.status !== 'IN_AUCTION',
        isSealed: false,
        liveBidCount: null,
        liveHighestBid: null,
        liveRemainingMs: lead.auctionEndAt
            ? Math.max(0, new Date(lead.auctionEndAt).getTime() - Date.now())
            : null,
    };
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useAuctionStore = create<AuctionStoreState>((set, get) => ({
    leads: new Map(),
    auctionEndFeedbackMap: new Map(),
    leadOrder: [],

    addLead(lead) {
        set((state) => {
            if (state.leads.has(lead.id)) return state; // already known — skip
            const slice: LeadSlice = {
                ...lead,
                isClosed: false,
                isSealed: false,
                liveBidCount: null,
                liveHighestBid: null,
                liveRemainingMs: lead.auctionEndAt
                    ? Math.max(0, new Date(lead.auctionEndAt).getTime() - Date.now())
                    : null,
            };
            const leads = new Map(state.leads);
            leads.set(lead.id, slice);
            dbg('addLead', lead.id, 'auctionEndAt=', lead.auctionEndAt);
            return {
                leads,
                leadOrder: [lead.id, ...state.leadOrder.filter(id => id !== lead.id)],
            };
        });
    },

    bulkLoad(apiLeads) {
        set((state) => {
            const leads = new Map(state.leads);
            const newOrder = [...state.leadOrder];

            for (const al of apiLeads) {
                if (!al?.id) continue;
                const existing = leads.get(al.id);
                if (existing) {
                    // Merge: update static fields but preserve live socket state
                    leads.set(al.id, {
                        ...apiLeadToSlice(al),
                        isClosed: existing.isClosed,
                        isSealed: existing.isSealed,
                        liveBidCount: existing.liveBidCount,
                        liveHighestBid: existing.liveHighestBid,
                        liveRemainingMs: existing.liveRemainingMs,
                    });
                } else {
                    leads.set(al.id, apiLeadToSlice(al));
                    if (!newOrder.includes(al.id)) newOrder.push(al.id);
                }
            }

            dbg('bulkLoad', `${apiLeads.length} leads`);
            return { leads, leadOrder: newOrder };
        });
    },

    updateBid({ leadId, remainingTime, serverTs, bidCount, highestBid, isSealed }) {
        set((state) => {
            const lead = state.leads.get(leadId);
            if (!lead) return state; // unknown lead — ignore
            if (lead.isClosed) return state; // already closed — never re-open

            // Clock-drift correction: subtract network latency from announced remaining time
            let liveRemainingMs = lead.liveRemainingMs;
            if (remainingTime != null) {
                const networkDelayMs = serverTs != null ? Math.max(0, Date.now() - serverTs) : 0;
                liveRemainingMs = Math.max(0, remainingTime - networkDelayMs);
            }

            const updated: LeadSlice = {
                ...lead,
                liveBidCount: bidCount ?? lead.liveBidCount,
                liveHighestBid: highestBid ?? lead.liveHighestBid,
                liveRemainingMs,
                isSealed: isSealed ?? lead.isSealed,
            };

            const leads = new Map(state.leads);
            leads.set(leadId, updated);

            dbg('updateBid', leadId,
                `remaining=${liveRemainingMs}ms`,
                `bidCount=${updated.liveBidCount}`,
                `isSealed=${updated.isSealed}`);

            return { leads };
        });
    },

    closeLead(leadId, status) {
        set((state) => {
            const lead = state.leads.get(leadId);
            if (!lead) return state;
            if (lead.isClosed) return state; // idempotent

            const leads = new Map(state.leads);
            leads.set(leadId, { ...lead, isClosed: true, isSealed: false, liveRemainingMs: 0 });

            const auctionEndFeedbackMap = new Map(state.auctionEndFeedbackMap);
            auctionEndFeedbackMap.set(leadId, status);

            dbg('closeLead', leadId, 'status=', status);

            // Remove card from list after 8-second "Auction Ended" overlay
            setTimeout(() => {
                get().removeLead(leadId);
            }, 8_000);

            return { leads, auctionEndFeedbackMap };
        });
    },

    removeLead(leadId) {
        set((state) => {
            const leads = new Map(state.leads);
            leads.delete(leadId);
            const auctionEndFeedbackMap = new Map(state.auctionEndFeedbackMap);
            auctionEndFeedbackMap.delete(leadId);
            dbg('removeLead', leadId, '(8s overlay expired)');
            return {
                leads,
                auctionEndFeedbackMap,
                leadOrder: state.leadOrder.filter(id => id !== leadId),
            };
        });
    },

    getOrderedLeads() {
        const { leads, leadOrder } = get();
        const result: LeadSlice[] = [];
        for (const id of leadOrder) {
            const lead = leads.get(id);
            if (lead) result.push(lead);
        }
        return result;
    },
}));
