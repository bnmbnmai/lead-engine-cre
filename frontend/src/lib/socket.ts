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

    // ============================================
    // Auction Room Management
    // ============================================

    joinAuction(leadId: string) {
        this.socket?.emit('join:auction', leadId);
    }

    leaveAuction(leadId: string) {
        this.socket?.emit('leave:auction', leadId);
    }

    placeBid(data: { leadId: string; commitment?: string; amount?: number }) {
        this.socket?.emit('bid:place', data);
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

    isConnected(): boolean {
        return this.socket?.connected ?? false;
    }
}

export const socketClient = new SocketClient();
export default socketClient;
