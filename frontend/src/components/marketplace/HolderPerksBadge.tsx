import { useState, useEffect, useCallback } from 'react';
import { Zap, Clock, TrendingUp, Bell, BellOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/Tooltip';
import { Button } from '@/components/ui/button';

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

    const handleNotifyToggle = useCallback(() => {
        onToggleNotify?.(!notifyOptIn);
    }, [notifyOptIn, onToggleNotify]);

    // ── Compact: inline pill ──
    if (compact) {
        return (
            <div className="flex items-center gap-1.5">
                <Tooltip content={`${multiplier}× bid multiplier · ${prePingSeconds}s pre-ping window`}>
                    <Badge
                        id="holder-perks-badge"
                        className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 border-amber-500/30 hover:from-amber-500/30 hover:to-orange-500/30 cursor-help gap-1 text-[11px] font-semibold animate-in fade-in duration-300"
                    >
                        <Zap className="h-3 w-3" />
                        Priority Bid Active
                    </Badge>
                </Tooltip>
                {inPrePingWindow && countdown > 0 && (
                    <Badge
                        id="preping-countdown-badge"
                        className="bg-blue-500/20 text-blue-400 border-blue-500/30 gap-1 text-[11px] font-mono animate-pulse"
                    >
                        <Clock className="h-3 w-3" />
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
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold">
                    <Zap className="h-3.5 w-3.5" />
                    Priority Bid Active
                </div>
                {onToggleNotify && (
                    <Tooltip content={notifyOptIn ? 'Disable pre-ping alerts' : 'Enable pre-ping alerts'}>
                        <Button
                            id="holder-notify-toggle"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 hover:bg-amber-500/10"
                            onClick={handleNotifyToggle}
                        >
                            {notifyOptIn ? (
                                <Bell className="h-3.5 w-3.5 text-amber-400" />
                            ) : (
                                <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                        </Button>
                    </Tooltip>
                )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                    <TrendingUp className="h-3 w-3 text-green-500" />
                    <span>Multiplier</span>
                </div>
                <span className="font-semibold text-green-400 text-right" id="holder-multiplier-value">
                    {multiplier}×
                </span>

                <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-3 w-3 text-blue-400" />
                    <span>Pre-Ping</span>
                </div>
                <span className="font-semibold text-blue-400 text-right" id="holder-preping-value">
                    {inPrePingWindow && countdown > 0 ? (
                        <span className="animate-pulse">{formatCountdown(countdown)} left</span>
                    ) : (
                        `${prePingSeconds}s`
                    )}
                </span>
            </div>

            {ownerAddress && (
                <div className="pt-1.5 border-t border-amber-500/10 text-[10px] text-muted-foreground" id="powered-by-label">
                    Powered by <span className="font-mono text-foreground/70">{truncateAddress(ownerAddress)}</span>
                </div>
            )}
        </div>
    );
}

export default HolderPerksBadge;
