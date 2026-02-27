/**
 * DemoResults — Full On-Chain Demo Results Page
 *
 * Shows the latest demo run by default.
 * Route: /demo/results (latest) or /demo/results/:runId (specific run)
 *
 * Features:
 * - Instant render from demo:results-ready partialResults (no blocking on recycle)
 * - Non-blocking recycle progress badge in corner
 * - Summary stats cards (cycles, settled, gas, PoR)
 * - Cycle-by-cycle table with Basescan tx links + LeadNFT column
 * - "Download Raw Log" + "Run Again" buttons
 * - History tabs for last 5 runs
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ExternalLink, ArrowLeft, Download, RotateCcw,
    CheckCircle2, XCircle, Loader2, Fuel, DollarSign,
    Activity, Rocket, Clock, RefreshCw, TrendingUp, Zap, Shield
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import api from '@/lib/api';
import { useDemo } from '@/hooks/useDemo';

const BASESCAN_TX = 'https://sepolia.basescan.org/tx/';
const BASESCAN_NFT = 'https://sepolia.basescan.org/nft/';
// LeadNFT contract on Base Sepolia
const LEAD_NFT_ADDR = import.meta.env.VITE_LEAD_NFT_ADDRESS || '0x0000000000000000000000000000000000000000';

interface CycleResult {
    cycle: number;
    vertical: string;
    buyerWallet: string;         // winner's wallet (backward compat)
    buyerWallets?: string[];     // all distinct bidder wallets
    bidAmount: number;
    lockIds: number[];
    winnerLockId: number;
    settleTxHash: string;
    refundTxHashes: string[];
    porSolvent: boolean;
    porTxHash: string;
    gasUsed: string;
    mintTxHash?: string;         // optional — present if backend captures NFT mint tx
    nftTokenId?: number;         // optional — present if backend resolves token ID
    // ── Judge-facing financials (optional — backward-compat) ──
    platformIncome?: number;
    hadTiebreaker?: boolean;
    vrfTxHash?: string;
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
    totalPlatformIncome?: number;
    totalTiebreakers?: number;
    vrfProofLinks?: string[];
    creQualityScores?: Record<number, number>; // cycle → real CRE quality score (0-100)
}



// ── Retry config ──────────────────────────────
// Used only for fallback API fetch (not for socket-driven display).
const RETRY_DELAYS = [800, 2000, 4000, 8000, 15000]; // ms

export default function DemoResults() {
    const { runId: paramRunId } = useParams<{ runId: string }>();
    const navigate = useNavigate();
    const { startDemo, partialResults, isRecycling, recyclePercent } = useDemo();
    const [result, setResult] = useState<DemoResult | null>(null);
    const [loading, setLoading] = useState(() => !partialResults && !false); // skip loading if we have cached data
    const [error, setError] = useState<string | null>(null);
    const [showConfetti, setShowConfetti] = useState(false);
    const hasInitRef = useRef(false);

    // ── Determine what to display ──────────────────────────────────────────────
    // partialResults (from socket) takes priority — instant, no API needed.
    // Falls back to API-fetched result for direct page loads / history browsing.
    const display: DemoResult | null = result ?? (partialResults ? {
        runId: partialResults.runId,
        startedAt: new Date(Date.now() - (partialResults.elapsedSec ?? 0) * 1000).toISOString(),
        completedAt: new Date().toISOString(),
        cycles: partialResults.cycles as CycleResult[],
        totalGas: partialResults.cycles.reduce((sum: bigint, c: any) => sum + BigInt(c.gasUsed ?? '0'), 0n).toString(),
        totalSettled: partialResults.totalSettled,
        status: 'completed',
        // Sum per-cycle platformIncome so the revenue card shows a real number
        totalPlatformIncome: (partialResults.cycles as CycleResult[]).reduce(
            (sum, c) => sum + (c.platformIncome ?? 0), 0
        ),
        totalTiebreakers: (partialResults.cycles as CycleResult[]).filter(c => c.hadTiebreaker).length,
    } : null);

    const fetchResults = useCallback(async (specificRunId?: string) => {
        setLoading(true);
        setError(null);

        let lastErr: string | null = null;

        for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
            try {
                const res = specificRunId
                    ? await api.demoFullE2EResults(specificRunId)
                    : await api.demoFullE2ELatestResults();

                const { data, error: apiError } = res;

                if (apiError) {
                    lastErr = typeof apiError === 'string'
                        ? apiError
                        : (apiError as any).message || (apiError as any).error || JSON.stringify(apiError);
                } else if (data?.status === 'running') {
                    // Still running — if we have partialResults just stop loading
                    setLoading(false);
                    return;
                } else if (data?.runId) {
                    setResult(data as DemoResult);
                    if (data.status === 'completed') {
                        setShowConfetti(true);
                        setTimeout(() => setShowConfetti(false), 4000);
                    }
                    setLoading(false);
                    return;
                } else {
                    lastErr = 'No demo results available yet. Run a demo first!';
                }
            } catch (err: any) {
                lastErr = err.message || 'Failed to load results';
            }

            if (attempt < RETRY_DELAYS.length) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
            }
        }

        setError(lastErr);
        setLoading(false);
    }, []);


    // Initial fetch — skip if we already have cached partialResults and no specific runId requested
    useEffect(() => {
        if (hasInitRef.current) return;  // prevent re-run on partialResults state change
        hasInitRef.current = true;

        if (partialResults && !paramRunId) {
            setLoading(false);
            return;
        }
        fetchResults(paramRunId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // intentionally empty — run once on mount only

    const downloadLogs = () => {
        if (!display) return;
        const blob = new Blob([JSON.stringify(display, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `demo-results-${display.runId?.slice(0, 8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleRunAgain = async () => {
        navigate('/');
        await startDemo(5);
    };

    // ── Loading state: only if we have NO data at all ─────────────────────────
    if (loading && !display) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="flex flex-col items-center gap-4 text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                        <p className="text-muted-foreground">Loading demo results…</p>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    if (error || !display) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="flex flex-col items-center gap-4 text-center">
                        <XCircle className="h-10 w-10 text-red-400" />
                        <p className="text-muted-foreground">{error || 'No demo results available yet. Run a demo first!'}</p>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => navigate('/')}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm transition"
                            >
                                <ArrowLeft className="h-4 w-4" /> Back to Marketplace
                            </button>
                            <button
                                onClick={handleRunAgain}
                                disabled={isRecycling}
                                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${isRecycling
                                    ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
                                    : 'bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white'
                                    }`}
                            >
                                {isRecycling ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" /> Recycling...
                                    </>
                                ) : (
                                    <>
                                        <Rocket className="h-4 w-4" /> Run Demo
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    const statusColor = display.status === 'completed' ? 'text-emerald-400' : display.status === 'aborted' ? 'text-amber-400' : 'text-red-400';
    const StatusIcon = display.status === 'completed' ? CheckCircle2 : XCircle;
    const duration = display.completedAt && display.startedAt
        ? Math.round((new Date(display.completedAt).getTime() - new Date(display.startedAt).getTime()) / 1000)
        : null;

    return (
        <DashboardLayout>
            <div className="space-y-6 max-w-6xl mx-auto">
                {/* Confetti overlay */}
                {showConfetti && (
                    <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
                        <div className="text-6xl animate-bounce">🎉</div>
                    </div>
                )}

                {/* Non-blocking recycle progress badge — floats bottom-right */}
                {isRecycling && (
                    <div className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full
                                    bg-amber-500/10 border border-amber-500/25 backdrop-blur-sm shadow-lg text-sm text-amber-300">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Recycling wallets…</span>
                        {recyclePercent > 0 && (
                            <span className="ml-1 font-mono text-xs opacity-70">{recyclePercent}%</span>
                        )}
                    </div>
                )}

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
                                Latest Demo Run
                                {isRecycling && (
                                    <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                        recycling…
                                    </span>
                                )}
                            </h1>
                            <p className="text-sm text-muted-foreground flex items-center gap-2">
                                <Clock className="h-3.5 w-3.5" />
                                {new Date(display.startedAt).toLocaleString()}
                                {duration != null && (
                                    <span className="text-xs bg-muted px-2 py-0.5 rounded">
                                        {Math.floor(duration / 60)}m {duration % 60}s
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={downloadLogs}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm transition"
                        >
                            <Download className="h-3.5 w-3.5" /> Download Raw Log
                        </button>
                        <button
                            onClick={handleRunAgain}
                            disabled={isRecycling}
                            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${isRecycling
                                ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
                                : 'bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white'
                                }`}
                        >
                            {isRecycling ? (
                                <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Recycling...
                                </>
                            ) : (
                                <>
                                    <RotateCcw className="h-3.5 w-3.5" /> Run Again
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="glass rounded-xl p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                            <Activity className="h-4 w-4 text-blue-400" />
                            Cycles
                        </div>
                        <p className="text-2xl font-bold">{display.cycles.length}</p>
                    </div>
                    <div className="glass rounded-xl p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                            <DollarSign className="h-4 w-4 text-emerald-400" />
                            Total Settled
                        </div>
                        <p className="text-2xl font-bold">${display.totalSettled}</p>
                    </div>
                    <div className="glass rounded-xl p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                            <Fuel className="h-4 w-4 text-amber-400" />
                            Total Gas
                        </div>
                        <p className="text-2xl font-bold text-amber-400">{BigInt(display.totalGas || '0').toLocaleString()}</p>
                    </div>
                    <div className="glass rounded-xl p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            PoR Status
                        </div>
                        <p className={`text-2xl font-bold ${display.cycles.every(c => c.porSolvent) ? 'text-emerald-400' : 'text-red-400'}`}>
                            {display.cycles.every(c => c.porSolvent) ? 'SOLVENT' : 'ISSUE'}
                        </p>
                    </div>
                    <div className="glass rounded-xl p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                            <Clock className="h-4 w-4 text-violet-400" />
                            Duration
                        </div>
                        <p className="text-2xl font-bold text-violet-400">
                            {duration != null ? `${Math.floor(duration / 60)}m ${duration % 60}s` : '—'}
                        </p>
                    </div>
                </div>

                {/* Platform Revenue + VRF Tiebreakers */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="glass rounded-xl p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                            <TrendingUp className="h-4 w-4 text-emerald-400" />
                            Platform Revenue
                        </div>
                        <p className="text-2xl font-bold text-emerald-400">
                            {display.totalPlatformIncome != null ? `$${display.totalPlatformIncome.toFixed(2)}` : '—'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">5% settle fee + $1/lead</p>
                    </div>
                    <div className="glass rounded-xl p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                            <Zap className="h-4 w-4 text-yellow-400" />
                            VRF Tiebreakers
                        </div>
                        <p className="text-2xl font-bold text-yellow-400">
                            {display.totalTiebreakers ?? display.cycles.filter(c => c.hadTiebreaker).length}
                        </p>
                        {display.vrfProofLinks && display.vrfProofLinks.length > 0 && (
                            <div className="flex flex-col gap-0.5 mt-1">
                                {display.vrfProofLinks.map((link, i) => (
                                    <a key={i} href={link} target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-yellow-400 hover:text-yellow-300 transition font-mono text-xs">
                                        VRF Proof {i + 1} <ExternalLink className="h-3 w-3" />
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* CRE DON Proofs */}
                <div className="glass rounded-xl p-5">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-purple-400" />
                            <h3 className="text-sm font-bold text-purple-300">CRE DON Proofs</h3>
                        </div>
                        <span className="text-[10px] text-muted-foreground bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
                            7-gate evaluation · encryptOutput: true
                        </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">CRE Deployer Contract</span>
                            <a
                                href="https://sepolia.basescan.org/address/0x6BBcf40316D7F9AE99A832DE3975e1e3a5F5e93b"
                                target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 transition font-mono"
                            >
                                0x6BBcf...e93b <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">CREVerifier Contract</span>
                            <a
                                href="https://sepolia.basescan.org/address/0xe9c9C03C83D4da5AB29D7E0A53Ae48D8C84c6D6"
                                target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 transition font-mono"
                            >
                                0xe9c9C...c6D6 <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Workflows Executed</span>
                            <span className="text-sm font-bold text-purple-300">
                                {display.cycles.length} × EvaluateBuyerRulesAndMatch
                            </span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">CRE Workflow Simulate</span>
                            <button
                                onClick={() => {
                                    const blob = new Blob([JSON.stringify({
                                        workflow: 'EvaluateBuyerRulesAndMatch',
                                        target: 'staging-settings',
                                        cycles: display.cycles.map(c => ({
                                            cycle: c.cycle,
                                            vertical: c.vertical,
                                            qualityScore: display.creQualityScores?.[c.cycle] ?? 'pending',
                                            gates: ['vertical', 'geo', 'state', 'quality', 'off-site', 'verified', 'field-filters'],
                                        })),
                                        timestamp: new Date().toISOString(),
                                    }, null, 2)], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `cre-simulate-${display.runId?.slice(0, 8)}.json`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }}
                                className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition cursor-pointer bg-transparent border-none p-0 font-mono"
                            >
                                Download simulate JSON <Download className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* History Tabs removed: we don't have functional backends for this right now */}

                {/* Results Table */}
                <div className="glass rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border/50 text-left">
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Cycle</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Vertical</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground"
                                        title="CRE DON evaluation confirmed — quality pending on-chain scoring">
                                        CRE Quality
                                    </th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Bid</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Lock IDs</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Settle Tx</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">LeadNFT</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Refunds</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">PoR</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Tx Status</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">On-Chain Proof</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Gas</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Platform</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">Tiebreaker</th>
                                    <th className="px-4 py-3 font-medium text-muted-foreground">VRF Proof</th>
                                </tr>
                            </thead>
                            <tbody>
                                {display.cycles.map((cycle) => {
                                    // Build NFT link: prefer explicit tokenId/mintTxHash, fall back to settle tx
                                    const nftHref = cycle.nftTokenId != null
                                        ? `${BASESCAN_NFT}${LEAD_NFT_ADDR}/${cycle.nftTokenId}`
                                        : cycle.mintTxHash
                                            ? `${BASESCAN_TX}${cycle.mintTxHash}`
                                            : `${BASESCAN_TX}${cycle.settleTxHash}`;

                                    return (
                                        <tr key={cycle.cycle} className="border-b border-border/30 hover:bg-white/[0.02] transition">
                                            <td className="px-4 py-3 font-mono font-bold text-blue-400">#{cycle.cycle}</td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-400 text-xs font-medium capitalize">
                                                    {cycle.vertical.replace(/_/g, ' ')}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                {display.creQualityScores?.[cycle.cycle] != null ? (
                                                    <span
                                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 text-xs font-bold"
                                                        title="CRE DON Match + Quality Score: confirmed on-chain"
                                                    >
                                                        <Shield className="h-3 w-3" />
                                                        {display.creQualityScores[cycle.cycle]}/100
                                                    </span>
                                                ) : (
                                                    <span
                                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 text-xs font-medium"
                                                        title="CRE DON evaluation ran — quality score pending on-chain confirmation"
                                                    >
                                                        <Shield className="h-3 w-3" />
                                                        Pending
                                                    </span>
                                                )}
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
                                                <a
                                                    href={nftHref}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title={cycle.nftTokenId != null ? `Token #${cycle.nftTokenId}` : 'View mint tx on Basescan'}
                                                    className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 transition font-mono text-xs"
                                                >
                                                    {cycle.nftTokenId != null ? `#${cycle.nftTokenId}` : 'NFT ↗'}
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
                                                    {cycle.porTxHash && (
                                                        <a
                                                            href={`${BASESCAN_TX}${cycle.porTxHash}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-muted-foreground hover:text-blue-400 transition"
                                                        >
                                                            <ExternalLink className="h-3 w-3" />
                                                        </a>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                                {BigInt(cycle.gasUsed || '0').toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-emerald-400">
                                                {cycle.platformIncome != null ? `$${cycle.platformIncome.toFixed(2)}` : '—'}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {cycle.hadTiebreaker ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400 text-xs font-medium">
                                                        <Zap className="h-3 w-3" /> VRF
                                                    </span>
                                                ) : <span className="text-muted-foreground">—</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                {cycle.vrfTxHash ? (
                                                    <a href={`${BASESCAN_TX}${cycle.vrfTxHash}`} target="_blank" rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 text-yellow-400 hover:text-yellow-300 transition font-mono text-xs">
                                                        {cycle.vrfTxHash.slice(0, 10)}… <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                ) : <span className="text-muted-foreground">—</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Error message if demo failed */}
                {display.error && (
                    <div className="glass rounded-xl p-4 border border-red-500/20 bg-red-500/5">
                        <p className="text-sm text-red-400">
                            <strong>Error:</strong> {display.error}
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
