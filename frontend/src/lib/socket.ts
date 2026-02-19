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
    'marketplace:bid:update': (data: { leadId: string; bidCount: number; highestBid: number; timestamp?: string }) => void;
    'marketplace:auction:resolved': (data: { leadId: string; winnerId: string; amount: number }) => void;
    'marketplace:refreshAll': () => void;
    // Auction end events (no-winner paths)
    'lead:unsold': (data: { leadId: string; buyNowPrice: number | null; expiresAt: string }) => void;
    'lead:status-changed': (data: { leadId: string; oldStatus: string; newStatus: string }) => void;
    // Analytics real-time updates
    'analytics:update': (data: { type: string; leadId: string; buyerId: string; amount: number; vertical: string; timestamp: string }) => void;
    // Escrow lifecycle
    'lead:escrow-confirmed': (data: { leadId: string }) => void;
    // Dev log (ACE compliance events for DevLogPanel)
    'ace:dev-log': (data: { ts: string; action: string;[key: string]: unknown }) => void;
    // Demo E2E events
    'demo:log': (data: { ts: string; level: string; message: string; txHash?: string; basescanLink?: string; data?: Record<string, any>; cycle?: number; totalCycles?: number }) => void;
    'demo:complete': (data: { runId: string; status: string; totalCycles: number; totalSettled: number; error?: string }) => void;
    // Global demo state broadcast (for all viewers, including Guests)
    'demo:status': (data: { running: boolean; recycling: boolean; currentCycle: number; totalCycles: number; percent: number; phase: string; runId?: string; ts: string }) => void;
};

// ============================================
// Socket Singleton
// ============================================

class SocketClient {
    private socket: Socket | null = null;
    private listeners: Map<string, Set<Function>> = new Map();

    connect(): Socket {
        // If a socket already exists (connected or still handshaking), reuse it.
        // This prevents stacking duplicate io() instances that each fan events
        // into the same this.listeners Map.
        if (this.socket) {
            return this.socket;
        }

        const token = getAuthToken();

        this.socket = io(SOCKET_URL, {
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
        });

        this.socket.on('connect', () => {
            if (import.meta.env.DEV) console.log('Socket connected:', this.socket?.id);
        });

        this.socket.on('disconnect', (reason) => {
            if (import.meta.env.DEV) console.log('Socket disconnected:', reason);
        });

        this.socket.on('connect_error', (error) => {
            if (import.meta.env.DEV) console.warn('Socket connection error:', error.message);
        });

        // Re-emit events to listeners
        const events: (keyof AuctionEventHandler)[] = [
            'auction:state',
            'auction:phase',
            'bid:new',
            'bid:confirmed',
            'auction:resolved',
            'auction:expired',
            'error',
            // Global marketplace events
            'marketplace:lead:new',
            'marketplace:bid:update',
            'marketplace:auction:resolved',
            'marketplace:refreshAll',
            // Auction end events (no-winner paths)
            'lead:unsold',
            'lead:status-changed',
            'analytics:update',
            'lead:escrow-confirmed',
            // Dev log events
            'ace:dev-log',
            // Demo E2E events
            'demo:log',
            'demo:complete',
            // Global demo state (all viewers, including Guests)
            'demo:status',
        ];

        events.forEach((event) => {
            this.socket?.on(event, (data: any) => {
                this.emit(event, data);
            });
        });

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
     * the socket instance. This preserves:
     *   - All raw `sock` references held by DevLogPanel (status-dot listeners)
     *   - All `this.listeners` Map entries (ace:dev-log, demo:log handlers)
     *
     * Socket.IO's own `socket.disconnect().connect()` API replaces the transport
     * session while keeping the JS object identity, so no re-registration of
     * handlers is needed anywhere.
     *
     * Use this everywhere DemoPanel previously called disconnect()+connect().
     */
    reconnect(token?: string) {
        if (!this.socket) {
            // No socket yet — just do a normal connect with the new token
            this.connect();
            return;
        }
        // Update auth credential in-place so the next handshake sends the new JWT
        this.socket.auth = { token: token ?? getAuthToken() ?? undefined };
        // socket.io re-handshake: drops current transport, opens a new one
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

    private emit(event: string, data: any) {
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
