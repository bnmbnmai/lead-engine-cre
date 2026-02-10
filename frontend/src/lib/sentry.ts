/**
 * Sentry Browser Monitoring — Lead Engine CRE Frontend
 *
 * Initializes error tracking + performance monitoring.
 * Only activates when VITE_SENTRY_DSN is set.
 */

let sentryInstance: any = null;

export function initSentry() {
    const dsn = import.meta.env.VITE_SENTRY_DSN;
    if (!dsn) {
        console.log('[Sentry] No DSN configured — monitoring disabled');
        return;
    }

    try {
        // Dynamic import so Sentry is tree-shaken if not used
        import('@sentry/react' as any).then((Sentry: any) => {
            Sentry.init({
                dsn,
                environment: import.meta.env.MODE || 'development',
                tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
                replaysSessionSampleRate: 0.1,
                replaysOnErrorSampleRate: 1.0,
                integrations: [
                    Sentry.browserTracingIntegration(),
                    Sentry.replayIntegration(),
                ],
                beforeSend(event: any) {
                    // Scrub wallet addresses from breadcrumbs
                    if (event.breadcrumbs) {
                        event.breadcrumbs = event.breadcrumbs.map((bc: any) => {
                            if (bc.message && /0x[a-fA-F0-9]{40}/.test(bc.message)) {
                                bc.message = bc.message.replace(/0x[a-fA-F0-9]{40}/g, '0x[REDACTED]');
                            }
                            return bc;
                        });
                    }
                    return event;
                },
            });
            sentryInstance = Sentry;
            console.log('[Sentry] Browser monitoring initialized');
        });
    } catch {
        console.log('[Sentry] SDK not available — monitoring disabled');
    }
}

export function captureError(error: Error, context?: Record<string, any>) {
    if (sentryInstance) {
        sentryInstance.captureException(error, { extra: context });
    }
}

export function setUser(walletAddress: string | null) {
    if (sentryInstance) {
        sentryInstance.setUser(walletAddress ? { id: walletAddress } : null);
    }
}
