import crypto from 'crypto';
import { ethers } from 'ethers';

// ============================================
// Privacy Suite Service
// ============================================
// Encrypted bids, PII protection, token metadata encryption
//
// Phase B4 — Envelope encryption:
//   Each payload is encrypted with a fresh per-payload Data Encryption Key
//   (DEK). The DEK is then wrapped (AES-256-GCM) by the master Key Encryption
//   Key (KEK). Rotating the KEK only requires re-wrapping DEKs — never
//   re-encrypting the data — and a leaked DEK exposes exactly one payload.
//
//   KEK source: PRIVACY_MASTER_KEY (preferred, KMS-style with version tag)
//   or PRIVACY_ENCRYPTION_KEY (legacy single key). In production the KEK
//   should be supplied by a cloud KMS (AWS KMS / GCP Cloud KMS decrypt of a
//   sealed key at boot) — the env var is the injection point.
//
//   Legacy payloads (no wrappedKey field) decrypt with the KEK directly,
//   preserving backwards compatibility with existing stored ciphertexts.

function requireEncryptionKey(): string {
    const key = process.env.PRIVACY_MASTER_KEY || process.env.PRIVACY_ENCRYPTION_KEY;
    if (!key || key === 'generate-with-openssl-rand-hex-32') {
        const msg = [
            '⛔ FATAL: PRIVACY_MASTER_KEY / PRIVACY_ENCRYPTION_KEY is not set (or is the placeholder).',
            '   Run:  openssl rand -hex 32',
            '   Then set PRIVACY_MASTER_KEY in your .env / secret manager (or wire a cloud KMS).',
        ].join('\n');
        console.error(msg);
        throw new Error(msg);
    }
    return key;
}
const ENCRYPTION_KEY = requireEncryptionKey();
const KEY_VERSION = process.env.PRIVACY_MASTER_KEY_VERSION || 'v1';

interface EncryptedPayload {
    ciphertext: string;  // hex-encoded AES-256-GCM ciphertext
    iv: string;          // hex-encoded initialization vector
    tag: string;         // hex-encoded authentication tag
    commitment: string;  // keccak256 commitment for on-chain verification
    // ── Envelope fields (Phase B4) — absent on legacy payloads ──
    wrappedKey?: string; // hex: iv(12) || tag(16) || AES-256-GCM(KEK, DEK)
    keyVersion?: string; // KEK version used to wrap the DEK
}

interface BidCommitment {
    commitment: string;  // keccak256(amount, salt)
    salt: string;        // Random salt for reveal
    encryptedBid: EncryptedPayload;
}

class PrivacyService {
    /** Master Key Encryption Key (KEK) — wraps per-payload DEKs. */
    private kek: Buffer;

    constructor() {
        this.kek = Buffer.from(ENCRYPTION_KEY, 'hex');
        // Ensure key is 32 bytes
        if (this.kek.length !== 32) {
            this.kek = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
        }
    }

    // ============================================
    // AES-256-GCM Envelope Encryption (Phase B4)
    // ============================================

    /** Wrap a DEK under the KEK: hex(iv || tag || ciphertext). */
    private wrapDek(dek: Buffer): string {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.kek, iv);
        const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, wrapped]).toString('hex');
    }

    /** Unwrap a DEK from hex(iv || tag || ciphertext). */
    private unwrapDek(wrappedKey: string): Buffer {
        const raw = Buffer.from(wrappedKey, 'hex');
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const wrapped = raw.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.kek, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(wrapped), decipher.final()]);
    }

    private encrypt(plaintext: string, associatedData?: string): EncryptedPayload {
        // Fresh per-payload DEK — never reused across payloads
        const dek = crypto.randomBytes(32);
        const iv = crypto.randomBytes(12); // 96-bit IV for GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);

        if (associatedData) {
            cipher.setAAD(Buffer.from(associatedData));
        }

        let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
        ciphertext += cipher.final('hex');
        const tag = cipher.getAuthTag();

        // Commitment: hash of plaintext for on-chain verification
        const commitment = ethers.keccak256(ethers.toUtf8Bytes(plaintext));

        return {
            ciphertext,
            iv: iv.toString('hex'),
            tag: tag.toString('hex'),
            commitment,
            wrappedKey: this.wrapDek(dek),
            keyVersion: KEY_VERSION,
        };
    }

    private decrypt(payload: EncryptedPayload, associatedData?: string): string {
        // Envelope payloads carry their own wrapped DEK; legacy payloads
        // (pre-B4) were encrypted directly with the master key.
        const dataKey = payload.wrappedKey ? this.unwrapDek(payload.wrappedKey) : this.kek;

        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            dataKey,
            Buffer.from(payload.iv, 'hex')
        );

        decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));

        if (associatedData) {
            decipher.setAAD(Buffer.from(associatedData));
        }

        let plaintext = decipher.update(payload.ciphertext, 'hex', 'utf8');
        plaintext += decipher.final('utf8');

        return plaintext;
    }

    // ============================================
    // Encrypted Bid (for commit-reveal)
    // ============================================

    /**
     * Create an encrypted bid with commitment for commit-reveal bidding.
     * Phase 1 (commit): Submit commitment (hash) + encrypted bid
     * Phase 2 (reveal): Decrypt bid, verify against commitment
     */
    encryptBid(amount: number, buyerAddress: string): BidCommitment {
        const salt = ethers.hexlify(crypto.randomBytes(32));

        // Commitment: hash(amount + salt) for on-chain commit-reveal
        const commitment = ethers.solidityPackedKeccak256(
            ['uint96', 'bytes32'],
            [Math.floor(amount * 1e6), salt]
        );

        // Encrypt the full bid data
        const bidData = JSON.stringify({
            amount,
            amountWei: Math.floor(amount * 1e6),
            salt,
            buyer: buyerAddress,
            timestamp: Date.now(),
        });

        const encryptedBid = this.encrypt(bidData, buyerAddress);

        // Override the generic commitment with the solidity-packed one
        // so decryptBid can verify by re-deriving the same hash.
        encryptedBid.commitment = commitment;

        return {
            commitment,
            salt,
            encryptedBid,
        };
    }

    /**
     * Decrypt and verify a bid during reveal phase.
     */
    decryptBid(encryptedBid: EncryptedPayload, buyerAddress: string): {
        amount: number;
        salt: string;
        valid: boolean;
    } {
        try {
            const plaintext = this.decrypt(encryptedBid, buyerAddress);
            const data = JSON.parse(plaintext);

            // Verify commitment matches
            const expectedCommitment = ethers.solidityPackedKeccak256(
                ['uint96', 'bytes32'],
                [data.amountWei, data.salt]
            );

            return {
                amount: data.amount,
                salt: data.salt,
                valid: expectedCommitment === encryptedBid.commitment,
            };
        } catch (_error) {
            return { amount: 0, salt: '', valid: false };
        }
    }

    // ============================================
    // Lead PII Encryption
    // ============================================

    /**
     * Encrypt lead PII data for storage.
     * Returns encrypted blob + hash for on-chain metadata reference.
     */
    encryptLeadPII(piiData: {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        address?: string;
        [key: string]: any;
    }): { encrypted: EncryptedPayload; dataHash: string } {
        const plaintext = JSON.stringify(piiData);
        const dataHash = ethers.keccak256(ethers.toUtf8Bytes(plaintext));
        const encrypted = this.encrypt(plaintext);

        return { encrypted, dataHash };
    }

    /**
     * Decrypt lead PII data.
     */
    decryptLeadPII(encrypted: EncryptedPayload): Record<string, any> {
        const plaintext = this.decrypt(encrypted);
        return JSON.parse(plaintext);
    }

    // ============================================
    // Token Metadata Encryption
    // ============================================

    /**
     * Encrypt NFT token metadata so only the buyer can access full details.
     * Public fields (vertical, geo-state) remain visible; PII fields are encrypted.
     */
    encryptTokenMetadata(metadata: {
        vertical: string;
        geoState: string;
        qualityScore: number;
        source: string;
        piiData?: Record<string, any>;
        parameters?: Record<string, any>;
    }): {
        publicMetadata: Record<string, any>;
        encryptedFields: EncryptedPayload | null;
    } {
        const publicMetadata: Record<string, any> = {
            vertical: metadata.vertical,
            geoState: metadata.geoState,
            qualityScore: metadata.qualityScore,
            source: metadata.source,
        };

        let encryptedFields: EncryptedPayload | null = null;

        if (metadata.piiData || metadata.parameters) {
            const sensitiveData = {
                pii: metadata.piiData,
                parameters: metadata.parameters,
            };
            encryptedFields = this.encrypt(JSON.stringify(sensitiveData));
            publicMetadata.hasEncryptedFields = true;
            publicMetadata.encryptedFieldsHash = encryptedFields.commitment;
        }

        return { publicMetadata, encryptedFields };
    }

    /**
     * Decrypt token metadata encrypted fields.
     */
    decryptTokenMetadata(encryptedFields: EncryptedPayload): {
        pii?: Record<string, any>;
        parameters?: Record<string, any>;
    } {
        const plaintext = this.decrypt(encryptedFields);
        return JSON.parse(plaintext);
    }

    // ============================================
    // Commitment Generation (standalone)
    // ============================================

    /**
     * Generate a standalone commitment for any value.
     * Useful for commit-reveal patterns beyond bidding.
     */
    generateCommitment(value: string): { commitment: string; salt: string } {
        const salt = ethers.hexlify(crypto.randomBytes(32));
        const commitment = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['string', 'bytes32'],
                [value, salt]
            )
        );
        return { commitment, salt };
    }

    /**
     * Verify a commitment against its revealed value.
     */
    verifyCommitment(commitment: string, value: string, salt: string): boolean {
        const expected = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['string', 'bytes32'],
                [value, salt]
            )
        );
        return expected === commitment;
    }
}

export const privacyService = new PrivacyService();
