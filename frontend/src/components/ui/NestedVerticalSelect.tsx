/**
 * NestedVerticalSelect — Searchable hierarchical vertical dropdown
 *
 * Reusable across all forms: Create Ask, Submit Lead, Preferences, Form Builder.
 * Features:
 *  - Accordion-style tree with expand/collapse toggles
 *  - Real-time search across all depths
 *  - Breadcrumb display in trigger (e.g. "Legal → Family")
 *  - "All Verticals" option (opt-in)
 *  - "Suggest New" footer (opt-in)
 *  - Validation error display
 *  - Accessible: keyboard nav, focus trap, ARIA roles
 *  - Mobile responsive: full-width, capped scroll height
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight, Sparkles, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useVerticals, type VerticalNode } from '@/hooks/useVerticals';

// ============================================
// Types
// ============================================

export interface NestedVerticalSelectProps {
    value: string;
    onValueChange: (slug: string) => void;
    placeholder?: string;
    disabled?: boolean;
    showAllOption?: boolean;
    showSuggest?: boolean;
    onSuggestClick?: () => void;
    allowRootsOnly?: boolean;
    className?: string;
    error?: string;
    triggerClassName?: string;
}

// ============================================
// Flatten helper for search
// ============================================

function flattenNodes(nodes: VerticalNode[]): VerticalNode[] {
    const result: VerticalNode[] = [];
    for (const node of nodes) {
        result.push(node);
        if (node.children?.length) {
            result.push(...flattenNodes(node.children));
        }
    }
    return result;
}

// ============================================
// Component
// ============================================

export function NestedVerticalSelect({
    value,
    onValueChange,
    placeholder = 'Select a vertical',
    disabled = false,
    showAllOption = false,
    showSuggest = false,
    onSuggestClick,
    allowRootsOnly = false,
    className,
    error,
    triggerClassName,
}: NestedVerticalSelectProps) {
    const { verticals: tree, breadcrumbMap, loading } = useVerticals({ autoRefresh: false });

    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());
    const containerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // All flat nodes for search
    const allFlat = useMemo(() => flattenNodes(tree), [tree]);

    // Toggle root expansion
    const toggleExpand = useCallback((slug: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedRoots((prev) => {
            const next = new Set(prev);
            if (next.has(slug)) {
                next.delete(slug);
            } else {
                next.add(slug);
            }
            return next;
        });
    }, []);

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setSearchQuery('');
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    // Focus search on open
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => searchInputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // Keyboard escape to close
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
                setSearchQuery('');
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen]);

    // Auto-expand the parent of the currently selected value
    useEffect(() => {
        if (value && value.includes('.')) {
            const rootSlug = value.split('.')[0];
            setExpandedRoots((prev) => {
                if (prev.has(rootSlug)) return prev;
                return new Set(prev).add(rootSlug);
            });
        }
    }, [value]);

    // Filtered nodes when searching
    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        const q = searchQuery.toLowerCase();
        return allFlat.filter(
            (n) =>
                n.name.toLowerCase().includes(q) ||
                n.slug.toLowerCase().includes(q) ||
                (n.aliases && n.aliases.some((a) => a.toLowerCase().includes(q)))
        );
    }, [searchQuery, allFlat]);

    const isSearching = searchQuery.trim().length > 0;

    // Trigger label
    const triggerLabel = useMemo(() => {
        if (!value || value === 'all') return placeholder;
        const crumbs = breadcrumbMap[value];
        if (crumbs) return crumbs.join(' → ');
        // Fallback: titlecase the slug
        return value.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }, [value, placeholder, breadcrumbMap]);

    const handleSelect = (slug: string) => {
        onValueChange(slug);
        setIsOpen(false);
        setSearchQuery('');
    };

    const hasError = Boolean(error);

    return (
        <div className={`relative isolate z-[51] ${className || ''}`} ref={containerRef}>
            {/* Trigger Button */}
            <button
                type="button"
                disabled={disabled || loading}
                onClick={() => setIsOpen(!isOpen)}
                data-testid="nested-vertical-select"
                className={`flex items-center justify-between w-full h-10 px-3 py-2 rounded-xl border text-sm transition-colors
                    ${hasError
                        ? 'border-destructive ring-1 ring-destructive/30'
                        : 'border-input hover:bg-accent/50'
                    }
                    bg-background disabled:opacity-50 disabled:pointer-events-none
                    focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ring-offset-background
                    ${triggerClassName || ''}`}
            >
                {loading ? (
                    <span className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading…
                    </span>
                ) : (
                    <span className={`truncate ${!value || value === 'all' ? 'text-muted-foreground' : ''}`}>
                        {triggerLabel}
                    </span>
                )}
                <ChevronDown className={`h-4 w-4 ml-2 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Validation error */}
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}

            {/* Dropdown Panel */}
            {isOpen && (
                <div
                    className="absolute z-[60] mt-1 w-full min-w-[280px] rounded-xl border border-border bg-popover text-popover-foreground shadow-xl ring-1 ring-black/5 dark:ring-white/5 animate-in fade-in-0 zoom-in-95"
                    role="listbox"
                >
                    {/* Search Input */}
                    <div className="p-2 border-b border-border">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search verticals…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                aria-label="Search verticals"
                            />
                        </div>
                    </div>

                    {/* Options List */}
                    <div className="max-h-[280px] sm:max-h-[320px] overflow-y-auto p-1">
                        {/* "All Verticals" option */}
                        {showAllOption && !isSearching && (
                            <button
                                type="button"
                                role="option"
                                aria-selected={value === 'all' || !value}
                                onClick={() => handleSelect('all')}
                                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors
                                    ${value === 'all' || !value
                                        ? 'bg-primary/10 text-primary font-medium'
                                        : 'hover:bg-accent/50'
                                    }`}
                            >
                                {(value === 'all' || !value) && <Check className="h-3.5 w-3.5 shrink-0" />}
                                <span className="font-medium">All Verticals</span>
                            </button>
                        )}

                        {/* Search results (flat) */}
                        {isSearching ? (
                            searchResults.length === 0 ? (
                                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                                    No verticals match "{searchQuery}"
                                </div>
                            ) : (
                                searchResults.map((node) => {
                                    const isDisabled = allowRootsOnly && node.depth > 0;
                                    const crumbs = breadcrumbMap[node.slug];
                                    return (
                                        <button
                                            type="button"
                                            role="option"
                                            aria-selected={value === node.slug}
                                            key={node.slug}
                                            disabled={isDisabled}
                                            onClick={() => !isDisabled && handleSelect(node.slug)}
                                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors
                                                ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}
                                                ${value === node.slug
                                                    ? 'bg-primary/10 text-primary font-medium'
                                                    : 'hover:bg-accent/50'
                                                }`}
                                            style={{ paddingLeft: 12 }}
                                        >
                                            {value === node.slug && <Check className="h-3.5 w-3.5 shrink-0" />}
                                            <span className="truncate">
                                                {crumbs && crumbs.length > 1
                                                    ? <><span className="text-muted-foreground">{crumbs.slice(0, -1).join(' › ')} ›</span>{' '}{crumbs[crumbs.length - 1]}</>
                                                    : node.name
                                                }
                                            </span>
                                        </button>
                                    );
                                })
                            )
                        ) : (
                            /* Tree view (accordion style) */
                            tree.map((root) => {
                                const isExpanded = expandedRoots.has(root.slug);
                                const hasChildren = root.children && root.children.length > 0;
                                const isSelected = value === root.slug;

                                return (
                                    <div key={root.slug}>
                                        {/* Root item */}
                                        <div className="flex items-center">
                                            {hasChildren && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => toggleExpand(root.slug, e)}
                                                    className="p-1.5 rounded-md hover:bg-accent/50 transition-colors shrink-0"
                                                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                                >
                                                    {isExpanded
                                                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                                    }
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handleSelect(root.slug)}
                                                className={`flex-1 flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium transition-colors
                                                    ${!hasChildren ? 'ml-7' : ''}
                                                    ${isSelected
                                                        ? 'bg-primary/10 text-primary'
                                                        : 'hover:bg-accent/50'
                                                    }`}
                                            >
                                                {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                                                <span className="truncate">{root.name}</span>
                                                {hasChildren && (
                                                    <Badge variant="outline" className="text-[10px] px-1 py-0 ml-auto shrink-0">
                                                        {root.children!.length}
                                                    </Badge>
                                                )}
                                            </button>
                                        </div>

                                        {/* Children (expanded) */}
                                        {hasChildren && isExpanded && (
                                            <div className="ml-7 border-l border-border/50 pl-1 mb-1">
                                                {root.children!.map((child) => {
                                                    const childSelected = value === child.slug;
                                                    const isChildDisabled = allowRootsOnly;
                                                    return (
                                                        <button
                                                            type="button"
                                                            role="option"
                                                            aria-selected={childSelected}
                                                            key={child.slug}
                                                            disabled={isChildDisabled}
                                                            onClick={() => !isChildDisabled && handleSelect(child.slug)}
                                                            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors
                                                                ${isChildDisabled ? 'opacity-40 cursor-not-allowed' : ''}
                                                                ${childSelected
                                                                    ? 'bg-primary/10 text-primary font-medium'
                                                                    : 'hover:bg-accent/50 text-foreground/80'
                                                                }`}
                                                        >
                                                            {childSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                                                            <span className="truncate">{child.name}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Suggest New Vertical footer */}
                    {showSuggest && (
                        <div className="border-t border-border p-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2 text-primary hover:text-primary"
                                data-testid="suggest-vertical-btn"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setIsOpen(false);
                                    onSuggestClick?.();
                                }}
                            >
                                <Sparkles className="h-4 w-4" />
                                Suggest New Vertical
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default NestedVerticalSelect;
