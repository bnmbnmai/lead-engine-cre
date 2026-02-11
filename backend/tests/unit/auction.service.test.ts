/**
 * Auction Service Unit Tests
 *
 * Tests the auction lifecycle: create → bid → settle → query.
 * Plus edge cases: unminted vertical, below reserve, expired, bulk bid, compliance.
 */

// ─── Mocks ─────────────────────────────────────

const mockWait = jest.fn().mockResolvedValue({ hash: '0xauctiontx' });
const mockCreateAuction = jest.fn().mockResolvedValue({ wait: mockWait });
const mockPlaceBid = jest.fn().mockResolvedValue({ wait: mockWait });
const mockSettleAuction = jest.fn().mockResolvedValue({ wait: mockWait });
const mockNextAuctionId = jest.fn().mockResolvedValue(2n);

jest.mock('ethers', () => ({
    ethers: {
        JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
        Wallet: jest.fn().mockImplementation(() => ({})),
        Contract: jest.fn().mockImplementation(() => ({
            createAuction: mockCreateAuction,
            placeBid: mockPlaceBid,
            settleAuction: mockSettleAuction,
            nextAuctionId: mockNextAuctionId,
            connect: jest.fn().mockReturnThis(),
        })),
        parseEther: jest.fn((val: string) => BigInt(Math.round(parseFloat(val) * 1e18))),
    },
}));

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        vertical: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        verticalAuction: {
            create: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
        },
    },
}));

import { prisma } from '../../src/lib/prisma';

// Set env vars
process.env.RPC_URL = 'http://localhost:8545';
process.env.DEPLOYER_PRIVATE_KEY = '0x' + 'a'.repeat(64);
process.env.VERTICAL_AUCTION_ADDRESS = '0x' + 'a'.repeat(40);
process.env.VERTICAL_NFT_ADDRESS = '0x' + '1'.repeat(40);

let auctionService: any;

beforeAll(async () => {
    auctionService = await import('../../src/services/auction.service');
});

afterEach(() => {
    jest.clearAllMocks();
});

describe('AuctionService', () => {

    // ─── createAuction ─────────────────────────────

    describe('createAuction', () => {
        it('should create auction for minted vertical', async () => {
            (prisma.vertical.findUnique as jest.Mock).mockResolvedValue({
                slug: 'solar', nftTokenId: 1, status: 'ACTIVE',
            });
            (prisma.verticalAuction.create as jest.Mock).mockResolvedValue({
                id: 'auc_1', verticalSlug: 'solar', tokenId: 1,
            });

            const result = await auctionService.createAuction('solar', 0.1, 3600);

            expect(result.success).toBe(true);
            expect(result.startTime).toBeDefined();
            expect(result.endTime).toBeDefined();
            expect(prisma.verticalAuction.create).toHaveBeenCalledTimes(1);
        });

        it('should reject unminted vertical (no nftTokenId)', async () => {
            (prisma.vertical.findUnique as jest.Mock).mockResolvedValue({
                slug: 'solar', nftTokenId: null,
            });

            const result = await auctionService.createAuction('solar', 0.1, 3600);

            expect(result.success).toBe(false);
            expect(result.error).toContain('no minted NFT');
        });

        it('should reject nonexistent vertical', async () => {
            (prisma.vertical.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await auctionService.createAuction('nonexistent', 0.1, 3600);

            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });
    });

    // ─── placeBid ──────────────────────────────────

    describe('placeBid', () => {
        const futureEnd = new Date(Date.now() + 3600_000);

        it('should accept valid bid above reserve', async () => {
            (prisma.verticalAuction.findUnique as jest.Mock).mockResolvedValue({
                id: 'auc_1', reservePrice: 0.1, highBid: 0,
                endTime: futureEnd, settled: false, cancelled: false,
                auctionId: 1,
            });
            (prisma.verticalAuction.update as jest.Mock).mockResolvedValue({});

            const result = await auctionService.placeBid('auc_1', '0x' + 'b'.repeat(40), 0.5);

            expect(result.success).toBe(true);
            expect(result.currentHighBid).toBe(0.5);
        });

        it('should reject bid below reserve', async () => {
            (prisma.verticalAuction.findUnique as jest.Mock).mockResolvedValue({
                id: 'auc_1', reservePrice: 1.0, highBid: 0,
                endTime: futureEnd, settled: false, cancelled: false,
            });

            const result = await auctionService.placeBid('auc_1', '0x' + 'b'.repeat(40), 0.5);

            expect(result.success).toBe(false);
            expect(result.error).toContain('below reserve');
        });

        it('should reject bid on settled auction', async () => {
            (prisma.verticalAuction.findUnique as jest.Mock).mockResolvedValue({
                id: 'auc_1', settled: true, cancelled: false,
            });

            const result = await auctionService.placeBid('auc_1', '0x' + 'b'.repeat(40), 0.5);

            expect(result.success).toBe(false);
            expect(result.error).toContain('no longer active');
        });
    });

    // ─── settleAuction ─────────────────────────────

    describe('settleAuction', () => {
        it('should settle ended auction with winner', async () => {
            const pastEnd = new Date(Date.now() - 3600_000);
            (prisma.verticalAuction.findUnique as jest.Mock).mockResolvedValue({
                id: 'auc_1', verticalSlug: 'solar', highBidder: '0x' + 'b'.repeat(40),
                highBid: 1.5, endTime: pastEnd, settled: false, auctionId: 1,
                txHash: '0xoriginal',
            });
            (prisma.verticalAuction.update as jest.Mock).mockResolvedValue({});
            (prisma.vertical.update as jest.Mock).mockResolvedValue({});

            const result = await auctionService.settleAuction('auc_1');

            expect(result.success).toBe(true);
            expect(result.winner).toBe('0x' + 'b'.repeat(40));
            expect(result.finalPrice).toBe(1.5);
        });

        it('should reject settle before end time', async () => {
            const futureEnd = new Date(Date.now() + 3600_000);
            (prisma.verticalAuction.findUnique as jest.Mock).mockResolvedValue({
                id: 'auc_1', endTime: futureEnd, settled: false,
                highBidder: '0x' + 'b'.repeat(40),
            });

            const result = await auctionService.settleAuction('auc_1');

            expect(result.success).toBe(false);
            expect(result.error).toContain('not ended yet');
        });

        it('should reject settle with no bids', async () => {
            const pastEnd = new Date(Date.now() - 3600_000);
            (prisma.verticalAuction.findUnique as jest.Mock).mockResolvedValue({
                id: 'auc_1', endTime: pastEnd, settled: false,
                highBidder: null,
            });

            const result = await auctionService.settleAuction('auc_1');

            expect(result.success).toBe(false);
            expect(result.error).toContain('No bids');
        });
    });

    // ─── getActiveAuctions ─────────────────────────

    describe('getActiveAuctions', () => {
        it('should return only unsettled, uncancelled, future auctions', async () => {
            const mockAuctions = [
                { id: 'auc_1', settled: false, cancelled: false, endTime: new Date(Date.now() + 3600_000) },
            ];
            (prisma.verticalAuction.findMany as jest.Mock).mockResolvedValue(mockAuctions);

            const result = await auctionService.getActiveAuctions();

            expect(result).toHaveLength(1);
            expect(prisma.verticalAuction.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        settled: false,
                        cancelled: false,
                    }),
                }),
            );
        });
    });

    // ─── Edge Cases ────────────────────────────────

    describe('Edge Cases', () => {
        it('should handle institutional bulk bid (5 auctions)', async () => {
            const futureEnd = new Date(Date.now() + 3600_000);
            const auctionIds = ['auc_1', 'auc_2', 'auc_3', 'auc_4', 'auc_5'];

            for (const id of auctionIds) {
                (prisma.verticalAuction.findUnique as jest.Mock).mockResolvedValueOnce({
                    id, reservePrice: 0.1, highBid: 0,
                    endTime: futureEnd, settled: false, cancelled: false,
                    auctionId: 1,
                });
                (prisma.verticalAuction.update as jest.Mock).mockResolvedValueOnce({});
            }

            const results = await Promise.all(
                auctionIds.map(id =>
                    auctionService.placeBid(id, '0x' + 'c'.repeat(40), 1.0),
                ),
            );

            expect(results.every((r: any) => r.success)).toBe(true);
            expect(prisma.verticalAuction.update).toHaveBeenCalledTimes(5);
        });

        it('should handle contract call failure gracefully', async () => {
            (prisma.vertical.findUnique as jest.Mock).mockResolvedValue({
                slug: 'solar', nftTokenId: 1,
            });
            mockCreateAuction.mockRejectedValueOnce(new Error('gas estimation failed'));
            (prisma.verticalAuction.create as jest.Mock).mockResolvedValue({
                id: 'auc_fallback', verticalSlug: 'solar',
            });

            const result = await auctionService.createAuction('solar', 0.1, 3600);

            // Should still succeed with off-chain record
            expect(result.success).toBe(true);
        });
    });
});
