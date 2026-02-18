import { useState, useEffect, useCallback } from 'react';
import {
    BarChart3, TrendingUp, Users, Layers, RefreshCw, Activity, Shield, Clock,
    Home, DollarSign, Sun, Wrench, Car, Scale, Briefcase, Building2, Sparkles,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/Tooltip';
import { ChainlinkBadge } from '@/components/ui/ChainlinkBadge';
import useVerticals from '@/hooks/useVerticals';
import api, { API_BASE_URL, getAuthToken } from '@/lib/api';

// ============================================
// Market Metrics Panel — inline marketplace tab
// ============================================
// Displays:
//   - 4 aggregate metric cards
//   - Full vertical hierarchy grid with bounty pool + demand per vertical
//   - CustomLeadFeed explanation
//
// No PII is exposed. All values are aggregates or counts.

// ── Vertical Icons (same map as admin StepProgress) ──────────────────────

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

interface MetricCard {
    label: string;
    value: string;
    subtext: string;
    icon: React.ReactNode;
    color: string;
    bgColor: string;
}

interface VerticalCardData {
    slug: string;
    name: string;
    depth: number;
    parentSlug?: string;
    bountyPool: number;
    demand: number;       // total reserve price of active leads in this vertical
    auctionLeads: number;
    buyNowLeads: number;
}

// ── Helpers ──────────────────────────────

function formatUSDC(amount: number): string {
    const n = Number(amount) || 0;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    if (n > 0) return `$${n.toFixed(2)}`;
    return '$0.00';
}

function formatVerticalName(slug: string): string {
    return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Component ──────────────────────────────

export function MarketMetricsPanel() {
    const { flatList, loading: verticalsLoading } = useVerticals();
    const [metrics, setMetrics] = useState<MetricCard[]>([]);
    const [verticalCards, setVerticalCards] = useState<VerticalCardData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const [refreshing, setRefreshing] = useState(false);

    const fetchMetrics = useCallback(async () => {
        setRefreshing(true);
        try {
            // Fetch live leads from marketplace API
            const [leadsRes, buyNowRes] = await Promise.all([
                api.listLeads({ status: 'IN_AUCTION' }),
                api.listBuyNowLeads({}),
            ]);

            const leads = leadsRes.data?.leads || [];
            const buyNow = buyNowRes.data?.leads || [];
            const totalActive = leads.length + buyNow.length;
            const allLeads = [...leads, ...buyNow];

            // Aggregate metrics
            const scoredLeads = allLeads.filter((l: any) => l.qualityScore != null);
            const avgScore = scoredLeads.length > 0
                ? Math.round(scoredLeads.reduce((sum: number, l: any) => sum + (l.qualityScore || 0), 0) / scoredLeads.length / 100)
                : 0;

            const withBids = leads.filter((l: any) => (l._count?.bids || l.auctionRoom?.bidCount || 0) > 0);
            const fillRate = leads.length > 0 ? Math.round((withBids.length / leads.length) * 100) : 0;

            const avgReserve = allLeads.length > 0
                ? allLeads.reduce((sum: number, l: any) => sum + (l.reservePrice || 0), 0) / allLeads.length
                : 0;

            setMetrics([
                {
                    label: 'Active Leads',
                    value: totalActive.toLocaleString(),
                    subtext: `${leads.length} in auction · ${buyNow.length} buy now`,
                    icon: <Activity className="h-5 w-5" />,
                    color: 'text-blue-400',
                    bgColor: 'bg-blue-500/10',
                },
                {
                    label: 'Avg Quality Score',
                    value: avgScore > 0 ? `${avgScore}/100` : '—',
                    subtext: `${scoredLeads.length} scored leads (Chainlink CRE)`,
                    icon: <Shield className="h-5 w-5" />,
                    color: 'text-emerald-400',
                    bgColor: 'bg-emerald-500/10',
                },
                {
                    label: 'Auction Fill Rate',
                    value: `${fillRate}%`,
                    subtext: `${withBids.length} of ${leads.length} auctions have bids`,
                    icon: <TrendingUp className="h-5 w-5" />,
                    color: 'text-violet-400',
                    bgColor: 'bg-violet-500/10',
                },
                {
                    label: 'Avg Reserve Price',
                    value: avgReserve > 0 ? `$${avgReserve.toFixed(2)}` : '—',
                    subtext: `Across ${allLeads.length} active leads`,
                    icon: <BarChart3 className="h-5 w-5" />,
                    color: 'text-amber-400',
                    bgColor: 'bg-amber-500/10',
                },
            ]);

            // Per-vertical lead counts & demand
            const verticalLeadMap: Record<string, { auction: number; buyNow: number; demand: number }> = {};
            leads.forEach((l: any) => {
                const v = l.vertical || 'unknown';
                if (!verticalLeadMap[v]) verticalLeadMap[v] = { auction: 0, buyNow: 0, demand: 0 };
                verticalLeadMap[v].auction++;
                verticalLeadMap[v].demand += l.reservePrice || 0;
            });
            buyNow.forEach((l: any) => {
                const v = l.vertical || 'unknown';
                if (!verticalLeadMap[v]) verticalLeadMap[v] = { auction: 0, buyNow: 0, demand: 0 };
                verticalLeadMap[v].buyNow++;
                verticalLeadMap[v].demand += l.buyNowPrice || l.reservePrice || 0;
            });

            // Build vertical cards using flatList from useVerticals
            const token = getAuthToken();
            const headers: HeadersInit = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            // Fetch bounty data only for root verticals (depth 0) to avoid request spam.
            // Child verticals inherit their parent's bounty pool value.
            const rootVerticals = flatList.filter(v => v.depth === 0);
            const bountyResults = await Promise.allSettled(
                rootVerticals.map(async (v) => {
                    try {
                        const res = await fetch(`${API_BASE_URL}/api/v1/verticals/${v.value}/bounty`, { headers });
                        if (!res.ok) return { slug: v.value, totalBounty: 0 };
                        const data = await res.json();
                        return { slug: v.value, totalBounty: Number(data.totalBounty) || 0 };
                    } catch {
                        return { slug: v.value, totalBounty: 0 };
                    }
                })
            );

            const bountyMap: Record<string, number> = {};
            bountyResults.forEach((result) => {
                if (result.status === 'fulfilled') {
                    bountyMap[result.value.slug] = result.value.totalBounty;
                }
            });

            const cards: VerticalCardData[] = flatList.map((v) => {
                const leadData = verticalLeadMap[v.value] || { auction: 0, buyNow: 0, demand: 0 };
                // Child verticals inherit parent's bounty pool
                const bounty = bountyMap[v.value] ?? (v.parentSlug ? bountyMap[v.parentSlug] ?? 0 : 0);
                return {
                    slug: v.value,
                    name: v.label,
                    depth: v.depth,
                    parentSlug: v.parentSlug,
                    bountyPool: bounty,
                    demand: leadData.demand,
                    auctionLeads: leadData.auction,
                    buyNowLeads: leadData.buyNow,
                };
            });

            // Sort: parent verticals first (depth 0), then children; within each depth sort by demand descending
            cards.sort((a, b) => a.depth - b.depth || b.demand - a.demand || a.name.localeCompare(b.name));

            setVerticalCards(cards);
            setLastRefresh(new Date());
        } catch (err) {
            console.error('[MarketMetricsPanel] Error fetching metrics:', err);
        } finally {
            setIsLoading(false);
            setRefreshing(false);
        }
    }, [flatList]);

    useEffect(() => {
        if (verticalsLoading || flatList.length === 0) return;
        fetchMetrics();
        const interval = setInterval(fetchMetrics, 30_000);
        return () => clearInterval(interval);
    }, [fetchMetrics, verticalsLoading, flatList.length]);

    return (
        <div className="space-y-6">
            {/* CustomLeadFeed On-Chain Info */}
            <section>
                <Card className="border-dashed border-blue-500/20">
                    <CardContent className="p-6">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                                <Users className="h-5 w-5 text-blue-400" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-sm mb-1">CustomLeadFeed.sol — Public Data Producer</h3>
                                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                                    Lead Engine publishes anonymized market metrics as a Chainlink-compatible on-chain data feed.
                                    Other dApps can call <code className="text-blue-400 font-mono text-[11px]">latestAnswer()</code> to
                                    read aggregate quality scores, settlement volume, leads tokenized, and fill rate.
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                        avgQualityScore
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/30">
                                        totalVolumeSettled
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/30">
                                        totalLeadsTokenized
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                                        auctionFillRate
                                    </Badge>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </section>

            {/* Data Source Notice */}
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
                <Clock className="h-4 w-4 text-blue-400 shrink-0" />
                <p className="text-xs text-muted-foreground">
                    Auto-refreshes every 30s · Last updated {lastRefresh.toLocaleTimeString()} · All data is anonymized and aggregated — no PII
                </p>
                <div className="flex items-center gap-2 ml-auto shrink-0">
                    <Badge variant="outline" className="text-[10px]">
                        CustomLeadFeed
                    </Badge>
                    <ChainlinkBadge size="sm" />
                    <Tooltip content="Refresh metrics from live marketplace data">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={fetchMetrics}
                            disabled={refreshing}
                            className="gap-1.5 h-7 px-2"
                        >
                            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
                        </Button>
                    </Tooltip>
                </div>
            </div>

            {/* Metric Cards */}
            {isLoading ? (
                <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <Card key={i} className="animate-pulse">
                            <CardContent className="p-6">
                                <div className="h-4 bg-muted rounded w-24 mb-3" />
                                <div className="h-8 bg-muted rounded w-16 mb-2" />
                                <div className="h-3 bg-muted rounded w-32" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    {metrics.map((m) => (
                        <Card key={m.label} className="group hover:border-white/10 transition-all">
                            <CardContent className="p-6">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                        {m.label}
                                    </span>
                                    <div className={`w-9 h-9 rounded-lg ${m.bgColor} flex items-center justify-center ${m.color}`}>
                                        {m.icon}
                                    </div>
                                </div>
                                <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
                                <p className="text-xs text-muted-foreground mt-1">{m.subtext}</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* All Verticals Grid */}
            <section>
                <div className="flex items-center gap-2 mb-4">
                    <Layers className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">All Verticals</h2>
                    <Badge variant="outline" className="text-[10px]">
                        {verticalCards.length} total
                    </Badge>
                </div>

                {verticalCards.length === 0 && !isLoading ? (
                    <Card>
                        <CardContent className="p-8 text-center">
                            <Layers className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                            <p className="text-sm text-muted-foreground">
                                No verticals available. Check the admin panel to configure verticals.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 max-h-[800px] overflow-y-auto pr-1">
                        {verticalCards.map((card) => {
                            const VerticalIcon = getVerticalIcon(card.slug);
                            const totalLeads = card.auctionLeads + card.buyNowLeads;
                            const isChild = card.depth > 0;

                            return (
                                <Card key={card.slug} className="group transition-all duration-500 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/5 active:scale-[0.98]">
                                    <CardContent className="p-6">
                                        {/* Header */}
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${totalLeads > 0 ? 'bg-blue-500/10' : 'bg-muted/50'}`}>
                                                    <VerticalIcon className={`h-6 w-6 ${totalLeads > 0 ? 'text-blue-400' : 'text-muted-foreground'}`} />
                                                </div>
                                                <div>
                                                    <h3 className="font-semibold">
                                                        {isChild && (
                                                            <span className="text-muted-foreground text-xs mr-1">↳</span>
                                                        )}
                                                        {formatVerticalName(card.name)}
                                                    </h3>
                                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                        <Layers className="h-3 w-3" />
                                                        {card.slug.replace(/_/g, ' ')}
                                                    </div>
                                                </div>
                                            </div>
                                            {totalLeads > 0 && (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide border bg-blue-500/15 text-blue-400 border-blue-500/30">
                                                    <Activity className="h-3 w-3" />
                                                    {totalLeads} lead{totalLeads !== 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </div>

                                        {/* Stats row */}
                                        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                                            <div className="flex items-center gap-1">
                                                <Users className="h-4 w-4 text-violet-400" />
                                                <span className="font-medium text-foreground">{card.auctionLeads}</span> auction
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <DollarSign className="h-4 w-4 text-emerald-400" />
                                                <span className="font-medium text-foreground">{card.buyNowLeads}</span> buy now
                                            </div>
                                        </div>

                                        {/* Bounty bar */}
                                        {card.bountyPool > 0 && (
                                            <div className="mb-4">
                                                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-1000 ease-linear"
                                                        style={{ width: `${Math.min(Math.max((card.bountyPool / 5000) * 100, 5), 100)}%` }}
                                                    />
                                                </div>
                                                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                                                    <span>Bounty Pool</span>
                                                    <span>{formatUSDC(card.bountyPool)} USDC</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Pricing section */}
                                        <div className="flex items-center justify-between pt-4 border-t border-border">
                                            <div>
                                                <span className="text-xs text-muted-foreground">Bounty Pool</span>
                                                <div className="text-lg font-bold">{formatUSDC(card.bountyPool)}</div>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-xs text-muted-foreground">Demand</span>
                                                <div className={`text-lg font-bold ${card.demand > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                                                    {formatUSDC(card.demand)}
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}

export default MarketMetricsPanel;
