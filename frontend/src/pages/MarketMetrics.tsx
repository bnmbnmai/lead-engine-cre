import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, TrendingUp, Users, Layers, ArrowLeft, RefreshCw, Activity, Shield, Clock } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/Tooltip';
import { ChainlinkBadge } from '@/components/ui/ChainlinkBadge';
import api from '@/lib/api';

// ============================================
// Market Metrics — public page
// ============================================
// Displays live anonymized data sourced from CustomLeadFeed:
//   - Today's lead volume
//   - Auction fill rate
//   - Top verticals by volume
//   - Chainlink Data Feeds floor prices
//
// No PII is exposed. All values are aggregates or counts.

interface MetricCard {
    label: string;
    value: string;
    subtext: string;
    icon: React.ReactNode;
    color: string;
    bgColor: string;
}

interface VerticalStat {
    vertical: string;
    count: number;
    avgPrice: number;
}

function formatVerticalName(slug: string): string {
    return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function MarketMetrics() {
    const [metrics, setMetrics] = useState<MetricCard[]>([]);
    const [topVerticals, setTopVerticals] = useState<VerticalStat[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const [refreshing, setRefreshing] = useState(false);

    const fetchMetrics = useCallback(async () => {
        setRefreshing(true);
        try {
            // Fetch live leads from marketplace API (public, no auth needed)
            const [leadsRes, buyNowRes] = await Promise.all([
                api.listLeads({ status: 'IN_AUCTION' }),
                api.listBuyNowLeads({}),
            ]);

            const leads = leadsRes.data?.leads || [];
            const buyNow = buyNowRes.data?.leads || [];
            const totalActive = leads.length + buyNow.length;

            // Compute aggregate metrics from live data
            const allLeads = [...leads, ...buyNow];
            const scoredLeads = allLeads.filter((l: any) => l.qualityScore != null);
            const avgScore = scoredLeads.length > 0
                ? Math.round(scoredLeads.reduce((sum: number, l: any) => sum + (l.qualityScore || 0), 0) / scoredLeads.length / 100)
                : 0;

            // Auction fill rate — leads with bids vs total
            const withBids = leads.filter((l: any) => (l._count?.bids || l.auctionRoom?.bidCount || 0) > 0);
            const fillRate = leads.length > 0 ? Math.round((withBids.length / leads.length) * 100) : 0;

            // Average reserve price
            const avgReserve = allLeads.length > 0
                ? allLeads.reduce((sum: number, l: any) => sum + (l.reservePrice || 0), 0) / allLeads.length
                : 0;

            // Vertical breakdown
            const verticalMap: Record<string, { count: number; totalPrice: number }> = {};
            allLeads.forEach((l: any) => {
                const v = l.vertical || 'unknown';
                if (!verticalMap[v]) verticalMap[v] = { count: 0, totalPrice: 0 };
                verticalMap[v].count++;
                verticalMap[v].totalPrice += l.reservePrice || 0;
            });

            const sortedVerticals = Object.entries(verticalMap)
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 8)
                .map(([vertical, data]) => ({
                    vertical,
                    count: data.count,
                    avgPrice: data.count > 0 ? data.totalPrice / data.count : 0,
                }));

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

            setTopVerticals(sortedVerticals);
            setLastRefresh(new Date());
        } catch (err) {
            console.error('[MarketMetrics] Error fetching metrics:', err);
        } finally {
            setIsLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchMetrics();
        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchMetrics, 30_000);
        return () => clearInterval(interval);
    }, [fetchMetrics]);

    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <Link
                            to="/marketplace"
                            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition mb-2"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Back to Marketplace
                        </Link>
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                            Market Metrics
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                            Live anonymized data from the Lead Engine marketplace.
                            Powered by <span className="text-foreground font-medium">CustomLeadFeed.sol</span> — a public Chainlink-compatible data feed.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <ChainlinkBadge size="md" />
                        <Tooltip content="Refresh metrics from live marketplace data">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={fetchMetrics}
                                disabled={refreshing}
                                className="gap-1.5"
                            >
                                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                                Refresh
                            </Button>
                        </Tooltip>
                    </div>
                </div>

                {/* Data Source Notice */}
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
                    <Clock className="h-4 w-4 text-blue-400 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                        Auto-refreshes every 30s · Last updated {lastRefresh.toLocaleTimeString()} · All data is anonymized and aggregated — no PII
                    </p>
                    <Badge variant="outline" className="text-[10px] ml-auto shrink-0">
                        CustomLeadFeed
                    </Badge>
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

                {/* Top Verticals */}
                <section>
                    <div className="flex items-center gap-2 mb-4">
                        <Layers className="h-5 w-5 text-muted-foreground" />
                        <h2 className="text-lg font-semibold">Top Verticals by Volume</h2>
                        <Badge variant="outline" className="text-[10px]">
                            {topVerticals.length} active
                        </Badge>
                    </div>

                    {topVerticals.length === 0 && !isLoading ? (
                        <Card>
                            <CardContent className="p-8 text-center">
                                <Layers className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                                <p className="text-sm text-muted-foreground">
                                    No leads currently active. Inject leads via the Demo Control Panel to see vertical metrics.
                                </p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                            {topVerticals.map((v, i) => (
                                <Card key={v.vertical} className="group hover:border-white/10 transition-all">
                                    <CardContent className="p-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs text-muted-foreground font-medium">
                                                #{i + 1}
                                            </span>
                                            <Badge variant="outline" className="text-[10px]">
                                                {v.count} lead{v.count !== 1 ? 's' : ''}
                                            </Badge>
                                        </div>
                                        <h3 className="font-semibold text-sm truncate">
                                            {formatVerticalName(v.vertical)}
                                        </h3>
                                        <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
                                            <TrendingUp className="h-3 w-3" />
                                            Avg reserve ${v.avgPrice.toFixed(2)}
                                        </div>
                                        {/* Volume bar */}
                                        <div className="mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all"
                                                style={{ width: `${Math.min((v.count / (topVerticals[0]?.count || 1)) * 100, 100)}%` }}
                                            />
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </section>

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
            </div>
        </DashboardLayout>
    );
}

export default MarketMetrics;
