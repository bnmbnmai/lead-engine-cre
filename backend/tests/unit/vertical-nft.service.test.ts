/**
 * Vertical NFT Service Unit Tests
 *
 * Tests the activation pipeline: uniqueness (CRE), compliance (ACE),
 * minting, and Prisma updates.
 */

// Mock the ethers module
const mockSlugToToken = jest.fn();
const mockCanTransact = jest.fn();
const mockMintVertical = jest.fn();
const mockWait = jest.fn();
const mockOwnerOf = jest.fn();
const mockTotalSupply = jest.fn();
const mockGetVerticalBySlug = jest.fn();

jest.mock('ethers', () => ({
    ethers: {
        JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
        Wallet: jest.fn().mockImplementation(() => ({})),
        Contract: jest.fn().mockImplementation((_addr: string, _abi: any) => ({
            slugToToken: mockSlugToToken,
            canTransact: mockCanTransact,
            mintVertical: mockMintVertical,
            ownerOf: mockOwnerOf,
            totalSupply: mockTotalSupply,
            getVerticalBySlug: mockGetVerticalBySlug,
        })),
        Interface: jest.fn().mockImplementation(() => ({
            parseLog: jest.fn().mockReturnValue({
                name: 'VerticalMinted',
                args: [1n],
            }),
        })),
        keccak256: jest.fn().mockReturnValue('0xmockhash'),
        toUtf8Bytes: jest.fn().mockReturnValue(new Uint8Array()),
        ZeroHash: '0x' + '0'.repeat(64),
        ZeroAddress: '0x' + '0'.repeat(40),
    },
}));

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        vertical: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    },
}));

import { prisma } from '../../src/lib/prisma';

// Set env vars before importing the service
process.env.RPC_URL = 'http://localhost:8545';
process.env.DEPLOYER_PRIVATE_KEY = '0x' + 'a'.repeat(64);
process.env.VERTICAL_NFT_ADDRESS = '0x' + '1'.repeat(40);
process.env.ACE_COMPLIANCE_ADDRESS = '0x' + '2'.repeat(40);

let verticalNftService: any;

beforeAll(async () => {
    verticalNftService = await import('../../src/services/vertical-nft.service');
});

afterEach(() => {
    jest.clearAllMocks();
});

describe('VerticalNFTService', () => {

    // ─── verifyUniqueness ──────────────────────────

    describe('verifyUniqueness', () => {
        it('should pass for unique slug (slugToToken returns 0)', async () => {
            mockSlugToToken.mockResolvedValue(0n);
            const result = await verticalNftService.verifyUniqueness('plumbing');
            expect(result.passed).toBe(true);
        });

        it('should fail for duplicate slug (slugToToken returns tokenId)', async () => {
            mockSlugToToken.mockResolvedValue(42n);
            const result = await verticalNftService.verifyUniqueness('plumbing');
            expect(result.passed).toBe(false);
            expect(result.reason).toContain('already minted');
        });

        it('should pass gracefully when contract not deployed', async () => {
            mockSlugToToken.mockRejectedValue({ code: 'CALL_EXCEPTION' });
            const result = await verticalNftService.verifyUniqueness('plumbing');
            expect(result.passed).toBe(true);
            expect(result.reason).toContain('dev mode');
        });
    });

    // ─── checkCompliance ───────────────────────────

    describe('checkCompliance', () => {
        it('should pass when ACE allows transaction', async () => {
            mockCanTransact.mockResolvedValue(true);
            const result = await verticalNftService.checkCompliance('0xRecipient', 'plumbing');
            expect(result.passed).toBe(true);
        });

        it('should fail when ACE denies transaction', async () => {
            mockCanTransact.mockResolvedValue(false);
            const result = await verticalNftService.checkCompliance('0xRecipient', 'plumbing');
            expect(result.passed).toBe(false);
            expect(result.reason).toContain('Compliance check failed');
        });

        it('should pass gracefully when ACE contract not deployed', async () => {
            const err = new Error('call revert exception') as any;
            err.code = 'CALL_EXCEPTION';
            mockCanTransact.mockRejectedValue(err);
            const result = await verticalNftService.checkCompliance('0xRecipient', 'plumbing');
            expect(result.passed).toBe(true);
        });
    });

    // ─── activateVertical ──────────────────────────

    describe('activateVertical', () => {
        it('should return error for nonexistent vertical', async () => {
            (prisma.vertical.findUnique as jest.Mock).mockResolvedValue(null);
            const result = await verticalNftService.activateVertical('nonexistent', '0xAddr');
            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });

        it('should return error if vertical is already ACTIVE', async () => {
            (prisma.vertical.findUnique as jest.Mock).mockResolvedValue({
                slug: 'plumbing', status: 'ACTIVE',
            });
            const result = await verticalNftService.activateVertical('plumbing', '0xAddr');
            expect(result.success).toBe(false);
            expect(result.error).toContain('already ACTIVE');
        });

        it('should reject if CRE uniqueness fails', async () => {
            (prisma.vertical.findUnique as jest.Mock).mockResolvedValue({
                slug: 'plumbing', status: 'PROPOSED',
            });
            mockSlugToToken.mockResolvedValue(99n);
            (prisma.vertical.update as jest.Mock).mockResolvedValue({});
            const result = await verticalNftService.activateVertical('plumbing', '0xAddr');
            expect(result.success).toBe(false);
            expect(result.step).toBe('uniqueness');
        });

        it('should reject if ACE compliance fails', async () => {
            (prisma.vertical.findUnique as jest.Mock).mockResolvedValue({
                slug: 'plumbing', status: 'PROPOSED',
            });
            mockSlugToToken.mockResolvedValue(0n);
            mockCanTransact.mockResolvedValue(false);
            (prisma.vertical.update as jest.Mock).mockResolvedValue({});
            const result = await verticalNftService.activateVertical('plumbing', '0xAddr');
            expect(result.success).toBe(false);
            expect(result.step).toBe('compliance');
        });

        it('should succeed on full pipeline', async () => {
            (prisma.vertical.findUnique as jest.Mock).mockResolvedValue(
                { slug: 'plumbing-ok', status: 'PROPOSED', depth: 1, parentId: null, attributes: {} },
            );

            mockSlugToToken.mockResolvedValue(0n);
            mockCanTransact.mockResolvedValue(true);
            mockMintVertical.mockResolvedValue({
                wait: mockWait.mockResolvedValue({
                    hash: '0xtx123',
                    blockNumber: 42,
                    logs: [{ topics: ['0x1'], data: '0x' }],
                }),
            });
            (prisma.vertical.update as jest.Mock).mockResolvedValue({});

            const result = await verticalNftService.activateVertical('plumbing-ok', '0xAddr');
            expect(result.success).toBe(true);
            expect(result.tokenId).toBeDefined();
            expect(result.txHash).toBe('0xtx123');
        });

        it('should handle mint failure gracefully', async () => {
            (prisma.vertical.findUnique as jest.Mock).mockResolvedValue(
                { slug: 'plumbing-mint', status: 'PROPOSED', depth: 1, parentId: null, attributes: {} },
            );
            mockSlugToToken.mockResolvedValue(0n);
            mockCanTransact.mockResolvedValue(true);
            mockMintVertical.mockRejectedValue(new Error('gas estimation failed'));

            const result = await verticalNftService.activateVertical('plumbing-mint', '0xAddr');
            expect(result.success).toBe(false);
            expect(result.step).toBe('mint');
            expect(result.error).toContain('gas estimation');
        });

        it('should handle Prisma failure after successful mint', async () => {
            (prisma.vertical.findUnique as jest.Mock).mockResolvedValue(
                { slug: 'plumbing-db', status: 'PROPOSED', depth: 0, parentId: null, attributes: {} },
            );

            mockSlugToToken.mockResolvedValue(0n);
            mockCanTransact.mockResolvedValue(true);
            mockMintVertical.mockResolvedValue({
                wait: mockWait.mockResolvedValue({
                    hash: '0xtx456',
                    blockNumber: 50,
                    logs: [{ topics: ['0x1'], data: '0x' }],
                }),
            });
            (prisma.vertical.update as jest.Mock).mockRejectedValue(new Error('DB connection lost'));

            const result = await verticalNftService.activateVertical('plumbing-db', '0xAddr');
            expect(result.success).toBe(false);
            expect(result.step).toBe('prisma');
            expect(result.tokenId).toBeDefined(); // NFT was minted
            expect(result.txHash).toBe('0xtx456'); // For recovery
        });
    });

    // ─── getTokenForSlug ───────────────────────────

    describe('getTokenForSlug', () => {
        it('should return token info for existing slug', async () => {
            mockGetVerticalBySlug.mockResolvedValue([
                1n,
                { slug: '0xslug', parentSlug: '0x00', depth: 0, activatedAt: 1000n, isFractionalizable: false },
            ]);
            mockOwnerOf.mockResolvedValue('0xOwner');
            mockTotalSupply.mockResolvedValue(5n);

            const result = await verticalNftService.getTokenForSlug('plumbing');
            expect(result).not.toBeNull();
            expect(result.tokenId).toBe(1);
            expect(result.owner).toBe('0xOwner');
        });

        it('should return null for nonexistent slug', async () => {
            mockGetVerticalBySlug.mockRejectedValue(new Error('Slug not found'));
            const result = await verticalNftService.getTokenForSlug('unknown');
            expect(result).toBeNull();
        });
    });
});
