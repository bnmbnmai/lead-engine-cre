/**
 * CRE Service Unit Tests
 * 
 * Tests lead verification, quality scoring, parameter matching,
 * and ZK fraud detection with mocked Prisma.
 */

// Mock prisma before importing the service
jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        lead: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        ask: {
            findUnique: jest.fn(),
        },
        complianceCheck: {
            create: jest.fn(),
        },
    },
}));

import { prisma } from '../../src/lib/prisma';

// We need to re-import creService after mock is set up
// Use dynamic import to work around module caching
let creService: any;

beforeAll(async () => {
    const mod = await import('../../src/services/cre.service');
    creService = mod.creService;
});

afterEach(() => {
    jest.clearAllMocks();
});

describe('CREService', () => {

    // ─── verifyLead ──────────────────────────────

    describe('verifyLead', () => {
        it('should return invalid for non-existent lead', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await creService.verifyLead('nonexistent-id');
            expect(result.isValid).toBe(false);
            expect(result.reason).toBe('Lead not found');
        });

        it('should return valid for already-verified lead', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-1',
                isVerified: true,
            });

            const result = await creService.verifyLead('lead-1');
            expect(result.isValid).toBe(true);
        });

        it('should fail for lead without TCPA consent', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-2',
                isVerified: false,
                dataHash: null,
                encryptedData: null,
                tcpaConsentAt: null,
                geo: { state: 'FL', zip: '33101' },
            });

            const result = await creService.verifyLead('lead-2');
            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('TCPA');
        });

        it('should fail for lead with expired TCPA consent', async () => {
            const expiredDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31 days ago
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-3',
                isVerified: false,
                dataHash: null,
                encryptedData: null,
                tcpaConsentAt: expiredDate,
                geo: { state: 'FL', zip: '33101' },
            });

            const result = await creService.verifyLead('lead-3');
            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('expired');
        });

        it('should fail for invalid US state', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-4',
                isVerified: false,
                dataHash: null,
                encryptedData: null,
                tcpaConsentAt: new Date(),
                geo: { state: 'XX', zip: '00000' },
            });

            const result = await creService.verifyLead('lead-4');
            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('region');
        });

        it('should pass for valid lead with all checks', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-5',
                isVerified: false,
                dataHash: null,
                encryptedData: null,
                tcpaConsentAt: new Date(),
                geo: { state: 'FL', zip: '33101' },
            });
            (prisma.lead.update as jest.Mock).mockResolvedValue({});
            (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({});

            const result = await creService.verifyLead('lead-5');
            expect(result.isValid).toBe(true);
            expect(prisma.lead.update).toHaveBeenCalledWith(expect.objectContaining({
                data: { isVerified: true },
            }));
        });

        it('should fail for data integrity mismatch', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-6',
                isVerified: false,
                dataHash: '0xwronghash',
                encryptedData: 'some-encrypted-data',
                tcpaConsentAt: new Date(),
                geo: { state: 'FL' },
            });

            const result = await creService.verifyLead('lead-6');
            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('integrity');
        });
    });

    // ─── getQualityScore (on-chain only) ──────────

    describe('getQualityScore', () => {
        it('should return null for non-existent lead', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue(null);
            const score = await creService.getQualityScore('nonexistent');
            expect(score).toBeNull();
        });

        it('should return null without tokenId (on-chain only)', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-1',
                isVerified: true,
                tcpaConsentAt: new Date(),
                geo: { state: 'FL', zip: '33101' },
                parameters: { creditScore: 720 },
            });

            // No tokenId → on-chain not possible → returns null
            const score = await creService.getQualityScore('lead-1');
            expect(score).toBeNull();
        });
    });

    // ─── matchLeadToAsk ──────────────────────────

    describe('matchLeadToAsk', () => {
        it('should return no match for nonexistent lead or ask', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.ask.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await creService.matchLeadToAsk('lead-x', 'ask-x');
            expect(result.matches).toBe(false);
            expect(result.details).toContain('Lead or Ask not found');
        });

        it('should reject on vertical mismatch', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geo: { state: 'FL' },
            });
            (prisma.ask.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'mortgage',
                geoTargets: null,
            });

            const result = await creService.matchLeadToAsk('lead-1', 'ask-1');
            expect(result.matches).toBe(false);
            expect(result.details).toContain('Vertical mismatch');
        });

        it('should match with correct vertical and geo', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geo: { state: 'FL' },
                reservePrice: 20,
                parameters: { creditScore: 720 },
            });
            (prisma.ask.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geoTargets: { states: ['FL', 'CA'] },
                reservePrice: 35,
                parameters: { creditScore: 700 },
            });

            const result = await creService.matchLeadToAsk('lead-1', 'ask-1');
            expect(result.matches).toBe(true);
            expect(result.score).toBeGreaterThanOrEqual(5000);
            expect(result.details).toContain('Vertical: match');
            expect(result.details).toContain('Geo: region match');
        });

        it('should reject when lead geo not in targeted states', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geo: { state: 'TX' },
            });
            (prisma.ask.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geoTargets: { states: ['FL', 'CA'] },
            });

            const result = await creService.matchLeadToAsk('lead-1', 'ask-1');
            expect(result.matches).toBe(false);
        });

        it('should add score for meeting reserve price', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geo: { state: 'FL' },
                reservePrice: 20,
                parameters: {},
            });
            (prisma.ask.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geoTargets: { states: ['FL'] },
                reservePrice: 30, // Meets reserve
                parameters: {},
            });

            const result = await creService.matchLeadToAsk('lead-1', 'ask-1');
            expect(result.details).toContain('Price: meets reserve');
        });

        it('should match using "regions" key (not just "states")', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geo: { state: 'CA', country: 'US' },
                reservePrice: 10,
                parameters: {},
            });
            (prisma.ask.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geoTargets: { country: 'US', regions: ['CA', 'NV'] },
                reservePrice: 20,
                parameters: {},
            });

            const result = await creService.matchLeadToAsk('lead-1', 'ask-1');
            expect(result.matches).toBe(true);
            expect(result.details).toContain('Geo: region match');
        });

        it('should reject on country mismatch', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geo: { country: 'US', state: 'FL' },
            });
            (prisma.ask.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geoTargets: { country: 'DE' },
            });

            const result = await creService.matchLeadToAsk('lead-1', 'ask-1');
            expect(result.matches).toBe(false);
            expect(result.details).toContain('Country mismatch');
        });

        it('should add geo bonus when no region restrictions', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geo: { state: 'FL' },
                reservePrice: 10,
                parameters: {},
            });
            (prisma.ask.findUnique as jest.Mock).mockResolvedValue({
                vertical: 'solar',
                geoTargets: {},  // no states/regions
                reservePrice: 20,
                parameters: {},
            });

            const result = await creService.matchLeadToAsk('lead-1', 'ask-1');
            expect(result.details).toContain('Geo: no restrictions');
        });
    });

    // ─── requestZKFraudDetection ─────────────────

    describe('requestZKFraudDetection', () => {
        it('should return invalid for non-existent lead', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await creService.requestZKFraudDetection('missing', 1);
            expect(result.isValid).toBe(false);
            expect(result.reason).toBe('Lead not found');
        });

        it('should verify locally and return valid for existing lead', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-zk',
                vertical: 'solar',
                geo: { state: 'FL', zip: '33101' },
                dataHash: null,
                tcpaConsentAt: new Date(),
                source: 'PLATFORM',
            });
            (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({});

            const result = await creService.requestZKFraudDetection('lead-zk', 42);
            expect(result.isValid).toBe(true);
            expect(result.requestId).toBeDefined();
        });
    });

    // ─── requestParameterMatchOnChain ────────────

    describe('requestParameterMatchOnChain', () => {
        it('should return error when contract not configured', async () => {
            const result = await creService.requestParameterMatchOnChain(1, {
                vertical: 'solar',
                geoStates: ['FL'],
                paramKeys: ['creditScore'],
                paramValues: ['720'],
            });
            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('not configured');
        });
    });

    // ─── requestGeoValidationOnChain ─────────────

    describe('requestGeoValidationOnChain', () => {
        it('should return error when contract not configured', async () => {
            const result = await creService.requestGeoValidationOnChain(1, 'FL');
            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('not configured');
        });
    });

    // ─── verifyLead edge cases ───────────────────

    describe('verifyLead (geo edge cases)', () => {
        it('should fail for lead with no geo data', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-nogeo',
                isVerified: false,
                dataHash: null,
                encryptedData: null,
                tcpaConsentAt: new Date(),
                geo: null,
            });
            (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({});

            const result = await creService.verifyLead('lead-nogeo');
            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('Geographic');
        });

        it('should allow lead with unknown country code', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-xx',
                isVerified: false,
                dataHash: null,
                encryptedData: null,
                tcpaConsentAt: new Date(),
                geo: { country: 'ZZ', state: 'XX' },
            });
            (prisma.lead.update as jest.Mock).mockResolvedValue({});
            (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({});

            const result = await creService.verifyLead('lead-xx');
            // Unknown country is allowed (warn but pass)
            expect(result.isValid).toBe(true);
        });
    });
});
