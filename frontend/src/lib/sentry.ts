/**
 * Sentry Browser Monitoring — Lead Engine CRE Frontend
 *
 * Gracefully initializes Sentry when VITE_SENTRY_DSN is set AND
 * @sentry/react is installed. If the package is not installed,
 * all exports become safe no-ops — the build never breaks.
 *
 * Install: npm install @sentry/react (optional)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let _sentry: any = null;

export async function initSentry(): Promise<void> {
    const dsn = import.meta.env.VITE_SENTRY_DSN;
    if (!dsn) {
        console.log('[Sentry] No VITE_SENTRY_DSN — monitoring disabled');
        return;
    }

    try {
        // Vite handles dynamic imports at build time. By wrapping in
        // try/catch and using a variable, we avoid hard build failures
        // when @sentry/react is not installed.
        const mod = '@sentry' + '/react'; // defeat static analysis
        const Sentry = await (Function('m', 'return import(m)')(mod));

        Sentry.init({
            dsn,
            environment: import.meta.env.MODE || 'development',
            tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
            replaysSessionSampleRate: 0.1,
            replaysOnErrorSampleRate: 1.0,
            beforeSend(event: any) {
                // Scrub wallet addresses from breadcrumbs
                if (event.breadcrumbs) {
                    event.breadcrumbs = event.breadcrumbs.map((bc: any) => {
                        if (bc.message && /0x[a-fA-F0-9]{40}/.test(bc.message)) {
                            bc.message = bc.message.replace(
                                /0x[a-fA-F0-9]{40}/g,
                                '0x[REDACTED]'
                            );
                        }
                        return bc;
                    });
                }
                // Never log ZK proof data or commitment hashes
                if (event.extra) {
                    const sensitive = ['zkProof', 'commitmentHash', 'privateKey', 'encryptedBid'];
                    for (const key of sensitive) {
                        if (event.extra[key]) event.extra[key] = '[REDACTED]';
                    }
                }
                return event;
            },
        });
        _sentry = Sentry;
        console.log('[Sentry] Browser monitoring initialized');
    } catch {
        // @sentry/react not installed — graceful degradation
        console.log('[Sentry] @sentry/react not installed — monitoring disabled');
    }
}

export function captureError(error: Error, context?: Record<string, any>): void {
    if (_sentry) {
        _sentry.captureException(error, { extra: context });
    }
}

export function setUser(walletAddress: string | null): void {
    if (_sentry) {
        _sentry.setUser(walletAddress ? { id: walletAddress } : null);
    }
}
