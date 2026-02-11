/**
 * VerticalSelector — Hierarchical vertical dropdown
 *
 * Fetches the vertical tree from the API, renders grouped/indented items
 * in a Radix Select. Deep levels (>2) collapse behind "Show more".
 * Includes a "Suggest New" trigger for authenticated users.
 */

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, Sparkles, Loader2 } from 'lucide-react';
import {
    Select, SelectContent, SelectGroup, SelectItem,
    SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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
    'b2b_saas', 'real_estate', 'auto', 'legal', 'financial',
].map((slug) => ({
    id: slug,
    slug,
    name: slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    depth: 0,
    children: [],
}));

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
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

    const toggleExpand = (slug: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(slug)) next.delete(slug);
            else next.add(slug);
            return next;
        });
    };

    // Render items recursively with indentation
    const renderItems = (nodes: VerticalNode[], depth: number = 0): React.ReactNode[] => {
        const items: React.ReactNode[] = [];

        for (const node of nodes) {
            const hasChildren = node.children && node.children.length > 0;
            const isExpanded = expanded.has(node.slug);
            const paddingLeft = depth * 16;

            if (depth === 0 && hasChildren) {
                // Top-level with children → render as group
                items.push(
                    <SelectGroup key={node.slug} data-testid={`vertical-group-${node.slug}`}>
                        <SelectLabel
                            className="flex items-center justify-between cursor-pointer hover:bg-accent/50 rounded-md transition-colors"
                            style={{ paddingLeft: 8 }}
                            onClick={(e) => { e.preventDefault(); toggleExpand(node.slug); }}
                        >
                            <span className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                                {node.name}
                            </span>
                            <ChevronRight
                                className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            />
                        </SelectLabel>
                        <SelectItem value={node.slug} style={{ paddingLeft: 12 }}>
                            <span className="flex items-center gap-2">
                                All {node.name}
                                <Badge variant="outline" className="text-[10px] px-1 py-0">parent</Badge>
                            </span>
                        </SelectItem>
                        {isExpanded && renderItems(node.children, depth + 1)}
                    </SelectGroup>
                );
            } else if (depth === 0) {
                // Top-level without children
                items.push(
                    <SelectItem key={node.slug} value={node.slug}>
                        {node.name}
                    </SelectItem>
                );
            } else if (depth <= 2) {
                // Sub-level items with indentation
                items.push(
                    <SelectItem
                        key={node.slug}
                        value={node.slug}
                        style={{ paddingLeft: paddingLeft + 12 }}
                    >
                        <span className="flex items-center gap-1.5">
                            <span className="text-muted-foreground text-xs">└</span>
                            {node.name}
                        </span>
                    </SelectItem>
                );
                // Recurse into deeper children
                if (hasChildren && depth < 2) {
                    items.push(...renderItems(node.children, depth + 1));
                } else if (hasChildren) {
                    // Collapse deeper levels
                    items.push(
                        <div
                            key={`more-${node.slug}`}
                            className="pl-12 py-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                            onClick={() => toggleExpand(node.slug)}
                        >
                            {isExpanded ? 'Show less' : `+${node.children.length} more...`}
                        </div>
                    );
                    if (isExpanded) {
                        items.push(...renderItems(node.children, depth + 1));
                    }
                }
            }
        }

        return items;
    };

    return (
        <div className={`flex gap-2 items-center ${className || ''}`}>
            <Select value={value} onValueChange={onValueChange} disabled={disabled || isLoading}>
                <SelectTrigger
                    className="w-[220px] sm:w-[260px]"
                    data-testid="vertical-selector"
                >
                    {isLoading ? (
                        <span className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Loading...
                        </span>
                    ) : (
                        <SelectValue placeholder={placeholder} />
                    )}
                </SelectTrigger>
                <SelectContent className="max-h-[360px]">
                    <SelectItem value="all">
                        <span className="font-medium">All Verticals</span>
                    </SelectItem>
                    <SelectSeparator />
                    {renderItems(tree)}
                    {showSuggest && (
                        <>
                            <SelectSeparator />
                            <div className="p-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-full justify-start gap-2 text-primary hover:text-primary"
                                    data-testid="suggest-vertical-btn"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onSuggestClick?.();
                                    }}
                                >
                                    <Sparkles className="h-4 w-4" />
                                    Suggest New Vertical
                                </Button>
                            </div>
                        </>
                    )}
                </SelectContent>
            </Select>
        </div>
    );
}

export default VerticalSelector;
