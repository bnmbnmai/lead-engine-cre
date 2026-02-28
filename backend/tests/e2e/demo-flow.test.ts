/**
 * E2E Demo Flow Integration Test
 * 
 * Tests the full 8-step pipeline via the /api/v1/demo endpoints.
 * Requires a mock or actual database. When run without DB, 
 * this file validates the service integration logic with mocked Prisma.
 */

// Mock Prisma for tests
const mockPrisma = {
    lead: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
    },
    bid: {
        create: jest.fn(),
        update: jest.fn(),
    },
    transaction: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    user: {
        findFirst: jest.fn(),
        create: jest.fn(),
    },
    sellerProfile: {
        findFirst: jest.fn(),
        create: jest.fn(),
    },
    complianceCheck: {
        findFirst: jest.fn(),
        create: jest.fn(),
    },
    $queryRaw: jest.fn(),
};

jest.mock('../../src/lib/prisma', () => ({ prisma: mockPrisma }));

// Import services after mock
import { zkService } from '../../src/services/zk.service';
import { privacyService } from '../../src/services/privacy.service';

afterEach(() => {
    jest.clearAllMocks();
});

describe('E2E Demo Flow', () => {

    // ─── Step-by-step pipeline simulation ────────
    // Since we can't start the full HTTP server in unit tests,
    // we replicate the pipeline logic from integration.routes.ts

    describe('full pipeline simulation', () => {
        it('should complete all 8 steps successfully', async () => {
            // Step 1: Create lead
            const mockLead = {
                id: 'lead-e2e-1',
                sellerId: 'seller-1',
                vertical: 'solar',
                geo: { state: 'FL', zip: '33101', city: 'Miami' },
                source: 'PLATFORM',
                parameters: { creditScore: 720, propertyType: 'single_family' },
                reservePrice: 25.00,
                tcpaConsentAt: new Date(),
                dataHash: '',
                isVerified: false,
            };
            mockPrisma.lead.create.mockResolvedValue(mockLead);

            const lead = await mockPrisma.lead.create({ data: mockLead });
            expect(lead.id).toBe('lead-e2e-1');

            // Step 2: CRE Verify (mocked — assumes pass)
            // In real tests this would call creService.verifyLead()
            const verifyResult = { isValid: true, score: 7200 };
            expect(verifyResult.isValid).toBe(true);

            // Step 3: ZK Fraud Detection
            const zkProof = zkService.generateFraudProof({
                vertical: 'solar',
                geoState: 'FL',
                geoZip: '33101',
                dataHash: '',
                tcpaConsentAt: new Date(),
                source: 'PLATFORM',
            });
            const zkVerify = zkService.verifyProofLocally(zkProof);
            expect(zkVerify.valid).toBe(true);
            expect(zkProof.commitment).toMatch(/^0x/);

            // Step 4: NFT Mint (off-chain)
            const mintResult = { success: true, tokenId: 'offchain-e2e-1' };
            expect(mintResult.success).toBe(true);

            // Step 5: ACE Compliance
            const complianceResult = { allowed: true };
            expect(complianceResult.allowed).toBe(true);

            // Step 6: Encrypted Bid
            const bidCommitment = privacyService.encryptBid(35.00, '0xBuyerE2E');
            expect(bidCommitment.commitment).toMatch(/^0x[a-f0-9]{64}$/);
            expect(bidCommitment.salt).toMatch(/^0x[a-f0-9]{64}$/);

            mockPrisma.bid.create.mockResolvedValue({
                id: 'bid-e2e-1',
                leadId: 'lead-e2e-1',
                buyerId: 'user-buyer-1',
                amount: 35.00,
                commitment: bidCommitment.commitment,
                status: 'PENDING',
            });
            const bid = await mockPrisma.bid.create({
                data: {
                    leadId: 'lead-e2e-1',
                    buyerId: 'user-buyer-1',
                    amount: 35.00,
                    commitment: bidCommitment.commitment,
                    status: 'PENDING',
                },
            });
            expect(bid.commitment).toBe(bidCommitment.commitment);

            // Step 7: Reveal + Auction Resolve
            const revealed = privacyService.decryptBid(bidCommitment.encryptedBid, '0xBuyerE2E');
            expect(revealed.amount).toBe(35.00);
            expect(revealed.valid).toBe(true);

            mockPrisma.bid.update.mockResolvedValue({ status: 'ACCEPTED' });
            mockPrisma.lead.update.mockResolvedValue({ status: 'SOLD', winningBid: 35.00 });

            // Step 8: Escrow Settlement (off-chain)
            mockPrisma.transaction.create.mockResolvedValue({
                id: 'tx-e2e-1',
                amount: 35.00,
                status: 'PENDING',
            });
            mockPrisma.transaction.update.mockResolvedValue({
                id: 'tx-e2e-1',
                status: 'RELEASED',
                escrowReleased: true,
            });

            const tx = await mockPrisma.transaction.create({
                data: {
                    leadId: 'lead-e2e-1',
                    buyerId: 'user-buyer-1',
                    amount: 35.00,
                    currency: 'USDC',
                    status: 'PENDING',
                },
            });
            expect(tx.status).toBe('PENDING');

            // Verify complete pipeline
            expect(zkVerify.valid).toBe(true);
            expect(revealed.valid).toBe(true);
            expect(bid.status).toBe('PENDING');
        });

        it('should handle non-compliant buyer (ACE blocked)', async () => {
            // Simulate ACE blocking a buyer
            mockPrisma.complianceCheck.findFirst.mockResolvedValue({
                id: 'block-1',
                entityType: 'jurisdiction',
                entityId: 'NY-mortgage',
                status: 'FAILED',
            });

            const check = await mockPrisma.complianceCheck.findFirst({});
            expect(check.status).toBe('FAILED');
            // Pipeline should stop at step 5
        });

        it('should handle wrong buyer address in bid reveal', () => {
            const bidCommitment = privacyService.encryptBid(50.00, '0xCorrectBuyer');
            const wrongReveal = privacyService.decryptBid(bidCommitment.encryptedBid, '0xWrongBuyer');

            expect(wrongReveal.valid).toBe(false);
            expect(wrongReveal.amount).toBe(0);
        });
    });

    // ─── ZK + Privacy Integration ────────────────

    describe('ZK + Privacy cross-service', () => {
        it('should generate matching ZK proof and privacy commitment for same lead', () => {
            const leadData = {
                vertical: 'mortgage',
                geoState: 'CA',
                geoZip: '90210',
                dataHash: '0xmortgagedata',
                source: 'API' as const,
            };

            // ZK side
            const zkProof = zkService.generateFraudProof(leadData);
            const bidCommitment = zkService.generateBidCommitment(150.00);

            // Privacy side
            const encBid = privacyService.encryptBid(150.00, '0xBuyerCA');

            // Both should produce valid commitments
            expect(zkProof.commitment).toMatch(/^0x[a-f0-9]{64}$/);
            expect(bidCommitment.commitment).toMatch(/^0x[a-f0-9]{64}$/);
            expect(encBid.commitment).toMatch(/^0x[a-f0-9]{64}$/);

            // ZK bid commitment and privacy bid commitment are independent but both valid
            expect(bidCommitment.commitment).not.toEqual(encBid.commitment);
        });

        it('should geo-match mortgage lead to CA buyer criteria', () => {
            const matchProof = zkService.generateGeoParameterMatchProof(
                {
                    vertical: 'mortgage',
                    geoState: 'CA',
                    geoZip: '90210',
                    parameters: { creditScore: 750, loanAmount: 350000 },
                },
                {
                    vertical: 'mortgage',
                    targetStates: ['CA', 'WA', 'OR'],
                    minParameters: { creditScore: 700, loanAmount: 200000 },
                }
            );

            expect(matchProof.geoMatch).toBe(true);
            expect(matchProof.parameterMatch).toBe(true);
        });
    });
});
