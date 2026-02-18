import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    Search, Users, DollarSign, TrendingUp, Eye,
    Home, Sun, Shield, Wrench, Car, Scale, Briefcase, Building2, Sparkles, Layers,
} from 'lucide-react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
    if (amount > 0) return `$${amount.toFixed(2)}`;
    return '$0.00';
}

function demandLevel(buyers: number): { label: string; className: string; iconColor: string } {
    if (buyers >= 10) return { label: 'High Demand', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', iconColor: 'bg-emerald-500/15' };
    if (buyers >= 3) return { label: 'Growing', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30', iconColor: 'bg-amber-500/15' };
    if (buyers >= 1) return { label: 'Active', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30', iconColor: 'bg-blue-500/15' };
    return { label: 'New', className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30', iconColor: 'bg-zinc-500/15' };
}

function formatTitle(name: string): string {
    return name
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
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
                return { slug: 'unknown', name: 'Unknown', activeBuyers: 0, totalBounty: 0, activePools: 0 };
            });

            cardData.sort((a, b) => b.totalBounty - a.totalBounty || a.name.localeCompare(b.name));
            setCards(cardData);
            setLoading(false);
        };

        fetchBountyData();
    }, [flatList, verticalsLoading]);

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
                    {[1, 2, 3, 4, 5, 6].map((i) => (
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
                        const avgPerBuyer = card.activeBuyers > 0 ? card.totalBounty / card.activeBuyers : 0;

                        return (
                            <Card key={card.slug} className="group transition-all duration-500 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/5 active:scale-[0.98]">
                                <CardContent className="p-6">
                                    {/* Header — matches LeadCard header layout */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${demand.iconColor}`}>
                                                <VerticalIcon className="h-6 w-6 text-primary" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold">{formatTitle(card.name)}</h3>
                                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                    <Layers className="h-3 w-3" />
                                                    {card.slug.replace(/_/g, ' ')}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide border ${demand.className}`}>
                                                <Users className="h-3 w-3" />
                                                {demand.label}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Detail rows — matches LeadCard source & stats layout */}
                                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                                        <div className="flex items-center gap-1">
                                            <Users className="h-4 w-4 text-blue-400" />
                                            <span className="font-medium text-foreground">{card.activeBuyers}</span> active buyer{card.activeBuyers !== 1 ? 's' : ''}
                                        </div>
                                        {card.activePools > 0 && (
                                            <div className="flex items-center gap-1 text-emerald-400">
                                                <DollarSign className="h-4 w-4" />
                                                <span className="font-medium">{card.activePools}</span> pool{card.activePools !== 1 ? 's' : ''}
                                            </div>
                                        )}
                                    </div>

                                    {/*  Bounty bar — matches LeadCard auction progress */}
                                    <div className="mb-4">
                                        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-1000 ease-linear"
                                                style={{ width: `${Math.min(card.totalBounty > 0 ? Math.max((card.totalBounty / 5000) * 100, 5) : 0, 100)}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                                            <span>Pool Depth</span>
                                            <span>{card.totalBounty > 0 ? formatUSDC(card.totalBounty) + ' USDC' : 'No bounties yet'}</span>
                                        </div>
                                    </div>

                                    {/* Pricing section — matches LeadCard border-t pricing */}
                                    <div className="flex items-center justify-between pt-4 border-t border-border">
                                        <div>
                                            <span className="text-xs text-muted-foreground">Total Bounty</span>
                                            <div className="text-lg font-bold">{formatUSDC(card.totalBounty)}</div>
                                            {avgPerBuyer > 0 && (
                                                <div className="flex items-center gap-1 text-[11px] mt-0.5 text-muted-foreground">
                                                    <TrendingUp className="h-3 w-3" />
                                                    {formatUSDC(avgPerBuyer)} avg / buyer
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>

                                {/* Footer — matches BuyNowCard CardFooter with action buttons */}
                                <CardFooter className="px-6 pb-6">
                                    <div className="w-full space-y-2">
                                        <Button asChild variant="outline" className="w-full">
                                            <Link to={`/marketplace?vertical=${card.slug}`}>
                                                <Eye className="h-4 w-4 mr-2" />
                                                Browse Leads
                                            </Link>
                                        </Button>
                                    </div>
                                </CardFooter>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default VerticalsGrid;
