/**
 * FunnelGallery — Horizontal scrolling funnel browser
 *
 * Features:
 * - Search input (auto-focus on "/" key)
 * - Category filter pills (role="tablist")
 * - Horizontal scroll with FunnelCard children
 * - Keyboard nav: arrow keys to move focus, Enter to select
 * - Pinned funnels via localStorage
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Search, Star } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import useVerticals from '@/hooks/useVerticals';
import { VERTICAL_PRESETS, GENERIC_TEMPLATE } from '@/pages/FormBuilder';
import { FunnelCard } from './FunnelCard';

// ── Types ──────────────────────────────

export interface FunnelGalleryProps {
    selectedSlug: string | null;
    onSelectFunnel: (slug: string) => void;
}

// ── localStorage helpers ──────────────────────────────

const PINNED_KEY = 'le_pinned_funnels';

function getPinned(): string[] {
    try {
        return JSON.parse(localStorage.getItem(PINNED_KEY) || '[]');
    } catch {
        return [];
    }
}

function setPinned(slugs: string[]) {
    localStorage.setItem(PINNED_KEY, JSON.stringify(slugs));
}

// ── Root category extraction ──────────────────────────────

const ALL_CATEGORY = '__all__';

// ── Component ──────────────────────────────

export function FunnelGallery({ selectedSlug, onSelectFunnel }: FunnelGalleryProps) {
    const { verticals, flatList, labelMap } = useVerticals();
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState(ALL_CATEGORY);
    const [pinned, setPinnedState] = useState<string[]>(getPinned);
    const scrollRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    // "/" shortcut to focus search
    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
                e.preventDefault();
                searchRef.current?.focus();
            }
        }
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, []);

    // Build root categories from verticals tree
    const rootCategories = useMemo(() => {
        return verticals
            .filter(v => v.depth === 0)
            .map(v => ({ slug: v.slug, name: v.name }));
    }, [verticals]);

    // Filter flat list
    const filteredFunnels = useMemo(() => {
        let list = flatList;

        // Category filter
        if (category === '__pinned__') {
            const pinnedSet = new Set(pinned);
            list = list.filter(v => pinnedSet.has(v.value));
        } else if (category !== ALL_CATEGORY) {
            list = list.filter(v =>
                v.value === category || v.value.startsWith(`${category}.`) || v.parentSlug === category
            );
        }

        // Search filter
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(v =>
                v.label.toLowerCase().includes(q) || v.value.toLowerCase().includes(q)
            );
        }

        return list;
    }, [flatList, category, search, pinned]);

    // Sort: pinned first, then alphabetical
    const sortedFunnels = useMemo(() => {
        const pinnedSet = new Set(pinned);
        return [...filteredFunnels].sort((a, b) => {
            const ap = pinnedSet.has(a.value) ? 0 : 1;
            const bp = pinnedSet.has(b.value) ? 0 : 1;
            if (ap !== bp) return ap - bp;
            return a.label.localeCompare(b.label);
        });
    }, [filteredFunnels, pinned]);

    const togglePin = useCallback((slug: string) => {
        setPinnedState(prev => {
            const next = prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug];
            setPinned(next);
            return next;
        });
    }, []);

    // Keyboard navigation in gallery
    const handleGalleryKeyDown = useCallback((e: React.KeyboardEvent) => {
        const container = scrollRef.current;
        if (!container) return;
        const cards = Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));
        const idx = cards.findIndex(c => c === document.activeElement);

        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            const next = Math.min(idx + 1, cards.length - 1);
            cards[next]?.focus();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = Math.max(idx - 1, 0);
            cards[prev]?.focus();
        }
    }, []);

    // Get field count for a slug
    const getFieldCount = useCallback((slug: string) => {
        const preset = VERTICAL_PRESETS[slug] || GENERIC_TEMPLATE;
        return preset.length;
    }, []);

    // Get parent name for breadcrumb
    const getParentName = useCallback((slug: string) => {
        const parts = slug.split('.');
        if (parts.length <= 1) return undefined;
        return labelMap[parts[0]];
    }, [labelMap]);

    const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

    return (
        <div className="space-y-3">
            {/* Search + category row */}
            <div className="flex flex-col sm:flex-row gap-2">
                {/* Search */}
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        ref={searchRef}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search funnels… (press /)"
                        className="pl-8 h-8 text-xs"
                        aria-label="Search funnels"
                    />
                </div>

                {/* Category filter pills */}
                <div
                    className="flex items-center gap-1 overflow-x-auto scrollbar-hide"
                    role="tablist"
                    aria-label="Filter by category"
                >
                    <button
                        role="tab"
                        aria-selected={category === ALL_CATEGORY}
                        onClick={() => setCategory(ALL_CATEGORY)}
                        className={cn(
                            'px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all shrink-0',
                            category === ALL_CATEGORY
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted/40 text-muted-foreground hover:bg-muted/70',
                        )}
                    >
                        All
                    </button>
                    {pinned.length > 0 && (
                        <button
                            role="tab"
                            aria-selected={category === '__pinned__'}
                            onClick={() => setCategory('__pinned__')}
                            className={cn(
                                'px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all shrink-0 flex items-center gap-1',
                                category === '__pinned__'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted/40 text-muted-foreground hover:bg-muted/70',
                            )}
                        >
                            <Star className="h-3 w-3" /> Pinned
                        </button>
                    )}
                    {rootCategories.map(rc => (
                        <button
                            key={rc.slug}
                            role="tab"
                            aria-selected={category === rc.slug}
                            onClick={() => setCategory(rc.slug)}
                            className={cn(
                                'px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all shrink-0',
                                category === rc.slug
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted/40 text-muted-foreground hover:bg-muted/70',
                            )}
                        >
                            {rc.name}
                        </button>
                    ))}
                </div>
            </div>

            {/* Gallery */}
            <div
                ref={scrollRef}
                role="listbox"
                aria-label="Funnel gallery"
                className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide scroll-smooth"
                onKeyDown={handleGalleryKeyDown}
            >
                {sortedFunnels.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-6 px-4">
                        No funnels match "{search}" {category !== ALL_CATEGORY ? `in ${labelMap[category] || category}` : ''}
                    </div>
                ) : (
                    sortedFunnels.map(f => (
                        <FunnelCard
                            key={f.value}
                            slug={f.value}
                            name={f.label}
                            parentName={getParentName(f.value)}
                            fieldCount={getFieldCount(f.value)}
                            isSelected={selectedSlug === f.value}
                            isPinned={pinnedSet.has(f.value)}
                            onClick={onSelectFunnel}
                            onTogglePin={togglePin}
                        />
                    ))
                )}
            </div>

            {/* Funnel count */}
            <div className="text-[10px] text-muted-foreground">
                {sortedFunnels.length} funnel{sortedFunnels.length !== 1 ? 's' : ''}
                {pinned.length > 0 && ` · ${pinned.length} pinned`}
            </div>
        </div>
    );
}

export default FunnelGallery;
