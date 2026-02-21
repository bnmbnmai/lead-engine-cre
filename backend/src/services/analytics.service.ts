/**
 * analytics.service.ts — Real Analytics Event Service (P2-15)
 *
 * Replaces analytics-mock.ts. Provides:
 *  1. A singleton that holds a reference to the Socket.IO server, set once at boot.
 *  2. `emitAnalyticsEvent(event, payload)` — broadcasts structured events to all
 *     connected clients on the 'analytics:event' channel.
 *  3. Optional Prisma persistence to AnalyticsLog (JSON blob in Transaction model
 *     or a future dedicated model) — currently writes to an in-memory ring buffer
 *     (last 500 events) to avoid schema changes.
 *  4. Typed event constants for the canonical event vocabulary.
 *
 * Usage (in routes / services):
 *   import { analyticsService } from './analytics.service';
 *   analyticsService.emit('lead:created', { leadId, vertical, sellerId });
 *
 * Initialization (in index.ts, after socketServer is created):
 *   import { analyticsService } from './services/analytics.service';
 *   analyticsService.init(socketServer.getIO());
 */

import type { Server as IOServer } from 'socket.io';

// ─── Event Vocabulary ────────────────────────────────────────────────────────

export const ANALYTICS_EVENTS = {
    LEAD_CREATED: 'lead:created',
    LEAD_SOLD: 'lead:sold',
    BID_PLACED: 'bid:placed',
    AUCTION_RESOLVED: 'auction:resolved',
    ESCROW_RELEASED: 'escrow:released',
    DEMO_CYCLE_COMPLETE: 'demo:cycle-complete',
    PLATFORM_FEE: 'platform:fee',
} as const;

export type AnalyticsEventName = typeof ANALYTICS_EVENTS[keyof typeof ANALYTICS_EVENTS];

export interface AnalyticsEventPayload {
    event: AnalyticsEventName | string;
    ts: string;
    [key: string]: unknown;
}

// ─── In-memory ring buffer ───────────────────────────────────────────────────

const RING_BUFFER_SIZE = 500;

// ─── Singleton ───────────────────────────────────────────────────────────────

class AnalyticsService {
    private io: IOServer | null = null;
    private buffer: AnalyticsEventPayload[] = [];

    /**
     * Call once at server boot after Socket.IO is initialised.
     * analytics.routes.ts convenience endpoint can also call this lazily
     * via req.app.get('io').
     */
    init(io: IOServer): void {
        this.io = io;
    }

    /**
     * Inject the io instance lazily from a route handler.
     * Used when analytics.service needs to emit from inside routes that
     * already have access to req.app.get('io').
     */
    setIO(io: IOServer): void {
        if (!this.io) this.io = io;
    }

    /**
     * Emit a structured analytics event:
     *  - Broadcasts to all connected socket clients on 'analytics:event'
     *  - Pushes to the in-memory ring buffer (for the /events REST endpoint)
     */
    emit(event: AnalyticsEventName | string, payload: Record<string, unknown> = {}): void {
        const entry: AnalyticsEventPayload = {
            event,
            ts: new Date().toISOString(),
            ...payload,
        };

        // Ring-buffer append
        this.buffer.push(entry);
        if (this.buffer.length > RING_BUFFER_SIZE) {
            this.buffer.shift();
        }

        // Socket broadcast (best-effort — silently skips if io not yet initialised)
        if (this.io) {
            this.io.emit('analytics:event', entry);
        }
    }

    /**
     * Returns the last N events from the ring buffer (newest last).
     * Used by GET /api/v1/analytics/events.
     */
    getRecentEvents(limit = 100): AnalyticsEventPayload[] {
        return this.buffer.slice(-Math.min(limit, RING_BUFFER_SIZE));
    }

    /**
     * Returns the current buffer length. Useful for health-checks and tests.
     */
    get bufferSize(): number {
        return this.buffer.length;
    }

    /**
     * Clears the in-memory buffer. Primarily for testing.
     */
    _resetForTesting(): void {
        this.buffer = [];
        this.io = null;
    }
}

export const analyticsService = new AnalyticsService();
