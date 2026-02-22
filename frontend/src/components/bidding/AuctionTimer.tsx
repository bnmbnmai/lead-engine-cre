import { useState, useEffect } from 'react';
import { Clock, AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AuctionTimerProps {
    phase: 'BIDDING' | 'REVEAL' | 'RESOLVED' | 'CANCELLED';
    biddingEndsAt?: string;
    revealEndsAt?: string;
    onPhaseChange?: (phase: string) => void;
    /**
     * Server-authoritative remaining milliseconds (from auction:updated or getAuctionState).
     * When provided during BIDDING phase, the timer is initialised from this value
     * instead of computing Date.now() vs biddingEndsAt — eliminating the initial desync.
     */
    serverRemainingMs?: number;
}

export function AuctionTimer({ phase, biddingEndsAt, revealEndsAt, onPhaseChange, serverRemainingMs }: AuctionTimerProps) {
    // Initialise from server value when available, otherwise use local calculation
    const [timeRemaining, setTimeRemaining] = useState<number>(() => {
        if (phase === 'BIDDING' && serverRemainingMs != null) return serverRemainingMs;
        return 0;
    });

    const endTime = phase === 'BIDDING' ? biddingEndsAt : revealEndsAt;

    // Re-sync when server pushes an authoritative remaining time
    useEffect(() => {
        if (phase === 'BIDDING' && serverRemainingMs != null) {
            setTimeRemaining(serverRemainingMs);
        }
    }, [serverRemainingMs, phase]);

    useEffect(() => {
        if (!endTime || phase === 'RESOLVED' || phase === 'CANCELLED') return;

        const updateTimer = () => {
            const end = new Date(endTime).getTime();
            const now = Date.now();
            const diff = Math.max(0, end - now);
            setTimeRemaining(diff);

            if (diff === 0 && phase === 'BIDDING') {
                onPhaseChange?.('REVEAL');
            }
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);

        return () => clearInterval(interval);
    }, [endTime, phase, onPhaseChange]);


    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
        }
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    const getPhaseInfo = () => {
        switch (phase) {
            case 'BIDDING':
                return {
                    label: 'Bidding Phase',
                    color: 'text-blue-500',
                    bgColor: 'bg-blue-500/20',
                    icon: Clock,
                    description: 'Submit your bids now!',
                };
            case 'REVEAL':
                return {
                    label: 'Reveal Phase',
                    color: 'text-purple-500',
                    bgColor: 'bg-purple-500/20',
                    icon: AlertCircle,
                    description: 'Reveal your committed bids',
                };
            case 'RESOLVED':
                return {
                    label: 'Auction Ended',
                    color: 'text-green-500',
                    bgColor: 'bg-green-500/20',
                    icon: CheckCircle,
                    description: 'Winner determined',
                };
            default:
                return {
                    label: 'Cancelled',
                    color: 'text-gray-500',
                    bgColor: 'bg-gray-500/20',
                    icon: AlertCircle,
                    description: 'Auction was cancelled',
                };
        }
    };

    const phaseInfo = getPhaseInfo();
    const Icon = phaseInfo.icon;
    const isUrgent = timeRemaining > 0 && timeRemaining < 5 * 60 * 1000; // Less than 5 minutes

    return (
        <div className={cn('rounded-2xl p-6 transition-all', phaseInfo.bgColor, isUrgent && 'animate-pulse')}>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <Icon className={cn('h-6 w-6', phaseInfo.color)} />
                    <div>
                        <div className={cn('font-semibold', phaseInfo.color)}>{phaseInfo.label}</div>
                        <div className="text-sm text-muted-foreground">{phaseInfo.description}</div>
                    </div>
                </div>
            </div>

            {phase !== 'RESOLVED' && phase !== 'CANCELLED' && timeRemaining > 0 && (
                <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">Time Remaining</div>
                    <div className={cn('text-4xl font-mono font-bold', phaseInfo.color, isUrgent && 'text-red-500')}>
                        {formatTime(timeRemaining)}
                    </div>
                </div>
            )}

            {phase !== 'RESOLVED' && phase !== 'CANCELLED' && timeRemaining === 0 && (
                <div className="text-center space-y-1">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Clock className="h-4 w-4 animate-spin" />
                        <span>Resolving auction…</span>
                    </div>
                    <p className="text-xs text-muted-foreground/60">Revealing sealed bids & determining winner</p>
                </div>
            )}
        </div>
    );
}

export default AuctionTimer;
