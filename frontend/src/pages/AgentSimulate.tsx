import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';

export default function AgentSimulatePage() {
    const [strategyId, setStrategyId] = useState('');
    const [report, setReport] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const run = async () => {
        setLoading(true);
        setError('');
        try {
            const r = await api.apiFetch('/api/v1/agent/simulate', {
                method: 'POST',
                body: JSON.stringify({ strategyId, days: 30, limit: 50 }),
            });
            if (r.error) throw new Error(r.error.error);
            setReport(r.data);
        } catch (e: any) {
            setError(e.message || 'Simulation failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div>
                <Link to="/agent" className="text-sm text-blue-400 hover:underline">← Agent dashboard</Link>
                <h1 className="text-2xl font-bold mt-2">Strategy simulation</h1>
                <p className="text-muted-foreground text-sm">Deterministic replay — no bids placed</p>
            </div>

            <div className="flex gap-3 items-end">
                <div>
                    <label className="text-xs text-muted-foreground">Strategy ID</label>
                    <input
                        className="mt-1 rounded-lg border bg-background px-3 py-2 w-80 font-mono text-sm"
                        value={strategyId}
                        onChange={(e) => setStrategyId(e.target.value)}
                        placeholder="clx..."
                    />
                </div>
                <button
                    onClick={run}
                    disabled={loading || !strategyId}
                    className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 text-sm"
                >
                    {loading ? 'Running…' : 'Simulate 30 days'}
                </button>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            {report && (
                <div className="rounded-xl border p-6 space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div><div className="text-muted-foreground">Leads</div><div className="text-2xl font-bold">{report.leadsEvaluated}</div></div>
                        <div><div className="text-muted-foreground">Would bid</div><div className="text-2xl font-bold text-green-400">{report.wouldBid}</div></div>
                        <div><div className="text-muted-foreground">Would skip</div><div className="text-2xl font-bold">{report.wouldSkip}</div></div>
                        <div><div className="text-muted-foreground">Est. spend</div><div className="text-2xl font-bold">${report.estimatedSpend}</div></div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Avg bid ${report.avgBidAmount} · version {report.strategyVersion}
                    </p>
                </div>
            )}
        </div>
    );
}
