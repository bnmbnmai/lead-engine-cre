import crypto from 'crypto';

// ============================================
// Chainlink Confidential Compute — Privacy Stub
// ============================================
// Enables privacy-preserving auctions and lead data handling:
//   • Private bids  — bid amounts encrypted until reveal phase
//   • Private leads  — lead PII sealed in TEE; only released after payment
//   • Private match  — buyer/seller preferences matched without mutual disclosure
//
// Uses Trusted Execution Environment (TEE) enclaves so that raw data
// never leaves the secure boundary — callers receive only derived values
// (scores, match booleans, encrypted outputs).
//
// ⚡ Ready for mainnet integration when Chainlink Confidential Compute
//    access is granted. Swap stub methods for real CC SDK calls —
//    interfaces are designed as drop-in replacements.

const CC_LATENCY_MIN = 100;
const CC_LATENCY_MAX = 400;
const SEAL_KEY_BYTES = 32; // AES-256

// ── Types ──

export interface SealedBid {
    /** Encrypted bid envelope (base64) */
    envelope: string;
    /** Commitment hash for on-chain commit-reveal */
    commitment: string;
    /** TEE attestation proof (hex) — verifies bid was sealed inside enclave */
    attestationProof: string;
    /** Expiry: bid must be revealed before this time */
    revealDeadline: string;
    latencyMs: number;
    isStub: true;
    degraded: boolean;
}

export interface RevealedBid {
    /** Original bid amount (USD) */
    amount: number;
    /** Buyer's wallet address */
    bidder: string;
    /** Proof the revealed amount matches the commitment */
    proofValid: boolean;
    latencyMs: number;
    isStub: true;
    degraded: boolean;
}

export interface SealedLeadData {
    /** Encrypted lead payload (base64) — only decryptable inside TEE after payment */
    sealedPayload: string;
    /** Content hash of the plaintext — allows buyer to verify integrity post-purchase */
    contentHash: string;
    /** Non-PII preview fields (safe to show pre-purchase) */
    preview: {
        vertical: string;
        geo: { state?: string; country?: string };
        qualityScore: number;
        source: string;
    };
    /** TEE attestation proving the preview was derived from sealed data */
    attestationProof: string;
    latencyMs: number;
    isStub: true;
    degraded: boolean;
}

export interface UnsealedLeadResult {
    /** Decrypted lead payload (only returned after successful payment) */
    data: Record<string, unknown>;
    /** Proof that the unsealed data matches the original content hash */
    integrityValid: boolean;
    /** Transaction ID that authorized the unsealing */
    paymentTxId: string;
    latencyMs: number;
    isStub: true;
    degraded: boolean;
}

// ── Helpers ──

function simulateLatency(): Promise<number> {
    const ms = CC_LATENCY_MIN + Math.random() * (CC_LATENCY_MAX - CC_LATENCY_MIN);
    return new Promise((resolve) => setTimeout(() => resolve(Math.round(ms)), ms));
}

function mockAttestation(input: string): string {
    return crypto.createHash('sha256').update(`cc_attest:${input}:${Date.now()}`).digest('hex').slice(0, 64);
}

function mockSeal(plaintext: string): { ciphertext: string; key: Buffer } {
    const key = crypto.randomBytes(SEAL_KEY_BYTES);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Envelope = iv || tag || ciphertext (all base64)
    const envelope = Buffer.concat([iv, tag, encrypted]).toString('base64');
    return { ciphertext: envelope, key };
}

function mockUnseal(envelope: string, key: Buffer): string {
    const raw = Buffer.from(envelope, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// In-memory seal key store (stub only — production uses TEE-sealed keys)
const sealKeys = new Map<string, Buffer>();

// ── Service ──

class ConfidentialPrivacyService {
    // ──────────────────────────────────
    // Private Bids
    // ──────────────────────────────────

    /**
     * Seal a bid inside the TEE.
     *
     * The bid amount is encrypted and a commitment hash is generated
     * for on-chain commit-reveal. The raw amount is never visible
     * outside the enclave until the reveal phase.
     *
     * @param bidder     - Buyer wallet address
     * @param leadId     - Lead being bid on
     * @param amount     - Bid amount in USD
     * @param revealWindowMs - Time (ms) until the reveal deadline
     */
    async sealBid(
        bidder: string,
        leadId: string,
        amount: number,
        revealWindowMs: number = 5 * 60 * 1000
    ): Promise<SealedBid> {
        console.log(`[CC-PRIVACY STUB] sealBid: bidder=${bidder.slice(0, 10)}… lead=${leadId} amount=$${amount.toFixed(2)}`);

        let latencyMs: number;
        let degraded = false;

        try {
            latencyMs = await simulateLatency();
        } catch {
            console.warn('[CC-PRIVACY STUB] TEE timeout — sealing locally');
            latencyMs = 2;
            degraded = true;
        }

        const plaintext = JSON.stringify({ bidder, leadId, amount, ts: Date.now() });
        const { ciphertext, key } = mockSeal(plaintext);

        const sealId = `bid_${leadId}_${bidder.slice(0, 10)}`;
        sealKeys.set(sealId, key);

        const commitment = crypto.createHash('sha256')
            .update(`${bidder}|${leadId}|${amount}|${key.toString('hex')}`)
            .digest('hex');

        const revealDeadline = new Date(Date.now() + revealWindowMs).toISOString();

        return {
            envelope: ciphertext,
            commitment,
            attestationProof: degraded ? '' : mockAttestation(sealId),
            revealDeadline,
            latencyMs,
            isStub: true,
            degraded,
        };
    }

    /**
     * Reveal a previously sealed bid.
     *
     * In production, the TEE decrypts the envelope and verifies the
     * commitment matches — ensuring the bidder cannot change their
     * bid between commit and reveal phases.
     */
    async revealBid(
        bidder: string,
        leadId: string,
        envelope: string,
        commitment: string
    ): Promise<RevealedBid> {
        console.log(`[CC-PRIVACY STUB] revealBid: bidder=${bidder.slice(0, 10)}… lead=${leadId}`);

        let latencyMs: number;
        let degraded = false;

        try {
            latencyMs = await simulateLatency();
        } catch {
            latencyMs = 1;
            degraded = true;
        }

        const sealId = `bid_${leadId}_${bidder.slice(0, 10)}`;
        const key = sealKeys.get(sealId);

        if (!key) {
            console.warn(`[CC-PRIVACY STUB] No seal key found for ${sealId} — returning unverified`);
            return {
                amount: 0,
                bidder,
                proofValid: false,
                latencyMs,
                isStub: true,
                degraded: true,
            };
        }

        try {
            const plaintext = mockUnseal(envelope, key);
            const parsed = JSON.parse(plaintext);

            // Verify commitment
            const recomputedCommitment = crypto.createHash('sha256')
                .update(`${bidder}|${leadId}|${parsed.amount}|${key.toString('hex')}`)
                .digest('hex');

            const proofValid = recomputedCommitment === commitment;

            sealKeys.delete(sealId); // One-time reveal

            return {
                amount: parsed.amount,
                bidder,
                proofValid,
                latencyMs,
                isStub: true,
                degraded,
            };
        } catch {
            return {
                amount: 0,
                bidder,
                proofValid: false,
                latencyMs,
                isStub: true,
                degraded: true,
            };
        }
    }

    // ──────────────────────────────────
    // Private Lead Data
    // ──────────────────────────────────

    /**
     * Seal lead data inside the TEE before listing.
     *
     * The full lead PII is encrypted. A non-PII preview is derived
     * inside the enclave and returned for marketplace display.
     * The sealed payload can only be unsealed after payment confirmation.
     *
     * This ensures buyers only see redacted previews (vertical, geo,
     * quality score, source) and never receive raw PII until they pay.
     *
     * @param leadId  - Lead identifier
     * @param leadData - Full lead data including PII
     * @param preview  - Non-PII preview fields to expose pre-purchase
     */
    async sealLeadData(
        leadId: string,
        leadData: Record<string, unknown>,
        preview: SealedLeadData['preview']
    ): Promise<SealedLeadData> {
        console.log(`[CC-PRIVACY STUB] sealLeadData: lead=${leadId} vertical=${preview.vertical}`);

        let latencyMs: number;
        let degraded = false;

        try {
            latencyMs = await simulateLatency();
        } catch {
            latencyMs = 1;
            degraded = true;
        }

        const plaintext = JSON.stringify(leadData);
        const { ciphertext, key } = mockSeal(plaintext);

        sealKeys.set(`lead_${leadId}`, key);

        const contentHash = crypto.createHash('sha256').update(plaintext).digest('hex');

        return {
            sealedPayload: ciphertext,
            contentHash,
            preview,
            attestationProof: degraded ? '' : mockAttestation(`lead_${leadId}`),
            latencyMs,
            isStub: true,
            degraded,
        };
    }

    /**
     * Unseal lead data after payment confirmation.
     *
     * In production, the TEE verifies the payment transaction on-chain
     * before releasing the decryption key. The buyer receives the full
     * lead data only after the x402 escrow confirms settlement.
     *
     * @param leadId     - Lead identifier
     * @param sealedPayload - The encrypted payload from sealLeadData
     * @param contentHash   - Expected hash for integrity verification
     * @param paymentTxId   - Transaction ID proving payment
     */
    async unsealLeadData(
        leadId: string,
        sealedPayload: string,
        contentHash: string,
        paymentTxId: string
    ): Promise<UnsealedLeadResult> {
        console.log(`[CC-PRIVACY STUB] unsealLeadData: lead=${leadId} tx=${paymentTxId.slice(0, 16)}…`);

        let latencyMs: number;
        let degraded = false;

        try {
            latencyMs = await simulateLatency();
        } catch {
            latencyMs = 1;
            degraded = true;
        }

        const key = sealKeys.get(`lead_${leadId}`);

        if (!key) {
            console.warn(`[CC-PRIVACY STUB] No seal key for lead_${leadId} — cannot unseal`);
            return {
                data: {},
                integrityValid: false,
                paymentTxId,
                latencyMs,
                isStub: true,
                degraded: true,
            };
        }

        try {
            const plaintext = mockUnseal(sealedPayload, key);
            const data = JSON.parse(plaintext);

            // Verify integrity
            const recomputedHash = crypto.createHash('sha256').update(plaintext).digest('hex');
            const integrityValid = recomputedHash === contentHash;

            sealKeys.delete(`lead_${leadId}`);

            return {
                data,
                integrityValid,
                paymentTxId,
                latencyMs,
                isStub: true,
                degraded,
            };
        } catch {
            return {
                data: {},
                integrityValid: false,
                paymentTxId,
                latencyMs,
                isStub: true,
                degraded: true,
            };
        }
    }
}

export const confidentialPrivacy = new ConfidentialPrivacyService();
