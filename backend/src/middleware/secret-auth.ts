/**
 * secret-auth.ts — Shared-secret header validation (fail-closed).
 *
 * Used for machine-to-machine endpoints (CRE DON, traffic platform
 * webhooks, KYC provider callbacks, MCP server).
 *
 * Security properties:
 *  - Fails CLOSED: if the expected secret is not configured, requests
 *    are rejected in production (503) instead of being allowed through.
 *  - Constant-time comparison to prevent timing attacks.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** Constant-time string equality. Returns false on length mismatch. */
export function timingSafeEqualStr(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
        // Still do a comparison against self to keep timing uniform-ish
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

export interface SharedSecretOptions {
    /** Header to read the secret from, e.g. 'x-cre-api-key' */
    header: string;
    /** Env var names checked in order; first non-empty wins */
    envVars: string[];
    /** Label used in error messages/logs */
    label: string;
    /**
     * When true (default), an unset secret rejects all requests in
     * production. In non-production an unset secret allows requests
     * through to preserve local dev/demo flows.
     */
    required?: boolean;
}

/**
 * Build a fail-closed shared-secret middleware.
 *
 * - Secret configured  → constant-time compare, 401 on mismatch.
 * - Secret missing + production → 503 (misconfiguration, fail closed).
 * - Secret missing + non-production → allow (local dev/simulation).
 */
export function requireSharedSecret(opts: SharedSecretOptions) {
    const { header, envVars, label, required = true } = opts;

    return function sharedSecretMiddleware(req: Request, res: Response, next: NextFunction): void {
        const expected = envVars.map((v) => process.env[v] || '').find((v) => v.length > 0) || '';

        if (!expected) {
            if (IS_PRODUCTION && required) {
                console.error(`[SECRET-AUTH] ${label}: secret not configured (${envVars.join(', ')}) — rejecting request`);
                res.status(503).json({ error: `${label} authentication is not configured` });
                return;
            }
            // Non-production: allow through for local dev/simulation
            next();
            return;
        }

        const provided = (req.headers[header.toLowerCase()] as string) || '';
        if (!provided || !timingSafeEqualStr(provided, expected)) {
            res.status(401).json({ error: `Invalid or missing ${label} credentials` });
            return;
        }

        next();
    };
}
