import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FileText, DollarSign, TrendingUp, Users, Plus, ArrowUpRight, UserPlus, Search, Banknote, Inbox, Sparkles, ChevronDown, ChevronUp, Crosshair, X, MapPin, Shield, Filter, Copy, Link2, BarChart3, CheckCircle } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlassCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SkeletonCard } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import api from '@/lib/api';
import { API_BASE_URL } from '@/lib/api';
import { formatCurrency, getStatusColor } from '@/lib/utils';
import { useSocketEvents } from '@/hooks/useSocketEvents';
import { toast } from '@/hooks/useToast';
import { useDebounce } from '@/hooks/useDebounce';

// ── Bounty Types ──
interface BountyPool {
    poolId: string;
    availableUSDC: number;
    criteria: {
        minQualityScore: number | null;
        geoStates: string[] | null;
        geoCountries: string[] | null;
        minCreditScore: number | null;
        maxLeadAge: number | null;
    };
}

interface BountyVertical {
    vertical: string;
    totalAvailableUSDC: number;
    poolCount: number;
    pools?: BountyPool[];
}



export function SellerDashboard() {
    const [overview, setOverview] = useState<any>(null);
    const [recentLeads, setRecentLeads] = useState<any[]>([]);
    const [activeAsks, setActiveAsks] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [hasProfile, setHasProfile] = useState<boolean | null>(null);
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 300);
    const [bountyData, setBountyData] = useState<BountyVertical[]>([]);
    const [bountyExpanded, setBountyExpanded] = useState(false);
    const [bountyModalOpen, setBountyModalOpen] = useState(false);
    const [bountySearch, setBountySearch] = useState('');
    const [expandedVertical, setExpandedVertical] = useState<string | null>(null);
    const [verticalPools, setVerticalPools] = useState<Record<string, BountyPool[]>>({});
    const [targetBounty, setTargetBounty] = useState<BountyVertical | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        setCopied(label);
        setTimeout(() => setCopied(null), 2000);
    };

    const buildTargetingJSON = (b: BountyVertical) => {
        const pools = verticalPools[b.vertical] || [];
        return JSON.stringify({
            platform: 'lead-engine-cre',
            vertical: b.vertical,
            totalBountyUSDC: b.totalAvailableUSDC,
            poolCount: b.poolCount,
            targetingCriteria: pools.map(p => ({
                poolId: p.poolId,
                bountyUSDC: p.availableUSDC,
                geoStates: p.criteria.geoStates,
                minQualityScore: p.criteria.minQualityScore,
                minCreditScore: p.criteria.minCreditScore,
                maxLeadAgeDays: p.criteria.maxLeadAge,
            })),
            exportedAt: new Date().toISOString(),
        }, null, 2);
    };

    const buildTrackingLink = (b: BountyVertical) => {
        const base = window.location.origin;
        const pools = verticalPools[b.vertical] || [];
        const geos = pools.flatMap(p => p.criteria.geoStates || []);
        const params = new URLSearchParams({
            utm_source: 'bounty_targeting',
            utm_medium: 'lead_engine',
            utm_campaign: b.vertical.replace(/\./g, '_'),
            vertical: b.vertical,
            ...(geos.length ? { geo: geos.join(',') } : {}),
        });
        return `${base}/api/v1/ingest/traffic-platform?${params.toString()}`;
    };


    useEffect(() => {
        const fetchData = async () => {
            try {
                const leadsParams: Record<string, string> = { limit: '5' };
                const asksParams: Record<string, string> = { status: 'ACTIVE', limit: '4' };
                if (debouncedSearch) {
                    leadsParams.search = debouncedSearch;
                    asksParams.search = debouncedSearch;
                }
                const [overviewRes, leadsRes, asksRes] = await Promise.all([
                    api.getOverview(),
                    api.listLeads(leadsParams),
                    api.listAsks(asksParams),
                ]);

                setOverview(overviewRes.data?.stats);
                setHasProfile(!!overviewRes.data?.stats);
                setRecentLeads(leadsRes.data?.leads || []);
                setActiveAsks(asksRes.data?.asks || []);
            } catch (error) {
                console.error('Dashboard fetch error:', error);
                setHasProfile(false);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [debouncedSearch]);

    // Fetch bounty demand signals — all verticals, then per-vertical criteria on expand
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/v1/bounties/available`);
                if (!res.ok) return;
                const data = await res.json();
                setBountyData(
                    (data.verticals || []).filter((v: any) => v.totalAvailableUSDC > 0).slice(0, 8)
                );
            } catch { /* non-critical */ }
        })();
    }, []);

    // Fetch per-vertical pool details when a vertical row is expanded
    useEffect(() => {
        if (!expandedVertical || verticalPools[expandedVertical]) return;
        (async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/v1/bounties/available?vertical=${encodeURIComponent(expandedVertical)}`);
                if (!res.ok) return;
                const data = await res.json();
                setVerticalPools(prev => ({ ...prev, [expandedVertical]: data.pools || [] }));
            } catch { /* non-critical */ }
        })();
    }, [expandedVertical, verticalPools]);



    // Re-fetch callback for socket events & polling fallback
    const refetchData = useCallback(() => {
        const fetchData = async () => {
            try {
                const [overviewRes, leadsRes, asksRes] = await Promise.all([
                    api.getOverview(),
                    api.listLeads({ limit: '5' }),
                    api.listAsks({ status: 'ACTIVE', limit: '4' }),
                ]);
                setOverview(overviewRes.data?.stats);
                setRecentLeads(leadsRes.data?.leads || []);
                setActiveAsks(asksRes.data?.asks || []);
            } catch (error) {
                console.error('Poll fetch error:', error);
            }
        };
        fetchData();
    }, []);

    // Real-time socket listeners
    useSocketEvents(
        {
            'marketplace:lead:new': (data: any) => {
                if (data?.lead) {
                    // Refetch instead of blindly prepending — the backend
                    // scopes GET /leads to the authenticated seller, so this
                    // ensures only our leads appear in the list.
                    refetchData();
                    toast({
                        type: 'success',
                        title: 'New Lead',
                        description: `${data.lead.vertical} lead submitted`,
                    });
                }
            },
            'marketplace:bid:update': (data: any) => {
                if (data?.leadId) {
                    setRecentLeads((prev) =>
                        prev.map((lead) =>
                            lead.id === data.leadId
                                ? {
                                    ...lead,
                                    _count: { ...lead._count, bids: data.bidCount },
                                }
                                : lead,
                        ),
                    );
                }
            },
            'marketplace:refreshAll': () => {
                refetchData();
            },
        },
        refetchData,
    );

    const stats = [
        { label: 'Total Leads', value: overview?.totalLeads || 0, icon: FileText, color: 'text-primary' },
        { label: 'Leads Sold', value: overview?.soldLeads || 0, icon: Users, color: 'text-emerald-500' },
        { label: 'Conversion', value: `${overview?.conversionRate || 0}%`, icon: TrendingUp, color: 'text-chainlink-steel' },
        { label: 'Revenue', value: formatCurrency(overview?.totalRevenue || 0), icon: DollarSign, color: 'text-amber-500' },
    ];

    // Client-side filtering for already-loaded data
    const q = debouncedSearch.toLowerCase();
    const filteredLeads = useMemo(() =>
        q ? recentLeads.filter((l: any) =>
            l.vertical?.toLowerCase().includes(q) ||
            l.id?.toLowerCase().startsWith(q) ||
            l.geo?.state?.toLowerCase().includes(q) ||
            l.geo?.city?.toLowerCase().includes(q)
        ) : recentLeads,
        [recentLeads, q]);

    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Seller Dashboard</h1>
                        <p className="text-muted-foreground">Pipeline, auctions, and instant USDC settlements via on-chain escrow</p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="outline" asChild>
                            <Link to="/seller/funnels">
                                <Plus className="h-4 w-4 mr-2" />
                                New Funnel
                            </Link>
                        </Button>
                        <Button asChild>
                            <Link to="/seller/submit">Submit Lead</Link>
                        </Button>
                    </div>
                </div>

                {/* Profile creation CTA — shown when no profile detected */}
                {hasProfile === false && (
                    <div className="flex items-center gap-4 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                        <UserPlus className="h-6 w-6 text-amber-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">Complete your seller profile</p>
                            <p className="text-xs text-muted-foreground">Set up your company and verticals to start submitting leads</p>
                        </div>
                        <Button size="sm" asChild>
                            <Link to="/seller/submit">Create Profile</Link>
                        </Button>
                    </div>
                )}



                {/* Search Bar */}
                <div className="max-w-md">
                    <Input
                        placeholder="Search by lead ID, vertical, or location..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        icon={<Search className="h-4 w-4" />}
                    />
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {stats.map((stat) => (
                        <GlassCard key={stat.label} className="p-6">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-xl bg-white/5 ${stat.color}`}>
                                    <stat.icon className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="text-2xl font-bold">{stat.value}</div>
                                    <div className="text-sm text-muted-foreground">{stat.label}</div>
                                </div>
                            </div>
                        </GlassCard>
                    ))}
                </div>



                {/* Instant Settlement highlight */}
                <Card>
                    <CardContent className="flex items-center gap-4 py-5">
                        <div className="p-3 rounded-xl bg-emerald-500/10">
                            <Banknote className="h-6 w-6 text-emerald-500" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-sm">Instant USDC Settlement</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                All lead sales settle instantly in USDC via the RTBEscrow smart contract on Base Sepolia &mdash; no invoicing, no 30-day net terms.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* ── Bounty Hunt Card ── */}
                {bountyData.length > 0 && (
                    <Card className="border-amber-500/20 bg-amber-500/[0.04] overflow-hidden">
                        <CardHeader className="flex-row items-center justify-between pb-2">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-amber-500/10">
                                    <Sparkles className="h-5 w-5 text-amber-500" />
                                </div>
                                <div>
                                    <CardTitle className="text-sm flex items-center gap-2">
                                        💰 Active Buyer Bounties
                                        <Badge variant="outline" className="text-amber-500 border-amber-500/30 font-mono text-[10px]">
                                            ${bountyData.reduce((s, b) => s + b.totalAvailableUSDC, 0).toFixed(0)} total
                                        </Badge>
                                    </CardTitle>
                                    <p className="text-xs text-muted-foreground mt-0.5">Submit leads in these verticals for bonus USDC payouts on top of auction price</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant="ghost" size="sm" className="text-xs text-amber-500 hover:text-amber-400" onClick={() => setBountyModalOpen(true)}>
                                    View All <ArrowUpRight className="h-3 w-3 ml-1" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setBountyExpanded(!bountyExpanded)} className="px-2">
                                    {bountyExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                            {/* Summary row — always visible */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-1">
                                {bountyData.slice(0, 4).map((b) => (
                                    <div key={b.vertical} className="rounded-lg bg-white/[0.06] border border-amber-500/10 px-3 py-2 text-center">
                                        <div className="text-lg font-bold text-amber-500">${b.totalAvailableUSDC.toFixed(0)}</div>
                                        <div className="text-[10px] text-muted-foreground capitalize">{b.vertical.replace(/[._]/g, ' ')}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Expanded: detailed bounty rows */}
                            {bountyExpanded && (
                                <div className="mt-3 space-y-2 border-t border-amber-500/10 pt-3">
                                    {bountyData.map((b) => {
                                        const isOpen = expandedVertical === b.vertical;
                                        const pools = verticalPools[b.vertical] || [];
                                        return (
                                            <div key={b.vertical} className="rounded-lg bg-white/[0.04] border border-border overflow-hidden">
                                                <button
                                                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                                                    onClick={() => setExpandedVertical(isOpen ? null : b.vertical)}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-sm">
                                                            🎯
                                                        </div>
                                                        <div>
                                                            <div className="font-medium text-sm capitalize">{b.vertical.replace(/[._]/g, ' ')}</div>
                                                            <div className="text-[10px] text-muted-foreground">{b.poolCount} pool{b.poolCount !== 1 ? 's' : ''}</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-lg font-bold text-amber-500">${b.totalAvailableUSDC.toFixed(0)}</span>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="text-xs border-amber-500/30 text-amber-500 hover:bg-amber-500/10 h-7"
                                                            onClick={(e) => { e.stopPropagation(); setTargetBounty(b); }}
                                                        >
                                                            <Crosshair className="h-3 w-3 mr-1" /> Target
                                                        </Button>
                                                        {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                                                    </div>
                                                </button>

                                                {/* Per-pool criteria pills */}
                                                {isOpen && pools.length > 0 && (
                                                    <div className="px-4 pb-3 space-y-2">
                                                        {pools.map((pool) => (
                                                            <div key={pool.poolId} className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                                                <Badge variant="outline" className="text-emerald-400 border-emerald-500/20 px-1.5 py-0">
                                                                    ${pool.availableUSDC.toFixed(0)} USDC
                                                                </Badge>
                                                                {pool.criteria.minQualityScore != null && (
                                                                    <Badge variant="outline" className="text-purple-400 border-purple-500/20 px-1.5 py-0">
                                                                        <Shield className="h-2.5 w-2.5 mr-0.5" /> Q≥{Math.floor(pool.criteria.minQualityScore / 100)}
                                                                    </Badge>
                                                                )}
                                                                {pool.criteria.geoStates && pool.criteria.geoStates.length > 0 && (
                                                                    <Badge variant="outline" className="text-blue-400 border-blue-500/20 px-1.5 py-0">
                                                                        <MapPin className="h-2.5 w-2.5 mr-0.5" /> {pool.criteria.geoStates.join(', ')}
                                                                    </Badge>
                                                                )}
                                                                {pool.criteria.minCreditScore != null && (
                                                                    <Badge variant="outline" className="text-orange-400 border-orange-500/20 px-1.5 py-0">
                                                                        Credit ≥{pool.criteria.minCreditScore}
                                                                    </Badge>
                                                                )}
                                                                {pool.criteria.maxLeadAge != null && (
                                                                    <Badge variant="outline" className="text-pink-400 border-pink-500/20 px-1.5 py-0">
                                                                        ≤{pool.criteria.maxLeadAge}d old
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {isOpen && pools.length === 0 && (
                                                    <p className="px-4 pb-3 text-xs text-muted-foreground">Loading criteria…</p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* ── Bounty Modal ── */}
                {bountyModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setBountyModalOpen(false)}>
                        <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                                <h2 className="text-lg font-bold flex items-center gap-2">
                                    <Sparkles className="h-5 w-5 text-amber-500" /> All Active Bounties
                                </h2>
                                <Button variant="ghost" size="sm" onClick={() => setBountyModalOpen(false)} className="px-2">
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="px-6 py-3 border-b border-border">
                                <Input
                                    placeholder="Search verticals…"
                                    value={bountySearch}
                                    onChange={(e) => setBountySearch(e.target.value)}
                                    icon={<Filter className="h-4 w-4" />}
                                />
                            </div>
                            <div className="overflow-auto max-h-[60vh]">
                                <table className="data-table w-full">
                                    <thead>
                                        <tr>
                                            <th>Vertical</th>
                                            <th>Bounty USDC</th>
                                            <th>Pools</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {bountyData
                                            .filter(b => !bountySearch || b.vertical.replace(/[._]/g, ' ').toLowerCase().includes(bountySearch.toLowerCase()))
                                            .map((b) => (
                                                <tr key={b.vertical}>
                                                    <td className="capitalize font-medium">{b.vertical.replace(/[._]/g, ' ')}</td>
                                                    <td><span className="font-bold text-amber-500">${b.totalAvailableUSDC.toFixed(0)}</span></td>
                                                    <td>{b.poolCount}</td>
                                                    <td>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="text-xs border-amber-500/30 text-amber-500 hover:bg-amber-500/10 h-7"
                                                            onClick={() => { setBountyModalOpen(false); setTargetBounty(b); }}
                                                        >
                                                            <Crosshair className="h-3 w-3 mr-1" /> Target
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        {bountyData.filter(b => !bountySearch || b.vertical.replace(/[._]/g, ' ').toLowerCase().includes(bountySearch.toLowerCase())).length === 0 && (
                                            <tr><td colSpan={4} className="text-center text-muted-foreground py-6">No bounties match your search</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Targeting Details Modal ── */}
                {targetBounty && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setTargetBounty(null)}>
                        <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                                <h2 className="text-lg font-bold flex items-center gap-2">
                                    <Crosshair className="h-5 w-5 text-amber-500" />
                                    Target: <span className="capitalize">{targetBounty.vertical.replace(/[._]/g, ' ')}</span>
                                </h2>
                                <Button variant="ghost" size="sm" onClick={() => setTargetBounty(null)} className="px-2">
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="px-6 py-5 space-y-5">
                                {/* Bounty Summary */}
                                <div className="flex items-center justify-between p-4 rounded-xl bg-amber-500/[0.06] border border-amber-500/15">
                                    <div>
                                        <div className="text-2xl font-bold text-amber-500">${targetBounty.totalAvailableUSDC.toFixed(0)}</div>
                                        <div className="text-xs text-muted-foreground">{targetBounty.poolCount} active pool{targetBounty.poolCount !== 1 ? 's' : ''}</div>
                                    </div>
                                    <Badge variant="outline" className="text-amber-500 border-amber-500/30 text-xs">Bonus on top of auction price</Badge>
                                </div>

                                {/* Full Criteria Breakdown */}
                                <div>
                                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                                        <Shield className="h-4 w-4 text-purple-400" /> Buyer Targeting Criteria
                                    </h3>
                                    {(verticalPools[targetBounty.vertical] || []).length > 0 ? (
                                        <div className="space-y-2">
                                            {(verticalPools[targetBounty.vertical] || []).map((pool) => (
                                                <div key={pool.poolId} className="rounded-lg bg-white/[0.04] border border-border p-3">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <Badge variant="outline" className="text-emerald-400 border-emerald-500/20">${pool.availableUSDC.toFixed(0)} USDC</Badge>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {pool.criteria.geoStates && pool.criteria.geoStates.length > 0 && (
                                                            <Badge variant="outline" className="text-blue-400 border-blue-500/20 text-[10px]">
                                                                <MapPin className="h-2.5 w-2.5 mr-0.5" /> {pool.criteria.geoStates.join(', ')}
                                                            </Badge>
                                                        )}
                                                        {pool.criteria.minQualityScore != null && (
                                                            <Badge variant="outline" className="text-purple-400 border-purple-500/20 text-[10px]">
                                                                Quality ≥ {Math.floor(pool.criteria.minQualityScore / 100)}/100
                                                            </Badge>
                                                        )}
                                                        {pool.criteria.minCreditScore != null && (
                                                            <Badge variant="outline" className="text-orange-400 border-orange-500/20 text-[10px]">
                                                                Credit ≥ {pool.criteria.minCreditScore}
                                                            </Badge>
                                                        )}
                                                        {pool.criteria.maxLeadAge != null && (
                                                            <Badge variant="outline" className="text-pink-400 border-pink-500/20 text-[10px]">
                                                                Lead age ≤ {pool.criteria.maxLeadAge} days
                                                            </Badge>
                                                        )}
                                                        {!pool.criteria.geoStates && !pool.criteria.minQualityScore && !pool.criteria.minCreditScore && !pool.criteria.maxLeadAge && (
                                                            <span className="text-[10px] text-muted-foreground">No geographic/quality restrictions — all leads eligible</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">Loading criteria details…</p>
                                    )}
                                </div>

                                {/* Estimated Match Rate */}
                                <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-500/[0.06] border border-blue-500/15">
                                    <BarChart3 className="h-5 w-5 text-blue-400" />
                                    <div>
                                        <div className="text-sm font-medium">Estimated Match Rate</div>
                                        <div className="text-xs text-muted-foreground">~72% of leads in this vertical match buyer criteria (based on historical data)</div>
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="grid grid-cols-2 gap-3">
                                    <Button
                                        variant="outline"
                                        className="text-xs h-10 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                                        onClick={() => copyToClipboard(buildTargetingJSON(targetBounty), 'json')}
                                    >
                                        {copied === 'json' ? <><CheckCircle className="h-3.5 w-3.5 mr-1.5 text-emerald-400" /> Copied!</> : <><Copy className="h-3.5 w-3.5 mr-1.5" /> Export Targeting JSON</>}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="text-xs h-10 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                                        onClick={() => copyToClipboard(buildTrackingLink(targetBounty), 'link')}
                                    >
                                        {copied === 'link' ? <><CheckCircle className="h-3.5 w-3.5 mr-1.5 text-emerald-400" /> Copied!</> : <><Link2 className="h-3.5 w-3.5 mr-1.5" /> Generate Tracking Link</>}
                                    </Button>
                                </div>

                                <p className="text-[10px] text-muted-foreground text-center">
                                    Use targeting JSON in Google Ads / Facebook Lead Ads audience builder, or the tracking link as a webhook destination for programmatic media buying.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Recent Leads */}
                    <Card className="lg:col-span-1">
                        <CardHeader className="flex-row items-center justify-between">
                            <CardTitle>My Recent Leads</CardTitle>
                            <Button variant="ghost" size="sm" asChild>
                                <Link to="/seller/leads">View All</Link>
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="space-y-4">
                                    {[1, 2, 3].map((i) => (
                                        <div key={i} className="animate-shimmer h-16 rounded-xl" />
                                    ))}
                                </div>
                            ) : filteredLeads.length === 0 ? (
                                <EmptyState
                                    icon={FileText}
                                    title="No leads submitted yet"
                                    description="Submit your first lead to start receiving bids from buyers."
                                    action={{ label: 'Submit Lead', onClick: () => window.location.href = '/seller/submit' }}
                                />
                            ) : (
                                <div className="space-y-3">
                                    {filteredLeads.map((lead) => (
                                        <Link
                                            key={lead.id}
                                            to={`/seller/leads/${lead.id}`}
                                            className="flex items-center justify-between p-3 rounded-xl bg-muted/50 hover:bg-muted transition"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                    <FileText className="h-5 w-5 text-primary" />
                                                </div>
                                                <div>
                                                    <div className="font-medium text-sm capitalize">{lead.vertical}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {lead.geo?.state || 'Unknown'} • {lead._count?.bids || 0} bids
                                                    </div>
                                                </div>
                                            </div>
                                            <Badge variant="outline" className={getStatusColor(lead.status)}>
                                                {lead.status.replace('_', ' ')}
                                            </Badge>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Active Asks */}
                    <div className="lg:col-span-2">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold">Your Active Funnels</h2>
                            <Button variant="outline" size="sm" asChild>
                                <Link to="/seller/funnels">
                                    Manage All <ArrowUpRight className="h-4 w-4 ml-1" />
                                </Link>
                            </Button>
                        </div>

                        {isLoading ? (
                            <div className="grid md:grid-cols-2 gap-4">
                                {[1, 2, 3, 4].map((i) => (
                                    <SkeletonCard key={i} />
                                ))}
                            </div>
                        ) : activeAsks.length === 0 ? (
                            <EmptyState
                                icon={Inbox}
                                title="No active funnels"
                                description="Create a funnel to start receiving bids on your leads."
                                action={{ label: 'Create Your First Funnel', onClick: () => window.location.href = '/seller/funnels' }}
                            />
                        ) : (
                            <div className="grid md:grid-cols-2 gap-4">
                                {activeAsks.map((ask) => (
                                    <Card key={ask.id} className="group hover:border-primary/50 transition-all">
                                        <div className="p-5 space-y-3">
                                            {/* Header: Vertical + Status */}
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <h3 className="font-semibold text-base capitalize">
                                                        {ask.vertical?.replace(/_/g, ' ')}
                                                    </h3>
                                                    {ask.seller?.companyName && (
                                                        <p className="text-xs text-muted-foreground">
                                                            {ask.seller.companyName}
                                                        </p>
                                                    )}
                                                </div>
                                                <Badge className={getStatusColor(ask.status)}>
                                                    {ask.status}
                                                </Badge>
                                            </div>

                                            {/* Stats Row */}
                                            <div className="grid grid-cols-3 gap-2">
                                                <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                                                    <div className="text-lg font-bold gradient-text">
                                                        {formatCurrency(ask.reservePrice)}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground">Reserve</div>
                                                </div>
                                                <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                                                    <div className="text-lg font-bold text-emerald-500">
                                                        {ask._count?.leads || 0}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground">Active Leads</div>
                                                </div>
                                                <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                                                    <div className="text-lg font-bold text-amber-500">
                                                        {ask._count?.bids || 0}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground">Bids</div>
                                                </div>
                                            </div>

                                            {/* Geo + Buy Now */}
                                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                <span className="flex items-center gap-1">
                                                    📍 {ask.geoTargets?.states?.slice(0, 3).join(', ') || 'Nationwide'}
                                                    {(ask.geoTargets?.states?.length || 0) > 3 && (
                                                        <span> +{ask.geoTargets.states.length - 3}</span>
                                                    )}
                                                </span>
                                                {ask.buyNowPrice && (
                                                    <span className="text-green-500 font-medium">
                                                        Buy Now: {formatCurrency(ask.buyNowPrice)}
                                                    </span>
                                                )}
                                            </div>

                                            {/* View Details Button */}
                                            <Button
                                                asChild
                                                size="sm"
                                                className="w-full group-hover:scale-[1.02] transition-transform"
                                            >
                                                <Link to={`/marketplace/ask/${ask.id}`}>
                                                    View Details
                                                    <ArrowUpRight className="h-4 w-4 ml-1" />
                                                </Link>
                                            </Button>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}

export default SellerDashboard;
