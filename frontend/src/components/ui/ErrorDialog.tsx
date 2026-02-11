/**
 * ErrorDialog — friendly auth error modal
 * 
 * Shown when SIWE signature is rejected or auth fails.
 * Uses existing shadcn Dialog primitives.
 */

import { AlertCircle, RefreshCw, Wallet, XCircle } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export type AuthErrorType = 'signature-rejected' | 'network-error' | 'generic';

export interface AuthError {
    type: AuthErrorType;
    message: string;
}

interface ErrorDialogProps {
    error: AuthError | null;
    onRetry?: () => void;
    onDismiss: () => void;
}

const ERROR_CONFIG: Record<AuthErrorType, {
    icon: typeof AlertCircle;
    title: string;
    iconColor: string;
    iconBg: string;
}> = {
    'signature-rejected': {
        icon: Wallet,
        title: 'Signature Required',
        iconColor: 'text-amber-400',
        iconBg: 'bg-amber-400/10',
    },
    'network-error': {
        icon: XCircle,
        title: 'Connection Error',
        iconColor: 'text-red-400',
        iconBg: 'bg-red-400/10',
    },
    'generic': {
        icon: AlertCircle,
        title: 'Something Went Wrong',
        iconColor: 'text-blue-400',
        iconBg: 'bg-blue-400/10',
    },
};

export function ErrorDialog({ error, onRetry, onDismiss }: ErrorDialogProps) {
    if (!error) return null;

    const config = ERROR_CONFIG[error.type] || ERROR_CONFIG.generic;
    const Icon = config.icon;

    return (
        <Dialog open={!!error} onOpenChange={(open) => !open && onDismiss()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <div className="flex justify-center mb-4">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${config.iconBg}`}>
                            <Icon className={`h-7 w-7 ${config.iconColor}`} />
                        </div>
                    </div>
                    <DialogTitle className="text-center">{config.title}</DialogTitle>
                    <DialogDescription className="text-center">
                        {error.message}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex-col gap-2 sm:flex-col">
                    {onRetry && (
                        <Button onClick={onRetry} className="w-full gap-2">
                            <RefreshCw className="h-4 w-4" />
                            Try Again
                        </Button>
                    )}
                    <Button variant="outline" onClick={onDismiss} className="w-full">
                        Dismiss
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default ErrorDialog;
