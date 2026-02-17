/**
 * FunnelMetricsBar — Top-level KPI cards for the My Funnels page
 *
 * Fetches from api.getOverview('real') → renders 4 metric cards:
 * - Leads Today
 * - Revenue (30d)
 * - Active Funnels
 * - Avg Conversion Rate
 *
 * Responsive: 4-col grid on desktop, 2×2 on mobile.
 */

import { useState, useEffect } from 'react';
import { TrendingUp, Users, DollarSign, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

// ── Types ──────────────────────────────

interface MetricCardProps {
    icon: React.ElementType;
    iconColor: string;
    label: string;
    value: string;
    sub?: string;
    loading?: boolean;
}

// ── MetricCard ──────────────────────────────

function MetricCard({ icon: Icon, iconColor, label, value, sub, loading }: MetricCardProps) {
    return (
        <div
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-all"
            aria-live="polite"
        >
            <div className={cn('p-2 rounded-lg', iconColor)}>
                <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
                {loading ? (
                    <div className="h-5 w-16 rounded bg-muted/50 animate-pulse mt-0.5" />
                ) : (
                    <>
                        <p className="text-lg font-bold text-foreground tabular-nums leading-tight">{value}</p>
                        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
                    </>
                )}
            </div>
        </div>
    );
}

// ── Component ──────────────────────────────

export function FunnelMetricsBar() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.getOverview('real')
            .then(res => {
                if (res.data) setData(res.data);
            })
            .catch(() => { /* graceful fallback — cards render "—" */ })
            .finally(() => setLoading(false));
    }, []);

    const fmt = (n?: number) => {
        if (n == null) return '—';
        if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000) return n >= 10_000 ? `${(n / 1_000).toFixed(0)}k` : n.toLocaleString();
        return n.toString();
    };

    const pct = (n?: number) => n != null ? `${n.toFixed(1)}%` : '—';

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
                icon={Users}
                iconColor="bg-blue-500/10 text-blue-400"
                label="Leads Today"
                value={fmt(data?.leadsToday ?? data?.totalLeads)}
                loading={loading}
            />
            <MetricCard
                icon={DollarSign}
                iconColor="bg-green-500/10 text-green-400"
                label="Revenue (30d)"
                value={data?.revenue30d != null ? `$${fmt(data.revenue30d)}` : '—'}
                loading={loading}
            />
            <MetricCard
                icon={BarChart3}
                iconColor="bg-purple-500/10 text-purple-400"
                label="Active Funnels"
                value={fmt(data?.activeFunnels ?? data?.activeVerticals)}
                loading={loading}
            />
            <MetricCard
                icon={TrendingUp}
                iconColor="bg-amber-500/10 text-amber-400"
                label="Conversion Rate"
                value={pct(data?.conversionRate)}
                loading={loading}
            />
        </div>
    );
}

export default FunnelMetricsBar;
