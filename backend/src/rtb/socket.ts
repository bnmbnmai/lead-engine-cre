import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { aceService } from '../services/ace.service';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

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
                        biddingEndsAt: lead.auctionRoom?.biddingEndsAt,
                        revealEndsAt: lead.auctionRoom?.revealEndsAt,
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

                    // Create bid
                    const bid = await prisma.bid.upsert({
                        where: {
                            leadId_buyerId: { leadId: data.leadId, buyerId: socket.userId! },
                        },
                        create: {
                            leadId: data.leadId,
                            buyerId: socket.userId!,
                            commitment: data.commitment,
                            amount: data.amount,
                            status: data.commitment ? 'PENDING' : 'REVEALED',
                            revealedAt: data.amount ? new Date() : null,
                        },
                        update: {
                            commitment: data.commitment,
                            amount: data.amount,
                            status: data.commitment ? 'PENDING' : 'REVEALED',
                            revealedAt: data.amount ? new Date() : null,
                        },
                    });

                    // Update auction room
                    if (lead.auctionRoom) {
                        const updateData: any = { bidCount: { increment: 1 } };

                        if (data.amount) {
                            const currentHighest = lead.auctionRoom.highestBid ? Number(lead.auctionRoom.highestBid) : 0;
                            if (data.amount > currentHighest) {
                                updateData.highestBid = data.amount;
                                updateData.highestBidder = socket.userId;
                            }
                        }

                        await prisma.auctionRoom.update({
                            where: { id: lead.auctionRoom.id },
                            data: updateData,
                        });

                        // Broadcast to room
                        const roomId = `auction_${data.leadId}`;
                        this.io.to(roomId).emit('bid:new', {
                            leadId: data.leadId,
                            bidCount: (lead.auctionRoom.bidCount || 0) + 1,
                            highestBid: data.amount && data.amount > (Number(lead.auctionRoom.highestBid) || 0)
                                ? data.amount
                                : lead.auctionRoom.highestBid,
                            timestamp: new Date(),
                        });
                    }

                    socket.emit('bid:confirmed', {
                        bidId: bid.id,
                        status: bid.status,
                    });

                    // Log event
                    await prisma.analyticsEvent.create({
                        data: {
                            eventType: 'bid_placed_realtime',
                            entityType: 'bid',
                            entityId: bid.id,
                            userId: socket.userId,
                        },
                    });
                } catch (error) {
                    console.error('Socket bid error:', error);
                    socket.emit('error', { message: 'Failed to place bid' });
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

                // Find auctions that need to transition to reveal phase
                const endingBidding = await prisma.auctionRoom.findMany({
                    where: {
                        phase: 'BIDDING',
                        biddingEndsAt: { lte: now },
                    },
                    include: { lead: true },
                });

                for (const room of endingBidding) {
                    await prisma.$transaction([
                        prisma.auctionRoom.update({
                            where: { id: room.id },
                            data: { phase: 'REVEAL' },
                        }),
                        prisma.lead.update({
                            where: { id: room.leadId },
                            data: { status: 'REVEAL_PHASE' },
                        }),
                    ]);

                    this.io.to(room.roomId).emit('auction:phase', {
                        leadId: room.leadId,
                        phase: 'REVEAL',
                        revealEndsAt: room.revealEndsAt,
                    });

                    console.log(`Auction ${room.leadId} transitioned to REVEAL phase`);
                }

                // Find auctions that need resolution
                const endingReveal = await prisma.auctionRoom.findMany({
                    where: {
                        phase: 'REVEAL',
                        revealEndsAt: { lte: now },
                    },
                    include: { lead: true },
                });

                for (const room of endingReveal) {
                    await this.resolveAuction(room.leadId);
                }
            } catch (error) {
                console.error('Auction monitor error:', error);
            }
        }, 5000); // Check every 5 seconds
    }

    // ============================================
    // Auction Resolution
    // ============================================

    private async resolveAuction(leadId: string) {
        try {
            // Find highest revealed bid
            const winningBid = await prisma.bid.findFirst({
                where: {
                    leadId,
                    status: 'REVEALED',
                    amount: { not: null },
                },
                orderBy: { amount: 'desc' },
                include: { buyer: true },
            });

            if (!winningBid) {
                // No valid bids - expire the lead
                await prisma.$transaction([
                    prisma.lead.update({
                        where: { id: leadId },
                        data: { status: 'EXPIRED' },
                    }),
                    prisma.auctionRoom.updateMany({
                        where: { leadId },
                        data: { phase: 'CANCELLED' },
                    }),
                ]);

                this.io.to(`auction_${leadId}`).emit('auction:expired', { leadId });
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

            // Notify room
            this.io.to(`auction_${leadId}`).emit('auction:resolved', {
                leadId,
                winnerId: winningBid.buyerId,
                winningAmount: Number(winningBid.amount),
            });

            console.log(`Auction ${leadId} resolved. Winner: ${winningBid.buyerId}`);

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
