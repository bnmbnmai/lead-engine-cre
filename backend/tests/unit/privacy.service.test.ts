import { privacyService } from '../../src/services/privacy.service';

/**
 * Privacy Service Unit Tests
 * 
 * Tests AES-256-GCM encryption, commit-reveal bids, PII protection,
 * token metadata encryption, and commitment verification.
 */
describe('PrivacyService', () => {

    // ─── AES-256-GCM Encrypt/Decrypt ─────────────

    describe('encrypt/decrypt round-trip', () => {
        it('should encrypt and decrypt lead PII correctly', () => {
            const pii = {
                firstName: 'John',
                lastName: 'Doe',
                email: 'john@example.com',
                phone: '555-0123',
                address: '123 Main St, Miami FL 33101',
            };

            const { encrypted, dataHash } = privacyService.encryptLeadPII(pii);

            expect(encrypted.ciphertext).toBeTruthy();
            expect(encrypted.iv).toBeTruthy();
            expect(encrypted.tag).toBeTruthy();
            expect(encrypted.commitment).toBeTruthy();
            expect(dataHash).toMatch(/^0x[a-f0-9]{64}$/);

            const decrypted = privacyService.decryptLeadPII(encrypted);
            expect(decrypted).toEqual(pii);
        });

        it('should produce different ciphertext for same plaintext (unique IV)', () => {
            const pii = { firstName: 'Alice' };
            const first = privacyService.encryptLeadPII(pii);
            const second = privacyService.encryptLeadPII(pii);

            expect(first.encrypted.ciphertext).not.toEqual(second.encrypted.ciphertext);
            expect(first.encrypted.iv).not.toEqual(second.encrypted.iv);
            // But same dataHash (deterministic)
            expect(first.dataHash).toEqual(second.dataHash);
        });

        it('should throw on tampered ciphertext', () => {
            const pii = { firstName: 'Bob' };
            const { encrypted } = privacyService.encryptLeadPII(pii);

            // Reliably tamper by flipping every hex char
            const flipped = encrypted.ciphertext.split('').map(c => {
                const n = parseInt(c, 16);
                return isNaN(n) ? c : ((n ^ 0xf).toString(16));
            }).join('');
            const tampered = { ...encrypted, ciphertext: flipped };
            expect(() => privacyService.decryptLeadPII(tampered)).toThrow();
        });

        it('should throw on tampered auth tag', () => {
            const pii = { email: 'test@test.com' };
            const { encrypted } = privacyService.encryptLeadPII(pii);

            const tampered = { ...encrypted, tag: 'a'.repeat(encrypted.tag.length) };
            expect(() => privacyService.decryptLeadPII(tampered)).toThrow();
        });
    });

    // ─── Bid Encryption (Commit-Reveal) ──────────

    describe('encryptBid / decryptBid', () => {
        it('should encrypt bid and decrypt with valid commitment', () => {
            const amount = 35.50;
            const buyerAddress = '0x1234567890abcdef1234567890abcdef12345678';

            const bidCommitment = privacyService.encryptBid(amount, buyerAddress);

            expect(bidCommitment.commitment).toMatch(/^0x[a-f0-9]{64}$/);
            expect(bidCommitment.salt).toMatch(/^0x[a-f0-9]{64}$/);
            expect(bidCommitment.encryptedBid.ciphertext).toBeTruthy();

            const revealed = privacyService.decryptBid(bidCommitment.encryptedBid, buyerAddress);
            expect(revealed.amount).toBe(amount);
            expect(revealed.salt).toBe(bidCommitment.salt);
            expect(revealed.valid).toBe(true);
        });

        it('should fail reveal with wrong buyer address (AAD mismatch)', () => {
            const bidCommitment = privacyService.encryptBid(50.00, '0xCorrectBuyer');
            const revealed = privacyService.decryptBid(bidCommitment.encryptedBid, '0xWrongBuyer');

            expect(revealed.valid).toBe(false);
            expect(revealed.amount).toBe(0);
        });

        it('should produce unique commitments for same amount (different salts)', () => {
            const buyer = '0xBuyer';
            const bid1 = privacyService.encryptBid(100, buyer);
            const bid2 = privacyService.encryptBid(100, buyer);

            expect(bid1.commitment).not.toEqual(bid2.commitment);
            expect(bid1.salt).not.toEqual(bid2.salt);
        });

        it('should handle small and large amounts', () => {
            const buyer = '0xBuyer';

            const smallBid = privacyService.encryptBid(0.01, buyer);
            const revealed1 = privacyService.decryptBid(smallBid.encryptedBid, buyer);
            expect(revealed1.amount).toBe(0.01);

            const largeBid = privacyService.encryptBid(999999.99, buyer);
            const revealed2 = privacyService.decryptBid(largeBid.encryptedBid, buyer);
            expect(revealed2.amount).toBe(999999.99);
        });
    });

    // ─── Token Metadata Encryption ───────────────

    describe('encryptTokenMetadata / decryptTokenMetadata', () => {
        it('should keep public fields visible and encrypt private fields', () => {
            const { publicMetadata, encryptedFields } = privacyService.encryptTokenMetadata({
                vertical: 'solar',
                geoState: 'FL',
                qualityScore: 8500,
                source: 'PLATFORM',
                piiData: { firstName: 'Jane', email: 'jane@test.com' },
                parameters: { creditScore: 750, loanAmount: 200000 },
            });

            // Public fields visible
            expect(publicMetadata.vertical).toBe('solar');
            expect(publicMetadata.geoState).toBe('FL');
            expect(publicMetadata.qualityScore).toBe(8500);
            expect(publicMetadata.hasEncryptedFields).toBe(true);
            expect(publicMetadata.encryptedFieldsHash).toMatch(/^0x/);

            // Private fields encrypted
            expect(encryptedFields).not.toBeNull();
            const decrypted = privacyService.decryptTokenMetadata(encryptedFields!);
            expect(decrypted.pii?.firstName).toBe('Jane');
            expect(decrypted.parameters?.creditScore).toBe(750);
        });

        it('should return null encryptedFields when no PII or parameters', () => {
            const { publicMetadata, encryptedFields } = privacyService.encryptTokenMetadata({
                vertical: 'mortgage',
                geoState: 'CA',
                qualityScore: 7000,
                source: 'API',
            });

            expect(publicMetadata.vertical).toBe('mortgage');
            expect(encryptedFields).toBeNull();
            expect(publicMetadata.hasEncryptedFields).toBeUndefined();
        });
    });

    // ─── Commitment Generation / Verification ────

    describe('generateCommitment / verifyCommitment', () => {
        it('should generate and verify a valid commitment', () => {
            const { commitment, salt } = privacyService.generateCommitment('my-secret-value');

            expect(commitment).toMatch(/^0x[a-f0-9]{64}$/);
            expect(salt).toMatch(/^0x[a-f0-9]{64}$/);

            expect(privacyService.verifyCommitment(commitment, 'my-secret-value', salt)).toBe(true);
        });

        it('should fail verification with wrong value', () => {
            const { commitment, salt } = privacyService.generateCommitment('correct-value');
            expect(privacyService.verifyCommitment(commitment, 'wrong-value', salt)).toBe(false);
        });

        it('should fail verification with wrong salt', () => {
            const { commitment } = privacyService.generateCommitment('some-value');
            const wrongSalt = '0x' + 'ab'.repeat(32);
            expect(privacyService.verifyCommitment(commitment, 'some-value', wrongSalt)).toBe(false);
        });
    });
});
