import { useState, useEffect, useCallback } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import {
    TrendingUp, Filter, Loader2, DollarSign, Target, Megaphone,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import api from '@/lib/api';
import { toast } from '@/hooks/useToast';

// ============================================
// Types
// ============================================

interface CampaignRow {
    utmSource: string;
    utmCampaign: string;
    utmMedium: string;
    adPlatform: string;
    totalLeads: number;
    sold: number;
    conversionRate: number;
    revenue: number;
    avgBidPrice: number;
}

interface ConversionPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// ============================================
// Chart Colors
// ============================================

const COLORS = [
    '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

// ============================================
// Ad Conversion Analytics Page
// ============================================

export default function AdConversions() {
    const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
    const [pagination, setPagination] = useState<ConversionPagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [verticalFilter, setVerticalFilter] = useState('');
    const [groupBy, setGroupBy] = useState<'campaign' | 'platform'>('campaign');

    const fetchConversions = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const params: Record<string, string> = { page: String(page), limit: '50' };
            if (startDate) params.startDate = startDate;
            if (endDate) params.endDate = endDate;
            if (verticalFilter) params.vertical = verticalFilter;

            const res = await api.getConversions(params);
            if (res.data) {
                setCampaigns(res.data.campaigns);
                setPagination(res.data.pagination);
            }
        } catch {
            toast({ title: 'Failed to load conversions', type: 'error' });
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate, verticalFilter]);

    useEffect(() => { fetchConversions(1); }, [fetchConversions]);

    // Aggregate by platform if toggle is set
    const chartData = groupBy === 'platform'
        ? Object.values(
            campaigns.reduce((acc, c) => {
                const key = c.adPlatform;
                if (!acc[key]) acc[key] = { name: key, conversionRate: 0, totalLeads: 0, sold: 0, revenue: 0, count: 0 };
                acc[key].totalLeads += c.totalLeads;
                acc[key].sold += c.sold;
                acc[key].revenue += c.revenue;
                acc[key].count++;
                return acc;
            }, {} as Record<string, any>)
        ).map((p: any) => ({
            ...p,
            conversionRate: p.totalLeads > 0 ? Math.round((p.sold / p.totalLeads) * 10000) / 100 : 0,
        }))
        : campaigns.slice(0, 15).map((c) => ({
            name: c.utmCampaign.length > 20 ? c.utmCampaign.slice(0, 18) + '…' : c.utmCampaign,
            conversionRate: c.conversionRate,
            totalLeads: c.totalLeads,
            revenue: c.revenue,
        }));

    // Summary stats
    const totalLeads = campaigns.reduce((s, c) => s + c.totalLeads, 0);
    const totalSold = campaigns.reduce((s, c) => s + c.sold, 0);
    const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0);
    const avgConversion = totalLeads > 0 ? Math.round((totalSold / totalLeads) * 10000) / 100 : 0;

    return (
        <div className="min-h-screen bg-background p-6 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Megaphone className="h-6 w-6 text-primary" />
                    Ad Conversion Analytics
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                    Track lead conversions by UTM source, campaign, and ad platform
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                            <Target className="h-3.5 w-3.5" />
                            Total Ad Leads
                        </div>
                        <div className="text-xl font-bold tabular-nums">{totalLeads.toLocaleString()}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                            <TrendingUp className="h-3.5 w-3.5" />
                            Avg Conversion
                        </div>
                        <div className="text-xl font-bold tabular-nums text-emerald-500">{avgConversion}%</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                            <DollarSign className="h-3.5 w-3.5" />
                            Total Revenue
                        </div>
                        <div className="text-xl font-bold tabular-nums">${totalRevenue.toLocaleString()}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                            <Megaphone className="h-3.5 w-3.5" />
                            Campaigns
                        </div>
                        <div className="text-xl font-bold tabular-nums">{pagination.total}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card>
                <CardContent className="pt-4">
                    <div className="flex flex-wrap items-end gap-3">
                        <div>
                            <label className="text-xs text-muted-foreground block mb-1">Start Date</label>
                            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" id="start-date" />
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground block mb-1">End Date</label>
                            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" id="end-date" />
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground block mb-1">Vertical</label>
                            <Input placeholder="e.g. solar" value={verticalFilter} onChange={(e) => setVerticalFilter(e.target.value)} className="w-40" id="vertical-filter" />
                        </div>
                        <div className="flex gap-1.5">
                            <Button size="sm" variant={groupBy === 'campaign' ? 'default' : 'outline'} onClick={() => setGroupBy('campaign')}>
                                By Campaign
                            </Button>
                            <Button size="sm" variant={groupBy === 'platform' ? 'default' : 'outline'} onClick={() => setGroupBy('platform')}>
                                By Platform
                            </Button>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => fetchConversions(1)}>
                            <Filter className="h-3.5 w-3.5 mr-1" />
                            Apply
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Chart */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Conversion Rates {groupBy === 'platform' ? 'by Platform' : 'by Campaign'}</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-16">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : chartData.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">No ad-attributed leads found.</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={320}>
                            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                                <XAxis dataKey="name" angle={-35} textAnchor="end" tick={{ fontSize: 11 }} />
                                <YAxis unit="%" tick={{ fontSize: 11 }} />
                                <Tooltip
                                    formatter={(value) => [`${value ?? 0}%`, 'Conversion Rate']}
                                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                                />
                                <Bar dataKey="conversionRate" radius={[4, 4, 0, 0]}>
                                    {chartData.map((_, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>

            {/* Table */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Campaign Details</CardTitle>
                </CardHeader>
                <CardContent>
                    {!loading && campaigns.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b text-muted-foreground">
                                        <th className="text-left py-2 px-3 font-medium">Source</th>
                                        <th className="text-left py-2 px-3 font-medium">Campaign</th>
                                        <th className="text-left py-2 px-3 font-medium">Medium</th>
                                        <th className="text-right py-2 px-3 font-medium">Leads</th>
                                        <th className="text-right py-2 px-3 font-medium">Sold</th>
                                        <th className="text-right py-2 px-3 font-medium">Conv %</th>
                                        <th className="text-right py-2 px-3 font-medium">Avg Bid</th>
                                        <th className="text-right py-2 px-3 font-medium">Revenue</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {campaigns.map((c, i) => (
                                        <tr key={i} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                                            <td className="py-2.5 px-3">{c.utmSource}</td>
                                            <td className="py-2.5 px-3 font-mono text-xs">{c.utmCampaign}</td>
                                            <td className="py-2.5 px-3 text-muted-foreground">{c.utmMedium || '—'}</td>
                                            <td className="py-2.5 px-3 text-right tabular-nums">{c.totalLeads}</td>
                                            <td className="py-2.5 px-3 text-right tabular-nums">{c.sold}</td>
                                            <td className="py-2.5 px-3 text-right tabular-nums">
                                                <span className={c.conversionRate >= 30 ? 'text-emerald-500' : c.conversionRate >= 15 ? 'text-amber-500' : 'text-muted-foreground'}>
                                                    {c.conversionRate}%
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-3 text-right tabular-nums">${c.avgBidPrice}</td>
                                            <td className="py-2.5 px-3 text-right tabular-nums font-medium">${c.revenue.toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
