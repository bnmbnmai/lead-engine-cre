/**
 * DemoResults — Full On-Chain Demo Results Page
 *
 * Displays cycle-by-cycle results with transaction links,
 * PoR status, and summary statistics.
 *
 * Route: /demo/results/:runId
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ExternalLink, ArrowLeft, Download, RotateCcw, CheckCircle2, XCircle, Loader2, Fuel, DollarSign, Activity } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import api from '@/lib/api';

const BASESCAN_TX = 'https://sepolia.basescan.org/tx/';

interface CycleResult {
    cycle: number;
    vertical: string;
    buyerWallet: string;
    bidAmount: number;
    lockIds: number[];
    winnerLockId: number;
    settleTxHash: string;
    refundTxHashes: string[];
    porSolvent: boolean;
    porTxHash: string;
    gasUsed: string;
}

interface DemoResult {
    runId: string;
    startedAt: string;
    completedAt: string;
    cycles: CycleResult[];
    totalGas: string;
    totalSettled: number;
    status: 'completed' | 'aborted' | 'failed';
    error?: string;
}

export default function DemoResults() {
    const { runId } = useParams<{ runId: string }>();
    const navigate = useNavigate();
    const [result, setResult] = useState<DemoResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!runId) return;

        const fetchResults = async () => {
            try {
                const { data, error: apiError } = await api.demoFullE2EResults(runId);
                if (apiError) {
                    setError(String(apiError));
                } else if (data?.status === 'running') {
                    setError('Demo is still running. Results will appear when complete.');
                } else {
                    setResult(data);
                }
            } catch (err: any) {
                setError(err.message || 'Failed to load results');
            } finally {
                setLoading(false);
            }
        };

        fetchResults();
    }, [runId]);

    const downloadLogs = () => {
        if (!result) return;
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `demo-results-${runId?.slice(0, 8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                        <p className="text-muted-foreground">Loading demo results...</p>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    if (error || !result) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="flex flex-col items-center gap-4 text-center">
                        <XCircle className="h-10 w-10 text-red-400" />
                        <p className="text-muted-foreground">{error || 'Results not found'}</p>
                        <button
                            onClick={() => navigate('/')}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm transition"
                        >
                            <ArrowLeft className="h-4 w-4" /> Back to Marketplace
                        </button>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    const statusColor = result.status === 'completed' ? 'text-emerald-400' : result.status === 'aborted' ? 'text-amber-400' : 'text-red-400';
    const StatusIcon = result.status === 'completed' ? CheckCircle2 : XCircle;

    return (
        <DashboardLayout>
            <div className="space-y-6 max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => navigate('/')}
                            className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                        <div>
                            <h1 className="text-xl font-bold flex items-center gap-2">
                                <StatusIcon className={`h-5 w-5 ${statusColor}`} />
                                Demo Results
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                Run {runId?.slice(0, 8)}… • {new Date(result.startedAt).toLocaleString()}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={downloadLogs}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm transition"
                        >
                            <Download className="h-3.5 w-3.5" /> Download JSON
                        </button>
                        <button
                            onClick={() => navigate('/')}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white text-sm font-medium transition"
                        >
                            <RotateCcw className="h-3.5 w-3.5" /> Run Again
                        </button>
                    </div>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="glass rounded-xl p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                            <Activity className="h-4 w-4 text-blue-400" />
                            Cycles
                        </div>
                        <p className="text-2xl font-bold">{result.cycles.length}</p>
                    </div>
                    <div className="glass rounded-xl p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                            <DollarSign className="h-4 w-4 text-emerald-400" />
                            Total Settled
                        </div>
                        <p className="text-2xl font-bold">${result.totalSettled}</p>
                    </div>
                    <div className="glass rounded-xl p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                            <Fuel className="h-4 w-4 text-amber-400" />
                            Total Gas
                        </div>
                        <p className="text-2xl font-bold text-amber-400">{BigInt(result.totalGas).toLocaleString()}</p>
                    </div>
                    <div className="glass rounded-xl p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            PoR Status
                        </div>
                        <p className={`text-2xl font-bold ${result.cycles.every(c => c.porSolvent) ? 'text-emerald-400' : 'text-red-400'}`}>
                            {result.cycles.every(c => c.porSolvent) ? 'SOLVENT' : 'ISSUE'}
                        </p>
                    </div>
                </div>

                {/* Results Table */}
                <div className="glass rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border/50 text-left">
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Cycle</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Vertical</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Bid Amount</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Lock IDs</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Settle Tx</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Refunds</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">PoR</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Gas</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.cycles.map((cycle) => (
                                    <tr key={cycle.cycle} className="border-b border-border/30 hover:bg-white/[0.02] transition">
                                        <td className="px-4 py-3 font-mono font-bold text-blue-400">#{cycle.cycle}</td>
                                        <td className="px-4 py-3">
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-400 text-xs font-medium capitalize">
                                                {cycle.vertical.replace(/_/g, ' ')}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-emerald-400">${cycle.bidAmount}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">[{cycle.lockIds.join(', ')}]</td>
                                        <td className="px-4 py-3">
                                            <a
                                                href={`${BASESCAN_TX}${cycle.settleTxHash}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition font-mono text-xs"
                                            >
                                                {cycle.settleTxHash.slice(0, 10)}…
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col gap-0.5">
                                                {cycle.refundTxHashes.map((hash, i) => (
                                                    <a
                                                        key={i}
                                                        href={`${BASESCAN_TX}${hash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-blue-400 transition font-mono text-xs"
                                                    >
                                                        {hash.slice(0, 10)}…
                                                        <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1.5">
                                                {cycle.porSolvent ? (
                                                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                                ) : (
                                                    <XCircle className="h-4 w-4 text-red-400" />
                                                )}
                                                <a
                                                    href={`${BASESCAN_TX}${cycle.porTxHash}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-muted-foreground hover:text-blue-400 transition"
                                                >
                                                    <ExternalLink className="h-3 w-3" />
                                                </a>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                            {BigInt(cycle.gasUsed).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Error message if demo failed */}
                {result.error && (
                    <div className="glass rounded-xl p-4 border border-red-500/20 bg-red-500/5">
                        <p className="text-sm text-red-400">
                            <strong>Error:</strong> {result.error}
                        </p>
                    </div>
                )}

                {/* Footer */}
                <div className="text-center text-xs text-muted-foreground pb-8">
                    DEMO MODE — Base Sepolia Testnet • All funds are recycled •
                    <a href="https://sepolia.basescan.org" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline ml-1">
                        Basescan Explorer ↗
                    </a>
                </div>
            </div>
        </DashboardLayout>
    );
}
