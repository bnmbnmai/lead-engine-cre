/**
 * NFT Service Unit Tests
 * 
 * Tests on-chain-only behavior: no off-chain fallbacks.
 * When contract/signer is not configured, all operations fail explicitly.
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

        it('should fail explicitly when no contract is configured (no off-chain fallback)', async () => {
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

            const result = await nftService.mintLeadNFT('lead-2');
            expect(result.success).toBe(false);
            expect(result.error).toContain('not configured');
            // No DB update should happen — no pseudo-tokenId stored
            expect(prisma.lead.update).not.toHaveBeenCalled();
        });
    });

    // ─── recordSaleOnChain ───────────────────────

    describe('recordSaleOnChain', () => {
        it('should fail explicitly when contract is not configured (no off-chain fallback)', async () => {
            const result = await nftService.recordSaleOnChain(
                'token-123', '0xBuyer', 35.50
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('not configured');
        });
    });

    // ─── getTokenMetadata ────────────────────────

    describe('getTokenMetadata', () => {
        it('should return null for non-existent token', async () => {
            (prisma.lead.findFirst as jest.Mock).mockResolvedValue(null);

            const result = await nftService.getTokenMetadata('missing-token');
            expect(result).toBeNull();
        });

        it('should return DB-based metadata when on-chain lookup is unavailable', async () => {
            (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
                id: 'lead-3',
                nftTokenId: 'token-456',
                vertical: 'mortgage',
                geo: { state: 'CA' },
                dataHash: null,
                reservePrice: 50,
                isVerified: true,
                seller: { user: { walletAddress: '0xSellerCA' } },
            });

            const result = await nftService.getTokenMetadata('token-456');
            expect(result).not.toBeNull();
            expect(result!.tokenId).toBe('token-456');
            expect(result!.vertical).toBe('mortgage');
            expect(result!.isVerified).toBe(true);
            expect(result!.reservePrice).toBe(50);
        });
    });

    // ─── updateQualityScoreOnChain ───────────────

    describe('updateQualityScoreOnChain', () => {
        it('should fail explicitly when contract is not configured (no off-chain fallback)', async () => {
            const result = await nftService.updateQualityScoreOnChain('token-123', 8500);
            expect(result.success).toBe(false);
            expect(result.error).toContain('not configured');
        });
    });

    // ─── mintLeadNFT extras ──────────────────────

    describe('mintLeadNFT (dataHash branch)', () => {
        it('should use existing dataHash when available (still fails without contract)', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-hash',
                nftTokenId: null,
                vertical: 'mortgage',
                geo: { state: 'CA' },
                dataHash: '0xexistinghash123',
                parameters: { loanAmount: 500000 },
                reservePrice: 50,
                source: 'API',
                seller: { user: { walletAddress: '0xSellerHash' } },
            });

            const result = await nftService.mintLeadNFT('lead-hash');
            expect(result.success).toBe(false);
            expect(result.error).toContain('not configured');
        });

        it('should handle lead with no geo state (still fails without contract)', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-nogeo',
                nftTokenId: null,
                vertical: 'solar',
                geo: {},
                dataHash: null,
                parameters: {},
                reservePrice: 0,
                source: 'PLATFORM',
                seller: { user: { walletAddress: '0xNone' } },
            });

            const result = await nftService.mintLeadNFT('lead-nogeo');
            expect(result.success).toBe(false);
            expect(result.error).toContain('not configured');
        });

        it('should fail when seller wallet is missing (BUG-1 fix)', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-nowallet',
                nftTokenId: null,
                vertical: 'insurance',
                geo: { state: 'TX' },
                dataHash: null,
                parameters: null,
                reservePrice: null,
                source: 'PLATFORM',
                seller: { user: { walletAddress: null } },
            });

            const result = await nftService.mintLeadNFT('lead-nowallet');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Seller wallet missing');
        });
    });

    // ─── getTokenMetadata extras ─────────────────

    describe('getTokenMetadata (field coverage)', () => {
        it('should populate all metadata fields from DB with qualityScore 0 (no synthetic scores)', async () => {
            (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
                id: 'lead-meta',
                nftTokenId: 'token-789',
                vertical: 'solar',
                geo: { state: 'FL' },
                dataHash: '0xdatahash',
                reservePrice: 100,
                isVerified: false,
                seller: { user: { walletAddress: '0xMetaSeller' } },
            });

            const result = await nftService.getTokenMetadata('token-789');
            expect(result).not.toBeNull();
            expect(result!.vertical).toBe('solar');
            expect(result!.seller).toBe('0xMetaSeller');
            expect(result!.owner).toBe('0xMetaSeller');
            expect(result!.reservePrice).toBe(100);
            expect(result!.dataHash).toBe('0xdatahash');
            expect(result!.isVerified).toBe(false);
            expect(result!.qualityScore).toBe(0); // No synthetic score
        });

        it('should return null dataHash as ZeroHash', async () => {
            (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
                id: 'lead-nohash',
                nftTokenId: 'token-nohash',
                vertical: 'legal',
                geo: {},
                dataHash: null,
                reservePrice: 0,
                isVerified: true,
                seller: { user: { walletAddress: null } },
            });

            const result = await nftService.getTokenMetadata('token-nohash');
            expect(result).not.toBeNull();
            expect(result!.dataHash).toMatch(/^0x0+$/);
        });
    });

    // ─── recordSaleOnChain extras ────────────────

    describe('recordSaleOnChain (coverage)', () => {
        it('should fail for zero sale price when contract not configured', async () => {
            const result = await nftService.recordSaleOnChain('token-zero', '0xBuyer', 0);
            expect(result.success).toBe(false);
            expect(result.error).toContain('not configured');
        });
    });
});
