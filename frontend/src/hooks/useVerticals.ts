/**
 * useVerticals — Shared hook for dynamic vertical lists
 *
 * Fetches from /api/verticals/hierarchy, provides:
 *  - verticals: full tree (VerticalNode[])
 *  - flatList: flattened {value, label, depth}[] for selects
 *  - labelMap: slug → name lookup
 *  - search/filter with client-side matching
 *  - refresh() for manual refresh + auto-refresh every 60s
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '@/lib/api';

// ── Types ──────────────────────────────

export interface VerticalNode {
    id: string;
    slug: string;
    name: string;
    description?: string | null;
    depth: number;
    sortOrder: number;
    attributes?: any;
    aliases?: string[];
    status: string;
    requiresTcpa?: boolean;
    requiresKyc?: boolean;
    restrictedGeos?: string[];
    children: VerticalNode[];
}

export interface FlatVertical {
    value: string;
    label: string;
    depth: number;
    parentSlug?: string;
}

// ── Flatten helper ──────────────────────────────

function flattenTree(nodes: VerticalNode[], parentSlug?: string): FlatVertical[] {
    const result: FlatVertical[] = [];
    for (const node of nodes) {
        result.push({
            value: node.slug,
            label: node.name,
            depth: node.depth,
            parentSlug,
        });
        if (node.children?.length) {
            result.push(...flattenTree(node.children, node.slug));
        }
    }
    return result;
}

// ── Fallback verticals (shown when API returns empty or errors) ──

const FALLBACK_VERTICAL_SLUGS = [
    'solar', 'mortgage', 'roofing', 'insurance', 'home_services',
    'b2b_saas', 'real_estate', 'auto', 'legal', 'financial_services',
];

const FALLBACK_TREE: VerticalNode[] = FALLBACK_VERTICAL_SLUGS.map((slug, i) => ({
    id: slug,
    slug,
    name: slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description: null,
    depth: 0,
    sortOrder: i,
    status: 'ACTIVE',
    requiresTcpa: false,
    requiresKyc: false,
    restrictedGeos: [],
    aliases: [],
    children: [],
}));

// ── Hook ──────────────────────────────

const REFRESH_INTERVAL_MS = 60_000; // 60s auto-refresh

export function useVerticals(options?: { autoRefresh?: boolean }) {
    const { autoRefresh = true } = options ?? {};

    const [verticals, setVerticals] = useState<VerticalNode[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const prevCountRef = useRef(0);

    const fetchVerticals = useCallback(async () => {
        try {
            const { data, error: apiErr } = await api.getVerticalHierarchy();
            if (apiErr) {
                console.warn('[useVerticals] API error, using fallback verticals:', apiErr.error);
                setVerticals(FALLBACK_TREE);
                setError(apiErr.error || 'Failed to fetch verticals');
                return;
            }
            const tree = data?.tree ?? [];
            if (tree.length === 0) {
                console.warn('[useVerticals] API returned empty tree, using fallback verticals');
                setVerticals(FALLBACK_TREE);
            } else {
                setVerticals(tree);
            }
            setError(null);

            // Detect new verticals since last fetch
            const newCount = flattenTree(tree.length > 0 ? tree : FALLBACK_TREE).length;
            if (prevCountRef.current > 0 && newCount > prevCountRef.current) {
                const delta = newCount - prevCountRef.current;
                console.info(`[useVerticals] ${delta} new vertical(s) available`);
            }
            prevCountRef.current = newCount;
        } catch (err: any) {
            console.warn('[useVerticals] Network error, using fallback verticals:', err.message);
            setVerticals(FALLBACK_TREE);
            setError(err.message || 'Network error');
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchVerticals();
    }, [fetchVerticals]);

    // Auto-refresh
    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(fetchVerticals, REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [autoRefresh, fetchVerticals]);

    // Derived data
    const flatList = useMemo(() => flattenTree(verticals), [verticals]);

    const labelMap = useMemo<Record<string, string>>(() => {
        const map: Record<string, string> = {};
        for (const item of flatList) {
            map[item.value] = item.label;
        }
        return map;
    }, [flatList]);

    // Client-side search
    const search = useCallback(
        (query: string): FlatVertical[] => {
            if (!query.trim()) return flatList;
            const q = query.toLowerCase();
            return flatList.filter(
                (v) =>
                    v.label.toLowerCase().includes(q) ||
                    v.value.toLowerCase().includes(q),
            );
        },
        [flatList],
    );

    return {
        verticals,
        flatList,
        labelMap,
        loading,
        error,
        search,
        refresh: fetchVerticals,
    };
}

export default useVerticals;
