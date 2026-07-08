/**
 * App-level React error boundary (Phase B5).
 *
 * Before this, a render-time exception anywhere in the tree white-screened
 * the entire SPA. The boundary catches render/lifecycle errors, reports
 * them to Sentry (when configured), and offers a reload escape hatch.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { captureError } from '@/lib/sentry';

interface ErrorBoundaryProps {
    children: ReactNode;
    /** Optional custom fallback. */
    fallback?: ReactNode;
}

interface ErrorBoundaryState {
    error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
        // No-op unless Sentry was initialised (see lib/sentry.ts)
        captureError(error, { componentStack: info.componentStack });
    }

    render() {
        if (!this.state.error) return this.props.children;
        if (this.props.fallback) return this.props.fallback;

        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-6">
                <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center space-y-4">
                    <AlertTriangle className="h-10 w-10 text-red-500 mx-auto" />
                    <h1 className="text-xl font-semibold">Something went wrong</h1>
                    <p className="text-sm text-muted-foreground">
                        An unexpected error occurred while rendering this page. The error has
                        been reported — reloading usually fixes it.
                    </p>
                    <pre className="text-left text-xs text-red-400/80 bg-black/30 rounded-lg p-3 overflow-auto max-h-32">
                        {this.state.error.message}
                    </pre>
                    <button
                        onClick={() => window.location.reload()}
                        className="inline-flex items-center gap-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 px-4 py-2 text-sm font-medium transition-colors"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Reload page
                    </button>
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
