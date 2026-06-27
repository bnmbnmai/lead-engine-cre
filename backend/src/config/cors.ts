/**
 * cors.ts — Single source of truth for the HTTP + WebSocket origin allowlist.
 *
 * Used by both the Express CORS middleware (index.ts) and the Socket.IO
 * server (rtb/socket.ts) so every entry point enforces the same policy.
 */

export const ALLOWED_ORIGINS = [
    'https://leadrtb.com',
    'https://www.leadrtb.com',
    'https://api.leadrtb.com',
    'https://lead-engine-cre-frontend.vercel.app',
    // Vercel preview deployments
    'https://lead-engine-cre-frontend-li2y9pn8j-bruces-projects-8c801e4b.vercel.app',
    'https://lead-engine-cre',  // prefix-match covers all Vercel preview slugs for this project
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
].filter(Boolean) as string[];

/** Requests with no origin (curl, server-to-server) are allowed. */
export function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    return ALLOWED_ORIGINS.some((o) => origin.startsWith(o));
}

/** cors-package-compatible origin callback. */
export function corsOriginFn(
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
): void {
    if (isAllowedOrigin(origin)) {
        callback(null, true);
    } else {
        callback(new Error(`CORS: origin '${origin}' is not in the allowlist`));
    }
}
