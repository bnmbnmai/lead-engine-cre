import { useState, useEffect } from 'react';
import {
    Search, Users, DollarSign, TrendingUp,
    Home, Sun, Shield, Wrench, Car, Scale, Briefcase, Building2, Sparkles,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SkeletonCard } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import useVerticals from '@/hooks/useVerticals';
import { API_BASE_URL, getAuthToken } from '@/lib/api';

// ── Vertical Icons (same map as admin StepProgress) ──────────────────────────────

const VERTICAL_ICONS: Record<string, React.ElementType> = {
    roofing: Home,
    mortgage: DollarSign,
    solar: Sun,
    insurance: Shield,
    home_services: Wrench,
    auto: Car,
    legal: Scale,
    financial_services: TrendingUp,
    b2b_saas: Briefcase,
    real_estate: Building2,
};

function getVerticalIcon(slug: string): React.ElementType {
    // Check exact match first, then parent slug
    if (VERTICAL_ICONS[slug]) return VERTICAL_ICONS[slug];
    const root = slug.split('.')[0];
    return VERTICAL_ICONS[root] || Sparkles;
}

// ── Types ──────────────────────────────

interface VerticalCardData {
    slug: string;
    name: string;
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
    if (buyers >= 10) return { label: 'High Demand', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' };
    if (buyers >= 3) return { label: 'Growing', color: 'bg-amber-500/10 text-amber-500 border-amber-500/30' };
    if (buyers >= 1) return { label: 'Active', color: 'bg-blue-500/10 text-blue-500 border-blue-500/30' };
    return { label: 'New', color: 'bg-muted text-muted-foreground border-border' };
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
                        activeBuyers: r.activePools,
                        totalBounty: r.totalBounty,
                        activePools: r.activePools,
                    };
                }
                return {
                    slug: 'unknown',
                    name: 'Unknown',
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
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
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
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                    {filtered.map((card) => {
                        const demand = demandLevel(card.activeBuyers);
                        const VerticalIcon = getVerticalIcon(card.slug);

                        return (
                            <Card key={card.slug} className="group transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5">
                                <CardContent className="p-6">
                                    {/* Header */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                                                <VerticalIcon className="h-6 w-6 text-primary" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold">{card.name}</h3>
                                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                    {card.slug.replace(/_/g, ' ')}
                                                </div>
                                            </div>
                                        </div>
                                        <Badge variant="outline" className={demand.color}>
                                            {demand.label}
                                        </Badge>
                                    </div>

                                    {/* Stats */}
                                    <div className="grid grid-cols-3 gap-3 mb-4">
                                        <div className="text-center p-2.5 rounded-lg bg-muted/50">
                                            <Users className="h-3.5 w-3.5 text-blue-400 mx-auto mb-1" />
                                            <div className="text-sm font-semibold">{card.activeBuyers}</div>
                                            <div className="text-[10px] text-muted-foreground">Buyers</div>
                                        </div>
                                        <div className="text-center p-2.5 rounded-lg bg-muted/50">
                                            <DollarSign className="h-3.5 w-3.5 text-emerald-400 mx-auto mb-1" />
                                            <div className="text-sm font-semibold">{formatUSDC(card.totalBounty)}</div>
                                            <div className="text-[10px] text-muted-foreground">Bounty Pool</div>
                                        </div>
                                        <div className="text-center p-2.5 rounded-lg bg-muted/50">
                                            <TrendingUp className="h-3.5 w-3.5 text-amber-400 mx-auto mb-1" />
                                            <div className="text-sm font-semibold">
                                                {card.totalBounty > 0 ? formatUSDC(card.totalBounty / Math.max(card.activeBuyers, 1)) : '—'}
                                            </div>
                                            <div className="text-[10px] text-muted-foreground">Avg / Buyer</div>
                                        </div>
                                    </div>

                                    {/* Bounty bar */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span>Pool Depth</span>
                                            <span className="font-medium text-foreground">
                                                {card.totalBounty > 0 ? `${formatUSDC(card.totalBounty)} USDC` : 'No bounties yet'}
                                            </span>
                                        </div>
                                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500"
                                                style={{ width: `${Math.min(100, (card.totalBounty / 5000) * 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default VerticalsGrid;
