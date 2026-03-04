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
    Activity, Rocket, Clock, TrendingUp, Zap, Shield, Gift,
    ChevronDown
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import api from '@/lib/api';
import { useDemo } from '@/hooks/useDemo';

const BASESCAN_TX = 'https://sepolia.basescan.org/tx/';
// LeadNFT contract on Base Sepolia — uses the same env var as wagmi.ts
const LEAD_NFT_ADDR = import.meta.env.VITE_LEAD_NFT_ADDRESS_SEPOLIA || '';

interface CycleResult {
    cycle: number;
    leadId?: string;
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
    txStatus?: string;           // 'confirmed' | 'pending'
    // ── Judge-facing financials (optional — backward-compat) ──
    platformIncome?: number;
    hadTiebreaker?: boolean;
    vrfTxHash?: string;
    bountyAmount?: number;
    bountyTxHashes?: string[];
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
    totalBountyRewards?: number;
}



// ── Retry config ──────────────────────────────
// Used only for fallback API fetch (not for socket-driven display).
const RETRY_DELAYS = [800, 2000, 4000, 8000, 15000]; // ms

export default function DemoResults() {
    const { runId: paramRunId } = useParams<{ runId: string }>();
    const navigate = useNavigate();
    const { startDemo, partialResults, isRecycling } = useDemo();
    const [result, setResult] = useState<DemoResult | null>(null);
    const [loading, setLoading] = useState(() => !partialResults && !false); // skip loading if we have cached data
    const [error, setError] = useState<string | null>(null);
    const [showConfetti, setShowConfetti] = useState(false);
    const [creExpanded, setCreExpanded] = useState(false);
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
        totalBountyRewards: (partialResults.cycles as CycleResult[]).reduce(
            (sum, c) => sum + (c.bountyAmount ?? 0), 0
        ),
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

                {/* Bottom-right recycling badge removed — kept in header + On-Chain Log only */}

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
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            onClick={downloadLogs}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm transition"
                        >
                            <Download className="h-3.5 w-3.5" /> Raw Log
                        </button>
                        <button
                            onClick={() => {
                                if (!display) return;
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
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm transition"
                        >
                            <Download className="h-3.5 w-3.5" /> Simulate JSON
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
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Recycling demo…
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

                {/* Revenue + VRF + Bounty — compact horizontal stats bar */}
                <div className="glass rounded-xl p-4">
                    <div className="grid grid-cols-3 divide-x divide-border/30">
                        <div className="px-4 first:pl-0">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                                Platform Revenue
                            </div>
                            <p className="text-xl font-bold text-emerald-400">
                                {display.totalPlatformIncome != null ? `$${display.totalPlatformIncome.toFixed(2)}` : '—'}
                            </p>
                            <p className="text-[10px] text-muted-foreground">5% settle fee + $1/lead</p>
                        </div>
                        <div className="px-4">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                                <Zap className="h-3.5 w-3.5 text-yellow-400" />
                                VRF Tiebreakers
                            </div>
                            <p className="text-xl font-bold text-yellow-400">
                                {display.totalTiebreakers ?? display.cycles.filter(c => c.hadTiebreaker).length}
                            </p>
                            {display.cycles.some(c => c.hadTiebreaker && c.vrfTxHash) && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {display.cycles.filter(c => c.hadTiebreaker && c.vrfTxHash).map((c, i) => (
                                        <a key={i} href={`${BASESCAN_TX}${c.vrfTxHash}`} target="_blank" rel="noopener noreferrer"
                                            className="inline-flex items-center gap-0.5 text-yellow-400 hover:text-yellow-300 transition font-mono text-[10px]">
                                            C{c.cycle} <ExternalLink className="h-2.5 w-2.5" />
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="px-4">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                                <Gift className="h-3.5 w-3.5 text-amber-400" />
                                Bounty Rewards
                            </div>
                            <p className="text-xl font-bold text-amber-400">
                                {display.totalBountyRewards != null && display.totalBountyRewards > 0
                                    ? `$${display.totalBountyRewards.toFixed(2)}`
                                    : '$0'}
                            </p>
                            <p className="text-[10px] text-muted-foreground">On-chain payouts to sellers</p>
                        </div>
                    </div>
                </div>

                {/* CRE DON Proofs — Collapsible Accordion */}
                <div className="glass rounded-xl">
                    <button
                        onClick={() => setCreExpanded(prev => !prev)}
                        className="w-full flex items-center justify-between p-5 text-left hover:bg-white/[0.02] transition rounded-xl"
                    >
                        <div className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-purple-400" />
                            <div>
                                <h3 className="text-sm font-bold text-purple-300">CRE DON Proofs</h3>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    Confidential Compute workflows executed on Chainlink DON (7-gate buyer matching + winner-only decrypt)
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
                                {display.cycles.length} workflows
                            </span>
                            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${creExpanded ? 'rotate-180' : ''}`} />
                        </div>
                    </button>
                    {creExpanded && (
                        <div className="px-5 pb-5 pt-0">
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
                                        href="https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8"
                                        target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 transition font-mono"
                                    >
                                        0xfec22...af8 <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground">Workflows Executed</span>
                                    <span className="text-sm font-bold text-purple-300">
                                        {display.cycles.length} × EvaluateBuyerRulesAndMatch
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* History Tabs removed: we don't have functional backends for this right now */}

                {/* Results Table */}
                <div className="glass rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm" style={{ minWidth: '860px' }}>
                            <thead>
                                <tr className="border-b border-border/50 text-left">
                                    <th className="px-3 py-3 font-medium text-muted-foreground">Cycle</th>
                                    <th className="px-3 py-3 font-medium text-muted-foreground">Vertical</th>
                                    <th className="px-3 py-3 font-medium text-muted-foreground"
                                        title="CRE DON evaluation confirmed — quality pending on-chain scoring">
                                        CRE Quality
                                    </th>
                                    <th className="px-3 py-3 font-medium text-muted-foreground">Bid / Locks</th>
                                    <th className="px-3 py-3 font-medium text-muted-foreground">Settle Tx</th>
                                    <th className="px-3 py-3 font-medium text-muted-foreground">NFT</th>
                                    <th className="px-3 py-3 font-medium text-muted-foreground">Refunds</th>
                                    <th className="px-3 py-3 font-medium text-muted-foreground"
                                        title="Batch Proof-of-Reserves — verifies all escrows are solvent">
                                        PoR
                                    </th>
                                    <th className="px-3 py-3 font-medium text-muted-foreground">Gas</th>
                                    <th className="px-3 py-3 font-medium text-muted-foreground">Revenue</th>
                                </tr>
                            </thead>
                            <tbody>
                                {display.cycles.map((cycle) => {
                                    // Build NFT link: green only for real tokenId, yellow for mint tx (even if failed)
                                    const hasTokenId = cycle.nftTokenId != null;
                                    const hasMintTx = !hasTokenId && cycle.mintTxHash != null;
                                    const nftHref = hasTokenId
                                        ? `https://sepolia.basescan.org/token/${LEAD_NFT_ADDR}?a=${cycle.nftTokenId}`
                                        : cycle.mintTxHash
                                            ? `${BASESCAN_TX}${cycle.mintTxHash}`
                                            : null;

                                    return (
                                        <tr key={cycle.cycle} className="border-b border-border/30 hover:bg-white/[0.02] transition">
                                            {/* Cycle */}
                                            <td className="px-3 py-3 font-mono font-bold text-blue-400">#{cycle.cycle}</td>

                                            {/* Vertical */}
                                            <td className="px-3 py-3">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-400 text-xs font-medium capitalize">
                                                    {cycle.vertical.replace(/_/g, ' ')}
                                                </span>
                                            </td>

                                            {/* CRE Quality */}
                                            <td className="px-3 py-3">
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

                                            {/* Bid / Locks */}
                                            <td className="px-3 py-3">
                                                <div className="font-mono text-emerald-400">${cycle.bidAmount}</div>
                                                <div className="font-mono text-[10px] text-muted-foreground">[{cycle.lockIds.join(', ')}]</div>
                                            </td>

                                            {/* Settle Tx + VRF indicator */}
                                            <td className="px-3 py-3">
                                                <a
                                                    href={`${BASESCAN_TX}${cycle.settleTxHash}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition font-mono text-xs"
                                                >
                                                    {cycle.settleTxHash.slice(0, 10)}…
                                                    <ExternalLink className="h-3 w-3" />
                                                </a>
                                                {cycle.hadTiebreaker && (
                                                    <a
                                                        href={cycle.vrfTxHash ? `${BASESCAN_TX}${cycle.vrfTxHash}` : '#'}
                                                        target="_blank" rel="noopener noreferrer"
                                                        className="mt-0.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 hover:text-yellow-300 transition text-[10px] font-medium"
                                                        title="Winner selected via Chainlink VRF tiebreaker"
                                                    >
                                                        <Zap className="h-2.5 w-2.5" /> VRF
                                                        {cycle.vrfTxHash && <ExternalLink className="h-2.5 w-2.5" />}
                                                    </a>
                                                )}
                                            </td>

                                            {/* NFT — 3-state: green Minted #N / yellow Mint Tx / grey pending */}
                                            <td className="px-3 py-3">
                                                {hasTokenId && nftHref ? (
                                                    <a
                                                        href={nftHref}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title={`LeadNFTv2 #${cycle.nftTokenId}`}
                                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-medium hover:text-emerald-300 transition"
                                                    >
                                                        <CheckCircle2 className="h-3 w-3" />
                                                        Minted #{cycle.nftTokenId}
                                                        <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                ) : hasMintTx && nftHref ? (
                                                    <a
                                                        href={nftHref}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="View NFT mint transaction on Basescan"
                                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-yellow-500/10 text-yellow-400 text-xs font-medium hover:text-yellow-300 transition"
                                                    >
                                                        <ExternalLink className="h-3 w-3" />
                                                        NFT Mint Tx
                                                    </a>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground text-xs"
                                                        title="NFT mint pending or not applicable">
                                                        pending
                                                    </span>
                                                )}
                                            </td>

                                            {/* Refunds */}
                                            <td className="px-3 py-3">
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

                                            {/* PoR — single clean badge with tooltip, links to PoR tx */}
                                            <td className="px-3 py-3">
                                                {cycle.porTxHash ? (
                                                    <a
                                                        href={`${BASESCAN_TX}${cycle.porTxHash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title="Batch Proof-of-Reserves — verifies all escrows are solvent"
                                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium transition ${cycle.porSolvent
                                                            ? 'bg-emerald-500/10 text-emerald-400 hover:text-emerald-300'
                                                            : 'bg-red-500/10 text-red-400 hover:text-red-300'
                                                            }`}
                                                    >
                                                        {cycle.porSolvent
                                                            ? <CheckCircle2 className="h-3 w-3" />
                                                            : <XCircle className="h-3 w-3" />
                                                        }
                                                        {cycle.porSolvent ? 'Solvent' : 'Issue'}
                                                        <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                ) : (
                                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium ${cycle.porSolvent
                                                        ? 'bg-emerald-500/10 text-emerald-400'
                                                        : 'bg-red-500/10 text-red-400'
                                                        }`} title="Batch Proof-of-Reserves — verifies all escrows are solvent">
                                                        {cycle.porSolvent
                                                            ? <CheckCircle2 className="h-3 w-3" />
                                                            : <XCircle className="h-3 w-3" />
                                                        }
                                                        {cycle.porSolvent ? 'Solvent' : 'Issue'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Gas */}
                                            <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                                                {BigInt(cycle.gasUsed || '0').toLocaleString()}
                                            </td>

                                            {/* Revenue — platform income + bounty pill */}
                                            <td className="px-3 py-3">
                                                <div className="font-mono text-xs text-emerald-400">
                                                    {cycle.platformIncome != null ? `$${cycle.platformIncome.toFixed(2)}` : '—'}
                                                </div>
                                                {cycle.bountyAmount != null && cycle.bountyAmount > 0 && (
                                                    <span
                                                        className="inline-flex items-center gap-0.5 mt-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-medium"
                                                        title={cycle.bountyTxHashes?.length ? `Bounty tx: ${cycle.bountyTxHashes[0].slice(0, 12)}…` : 'Bounty released to seller'}
                                                    >
                                                        <Gift className="h-2.5 w-2.5" />
                                                        +${cycle.bountyAmount}
                                                    </span>
                                                )}
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
