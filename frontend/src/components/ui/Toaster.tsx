/**
 * Toaster — lightweight toast notification overlay
 * 
 * Uses the global toast store from useToast.ts.
 * Renders up to 5 toasts stacked at top-right with glassmorphism styling.
 */

import { X, CheckCircle, Info, AlertTriangle, AlertCircle } from 'lucide-react';
import { useToast, dismissToast, type ToastType } from '@/hooks/useToast';

const ICONS: Record<ToastType, typeof CheckCircle> = {
    success: CheckCircle,
    info: Info,
    warning: AlertTriangle,
    error: AlertCircle,
};

const COLORS: Record<ToastType, string> = {
    success: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
    info: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
    warning: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
    error: 'text-red-400 bg-red-400/10 border-red-400/20',
};

const ICON_COLORS: Record<ToastType, string> = {
    success: 'text-emerald-400',
    info: 'text-blue-400',
    warning: 'text-amber-400',
    error: 'text-red-400',
};

export function Toaster() {
    const { toasts } = useToast();

    if (toasts.length === 0) return null;

    return (
        <div
            className="fixed top-4 right-4 z-[100] flex flex-col gap-3 pointer-events-none"
            aria-live="assertive"
            role="log"
        >
            {toasts.map((t) => {
                const Icon = ICONS[t.type];
                return (
                    <div
                        key={t.id}
                        className={`pointer-events-auto flex items-start gap-3 w-80 max-w-[calc(100vw-2rem)] px-4 py-3 rounded-xl border backdrop-blur-xl shadow-2xl animate-in slide-in-from-right-5 duration-300 ${COLORS[t.type]}`}
                        role="alert"
                        aria-atomic="true"
                    >
                        <Icon className={`h-5 w-5 flex-shrink-0 mt-0.5 ${ICON_COLORS[t.type]}`} />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">{t.title}</p>
                            {t.description && (
                                <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                            )}
                        </div>
                        <button
                            onClick={() => dismissToast(t.id)}
                            className="flex-shrink-0 p-1 rounded-lg hover:bg-white/10 transition text-muted-foreground hover:text-foreground"
                            aria-label="Dismiss notification"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

export default Toaster;
