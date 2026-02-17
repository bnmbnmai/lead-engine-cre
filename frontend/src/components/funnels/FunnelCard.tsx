/**
 * FunnelCard — Individual funnel thumbnail for the gallery
 *
 * Shows emoji, vertical name, parent breadcrumb, field count badge,
 * CRO status indicator. Fully accessible with ARIA role="option".
 */

import { memo } from 'react';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VERTICAL_EMOJI } from '@/components/forms/StepProgress';

// ── Types ──────────────────────────────

export interface FunnelCardProps {
    slug: string;
    name: string;
    parentName?: string;
    fieldCount?: number;
    hasCro?: boolean;
    isSelected?: boolean;
    isPinned?: boolean;
    onClick: (slug: string) => void;
    onTogglePin?: (slug: string) => void;
}

// ── Helpers ──────────────────────────────

/** Resolve emoji for a slug — tries exact match, then root prefix */
function getEmoji(slug: string): string {
    if (VERTICAL_EMOJI[slug]) return VERTICAL_EMOJI[slug];
    const root = slug.split('.')[0];
    return VERTICAL_EMOJI[root] || '📋';
}

// ── Component ──────────────────────────────

export const FunnelCard = memo(function FunnelCard({
    slug,
    name,
    parentName,
    fieldCount,
    hasCro,
    isSelected = false,
    isPinned = false,
    onClick,
    onTogglePin,
}: FunnelCardProps) {
    const emoji = getEmoji(slug);

    return (
        <button
            role="option"
            aria-selected={isSelected}
            aria-label={`${name}${parentName ? ` in ${parentName}` : ''} funnel${hasCro ? ', CRO enabled' : ''}`}
            className={cn(
                'group relative flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition-all duration-200 min-w-[110px] max-w-[130px] cursor-pointer select-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                isSelected
                    ? 'border-primary bg-primary/10 shadow-md shadow-primary/10 scale-[1.02]'
                    : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5 hover:scale-[1.01]',
            )}
            onClick={() => onClick(slug)}
        >
            {/* Pin indicator */}
            {isPinned && (
                <span className="absolute -top-1.5 -right-1.5 text-[10px]" aria-hidden="true">📌</span>
            )}

            {/* Emoji thumbnail */}
            <span className="text-2xl leading-none" aria-hidden="true">{emoji}</span>

            {/* Name */}
            <span className={cn(
                'text-xs font-medium text-center leading-tight line-clamp-2',
                isSelected ? 'text-primary' : 'text-foreground',
            )}>
                {name}
            </span>

            {/* Parent breadcrumb */}
            {parentName && (
                <span className="text-[10px] text-muted-foreground truncate max-w-full">
                    {parentName}
                </span>
            )}

            {/* Bottom badges */}
            <div className="flex items-center gap-1.5 mt-0.5">
                {fieldCount != null && (
                    <span className="text-[9px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full tabular-nums">
                        {fieldCount}f
                    </span>
                )}
                {hasCro && (
                    <span className="flex items-center gap-0.5 text-[9px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded-full">
                        <Activity className="h-2.5 w-2.5" />
                        CRO
                    </span>
                )}
            </div>

            {/* Pin toggle (hover-only) */}
            {onTogglePin && (
                <button
                    className="absolute top-0 left-0 w-full h-full opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); onTogglePin(slug); }}
                    aria-label={isPinned ? `Unpin ${name}` : `Pin ${name}`}
                >
                    <span className="absolute top-1 left-1 text-[10px] bg-background/80 rounded px-1 py-0.5 backdrop-blur-sm">
                        {isPinned ? '📌 Unpin' : '📌 Pin'}
                    </span>
                </button>
            )}
        </button>
    );
});

export default FunnelCard;
