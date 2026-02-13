import { useMemo } from 'react';

// ─── Helpers ────────────────────────────────

/** Convert snake_case / camelCase keys to human-readable labels */
function humanizeKey(key: string): string {
    return key
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format a value for display */
function formatValue(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return value.toLocaleString();
    return String(value);
}

// ─── Component ──────────────────────────────

interface DynamicFieldRendererProps {
    parameters: Record<string, unknown> | null | undefined;
    className?: string;
}

/**
 * Renders a lead's `parameters` object as a responsive grid of labeled fields.
 * Handles any vertical — the fields are data-driven, not hardcoded.
 */
export function DynamicFieldRenderer({ parameters, className = '' }: DynamicFieldRendererProps) {
    const entries = useMemo(() => {
        if (!parameters || typeof parameters !== 'object') return [];
        return Object.entries(parameters).filter(
            ([, v]) => v !== null && v !== undefined && v !== '',
        );
    }, [parameters]);

    if (entries.length === 0) return null;

    return (
        <div className={`grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 ${className}`}>
            {entries.map(([key, value]) => (
                <div key={key} className="min-w-0">
                    <dt className="text-xs text-muted-foreground truncate">{humanizeKey(key)}</dt>
                    <dd className="text-sm font-medium text-foreground mt-0.5 truncate">
                        {formatValue(value)}
                    </dd>
                </div>
            ))}
        </div>
    );
}

export default DynamicFieldRenderer;
