/**
 * Production env validation (Phase D1).
 * Run at startup in production to fail fast on missing secrets.
 */

const REQUIRED_PROD = [
    'JWT_SECRET',
    'DATABASE_URL',
    'PRIVACY_ENCRYPTION_KEY',
    'CRE_API_KEY',
] as const;

const FORBIDDEN_DEFAULTS = [
    { key: 'JWT_SECRET', bad: ['dev-secret', 'changeme', 'your-secret'] },
];

export function validateProductionEnv(): void {
    if (process.env.NODE_ENV !== 'production') return;

    const missing = REQUIRED_PROD.filter((k) => !process.env[k]);
    if (missing.length > 0) {
        throw new Error(`[ENV] Missing required production variables: ${missing.join(', ')}`);
    }

    for (const { key, bad } of FORBIDDEN_DEFAULTS) {
        const val = process.env[key] || '';
        if (bad.some((b) => val.toLowerCase().includes(b))) {
            throw new Error(`[ENV] ${key} appears to use a default/dev value in production`);
        }
    }

    if (process.env.DEMO_MODE === 'true' && process.env.ALLOW_DEMO_ROUTES !== 'true') {
        console.warn('[ENV] DEMO_MODE=true in production — ensure this is intentional');
    }
}
