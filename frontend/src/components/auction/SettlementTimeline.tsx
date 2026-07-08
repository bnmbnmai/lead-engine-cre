/**
 * Settlement timeline (Phase D5).
 * Visualizes the post-auction settlement saga steps for buyers.
 */
import { CheckCircle, Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SettlementStep = 'winner' | 'vault' | 'nft' | 'sold';

interface SettlementTimelineProps {
    /** Highest completed step (inclusive). */
    completedThrough?: SettlementStep | null;
    leadStatus?: string;
    className?: string;
}

const STEPS: { key: SettlementStep; label: string }[] = [
    { key: 'winner', label: 'Winner determined' },
    { key: 'vault', label: 'Vault settlement' },
    { key: 'nft', label: 'Lead NFT minted' },
    { key: 'sold', label: 'Lead delivered' },
];

const ORDER: SettlementStep[] = ['winner', 'vault', 'nft', 'sold'];

export function SettlementTimeline({ completedThrough, leadStatus, className }: SettlementTimelineProps) {
    if (!completedThrough && leadStatus !== 'SETTLING' && leadStatus !== 'SOLD') return null;

    const completedIdx = completedThrough ? ORDER.indexOf(completedThrough) : -1;
    const settling = leadStatus === 'SETTLING';

    return (
        <div className={cn('rounded-xl border bg-card/50 p-4', className)} aria-live="polite">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Settlement timeline</h3>
            <ol className="space-y-3">
                {STEPS.map((step, i) => {
                    const done = i <= completedIdx || leadStatus === 'SOLD';
                    const active = settling && i === completedIdx + 1;
                    return (
                        <li key={step.key} className="flex items-center gap-3 text-sm">
                            {done ? (
                                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                            ) : active ? (
                                <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0" />
                            ) : (
                                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                            )}
                            <span className={done ? 'text-foreground' : active ? 'text-blue-400' : 'text-muted-foreground'}>
                                {step.label}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}

export default SettlementTimeline;
