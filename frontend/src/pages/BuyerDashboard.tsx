import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Gavel, DollarSign, Target, ArrowUpRight, Clock, CheckCircle, MapPin, Search, Users, Star, Download, Send, Tag, Wallet, ArrowDown, ArrowUp } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlassCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SkeletonCard } from '@/components/ui/skeleton';
import { LeadCard } from '@/components/marketplace/LeadCard';
import { CRMExportButton } from '@/components/ui/CRMExportButton';
import api from '@/lib/api';
import { formatCurrency, getStatusColor } from '@/lib/utils';
import { formatSealedBid } from '@/utils/sealedBid';
import { useSocketEvents } from '@/hooks/useSocketEvents';
import { toast } from '@/hooks/useToast';
import { useDebounce } from '@/hooks/useDebounce';

import { BountyPanel } from '@/components/marketplace/BountyPanel';

export function BuyerDashboard() {
    const [overview, setOverview] = useState<any>(null);
    const [recentBids, setRecentBids] = useState<any[]>([]);
    const [activeLeads, setActiveLeads] = useState<any[]>([]);
    const [purchasedLeads, setPurchasedLeads] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 300);
    const [sellerInput, setSellerInput] = useState('');
    const [sellerName, setSellerName] = useState('');
    const [sellerSuggestions, setSellerSuggestions] = useState<any[]>([]);
    const [showSellerDropdown, setShowSellerDropdown] = useState(false);
    const sellerDropdownRef = useRef<HTMLDivElement>(null);
    const [crmPushed, setCrmPushed] = useState<Set<string>>(new Set());
    const [csvExporting, setCsvExporting] = useState(false);

    // Vault state
    const [vaultBalance, setVaultBalance] = useState<number>(0);
    const [vaultTxs, setVaultTxs] = useState<any[]>([]);
    const [depositAmount, setDepositAmount] = useState('');
    const [vaultLoading, setVaultLoading] = useState(false);

    const handleCrmPushSingle = (leadId: string) => {
        setCrmPushed((prev) => new Set(prev).add(leadId));
        // In production, this would POST to /api/v1/crm/push with the lead ID
    };

    const handleExportPurchasedCSV = () => {
        if (filteredPurchased.length === 0) return;
        setCsvExporting(true);
        const headers = ['Lead ID', 'Vertical', 'State', 'City', 'Amount Paid', 'Status', 'NFT Token ID', 'Purchased Date'];
        const rows = filteredPurchased.map((b: any) => [
            b.lead?.id || '',
            b.lead?.vertical || '',
            b.lead?.geo?.state || '',
            b.lead?.geo?.city || '',
            b.amount || '',
            b.status || '',
            b.lead?.nftTokenId || '',
            b.updatedAt ? new Date(b.updatedAt).toISOString() : new Date(b.createdAt).toISOString(),
        ].join(','));
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `purchased-leads-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setTimeout(() => setCsvExporting(false), 1500);
    };

    // Seller autocomplete
    useEffect(() => {
        if (sellerInput.length < 2) { setSellerSuggestions([]); return; }
        const timer = setTimeout(async () => {
            try {
                const { data } = await api.searchSellers(sellerInput);
                setSellerSuggestions(data?.sellers || []);
                setShowSellerDropdown(true);
            } catch { setSellerSuggestions([]); }
        }, 300);
        return () => clearTimeout(timer);
    }, [sellerInput]);

    // Close seller dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (sellerDropdownRef.current && !sellerDropdownRef.current.contains(e.target as Node)) setShowSellerDropdown(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const leadsParams: Record<string, string> = { status: 'IN_AUCTION', limit: '6' };
                if (debouncedSearch) leadsParams.search = debouncedSearch;
                if (sellerName) leadsParams.sellerName = sellerName;
                const [overviewRes, bidsRes, leadsRes] = await Promise.all([
                    api.getOverview(),
                    api.getMyBids(),
                    api.listLeads(leadsParams),
                ]);

                setOverview(overviewRes.data?.stats);
                setRecentBids(bidsRes.data?.bids?.slice(0, 5) || []);
                setActiveLeads(leadsRes.data?.leads || []);
                // Filter accepted/won bids as purchased leads
                const allBids = bidsRes.data?.bids || [];
                setPurchasedLeads(allBids.filter((b: any) => b.status === 'ACCEPTED' || b.status === 'WON'));
            } catch (error) {
                console.error('Dashboard fetch error:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [debouncedSearch, sellerName]);

    // Fetch vault info
    useEffect(() => {
        api.getVault().then(({ data }) => {
            if (data) {
                setVaultBalance(data.balance);
                setVaultTxs(data.transactions?.slice(0, 5) || []);
            }
        }).catch(() => { });
    }, []);

    // Re-fetch callback for socket events & polling fallback
    const refetchData = useCallback(() => {
        const fetchData = async () => {
            try {
                const [overviewRes, bidsRes, leadsRes] = await Promise.all([
                    api.getOverview(),
                    api.getMyBids(),
                    api.listLeads({ status: 'IN_AUCTION', limit: '6' }),
                ]);
                setOverview(overviewRes.data?.stats);
                setRecentBids(bidsRes.data?.bids?.slice(0, 5) || []);
                setActiveLeads(leadsRes.data?.leads || []);
                const allBids = bidsRes.data?.bids || [];
                setPurchasedLeads(allBids.filter((b: any) => b.status === 'ACCEPTED' || b.status === 'WON'));
            } catch (error) {
                console.error('Poll fetch error:', error);
            }
        };
        fetchData();
    }, []);

    // Real-time socket listeners
    useSocketEvents(
        {
            'marketplace:bid:update': (data: any) => {
                if (data?.leadId) {
                    setActiveLeads((prev) =>
                        prev.map((lead) =>
                            lead.id === data.leadId
                                ? {
                                    ...lead,
                                    _count: { ...lead._count, bids: data.bidCount },
                                    auctionRoom: lead.auctionRoom
                                        ? { ...lead.auctionRoom, highestBid: data.highestBid, bidCount: data.bidCount }
                                        : undefined,
                                }
                                : lead,
                        ),
                    );
                    toast({
                        type: 'info',
                        title: 'Bid Update',
                        description: `New bid on an active lead`,
                        duration: 3000,
                    });
                }
            },
            'marketplace:lead:new': (data: any) => {
                if (data?.lead?.status === 'IN_AUCTION') {
                    setActiveLeads((prev) => [data.lead, ...prev].slice(0, 6));
                    toast({ type: 'info', title: 'New Auction', description: `${data.lead.vertical} lead now live` });
                }
            },
            'marketplace:refreshAll': () => {
                refetchData();
            },
        },
        refetchData,
    );

    const stats = [
        { label: 'Total Bids', value: overview?.totalBids || 0, icon: Gavel, color: 'text-primary' },
        { label: 'Won Bids', value: overview?.wonBids || 0, icon: Target, color: 'text-emerald-500' },
        { label: 'Win Rate', value: `${overview?.winRate || 0}%`, icon: TrendingUp, color: 'text-chainlink-steel' },
        { label: 'Total Spent', value: formatCurrency(overview?.totalSpent || 0), icon: DollarSign, color: 'text-amber-500' },
    ];

    // Client-side filtering for bids and purchased leads
    const q = debouncedSearch.toLowerCase();
    const filteredBids = useMemo(() =>
        q ? recentBids.filter((b: any) =>
            b.lead?.vertical?.toLowerCase().includes(q) ||
            b.lead?.id?.toLowerCase().startsWith(q) ||
            b.lead?.geo?.state?.toLowerCase().includes(q) ||
            b.lead?.geo?.city?.toLowerCase().includes(q)
        ) : recentBids,
        [recentBids, q]);
    const filteredPurchased = useMemo(() =>
        q ? purchasedLeads.filter((b: any) =>
            b.lead?.vertical?.toLowerCase().includes(q) ||
            b.lead?.id?.toLowerCase().startsWith(q) ||
            b.lead?.geo?.state?.toLowerCase().includes(q) ||
            b.lead?.geo?.city?.toLowerCase().includes(q)
        ) : purchasedLeads,
        [purchasedLeads, q]);

    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Buyer Dashboard</h1>
                        <p className="text-muted-foreground">Track bids, auto-bid activity, and CRM pipeline</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <CRMExportButton />
                        <Button variant="outline" asChild>
                            <Link to="/marketplace?view=asks">
                                <Tag className="h-4 w-4 mr-2" />
                                Browse Asks
                            </Link>
                        </Button>
                        <Button asChild>
                            <Link to="/marketplace">Browse Marketplace</Link>
                        </Button>
                    </div>
                </div>

                {/* Search & Seller Filter */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="max-w-md flex-1">
                        <Input
                            placeholder="Search by lead ID, vertical, or location..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            icon={<Search className="h-4 w-4" />}
                        />
                    </div>
                    <div className="relative w-full sm:w-56" ref={sellerDropdownRef}>
                        <Input
                            placeholder="Filter by seller..."
                            value={sellerInput}
                            onChange={(e) => {
                                setSellerInput(e.target.value);
                                if (!e.target.value) { setSellerName(''); setShowSellerDropdown(false); }
                            }}
                            onFocus={() => sellerSuggestions.length > 0 && setShowSellerDropdown(true)}
                            icon={<Users className="h-4 w-4" />}
                        />
                        {showSellerDropdown && sellerSuggestions.length > 0 && (
                            <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-lg shadow-xl max-h-60 overflow-auto">
                                {sellerSuggestions.map((s) => (
                                    <button
                                        key={s.id}
                                        className="w-full px-3 py-2.5 text-left hover:bg-muted/60 flex items-center justify-between gap-2 text-sm transition-colors"
                                        onClick={() => { setSellerName(s.companyName); setSellerInput(s.companyName); setShowSellerDropdown(false); }}
                                    >
                                        <span className="truncate font-medium">{s.companyName}</span>
                                        <span className="flex items-center gap-1 shrink-0">
                                            <Star className="h-3 w-3 text-amber-500" />
                                            <span className="text-xs text-muted-foreground">{(Number(s.reputationScore) / 100).toFixed(0)}%</span>
                                            {s.isVerified && <Badge variant="outline" className="text-[10px] px-1 py-0 text-emerald-500 border-emerald-500/30">✓</Badge>}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
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

                {/* ── On-Chain Escrow Vault ── */}
                <Card>
                    <CardHeader className="flex-row items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                            <Wallet className="h-5 w-5 text-teal-500" />
                            On-Chain Escrow Vault
                        </CardTitle>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-teal-500 border-teal-500/30 font-mono">
                                {formatCurrency(vaultBalance)} USDC
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <p className="text-xs text-muted-foreground mb-4">
                            Your vault balance is stored on-chain in the PersonalEscrowVault contract.
                            Deposit USDC via the USDC Allowance card above, then record the deposit here.
                            Bids automatically lock funds on-chain; losers are refunded automatically.
                        </p>
                        <div className="grid sm:grid-cols-3 gap-4">
                            {/* Deposit */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Fund Vault</label>
                                <div className="flex gap-2">
                                    <Input
                                        type="number"
                                        placeholder="$50.00"
                                        value={depositAmount}
                                        onChange={(e) => setDepositAmount(e.target.value)}
                                        min="1"
                                        step="0.01"
                                    />
                                    <Button
                                        size="sm"
                                        disabled={vaultLoading || !depositAmount || Number(depositAmount) <= 0}
                                        onClick={async () => {
                                            setVaultLoading(true);
                                            const amt = Number(depositAmount);
                                            // For demo: record deposit via API (in production, this is triggered after on-chain tx)
                                            const { data } = await api.depositVault(amt, 'demo-deposit');
                                            if (data?.success) {
                                                setVaultBalance(data.balance);
                                                setDepositAmount('');
                                                toast({ type: 'success', title: 'Vault Funded', description: `Deposited $${amt.toFixed(2)} USDC` });
                                                api.getVault().then(({ data: d }) => d && setVaultTxs(d.transactions?.slice(0, 5) || []));
                                            }
                                            setVaultLoading(false);
                                        }}
                                        className="shrink-0"
                                    >
                                        <ArrowDown className="h-4 w-4 mr-1" /> Deposit
                                    </Button>
                                </div>
                            </div>

                            {/* Withdraw */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Withdraw</label>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={vaultLoading || vaultBalance <= 0}
                                    onClick={async () => {
                                        setVaultLoading(true);
                                        try {
                                            const { data } = await api.withdrawVault(vaultBalance);
                                            if (data?.success) {
                                                setVaultBalance(data.balance);
                                                toast({ type: 'success', title: 'Withdrawn', description: `Withdrew $${vaultBalance.toFixed(2)} USDC from vault` });
                                                api.getVault().then(({ data: d }) => d && setVaultTxs(d.transactions?.slice(0, 5) || []));
                                            } else {
                                                toast({ type: 'error', title: 'Withdraw Failed', description: data?.error || 'Unknown error' });
                                            }
                                        } catch (err: any) {
                                            toast({ type: 'error', title: 'Withdraw Failed', description: err.message || 'Failed to withdraw' });
                                        }
                                        setVaultLoading(false);
                                    }}
                                    className="w-full h-9"
                                >
                                    <ArrowUp className="h-4 w-4 mr-1" /> Withdraw (via Wallet)
                                </Button>
                                <p className="text-xs text-muted-foreground">Funds return to your wallet on-chain</p>
                            </div>

                            {/* Recent Vault Transactions */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Recent Activity</label>
                                {vaultTxs.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No vault transactions yet</p>
                                ) : (
                                    <div className="space-y-1 max-h-32 overflow-auto">
                                        {vaultTxs.map((tx: any) => (
                                            <div key={tx.id} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                                                <span className={
                                                    tx.type === 'DEPOSIT' || tx.type === 'REFUND' ? 'text-emerald-500'
                                                        : tx.type === 'DEDUCT' || tx.type === 'FEE' ? 'text-red-400'
                                                            : 'text-amber-500'
                                                }>
                                                    {tx.type === 'DEPOSIT' ? '+' : tx.type === 'REFUND' ? '+' : '-'}${tx.amount.toFixed(2)}
                                                </span>
                                                <span className="text-muted-foreground truncate ml-2">{tx.type}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Bounty Pools */}
                <BountyPanel />

                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Recent Bids */}
                    <Card className="lg:col-span-1">
                        <CardHeader className="flex-row items-center justify-between">
                            <CardTitle>Recent Bids</CardTitle>
                            <Button variant="ghost" size="sm" asChild>
                                <Link to="/buyer/bids">View All</Link>
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="space-y-4">
                                    {[1, 2, 3].map((i) => (
                                        <div key={i} className="animate-shimmer h-16 rounded-xl" />
                                    ))}
                                </div>
                            ) : filteredBids.length === 0 ? (
                                <div className="text-center py-8">
                                    <p className="text-muted-foreground mb-3">No bids yet</p>
                                    <p className="text-sm text-muted-foreground mb-4">
                                        Browse the marketplace or enable auto-bid to start bidding automatically.
                                    </p>
                                    <div className="flex gap-2 justify-center">
                                        <Button variant="outline" size="sm" asChild>
                                            <Link to="/">Browse Marketplace</Link>
                                        </Button>
                                        <Button size="sm" asChild>
                                            <Link to="/buyer/preferences">Setup Auto-Bid</Link>
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {filteredBids.map((bid) => (
                                        <div key={bid.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                    <Gavel className="h-5 w-5 text-primary" />
                                                </div>
                                                <div>
                                                    <div className="font-medium text-sm capitalize">
                                                        {bid.lead?.vertical || 'Lead'}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {new Date(bid.createdAt).toLocaleDateString()}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-semibold">
                                                    {bid.amount ? formatCurrency(bid.amount) : (() => {
                                                        const sealed = formatSealedBid(bid.commitment);
                                                        return sealed.isRevealed
                                                            ? <span title="Sealed bid (not yet revealed)">{sealed.display}</span>
                                                            : <span className="text-muted-foreground">Sealed</span>;
                                                    })()}
                                                </div>
                                                <Badge variant="outline" className={getStatusColor(bid.status)}>
                                                    {bid.status}
                                                </Badge>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Active Leads */}
                    <div className="lg:col-span-2">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold">Live Auctions</h2>
                            <Button variant="outline" size="sm" asChild>
                                <Link to="/">
                                    See All <ArrowUpRight className="h-4 w-4 ml-1" />
                                </Link>
                            </Button>
                        </div>

                        {isLoading ? (
                            <div className="grid md:grid-cols-2 gap-4">
                                {[1, 2, 3, 4].map((i) => (
                                    <SkeletonCard key={i} />
                                ))}
                            </div>
                        ) : activeLeads.length === 0 ? (
                            <Card className="p-8 text-center">
                                <p className="text-muted-foreground">No active auctions matching your preferences</p>
                                <Button variant="outline" className="mt-4" asChild>
                                    <Link to="/buyer/preferences">Auto Bidding Settings</Link>
                                </Button>
                            </Card>
                        ) : (
                            <div className="grid md:grid-cols-2 gap-4">
                                {activeLeads.map((lead) => (
                                    <LeadCard key={lead.id} lead={lead} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Purchased Leads — Table View */}
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                            <CheckCircle className="h-5 w-5 text-emerald-500" />
                            Purchased Leads
                        </h2>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">
                                {filteredPurchased.length} won
                            </Badge>
                            <Button variant="ghost" size="sm" asChild>
                                <Link to="/buyer/portfolio">View All</Link>
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleExportPurchasedCSV}
                                disabled={filteredPurchased.length === 0 || csvExporting}
                                className="gap-1.5"
                            >
                                {csvExporting ? (
                                    <><CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> Exported!</>
                                ) : (
                                    <><Download className="h-3.5 w-3.5" /> Export CSV</>
                                )}
                            </Button>
                        </div>
                    </div>
                    {filteredPurchased.length === 0 ? (
                        <Card className="p-12 text-center">
                            <CheckCircle className="h-10 w-10 text-muted-foreground/25 mx-auto mb-3" />
                            <p className="text-base font-medium mb-1">No purchased leads yet</p>
                            <p className="text-sm text-muted-foreground max-w-md mx-auto">
                                Win auctions or use Buy Now to build your lead portfolio.
                            </p>
                            <Button variant="outline" className="mt-5" asChild>
                                <Link to="/">Browse Marketplace</Link>
                            </Button>
                        </Card>
                    ) : (
                        <Card className="overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Vertical</th>
                                            <th>Location</th>
                                            <th>Amount Paid</th>
                                            <th>NFT ID</th>
                                            <th>Date</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredPurchased.map((bid) => (
                                            <tr key={bid.id}>
                                                <td>
                                                    <span className="font-medium capitalize">{bid.lead?.vertical || 'Lead'}</span>
                                                </td>
                                                <td>
                                                    <span className="flex items-center gap-1 text-muted-foreground text-sm">
                                                        <MapPin className="h-3 w-3" />
                                                        {bid.lead?.geo?.city ? `${bid.lead.geo.city}, ` : ''}{bid.lead?.geo?.state || 'Unknown'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="font-semibold">{formatCurrency(bid.amount || 0)}</span>
                                                </td>
                                                <td>
                                                    {bid.lead?.nftTokenId ? (
                                                        <span className="font-mono text-xs text-violet-400">
                                                            #{bid.lead.nftTokenId.slice(0, 8)}…
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground text-xs">—</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <span className="text-sm text-muted-foreground">
                                                        {new Date(bid.updatedAt || bid.createdAt).toLocaleDateString()}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div className="flex items-center gap-1.5">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 px-2 text-xs"
                                                            onClick={() => handleCrmPushSingle(bid.lead?.id || bid.id)}
                                                            disabled={crmPushed.has(bid.lead?.id || bid.id)}
                                                        >
                                                            {crmPushed.has(bid.lead?.id || bid.id) ? (
                                                                <><CheckCircle className="h-3 w-3 text-emerald-500" /> Pushed</>
                                                            ) : (
                                                                <><Send className="h-3 w-3" /> CRM</>
                                                            )}
                                                        </Button>
                                                        {bid.lead?.id && (
                                                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
                                                                <Link to={`/lead/${bid.lead.id}`}>
                                                                    View <ArrowUpRight className="h-3 w-3 ml-0.5" />
                                                                </Link>
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    )}
                </div>
            </div>
        </DashboardLayout>
    );
}

export default BuyerDashboard;
