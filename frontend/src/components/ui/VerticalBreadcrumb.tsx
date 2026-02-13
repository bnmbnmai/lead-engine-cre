/**
 * VerticalBreadcrumb — Inline breadcrumb display for vertical slugs
 *
 * Usage:
 *   <VerticalBreadcrumb slug="legal.family" />  → Legal › Family
 *   <VerticalBreadcrumb slug="solar" />          → Solar
 */

import { useVerticals } from '@/hooks/useVerticals';

interface VerticalBreadcrumbProps {
    slug: string;
    size?: 'sm' | 'md';
    className?: string;
}

function titleCase(s: string): string {
    return s.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function VerticalBreadcrumb({ slug, size = 'md', className }: VerticalBreadcrumbProps) {
    const { breadcrumbMap } = useVerticals({ autoRefresh: false });

    const crumbs = breadcrumbMap[slug] ?? [titleCase(slug)];
    const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

    return (
        <span className={`inline-flex items-center gap-1 ${textSize} ${className ?? ''}`}>
            {crumbs.map((label, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground/60">›</span>}
                    <span
                        className={
                            i === crumbs.length - 1
                                ? 'font-semibold text-foreground'
                                : 'text-muted-foreground'
                        }
                    >
                        {label}
                    </span>
                </span>
            ))}
        </span>
    );
}

export default VerticalBreadcrumb;
