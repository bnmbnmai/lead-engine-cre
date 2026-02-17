/**
 * Funnel Components — Logic Tests
 *
 * Tests the shared logic patterns used across FunnelCard, FunnelGallery,
 * and FunnelMetricsBar without requiring a DOM or React renderer.
 *
 * Validates:
 * 1. Emoji resolution (exact match, root prefix, fallback)
 * 2. Pinned sorting (pinned first, then alpha)
 * 3. Category filtering (root, child, dot-notation)
 * 4. Metric formatting (thousands, millions, percentages)
 * 5. Tooltip dismiss persistence pattern
 * 6. Search filtering
 */

// ─── Mirror logic from components ───

const VERTICAL_EMOJI: Record<string, string> = {
    roofing: '🏠',
    mortgage: '💰',
    solar: '☀️',
    insurance: '🛡️',
    home_services: '🔧',
    auto: '🚗',
    legal: '⚖️',
    financial_services: '📈',
    b2b_saas: '💼',
    real_estate: '🏢',
};

function getEmoji(slug: string): string {
    if (VERTICAL_EMOJI[slug]) return VERTICAL_EMOJI[slug];
    const root = slug.split('.')[0];
    return VERTICAL_EMOJI[root] || '📋';
}

interface FlatVertical {
    value: string;
    label: string;
    parentSlug?: string;
}

function filterByCategory(list: FlatVertical[], category: string): FlatVertical[] {
    if (category === '__all__') return list;
    return list.filter(v =>
        v.value === category || v.value.startsWith(`${category}.`) || v.parentSlug === category
    );
}

function filterBySearch(list: FlatVertical[], query: string): FlatVertical[] {
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter(v =>
        v.label.toLowerCase().includes(q) || v.value.toLowerCase().includes(q)
    );
}

function sortWithPinned(list: FlatVertical[], pinned: string[]): FlatVertical[] {
    const pinnedSet = new Set(pinned);
    return [...list].sort((a, b) => {
        const ap = pinnedSet.has(a.value) ? 0 : 1;
        const bp = pinnedSet.has(b.value) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.label.localeCompare(b.label);
    });
}

function formatMetric(n?: number): string {
    if (n == null) return '—';
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return n >= 10_000 ? `${(n / 1_000).toFixed(0)}k` : n.toLocaleString();
    return n.toString();
}

function formatPct(n?: number): string {
    return n != null ? `${n.toFixed(1)}%` : '—';
}

// ═══════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════

describe('FunnelCard — getEmoji', () => {
    it('returns exact match for root slug', () => {
        expect(getEmoji('solar')).toBe('☀️');
        expect(getEmoji('mortgage')).toBe('💰');
    });

    it('returns root emoji for child slug (dot notation)', () => {
        expect(getEmoji('solar.residential')).toBe('☀️');
        expect(getEmoji('insurance.auto')).toBe('🛡️');
    });

    it('returns fallback for unknown slug', () => {
        expect(getEmoji('crypto')).toBe('📋');
        expect(getEmoji('unknown.child')).toBe('📋');
    });
});

describe('FunnelGallery — filterByCategory', () => {
    const fixtures: FlatVertical[] = [
        { value: 'solar', label: 'Solar' },
        { value: 'solar.residential', label: 'Residential Solar', parentSlug: 'solar' },
        { value: 'solar.commercial', label: 'Commercial Solar', parentSlug: 'solar' },
        { value: 'mortgage', label: 'Mortgage' },
        { value: 'mortgage.refinance', label: 'Refinance', parentSlug: 'mortgage' },
    ];

    it('returns all when category is __all__', () => {
        expect(filterByCategory(fixtures, '__all__')).toHaveLength(5);
    });

    it('filters to exact + children for root category', () => {
        const result = filterByCategory(fixtures, 'solar');
        expect(result.map(f => f.value)).toEqual(['solar', 'solar.residential', 'solar.commercial']);
    });

    it('returns empty for non-existent category', () => {
        expect(filterByCategory(fixtures, 'legal')).toHaveLength(0);
    });
});

describe('FunnelGallery — filterBySearch', () => {
    const fixtures: FlatVertical[] = [
        { value: 'solar', label: 'Solar Energy' },
        { value: 'solar.residential', label: 'Residential Solar' },
        { value: 'mortgage', label: 'Mortgage Loans' },
    ];

    it('returns all if query is empty', () => {
        expect(filterBySearch(fixtures, '')).toHaveLength(3);
        expect(filterBySearch(fixtures, '   ')).toHaveLength(3);
    });

    it('matches by label (case-insensitive)', () => {
        expect(filterBySearch(fixtures, 'solar').map(f => f.value)).toEqual(['solar', 'solar.residential']);
    });

    it('matches by slug', () => {
        expect(filterBySearch(fixtures, 'mortgage').map(f => f.value)).toEqual(['mortgage']);
    });

    it('returns empty for no matches', () => {
        expect(filterBySearch(fixtures, 'xyz')).toHaveLength(0);
    });
});

describe('FunnelGallery — sortWithPinned', () => {
    const fixtures: FlatVertical[] = [
        { value: 'c', label: 'Charlie' },
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Bravo' },
    ];

    it('sorts alphabetically when no pins', () => {
        const result = sortWithPinned(fixtures, []);
        expect(result.map(f => f.value)).toEqual(['a', 'b', 'c']);
    });

    it('puts pinned items first', () => {
        const result = sortWithPinned(fixtures, ['c']);
        expect(result.map(f => f.value)).toEqual(['c', 'a', 'b']);
    });

    it('sorts within pinned group alphabetically', () => {
        const result = sortWithPinned(fixtures, ['c', 'a']);
        expect(result.map(f => f.value)).toEqual(['a', 'c', 'b']);
    });
});

describe('FunnelMetricsBar — formatMetric', () => {
    it('returns "—" for null/undefined', () => {
        expect(formatMetric(undefined)).toBe('—');
        expect(formatMetric(null as any)).toBe('—');
    });

    it('formats small numbers as-is', () => {
        expect(formatMetric(42)).toBe('42');
        expect(formatMetric(0)).toBe('0');
    });

    it('formats thousands with locale', () => {
        const result = formatMetric(5_432);
        expect(result).toMatch(/5[\.,]432/); // locale-dependent separator
    });

    it('formats 10k+ as Xk', () => {
        expect(formatMetric(12_345)).toBe('12k');
        expect(formatMetric(50_000)).toBe('50k');
    });

    it('formats millions as $X.XM', () => {
        expect(formatMetric(1_500_000)).toBe('$1.5M');
        expect(formatMetric(2_000_000)).toBe('$2.0M');
    });
});

describe('FunnelMetricsBar — formatPct', () => {
    it('returns "—" for undefined', () => {
        expect(formatPct(undefined)).toBe('—');
    });

    it('formats with 1 decimal', () => {
        expect(formatPct(12.345)).toBe('12.3%');
        expect(formatPct(0)).toBe('0.0%');
        expect(formatPct(100)).toBe('100.0%');
    });
});

describe('Tooltip dismiss pattern', () => {
    it('Set logic: add and check', () => {
        const dismissed = new Set<string>();
        expect(dismissed.has('metrics')).toBe(false);
        dismissed.add('metrics');
        expect(dismissed.has('metrics')).toBe(true);
    });

    it('serialization round-trip', () => {
        const original = ['metrics', 'gallery'];
        const serialized = JSON.stringify(original);
        const restored = new Set(JSON.parse(serialized));
        expect(restored.has('metrics')).toBe(true);
        expect(restored.has('gallery')).toBe(true);
        expect(restored.has('unknown')).toBe(false);
    });
});
