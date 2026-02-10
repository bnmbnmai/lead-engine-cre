/**
 * Privacy Audit Security Test
 * 
 * Validates encryption integrity, tamper detection, key binding,
 * and PII protection at rest.
 */

import { privacyService } from '../../src/services/privacy.service';

describe('Privacy Audit', () => {

    // ─── Encryption Never Leaks Plaintext ────────

    describe('no plaintext leakage', () => {
        it('should never contain original PII in ciphertext', () => {
            const pii = {
                firstName: 'SensitiveFirstName',
                email: 'secret@privacy.com',
                phone: '555-9999',
                ssn: '123-45-6789',
            };

            const { encrypted } = privacyService.encryptLeadPII(pii);

            // Ciphertext should NOT contain any plaintext substring
            expect(encrypted.ciphertext).not.toContain('SensitiveFirstName');
            expect(encrypted.ciphertext).not.toContain('secret@privacy.com');
            expect(encrypted.ciphertext).not.toContain('555-9999');
            expect(encrypted.ciphertext).not.toContain('123-45-6789');
        });

        it('should never contain bid amount in ciphertext', () => {
            const amount = 42.50;
            const bidCommitment = privacyService.encryptBid(amount, '0xBuyer');

            expect(bidCommitment.encryptedBid.ciphertext).not.toContain('42.50');
            expect(bidCommitment.encryptedBid.ciphertext).not.toContain('42.5');
        });

        it('should never contain parameter values in token metadata encryption', () => {
            const { encryptedFields } = privacyService.encryptTokenMetadata({
                vertical: 'mortgage',
                geoState: 'CA',
                qualityScore: 8000,
                source: 'PLATFORM',
                piiData: { firstName: 'TopSecret', ssn: '999-99-9999' },
                parameters: { creditScore: 780 },
            });

            expect(encryptedFields!.ciphertext).not.toContain('TopSecret');
            expect(encryptedFields!.ciphertext).not.toContain('999-99-9999');
            expect(encryptedFields!.ciphertext).not.toContain('780');
        });
    });

    // ─── Commitment Integrity ────────────────────

    describe('commitment integrity', () => {
        it('should detect tampered bid (commitment mismatch on reveal)', () => {
            const bidCommitment = privacyService.encryptBid(100.00, '0xBuyer');

            // Tamper with the commitment in the encrypted payload
            const tampered = {
                ...bidCommitment.encryptedBid,
                commitment: '0x' + 'ab'.repeat(32),
            };

            const revealed = privacyService.decryptBid(tampered, '0xBuyer');
            // Decryption succeeds but commitment check fails
            expect(revealed.valid).toBe(false);
        });

        it('should prevent bid amount manipulation', () => {
            // Create two bids with different amounts
            const bid1 = privacyService.encryptBid(50.00, '0xBuyer');
            const bid2 = privacyService.encryptBid(500.00, '0xBuyer');

            // Commitments should be different
            expect(bid1.commitment).not.toEqual(bid2.commitment);

            // Cross-reveal: try to reveal bid1 with bid2's commitment
            // (can't swap encrypted data between different commitments)
            const crossReveal = privacyService.decryptBid(
                { ...bid1.encryptedBid, commitment: bid2.commitment },
                '0xBuyer'
            );
            // Amount decrypts fine but commitment verification fails
            expect(crossReveal.valid).toBe(false);
        });
    });

    // ─── AAD Binding (Associated Data) ───────────

    describe('AAD binding', () => {
        it('should prevent buyer A from decrypting buyer B bid', () => {
            const bidA = privacyService.encryptBid(100.00, '0xBuyerA');
            const revealB = privacyService.decryptBid(bidA.encryptedBid, '0xBuyerB');

            expect(revealB.valid).toBe(false);
            expect(revealB.amount).toBe(0);
        });

        it('should prevent case-altered address from decrypting', () => {
            const bid = privacyService.encryptBid(75.00, '0xabcdef');
            const revealUpper = privacyService.decryptBid(bid.encryptedBid, '0xABCDEF');

            expect(revealUpper.valid).toBe(false);
        });
    });

    // ─── PII Encryption at Rest ──────────────────

    describe('PII at rest', () => {
        it('should produce ciphertext of sufficient length for PII data', () => {
            const pii = {
                firstName: 'Jane',
                lastName: 'Doe',
                email: 'jane@example.com',
                phone: '555-0100',
                address: '456 Oak Ave, Los Angeles CA 90001',
            };

            const { encrypted, dataHash } = privacyService.encryptLeadPII(pii);

            // Ciphertext must exist and be non-trivial
            expect(encrypted.ciphertext.length).toBeGreaterThan(40);
            expect(encrypted.iv.length).toBe(24); // 12 bytes = 24 hex chars
            expect(encrypted.tag.length).toBe(32); // 16 bytes = 32 hex chars
            expect(dataHash).toMatch(/^0x[a-f0-9]{64}$/);
        });

        it('should not store PII fields in public metadata', () => {
            const { publicMetadata } = privacyService.encryptTokenMetadata({
                vertical: 'solar',
                geoState: 'FL',
                qualityScore: 7500,
                source: 'PLATFORM',
                piiData: { firstName: 'John', email: 'john@secret.com' },
                parameters: { creditScore: 720 },
            });

            // Public metadata should NOT contain PII
            expect(JSON.stringify(publicMetadata)).not.toContain('John');
            expect(JSON.stringify(publicMetadata)).not.toContain('john@secret.com');
            expect(JSON.stringify(publicMetadata)).not.toContain('720');
        });
    });

    // ─── Key Sensitivity ─────────────────────────

    describe('key sensitivity', () => {
        it('should produce deterministic data hash for same PII', () => {
            const pii = { firstName: 'Consistent', email: 'same@test.com' };
            const r1 = privacyService.encryptLeadPII(pii);
            const r2 = privacyService.encryptLeadPII(pii);

            // Hashes should match (deterministic)
            expect(r1.dataHash).toEqual(r2.dataHash);
            // But ciphertexts differ (random IV)
            expect(r1.encrypted.ciphertext).not.toEqual(r2.encrypted.ciphertext);
        });
    });
});
