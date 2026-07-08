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

    // ─── Envelope Encryption (Phase B4) ──────────

    describe('envelope encryption (per-payload DEK wrapped by master KEK)', () => {
        it('should attach a wrapped DEK and key version to every new payload', () => {
            const { encrypted } = privacyService.encryptLeadPII({ firstName: 'Eve' });

            expect(encrypted.wrappedKey).toBeTruthy();
            // iv(12) + tag(16) + dek(32) = 60 bytes = 120 hex chars
            expect(encrypted.wrappedKey).toMatch(/^[a-f0-9]{120}$/);
            expect(encrypted.keyVersion).toBeTruthy();
        });

        it('should use a unique DEK per payload (different wrappedKey)', () => {
            const first = privacyService.encryptLeadPII({ a: 1 });
            const second = privacyService.encryptLeadPII({ a: 1 });
            expect(first.encrypted.wrappedKey).not.toEqual(second.encrypted.wrappedKey);
        });

        it('should decrypt legacy payloads encrypted directly with the master key', () => {
            // Simulate a pre-B4 payload: AES-256-GCM with the master key, no wrappedKey
            const crypto = require('crypto');
            const masterKeyHex = process.env.PRIVACY_MASTER_KEY || process.env.PRIVACY_ENCRYPTION_KEY!;
            let key = Buffer.from(masterKeyHex, 'hex');
            if (key.length !== 32) key = crypto.createHash('sha256').update(masterKeyHex).digest();

            const plaintext = JSON.stringify({ firstName: 'Legacy', email: 'old@data.com' });
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
            ciphertext += cipher.final('hex');

            const legacyPayload = {
                ciphertext,
                iv: iv.toString('hex'),
                tag: cipher.getAuthTag().toString('hex'),
                commitment: '0x' + '0'.repeat(64),
                // no wrappedKey / keyVersion — legacy format
            };

            const decrypted = privacyService.decryptLeadPII(legacyPayload as any);
            expect(decrypted).toEqual({ firstName: 'Legacy', email: 'old@data.com' });
        });

        it('should throw when the wrapped DEK is tampered with', () => {
            const { encrypted } = privacyService.encryptLeadPII({ firstName: 'Mallory' });
            const flipped = encrypted.wrappedKey!.split('').map(c => {
                const n = parseInt(c, 16);
                return isNaN(n) ? c : ((n ^ 0xf).toString(16));
            }).join('');

            const tampered = { ...encrypted, wrappedKey: flipped };
            expect(() => privacyService.decryptLeadPII(tampered)).toThrow();
        });
    });
});
