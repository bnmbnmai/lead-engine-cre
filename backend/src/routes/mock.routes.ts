// ============================================================================
// Mock Routes — Development & Demo Endpoints
// ============================================================================
//
// These routes simulate external third-party APIs that Chainlink Confidential
// HTTP would call from inside the TEE enclave, with API keys injected from
// the Vault DON (never in node memory in production).
//
// Pattern: mirrors conf-http-demo where the CRE workflow hits an endpoint
// guarded by x-cre-key, gets back structured JSON, computes score in enclave.
//
// In production the fraud-signal endpoint would be a real provider
// (Twilio Lookup, ZeroBounce, MaxMind, etc.) requiring a live API key.
// ============================================================================

import { Router, Request, Response } from 'express';
import crypto from 'crypto';

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────

/** Shape returned by the mock fraud-signal endpoint. */
export interface FraudSignalPayload {
    leadId: string;
    timestamp: string;
    /** Phone validation result (0.0 – 1.0, higher = cleaner). */
    phoneValidation: {
        score: number;          // 0.0 – 1.0
        lineType: 'mobile' | 'landline' | 'voip' | 'unknown';
        carrierName: string;
        isReachable: boolean;
        isDisposable: boolean;
    };
    /** Email hygiene result (0.0 – 1.0, higher = cleaner). */
    emailHygiene: {
        score: number;          // 0.0 – 1.0
        isDeliverable: boolean;
        isDomainActive: boolean;
        isRoleAddress: boolean; // info@, admin@, etc.
        isDisposable: boolean;
    };
    /** Behavioural conversion propensity (0.0 – 1.0). */
    conversionPropensity: {
        score: number;          // 0.0 – 1.0
        intent: 'high' | 'medium' | 'low';
        deviceType: 'mobile' | 'desktop' | 'tablet';
        sessionDepth: number;   // pages visited before form completion
    };
    /** CHTT provenance fields stored alongside the payload. */
    nonce: string;              // random per-request nonce for replay-protection
    ciphertext: string;         // AES-GCM-simulated encrypted representation
    isStub: true;
}

// ── Deterministic-but-realistic signal generator ─────────────────────────

function deterministicFloat(seed: string, salt: string, min = 0, max = 1): number {
    const hash = crypto.createHash('sha256').update(seed + salt).digest('hex');
    const value = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
    return parseFloat((min + value * (max - min)).toFixed(4));
}

function pickFrom<T>(seed: string, salt: string, options: T[]): T {
    const hash = crypto.createHash('sha256').update(seed + salt).digest('hex');
    const idx = parseInt(hash.slice(0, 4), 16) % options.length;
    return options[idx];
}

// ============================================================================
// GET /api/mock/fraud-signal/:leadId
// ============================================================================
//
// Returns simulated external fraud-signal data for a given lead.
//
// Secured by x-cre-key header (same pattern as conf-http-demo x-myApiKey).
// In production, the CHTT TEE injects this key from the Vault DON — the
// Node.js server never sees the resolved secret value.
//
// CHTT workflow calls this endpoint with:
//   { 'x-cre-key': '{{.creApiKey}}' }  ← template resolved in enclave
//
// Demo / development: any truthy value accepted.
// ============================================================================

router.get('/fraud-signal/:leadId', (req: Request, res: Response) => {
    const apiKey = req.headers['x-cre-key'] as string;

    // Key guard — simulates the production check that would validate the
    // Vault-injected key against a hashed expected value.
    if (!apiKey) {
        res.status(401).json({ error: 'Missing x-cre-key header' });
        return;
    }

    const { leadId } = req.params;
    if (!leadId || typeof leadId !== 'string') {
        res.status(400).json({ error: 'leadId is required' });
        return;
    }

    // Deterministic signals — same leadId always yields the same values,
    // so demo runs are reproducible. Real provider would call Twilio/ZeroBounce.
    const phoneScore = deterministicFloat(leadId, 'phone', 0.55, 0.99);
    const emailScore = deterministicFloat(leadId, 'email', 0.60, 0.99);
    const convScore = deterministicFloat(leadId, 'conv', 0.40, 0.95);

    const nonce = crypto.randomBytes(16).toString('hex');

    // Simulate AES-GCM ciphertext (IV + base64 payload) — in production the
    // TEE would encrypt the response before returning it to the DON.
    const plaintext = JSON.stringify({ leadId, phoneScore, emailScore, convScore });
    const iv = crypto.randomBytes(12);
    const ciphertext = `chtt-enc:${iv.toString('hex')}:${Buffer.from(plaintext).toString('base64')}`;

    const payload: FraudSignalPayload = {
        leadId,
        timestamp: new Date().toISOString(),
        phoneValidation: {
            score: phoneScore,
            lineType: pickFrom(leadId, 'lineType', ['mobile', 'mobile', 'mobile', 'landline', 'voip']),
            carrierName: pickFrom(leadId, 'carrier', ['Verizon', 'AT&T', 'T-Mobile', 'Sprint', 'US Cellular']),
            isReachable: phoneScore > 0.6,
            isDisposable: phoneScore < 0.6,
        },
        emailHygiene: {
            score: emailScore,
            isDeliverable: emailScore > 0.65,
            isDomainActive: emailScore > 0.55,
            isRoleAddress: emailScore < 0.7 && deterministicFloat(leadId, 'role', 0, 1) > 0.8,
            isDisposable: emailScore < 0.62,
        },
        conversionPropensity: {
            score: convScore,
            intent: convScore >= 0.7 ? 'high' : convScore >= 0.5 ? 'medium' : 'low',
            deviceType: pickFrom(leadId, 'device', ['mobile', 'mobile', 'desktop', 'tablet']),
            sessionDepth: Math.round(deterministicFloat(leadId, 'depth', 1, 8)),
        },
        nonce,
        ciphertext,
        isStub: true,
    };

    console.log(
        `[MOCK FRAUD SIGNAL] leadId=${leadId} ` +
        `phone=${phoneScore.toFixed(2)} email=${emailScore.toFixed(2)} conv=${convScore.toFixed(2)}`
    );

    res.json(payload);
});

export default router;
