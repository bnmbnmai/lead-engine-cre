import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    TrendingUp, Gavel, DollarSign, Target, ArrowUpRight,
    ArrowDownRight, Download, Filter
} from 'lucide-react';
import {
    AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, GlassCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { socketClient } from '@/lib/socket';
import { useMockData } from '@/hooks/useMockData';

const IS_PROD = import.meta.env.PROD;

const PIE_COLORS = ['#3b82f6', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#f97316'];

// ============================================
// Fallback mock data
// ============================================

// Seeded PRNG (mulberry32) — deterministic across renders
function mulberry32(seed: number) {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function generateBidHistory(days: number) {
    const rng = mulberry32(12345);
    const data = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const total = Math.floor(rng() * 12 + 1);
        const won = Math.floor(rng() * Math.min(total, 5));
        data.push({
            date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            totalBids: total,
            wonBids: won,
            spent: Math.round(won * (rng() * 100 + 40)),
        });
    }
    return data;
}

const FALLBACK_BY_VERTICAL = [
    { vertical: 'Solar', total: 38, won: 22, avgAmount: 62, color: '#f59e0b' },
    { vertical: 'Mortgage', total: 24, won: 12, avgAmount: 135, color: '#3b82f6' },
    { vertical: 'Roofing', total: 18, won: 14, avgAmount: 48, color: '#8b5cf6' },
    { vertical: 'Insurance', total: 14, won: 7, avgAmount: 95, color: '#10b981' },
    { vertical: 'Home Services', total: 10, won: 8, avgAmount: 38, color: '#ef4444' },
    { vertical: 'Real Estate', total: 8, won: 3, avgAmount: 210, color: '#06b6d4' },
];

// ============================================
// Component
// ============================================

export function BuyerAnalytics() {
    const [period, setPeriod] = useState('30d');
    const [overview, setOverview] = useState<any>(null);
    const [liveByVertical, setLiveByVertical] = useState<any[] | null>(null);
    const [apiError, setApiError] = useState(false);
    const [fetchKey, setFetchKey] = useState(0);   // bump to re-fetch

    // Reactive mock toggle — auto-updates when DemoPanel toggles
    const [useMock] = useMockData();

    const days = period === '7d' ? 7 : period === '14d' ? 14 : 30;
    const bidHistory = useMemo(() => useMock ? generateBidHistory(days) : [], [days, useMock]);

    const fetchData = useCallback(async () => {
        if (useMock) return; // skip API when mock mode is on
        try {
            const [overviewRes, bidsRes] = await Promise.all([
                api.getOverview('real'),
                api.getBidAnalytics('real'),
            ]);
            if (overviewRes.data?.stats) setOverview(overviewRes.data.stats);
            if (bidsRes.data?.byVertical) {
                setLiveByVertical(bidsRes.data.byVertical.map((v: any, i: number) => ({
                    vertical: v.vertical.charAt(0).toUpperCase() + v.vertical.slice(1).replace('_', ' '),
                    total: v.total,
                    won: v.won,
                    avgAmount: Math.round(v.avgAmount),
                    color: PIE_COLORS[i % PIE_COLORS.length],
                })));
            }
        } catch {
            if (IS_PROD) {
                setApiError(true);
            }
            // Dev: silent fallback to seeded mock
        }
    }, [period, useMock]);

    useEffect(() => { fetchData(); }, [fetchData, fetchKey]);

    // Socket: real-time analytics updates from purchases/bids
    useEffect(() => {
        if (useMock) return;
        socketClient.connect();
        const unsub = socketClient.on('analytics:update', () => {
            // Re-fetch analytics when a purchase or bid happens
            setFetchKey(k => k + 1);
        });
        return () => { unsub(); };
    }, [useMock]);

    const verticalData = useMock
        ? FALLBACK_BY_VERTICAL
        : (liveByVertical && liveByVertical.length > 0 ? liveByVertical : []);

    // Empty state detection — only when showing real data and nothing loaded
    const isEmptyRealData = !useMock && !overview && (!liveByVertical || liveByVertical.length === 0);

    const totalBidsAgg = bidHistory.reduce((sum, d) => sum + d.totalBids, 0);
    const wonBidsAgg = bidHistory.reduce((sum, d) => sum + d.wonBids, 0);
    const totalSpentAgg = bidHistory.reduce((sum, d) => sum + d.spent, 0);
    const winRateAgg = totalBidsAgg > 0 ? ((wonBidsAgg / totalBidsAgg) * 100).toFixed(1) : '0';

    const statsCards = [
        { label: `Total Bids (${period})`, value: overview?.totalBids ?? totalBidsAgg, icon: Gavel, color: 'text-primary', trend: '+5%', trendUp: true },
        { label: 'Won Bids', value: overview?.wonBids ?? wonBidsAgg, icon: Target, color: 'text-emerald-500', trend: '+12%', trendUp: true },
        { label: 'Win Rate', value: `${overview?.winRate ?? winRateAgg}%`, icon: TrendingUp, color: 'text-amber-500', trend: '+3%', trendUp: true },
        { label: `Total Spent (${period})`, value: formatCurrency(overview?.totalSpent ?? totalSpentAgg), icon: DollarSign, color: 'text-purple-500', trend: '', trendUp: true },
    ];

    const handleExportCSV = () => {
        const headers = ['Date', 'Total Bids', 'Won Bids', 'Spent (USD)'];
        const rows = bidHistory.map((d) => `${d.date},${d.totalBids},${d.wonBids},${d.spent}`);
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `buyer-analytics-${period}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Header + Controls */}
                <div className="flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <h1 className="text-3xl font-bold">Buyer Analytics</h1>
                        <p className="text-muted-foreground">Bid performance, spend insights, and winning patterns</p>
                    </div>
                    <div className="flex items-center gap-3">
                        {useMock ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                Mock Data
                            </span>
                        ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Data
                            </span>
                        )}
                        <Select value={period} onValueChange={setPeriod}>
                            <SelectTrigger className="w-28">
                                <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="7d">7 days</SelectItem>
                                <SelectItem value="14d">14 days</SelectItem>
                                <SelectItem value="30d">30 days</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-2">
                            <Download className="h-4 w-4" /> Export CSV
                        </Button>
                    </div>
                </div>

                {/* API Error Banner (prod only) */}
                {apiError && (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                        <span className="font-medium">⚠ Analytics data unavailable.</span>
                        <span className="text-muted-foreground">The API returned an error. Showing empty state — no mock data in production.</span>
                    </div>
                )}

                {/* Empty state for real data mode */}
                {isEmptyRealData && (
                    <GlassCard className="p-8 text-center">
                        <div className="text-4xl mb-3">📊</div>
                        <h3 className="text-lg font-semibold mb-1">No purchases yet</h3>
                        <p className="text-muted-foreground text-sm max-w-md mx-auto">
                            Place bids on leads in the marketplace to see real analytics here.
                            Data updates automatically when a purchase completes.
                        </p>
                    </GlassCard>
                )}

                {/* Quick Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    {statsCards.map((stat) => (
                        <GlassCard key={stat.label}>
                            <CardContent className="p-5">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                        {stat.label}
                                    </span>
                                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                                </div>
                                <div className="flex items-baseline gap-2">
                                    <p className="text-2xl font-bold">{stat.value}</p>
                                    {stat.trend && (
                                        <span className={`text-xs font-medium flex items-center gap-0.5 ${stat.trendUp ? 'text-emerald-500' : 'text-red-500'}`}>
                                            {stat.trendUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                            {stat.trend}
                                        </span>
                                    )}
                                </div>
                            </CardContent>
                        </GlassCard>
                    ))}
                </div>

                {/* Bid Activity + Spend by Vertical */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <Card className="lg:col-span-2">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg">Bid Activity Over Time</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <AreaChart data={bidHistory} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="bidGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="wonGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                                    <Tooltip
                                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', fontSize: 13 }}
                                    />
                                    <Area type="monotone" dataKey="totalBids" name="Total Bids" stroke="hsl(var(--primary))" fill="url(#bidGrad)" strokeWidth={2} />
                                    <Area type="monotone" dataKey="wonBids" name="Won Bids" stroke="#10b981" fill="url(#wonGrad)" strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg">Spend by Vertical</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={240}>
                                <PieChart>
                                    <Pie
                                        data={verticalData}
                                        dataKey="total"
                                        nameKey="vertical"
                                        innerRadius={55}
                                        outerRadius={90}
                                        paddingAngle={3}
                                    >
                                        {verticalData.map((entry, idx) => (
                                            <Cell key={entry.vertical} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', fontSize: 13 }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                                {verticalData.slice(0, 6).map((v, i) => (
                                    <div key={v.vertical} className="flex items-center gap-2 text-xs">
                                        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i] }} />
                                        <span className="text-muted-foreground truncate">{v.vertical}</span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Vertical Performance Table */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg">Bid Performance by Vertical</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border text-left">
                                        <th className="pb-3 font-medium text-muted-foreground">Vertical</th>
                                        <th className="pb-3 font-medium text-muted-foreground text-right">Total Bids</th>
                                        <th className="pb-3 font-medium text-muted-foreground text-right">Won</th>
                                        <th className="pb-3 font-medium text-muted-foreground text-right">Win Rate</th>
                                        <th className="pb-3 font-medium text-muted-foreground text-right">Avg Bid</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {verticalData.map((v, i) => (
                                        <tr key={v.vertical} className="border-b border-border/50 hover:bg-white/5 transition">
                                            <td className="py-3 flex items-center gap-2">
                                                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i] }} />
                                                {v.vertical}
                                            </td>
                                            <td className="py-3 text-right font-mono">{v.total}</td>
                                            <td className="py-3 text-right font-mono text-emerald-500">{v.won}</td>
                                            <td className="py-3 text-right">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${v.total > 0 && (v.won / v.total) >= 0.6 ? 'bg-emerald-500/20 text-emerald-500'
                                                    : v.total > 0 && (v.won / v.total) >= 0.4 ? 'bg-amber-500/20 text-amber-500'
                                                        : 'bg-red-500/20 text-red-500'
                                                    }`}>
                                                    {v.total > 0 ? Math.round((v.won / v.total) * 100) : 0}%
                                                </span>
                                            </td>
                                            <td className="py-3 text-right font-mono">{formatCurrency(v.avgAmount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>

                {/* Spending Trend */}
                <Card>
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                            <DollarSign className="h-4 w-4 text-emerald-500" />
                            <CardTitle className="text-lg">Spending Trend</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={bidHistory} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${v}`} />
                                <Tooltip
                                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', fontSize: 13 }}
                                    formatter={((value: number) => [`$${value}`, 'Spent']) as any}
                                />
                                <Bar dataKey="spent" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                        <div className="flex items-center gap-6 mt-3 text-xs text-muted-foreground">
                            <span>Total spent: <strong className="text-foreground">${totalSpentAgg.toLocaleString()}</strong></span>
                            <span>Avg/bid: <strong className="text-foreground">{formatCurrency(totalBidsAgg > 0 ? totalSpentAgg / totalBidsAgg : 0)}</strong></span>
                            <span>Win rate: <strong className="text-emerald-500">{winRateAgg}%</strong></span>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}

export default BuyerAnalytics;
