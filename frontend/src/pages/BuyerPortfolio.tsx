import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
    Briefcase,
    MapPin,
    Shield,
    Calendar,
    ArrowUpRight,
    Tag,
    Search,
    ExternalLink,
    LayoutGrid,
    List,
    Download,
    Send,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    CheckCircle,
    Square,
    CheckSquare,
    Unlock,
    Lock,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/Tooltip';
import { SkeletonTable } from '@/components/ui/skeleton';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { useSocketEvents } from '@/hooks/useSocketEvents';

// ─── Skeleton Card ──────────────────────────

function SkeletonCard() {
    return (
        <Card className="animate-pulse">
            <CardContent className="p-5">
                <div className="h-5 w-28 bg-muted rounded mb-3" />
                <div className="h-4 w-36 bg-muted/60 rounded mb-4" />
                <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="h-12 bg-muted/40 rounded-lg" />
                    <div className="h-12 bg-muted/40 rounded-lg" />
                </div>
                <div className="h-9 bg-muted/30 rounded-lg" />
            </CardContent>
        </Card>
    );
}

// ─── CRE Quality Score Badge ────────────────

function CREBadge({ score }: { score: number }) {
    const displayed = Math.floor(score / 100); // 0-10,000 → 0-100
    const color =
        displayed >= 70 ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' :
            displayed >= 50 ? 'text-amber-400 bg-amber-500/15 border-amber-500/30' :
                'text-red-400 bg-red-500/15 border-red-500/30';
    return (
        <Tooltip content={`CRE Quality Score: ${displayed}/100 — CRE DON Match + Quality Score (pending on-chain scoring)`}>
            <Badge variant="outline" className={`text-xs ${color}`}>
                <Shield className="h-3 w-3 mr-1" />
                CRE {displayed}/100
            </Badge>
        </Tooltip>
    );
}

// ─── ACE Compliance Badge ────────────────────

function ACEBadge({ compliant }: { compliant: boolean }) {
    return (
        <Tooltip content={compliant
            ? 'ACE Compliance: on-chain check passed — caller is compliant with all active policies'
            : 'ACE Compliance: on-chain check failed — caller did not pass active policies'}>
            <Badge variant="outline" className={`text-xs ${compliant
                ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30'
                : 'text-red-400 bg-red-500/15 border-red-500/30'
                }`}>
                {compliant ? '✓' : '✗'} ACE
            </Badge>
        </Tooltip>
    );
}

// ─── Sort Types ─────────────────────────────

type SortKey = 'vertical' | 'amount' | 'date' | 'qualityScore' | 'nftTokenId';
type SortDir = 'asc' | 'desc';

// ─── Page Component ─────────────────────────

export function BuyerPortfolio() {
    const [leads, setLeads] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 300);
    const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [crmPushed, setCrmPushed] = useState<Set<string>>(new Set());
    const [csvExporting, setCsvExporting] = useState(false);
    const [decryptedPII, setDecryptedPII] = useState<Record<string, any>>({});
    const [decryptingId, setDecryptingId] = useState<string | null>(null);

    const handleDecryptPII = async (leadId: string) => {
        setDecryptingId(leadId);
        try {
            const result = await api.demoDecryptPII(leadId);
            if ('data' in result && result.data?.success) {
                setDecryptedPII(prev => ({ ...prev, [leadId]: result.data!.pii }));
            }
        } catch (err) {
            console.error('Decrypt PII failed:', err);
        } finally {
            setDecryptingId(null);
        }
    };

    const fetchPortfolio = useCallback(async () => {
        try {
            const bidsRes = await api.getMyBids();
            const allBids = bidsRes.data?.bids || [];
            const won = allBids.filter(
                (b: any) => b.status === 'ACCEPTED' || b.status === 'WON',
            );
            setLeads(won);
        } catch (error) {
            console.error('Portfolio fetch error:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchPortfolio(); }, [fetchPortfolio]);

    // Real-time updates
    useSocketEvents(
        { 'marketplace:refreshAll': () => { fetchPortfolio(); } },
        fetchPortfolio,
    );

    // Search filter
    const q = debouncedSearch.toLowerCase();
    const filtered = useMemo(
        () =>
            q
                ? leads.filter(
                    (b: any) =>
                        b.lead?.vertical?.toLowerCase().includes(q) ||
                        b.lead?.id?.toLowerCase().startsWith(q) ||
                        b.lead?.geo?.state?.toLowerCase().includes(q) ||
                        b.lead?.geo?.city?.toLowerCase().includes(q),
                )
                : leads,
        [leads, q],
    );

    // Sorted data
    const sorted = useMemo(() => {
        const arr = [...filtered];
        arr.sort((a, b) => {
            let cmp = 0;
            switch (sortKey) {
                case 'vertical':
                    cmp = (a.lead?.vertical || '').localeCompare(b.lead?.vertical || '');
                    break;
                case 'amount':
                    cmp = (a.amount || 0) - (b.amount || 0);
                    break;
                case 'date':
                    cmp = new Date(a.updatedAt || a.createdAt).getTime() - new Date(b.updatedAt || b.createdAt).getTime();
                    break;
                case 'qualityScore':
                    cmp = (a.lead?.qualityScore || 0) - (b.lead?.qualityScore || 0);
                    break;
                case 'nftTokenId':
                    cmp = (a.lead?.nftTokenId || '').localeCompare(b.lead?.nftTokenId || '');
                    break;
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return arr;
    }, [filtered, sortKey, sortDir]);

    // Stats
    const totalSpent = leads.reduce((sum, b) => sum + (b.amount || 0), 0);
    const verticals = [...new Set(leads.map((b) => b.lead?.vertical).filter(Boolean))];

    // Sort handler
    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const SortIcon = ({ col }: { col: SortKey }) => {
        if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
        return sortDir === 'asc'
            ? <ArrowUp className="h-3 w-3 ml-1 text-foreground" />
            : <ArrowDown className="h-3 w-3 ml-1 text-foreground" />;
    };

    // Bulk selection
    const allSelected = sorted.length > 0 && selected.size === sorted.length;
    const toggleAll = () => {
        if (allSelected) {
            setSelected(new Set());
        } else {
            setSelected(new Set(sorted.map(b => b.id)));
        }
    };
    const toggleOne = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    // CSV Export
    const handleExportCSV = () => {
        const exportData = sorted.filter(b => selected.size === 0 || selected.has(b.id));
        if (exportData.length === 0) return;
        setCsvExporting(true);
        const headers = ['Lead ID', 'Vertical', 'State', 'City', 'Purchase Price', 'Quality Score', 'NFT Token ID', 'Purchase Date'];
        const rows = exportData.map((b: any) => [
            b.lead?.id || '',
            b.lead?.vertical || '',
            b.lead?.geo?.state || '',
            b.lead?.geo?.city || '',
            b.amount || '',
            b.lead?.qualityScore != null ? Math.floor(b.lead.qualityScore / 100) : '',
            b.lead?.nftTokenId || '',
            b.updatedAt ? new Date(b.updatedAt).toISOString() : new Date(b.createdAt).toISOString(),
        ].join(','));
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `portfolio-leads-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setTimeout(() => setCsvExporting(false), 1500);
    };

    // CRM Push
    const handleCrmPush = () => {
        const ids = selected.size > 0 ? [...selected] : sorted.map(b => b.lead?.id || b.id);
        ids.forEach(id => setCrmPushed(prev => new Set(prev).add(id)));
        // In production, this would POST to /api/v1/crm/push
    };

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center gap-3">
                            <Briefcase className="h-8 w-8 text-primary" />
                            My Portfolio
                        </h1>
                        <p className="text-muted-foreground mt-1 text-sm">
                            All purchased LeadNFTs with full lead data and on-chain provenance
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button asChild variant="outline" size="sm">
                            <Link to="/marketplace">Browse Marketplace</Link>
                        </Button>
                    </div>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card className="p-5">
                        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Leads Owned</div>
                        <div className="text-2xl font-bold mt-1">{leads.length}</div>
                    </Card>
                    <Card className="p-5">
                        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Invested</div>
                        <div className="text-2xl font-bold mt-1">{formatCurrency(totalSpent)}</div>
                    </Card>
                    <Card className="p-5">
                        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Verticals</div>
                        <div className="text-2xl font-bold mt-1">{verticals.length}</div>
                    </Card>
                </div>

                {/* Toolbar: Search + View Toggle + Bulk Actions */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1">
                        <div className="max-w-sm flex-1">
                            <Input
                                placeholder="Search by vertical, location, or lead ID..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                icon={<Search className="h-4 w-4" />}
                            />
                        </div>
                        {/* View Toggle */}
                        <div className="flex gap-1 p-1 rounded-lg bg-muted">
                            <button
                                onClick={() => setViewMode('table')}
                                className={`p-1.5 rounded-md transition ${viewMode === 'table' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                title="Table view"
                            >
                                <List className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => setViewMode('card')}
                                className={`p-1.5 rounded-md transition ${viewMode === 'card' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                title="Card view"
                            >
                                <LayoutGrid className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* Bulk Actions */}
                    <div className="flex items-center gap-2">
                        {selected.size > 0 && (
                            <Badge variant="secondary" className="text-xs">
                                {selected.size} selected
                            </Badge>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleExportCSV}
                            disabled={sorted.length === 0 || csvExporting}
                            className="gap-1.5"
                        >
                            {csvExporting ? (
                                <><CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> Exported!</>
                            ) : (
                                <><Download className="h-3.5 w-3.5" /> Export CSV</>
                            )}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCrmPush}
                            disabled={sorted.length === 0}
                            className="gap-1.5"
                        >
                            <Send className="h-3.5 w-3.5" />
                            Push to CRM
                        </Button>
                    </div>
                </div>

                {/* Content */}
                {isLoading ? (
                    viewMode === 'table' ? (
                        <Card className="p-4">
                            <SkeletonTable rows={6} />
                        </Card>
                    ) : (
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {[1, 2, 3, 4, 5, 6].map((i) => (
                                <SkeletonCard key={i} />
                            ))}
                        </div>
                    )
                ) : sorted.length === 0 ? (
                    <Card className="p-12 text-center">
                        <Briefcase className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                        <p className="text-lg font-medium text-foreground mb-1">
                            {q ? 'No leads match your search' : 'No leads in your portfolio yet'}
                        </p>
                        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                            Win auctions or purchase leads via Buy Now to build your portfolio.
                        </p>
                        <Button variant="outline" className="mt-6" asChild>
                            <Link to="/marketplace">Browse Marketplace</Link>
                        </Button>
                    </Card>
                ) : viewMode === 'table' ? (
                    /* ───────── TABLE VIEW ───────── */
                    <Card className="overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th className="w-10">
                                            <button onClick={toggleAll} className="p-1 hover:text-foreground transition-colors">
                                                {allSelected
                                                    ? <CheckSquare className="h-4 w-4 text-primary" />
                                                    : <Square className="h-4 w-4" />}
                                            </button>
                                        </th>
                                        <th className="sortable" onClick={() => handleSort('nftTokenId')}>
                                            <span className="inline-flex items-center">NFT ID <SortIcon col="nftTokenId" /></span>
                                        </th>
                                        <th className="sortable" onClick={() => handleSort('vertical')}>
                                            <span className="inline-flex items-center">Vertical <SortIcon col="vertical" /></span>
                                        </th>
                                        <th>Location</th>
                                        <th className="sortable" onClick={() => handleSort('amount')}>
                                            <span className="inline-flex items-center">Purchase Price <SortIcon col="amount" /></span>
                                        </th>
                                        <th className="sortable" onClick={() => handleSort('date')}>
                                            <span className="inline-flex items-center">Date <SortIcon col="date" /></span>
                                        </th>
                                        <th className="sortable" onClick={() => handleSort('qualityScore')}>
                                            <span className="inline-flex items-center">Quality <SortIcon col="qualityScore" /></span>
                                        </th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((bid) => {
                                        const lead = bid.lead;
                                        const geo = lead?.geo;
                                        const location = [geo?.city, geo?.state].filter(Boolean).join(', ') || '—';
                                        const isSelected = selected.has(bid.id);
                                        return (
                                            <tr key={bid.id} className={isSelected ? 'bg-primary/5' : ''}>
                                                <td>
                                                    <button onClick={() => toggleOne(bid.id)} className="p-1 hover:text-foreground transition-colors">
                                                        {isSelected
                                                            ? <CheckSquare className="h-4 w-4 text-primary" />
                                                            : <Square className="h-4 w-4 text-muted-foreground" />}
                                                    </button>
                                                </td>
                                                <td>
                                                    {lead?.nftTokenId ? (
                                                        <span className="font-mono text-xs text-violet-400">
                                                            #{lead.nftTokenId.slice(0, 8)}…
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted-foreground text-xs">—</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <span className="font-medium capitalize">{lead?.vertical || 'Lead'}</span>
                                                </td>
                                                <td>
                                                    <span className="flex items-center gap-1 text-muted-foreground">
                                                        <MapPin className="h-3 w-3" />
                                                        {location}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="font-semibold">{formatCurrency(bid.amount || 0)}</span>
                                                </td>
                                                <td>
                                                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                                                        <Calendar className="h-3 w-3" />
                                                        {new Date(bid.updatedAt || bid.createdAt).toLocaleDateString()}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div className="flex items-center gap-1.5">
                                                        {lead?.qualityScore != null ? (
                                                            <CREBadge score={lead.qualityScore} />
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground">—</span>
                                                        )}
                                                        {lead?.aceCompliant != null && (
                                                            <ACEBadge compliant={lead.aceCompliant} />
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="flex items-center gap-1.5">
                                                        {lead?.id && (
                                                            <Button variant="ghost" size="sm" asChild className="h-7 px-2 text-xs">
                                                                <Link to={`/lead/${lead.id}`}>
                                                                    View <ArrowUpRight className="h-3 w-3 ml-0.5" />
                                                                </Link>
                                                            </Button>
                                                        )}
                                                        {lead?.id && !decryptedPII[lead.id] && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-7 px-2 text-xs text-purple-400 hover:text-purple-300"
                                                                onClick={() => handleDecryptPII(lead.id)}
                                                                disabled={decryptingId === lead.id}
                                                            >
                                                                <Unlock className="h-3 w-3 mr-0.5" />
                                                                {decryptingId === lead.id ? 'Decrypting…' : 'Decrypt PII'}
                                                            </Button>
                                                        )}
                                                        {lead?.id && decryptedPII[lead.id] && (
                                                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                                                                <Lock className="h-3 w-3" /> PII Unlocked
                                                            </span>
                                                        )}
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 px-2 text-xs"
                                                            onClick={() => setCrmPushed(prev => new Set(prev).add(lead?.id || bid.id))}
                                                            disabled={crmPushed.has(lead?.id || bid.id)}
                                                        >
                                                            {crmPushed.has(lead?.id || bid.id)
                                                                ? <><CheckCircle className="h-3 w-3 text-emerald-500" /> Pushed</>
                                                                : <><Send className="h-3 w-3" /> CRM</>}
                                                        </Button>
                                                    </div>
                                                    {lead?.id && decryptedPII[lead.id] && (
                                                        <div className="mt-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5">
                                                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                                                                <span className="text-muted-foreground">Name</span>
                                                                <span className="text-foreground font-medium">{decryptedPII[lead.id].firstName} {decryptedPII[lead.id].lastName}</span>
                                                                <span className="text-muted-foreground">Email</span>
                                                                <span className="text-foreground font-medium">{decryptedPII[lead.id].email}</span>
                                                                <span className="text-muted-foreground">Phone</span>
                                                                <span className="text-foreground font-medium">{decryptedPII[lead.id].phone}</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                ) : (
                    /* ───────── CARD VIEW ───────── */
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {sorted.map((bid) => {
                            const lead = bid.lead;
                            const geo = lead?.geo;
                            const location = [geo?.city, geo?.state]
                                .filter(Boolean)
                                .join(', ') || 'Unknown';

                            return (
                                <Card key={bid.id} className="group hover:border-primary/40 transition-colors">
                                    <CardContent className="p-5">
                                        {/* Header */}
                                        <div className="flex items-start justify-between mb-3">
                                            <div>
                                                <h3 className="font-semibold capitalize text-base">
                                                    {lead?.vertical || 'Lead'}
                                                </h3>
                                                <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                                                    <MapPin className="h-3 w-3" />
                                                    {location}
                                                </div>
                                            </div>
                                            {lead?.qualityScore != null && (
                                                <CREBadge score={lead.qualityScore} />
                                            )}
                                            {lead?.aceCompliant != null && (
                                                <ACEBadge compliant={lead.aceCompliant} />
                                            )}
                                        </div>

                                        {/* NFT Badge */}
                                        {lead?.nftTokenId && (
                                            <div className="flex items-center gap-1.5 mb-3 px-2 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 text-xs font-medium">
                                                <ExternalLink className="h-3 w-3" />
                                                NFT #{lead.nftTokenId.slice(0, 8)}…
                                                {lead.nftContractAddr && (
                                                    <span className="text-[10px] text-muted-foreground ml-auto">
                                                        {lead.nftContractAddr.slice(0, 6)}…{lead.nftContractAddr.slice(-4)}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {/* Metrics */}
                                        <div className="grid grid-cols-2 gap-3 mb-4">
                                            <div className="rounded-lg bg-muted/30 p-2.5">
                                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                                    Purchase Price
                                                </div>
                                                <div className="text-sm font-bold mt-0.5">
                                                    {formatCurrency(bid.amount || 0)}
                                                </div>
                                            </div>
                                            <div className="rounded-lg bg-muted/30 p-2.5">
                                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                                    Purchased
                                                </div>
                                                <div className="text-sm font-medium mt-0.5 flex items-center gap-1">
                                                    <Calendar className="h-3 w-3" />
                                                    {new Date(bid.updatedAt || bid.createdAt).toLocaleDateString()}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Buy Now price if available */}
                                        {lead?.buyNowPrice && (
                                            <div className="flex items-center gap-1.5 mb-3 text-xs text-muted-foreground">
                                                <Tag className="h-3 w-3" />
                                                Buy Now: {formatCurrency(lead.buyNowPrice)}
                                            </div>
                                        )}

                                        {/* Action Buttons */}
                                        <div className="flex gap-2">
                                            {lead?.id && (
                                                <Button variant="default" size="sm" className="flex-1" asChild>
                                                    <Link to={`/lead/${lead.id}`}>
                                                        View Full Lead
                                                        <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                                                    </Link>
                                                </Button>
                                            )}
                                            {lead?.id && !decryptedPII[lead.id] && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
                                                    onClick={() => handleDecryptPII(lead.id)}
                                                    disabled={decryptingId === lead.id}
                                                >
                                                    <Unlock className="h-3.5 w-3.5 mr-1" />
                                                    {decryptingId === lead.id ? 'Decrypting…' : 'Decrypt PII'}
                                                </Button>
                                            )}
                                        </div>
                                        {lead?.id && decryptedPII[lead.id] && (
                                            <div className="mt-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                                                <div className="flex items-center gap-1.5 mb-1">
                                                    <Lock className="h-3 w-3 text-emerald-400" />
                                                    <span className="text-[10px] font-bold text-emerald-400">Decrypted PII — CRE DON Attested</span>
                                                </div>
                                                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                                                    <span className="text-muted-foreground">Name</span>
                                                    <span className="text-foreground font-medium">{decryptedPII[lead.id].firstName} {decryptedPII[lead.id].lastName}</span>
                                                    <span className="text-muted-foreground">Email</span>
                                                    <span className="text-foreground font-medium">{decryptedPII[lead.id].email}</span>
                                                    <span className="text-muted-foreground">Phone</span>
                                                    <span className="text-foreground font-medium">{decryptedPII[lead.id].phone}</span>
                                                </div>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}

export default BuyerPortfolio;
