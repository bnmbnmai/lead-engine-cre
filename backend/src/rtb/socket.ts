import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { aceService, aceDevBus } from '../services/ace.service';
import {
    applyHolderPerks,
    applyMultiplier,
    checkActivityThreshold,
} from '../services/holder-perks.service';
import { SPAM_THRESHOLD_BIDS_PER_MINUTE } from '../config/perks.env';
import { setHolderNotifyOptIn } from '../services/notification.service';
import { resolveExpiredAuctions, resolveStuckAuctions, resolveExpiredBuyNow } from '../services/auction-closure.service';
import * as vaultService from '../services/vault.service';


const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

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

interface BidEvent {
    leadId: string;
    commitment?: string;
    amount?: number;
}

class RTBSocketServer {
    private io: Server;

    constructor(httpServer: HttpServer) {
        this.io = new Server(httpServer, {
            cors: {
                // Permissive for demo — matches Express CORS policy in index.ts
                origin: true,
                credentials: true,
            },
            pingTimeout: 60000,
            pingInterval: 25000,
        });

        this.setupMiddleware();
        this.setupEventHandlers();
        this.startAuctionMonitor();

        // Forward ACE dev-log events to all connected clients (demo mode only)
        aceDevBus.on('ace:dev-log', (entry) => {
            this.io.emit('ace:dev-log', entry);
        });
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

                const decoded = jwt.verify(token, JWT_SECRET) as any;

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

                    // Send current auction state
                    socket.emit('auction:state', {
                        leadId,
                        phase: lead.auctionRoom?.phase || 'BIDDING',
                        bidCount: lead.auctionRoom?.bidCount || 0,
                        highestBid: lead.auctionRoom?.highestBid ? Number(lead.auctionRoom.highestBid) : null,
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

                    const lead = await prisma.lead.findUnique({
                        where: { id: data.leadId },
                        include: { auctionRoom: true },
                    });

                    if (!lead || lead.status !== 'IN_AUCTION') {
                        socket.emit('error', { message: 'Auction not active' });
                        return;
                    }

                    // Check compliance
                    const compliance = await aceService.canTransact(
                        socket.walletAddress!,
                        lead.vertical,
                        (lead.geo as any)?.geoHash || ''
                    );

                    if (!compliance.allowed) {
                        socket.emit('error', { message: compliance.reason });
                        return;
                    }

                    // Check holder perks
                    const perks = await applyHolderPerks(lead.vertical, socket.walletAddress);

                    // ── On-chain vault balance check + lock ──
                    // If bid has an amount, lock funds on-chain (bid + $1 fee)
                    const bidAmount = data.amount ?? null;
                    let vaultLockId: number | undefined;
                    if (bidAmount && bidAmount > 0 && socket.walletAddress) {
                        // If re-bidding, refund the previous lock first to avoid orphan locks
                        const existingBidForLock = await prisma.bid.findUnique({
                            where: { leadId_buyerId: { leadId: data.leadId, buyerId: socket.userId! } },
                            select: { escrowTxHash: true },
                        });
                        if (existingBidForLock?.escrowTxHash?.startsWith('vaultLock:')) {
                            const oldLockId = parseInt(existingBidForLock.escrowTxHash.split(':')[1], 10);
                            if (oldLockId > 0) {
                                try {
                                    await vaultService.refundBid(oldLockId, socket.userId!, data.leadId);
                                    console.log(`[Socket] Refunded old vault lock #${oldLockId} before re-bid`);
                                } catch (refundErr: any) {
                                    console.warn(`[Socket] Failed to refund old lock #${oldLockId}:`, refundErr.message);
                                }
                            }
                        }

                        const vaultCheck = await vaultService.checkBidBalance(socket.walletAddress, bidAmount);
                        if (!vaultCheck.ok) {
                            socket.emit('error', {
                                message: `Insufficient vault balance: $${vaultCheck.balance.toFixed(2)} < $${vaultCheck.required.toFixed(2)} required (bid + $1 fee). Fund your vault first.`,
                            });
                            return;
                        }

                        // Atomic on-chain lock: bid amount + $1 fee
                        const lockResult = await vaultService.lockForBid(
                            socket.walletAddress, bidAmount, socket.userId!, data.leadId
                        );
                        if (!lockResult.success) {
                            socket.emit('error', { message: lockResult.error || 'Failed to lock vault funds on-chain' });
                            return;
                        }
                        vaultLockId = lockResult.lockId;
                    }

                    // Create sealed bid (commit-reveal)
                    const existingBid = await prisma.bid.findUnique({
                        where: { leadId_buyerId: { leadId: data.leadId, buyerId: socket.userId! } },
                    });
                    const isNewBid = !existingBid;

                    const effectiveBid = bidAmount && perks.isHolder
                        ? applyMultiplier(bidAmount, perks.multiplier)
                        : bidAmount;

                    const bid = await prisma.bid.upsert({
                        where: {
                            leadId_buyerId: { leadId: data.leadId, buyerId: socket.userId! },
                        },
                        create: {
                            leadId: data.leadId,
                            buyerId: socket.userId!,
                            commitment: data.commitment,
                            amount: bidAmount,
                            effectiveBid,
                            isHolder: perks.isHolder,
                            escrowTxHash: vaultLockId ? `vaultLock:${vaultLockId}` : ((data as any).escrowTxHash || null),
                            status: 'PENDING',
                        },
                        update: {
                            commitment: data.commitment,
                            amount: bidAmount ?? undefined,
                            effectiveBid: effectiveBid ?? undefined,
                            isHolder: perks.isHolder,
                            escrowTxHash: vaultLockId ? `vaultLock:${vaultLockId}` : ((data as any).escrowTxHash || undefined),
                            status: 'PENDING',
                        },
                    });

                    // Update auction room bid count (only for NEW bids)
                    if (lead.auctionRoom && isNewBid) {
                        await prisma.auctionRoom.update({
                            where: { id: lead.auctionRoom.id },
                            data: { bidCount: { increment: 1 } },
                        });

                        // Broadcast to auction room members
                        const roomId = `auction_${data.leadId}`;
                        this.io.to(roomId).emit('bid:new', {
                            leadId: data.leadId,
                            bidCount: (lead.auctionRoom.bidCount || 0) + 1,
                            isHolderBid: perks.isHolder,
                            timestamp: new Date(),
                        });

                        // Global broadcast so marketplace cards update bid counts
                        this.io.emit('marketplace:bid:update', {
                            leadId: data.leadId,
                            bidCount: (lead.auctionRoom.bidCount || 0) + 1,
                            highestBid: effectiveBid ?? bidAmount ?? null,
                            timestamp: new Date().toISOString(),
                        });

                        // AUCTION-SYNC: emit server-authoritative remaining time
                        // so frontend timers re-baseline on every bid rather than
                        // drifting from the initial page-load timestamp.
                        // isSealed = true for the final 5 s — frontend shows 🔒 Sealed banner.
                        const auctionEndMs = lead.auctionEndAt ? new Date(lead.auctionEndAt).getTime() : null;
                        const remainingTime = auctionEndMs ? Math.max(0, auctionEndMs - Date.now()) : null;
                        const isSealed = remainingTime != null && remainingTime <= 5_000;
                        const updatedBidCount = (lead.auctionRoom.bidCount || 0) + 1;
                        const updatedHighestBid = effectiveBid ?? bidAmount ?? null;
                        this.io.emit('auction:updated', {
                            leadId: data.leadId,
                            remainingTime,
                            serverTs: Date.now(),   // ms epoch — frontend subtracts this for drift correction
                            bidCount: updatedBidCount,
                            highestBid: updatedHighestBid,
                            isSealed,
                        });
                        // v7: signal closing-soon when ≤10 s remain (before auction:closed)
                        if (remainingTime != null && remainingTime <= 10_000 && remainingTime > 0) {
                            this.io.emit('auction:closing-soon', {
                                leadId: data.leadId,
                                remainingTime,
                            });
                        }
                        console.log(`[SOCKET-EMIT] auction:updated leadId=${data.leadId} remaining=${remainingTime}ms bidCount=${updatedBidCount} isSealed=${isSealed}`);
                    }

                    // Emit holder-specific event
                    if (perks.isHolder) {
                        socket.emit('bid:holder', {
                            bidId: bid.id,
                            multiplier: perks.multiplier,
                            prePingSeconds: perks.prePingSeconds,
                        });
                    }

                    socket.emit('bid:confirmed', {
                        bidId: bid.id,
                        status: bid.status,
                        isHolder: perks.isHolder,
                    });

                    // Log event
                    await prisma.analyticsEvent.create({
                        data: {
                            eventType: perks.isHolder ? 'holder_bid_placed_realtime' : 'bid_placed_realtime',
                            entityType: 'bid',
                            entityId: bid.id,
                            userId: socket.userId,
                            metadata: perks.isHolder ? {
                                multiplier: perks.multiplier,
                            } : undefined,
                        },
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
                    auctionRoom: { select: { highestBid: true } },
                },
            });

            const serverTs = Date.now();
            for (const lead of activeLeads) {
                const auctionEndMs = lead.auctionEndAt ? new Date(lead.auctionEndAt).getTime() : null;
                if (!auctionEndMs) continue;
                const remainingTime = Math.max(0, auctionEndMs - serverTs);
                const bidCount = lead._count?.bids ?? 0;

                this.io.emit('auction:updated', {
                    leadId: lead.id,
                    remainingTime,
                    serverTs,
                    bidCount,
                    highestBid: lead.auctionRoom?.highestBid ? Number(lead.auctionRoom.highestBid) : null,
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
        setInterval(async () => {
            try {
                // v8: broadcast server-authoritative remaining time for closing-window auctions
                await this.broadcastActiveAuctionStates();
                // Delegate auction lifecycle management to the shared service
                await resolveExpiredAuctions(this.io);
                await resolveExpiredBuyNow(this.io);
                await resolveStuckAuctions(this.io);
            } catch (error) {
                console.error('Auction monitor error:', error);
            }
        }, 2_000); // v8: 2 s (was 5 s) — ensures at least 5 broadcasts in closing-soon window
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
