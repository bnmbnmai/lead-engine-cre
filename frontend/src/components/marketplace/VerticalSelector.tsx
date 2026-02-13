/**
 * VerticalSelector — Searchable hierarchical vertical dropdown
 *
 * Custom dropdown with integrated search input.
 * Fetches the vertical tree from the API, renders grouped/indented items
 * with client-side filtering. Includes a "Suggest New" trigger.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, ChevronDown, Sparkles, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';

// ============================================
// Types
// ============================================

interface VerticalNode {
    id: string;
    slug: string;
    name: string;
    depth: number;
    children: VerticalNode[];
}

interface VerticalSelectorProps {
    value: string;
    onValueChange: (slug: string) => void;
    placeholder?: string;
    disabled?: boolean;
    showSuggest?: boolean;
    onSuggestClick?: () => void;
    className?: string;
}

// ============================================
// Hardcoded fallback (before hierarchy is seeded)
// ============================================

const FALLBACK_VERTICALS: VerticalNode[] = [
    'solar', 'mortgage', 'roofing', 'insurance', 'home_services',
    'b2b_saas', 'real_estate', 'auto', 'legal', 'financial_services',
].map((slug) => ({
    id: slug,
    slug,
    name: slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    depth: 0,
    children: [],
}));

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

export function VerticalSelector({
    value,
    onValueChange,
    placeholder = 'All Verticals',
    disabled = false,
    showSuggest = false,
    onSuggestClick,
    className,
}: VerticalSelectorProps) {
    const [tree, setTree] = useState<VerticalNode[]>(FALLBACK_VERTICALS);
    const [isLoading, setIsLoading] = useState(true);
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const fetchHierarchy = useCallback(async () => {
        try {
            const { data } = await api.getVerticalHierarchy();
            if (data?.tree && data.tree.length > 0) {
                setTree(data.tree);
            }
        } catch {
            // Keep fallback
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchHierarchy();
    }, [fetchHierarchy]);

    // Listen for vertical updates via custom event (dispatched by socket handler)
    useEffect(() => {
        const handler = () => fetchHierarchy();
        window.addEventListener('vertical:updated', handler);
        return () => window.removeEventListener('vertical:updated', handler);
    }, [fetchHierarchy]);

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setSearch('');
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

    // Filter nodes by search
    const allFlat = flattenNodes(tree);
    const filtered = search
        ? allFlat.filter(n => n.name.toLowerCase().includes(search.toLowerCase()) || n.slug.includes(search.toLowerCase()))
        : allFlat.filter(n => n.depth === 0); // Only show top-level when not searching

    const selectedLabel = value === 'all' || !value
        ? placeholder
        : allFlat.find(n => n.slug === value)?.name || value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const handleSelect = (slug: string) => {
        onValueChange(slug);
        setIsOpen(false);
        setSearch('');
    };

    return (
        <div className={`relative ${className || ''}`} ref={containerRef}>
            {/* Trigger Button */}
            <button
                type="button"
                disabled={disabled || isLoading}
                onClick={() => setIsOpen(!isOpen)}
                data-testid="vertical-selector"
                className="flex items-center justify-between w-[220px] sm:w-[260px] h-9 px-3 py-2 rounded-md border border-border bg-background text-sm hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
                {isLoading ? (
                    <span className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading...
                    </span>
                ) : (
                    <span className="truncate">{selectedLabel}</span>
                )}
                <ChevronDown className={`h-4 w-4 ml-2 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Panel */}
            {isOpen && (
                <div className="absolute z-50 mt-1 w-[280px] sm:w-[320px] rounded-lg border border-border bg-card shadow-lg animate-in fade-in-0 zoom-in-95">
                    {/* Search Input */}
                    <div className="p-2 border-b border-border">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search verticals..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                    </div>

                    {/* Options List */}
                    <div className="max-h-[280px] overflow-y-auto p-1">
                        {/* All Verticals option */}
                        {!search && (
                            <button
                                type="button"
                                onClick={() => handleSelect('all')}
                                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${value === 'all' || !value ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent/50'}`}
                            >
                                {(value === 'all' || !value) && <Check className="h-3.5 w-3.5" />}
                                <span className="font-medium">All Verticals</span>
                            </button>
                        )}

                        {filtered.length === 0 ? (
                            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                                No verticals match "{search}"
                            </div>
                        ) : (
                            filtered.map((node) => (
                                <button
                                    type="button"
                                    key={node.slug}
                                    onClick={() => handleSelect(node.slug)}
                                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${value === node.slug ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent/50'}`}
                                    style={{ paddingLeft: search ? 12 : (node.depth * 16) + 12 }}
                                >
                                    {value === node.slug && <Check className="h-3.5 w-3.5 shrink-0" />}
                                    <span className="truncate">{node.name}</span>
                                    {node.children?.length > 0 && (
                                        <Badge variant="outline" className="text-[10px] px-1 py-0 ml-auto shrink-0">
                                            {node.children.length}
                                        </Badge>
                                    )}
                                </button>
                            ))
                        )}
                    </div>

                    {/* Suggest New Vertical */}
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

export default VerticalSelector;
