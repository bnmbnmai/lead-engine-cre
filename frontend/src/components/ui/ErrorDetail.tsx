import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, ShieldAlert, UserPlus, Key } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorAction {
    label: string;
    href: string;
}

interface StructuredError {
    error: string;
    code?: string;
    resolution?: string;
    action?: ErrorAction;
    currentRole?: string;
    requiredRoles?: string[];
}

const CODE_ICONS: Record<string, React.ElementType> = {
    ROLE_REQUIRED: ShieldAlert,
    SELLER_PROFILE_MISSING: UserPlus,
    KYC_REQUIRED: Key,
    AUTH_REQUIRED: ShieldAlert,
};

const CODE_COLORS: Record<string, string> = {
    ROLE_REQUIRED: 'border-amber-500/30 bg-amber-500/5',
    SELLER_PROFILE_MISSING: 'border-primary/30 bg-primary/5',
    KYC_REQUIRED: 'border-purple-500/30 bg-purple-500/5',
    AUTH_REQUIRED: 'border-red-500/30 bg-red-500/5',
};

export function ErrorDetail({ error, onDismiss }: { error: StructuredError; onDismiss?: () => void }) {
    const navigate = useNavigate();
    const Icon = (error.code && CODE_ICONS[error.code]) || AlertCircle;
    const borderColor = (error.code && CODE_COLORS[error.code]) || 'border-red-500/30 bg-red-500/5';

    return (
        <div className={`rounded-xl border p-5 ${borderColor} space-y-3`}>
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-white/5 flex-shrink-0">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold">{error.error}</p>
                        {error.code && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">
                                {error.code}
                            </span>
                        )}
                    </div>
                    {error.resolution && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{error.resolution}</p>
                    )}
                </div>
            </div>

            {error.action && (
                <div className="flex items-center gap-2 pt-1">
                    <Button
                        size="sm"
                        onClick={() => navigate(error.action!.href)}
                        className="gap-2"
                    >
                        {error.action.label}
                        <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                    {onDismiss && (
                        <Button variant="ghost" size="sm" onClick={onDismiss}>
                            Dismiss
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Parse an API error response into a StructuredError.
 * Falls back to a generic error if the response doesn't match the expected shape.
 */
export function parseApiError(err: any): StructuredError {
    if (err?.response?.data?.code) {
        return err.response.data as StructuredError;
    }
    if (err?.response?.data?.error) {
        return { error: err.response.data.error, resolution: err.response.data.message };
    }
    return { error: err?.message || 'An unexpected error occurred.' };
}
