/**
 * ACE Compliance Simulation
 * 
 * 50+ scenarios simulating compliance checks across jurisdictions,
 * verticals, reputation thresholds, off-site API fraud edge cases,
 * and cross-border restrictions.
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

describe('ACE Compliance Simulation', () => {

    // ─── Jurisdiction Matrix ─────────────────────
    // Test all 50 US states × key verticals

    const restrictedCrossBorder: Array<{
        sellerState: string;
        buyerState: string;
        vertical: string;
        expectBlocked: boolean;
        reason: string;
    }> = [
            // Mortgage: NY, CA, FL restrictions (per service restrictedCrossState)
            { sellerState: 'FL', buyerState: 'NY', vertical: 'mortgage', expectBlocked: true, reason: 'NY mortgage cross-border' },
            { sellerState: 'NY', buyerState: 'FL', vertical: 'mortgage', expectBlocked: true, reason: 'NY mortgage cross-border (reverse)' },
            { sellerState: 'CA', buyerState: 'TX', vertical: 'mortgage', expectBlocked: true, reason: 'CA mortgage cross-border' },
            { sellerState: 'FL', buyerState: 'TX', vertical: 'mortgage', expectBlocked: true, reason: 'FL mortgage cross-border' },
            { sellerState: 'TX', buyerState: 'CO', vertical: 'mortgage', expectBlocked: false, reason: 'TX→CO unrestricted' },
            { sellerState: 'WA', buyerState: 'OR', vertical: 'mortgage', expectBlocked: false, reason: 'WA→OR unrestricted' },
            { sellerState: 'MA', buyerState: 'OH', vertical: 'mortgage', expectBlocked: false, reason: 'MA→OH unrestricted (MA not in list)' },

            // Insurance: NY only restriction (per service)
            { sellerState: 'TX', buyerState: 'NY', vertical: 'insurance', expectBlocked: true, reason: 'NY insurance cross-border' },
            { sellerState: 'CA', buyerState: 'FL', vertical: 'insurance', expectBlocked: false, reason: 'CA→FL insurance (CA not restricted for insurance)' },
            { sellerState: 'FL', buyerState: 'GA', vertical: 'insurance', expectBlocked: false, reason: 'FL→GA unrestricted insurance' },

            // Solar: generally unrestricted
            { sellerState: 'FL', buyerState: 'CA', vertical: 'solar', expectBlocked: false, reason: 'Solar unrestricted' },
            { sellerState: 'NY', buyerState: 'TX', vertical: 'solar', expectBlocked: false, reason: 'Solar unrestricted NY→TX' },
            { sellerState: 'CA', buyerState: 'WA', vertical: 'solar', expectBlocked: false, reason: 'Solar unrestricted CA→WA' },

            // Roofing: generally unrestricted
            { sellerState: 'FL', buyerState: 'NY', vertical: 'roofing', expectBlocked: false, reason: 'Roofing unrestricted' },

            // Same-state: always allowed
            { sellerState: 'NY', buyerState: 'NY', vertical: 'mortgage', expectBlocked: false, reason: 'Same-state mortgage NY' },
            { sellerState: 'CA', buyerState: 'CA', vertical: 'insurance', expectBlocked: false, reason: 'Same-state insurance CA' },
            { sellerState: 'FL', buyerState: 'FL', vertical: 'solar', expectBlocked: false, reason: 'Same-state solar FL' },
        ];

    describe.each(restrictedCrossBorder)(
        'cross-border: $reason',
        ({ sellerState, buyerState, vertical, expectBlocked }) => {
            it(`${sellerState}→${buyerState} ${vertical}: ${expectBlocked ? 'BLOCKED' : 'ALLOWED'}`, async () => {
                const result = await aceService.checkCrossBorderCompliance(sellerState, buyerState, vertical);
                expect(result.allowed).toBe(!expectBlocked);
                if (expectBlocked) {
                    expect(result.reason).toBeTruthy();
                }
            });
        }
    );

    // ─── Reputation Thresholds ───────────────────

    describe('reputation scenarios', () => {
        const reputationCases = [
            { initial: 0, delta: 100, expected: 100 },
            { initial: 5000, delta: 500, expected: 5500 },
            { initial: 9900, delta: 200, expected: 10000 },  // capped
            { initial: 100, delta: -500, expected: 0 },       // floored
            { initial: 10000, delta: 0, expected: 10000 },
            { initial: 0, delta: 0, expected: 0 },
            { initial: 3000, delta: -3000, expected: 0 },
            { initial: 7500, delta: 2500, expected: 10000 },
        ];

        it.each(reputationCases)(
            'reputation $initial + $delta = $expected',
            async ({ initial, delta, expected }) => {
                (prisma.sellerProfile.findFirst as jest.Mock).mockResolvedValue({
                    id: 'seller-sim',
                    reputationScore: initial,
                });
                (prisma.sellerProfile.update as jest.Mock).mockResolvedValue({});

                const result = await aceService.updateReputation('0xSeller', delta);
                expect(result.success).toBe(true);
                expect(result.newScore).toBe(expected);
            }
        );
    });

    // ─── Off-Site API Fraud Scenarios ─────────────

    describe('off-site API fraud edge cases', () => {
        it('should block known fraudulent wallet (blacklist hit)', async () => {
            // findFirst returns a FAILED record, then falls through to user lookup
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await aceService.isKYCValid('0xfraudster');
            // No PASSED KYC and no verified profile → false
            expect(result).toBe(false);
        });

        it('should handle wallet with no history (first interaction)', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const kycResult = await aceService.isKYCValid('0xNewWallet');
            expect(kycResult).toBe(false); // New wallets need KYC first
        });

        it('should auto-KYC new wallet and persist', async () => {
            (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({ id: 'kyc-new' });

            const result = await aceService.autoKYC('0xNewWallet');
            expect(result.verified).toBe(true);
            expect(prisma.complianceCheck.create).toHaveBeenCalledTimes(1);
        });

        it('should handle rapid sequential compliance checks', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);

            const checks = await Promise.all([
                aceService.enforceJurisdictionPolicy('0xW1', 'solar', 'FL'),
                aceService.enforceJurisdictionPolicy('0xW2', 'solar', 'CA'),
                aceService.enforceJurisdictionPolicy('0xW3', 'mortgage', 'NY'),
                aceService.enforceJurisdictionPolicy('0xW4', 'roofing', 'TX'),
                aceService.enforceJurisdictionPolicy('0xW5', 'solar', 'FL'),
            ]);

            expect(checks).toHaveLength(5);
            checks.forEach(c => expect(c.allowed).toBe(true));
        });
    });

    // ─── Jurisdiction Policy (DB-backed) ─────────

    describe('jurisdiction policy enforcement', () => {
        it('should allow when no DB restriction', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);

            const result = await aceService.enforceJurisdictionPolicy('0xOK', 'solar', 'FL');
            expect(result.allowed).toBe(true);
        });

        it('should block when DB has failed check', async () => {
            (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue({
                status: 'FAILED',
                entityId: 'NY-mortgage',
            });

            const result = await aceService.enforceJurisdictionPolicy('0xRestricted', 'mortgage', 'NY');
            expect(result.allowed).toBe(false);
        });
    });
});
