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
        lead: {
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
            expect(result.reason).toContain('Cross-state');
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

    // ─── canTransact ──────────────────────────────

    describe('canTransact', () => {
        it('should block blacklisted user', async () => {
            // isBlacklisted returns a fraud check
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue({
                id: 'fraud-1', status: 'FAILED', checkType: 'FRAUD_CHECK',
            });

            const result = await aceService.canTransact('0xBlacklisted', 'solar', 'FL');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('blacklisted');
        });

        it('should block user without KYC', async () => {
            // isBlacklisted: no fraud check
            (prisma.complianceCheck.findFirst as jest.Mock)
                .mockResolvedValueOnce(null)   // blacklist check
                .mockResolvedValueOnce(null);   // KYC check
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await aceService.canTransact('0xNoKYC', 'solar', 'FL');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('KYC');
        });

        it('should allow valid user with KYC', async () => {
            // isBlacklisted: no fraud check
            (prisma.complianceCheck.findFirst as jest.Mock)
                .mockResolvedValueOnce(null)   // blacklist
                .mockResolvedValueOnce({        // KYC valid
                    id: 'kyc-1', status: 'PASSED',
                    expiresAt: new Date(Date.now() + 86400000),
                });

            const result = await aceService.canTransact('0xValid', 'solar', 'FL');
            expect(result.allowed).toBe(true);
        });
    });

    // ─── getReputationScore ──────────────────────

    describe('getReputationScore', () => {
        it('should return DB score for existing seller', async () => {
            (prisma.sellerProfile.findFirst as jest.Mock).mockResolvedValue({
                reputationScore: 7500,
            });
            const score = await aceService.getReputationScore('0xSeller');
            expect(score).toBe(7500);
        });

        it('should return default 5000 for unknown wallet', async () => {
            (prisma.sellerProfile.findFirst as jest.Mock).mockResolvedValue(null);
            const score = await aceService.getReputationScore('0xUnknown');
            expect(score).toBe(5000);
        });
    });

    // ─── isBlacklisted ───────────────────────────

    describe('isBlacklisted', () => {
        it('should return true when fraud check exists', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue({
                id: 'fraud-check', status: 'FAILED',
            });
            expect(await aceService.isBlacklisted('0xBadActor')).toBe(true);
        });

        it('should return false when no fraud check', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);
            expect(await aceService.isBlacklisted('0xGoodActor')).toBe(false);
        });
    });

    // ─── checkFullCompliance ─────────────────────

    describe('checkFullCompliance', () => {
        it('should pass when both parties are compliant and lead has TCPA', async () => {
            // canTransact for seller + buyer (blacklist + KYC each)
            (prisma.complianceCheck.findFirst as jest.Mock)
                .mockResolvedValueOnce(null)   // seller blacklist
                .mockResolvedValueOnce({ id: 'k1', status: 'PASSED', expiresAt: new Date(Date.now() + 86400000) })
                .mockResolvedValueOnce(null)   // buyer blacklist
                .mockResolvedValueOnce({ id: 'k2', status: 'PASSED', expiresAt: new Date(Date.now() + 86400000) });
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-1', tcpaConsentAt: new Date(),
            });
            (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({});

            const result = await aceService.checkFullCompliance('0xSeller', '0xBuyer', 'lead-1');
            expect(result.passed).toBe(true);
        });

        it('should fail when seller is blacklisted', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue({
                id: 'fraud', status: 'FAILED', checkType: 'FRAUD_CHECK',
            });

            const result = await aceService.checkFullCompliance('0xBadSeller', '0xBuyer', 'lead-1');
            expect(result.passed).toBe(false);
            expect(result.failedCheck).toBe('SELLER_COMPLIANCE');
        });

        it('should fail when lead not found', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock)
                .mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'k1', status: 'PASSED', expiresAt: new Date(Date.now() + 86400000) })
                .mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'k2', status: 'PASSED', expiresAt: new Date(Date.now() + 86400000) });
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await aceService.checkFullCompliance('0xS', '0xB', 'missing');
            expect(result.passed).toBe(false);
            expect(result.failedCheck).toBe('LEAD_NOT_FOUND');
        });

        it('should fail when lead has no TCPA consent', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock)
                .mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'k1', status: 'PASSED', expiresAt: new Date(Date.now() + 86400000) })
                .mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'k2', status: 'PASSED', expiresAt: new Date(Date.now() + 86400000) });
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-no-tcpa', tcpaConsentAt: null,
            });

            const result = await aceService.checkFullCompliance('0xS', '0xB', 'lead-no-tcpa');
            expect(result.passed).toBe(false);
            expect(result.failedCheck).toBe('TCPA_CONSENT');
        });
    });

    // ─── enforceJurisdictionPolicy extras ────────

    describe('enforceJurisdictionPolicy (policy branch)', () => {
        it('should allow unrestricted country vertical', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);
            const result = await aceService.enforceJurisdictionPolicy('0xWallet', 'solar', 'FL', 'US');
            expect(result.allowed).toBe(true);
        });
    });

    // ─── autoKYC extras ──────────────────────────

    describe('autoKYC (proofHash branch)', () => {
        it('should accept custom proofHash', async () => {
            (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({ id: 'kyc-custom' });
            const result = await aceService.autoKYC('0xWallet', '0xcustomproof');
            expect(result.verified).toBe(true);
        });
    });

    // ─── Cross-border extras ─────────────────────

    describe('checkCrossBorderCompliance (cross-country)', () => {
        it('should return requirements for US→EU cross-country trade', async () => {
            const result = await aceService.checkCrossBorderCompliance('FL', 'BY', 'solar', 'US', 'DE');
            // Cross-country should return requirements (GDPR etc)
            expect(result.allowed).toBe(true);
            if (result.requirements) {
                expect(result.requirements.length).toBeGreaterThan(0);
            }
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

        it('should return true for user with VERIFIED buyerProfile', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                buyerProfile: { kycStatus: 'VERIFIED' },
                sellerProfile: null,
            });
            const result = await aceService.isKYCValid('0xProfiled');
            expect(result).toBe(true);
        });
    });
});
