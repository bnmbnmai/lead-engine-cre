import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, TrendingUp, Activity, Zap } from 'lucide-react';
import { api } from '@/lib/api';

interface AgentDashboardData {
    profile: { displayName: string; reputationScore: number; wins: number; settlements: number } | null;
    strategies: Array<{ id: string; name: string; status: string; currentVersion: number }>;
    recentTraces: Array<{ id: string; leadId: string; bidsPlaced: number; trigger: string; createdAt: string }>;
}

export default function AgentDashboard() {
    const [data, setData] = useState<AgentDashboardData | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        api.apiFetch<AgentDashboardData>('/api/v1/agent/me')
            .then((r) => {
                if (r.error) throw new Error(r.error.error);
                setData(r.data!);
            })
            .catch((e) => setError(e.message || 'Failed to load agent dashboard'));
    }, []);

    if (error) {
        return (
            <div className="container mx-auto p-6">
                <p className="text-red-400">{error}</p>
                <Link to="/buyer" className="text-blue-400 underline mt-2">Back to dashboard</Link>
            </div>
        );
    }

    if (!data) return <div className="container mx-auto p-6 text-muted-foreground">Loading agent dashboard…</div>;

    const winRate = data.profile && data.profile.settlements > 0
        ? Math.round((data.profile.wins / data.profile.settlements) * 100)
        : 0;

    return (
        <div className="container mx-auto p-6 space-y-8">
            <div className="flex items-center gap-3">
                <Bot className="h-8 w-8 text-blue-400" />
                <div>
                    <h1 className="text-2xl font-bold">Agent Dashboard</h1>
                    <p className="text-muted-foreground text-sm">
                        {data.profile?.displayName ?? 'Not registered'} — deterministic strategies, audited decisions
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border bg-card p-4">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm"><TrendingUp className="h-4 w-4" /> Win rate</div>
                    <div className="text-3xl font-bold mt-1">{winRate}%</div>
                </div>
                <div className="rounded-xl border bg-card p-4">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm"><Zap className="h-4 w-4" /> Active strategies</div>
                    <div className="text-3xl font-bold mt-1">{data.strategies.filter((s) => s.status === 'ACTIVE').length}</div>
                </div>
                <div className="rounded-xl border bg-card p-4">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm"><Activity className="h-4 w-4" /> Reputation</div>
                    <div className="text-3xl font-bold mt-1">{data.profile?.reputationScore ?? 0}</div>
                </div>
            </div>

            <div className="flex gap-3">
                <Link to={import.meta.env.VITE_AGENTRTB_MODE === 'true' ? '/status/simulate' : '/agent/simulate'} className="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm font-medium">
                    Run simulation
                </Link>
                {!import.meta.env.VITE_AGENTRTB_MODE && (
                    <Link to="/buyer/preferences" className="rounded-lg border px-4 py-2 text-sm">
                        Auto-bid rules
                    </Link>
                )}
                <a href={`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/swagger`} className="rounded-lg border px-4 py-2 text-sm" target="_blank" rel="noreferrer">
                    API docs
                </a>
            </div>

            <section>
                <h2 className="text-lg font-semibold mb-3">Strategies</h2>
                <div className="space-y-2">
                    {data.strategies.map((s) => (
                        <div key={s.id} className="rounded-lg border p-3 flex justify-between items-center">
                            <span>{s.name} <span className="text-muted-foreground text-sm">v{s.currentVersion}</span></span>
                            <span className="text-xs uppercase tracking-wide text-muted-foreground">{s.status}</span>
                        </div>
                    ))}
                    {data.strategies.length === 0 && <p className="text-muted-foreground text-sm">No strategies yet.</p>}
                </div>
            </section>

            <section>
                <h2 className="text-lg font-semibold mb-3">Recent decisions</h2>
                <div className="space-y-2" aria-live="polite">
                    {data.recentTraces.map((t) => (
                        <div key={t.id} className="rounded-lg border p-3 text-sm">
                            <span className="font-mono text-xs">{t.leadId.slice(0, 8)}…</span>
                            <span className="mx-2 text-muted-foreground">{t.trigger}</span>
                            <span>{t.bidsPlaced} bid(s)</span>
                        </div>
                    ))}
                    {data.recentTraces.length === 0 && <p className="text-muted-foreground text-sm">No traces yet.</p>}
                </div>
            </section>
        </div>
    );
}
