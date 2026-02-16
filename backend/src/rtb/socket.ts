import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { aceService } from '../services/ace.service';
import {
    applyHolderPerks,
    applyMultiplier,
    checkActivityThreshold,
} from '../services/holder-perks.service';
import { setHolderNotifyOptIn, getHolderNotifyOptIn } from '../services/notification.service';
import { fireConversionEvents, ConversionPayload } from '../services/conversion-tracking.service';
import { x402Service } from '../services/x402.service';

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
                } catch (error) {
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
                origin: process.env.FRONTEND_URL || 'http://localhost:5173',
                credentials: true,
            },
            pingTimeout: 60000,
            pingInterval: 25000,
        });

        this.setupMiddleware();
        this.setupEventHandlers();
        this.startAuctionMonitor();
    }

    // ============================================
    // Authentication Middleware
    // ============================================

    private setupMiddleware() {
        this.io.use(async (socket: AuthenticatedSocket, next) => {
            try {
                const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

                if (!token) {
                    return next(new Error('Authentication required'));
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
                    return next(new Error('Invalid session'));
                }

                socket.userId = decoded.userId;
                socket.walletAddress = decoded.walletAddress;
                socket.role = decoded.role;

                next();
            } catch (error) {
                next(new Error('Authentication failed'));
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

                    // Add to participants
                    if (lead.auctionRoom) {
                        await prisma.auctionRoom.update({
                            where: { id: lead.auctionRoom.id },
                            data: {
                                participants: {
                                    push: socket.userId!,
                                },
                            },
                        });
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
                    if (socket.role !== 'BUYER') {
                        socket.emit('error', { message: 'Only buyers can place bids' });
                        return;
                    }

                    // Spam prevention: check activity threshold
                    if (!checkActivityThreshold(socket.walletAddress || '')) {
                        socket.emit('error', { message: 'Rate limit exceeded — max 5 bids per minute' });
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



                    // Create sealed bid (commit-reveal)
                    // Check if this is a new bid or update (for bidCount accuracy)
                    const existingBid = await prisma.bid.findUnique({
                        where: { leadId_buyerId: { leadId: data.leadId, buyerId: socket.userId! } },
                    });
                    const isNewBid = !existingBid;

                    // When amount is sent alongside commitment, store it immediately
                    // This ensures resolveAuction can find the bid even if auto-reveal fails
                    const bidAmount = data.amount ?? null;
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
                            status: 'PENDING',
                        },
                        update: {
                            commitment: data.commitment,
                            amount: bidAmount ?? undefined,
                            effectiveBid: effectiveBid ?? undefined,
                            isHolder: perks.isHolder,
                            status: 'PENDING',
                        },
                    });

                    // Update auction room bid count (only for NEW bids)
                    if (lead.auctionRoom && isNewBid) {
                        await prisma.auctionRoom.update({
                            where: { id: lead.auctionRoom.id },
                            data: { bidCount: { increment: 1 } },
                        });

                        // Broadcast to room
                        const roomId = `auction_${data.leadId}`;
                        this.io.to(roomId).emit('bid:new', {
                            leadId: data.leadId,
                            bidCount: (lead.auctionRoom.bidCount || 0) + 1,
                            isHolderBid: perks.isHolder,
                            timestamp: new Date(),
                        });
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
    // Auction Monitor (Background Process)
    // ============================================

    private startAuctionMonitor() {
        setInterval(async () => {
            try {
                const now = new Date();

                // ── Expired Auction Sweep ──
                // Find all IN_AUCTION leads whose 60s window has expired
                const expiredAuctions = await prisma.lead.findMany({
                    where: {
                        status: 'IN_AUCTION',
                        auctionEndAt: { lte: now },
                    },
                    select: { id: true, vertical: true, reservePrice: true },
                });

                for (const lead of expiredAuctions) {
                    await this.resolveAuction(lead.id);
                }

                // ── Buy It Now expiry sweep ──
                // Transition stale UNSOLD leads past their expiresAt to EXPIRED
                const expiredBinLeads = await prisma.lead.findMany({
                    where: {
                        status: 'UNSOLD',
                        expiresAt: { lte: now },
                    },
                    select: { id: true },
                });

                if (expiredBinLeads.length > 0) {
                    await prisma.lead.updateMany({
                        where: {
                            id: { in: expiredBinLeads.map((l) => l.id) },
                            status: 'UNSOLD',
                        },
                        data: { status: 'EXPIRED' },
                    });

                    for (const lead of expiredBinLeads) {
                        this.io.emit('lead:bin-expired', { leadId: lead.id });
                    }

                    console.log(`Expired ${expiredBinLeads.length} stale Buy It Now leads`);
                }
            } catch (error) {
                console.error('Auction monitor error:', error);
            }
        }, 2000); // Check every 2 seconds (keeps "Processing..." brief)
    }

    // ============================================
    // Auction Resolution
    // ============================================

    /**
     * Convert a lead with no winner to Buy It Now (UNSOLD).
     * Sets buyNowPrice = reservePrice × 1.2 and a 7-day expiry window.
     */
    private async convertToUnsold(leadId: string, lead: any) {
        const reservePrice = lead.reservePrice ? Number(lead.reservePrice) : null;
        const binPrice = reservePrice ? reservePrice * 1.2 : null;
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        await prisma.$transaction([
            prisma.lead.update({
                where: { id: leadId },
                data: {
                    status: 'UNSOLD',
                    buyNowPrice: binPrice,
                    expiresAt,
                },
            }),
            prisma.auctionRoom.updateMany({
                where: { leadId },
                data: { phase: 'CANCELLED' },
            }),
            // Expire any remaining pending bids
            prisma.bid.updateMany({
                where: { leadId, status: { in: ['PENDING', 'REVEALED'] } },
                data: { status: 'EXPIRED', processedAt: new Date() },
            }),
        ]);

        // Notify auction room + global marketplace listeners
        this.io.to(`auction_${leadId}`).emit('lead:unsold', {
            leadId,
            buyNowPrice: binPrice,
            expiresAt: expiresAt.toISOString(),
        });

        // Broadcast to marketplace for real-time BIN tab updates
        this.io.emit('marketplace:new-bin', {
            leadId,
            vertical: lead.vertical,
            buyNowPrice: binPrice,
            auctionDuration: lead.ask?.auctionDuration ?? 60,
            expiresAt: expiresAt.toISOString(),
        });

        // Notify all clients that this lead left Live Leads → Buy Now
        this.io.emit('lead:status-changed', {
            leadId,
            oldStatus: 'IN_AUCTION',
            newStatus: 'UNSOLD',
            buyNowPrice: binPrice,
            expiresAt: expiresAt.toISOString(),
        });

        // Log analytics
        await prisma.analyticsEvent.create({
            data: {
                eventType: 'lead_unsold_bin_created',
                entityType: 'lead',
                entityId: leadId,
                metadata: { buyNowPrice: binPrice, reservePrice },
            },
        });

        console.log(`Auction ${leadId} → UNSOLD (Buy It Now: $${binPrice?.toFixed(2) ?? 'N/A'})`);
    }

    private async resolveAuction(leadId: string) {
        try {
            // Fetch the lead with reserve price for below-reserve check
            const lead = await prisma.lead.findUnique({
                where: { id: leadId },
                select: { id: true, vertical: true, reservePrice: true },
            });

            if (!lead) {
                console.error(`resolveAuction: lead ${leadId} not found`);
                return;
            }

            // ── Auto-reveal PENDING sealed bids ──
            // In the commit-reveal demo flow, bids are committed with a base64
            // commitment of "amount:salt". At auction end we decode and reveal
            // them so the standard resolution logic can find a winner.
            const pendingBids = await prisma.bid.findMany({
                where: { leadId, status: 'PENDING', commitment: { not: null } },
            });

            for (const bid of pendingBids) {
                try {
                    // If bid already has amount (from auto-bid or API-placed bid), just reveal it
                    if (bid.amount != null && Number(bid.amount) > 0) {
                        const perks = await applyHolderPerks(lead.vertical, bid.buyerId);
                        const effectiveBid = perks.isHolder
                            ? applyMultiplier(Number(bid.amount), perks.multiplier)
                            : Number(bid.amount);
                        await prisma.bid.update({
                            where: { id: bid.id },
                            data: { status: 'REVEALED', effectiveBid, processedAt: new Date() },
                        });
                        console.log(`[AUCTION] Auto-revealed bid ${bid.id} (had amount): $${Number(bid.amount)} (effective: $${effectiveBid})`);
                        continue;
                    }

                    // Try base64 decode for legacy demo format
                    const decoded = Buffer.from(bid.commitment!, 'base64').toString('utf-8');
                    const [amountStr] = decoded.split(':');
                    const amount = parseFloat(amountStr);
                    if (isNaN(amount) || amount <= 0) {
                        await prisma.bid.update({
                            where: { id: bid.id },
                            data: { status: 'EXPIRED', processedAt: new Date() },
                        });
                        continue;
                    }

                    // Apply holder multiplier if applicable
                    const perks = await applyHolderPerks(lead.vertical, bid.buyerId);
                    const effectiveBid = perks.isHolder
                        ? applyMultiplier(amount, perks.multiplier)
                        : amount;

                    await prisma.bid.update({
                        where: { id: bid.id },
                        data: {
                            status: 'REVEALED',
                            amount,
                            effectiveBid,
                            processedAt: new Date(),
                        },
                    });
                    console.log(`[AUCTION] Auto-revealed bid ${bid.id}: $${amount} (effective: $${effectiveBid})`);
                } catch (err: any) {
                    console.warn(`[AUCTION] Failed to auto-reveal bid ${bid.id}:`, err.message);
                    await prisma.bid.update({
                        where: { id: bid.id },
                        data: { status: 'EXPIRED', processedAt: new Date() },
                    });
                }
            }

            // Fallback ordering: effectiveBid DESC → isHolder DESC (tie-breaker) → amount DESC → createdAt ASC
            // Holders win ties; at equal everything, first bidder wins
            const rankedBids = await prisma.bid.findMany({
                where: {
                    leadId,
                    status: 'REVEALED',
                    amount: { not: null },
                },
                orderBy: [
                    { effectiveBid: { sort: 'desc', nulls: 'last' } },
                    { isHolder: 'desc' },
                    { amount: 'desc' },
                    { createdAt: 'asc' },
                ],
                include: { buyer: true },
            });

            // No valid bids → convert to Buy It Now
            if (rankedBids.length === 0) {
                await this.convertToUnsold(leadId, lead);
                return;
            }

            const reservePrice = lead.reservePrice ? Number(lead.reservePrice) : 0;

            // ── Find the highest bidder who meets reserve ──
            // No USDC pre-check: the escrow contract is the real enforcement point.
            let winningBid: typeof rankedBids[0] | null = null;

            for (const bid of rankedBids) {
                if (reservePrice > 0 && Number(bid.amount) < reservePrice) {
                    console.log(`Auction ${leadId}: bid $${Number(bid.amount).toFixed(2)} < reserve $${reservePrice.toFixed(2)} — skipping`);
                    continue;
                }
                winningBid = bid;
                break;
            }

            if (!winningBid) {
                console.log(`Auction ${leadId}: no bid meets reserve — converting to Buy It Now`);
                await this.convertToUnsold(leadId, lead);
                return;
            }

            // Mark winner and losers
            await prisma.$transaction([
                prisma.bid.update({
                    where: { id: winningBid.id },
                    data: { status: 'ACCEPTED', processedAt: new Date() },
                }),
                prisma.bid.updateMany({
                    where: {
                        leadId,
                        id: { not: winningBid.id },
                        status: 'REVEALED',
                    },
                    data: { status: 'OUTBID', processedAt: new Date() },
                }),
                prisma.bid.updateMany({
                    where: {
                        leadId,
                        status: 'PENDING',
                    },
                    data: { status: 'EXPIRED', processedAt: new Date() },
                }),
                prisma.lead.update({
                    where: { id: leadId },
                    data: {
                        status: 'SOLD',
                        winningBid: winningBid.amount,
                        soldAt: new Date(),
                    },
                }),
                prisma.auctionRoom.updateMany({
                    where: { leadId },
                    data: { phase: 'RESOLVED' },
                }),
                prisma.transaction.create({
                    data: {
                        leadId,
                        buyerId: winningBid.buyerId,
                        amount: winningBid.amount!,
                        platformFee: Number(winningBid.amount) * 0.025, // 2.5% fee
                        status: 'PENDING',
                    },
                }),
            ]);

            console.log(`Auction ${leadId} resolved. Winner: ${winningBid.buyerId}`);

            // ── Escrow creation deferred to buyer's MetaMask (TD-01) ──
            // Instead of using the deployer wallet here, we let the buyer
            // sign the escrow tx from their own wallet when they view the won lead.
            // The Transaction record is already status='PENDING' — the buyer
            // will call /prepare-escrow → sign with MetaMask → /confirm-escrow.
            const buyerWallet = winningBid.buyer?.walletAddress;

            if (buyerWallet) {
                console.log(`[x402] Escrow deferred to buyer's wallet — buyer=${buyerWallet.slice(0, 10)}, lead=${leadId}`);
                this.io.emit('lead:escrow-required', {
                    leadId,
                    buyerId: winningBid.buyerId,
                    buyerWallet,
                    amount: Number(winningBid.amount),
                });
            } else {
                console.warn(`[x402] Buyer wallet missing — escrow must be created manually, lead=${leadId}`);
            }

            // Notify room
            this.io.to(`auction_${leadId}`).emit('auction:resolved', {
                leadId,
                winnerId: winningBid.buyerId,
                winningAmount: Number(winningBid.amount),
                effectiveBid: Number(winningBid.effectiveBid ?? winningBid.amount),
            });

            // Notify all clients that this lead left Live Leads → Sold
            this.io.emit('lead:status-changed', {
                leadId,
                oldStatus: 'IN_AUCTION',
                newStatus: 'SOLD',
            });

            // Push real-time analytics update to all connected dashboards
            this.io.emit('analytics:update', {
                type: 'purchase',
                leadId,
                buyerId: winningBid.buyerId,
                amount: Number(winningBid.amount),
                vertical: lead.vertical || 'unknown',
                timestamp: new Date().toISOString(),
            });

            // Log analytics
            await prisma.analyticsEvent.create({
                data: {
                    eventType: 'auction_resolved',
                    entityType: 'lead',
                    entityId: leadId,
                    metadata: {
                        winnerId: winningBid.buyerId,
                        amount: Number(winningBid.amount),
                    },
                },
            });

            // Fire seller conversion tracking (pixel + webhook) — non-blocking
            const fullLead = await prisma.lead.findUnique({
                where: { id: leadId },
                select: { sellerId: true, vertical: true, geo: true },
            });
            if (fullLead) {
                const geo = fullLead.geo as any;
                const convPayload: ConversionPayload = {
                    event: 'lead_sold',
                    lead_id: leadId,
                    sale_amount: Number(winningBid.amount),
                    platform_fee: Number(winningBid.amount) * 0.025,
                    vertical: fullLead.vertical,
                    geo: geo ? `${geo.country || 'US'}-${geo.state || ''}` : 'US',
                    quality_score: 0,
                    transaction_id: '',
                    sold_at: new Date().toISOString(),
                };
                fireConversionEvents(fullLead.sellerId, convPayload).catch(console.error);
            }
        } catch (error) {
            console.error('Auction resolution error:', error);
        }
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
