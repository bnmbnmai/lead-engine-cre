import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyToken } from '../middleware/auth';
import { corsOriginFn } from '../config/cors';
import { prisma } from '../lib/prisma';
import { aceDevBus } from '../services/ace.service';
import { checkActivityThreshold } from '../services/holder-perks.service';
import { SPAM_THRESHOLD_BIDS_PER_MINUTE } from '../config/perks.env';
import { setHolderNotifyOptIn } from '../services/notification.service';
import { placeSealedBid } from '../services/bid.service';
import { initQueues } from '../lib/queues';

/** Per-user debounce map for notify-optin (prevents rapid toggling) */
const NOTIFY_DEBOUNCE_MS = 10_000; // 10 seconds
const notifyDebounceMap = new Map<string, number>();
export { NOTIFY_DEBOUNCE_MS, notifyDebounceMap }; // Export for testing

/**
 * Debounced notify handler — lodash-inspired trailing-edge debounce.
 * Emits 'holder:notify-pending' with ARIA 'Updating...' immediately,
 * then executes after debounce window. Prevents rapid toggling.
 */
class DebouncedNotifyHandler {
    private pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

    /**
     * Debounce a notify-optin toggle.
     * Returns true if the call was debounced (pending), false if executed immediately.
     */
    handle(
        userId: string,
        optIn: boolean,
        socket: any,
        executor: (userId: string, optIn: boolean) => Promise<any>,
    ): boolean {
        // Check cooldown from last execution
        const lastCall = notifyDebounceMap.get(userId);
        const now = Date.now();

        if (lastCall && (now - lastCall) < NOTIFY_DEBOUNCE_MS) {
            const waitMs = NOTIFY_DEBOUNCE_MS - (now - lastCall);

            // Emit ARIA-friendly pending state
            socket.emit('holder:notify-pending', {
                status: 'debounced',
                message: `Updating... please wait ${Math.ceil(waitMs / 1000)}s`,
                ariaLive: 'assertive',
                role: 'status',
                retryAfterMs: waitMs,
            });

            // Cancel any existing pending timer for this user
            const existing = this.pendingTimers.get(userId);
            if (existing) clearTimeout(existing);

            // Schedule trailing-edge execution
            const timer = setTimeout(async () => {
                this.pendingTimers.delete(userId);
                notifyDebounceMap.set(userId, Date.now());
                try {
                    const result = await executor(userId, optIn);
                    socket.emit('holder:notify-status', {
                        ...result,
                        ariaLive: 'polite',
                        role: 'status',
                    });
                } catch (_error) {
                    socket.emit('error', { message: 'Failed to update notification preference' });
                }
            }, waitMs);

            this.pendingTimers.set(userId, timer);
            return true; // debounced
        }

        // Not debounced — execute immediately
        notifyDebounceMap.set(userId, now);
        return false;
    }

    /** Cancel all pending timers (for cleanup/testing) */
    cancelAll(): void {
        for (const timer of this.pendingTimers.values()) clearTimeout(timer);
        this.pendingTimers.clear();
    }

    get pendingCount(): number { return this.pendingTimers.size; }
}

const debouncedNotify = new DebouncedNotifyHandler();
export { DebouncedNotifyHandler, debouncedNotify };

interface AuthenticatedSocket extends Socket {
    userId?: string;
    walletAddress?: string;
    role?: string;
}

/**
 * SEALED-BID (Phase B2): the socket path accepts ONLY a commitment hash.
 * Plaintext amounts never cross the wire — the old `amount` field was the
 * sealed-bid leak the audit flagged and has been deleted. Buyers reveal via
 * POST /api/v1/bids/:bidId/reveal after the auction closes.
 */
interface BidEvent {
    leadId: string;
    commitment: string;
}

class RTBSocketServer {
    private io: Server;

    constructor(httpServer: HttpServer) {
        this.io = new Server(httpServer, {
            cors: {
                // Same allowlist as the Express CORS policy (config/cors.ts)
                origin: (origin, callback) => corsOriginFn(origin, callback),
                credentials: true,
            },
            pingTimeout: 60000,
            pingInterval: 25000,
        });

        this.setupMiddleware();
        this.setupEventHandlers();
        this.startAuctionMonitor();

        // Forward ACE dev-log events to all connected clients — demo/dev ONLY.
        // These entries can include bid amounts and rule labels, which must
        // never be broadcast on a production deployment (sealed-bid integrity).
        const devLogEnabled = process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEMO_ROUTES === 'true';
        if (devLogEnabled) {
            aceDevBus.on('ace:dev-log', (entry) => {
                this.io.emit('ace:dev-log', entry);
            });
        }
    }

    // ============================================
    // Authentication Middleware
    // ============================================

    private setupMiddleware() {
        this.io.use(async (socket: AuthenticatedSocket, next) => {
            try {
                const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

                // Allow unauthenticated (guest) connections — they can receive
                // broadcast events (demo:log, demo:complete, ace:dev-log) but
                // cannot bid or join auction rooms (guarded per-event below).
                if (!token) {
                    socket.userId = undefined;
                    socket.role = 'GUEST';
                    return next();
                }

                const decoded = verifyToken(token);
                if (!decoded) {
                    socket.userId = undefined;
                    socket.role = 'GUEST';
                    return next();
                }

                // Verify session
                const session = await prisma.session.findFirst({
                    where: {
                        userId: decoded.userId,
                        token,
                        expiresAt: { gt: new Date() },
                    },
                });

                if (!session) {
                    // Expired session — downgrade to guest rather than hard-disconnect
                    socket.userId = undefined;
                    socket.role = 'GUEST';
                    return next();
                }

                socket.userId = decoded.userId;
                socket.walletAddress = decoded.walletAddress;
                socket.role = decoded.role;

                next();
            } catch (_error) {
                // JWT verify failed — downgrade to guest
                socket.userId = undefined;
                socket.role = 'GUEST';
                next();
            }
        });
    }

    // ============================================
    // Event Handlers
    // ============================================

    private setupEventHandlers() {
        this.io.on('connection', (socket: AuthenticatedSocket) => {
            console.log(`Socket connected: ${socket.id} (user: ${socket.userId})`);

            // Join auction room
            socket.on('join:auction', async (leadId: string) => {
                try {
                    // Guests can observe broadcasts but cannot join auction rooms
                    if (!socket.userId || socket.role === 'GUEST') {
                        socket.emit('error', { message: 'Authentication required to join auction rooms' });
                        return;
                    }
                    const lead = await prisma.lead.findUnique({
                        where: { id: leadId },
                        include: { auctionRoom: true },
                    });

                    if (!lead || lead.status !== 'IN_AUCTION') {
                        socket.emit('error', { message: 'Auction not found or not active' });
                        return;
                    }

                    const roomId = `auction_${leadId}`;
                    socket.join(roomId);

                    // BUG-07: Use Set semantics — only add userId if not already a participant.
                    // Prisma push always appends, so without this guard every reconnect
                    // creates a duplicate entry.
                    if (lead.auctionRoom) {
                        const alreadyJoined = (lead.auctionRoom.participants as string[]).includes(socket.userId!);
                        if (!alreadyJoined) {
                            await prisma.auctionRoom.update({
                                where: { id: lead.auctionRoom.id },
                                data: {
                                    participants: {
                                        push: socket.userId!,
                                    },
                                },
                            });
                        }
                    }

                    // Send current auction state.
                    // SEALED-BID: never reveal the highest bid while the auction
                    // is live — join:auction is only possible for IN_AUCTION leads,
                    // so highestBid is always withheld here.
                    socket.emit('auction:state', {
                        leadId,
                        phase: lead.auctionRoom?.phase || 'BIDDING',
                        bidCount: lead.auctionRoom?.bidCount || 0,
                        highestBid: null,
                        biddingEndsAt: lead.auctionRoom?.biddingEndsAt || lead.auctionEndAt,
                    });

                    console.log(`User ${socket.userId} joined auction ${leadId}`);
                } catch (error) {
                    console.error('Join auction error:', error);
                    socket.emit('error', { message: 'Failed to join auction' });
                }
            });

            // Leave auction room
            socket.on('leave:auction', (leadId: string) => {
                socket.leave(`auction_${leadId}`);
                console.log(`User ${socket.userId} left auction ${leadId}`);
            });

            // Place bid via socket (for real-time)
            socket.on('bid:place', async (data: BidEvent) => {
                try {
                    if (!socket.userId || socket.role === 'GUEST') {
                        socket.emit('error', { message: 'Authentication required to place bids' });
                        return;
                    }

                    if (socket.role !== 'BUYER') {
                        socket.emit('error', { message: 'Only buyers can place bids' });
                        return;
                    }

                    // Spam prevention: check activity threshold
                    if (!checkActivityThreshold(socket.walletAddress || '')) {
                        socket.emit('error', { message: `Rate limit exceeded — max ${SPAM_THRESHOLD_BIDS_PER_MINUTE} bids per minute` });
                        return;
                    }

                    // SEALED-BID (Phase B2): reject any payload carrying a
                    // plaintext amount — the commitment hash is the only
                    // accepted bid representation on this transport.
                    if ((data as any).amount != null) {
                        socket.emit('error', { message: 'Plaintext bid amounts are not accepted — submit a sealed commitment' });
                        return;
                    }
                    if (!data.commitment) {
                        socket.emit('error', { message: 'Bid commitment is required' });
                        return;
                    }

                    // Canonical sealed-bid path — same service as HTTP/agents.
                    const result = await placeSealedBid({
                        leadId: data.leadId,
                        buyerId: socket.userId!,
                        walletAddress: socket.walletAddress,
                        commitment: data.commitment,
                        source: 'MANUAL',
                    });

                    if (!result.ok) {
                        socket.emit('error', { message: result.error || 'Failed to place bid' });
                        return;
                    }

                    // Broadcasts (new bids only — re-commits don't bump counts)
                    if (result.isNewBid) {
                        const lead = await prisma.lead.findUnique({
                            where: { id: data.leadId },
                            select: { auctionEndAt: true },
                        });

                        const roomId = `auction_${data.leadId}`;
                        this.io.to(roomId).emit('bid:new', {
                            leadId: data.leadId,
                            bidCount: result.bidCount,
                            isHolderBid: result.isHolder,
                            timestamp: new Date(),
                        });

                        // Global broadcast so marketplace cards update bid counts.
                        // SEALED-BID: bid AMOUNTS are never broadcast pre-close.
                        this.io.emit('marketplace:bid:update', {
                            leadId: data.leadId,
                            bidCount: result.bidCount,
                            timestamp: new Date().toISOString(),
                        });

                        // AUCTION-SYNC: emit server-authoritative remaining time
                        // so frontend timers re-baseline on every bid rather than
                        // drifting from the initial page-load timestamp.
                        // isSealed = true for the final 5 s — frontend shows 🔒 Sealed banner.
                        const auctionEndMs = lead?.auctionEndAt ? new Date(lead.auctionEndAt).getTime() : null;
                        const remainingTime = auctionEndMs ? Math.max(0, auctionEndMs - Date.now()) : null;
                        const isSealed = remainingTime != null && remainingTime <= 5_000;
                        // SEALED-BID: highestBid is never included pre-close.
                        this.io.emit('auction:updated', {
                            leadId: data.leadId,
                            remainingTime,
                            serverTs: Date.now(),   // ms epoch — frontend subtracts this for drift correction
                            bidCount: result.bidCount,
                            isSealed,
                        });
                        // v7: signal closing-soon when ≤10 s remain (before auction:closed)
                        if (remainingTime != null && remainingTime <= 10_000 && remainingTime > 0) {
                            this.io.emit('auction:closing-soon', {
                                leadId: data.leadId,
                                remainingTime,
                            });
                        }
                        console.log(`[SOCKET-EMIT] auction:updated leadId=${data.leadId} remaining=${remainingTime}ms bidCount=${result.bidCount} isSealed=${isSealed}`);
                    }

                    // Emit holder-specific event
                    if (result.isHolder) {
                        socket.emit('bid:holder', {
                            bidId: result.bid!.id,
                            multiplier: result.holderMultiplier,
                        });
                    }

                    socket.emit('bid:confirmed', {
                        bidId: result.bid!.id,
                        status: result.bid!.status,
                        isHolder: result.isHolder,
                    });
                } catch (error) {
                    console.error('Socket bid error:', error);
                    socket.emit('error', { message: 'Failed to place bid' });
                }
            });

            // Holder notification opt-in toggle (debounced — 10s trailing-edge per user)
            socket.on('holder:notify-optin', async (data: { optIn: boolean }) => {
                try {
                    if (!socket.userId) {
                        socket.emit('error', { message: 'Not authenticated' });
                        return;
                    }

                    // Use debounced handler — emits 'pending' ARIA state if throttled
                    const wasDebounced = debouncedNotify.handle(
                        socket.userId,
                        data.optIn,
                        socket,
                        setHolderNotifyOptIn,
                    );

                    if (!wasDebounced) {
                        // Execute immediately (not in cooldown)
                        const result = await setHolderNotifyOptIn(socket.userId, data.optIn);
                        socket.emit('holder:notify-status', {
                            ...result,
                            ariaLive: 'polite',
                            role: 'status',
                        });
                    }
                } catch (error) {
                    console.error('Notify opt-in error:', error);
                    socket.emit('error', { message: 'Failed to update notification preference' });
                }
            });

            // Disconnect
            socket.on('disconnect', () => {
                console.log(`Socket disconnected: ${socket.id}`);
            });
        });
    }

    // ============================================
    // Auction State Broadcaster (v8)
    // ============================================

    /**
     * v8: Periodically broadcast server-authoritative remaining time for ALL
     * active auctions. Before v8, auction:updated was only emitted on bid events,
     * so closing-soon was never signalled for low-bid or no-bid auctions.
     *
     * Emits per active lead:
     *   - auction:updated   (always, so clients keep countdown re-baselined)
     *   - auction:closing-soon  (only when remainingTime ≤ 12 000 ms, so clients
     *     transition to 'closing-soon' phase even with zero late bids)
     */
    private async broadcastActiveAuctionStates() {
        try {
            const now = new Date();
            // v10: broadcast to ALL active auctions (not just closing window) so every
            // lead gets a server-authoritative remainingTime re-baseline every 2 s.
            // The 12 s filter was leaving freshly seeded leads without any auction:updated
            // events for their entire lifetime until the last 12 s.
            const activeLeads = await prisma.lead.findMany({
                where: {
                    status: 'IN_AUCTION',
                    auctionEndAt: { gt: new Date(now.getTime() - 5_000) }, // include just-ended
                },
                select: {
                    id: true,
                    auctionEndAt: true,
                    // v10: _count.bids is the authoritative aggregated count;
                    // auctionRoom.bidCount lags and causes 1→0 flicker.
                    _count: { select: { bids: true } },
                },
            });

            const serverTs = Date.now();
            for (const lead of activeLeads) {
                const auctionEndMs = lead.auctionEndAt ? new Date(lead.auctionEndAt).getTime() : null;
                if (!auctionEndMs) continue;
                const remainingTime = Math.max(0, auctionEndMs - serverTs);
                const bidCount = lead._count?.bids ?? 0;

                // SEALED-BID: highestBid is never broadcast for live auctions.
                this.io.emit('auction:updated', {
                    leadId: lead.id,
                    remainingTime,
                    serverTs,
                    bidCount,
                    isSealed: remainingTime <= 5_000 && remainingTime > 0,
                });

                if (remainingTime <= 10_000 && remainingTime > 0) {
                    this.io.emit('auction:closing-soon', { leadId: lead.id, remainingTime });
                }

                if (process.env.NODE_ENV === 'development') {
                    console.log(`[AuctionMonitor] broadcast leadId=${lead.id} remaining=${remainingTime}ms bids=${bidCount}`);
                }
            }
        } catch (err) {
            console.error('[AuctionMonitor] broadcastActiveAuctionStates error:', err);
        }
    }

    private startAuctionMonitor() {
        // v8: broadcast server-authoritative remaining time for closing-window auctions
        // We still keep the broadcast running on a lightweight interval because it just 
        // emits websocket events, but the heavy lifting of resolving auctions is moved 
        // to BullMQ via initQueues.
        setInterval(async () => {
            try {
                await this.broadcastActiveAuctionStates();
            } catch (error) {
                console.error('Auction broadcast error:', error);
            }
        }, 2_000);

        // Initialize BullMQ Worker for auction resolutions (or fallback to Interval)
        initQueues(this.io);
    }

    // ============================================
    // Public Methods
    // ============================================

    public broadcastToAuction(leadId: string, event: string, data: any) {
        this.io.to(`auction_${leadId}`).emit(event, data);
    }

    public getIO() {
        return this.io;
    }
}

export default RTBSocketServer;
