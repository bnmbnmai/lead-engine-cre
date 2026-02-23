import { io, Socket } from 'socket.io-client';
import { getAuthToken } from './api';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ============================================
// Types
// ============================================

export interface AuctionState {
    leadId: string;
    phase: 'BIDDING' | 'REVEAL' | 'RESOLVED' | 'CANCELLED';
    bidCount: number;
    highestBid: number | null;
    biddingEndsAt: string;
    revealEndsAt: string;
}

export interface BidEvent {
    leadId: string;
    bidCount: number;
    highestBid: number | null;
    timestamp: string;
}

export interface AuctionResolvedEvent {
    leadId: string;
    winnerId: string;
    winningAmount: number;
}

type AuctionEventHandler = {
    'auction:state': (state: AuctionState) => void;
    'auction:phase': (data: { leadId: string; phase: string; revealEndsAt?: string }) => void;
    'bid:new': (event: BidEvent) => void;
    'bid:confirmed': (data: { bidId: string; status: string }) => void;
    'auction:resolved': (event: AuctionResolvedEvent) => void;
    'auction:expired': (data: { leadId: string }) => void;
    'error': (data: { message: string }) => void;
    // Global marketplace events
    'marketplace:lead:new': (data: { lead: any }) => void;
    'marketplace:bid:update': (data: { leadId: string; bidCount: number; highestBid: number; timestamp?: string; buyerName?: string; recentBids?: Array<{ buyer: string; amount: number; ts: string }> }) => void;
    'marketplace:auction:resolved': (data: { leadId: string; winnerId: string; amount: number }) => void;
    'marketplace:refreshAll': () => void;
    // Auction end events (no-winner paths)
    'lead:unsold': (data: { leadId: string; buyNowPrice: number | null; expiresAt: string }) => void;
    'lead:status-changed': (data: { leadId: string; oldStatus: string; newStatus: string; remainingTime?: number }) => void;
    // Analytics real-time updates
    'analytics:update': (data: { type: string; leadId: string; buyerId: string; amount: number; vertical: string; timestamp: string }) => void;
    // Escrow lifecycle
    'lead:escrow-confirmed': (data: { leadId: string }) => void;
    // Dev log (ACE compliance events for DevLogPanel)
    'ace:dev-log': (data: { ts: string; action: string;[key: string]: unknown }) => void;
    // Demo E2E events
    'demo:log': (data: { ts: string; level: string; message: string; txHash?: string; basescanLink?: string; data?: Record<string, any>; cycle?: number; totalCycles?: number }) => void;
    'demo:complete': (data: { runId: string; status: string; totalCycles: number; totalSettled: number; error?: string }) => void;
    // demo:results-ready fires BEFORE recycle starts — carries partial cycle data for instant navigation
    'demo:results-ready': (data: { runId: string; status: string; totalCycles: number; totalSettled: number; elapsedSec?: number; cycles: any[] }) => void;
    // Recycle progress events
    'demo:recycle-progress': (data: { percent: number; step?: string }) => void;
    'demo:recycle-complete': () => void;
    'demo:reset-complete': (data: { ts: string; success: boolean; message?: string; error?: string }) => void;
    // Global demo state broadcast (for all viewers, including Guests)
    'demo:status': (data: { running: boolean; recycling: boolean; currentCycle: number; totalCycles: number; percent: number; phase: string; runId?: string; ts: string }) => void;
    // Live marketplace metrics (R-02: emitted every 5 s while demo runs, was 30 s)
    'demo:metrics': (data: { activeCount: number; leadsThisMinute: number; dailyRevenue: number }) => void;
    // ── AUCTION-SYNC events (added 2026-02-22) ──────────────────────────────────
    // auction:updated — server re-baselines remaining time on every bid so
    // frontend countdown timers stay locked to backend. Also carries isSealed flag
    // (5-second sealed-bid window) and updated bidCount / highestBid.
    'auction:updated': (data: {
        leadId: string;
        remainingTime: number | null;
        serverTs: number;          // ms epoch (Date.now()) — enables clock-drift correction
        bidCount: number;
        highestBid: number | null;
        isSealed?: boolean;   // true for the final 5 s sealed-bid window
    }) => void;
    // auction:closing-soon — server signals ≤10 s remaining (v7)
    'auction:closing-soon': (data: { leadId: string; remainingTime: number }) => void;
    // auction:closed — single authoritative signal that the auction is fully resolved.
    // Emitted AFTER all DB writes so frontend can freeze UI synchronously.
    'auction:closed': (data: {
        leadId: string;
        status: 'SOLD' | 'UNSOLD';
        remainingTime: 0;
        isClosed: true;
        serverTs: number;          // ms epoch
        winnerId?: string;
        winningAmount?: number;
        settleTxHash?: string;
        finalBids?: { buyerId: string; amount: number | null; status: string }[];
    }) => void;
    // leads:updated — backend signals that new leads were injected / replenishment ran.
    // socketBridge re-fetches active leads from REST API on receipt.
    'leads:updated': (data: { activeCount?: number }) => void;
    // R-01: real scheduler event — emitted the moment a buyer bid is committed,
    // before the vault lockForBid timeout fires on-chain.
    'auction:bid:pending': (data: { leadId: string; buyerName: string; amount: number; timestamp: string }) => void;
    // R-07: emitted by demo-lead-drip after initial seed loop completes
    'demo:pre-populated': (data: { leadCount: number; ts: string }) => void;
};


// All events forwarded from raw socket → this.listeners Map.
// Kept in sync with AuctionEventHandler above.
const ALL_EVENTS: (keyof AuctionEventHandler)[] = [
    'auction:state',
    'auction:phase',
    'bid:new',
    'bid:confirmed',
    'auction:resolved',
    'auction:expired',
    'error',
    'marketplace:lead:new',
    'marketplace:bid:update',
    'marketplace:auction:resolved',
    'marketplace:refreshAll',
    'lead:unsold',
    'lead:status-changed',
    'analytics:update',
    'lead:escrow-confirmed',
    'ace:dev-log',
    'demo:log',
    'demo:complete',
    'demo:results-ready',
    'demo:recycle-progress',
    'demo:recycle-complete',
    'demo:reset-complete',
    'demo:status',
    'demo:metrics',
    // ── AUCTION-SYNC: must be here or setupEventForwarding() silently drops them ──
    'auction:updated',
    'auction:closing-soon',
    'auction:closed',
    'leads:updated',
    // R-01: buyer bid commitment signal — emitted before vault lock fires
    'auction:bid:pending',
    // R-07: marketplace pre-populated signal
    'demo:pre-populated',
];


// ============================================
// Socket Singleton
// ============================================

class SocketClient {
    private socket: Socket | null = null;
    private listeners: Map<string, Set<Function>> = new Map();

    /**
     * setupEventForwarding — attaches one raw-socket listener per event that fans
     * data into this.listeners Map.
     *
     * Called at initial socket creation AND re-called on every 'connect' event so
     * that event forwarding survives:
     *   - socket.io auto-reconnect after server restart (Render cold start)
     *   - disconnect().connect() cycles triggered by reconnect()
     *
     * Idempotent: strips old forwarders via sock.off(event) before re-attaching
     * to prevent duplicate delivery on rapid reconnects.
     */
    private setupEventForwarding(sock: Socket): void {
        // Remove stale forwarders first to prevent double-firing
        ALL_EVENTS.forEach((event) => sock.off(event));

        // Attach fresh forwarders
        ALL_EVENTS.forEach((event) => {
            sock.on(event, (data: any) => {
                this._emit(event, data);
            });
        });
    }

    connect(): Socket {
        // Reuse existing socket — DevLogPanel depends on the same raw socket reference
        // for its status-dot listeners. Never create a second socket.
        if (this.socket) {
            return this.socket;
        }

        const token = getAuthToken();

        this.socket = io(SOCKET_URL, {
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnection: true,
            // Infinity ensures a Render cold start (which can take >5 connection
            // attempts) never permanently kills the socket. DevLogPanel won't go
            // permanently silent after a server reboot.
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 10000,
        });

        // Re-attach forwarders on every successful (re)connect.
        // This covers both:
        //   1. socket.io's own auto-reconnect (fires 'connect' after each attempt)
        //   2. The disconnect().connect() cycle in reconnect()
        this.socket.on('connect', () => {
            if (import.meta.env.DEV) console.log('[socket] connected:', this.socket?.id);
            this.setupEventForwarding(this.socket!);
        });

        this.socket.on('disconnect', (reason) => {
            if (import.meta.env.DEV) console.log('[socket] disconnected:', reason);
        });

        this.socket.on('connect_error', (error) => {
            if (import.meta.env.DEV) console.warn('[socket] connect_error:', error.message);
        });

        // Also attach immediately for the case where the socket is already connected
        // at creation time (e.g. Vite HMR hot-reload).
        this.setupEventForwarding(this.socket);

        return this.socket;
    }

    disconnect() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
        }
        this.socket = null;
    }

    /**
     * reconnect(token?) — swap auth token and re-handshake WITHOUT destroying
     * the socket instance. Preserves:
     *   - Raw `sock` references held by DevLogPanel (status-dot listeners)
     *   - All `this.listeners` Map entries (ace:dev-log, demo:log handlers)
     *
     * setupEventForwarding() is re-run automatically via the 'connect' event
     * handler registered in connect(), so forwarding is always restored.
     */
    reconnect(token?: string) {
        if (!this.socket) {
            this.connect();
            return;
        }
        // Update auth credential — next handshake will send the new JWT
        this.socket.auth = { token: token ?? getAuthToken() ?? undefined };
        // Drop current transport and open a new one.
        // The 'connect' event will fire on success and re-attach forwarders.
        this.socket.disconnect().connect();
    }

    // ============================================
    // Auction Room Management
    // ============================================

    joinAuction(leadId: string) {
        this.socket?.emit('join:auction', leadId);
    }

    leaveAuction(leadId: string) {
        this.socket?.emit('leave:auction', leadId);
    }

    placeBid(data: { leadId: string; commitment?: string; amount?: number }): Promise<{ bidId: string; status: string }> {
        const attempt = (): Promise<{ bidId: string; status: string }> => {
            return new Promise((resolve, reject) => {
                if (!this.socket?.connected) {
                    reject(new Error('Socket not connected'));
                    return;
                }

                const timeout = setTimeout(() => {
                    cleanupConfirmed();
                    cleanupError();
                    reject(new Error('timeout'));
                }, 10000);

                const cleanupConfirmed = this.on('bid:confirmed', (confirmed: any) => {
                    clearTimeout(timeout);
                    cleanupConfirmed();
                    cleanupError();
                    resolve(confirmed);
                });

                const cleanupError = this.on('error', (err: any) => {
                    clearTimeout(timeout);
                    cleanupConfirmed();
                    cleanupError();
                    reject(new Error(err.message || 'Bid failed'));
                });

                this.socket!.emit('bid:place', data);
            });
        };

        // Retry once on timeout
        return attempt().catch((err) => {
            if (err.message === 'timeout') {
                console.warn('[socketClient] Bid confirmation timeout — retrying (1/1)');
                return attempt();
            }
            throw err;
        }).catch((err) => {
            if (err.message === 'timeout') {
                throw new Error('Bid confirmation timeout — please try again');
            }
            throw err;
        });
    }

    // ============================================
    // Event Subscription
    // ============================================

    on<K extends keyof AuctionEventHandler>(event: K, handler: AuctionEventHandler[K]) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(handler);

        return () => {
            this.listeners.get(event)?.delete(handler);
        };
    }

    off<K extends keyof AuctionEventHandler>(event: K, handler: AuctionEventHandler[K]) {
        this.listeners.get(event)?.delete(handler);
    }

    private _emit(event: string, data: any) {
        // Frontend console.debug for every socket event arrival (visible in browser DevTools)
        if (import.meta.env.DEV || (typeof window !== 'undefined' && (window as any).__SOCKET_DEBUG__)) {
            console.debug(`[socket:rx] ${event}`, data);
        }
        this.listeners.get(event)?.forEach((handler) => handler(data));
    }

    /** Expose raw socket for dev-log and other untyped events */
    getSocket(): Socket | null {
        return this.socket;
    }

    isConnected(): boolean {
        return this.socket?.connected ?? false;
    }
}

export const socketClient = new SocketClient();
export default socketClient;
