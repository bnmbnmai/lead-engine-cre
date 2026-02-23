/**
 * auctionStore.ts — Zustand global auction state store
 *
 * v7 GOLDEN STANDARD: Pure server-authoritative phase machine.
 *
 * `auctionPhase` is the SOLE source of truth for card state.
 * It is driven exclusively by server socket events — never by local clock.
 *
 *   'live'          → auction running, Place Bid enabled
 *   'closing-soon'  → ≤10 s remaining (server-reported), pulsing countdown
 *   'closed'        → auction ended (server confirmed), greyed card, no action
 *
 * isClosed = auctionPhase === 'closed'
 *
 * Removal of all local-clock guards (v6 regression) was intentional:
 * they introduced inconsistency because Date.now() varies per-client.
 * The server is the authoritative clock.
 *
 * Clock-drift correction (preserved from v5/v6):
 *   effectiveRemaining = serverRemainingMs − (Date.now() − serverTs)
 * Used ONLY for the visual countdown; never for phase transitions.
 *
 * 45-second grace period:
 *   When `closeLead` fires, the lead stays in store (phase='closed')
 *   for 45 seconds before eviction — keeps the "ended" card visible.
 *
 * Debug: window.__AUCTION_DEBUG__ = true
 */

import { create } from 'zustand';

// ─── Types ──────────────────────────────────────────────────────────────────

/** v7: Server-authoritative phase. Drives isClosed and all button rendering. */
export type AuctionPhase = 'live' | 'closing-soon' | 'closed';

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
    // ── Live auction state (updated by socket) ───────────────────────────────
    /** v7: Server-authoritative phase — sole driver of isClosed / button rendering */
    auctionPhase: AuctionPhase;
    /** Derived convenience flag: true only when phase === 'closed' */
    isClosed: boolean;
    isSealed: boolean;
    liveBidCount: number | null;
    liveHighestBid: number | null;
    /** Server-corrected remaining ms — for visual countdown only, NOT for phase */
    liveRemainingMs: number | null;
    /** Timestamp when this lead was closed (ms epoch) */
    closedAt?: number;
    /** v9: Timestamp when the card should BEGIN fading out (closedAt + 2500ms).
     *  The card's CSS transition drives opacity 1→ 0 over 2.5s then the
     *  removeLead setTimeout eliminates it from the DOM after CLOSE_GRACE_MS. */
    fadeOutAt?: number;
}

type AuctionEndFeedback = 'SOLD' | 'UNSOLD';

/** v9 Grace period: 15 s (was 45 s). Card fades out at 2.5 s then DOM removes at 15 s. */
const CLOSE_GRACE_MS = 15_000;

interface AuctionStoreState {
    /** All known leads, keyed by lead ID */
    leads: Map<string, LeadSlice>;
    /** 8-second "Auction Ended" overlay map, keyed by lead ID */
    auctionEndFeedbackMap: Map<string, AuctionEndFeedback>;
    /** Insertion-order IDs for stable list rendering (includes recentlyClosed) */
    leadOrder: string[];

    // ── Actions ──────────────────────────────────────────────────────────────
    addLead: (lead: Omit<LeadSlice, 'isClosed' | 'isSealed' | 'liveBidCount' | 'liveHighestBid' | 'liveRemainingMs' | 'auctionPhase'>) => void;
    bulkLoad: (leads: any[]) => void;
    updateBid: (data: {
        leadId: string;
        remainingTime?: number | null;
        serverTs?: number;
        bidCount?: number;
        highestBid?: number | null;
        isSealed?: boolean;
    }) => void;
    /**
     * v7: Set phase to 'closing-soon' when server emits auction:closing-soon.
     * No isClosed change — card stays fully interactive but shows urgency.
     */
    setClosingSoon: (leadId: string) => void;
    closeLead: (leadId: string, status: AuctionEndFeedback) => void;
    removeLead: (leadId: string) => void;
    getOrderedLeads: () => LeadSlice[];
    forceRefreshLead: (leadId: string) => Promise<void>;
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
    // v7: phase is always 'live' on API read — phase transitions come from socket only.
    // The one exception: non-IN_AUCTION statuses start as 'closed'.
    const phase: AuctionPhase = lead.status === 'IN_AUCTION' ? 'live' : 'closed';
    // v10: seed liveBidCount from API _count.bids so bulkLoad never shows 0
    // when real bids have already been recorded in the DB.
    const seedBidCount: number | null = lead._count?.bids ?? null;
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
        auctionPhase: phase,
        isClosed: phase === 'closed',
        isSealed: false,
        liveBidCount: seedBidCount,
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
            const existing = state.leads.get(lead.id);
            if (existing) {
                if (!existing.isClosed) return state;
                if (lead.status !== 'IN_AUCTION') return state;
            }
            const isActuallyLive = lead.status === 'IN_AUCTION';
            const phase: AuctionPhase = isActuallyLive ? 'live' : 'closed';
            const slice: LeadSlice = {
                ...lead,
                auctionPhase: phase,
                isClosed: !isActuallyLive,
                isSealed: false,
                liveBidCount: lead._count?.bids ?? null,  // BUG-5 fix: seed from API data; was always null causing 0-bid display
                liveHighestBid: null,
                liveRemainingMs: isActuallyLive && lead.auctionEndAt
                    ? Math.max(0, new Date(lead.auctionEndAt).getTime() - Date.now())
                    : 0,
            };
            const leads = new Map(state.leads);
            leads.set(lead.id, slice);
            dbg('addLead', lead.id, 'phase=', phase, 'auctionEndAt=', lead.auctionEndAt);
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
                    if (existing.isClosed) {
                        // Don't resurrect a server-closed lead from an API refetch
                        continue;
                    }
                    // Merge: update static fields but preserve live socket-driven state.
                    // v10: liveBidCount = max(socket-driven, api _count.bids) — bids are
                    // monotonic; the higher of the two is always more accurate.
                    const apiCount = al._count?.bids ?? null;
                    const mergedBidCount = (existing.liveBidCount != null && apiCount != null)
                        ? Math.max(existing.liveBidCount, apiCount)
                        : (existing.liveBidCount ?? apiCount);
                    leads.set(al.id, {
                        ...apiLeadToSlice(al),
                        auctionPhase: existing.auctionPhase,
                        isClosed: existing.isClosed,
                        isSealed: existing.isSealed,
                        liveBidCount: mergedBidCount,
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
            if (!lead) return state;
            if (lead.isClosed) return state; // phase='closed' — never re-open

            // Clock-drift correction for VISUAL countdown only — not for phase
            let liveRemainingMs = lead.liveRemainingMs;
            let phase = lead.auctionPhase;
            if (remainingTime != null) {
                const networkDelayMs = serverTs != null ? Math.max(0, Date.now() - serverTs) : 0;
                liveRemainingMs = Math.max(0, remainingTime - networkDelayMs);
                // v8: Only advance phase toward closing-soon from server remainingTime;
                // closing phase='closed' ONLY via auction:closed event, not from a stale
                // remainingTime=0 that could arrive before the server confirms closure.
                if (liveRemainingMs <= 10_000 && liveRemainingMs > 0) {
                    phase = 'closing-soon';
                } else if (liveRemainingMs > 10_000) {
                    phase = 'live';
                }
                // liveRemainingMs===0 → leave phase unchanged (auction:closed is authoritative)
            }

            const updated: LeadSlice = {
                ...lead,
                auctionPhase: phase,
                isClosed: phase === 'closed',
                // v10: liveBidCount is strictly monotonic — never decrement during an active
                // auction. auctionRoom.bidCount can lag behind real bids (updated lazily);
                // use the incoming count only if it is greater than what we already have.
                liveBidCount: bidCount != null
                    ? Math.max(bidCount, lead.liveBidCount ?? 0)
                    : lead.liveBidCount,
                liveHighestBid: highestBid ?? lead.liveHighestBid,
                liveRemainingMs,
                isSealed: isSealed ?? lead.isSealed,
            };

            const leads = new Map(state.leads);
            leads.set(leadId, updated);

            dbg('updateBid', leadId,
                `phase=${phase}`,
                `remaining=${liveRemainingMs}ms`,
                `bidCount=${updated.liveBidCount}`);

            // v8: phase='closed' is only set by auction:closed event — not from remainingTime=0.
            // Remove the forceRefreshLead trigger here to prevent premature close/reappear.

            return { leads };
        });
    },

    setClosingSoon(leadId) {
        set((state) => {
            const lead = state.leads.get(leadId);
            if (!lead || lead.isClosed) return state;
            const leads = new Map(state.leads);
            leads.set(leadId, {
                ...lead,
                auctionPhase: 'closing-soon',
            });
            dbg('setClosingSoon', leadId);
            return { leads };
        });
    },

    closeLead(leadId, status) {
        set((state) => {
            const lead = state.leads.get(leadId);
            if (!lead) return state;
            // v6 SOLD-upgrade preserved: allow SOLD to upgrade an existing UNSOLD close.
            if (lead.isClosed) {
                if (lead.status === 'SOLD') return state; // already sold — never demote
                if (status !== 'SOLD') return state;      // UNSOLD→UNSOLD is a no-op
                // Fall through: upgrading UNSOLD → SOLD
            }

            // v8: Premature-close guard. If server is reporting the lead still has
            // >5 s remaining, this auction:closed event is likely a stale duplicate
            // from the auction-closure service racing with the demo orchestrator.
            // Let the authoritative auction:closed with remainingTime=0 close it.
            if (!lead.isClosed && (lead.liveRemainingMs ?? 0) > 5_000) {
                dbg('closeLead IGNORED (premature)', leadId,
                    `liveRemainingMs=${lead.liveRemainingMs}ms > 5000ms guard`);
                return state;
            }

            const now = Date.now();
            const leads = new Map(state.leads);
            leads.set(leadId, {
                ...lead,
                auctionPhase: 'closed',
                isClosed: true,
                isSealed: false,
                liveRemainingMs: 0,
                status: status === 'SOLD' ? 'SOLD' : 'UNSOLD',
                closedAt: now,
                // v9: card starts fading 100ms after closure (near-instant grey, then 2.5s opacity fade)
                fadeOutAt: now + 100,
            });

            const auctionEndFeedbackMap = new Map(state.auctionEndFeedbackMap);
            auctionEndFeedbackMap.set(leadId, status);

            dbg('closeLead', leadId, 'status=', status);

            // Clear 8-second overlay then evict after 45s grace
            setTimeout(() => {
                const { auctionEndFeedbackMap: m } = get();
                const next = new Map(m);
                next.delete(leadId);
                useAuctionStore.setState({ auctionEndFeedbackMap: next });
            }, 8_000);

            setTimeout(() => {
                get().removeLead(leadId);
            }, CLOSE_GRACE_MS);

            return { leads, auctionEndFeedbackMap };
        });
    },

    removeLead(leadId) {
        set((state) => {
            const leads = new Map(state.leads);
            leads.delete(leadId);
            const auctionEndFeedbackMap = new Map(state.auctionEndFeedbackMap);
            auctionEndFeedbackMap.delete(leadId);
            dbg('removeLead', leadId, `(${CLOSE_GRACE_MS / 1000}s grace expired)`);
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

    async forceRefreshLead(leadId: string) {
        const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
        try {
            const res = await fetch(`${apiBase}/api/v1/leads/${leadId}`);
            if (!res.ok) return;
            const data = await res.json();
            const lead = data?.lead ?? data;
            if (!lead?.id) return;

            const { closeLead, bulkLoad } = get();
            if (lead.status === 'SOLD') {
                closeLead(lead.id, 'SOLD');
            } else if (lead.status === 'UNSOLD') {
                closeLead(lead.id, 'UNSOLD');
            } else if (lead.status === 'IN_AUCTION') {
                bulkLoad([lead]);
            }
            dbg('forceRefreshLead', leadId, 'resolved status=', lead.status);
        } catch {
            dbg('forceRefreshLead', leadId, 'fetch failed (non-fatal)');
        }
    },
}));
