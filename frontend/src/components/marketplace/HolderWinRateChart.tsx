import { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts';

// ============================================
// Types
// ============================================

interface WinRateDataPoint {
    /** ISO date string (YYYY-MM-DD) */
    date: string;
    /** Holder win rate percentage (0-100) */
    holderWinRate: number;
    /** Non-holder win rate percentage (0-100) */
    nonHolderWinRate: number;
    /** Total auctions that day */
    totalAuctions: number;
}

interface HolderWinRateChartProps {
    /** Win rate data (last 30 days) */
    data?: WinRateDataPoint[];
    /** Chart height in px */
    height?: number;
    /** Whether chart is loading */
    loading?: boolean;
    /** Hide on mobile (default: true) */
    hideOnMobile?: boolean;
}

// ============================================
// Mock Data Generator (development only)
// ============================================

function generateMockData(days = 30): WinRateDataPoint[] {
    const data: WinRateDataPoint[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const holderWin = 55 + Math.random() * 25; // 55-80%
        data.push({
            date: d.toISOString().slice(0, 10),
            holderWinRate: Math.round(holderWin * 10) / 10,
            nonHolderWinRate: Math.round((100 - holderWin + (Math.random() * 10 - 5)) * 10) / 10,
            totalAuctions: Math.floor(3 + Math.random() * 12),
        });
    }
    return data;
}

// ============================================
// Custom Tooltip
// ============================================

function ChartTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg border border-white/10 bg-gray-900/95 p-2.5 shadow-xl text-xs space-y-1">
            <p className="font-medium text-white/80">{label}</p>
            {payload.map((entry: any) => (
                <div key={entry.dataKey} className="flex items-center gap-2">
                    <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: entry.color }}
                    />
                    <span className="text-white/60">{entry.name}:</span>
                    <span className="font-semibold" style={{ color: entry.color }}>
                        {entry.value}%
                    </span>
                </div>
            ))}
        </div>
    );
}

// ============================================
// Component
// ============================================

export function HolderWinRateChart({
    data,
    height = 200,
    loading = false,
    hideOnMobile = true,
}: HolderWinRateChartProps) {
    const chartData = useMemo(() => data || generateMockData(), [data]);

    // Compute summary stats
    const stats = useMemo(() => {
        if (!chartData.length) return null;
        const avgHolder = chartData.reduce((s, d) => s + d.holderWinRate, 0) / chartData.length;
        const avgNonHolder = chartData.reduce((s, d) => s + d.nonHolderWinRate, 0) / chartData.length;
        const totalAuctions = chartData.reduce((s, d) => s + d.totalAuctions, 0);
        return {
            avgHolder: Math.round(avgHolder * 10) / 10,
            avgNonHolder: Math.round(avgNonHolder * 10) / 10,
            advantage: Math.round((avgHolder - avgNonHolder) * 10) / 10,
            totalAuctions,
        };
    }, [chartData]);

    if (loading) {
        return (
            <div
                className="rounded-lg border border-white/5 bg-white/[0.02] p-4 animate-pulse"
                style={{ height }}
                role="progressbar"
                aria-label="Loading chart data"
            >
                <div className="h-3 w-40 bg-white/10 rounded mb-4" />
                <div className="h-full bg-white/5 rounded" />
            </div>
        );
    }

    return (
        <div
            id="holder-win-rate-chart"
            className={`rounded-lg border border-white/5 bg-white/[0.02] p-4 space-y-3 ${hideOnMobile ? 'hidden sm:block' : ''
                }`}
            role="figure"
            aria-label="Holder vs non-holder win rate chart (last 30 days)"
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white/80">
                    <TrendingUp className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                    Perk Win-Rate Analytics
                </div>
                {stats && (
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span>
                            Advantage:{' '}
                            <span className={stats.advantage > 0 ? 'text-green-400 font-semibold' : 'text-red-400'}>
                                {stats.advantage > 0 ? '+' : ''}{stats.advantage}%
                            </span>
                        </span>
                        <span className="text-white/30">|</span>
                        <span>{stats.totalAuctions} auctions</span>
                    </div>
                )}
            </div>

            {/* Chart */}
            <ResponsiveContainer width="100%" height={height}>
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                        <linearGradient id="holderGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="nonHolderGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
                        tickFormatter={(v: string) => v.slice(5)} // MM-DD
                        axisLine={false}
                        tickLine={false}
                    />
                    <YAxis
                        tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
                        tickFormatter={(v: number) => `${v}%`}
                        domain={[0, 100]}
                        axisLine={false}
                        tickLine={false}
                    />
                    <RechartsTooltip content={<ChartTooltip />} />
                    <Legend
                        wrapperStyle={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}
                        iconSize={8}
                    />
                    <Area
                        type="monotone"
                        dataKey="holderWinRate"
                        name="Holders"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        fill="url(#holderGrad)"
                        dot={false}
                        activeDot={{ r: 3, strokeWidth: 0, fill: '#f59e0b' }}
                    />
                    <Area
                        type="monotone"
                        dataKey="nonHolderWinRate"
                        name="Non-Holders"
                        stroke="#6366f1"
                        strokeWidth={1.5}
                        fill="url(#nonHolderGrad)"
                        dot={false}
                        activeDot={{ r: 3, strokeWidth: 0, fill: '#6366f1' }}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

export default HolderWinRateChart;
