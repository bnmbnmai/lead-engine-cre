/**
 * BountyPanel — Buyer bounty deposit & pool management
 *
 * Collapsible GlassCard for BuyerDashboard:
 *   - Deposit form: vertical selector, amount, optional criteria (min QS, geo)
 *   - My Pools table: active pools with available balance, criteria, withdraw
 *   - Socket listeners for real-time bounty updates
 */

import { useState, useEffect, useCallback } from 'react';
import {
    Gift, ChevronDown, ChevronUp, DollarSign, Loader2,
    Trash2, Info, Plus,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/card';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Tooltip from '@/components/ui/Tooltip';
import { NestedVerticalSelect } from '@/components/ui/NestedVerticalSelect';
import api from '@/lib/api';
import { toast } from '@/hooks/useToast';
import { useSocketEvents } from '@/hooks/useSocketEvents';

// ============================================
// Types
// ============================================

interface BountyPool {
    poolId: string;
    amount: number;
    totalReleased: number;
    available: number;
    criteria: Record<string, unknown>;
    createdAt: string;
    active: boolean;
}

interface BountyPanelProps {
    className?: string;
}

// ============================================
// Component
// ============================================

export function BountyPanel({ className = '' }: BountyPanelProps) {
    const [expanded, setExpanded] = useState(true);
    const [showForm, setShowForm] = useState(false);

    // Deposit form state
    const [selectedVertical, setSelectedVertical] = useState('');
    const [amount, setAmount] = useState('');
    const [minQualityScore, setMinQualityScore] = useState('');
    const [depositing, setDepositing] = useState(false);

    // Pools state (fetched per-vertical)
    const [poolVertical, setPoolVertical] = useState('');
    const [pools, setPools] = useState<BountyPool[]>([]);
    const [loadingPools, setLoadingPools] = useState(false);
    const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

    // ── Fetch pools for selected vertical ──
    const fetchPools = useCallback(async (slug: string) => {
        if (!slug) { setPools([]); return; }
        setLoadingPools(true);
        try {
            const res = await api.getMyBountyPools(slug);
            setPools(res.data?.pools || []);
        } catch {
            setPools([]);
        } finally {
            setLoadingPools(false);
        }
    }, []);

    // Auto-load pools when vertical changes
    useEffect(() => {
        if (poolVertical) fetchPools(poolVertical);
    }, [poolVertical, fetchPools]);

    // ── Socket listeners via useSocketEvents ──
    // Create a stable reference to the refresh function for the event handlers
    useSocketEvents({
        'vertical:bounty:deposited': () => {
            if (poolVertical) fetchPools(poolVertical);
        },
        'bounty:released': () => {
            if (poolVertical) fetchPools(poolVertical);
        },
    });

    // ── Deposit handler ──
    const handleDeposit = async () => {
        if (!selectedVertical || !amount) return;
        const amountNum = parseFloat(amount);
        if (isNaN(amountNum) || amountNum < 10) {
            toast({ type: 'error', title: 'Minimum deposit is $10' });
            return;
        }

        setDepositing(true);
        try {
            const criteria: Record<string, unknown> = {};
            if (minQualityScore) {
                criteria.minQualityScore = parseInt(minQualityScore, 10);
            }

            const res = await api.depositBounty(
                selectedVertical,
                amountNum,
                Object.keys(criteria).length > 0 ? criteria : undefined,
            );

            if (res.data?.success) {
                toast({
                    type: 'success',
                    title: `Bounty deposited: $${amountNum}`,
                    description: res.data.txHash
                        ? `Tx: ${res.data.txHash.slice(0, 10)}…`
                        : 'Off-chain pool created',
                });
                setAmount('');
                setMinQualityScore('');
                setShowForm(false);

                // Refresh pools if viewing this vertical
                if (poolVertical === selectedVertical) {
                    fetchPools(poolVertical);
                } else {
                    setPoolVertical(selectedVertical);
                }
            } else {
                toast({ type: 'error', title: 'Deposit failed' });
            }
        } catch (err: any) {
            toast({ type: 'error', title: err.message || 'Deposit failed' });
        } finally {
            setDepositing(false);
        }
    };

    // ── Withdraw handler ──
    const handleWithdraw = async (pool: BountyPool) => {
        if (!poolVertical) return;
        setWithdrawingId(pool.poolId);
        try {
            const res = await api.withdrawBounty(poolVertical, pool.poolId);
            if (res.data?.success) {
                toast({ type: 'success', title: `Withdrawn $${pool.available.toFixed(2)}` });
                fetchPools(poolVertical);
            } else {
                toast({ type: 'error', title: 'Withdraw failed' });
            }
        } catch (err: any) {
            toast({ type: 'error', title: err.message || 'Withdraw failed' });
        } finally {
            setWithdrawingId(null);
        }
    };

    // ── Criteria summary helper ──
    const criteriaSummary = (criteria: Record<string, unknown>) => {
        const parts: string[] = [];
        if (criteria.minQualityScore) parts.push(`QS ≥ ${criteria.minQualityScore}`);
        if (Array.isArray(criteria.geoStates) && criteria.geoStates.length > 0) {
            parts.push(`States: ${(criteria.geoStates as string[]).join(', ')}`);
        }
        if (criteria.minCreditScore) parts.push(`Credit ≥ ${criteria.minCreditScore}`);
        return parts.length > 0 ? parts.join(' · ') : 'Any lead';
    };

    const totalBounty = pools
        .filter(p => p.active)
        .reduce((sum, p) => sum + p.available, 0);

    return (
        <GlassCard className={className}>
            {/* Header */}
            <CardHeader
                className="flex-row items-center justify-between cursor-pointer pb-3"
                onClick={() => setExpanded(!expanded)}
                role="button"
                aria-expanded={expanded}
                aria-controls="bounty-panel-content"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-amber-500/10">
                        <Gift className="h-5 w-5 text-amber-400" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <CardTitle className="text-lg">Bounty Pools</CardTitle>
                            <Tooltip content="Fund standing USDC escrow pools per vertical. When a matching lead is won at auction, the bounty auto-releases to the seller as a bonus.">
                                <Info className="h-4 w-4 text-muted-foreground cursor-help shrink-0" aria-label="About bounty pools" />
                            </Tooltip>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Incentivize sellers with per-vertical bounties
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {totalBounty > 0 && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">
                            <DollarSign className="h-3 w-3 mr-0.5" />
                            {totalBounty.toFixed(0)} Active
                        </Badge>
                    )}
                    {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
            </CardHeader>

            {/* Content */}
            {expanded && (
                <CardContent id="bounty-panel-content" className="pt-0 space-y-4">

                    {/* ── Deposit Form Toggle ── */}
                    {!showForm ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setShowForm(true); }}
                            className="w-full border-dashed border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                        >
                            <Plus className="h-4 w-4 mr-1.5" />
                            Fund New Bounty Pool
                        </Button>
                    ) : (
                        <div className="p-4 rounded-xl border border-border bg-muted/30 space-y-3 animate-in fade-in-0 slide-in-from-top-2">
                            <h4 className="text-sm font-medium">New Bounty Deposit</h4>

                            <div className="space-y-2">
                                <label className="text-xs text-muted-foreground">Vertical</label>
                                <NestedVerticalSelect
                                    value={selectedVertical}
                                    onValueChange={setSelectedVertical}
                                    placeholder="Select vertical"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs text-muted-foreground">Amount (USDC)</label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                        <input
                                            type="number"
                                            min={10}
                                            max={10000}
                                            step={10}
                                            value={amount}
                                            onChange={(e) => setAmount(e.target.value)}
                                            placeholder="100"
                                            className="w-full pl-8 pr-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs text-muted-foreground">Min Quality Score (optional)</label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={10000}
                                        value={minQualityScore}
                                        onChange={(e) => setMinQualityScore(e.target.value)}
                                        placeholder="7000"
                                        className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-2 pt-1">
                                <Button
                                    size="sm"
                                    onClick={handleDeposit}
                                    disabled={depositing || !selectedVertical || !amount}
                                    className="bg-amber-600 hover:bg-amber-700 text-white"
                                >
                                    {depositing ? (
                                        <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Depositing…</>
                                    ) : (
                                        <><Gift className="h-3.5 w-3.5 mr-1.5" /> Deposit</>
                                    )}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowForm(false)}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* ── Pool Viewer (select vertical to see your pools) ── */}
                    <div className="space-y-2">
                        <label className="text-xs text-muted-foreground font-medium">View My Pools</label>
                        <NestedVerticalSelect
                            value={poolVertical}
                            onValueChange={setPoolVertical}
                            placeholder="Select vertical to view pools"
                        />
                    </div>

                    {/* Pools table */}
                    {loadingPools ? (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : poolVertical && pools.length === 0 ? (
                        <div className="text-center py-4">
                            <p className="text-sm text-muted-foreground">No bounty pools for this vertical yet</p>
                        </div>
                    ) : pools.length > 0 ? (
                        <div className="space-y-2">
                            {pools.map((pool) => (
                                <div
                                    key={pool.poolId}
                                    className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${pool.active
                                        ? 'border-amber-500/20 bg-amber-500/5'
                                        : 'border-border bg-muted/30 opacity-60'
                                        }`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">
                                                ${pool.available.toFixed(2)}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                of ${pool.amount.toFixed(2)}
                                            </span>
                                            {!pool.active && (
                                                <Badge variant="outline" className="text-[10px] px-1">Drained</Badge>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                            {criteriaSummary(pool.criteria)}
                                        </p>
                                    </div>
                                    {pool.active && (
                                        <Tooltip content="Withdraw remaining balance">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={withdrawingId === pool.poolId}
                                                onClick={() => handleWithdraw(pool)}
                                                className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                                                aria-label={`Withdraw from pool ${pool.poolId}`}
                                            >
                                                {withdrawingId === pool.poolId ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                )}
                                            </Button>
                                        </Tooltip>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : null}
                </CardContent>
            )}
        </GlassCard>
    );
}

export default BountyPanel;
