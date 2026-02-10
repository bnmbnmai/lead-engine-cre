/**
 * NFT Service Unit Tests
 * 
 * Tests off-chain mint fallback, sale recording,
 * metadata retrieval from DB, and quality score updates.
 */

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        lead: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
    },
}));

// Mock privacy service to avoid crypto key issues
jest.mock('../../src/services/privacy.service', () => ({
    privacyService: {
        encryptTokenMetadata: jest.fn().mockReturnValue({
            publicMetadata: {
                vertical: 'solar',
                geoState: 'FL',
                qualityScore: 5000,
                source: 'PLATFORM',
            },
            encryptedFields: null,
        }),
    },
}));

import { prisma } from '../../src/lib/prisma';

let nftService: any;

beforeAll(async () => {
    const mod = await import('../../src/services/nft.service');
    nftService = mod.nftService;
});

afterEach(() => {
    jest.clearAllMocks();
});

describe('NFTService', () => {

    // ─── mintLeadNFT ─────────────────────────────

    describe('mintLeadNFT', () => {
        it('should return error for non-existent lead', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await nftService.mintLeadNFT('nonexistent');
            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });

        it('should return existing tokenId if already minted', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-1',
                nftTokenId: 'existing-token-42',
                seller: { user: { walletAddress: '0xSeller' } },
            });

            const result = await nftService.mintLeadNFT('lead-1');
            expect(result.success).toBe(true);
            expect(result.tokenId).toBe('existing-token-42');
        });

        it('should create off-chain pseudo-tokenId when no contract', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-2',
                nftTokenId: null,
                vertical: 'solar',
                geo: { state: 'FL' },
                dataHash: null,
                parameters: { creditScore: 720 },
                reservePrice: 25,
                source: 'PLATFORM',
                seller: { user: { walletAddress: '0xSeller' } },
            });
            (prisma.lead.update as jest.Mock).mockResolvedValue({});

            const result = await nftService.mintLeadNFT('lead-2');
            expect(result.success).toBe(true);
            expect(result.tokenId).toMatch(/^offchain-/);
            expect(prisma.lead.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        nftTokenId: expect.stringContaining('offchain-'),
                    }),
                })
            );
        });
    });

    // ─── recordSaleOnChain ───────────────────────

    describe('recordSaleOnChain', () => {
        it('should succeed for off-chain token (logged only)', async () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

            const result = await nftService.recordSaleOnChain(
                'offchain-123', '0xBuyer', 35.50
            );

            expect(result.success).toBe(true);
            consoleSpy.mockRestore();
        });
    });

    // ─── getTokenMetadata ────────────────────────

    describe('getTokenMetadata', () => {
        it('should return null for non-existent token', async () => {
            (prisma.lead.findFirst as jest.Mock).mockResolvedValue(null);

            const result = await nftService.getTokenMetadata('offchain-missing');
            expect(result).toBeNull();
        });

        it('should return DB-based metadata for off-chain token', async () => {
            (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
                id: 'lead-3',
                nftTokenId: 'offchain-456',
                vertical: 'mortgage',
                geo: { state: 'CA' },
                dataHash: null,
                reservePrice: 50,
                isVerified: true,
                seller: { user: { walletAddress: '0xSellerCA' } },
            });

            const result = await nftService.getTokenMetadata('offchain-456');
            expect(result).not.toBeNull();
            expect(result!.tokenId).toBe('offchain-456');
            expect(result!.vertical).toBe('mortgage');
            expect(result!.isVerified).toBe(true);
            expect(result!.reservePrice).toBe(50);
        });
    });

    // ─── updateQualityScoreOnChain ───────────────

    describe('updateQualityScoreOnChain', () => {
        it('should succeed silently for off-chain token (no-op)', async () => {
            const result = await nftService.updateQualityScoreOnChain('offchain-123', 8500);
            expect(result.success).toBe(true);
        });
    });
});
