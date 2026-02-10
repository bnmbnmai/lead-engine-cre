import { zkService } from '../../src/services/zk.service';

/**
 * ZK Service Unit Tests
 * 
 * Tests proof generation, local verification, geo-parameter matching,
 * and bid commitment generation.
 */
describe('ZKService', () => {

    // ─── Fraud Proof Generation ──────────────────

    describe('generateFraudProof', () => {
        it('should generate a valid fraud proof with all fields', () => {
            const proof = zkService.generateFraudProof({
                vertical: 'solar',
                geoState: 'FL',
                geoZip: '33101',
                dataHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                tcpaConsentAt: new Date('2025-01-15'),
                source: 'PLATFORM',
            });

            expect(proof.proof).toMatch(/^0x[a-f0-9]{64}$/);
            expect(proof.commitment).toMatch(/^0x[a-f0-9]{64}$/);
            expect(proof.publicInputs).toBeInstanceOf(Array);
            expect(proof.publicInputs.length).toBeGreaterThan(0);
        });

        it('should produce different proofs for different leads', () => {
            const proof1 = zkService.generateFraudProof({
                vertical: 'solar',
                geoState: 'FL',
                dataHash: '0x0',
                source: 'PLATFORM',
            });

            const proof2 = zkService.generateFraudProof({
                vertical: 'mortgage',
                geoState: 'CA',
                dataHash: '0x0',
                source: 'API',
            });

            expect(proof1.proof).not.toEqual(proof2.proof);
            expect(proof1.commitment).not.toEqual(proof2.commitment);
        });

        it('should handle missing optional fields', () => {
            const proof = zkService.generateFraudProof({
                vertical: 'roofing',
                geoState: '',
                dataHash: '',
                source: 'WEBHOOK',
            });

            expect(proof.proof).toBeTruthy();
            expect(proof.commitment).toBeTruthy();
        });
    });

    // ─── Local Verification ──────────────────────

    describe('verifyProofLocally', () => {
        it('should verify a valid fraud proof', () => {
            const proof = zkService.generateFraudProof({
                vertical: 'solar',
                geoState: 'FL',
                geoZip: '33101',
                dataHash: '0xabc',
                source: 'PLATFORM',
            });

            const result = zkService.verifyProofLocally(proof);
            expect(result.valid).toBe(true);
        });

        it('should reject an empty/zero proof', () => {
            const result = zkService.verifyProofLocally({
                proof: '0x0000000000000000000000000000000000000000000000000000000000000000',
                publicInputs: ['0x1'],
                commitment: '0xabc',
            });
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Empty proof');
        });

        it('should reject a proof with no public inputs', () => {
            const proof = zkService.generateFraudProof({
                vertical: 'solar',
                geoState: 'FL',
                dataHash: '0xabc',
                source: 'PLATFORM',
            });

            const noInputs = { ...proof, publicInputs: [] };
            const result = zkService.verifyProofLocally(noInputs);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('No public inputs');
        });

        it('should reject a proof with zero commitment', () => {
            const proof = zkService.generateFraudProof({
                vertical: 'solar',
                geoState: 'FL',
                dataHash: '0x1',
                source: 'PLATFORM',
            });

            const zeroCmt = { ...proof, commitment: '0x0000000000000000000000000000000000000000000000000000000000000000' };
            const result = zkService.verifyProofLocally(zeroCmt);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Invalid commitment');
        });
    });

    // ─── Geo-Parameter Match Proof ───────────────

    describe('generateGeoParameterMatchProof', () => {
        it('should detect matching geo state', () => {
            const proof = zkService.generateGeoParameterMatchProof(
                {
                    vertical: 'mortgage',
                    geoState: 'CA',
                    geoZip: '90210',
                    parameters: { creditScore: 750, loanAmount: 350000 },
                },
                {
                    vertical: 'mortgage',
                    targetStates: ['CA', 'NY', 'FL'],
                    minParameters: { creditScore: 700 },
                }
            );

            expect(proof.geoMatch).toBe(true);
            expect(proof.parameterMatch).toBe(true);
            expect(proof.proof).toBeTruthy();
        });

        it('should detect non-matching geo state', () => {
            const proof = zkService.generateGeoParameterMatchProof(
                {
                    vertical: 'mortgage',
                    geoState: 'TX',
                    parameters: {},
                },
                {
                    vertical: 'mortgage',
                    targetStates: ['CA', 'NY'],
                    minParameters: {},
                }
            );

            expect(proof.geoMatch).toBe(false);
        });

        it('should detect parameter threshold failures', () => {
            const proof = zkService.generateGeoParameterMatchProof(
                {
                    vertical: 'solar',
                    geoState: 'FL',
                    parameters: { creditScore: 600 },
                },
                {
                    vertical: 'solar',
                    targetStates: ['FL'],
                    minParameters: { creditScore: 700 },
                }
            );

            expect(proof.geoMatch).toBe(true);
            expect(proof.parameterMatch).toBe(false);
        });
    });

    // ─── Bid Commitment ──────────────────────────

    describe('generateBidCommitment', () => {
        it('should generate a valid bid commitment', () => {
            const result = zkService.generateBidCommitment(100);

            expect(result.commitment).toMatch(/^0x[a-f0-9]{64}$/);
            expect(result.salt).toMatch(/^0x[a-f0-9]{64}$/);
        });

        it('should produce unique commitments for same amount (random salts)', () => {
            const c1 = zkService.generateBidCommitment(50);
            const c2 = zkService.generateBidCommitment(50);

            expect(c1.commitment).not.toEqual(c2.commitment);
        });
    });
});
