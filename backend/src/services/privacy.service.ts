import crypto from 'crypto';
import { ethers } from 'ethers';

// ============================================
// Privacy Suite Service
// ============================================
// Encrypted bids, PII protection, token metadata encryption

const ENCRYPTION_KEY = process.env.PRIVACY_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

interface EncryptedPayload {
    ciphertext: string;  // hex-encoded AES-256-GCM ciphertext
    iv: string;          // hex-encoded initialization vector
    tag: string;         // hex-encoded authentication tag
    commitment: string;  // keccak256 commitment for on-chain verification
}

interface BidCommitment {
    commitment: string;  // keccak256(amount, salt)
    salt: string;        // Random salt for reveal
    encryptedBid: EncryptedPayload;
}

class PrivacyService {
    private key: Buffer;

    constructor() {
        this.key = Buffer.from(ENCRYPTION_KEY, 'hex');
        // Ensure key is 32 bytes
        if (this.key.length !== 32) {
            this.key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
        }
    }

    // ============================================
    // AES-256-GCM Encryption
    // ============================================

    private encrypt(plaintext: string, associatedData?: string): EncryptedPayload {
        const iv = crypto.randomBytes(12); // 96-bit IV for GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);

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
        };
    }

    private decrypt(payload: EncryptedPayload, associatedData?: string): string {
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            this.key,
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
        } catch (error) {
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
