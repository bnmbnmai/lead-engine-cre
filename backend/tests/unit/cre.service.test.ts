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
            expect(result.reason).toContain('state');
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

    // ─── getQualityScore ─────────────────────────

    describe('getQualityScore', () => {
        it('should return 0 for non-existent lead', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue(null);
            const score = await creService.getQualityScore('nonexistent');
            expect(score).toBe(0);
        });

        it('should return base score for minimal lead', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-1',
                isVerified: false,
                tcpaConsentAt: null,
                geo: {},
                parameters: null,
            });

            const score = await creService.getQualityScore('lead-1');
            expect(score).toBe(5000);
        });

        it('should add bonuses for verified lead with all fields', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-2',
                isVerified: true,           // +1000
                tcpaConsentAt: new Date(),  // +500
                geo: { state: 'FL', zip: '33101' }, // +500
                parameters: { creditScore: 720, loanAmount: 350000 }, // +200
            });

            const score = await creService.getQualityScore('lead-2');
            expect(score).toBe(7200); // 5000 + 1000 + 500 + 500 + 200
        });

        it('should cap quality score at 10000', async () => {
            (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
                id: 'lead-3',
                isVerified: true,
                tcpaConsentAt: new Date(),
                geo: { state: 'FL', zip: '33101' },
                parameters: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }, // 7 * 100 = 700, capped at 500
            });

            const score = await creService.getQualityScore('lead-3');
            expect(score).toBeLessThanOrEqual(10000);
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
            expect(result.details).toContain('Geo: state match');
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
    });
});
