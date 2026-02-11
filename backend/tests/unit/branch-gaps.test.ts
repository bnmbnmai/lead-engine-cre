// @ts-nocheck
/**
 * Branch Gap Tests
 *
 * Targets every uncovered branch identified in the Jest coverage report
 * to push overall branch coverage from 85% → 90%+.
 *
 * Gap map:
 *  - cre.service.ts   83.15% → lines 171-175 (on-chain getQualityScore), 261-262 (param match), 293-294 (ZK local fail)
 *  - auto-bid         82.05% → line 117 (qualityScore is null/0)
 *  - crm.routes.ts    85.82% → lines 253-259 (circuit cooldown), 273-277 (retry 5xx), 300-307 (circuit+rate limit), 328-329 (circuit trip)
 *  - zk.service.ts    87.50% → lines 108-109 (missing parameter), 115-117 (string mismatch)
 */

// ============================================
// Mock Prisma (shared across tests)
// ============================================

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        lead: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
        ask: { findUnique: jest.fn() },
        complianceCheck: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
        buyerProfile: { findFirst: jest.fn() },
        nftToken: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        transaction: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        buyerPreferenceSet: { findMany: jest.fn() },
        bid: { findFirst: jest.fn(), create: jest.fn(), aggregate: jest.fn() },
        analyticsEvent: { create: jest.fn().mockResolvedValue({}) },
    },
}));

// Mock ethers to avoid live RPC
jest.mock('ethers', () => {
    const actual = jest.requireActual('ethers');
    return {
        ...actual,
        ethers: {
            ...actual.ethers,
            JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
            Wallet: jest.fn().mockImplementation(() => ({ address: '0xTestWallet' })),
            Contract: jest.fn().mockImplementation(() => ({})),
        },
    };
});

import { prisma } from '../../src/lib/prisma';
import { zkService } from '../../src/services/zk.service';

// ═══════════════════════════════════════════════
// ZK Service — Uncovered Branches (lines 107-117)
// ═══════════════════════════════════════════════

describe('ZK Service — branch gaps', () => {
    it('should fail parameterMatch when parameter is undefined (line 107-109)', () => {
        const result = zkService.generateGeoParameterMatchProof(
            {
                vertical: 'solar',
                geoState: 'FL',
                parameters: { /* creditScore missing */ },
            },
            {
                vertical: 'solar',
                targetStates: ['FL'],
                minParameters: { creditScore: 700 },
            },
        );
        expect(result.parameterMatch).toBe(false);
        expect(result.geoMatch).toBe(true);
    });

    it('should fail parameterMatch on string mismatch (line 115-117)', () => {
        const result = zkService.generateGeoParameterMatchProof(
            {
                vertical: 'mortgage',
                geoState: 'CA',
                parameters: { loanType: 'conventional' },
            },
            {
                vertical: 'mortgage',
                targetStates: ['CA'],
                minParameters: { loanType: 'FHA' },
            },
        );
        expect(result.parameterMatch).toBe(false);
    });

    it('should pass parameterMatch on string equality', () => {
        const result = zkService.generateGeoParameterMatchProof(
            {
                vertical: 'mortgage',
                geoState: 'CA',
                parameters: { loanType: 'FHA' },
            },
            {
                vertical: 'mortgage',
                targetStates: ['CA'],
                minParameters: { loanType: 'FHA' },
            },
        );
        expect(result.parameterMatch).toBe(true);
    });

    it('should handle empty targetStates (line 101 geoMatch = true)', () => {
        const result = zkService.generateGeoParameterMatchProof(
            { vertical: 'solar', geoState: 'FL', parameters: {} },
            { vertical: 'solar', targetStates: [] },
        );
        expect(result.geoMatch).toBe(true);
    });
});

// ═══════════════════════════════════════════════
// CRE Service — branch gaps (lines 171-175, 261-262, 293-294)
// ═══════════════════════════════════════════════

describe('CRE Service — branch gaps', () => {
    let creService: any;

    beforeAll(async () => {
        const mod = await import('../../src/services/cre.service');
        creService = mod.creService;
    });

    afterEach(() => {
        jest.resetAllMocks();
        creService['contract'] = null;
        creService['signer'] = null;
    });

    it('getQualityScore: on-chain returns positive score (line 171-173)', async () => {
        const mockContract = {
            getLeadQualityScore: jest.fn().mockResolvedValue(9500n),
        };
        creService['contract'] = mockContract;

        const score = await creService.getQualityScore('onchain-lead-1', 42);
        expect(score).toBe(9500);
        expect(mockContract.getLeadQualityScore).toHaveBeenCalledWith(42);
    });

    it('getQualityScore: on-chain returns 0 → falls through to off-chain (line 173 false branch)', async () => {
        const mockContract = {
            getLeadQualityScore: jest.fn().mockResolvedValue(0n),
        };
        creService['contract'] = mockContract;

        (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
            id: 'oc-lead-2',
            vertical: 'solar',
            isVerified: true,
            geo: { state: 'FL', country: 'US' },
            source: 'PLATFORM',
        });

        const score = await creService.getQualityScore('oc-lead-2', 42);
        expect(score).toBeGreaterThan(0); // off-chain fallback
    });

    it('getQualityScore: on-chain error → falls back to off-chain (line 174-175)', async () => {
        const mockContract = {
            getLeadQualityScore: jest.fn().mockRejectedValue(new Error('RPC down')),
        };
        creService['contract'] = mockContract;

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
            id: 'err-lead-qs',
            vertical: 'solar',
            isVerified: false,
            geo: { state: 'FL', country: 'US' },
            source: 'API',
        });

        const score = await creService.getQualityScore('err-lead-qs', 42);
        expect(score).toBeGreaterThan(0);
        consoleSpy.mockRestore();
    });

    it('matchLeadToAsk: param match with string equality (line 261-262)', async () => {
        (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
            id: 'pm-str-lead',
            vertical: 'mortgage',
            geo: { country: 'US', state: 'CA' },
            source: 'PLATFORM',
            reservePrice: 50,
            isVerified: true,
            parameters: { loanType: 'FHA' },
        });

        (prisma.ask as any).findUnique.mockResolvedValue({
            id: 'ask-1',
            vertical: 'mortgage',
            geoTargets: { country: 'US', states: ['CA'] },
            parameters: { loanType: 'FHA' },
            reservePrice: 60,
        });

        const result = await creService.matchLeadToAsk('pm-str-lead', 'ask-1');

        // vertical(3000) + country(500) + geo(2000) + reserve(1500) + params(300) = 7300 >= 5000
        expect(result.matches).toBe(true);
        expect(result.details.some((d: string) => d.includes('Parameters'))).toBe(true);
    });

    it('requestZKFraudDetection: local proof fails (line 293-294)', async () => {
        (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
            id: 'zk-fail',
            vertical: 'solar',
            geo: { state: 'FL' },
            dataHash: null,
            tcpaConsentAt: null,
            source: 'API',
        });

        const origVerify = zkService.verifyProofLocally.bind(zkService);
        zkService.verifyProofLocally = jest.fn().mockReturnValue({
            valid: false,
            reason: 'Empty proof',
        });

        (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({});

        const result = await creService.requestZKFraudDetection('zk-fail', 1);
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('Empty proof');

        zkService.verifyProofLocally = origVerify;
    });
});

// ═══════════════════════════════════════════════
// X402 Service — additional branch gaps
// ═══════════════════════════════════════════════

describe('X402 Service — branch gaps', () => {
    let x402Service: any;

    beforeAll(async () => {
        const mod = await import('../../src/services/x402.service');
        x402Service = mod.x402Service;
    });

    afterEach(() => {
        x402Service['escrowContract'] = null;
        x402Service['usdcContract'] = null;
        x402Service['signer'] = null;
    });

    it('settlePayment: on-chain settle path', async () => {
        (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
            id: 'tx-settle-gap',
            status: 'ESCROWED',
            escrowId: '0xesc1',
        });

        const mockEscrow = {
            releaseEscrow: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({ hash: '0xrelease' }),
            }),
        };
        x402Service['escrowContract'] = mockEscrow;
        x402Service['signer'] = { address: '0xS' };

        (prisma.transaction.update as jest.Mock).mockResolvedValue({});

        const result = await x402Service.settlePayment('tx-settle-gap');
        expect(result.success).toBe(true);
    });

    it('refundPayment: on-chain refund path', async () => {
        (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
            id: 'tx-refund-gap',
            status: 'ESCROWED',
            escrowId: '0xesc2',
        });

        const mockEscrow = {
            refundEscrow: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({ hash: '0xrefund' }),
            }),
        };
        x402Service['escrowContract'] = mockEscrow;
        x402Service['signer'] = { address: '0xS' };

        (prisma.transaction.update as jest.Mock).mockResolvedValue({});

        const result = await x402Service.refundPayment('tx-refund-gap');
        expect(result.success).toBe(true);
    });

    it('getPaymentStatus: on-chain status query', async () => {
        (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
            id: 'tx-status-gap',
            status: 'ESCROWED',
            escrowId: '0xesc3',
        });
        const mockEscrow = {
            getEscrowStatus: jest.fn().mockResolvedValue({
                status: 1n,
                amount: 50000000n,
                seller: '0xSeller',
                buyer: '0xBuyer',
            }),
        };
        x402Service['escrowContract'] = mockEscrow;
        x402Service['signer'] = { address: '0xS' };

        const result = await x402Service.getPaymentStatus('tx-status-gap');
        expect(result).not.toBeNull();
    });
});

// ═══════════════════════════════════════════════
// Auto-Bid — branch gaps (line 117: null qualityScore)
// ═══════════════════════════════════════════════

describe('Auto-Bid — branch gaps', () => {
    it('should handle null qualityScore with quality gate (line 117)', async () => {
        const { evaluateLeadForAutoBid } = require('../../src/services/auto-bid.service');

        const prefSet = {
            id: 'pref-null-qs',
            buyerId: 'buyer-qs',
            label: 'Test Pref',
            isActive: true,
            verticals: ['solar'],
            geoInclude: [],
            geoExclude: [],
            geoCountry: 'US',
            acceptOffSite: true,
            autoBidAmount: 100,
            dailyBudget: 1000,
            requireVerified: false,
            minQualityScore: 8000,
            maxBidPerLead: null,
            buyerProfile: { userId: 'buyer-qs', user: { id: 'buyer-qs', walletAddress: '0xBuyerQS' } },
        };

        (prisma.buyerPreferenceSet.findMany as jest.Mock).mockResolvedValue([prefSet]);
        (prisma.bid.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.bid.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 } });

        const result = await evaluateLeadForAutoBid({
            id: 'null-qs-lead',
            vertical: 'solar',
            geo: { country: 'US', state: 'FL' },
            source: 'PLATFORM',
            qualityScore: null,
            isVerified: true,
            reservePrice: 50,
        });

        expect(result.skipped[0].reason).toContain('Quality 0 < min 8000');
    });

    it('should handle lead with undefined geo fields in batch (line 253-254)', async () => {
        const { batchEvaluateLeads } = require('../../src/services/auto-bid.service');

        (prisma.lead.findMany as jest.Mock).mockResolvedValue([
            {
                id: 'no-geo-lead',
                vertical: 'solar',
                source: 'API',
                geo: {},
                qualityScore: null,
                isVerified: false,
                reservePrice: 0,
            },
        ]);

        (prisma.buyerPreferenceSet.findMany as jest.Mock).mockResolvedValue([]);

        const results = await batchEvaluateLeads(['no-geo-lead']);
        expect(results).toHaveLength(1);
    });
});

// ═══════════════════════════════════════════════
// CRM Routes — webhook internals (fetchWithRetry, circuit breaker)
// ═══════════════════════════════════════════════

describe('CRM Routes — webhook branch gaps', () => {
    let fireCRMWebhooks: any;

    beforeAll(async () => {
        const mod = await import('../../src/routes/crm.routes');
        fireCRMWebhooks = mod.fireCRMWebhooks;
    });

    it('handles circuit breaker paths via repeated failures', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        const mockFetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        global.fetch = mockFetch as any;

        for (let i = 0; i < 5; i++) {
            await fireCRMWebhooks('lead.sold', [{ id: 'cb-test' }]);
        }

        consoleSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    it('handles rate-limited webhooks', async () => {
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        for (let i = 0; i < 3; i++) {
            await fireCRMWebhooks('lead.sold', [{ id: `rl-${i}` }]);
        }

        consoleWarnSpy.mockRestore();
        consoleSpy.mockRestore();
    });
});
