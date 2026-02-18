import { useState, useEffect } from 'react';
import { Search, Users, DollarSign, TrendingUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SkeletonCard } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { VERTICAL_EMOJI } from '@/components/forms/StepProgress';
import useVerticals from '@/hooks/useVerticals';
import { API_BASE_URL, getAuthToken } from '@/lib/api';

// ── Types ──────────────────────────────

interface VerticalCardData {
    slug: string;
    name: string;
    emoji: string;
    activeBuyers: number;
    totalBounty: number;
    activePools: number;
}

// ── Helpers ──────────────────────────────

function formatUSDC(amount: number): string {
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
    return `$${amount.toFixed(0)}`;
}

function demandLevel(buyers: number): { label: string; color: string } {
    if (buyers >= 10) return { label: 'High Demand', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' };
    if (buyers >= 3) return { label: 'Growing', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' };
    if (buyers >= 1) return { label: 'Active', color: 'text-blue-400 border-blue-500/30 bg-blue-500/10' };
    return { label: 'New', color: 'text-muted-foreground border-border bg-muted/50' };
}

// ── Component ──────────────────────────────

export function VerticalsGrid() {
    const { flatList, loading: verticalsLoading } = useVerticals();
    const [cards, setCards] = useState<VerticalCardData[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // Fetch bounty data for each vertical
    useEffect(() => {
        if (verticalsLoading || flatList.length === 0) return;

        const fetchBountyData = async () => {
            setLoading(true);
            const token = getAuthToken();
            const headers: HeadersInit = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            // Fetch bounty info for top-level verticals only (depth 0)
            const topLevel = flatList.filter(v => v.depth === 0);

            const results = await Promise.allSettled(
                topLevel.map(async (v) => {
                    try {
                        const res = await fetch(`${API_BASE_URL}/api/verticals/${v.value}/bounty`, { headers });
                        if (!res.ok) return { slug: v.value, name: v.label, totalBounty: 0, activePools: 0 };
                        const data = await res.json();
                        return {
                            slug: v.value,
                            name: v.label,
                            totalBounty: data.totalBounty || 0,
                            activePools: data.activePools || 0,
                        };
                    } catch {
                        return { slug: v.value, name: v.label, totalBounty: 0, activePools: 0 };
                    }
                })
            );

            const cardData: VerticalCardData[] = results.map((result) => {
                if (result.status === 'fulfilled') {
                    const r = result.value;
                    return {
                        slug: r.slug,
                        name: r.name,
                        emoji: VERTICAL_EMOJI[r.slug] || '📋',
                        activeBuyers: r.activePools,
                        totalBounty: r.totalBounty,
                        activePools: r.activePools,
                    };
                }
                return {
                    slug: 'unknown',
                    name: 'Unknown',
                    emoji: '📋',
                    activeBuyers: 0,
                    totalBounty: 0,
                    activePools: 0,
                };
            });

            // Sort by total bounty descending, then by name
            cardData.sort((a, b) => b.totalBounty - a.totalBounty || a.name.localeCompare(b.name));
            setCards(cardData);
            setLoading(false);
        };

        fetchBountyData();
    }, [flatList, verticalsLoading]);

    // Filter cards by search
    const filtered = debouncedSearch
        ? cards.filter(c =>
            c.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
            c.slug.toLowerCase().includes(debouncedSearch.toLowerCase())
        )
        : cards;

    return (
        <div className="space-y-4">
            {/* Search */}
            <Input
                placeholder="Search verticals..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                icon={<Search className="h-4 w-4" />}
            />

            {/* Grid */}
            {loading || verticalsLoading ? (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                        <SkeletonCard key={i} />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={Search}
                    title="No verticals found"
                    description={search ? 'Try a different search term.' : 'No verticals are available yet.'}
                />
            ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filtered.map((card) => {
                        const demand = demandLevel(card.activeBuyers);

                        return (
                            <div
                                key={card.slug}
                                className="glass rounded-xl p-5 flex flex-col gap-3 hover:ring-1 hover:ring-primary/30 transition-all group"
                            >
                                {/* Header: emoji + name + demand badge */}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="text-2xl shrink-0">{card.emoji}</span>
                                        <div className="min-w-0">
                                            <h3 className="font-semibold text-foreground truncate capitalize">
                                                {card.name}
                                            </h3>
                                            <span className="text-xs text-muted-foreground">{card.slug}</span>
                                        </div>
                                    </div>
                                    <Badge
                                        variant="outline"
                                        className={`text-[10px] px-1.5 py-0 shrink-0 ${demand.color}`}
                                    >
                                        {demand.label}
                                    </Badge>
                                </div>

                                {/* Stats row */}
                                <div className="grid grid-cols-3 gap-2 text-center">
                                    {/* Active Buyers / Pools */}
                                    <div className="p-2 rounded-lg bg-muted/40">
                                        <div className="flex items-center justify-center gap-1 text-blue-400 mb-0.5">
                                            <Users className="h-3 w-3" />
                                        </div>
                                        <div className="text-sm font-semibold">{card.activeBuyers}</div>
                                        <div className="text-[10px] text-muted-foreground">Buyers</div>
                                    </div>

                                    {/* Total Bounty */}
                                    <div className="p-2 rounded-lg bg-muted/40">
                                        <div className="flex items-center justify-center gap-1 text-emerald-400 mb-0.5">
                                            <DollarSign className="h-3 w-3" />
                                        </div>
                                        <div className="text-sm font-semibold">{formatUSDC(card.totalBounty)}</div>
                                        <div className="text-[10px] text-muted-foreground">Bounty Pool</div>
                                    </div>

                                    {/* Demand Trend */}
                                    <div className="p-2 rounded-lg bg-muted/40">
                                        <div className="flex items-center justify-center gap-1 text-amber-400 mb-0.5">
                                            <TrendingUp className="h-3 w-3" />
                                        </div>
                                        <div className="text-sm font-semibold">
                                            {card.totalBounty > 0 ? formatUSDC(card.totalBounty / Math.max(card.activeBuyers, 1)) : '—'}
                                        </div>
                                        <div className="text-[10px] text-muted-foreground">Avg / Buyer</div>
                                    </div>
                                </div>

                                {/* Bounty bar — visual indicator of pool depth */}
                                {card.totalBounty > 0 && (
                                    <div className="space-y-1">
                                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                            <span>Pool Depth</span>
                                            <span className="font-medium text-emerald-400">{formatUSDC(card.totalBounty)} USDC</span>
                                        </div>
                                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                                                style={{ width: `${Math.min(100, (card.totalBounty / 5000) * 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default VerticalsGrid;
