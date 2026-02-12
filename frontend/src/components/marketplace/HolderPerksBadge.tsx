import { useState, useEffect, useCallback } from 'react';
import { Zap, Clock, TrendingUp, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/Tooltip';

// ============================================
// Types
// ============================================

interface HolderPerksBadgeProps {
    /** Whether the connected wallet holds this vertical's NFT */
    isHolder: boolean;
    /** Pre-ping window in seconds (5–10) */
    prePingSeconds: number;
    /** Bid multiplier (1.2 for holders) */
    multiplier: number;
    /** Owner address for "Powered by" label */
    ownerAddress?: string | null;
    /** Compact mode = inline pill; expanded = full panel */
    compact?: boolean;
    /** Whether user has opted into holder notifications */
    notifyOptIn?: boolean;
    /** Callback to toggle notification opt-in */
    onToggleNotify?: (optIn: boolean) => void;
    /** Whether auction is in pre-ping window right now */
    inPrePingWindow?: boolean;
    /** Pre-ping remaining milliseconds (for countdown) */
    prePingRemainingMs?: number;
    /** Whether user has given GDPR consent */
    gdprConsented?: boolean;
}

// ============================================
// Helpers
// ============================================

function truncateAddress(addr: string, chars = 4): string {
    return `${addr.slice(0, chars + 2)}…${addr.slice(-chars)}`;
}

function formatCountdown(ms: number): string {
    const seconds = Math.ceil(ms / 1000);
    return `${seconds}s`;
}

// ============================================
// Accessible Switch Component (inline)
// ============================================

function AccessibleSwitch({
    checked,
    onChange,
    label,
    id,
    disabled = false,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    id: string;
    disabled?: boolean;
}) {
    return (
        <button
            id={id}
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`
                relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200
                focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:ring-offset-1
                ${checked ? 'bg-amber-500' : 'bg-gray-600'}
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
        >
            <span
                className={`
                    inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200
                    ${checked ? 'translate-x-4' : 'translate-x-0.5'}
                `}
            />
        </button>
    );
}

// ============================================
// Component
// ============================================

export function HolderPerksBadge({
    isHolder,
    prePingSeconds,
    multiplier,
    ownerAddress,
    compact = true,
    notifyOptIn = false,
    onToggleNotify,
    inPrePingWindow = false,
    prePingRemainingMs = 0,
    gdprConsented = true,
}: HolderPerksBadgeProps) {
    if (!isHolder) return null;

    // Live countdown state
    const [countdown, setCountdown] = useState(prePingRemainingMs);

    useEffect(() => {
        setCountdown(prePingRemainingMs);
    }, [prePingRemainingMs]);

    useEffect(() => {
        if (!inPrePingWindow || countdown <= 0) return;
        const timer = setInterval(() => {
            setCountdown((prev) => Math.max(0, prev - 1000));
        }, 1000);
        return () => clearInterval(timer);
    }, [inPrePingWindow, countdown]);

    const handleNotifyToggle = useCallback((optIn: boolean) => {
        onToggleNotify?.(optIn);
    }, [onToggleNotify]);

    const multiplierExplainer = `Your bids are weighted at ${multiplier}× (${Math.round((multiplier - 1) * 100)}% priority boost). A $100 bid competes as $${(100 * multiplier).toFixed(0)}.`;

    // ── Compact: inline pill ──
    if (compact) {
        return (
            <div className="flex items-center gap-1.5 flex-wrap" role="status" aria-label="Holder perks active">
                <Tooltip content={multiplierExplainer}>
                    <Badge
                        id="holder-perks-badge"
                        className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 border-amber-500/30 hover:from-amber-500/30 hover:to-orange-500/30 cursor-help gap-1 text-[11px] font-semibold animate-in fade-in duration-300"
                        aria-label={`Priority bid active: ${multiplier}x multiplier`}
                    >
                        <Zap className="h-3 w-3" aria-hidden="true" />
                        Priority Bid Active
                    </Badge>
                </Tooltip>
                {inPrePingWindow && countdown > 0 && (
                    <Badge
                        id="preping-countdown-badge"
                        className="bg-blue-500/20 text-blue-400 border-blue-500/30 gap-1 text-[11px] font-mono animate-pulse"
                        aria-live="polite"
                        aria-label={`Pre-ping window: ${formatCountdown(countdown)} remaining`}
                    >
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {formatCountdown(countdown)}
                    </Badge>
                )}
            </div>
        );
    }

    // ── Expanded: detail panel ──
    return (
        <div
            id="holder-perks-panel"
            className="rounded-lg border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-orange-500/5 p-3 space-y-2 animate-in slide-in-from-top-2 duration-300"
            role="region"
            aria-label="Holder perks panel"
        >
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold">
                    <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                    Priority Bid Active
                </div>
                {onToggleNotify && (
                    <div className="flex items-center gap-2">
                        <label
                            htmlFor="holder-notify-switch"
                            className="text-[10px] text-muted-foreground cursor-pointer select-none"
                        >
                            {notifyOptIn ? 'Alerts on' : 'Alerts off'}
                        </label>
                        <AccessibleSwitch
                            id="holder-notify-switch"
                            checked={notifyOptIn}
                            onChange={handleNotifyToggle}
                            label={notifyOptIn ? 'Disable pre-ping alerts' : 'Enable pre-ping alerts'}
                            disabled={!gdprConsented}
                        />
                    </div>
                )}
            </div>

            {/* Responsive grid: 2 cols on desktop, stacked on mobile */}
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-2" style={{ gridTemplateColumns: 'auto 1fr' }}>
                <Tooltip content={multiplierExplainer}>
                    <div className="flex items-center gap-1.5 text-muted-foreground cursor-help">
                        <TrendingUp className="h-3 w-3 text-green-500" aria-hidden="true" />
                        <span>Multiplier</span>
                    </div>
                </Tooltip>
                <span className="font-semibold text-green-400 text-right" id="holder-multiplier-value">
                    {multiplier}×
                </span>

                <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-3 w-3 text-blue-400" aria-hidden="true" />
                    <span>Pre-Ping</span>
                </div>
                <span
                    className="font-semibold text-blue-400 text-right"
                    id="holder-preping-value"
                    aria-live="polite"
                >
                    {inPrePingWindow && countdown > 0 ? (
                        <span className="animate-pulse">{formatCountdown(countdown)} left</span>
                    ) : (
                        `${prePingSeconds}s`
                    )}
                </span>
            </div>

            {/* GDPR consent notice */}
            {!gdprConsented && onToggleNotify && (
                <div className="flex items-center gap-1.5 text-[10px] text-yellow-500/80 pt-1" role="alert">
                    <Shield className="h-3 w-3" aria-hidden="true" />
                    <span>Enable notification consent to receive pre-ping alerts</span>
                </div>
            )}

            {ownerAddress && (
                <div className="pt-1.5 border-t border-amber-500/10 text-[10px] text-muted-foreground" id="powered-by-label">
                    Powered by <span className="font-mono text-foreground/70">{truncateAddress(ownerAddress)}</span>
                </div>
            )}
        </div>
    );
}

export default HolderPerksBadge;
