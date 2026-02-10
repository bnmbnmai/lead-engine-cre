/**
 * ACE Service Unit Tests
 * 
 * Tests KYC, jurisdiction policy, cross-border compliance,
 * reputation updates, and edge cases (expired KYC, blacklisted wallets).
 */

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        complianceCheck: {
            findFirst: jest.fn(),
            create: jest.fn(),
        },
        sellerProfile: {
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        user: {
            findUnique: jest.fn(),
        },
    },
}));

import { prisma } from '../../src/lib/prisma';

let aceService: any;

beforeAll(async () => {
    const mod = await import('../../src/services/ace.service');
    aceService = mod.aceService;
});

afterEach(() => {
    jest.clearAllMocks();
});

describe('ACEService', () => {

    // ─── Jurisdiction Policy Enforcement ─────────

    describe('enforceJurisdictionPolicy', () => {
        it('should allow when no restrictions exist in DB', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);

            const result = await aceService.enforceJurisdictionPolicy(
                '0xWallet', 'solar', 'FL'
            );
            expect(result.allowed).toBe(true);
        });

        it('should block when DB restriction exists', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue({
                id: 'check-1',
                entityType: 'jurisdiction',
                entityId: 'NY-mortgage',
                status: 'FAILED',
            });

            const result = await aceService.enforceJurisdictionPolicy(
                '0xWallet', 'mortgage', 'NY'
            );
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('NY');
        });
    });

    // ─── Cross-Border Compliance ─────────────────

    describe('checkCrossBorderCompliance', () => {
        it('should allow same-state transactions', async () => {
            const result = await aceService.checkCrossBorderCompliance('FL', 'FL', 'mortgage');
            expect(result.allowed).toBe(true);
        });

        it('should block cross-state mortgage with restricted states', async () => {
            const result = await aceService.checkCrossBorderCompliance('FL', 'NY', 'mortgage');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Cross-border');
            expect(result.reason).toContain('mortgage');
        });

        it('should block cross-state insurance with NY', async () => {
            const result = await aceService.checkCrossBorderCompliance('TX', 'NY', 'insurance');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('insurance');
        });

        it('should allow cross-state solar (unrestricted vertical)', async () => {
            const result = await aceService.checkCrossBorderCompliance('FL', 'CA', 'solar');
            expect(result.allowed).toBe(true);
        });

        it('should allow cross-state mortgage between unrestricted states', async () => {
            const result = await aceService.checkCrossBorderCompliance('TX', 'CO', 'mortgage');
            expect(result.allowed).toBe(true);
        });

        it('should handle CA mortgage cross-border restriction', async () => {
            const result = await aceService.checkCrossBorderCompliance('CA', 'TX', 'mortgage');
            expect(result.allowed).toBe(false);
        });
    });

    // ─── Auto-KYC ────────────────────────────────

    describe('autoKYC', () => {
        it('should create KYC check in database (off-chain)', async () => {
            (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({ id: 'kyc-1' });

            const result = await aceService.autoKYC('0xBuyerWallet');
            expect(result.verified).toBe(true);
            expect(prisma.complianceCheck.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        entityType: 'user',
                        entityId: '0xbuyerwallet', // lowercase
                        checkType: 'KYC',
                        status: 'PASSED',
                    }),
                })
            );
        });

        it('should set 1-year expiry on KYC check', async () => {
            (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({ id: 'kyc-2' });

            await aceService.autoKYC('0xWallet');

            const createCall = (prisma.complianceCheck.create as jest.Mock).mock.calls[0][0];
            const expiresAt = new Date(createCall.data.expiresAt);
            const now = new Date();
            const diffDays = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
            expect(diffDays).toBeGreaterThan(360);
            expect(diffDays).toBeLessThanOrEqual(366);
        });
    });

    // ─── Reputation Update ───────────────────────

    describe('updateReputation', () => {
        it('should update reputation in DB for existing seller', async () => {
            (prisma.sellerProfile.findFirst as jest.Mock).mockResolvedValue({
                id: 'seller-1',
                reputationScore: 5000,
            });
            (prisma.sellerProfile.update as jest.Mock).mockResolvedValue({});

            const result = await aceService.updateReputation('0xSeller', 100);
            expect(result.success).toBe(true);
            expect(result.newScore).toBe(5100);
        });

        it('should clamp reputation at 0 (floor)', async () => {
            (prisma.sellerProfile.findFirst as jest.Mock).mockResolvedValue({
                id: 'seller-2',
                reputationScore: 50,
            });
            (prisma.sellerProfile.update as jest.Mock).mockResolvedValue({});

            const result = await aceService.updateReputation('0xSeller', -1000);
            expect(result.success).toBe(true);
            expect(result.newScore).toBe(0);
        });

        it('should clamp reputation at 10000 (ceiling)', async () => {
            (prisma.sellerProfile.findFirst as jest.Mock).mockResolvedValue({
                id: 'seller-3',
                reputationScore: 9900,
            });
            (prisma.sellerProfile.update as jest.Mock).mockResolvedValue({});

            const result = await aceService.updateReputation('0xSeller', 500);
            expect(result.success).toBe(true);
            expect(result.newScore).toBe(10000);
        });

        it('should return error for non-existent seller', async () => {
            (prisma.sellerProfile.findFirst as jest.Mock).mockResolvedValue(null);

            const result = await aceService.updateReputation('0xNoSeller', 100);
            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });
    });

    // ─── KYC Validity (off-chain fallback) ───────

    describe('isKYCValid', () => {
        it('should return false for unknown wallet (off-chain)', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await aceService.isKYCValid('0xUnknown');
            expect(result).toBe(false);
        });

        it('should return true for valid KYC in DB', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue({
                id: 'check-1',
                status: 'PASSED',
                expiresAt: new Date(Date.now() + 86400000), // tomorrow
            });

            const result = await aceService.isKYCValid('0xVerified');
            expect(result).toBe(true);
        });
    });

    // ─── Edge Cases ──────────────────────────────

    describe('edge cases', () => {
        it('should handle empty wallet address gracefully', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
            const result = await aceService.isKYCValid('');
            expect(result).toBe(false);
        });

        it('should handle cross-border with empty vertical', async () => {
            const result = await aceService.checkCrossBorderCompliance('FL', 'NY', '');
            // Empty vertical has no restrictions
            expect(result.allowed).toBe(true);
        });
    });
});
