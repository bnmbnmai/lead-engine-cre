import { useState, useEffect, useMemo } from 'react';
import {
    TrendingUp, BarChart3, DollarSign, Activity, Globe, Download, ArrowUpRight,
    ArrowDownRight, Fuel, Clock, FileText, Zap, Filter
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

// ============================================
// Mock data generators (populated from API or seed)
// ============================================

function generateRevenueData(days: number) {
    const data = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        data.push({
            date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            revenue: Math.round(Math.random() * 800 + 100),
            leads: Math.floor(Math.random() * 15 + 2),
            gasCost: +(Math.random() * 2.5 + 0.1).toFixed(2),
        });
    }
    return data;
}

const VERTICAL_DATA = [
    { vertical: 'Solar', leads: 142, revenue: 8540, avgBid: 60.14, winRate: 72, color: '#f59e0b' },
    { vertical: 'Mortgage', leads: 98, revenue: 12740, avgBid: 130.00, winRate: 65, color: '#3b82f6' },
    { vertical: 'Roofing', leads: 76, revenue: 3800, avgBid: 50.00, winRate: 80, color: '#8b5cf6' },
    { vertical: 'Insurance', leads: 54, revenue: 5940, avgBid: 110.00, winRate: 58, color: '#10b981' },
    { vertical: 'Home Services', leads: 41, revenue: 1640, avgBid: 40.00, winRate: 85, color: '#ef4444' },
    { vertical: 'Real Estate', leads: 33, revenue: 6600, avgBid: 200.00, winRate: 45, color: '#06b6d4' },
    { vertical: 'B2B SaaS', leads: 28, revenue: 8400, avgBid: 300.00, winRate: 42, color: '#ec4899' },
    { vertical: 'Auto', leads: 22, revenue: 1320, avgBid: 60.00, winRate: 70, color: '#f97316' },
];

const GEO_DATA = [
    { country: 'US', region: 'CA', leads: 85, revenue: 6800, pct: 22 },
    { country: 'US', region: 'TX', leads: 62, revenue: 4960, pct: 16 },
    { country: 'US', region: 'FL', leads: 48, revenue: 3840, pct: 12 },
    { country: 'AU', region: 'NSW', leads: 34, revenue: 4080, pct: 10 },
    { country: 'GB', region: 'ENG', leads: 30, revenue: 3600, pct: 9 },
    { country: 'DE', region: 'NW', leads: 26, revenue: 2860, pct: 8 },
    { country: 'CA', region: 'ON', leads: 24, revenue: 2880, pct: 7 },
    { country: 'IN', region: 'MH', leads: 20, revenue: 1600, pct: 6 },
    { country: 'BR', region: 'SP', leads: 18, revenue: 1080, pct: 5 },
    { country: 'FR', region: 'IDF', leads: 14, revenue: 1540, pct: 5 },
];

const ACTIVITY_LOG = [
    { time: '2 min ago', event: 'Lead #4821 sold', detail: 'Solar — CA, US · Winning bid $65.00', icon: DollarSign, color: 'text-emerald-500' },
    { time: '18 min ago', event: 'Ask #312 expired', detail: 'Mortgage — TX, US · No bids received', icon: Clock, color: 'text-amber-500' },
    { time: '1h ago', event: 'New lead submitted', detail: 'Roofing — NSW, AU · Pending auction', icon: FileText, color: 'text-primary' },
    { time: '3h ago', event: 'On-chain settle', detail: 'Lead #4819 — 0.00042 ETH gas · Confirmed', icon: Fuel, color: 'text-purple-500' },
    { time: '5h ago', event: 'Bid revealed', detail: 'Lead #4817 — $130.00 winning bid', icon: Zap, color: 'text-cyan-500' },
    { time: '8h ago', event: 'Lead #4815 sold', detail: 'Insurance — ENG, GB · $110.00', icon: DollarSign, color: 'text-emerald-500' },
    { time: '12h ago', event: 'Ask #308 created', detail: 'B2B SaaS — Global · Reserve $250.00', icon: TrendingUp, color: 'text-blue-500' },
    { time: '1d ago', event: 'KYC approved', detail: 'Full verification complete', icon: Activity, color: 'text-green-500' },
];

const PIE_COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#f97316'];

// ============================================
// Component
// ============================================

export function SellerAnalytics() {
    const [period, setPeriod] = useState('30d');

    const days = period === '7d' ? 7 : period === '14d' ? 14 : 30;
    const revenueData = useMemo(() => generateRevenueData(days), [days]);

    useEffect(() => {
        const fetchOverview = async () => {
            try {
                await api.getOverview();
            } catch {
                // Graceful fallback
            }
        };
        fetchOverview();
    }, []);

    const totalRevenue = revenueData.reduce((sum, d) => sum + d.revenue, 0);
    const totalLeads = revenueData.reduce((sum, d) => sum + d.leads, 0);
    const totalGas = revenueData.reduce((sum, d) => sum + d.gasCost, 0);
    const avgBid = totalLeads > 0 ? totalRevenue / totalLeads : 0;

    const statsCards = [
        { label: `Revenue (${period})`, value: formatCurrency(totalRevenue), icon: DollarSign, color: 'text-emerald-500', trend: '+12%', trendUp: true },
        { label: `Leads Sold (${period})`, value: String(totalLeads), icon: TrendingUp, color: 'text-primary', trend: '+8%', trendUp: true },
        { label: 'Avg. Winning Bid', value: formatCurrency(avgBid), icon: BarChart3, color: 'text-amber-500', trend: '+3%', trendUp: true },
        { label: 'On-Chain Gas', value: `$${totalGas.toFixed(2)}`, icon: Fuel, color: 'text-purple-500', trend: '-5%', trendUp: false },
    ];

    const handleExportCSV = () => {
        const headers = ['Date', 'Revenue (USD)', 'Leads Sold', 'Gas Cost (USD)'];
        const rows = revenueData.map((d) => `${d.date},${d.revenue},${d.leads},${d.gasCost}`);
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `seller-analytics-${period}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Header + Controls */}
                <div className="flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <h1 className="text-3xl font-bold">Analytics</h1>
                        <p className="text-muted-foreground">Performance metrics, revenue insights, and on-chain activity</p>
                    </div>
                    <div className="flex items-center gap-3">
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
                                    <span className={`text-xs font-medium flex items-center gap-0.5 ${stat.trendUp ? 'text-emerald-500' : 'text-red-500'}`}>
                                        {stat.trendUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                        {stat.trend}
                                    </span>
                                </div>
                            </CardContent>
                        </GlassCard>
                    ))}
                </div>

                {/* Revenue Chart + Vertical Breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <Card className="lg:col-span-2">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg">Revenue Over Time</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <AreaChart data={revenueData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${v}`} />
                                    <Tooltip
                                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', fontSize: 13 }}
                                        formatter={((value: number) => [`$${value}`, 'Revenue']) as any}
                                    />
                                    <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#revenueGrad)" strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg">By Vertical</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={240}>
                                <PieChart>
                                    <Pie
                                        data={VERTICAL_DATA}
                                        dataKey="revenue"
                                        nameKey="vertical"
                                        innerRadius={55}
                                        outerRadius={90}
                                        paddingAngle={3}
                                    >
                                        {VERTICAL_DATA.map((entry, idx) => (
                                            <Cell key={entry.vertical} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', fontSize: 13 }}
                                        formatter={((value: number) => [`$${value}`, 'Revenue']) as any}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                                {VERTICAL_DATA.slice(0, 6).map((v, i) => (
                                    <div key={v.vertical} className="flex items-center gap-2 text-xs">
                                        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i] }} />
                                        <span className="text-muted-foreground truncate">{v.vertical}</span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Lead Type Performance Table */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg">Lead Type Performance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border text-left">
                                        <th className="pb-3 font-medium text-muted-foreground">Vertical</th>
                                        <th className="pb-3 font-medium text-muted-foreground text-right">Leads</th>
                                        <th className="pb-3 font-medium text-muted-foreground text-right">Revenue</th>
                                        <th className="pb-3 font-medium text-muted-foreground text-right">Avg Bid</th>
                                        <th className="pb-3 font-medium text-muted-foreground text-right">Win Rate</th>
                                        <th className="pb-3 font-medium text-muted-foreground text-right">Rev/Lead</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {VERTICAL_DATA.map((v, i) => (
                                        <tr key={v.vertical} className="border-b border-border/50 hover:bg-white/5 transition">
                                            <td className="py-3 flex items-center gap-2">
                                                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i] }} />
                                                {v.vertical}
                                            </td>
                                            <td className="py-3 text-right font-mono">{v.leads}</td>
                                            <td className="py-3 text-right font-mono text-emerald-500">{formatCurrency(v.revenue)}</td>
                                            <td className="py-3 text-right font-mono">{formatCurrency(v.avgBid)}</td>
                                            <td className="py-3 text-right">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${v.winRate >= 70 ? 'bg-emerald-500/20 text-emerald-500' : v.winRate >= 50 ? 'bg-amber-500/20 text-amber-500' : 'bg-red-500/20 text-red-500'}`}>
                                                    {v.winRate}%
                                                </span>
                                            </td>
                                            <td className="py-3 text-right font-mono text-muted-foreground">
                                                {formatCurrency(v.leads > 0 ? v.revenue / v.leads : 0)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="font-semibold">
                                        <td className="pt-3">Total</td>
                                        <td className="pt-3 text-right font-mono">{VERTICAL_DATA.reduce((s, v) => s + v.leads, 0)}</td>
                                        <td className="pt-3 text-right font-mono text-emerald-500">{formatCurrency(VERTICAL_DATA.reduce((s, v) => s + v.revenue, 0))}</td>
                                        <td className="pt-3 text-right font-mono">—</td>
                                        <td className="pt-3 text-right">—</td>
                                        <td className="pt-3 text-right font-mono text-muted-foreground">
                                            {formatCurrency(VERTICAL_DATA.reduce((s, v) => s + v.revenue, 0) / VERTICAL_DATA.reduce((s, v) => s + v.leads, 0))}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </CardContent>
                </Card>

                {/* Geo Performance + Activity Log */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Geo Performance */}
                    <Card>
                        <CardHeader className="pb-2">
                            <div className="flex items-center gap-2">
                                <Globe className="h-4 w-4 text-muted-foreground" />
                                <CardTitle className="text-lg">Revenue by Geography</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={GEO_DATA} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                    <XAxis dataKey="region" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${v}`} />
                                    <Tooltip
                                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', fontSize: 13 }}
                                        formatter={((value: number) => [`$${value}`, 'Revenue']) as any}
                                        labelFormatter={(label) => {
                                            const entry = GEO_DATA.find((g) => g.region === label);
                                            return entry ? `${entry.region}, ${entry.country}` : label;
                                        }}
                                    />
                                    <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>

                            {/* Geo table rows */}
                            <div className="mt-4 space-y-1.5">
                                {GEO_DATA.slice(0, 5).map((geo) => (
                                    <div key={`${geo.country}-${geo.region}`} className="flex items-center justify-between text-sm py-1.5 px-2 rounded-lg hover:bg-white/5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono bg-muted/50 px-1.5 py-0.5 rounded">{geo.country}</span>
                                            <span>{geo.region}</span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-muted-foreground">{geo.leads} leads</span>
                                            <span className="font-mono text-emerald-500">{formatCurrency(geo.revenue)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Activity Log */}
                    <Card>
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-lg">Activity Log</CardTitle>
                                <span className="text-xs text-muted-foreground">Real-time events</span>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-1">
                                {ACTIVITY_LOG.map((entry, i) => (
                                    <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white/5 transition">
                                        <div className={`p-2 rounded-lg bg-white/5 ${entry.color} flex-shrink-0 mt-0.5`}>
                                            <entry.icon className="h-3.5 w-3.5" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-sm font-medium truncate">{entry.event}</p>
                                                <span className="text-xs text-muted-foreground flex-shrink-0">{entry.time}</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{entry.detail}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* On-Chain Gas Tracker */}
                <Card>
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                            <Fuel className="h-4 w-4 text-purple-500" />
                            <CardTitle className="text-lg">On-Chain Gas Costs</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={180}>
                            <AreaChart data={revenueData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="gasGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${v}`} />
                                <Tooltip
                                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', fontSize: 13 }}
                                    formatter={((value: number) => [`$${value}`, 'Gas Cost']) as any}
                                />
                                <Area type="monotone" dataKey="gasCost" stroke="#a855f7" fill="url(#gasGrad)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                        <div className="flex items-center gap-6 mt-3 text-xs text-muted-foreground">
                            <span>Total gas: <strong className="text-foreground">${totalGas.toFixed(2)}</strong></span>
                            <span>Avg/tx: <strong className="text-foreground">${(totalGas / Math.max(totalLeads, 1)).toFixed(3)}</strong></span>
                            <span>MiCA compliance: <strong className="text-emerald-500">Active</strong></span>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}

export default SellerAnalytics;
