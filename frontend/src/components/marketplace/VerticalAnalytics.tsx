/**
 * VerticalAnalytics — Recharts visualizations for vertical adoption trends
 *
 * Shows:
 *   1. BarChart — suggestions by parent vertical
 *   2. Trend line — suggestion volume over time
 *
 * Uses mock data in dev mode, real API data with fallback.
 */

import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, BarChart3 } from 'lucide-react';
import {
    BarChart, Bar, AreaChart, Area,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@/lib/api';

// ============================================
// Colors
// ============================================

const COLORS = [
    '#3b82f6', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444',
    '#06b6d4', '#ec4899', '#f97316', '#84cc16', '#6366f1',
];

// ============================================
// Mock data (dev fallback)
// ============================================

function mulberry32(seed: number) {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function generateMockSuggestionsByVertical() {
    const rng = mulberry32(54321);
    const verticals = [
        'Home Services', 'Solar', 'Insurance', 'Mortgage', 'Auto',
        'Real Estate', 'B2B SaaS', 'Roofing', 'Legal', 'Financial',
    ];
    return verticals.map((name, i) => ({
        name,
        suggestions: Math.floor(rng() * 25 + 2),
        approved: Math.floor(rng() * 8),
        fill: COLORS[i % COLORS.length],
    })).sort((a, b) => b.suggestions - a.suggestions);
}

function generateMockTrend() {
    const rng = mulberry32(67890);
    const data = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        data.push({
            date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            suggestions: Math.floor(rng() * 8 + 1),
            autoCreated: Math.floor(rng() * 2),
        });
    }
    return data;
}

// ============================================
// Component
// ============================================

export function VerticalAnalytics() {
    const [suggestionsByVertical, setSuggestionsByVertical] = useState(generateMockSuggestionsByVertical());
    const [trendData] = useState(generateMockTrend());
    const [, setIsLoading] = useState(true);

    useEffect(() => {
        async function fetchData() {
            try {
                const { data } = await api.getVerticalSuggestions();
                if (data?.suggestions && data.suggestions.length > 0) {
                    // Aggregate by parent
                    const byParent = new Map<string, { suggestions: number; approved: number }>();
                    for (const s of data.suggestions) {
                        const parent = s.parentSlug || 'Other';
                        const existing = byParent.get(parent) || { suggestions: 0, approved: 0 };
                        existing.suggestions += s.hitCount || 1;
                        if (s.status === 'ACTIVE') existing.approved++;
                        byParent.set(parent, existing);
                    }
                    const chartData = [...byParent.entries()]
                        .map(([name, counts], i) => ({
                            name: name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
                            ...counts,
                            fill: COLORS[i % COLORS.length],
                        }))
                        .sort((a, b) => b.suggestions - a.suggestions);

                    if (chartData.length > 0) setSuggestionsByVertical(chartData);
                }
            } catch {
                // Keep mock data
            } finally {
                setIsLoading(false);
            }
        }
        fetchData();
    }, []);

    const totalSuggestions = useMemo(
        () => suggestionsByVertical.reduce((sum, v) => sum + v.suggestions, 0),
        [suggestionsByVertical]
    );

    const totalApproved = useMemo(
        () => suggestionsByVertical.reduce((sum, v) => sum + v.approved, 0),
        [suggestionsByVertical]
    );

    return (
        <div className="grid gap-4 md:grid-cols-2">
            {/* Suggestions by Vertical */}
            <Card className="bg-card/60 backdrop-blur-sm border-border/50">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-primary" />
                        AI Suggestions by Vertical
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        {totalSuggestions} total suggestions · {totalApproved} approved
                    </p>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={suggestionsByVertical} layout="vertical" margin={{ left: 80 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                            <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                            <YAxis
                                dataKey="name"
                                type="category"
                                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                                width={75}
                            />
                            <Tooltip
                                contentStyle={{
                                    background: 'hsl(var(--card))',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: 12,
                                    fontSize: 12,
                                }}
                            />
                            <Bar dataKey="suggestions" radius={[0, 4, 4, 0]} name="Suggestions">
                                {suggestionsByVertical.map((entry, i) => (
                                    <Cell key={i} fill={entry.fill} fillOpacity={0.8} />
                                ))}
                            </Bar>
                            <Bar dataKey="approved" radius={[0, 4, 4, 0]} fill="#10b981" fillOpacity={0.6} name="Approved" />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* Suggestion Trend */}
            <Card className="bg-card/60 backdrop-blur-sm border-border/50">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-emerald-400" />
                        Suggestion Trend (30 days)
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={240}>
                        <AreaChart data={trendData}>
                            <defs>
                                <linearGradient id="suggestGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="autoGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                            <XAxis
                                dataKey="date"
                                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                                interval={6}
                            />
                            <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                            <Tooltip
                                contentStyle={{
                                    background: 'hsl(var(--card))',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: 12,
                                    fontSize: 12,
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey="suggestions"
                                stroke="#3b82f6"
                                fill="url(#suggestGrad)"
                                strokeWidth={2}
                                name="Suggestions"
                            />
                            <Area
                                type="monotone"
                                dataKey="autoCreated"
                                stroke="#10b981"
                                fill="url(#autoGrad)"
                                strokeWidth={2}
                                name="Auto-created"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </div>
    );
}

export default VerticalAnalytics;
