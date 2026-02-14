import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
    Briefcase,
    MapPin,
    Clock,
    Star,
    ArrowUpRight,
    Search,
    Download,
    CheckCircle,
    ExternalLink,
    Send,
    Tag,
    Shield,
    RefreshCw,
    Zap,
    Eye,
    EyeOff,
    User,
    Mail,
    Phone,
    Home,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { GlassCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SkeletonCard } from '@/components/ui/skeleton';
import { VerticalBreadcrumb } from '@/components/ui/VerticalBreadcrumb';
import { ChainlinkBadge } from '@/components/ui/ChainlinkBadge';
import { formatCurrency } from '@/lib/utils';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSocketEvents } from '@/hooks/useSocketEvents';

// ─── Quality Score Meter ─────────────────────
function QualityMeter({ score }: { score: number }) {
    const pct = Math.min(Math.max((score / 10000) * 100, 0), 100);
    const color = pct >= 70 ? 'text-emerald-500' : pct >= 40 ? 'text-amber-500' : 'text-red-500';
    const bg = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${bg}`} style={{ width: `${pct}%` }} />
            </div>
            <span className={`text-xs font-semibold ${color}`}>{(score / 100).toFixed(0)}%</span>
        </div>
    );
}

// ─── Page Component ──────────────────────────

export function BuyerPortfolio() {
    const [purchasedLeads, setPurchasedLeads] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 300);
    const [csvExporting, setCsvExporting] = useState(false);
    const [crmPushed, setCrmPushed] = useState<Set<string>>(new Set());
    const [expandedLead, setExpandedLead] = useState<string | null>(null);
    const [decryptedData, setDecryptedData] = useState<Record<string, any>>({});
    const [decryptLoading, setDecryptLoading] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const { data } = await api.getMyBids();
            const allBids = data?.bids || [];
            setPurchasedLeads(allBids.filter((b: any) => b.status === 'ACCEPTED' || b.status === 'WON'));
        } catch (error) {
            console.error('Portfolio fetch error:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Real-time updates
    useSocketEvents(
        {
            'marketplace:refreshAll': () => fetchData(),
            'lead:buy-now-sold': () => fetchData(),
            'lead:auction-started': () => fetchData(),
        },
        fetchData,
    );

    // View Full Lead — decrypt + expand
    const handleViewFull = async (leadId: string) => {
        if (expandedLead === leadId) {
            setExpandedLead(null);
            return;
        }
        // Already cached?
        if (decryptedData[leadId]) {
            setExpandedLead(leadId);
            return;
        }
        setDecryptLoading(leadId);
        try {
            const { data, error } = await api.getLeadDecrypted(leadId);
            if (error) {
                // Fallback: show placeholder when endpoint isn't live yet
                setDecryptedData((prev) => ({
                    ...prev,
                    [leadId]: { firstName: '—', lastName: '—', email: '—', phone: '—', _placeholder: true },
                }));
            } else {
                setDecryptedData((prev) => ({ ...prev, [leadId]: data?.lead || {} }));
            }
            setExpandedLead(leadId);
        } catch {
            setDecryptedData((prev) => ({
                ...prev,
                [leadId]: { firstName: '—', lastName: '—', email: '—', phone: '—', _placeholder: true },
            }));
            setExpandedLead(leadId);
        } finally {
            setDecryptLoading(null);
        }
    };

    // Filter
    const q = debouncedSearch.toLowerCase();
    const filtered = useMemo(() =>
        q ? purchasedLeads.filter((b: any) =>
            b.lead?.vertical?.toLowerCase().includes(q) ||
            b.lead?.id?.toLowerCase().startsWith(q) ||
            b.lead?.geo?.state?.toLowerCase().includes(q) ||
            b.lead?.geo?.city?.toLowerCase().includes(q)
        ) : purchasedLeads,
        [purchasedLeads, q]);

    // Export CSV
    const handleExportCSV = () => {
        if (filtered.length === 0) return;
        setCsvExporting(true);
        const headers = ['Lead ID', 'Vertical', 'State', 'City', 'Amount Paid', 'Quality Score', 'NFT Token ID', 'Purchased Date'];
        const rows = filtered.map((b: any) => [
            b.lead?.id || '',
            b.lead?.vertical || '',
            b.lead?.geo?.state || '',
            b.lead?.geo?.city || '',
            b.amount || '',
            b.lead?.qualityScore || '',
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

    const handleCrmPush = (leadId: string) => {
        setCrmPushed((prev) => new Set(prev).add(leadId));
    };

    // Stats
    const totalValue = filtered.reduce((sum: number, b: any) => sum + Number(b.amount || 0), 0);
    const avgQuality = filtered.length > 0
        ? filtered.reduce((sum: number, b: any) => sum + Number(b.lead?.qualityScore || 0), 0) / filtered.length
        : 0;

    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center gap-2">
                            <Briefcase className="h-8 w-8 text-primary" />
                            My Portfolio
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            All purchased Lead NFTs in one place
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleExportCSV}
                            disabled={filtered.length === 0 || csvExporting}
                            className="gap-1.5"
                        >
                            {csvExporting ? (
                                <><CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> Exported!</>
                            ) : (
                                <><Download className="h-3.5 w-3.5" /> Export CSV</>
                            )}
                        </Button>
                        <Button asChild>
                            <Link to="/marketplace">Browse Marketplace</Link>
                        </Button>
                    </div>
                </div>

                {/* Stats Strip */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <GlassCard className="p-5">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                                <Briefcase className="h-5 w-5" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold">{filtered.length}</div>
                                <div className="text-sm text-muted-foreground">Total Leads</div>
                            </div>
                        </div>
                    </GlassCard>
                    <GlassCard className="p-5">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500">
                                <Tag className="h-5 w-5" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
                                <div className="text-sm text-muted-foreground">Total Invested</div>
                            </div>
                        </div>
                    </GlassCard>
                    <GlassCard className="p-5">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
                                <Star className="h-5 w-5" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold">
                                    {avgQuality > 0 ? `${(avgQuality / 100).toFixed(0)}%` : '—'}
                                </div>
                                <div className="text-sm text-muted-foreground">Avg Quality</div>
                            </div>
                        </div>
                    </GlassCard>
                </div>

                {/* Search */}
                <div className="max-w-md">
                    <Input
                        placeholder="Search by vertical, location, or lead ID..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        icon={<Search className="h-4 w-4" />}
                    />
                </div>

                {/* Grid */}
                {isLoading ? (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <SkeletonCard key={i} />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <Card className="p-12 text-center">
                        <Briefcase className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold mb-2">No leads in your portfolio</h3>
                        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                            Win auctions or purchase leads via Buy Now to build your portfolio.
                        </p>
                        <div className="flex gap-3 justify-center">
                            <Button variant="outline" asChild>
                                <Link to="/buyer/preferences">Setup Auto-Bid</Link>
                            </Button>
                            <Button asChild>
                                <Link to="/marketplace">Browse Marketplace</Link>
                            </Button>
                        </div>
                    </Card>
                ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {filtered.map((bid: any) => {
                            const lead = bid.lead;
                            const leadId = lead?.id || bid.id;
                            return (
                                <Card
                                    key={bid.id}
                                    className="group hover:border-primary/40 transition-all duration-200 border-emerald-500/20"
                                >
                                    <CardContent className="p-5">
                                        {/* Header */}
                                        <div className="flex items-start justify-between mb-3">
                                            <div>
                                                <h3 className="font-semibold text-base">
                                                    <VerticalBreadcrumb slug={lead?.vertical || 'unknown'} />
                                                </h3>
                                                <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
                                                    <MapPin className="h-3 w-3" />
                                                    {lead?.geo?.city ? `${lead.geo.city}, ` : ''}{lead?.geo?.state || 'Unknown'}
                                                </div>
                                            </div>
                                            <Badge className="bg-emerald-500/15 text-emerald-500 border-0 text-xs">
                                                Won
                                            </Badge>
                                            <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/30 gap-1">
                                                <Zap className="h-2.5 w-2.5" />
                                                Smart Lightning
                                            </Badge>
                                        </div>

                                        {/* Quality Score */}
                                        {lead?.qualityScore != null && (
                                            <div className="mb-3">
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Quality Score</span>
                                                <QualityMeter score={lead.qualityScore} />
                                            </div>
                                        )}

                                        {/* Verification badges */}
                                        <div className="flex flex-wrap gap-1.5 mb-3">
                                            {lead?.isVerified && (
                                                <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 gap-1 text-[10px] px-1.5 py-0">
                                                    <Shield className="h-2.5 w-2.5" /> Verified
                                                </Badge>
                                            )}
                                            {lead?.seller?.isVerified && (
                                                <ChainlinkBadge size="sm" />
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

                                        {/* Pricing & Date */}
                                        <div className="flex items-center justify-between pt-3 border-t border-border">
                                            <div>
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Paid</span>
                                                <div className="text-lg font-bold gradient-text">{formatCurrency(bid.amount || 0)}</div>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Purchased</span>
                                                <div className="text-sm font-medium flex items-center gap-1">
                                                    <Clock className="h-3 w-3 text-muted-foreground" />
                                                    {new Date(bid.updatedAt || bid.createdAt).toLocaleDateString()}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Buy Now Price (current value) */}
                                        {lead?.buyNowPrice && (
                                            <div className="mt-2 text-right">
                                                <span className="text-[10px] text-muted-foreground">Current Value: </span>
                                                <span className="text-sm font-semibold text-green-500">{formatCurrency(lead.buyNowPrice)}</span>
                                            </div>
                                        )}

                                        {/* Actions */}
                                        <div className="flex gap-2 mt-4">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleCrmPush(leadId)}
                                                disabled={crmPushed.has(leadId)}
                                                className="flex-1 gap-1 text-xs"
                                            >
                                                {crmPushed.has(leadId) ? (
                                                    <><CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> Pushed</>
                                                ) : (
                                                    <><Send className="h-3.5 w-3.5" /> Push to CRM</>
                                                )}
                                            </Button>
                                            {lead?.id && lead?.nftTokenId && (
                                                <Button
                                                    variant={expandedLead === leadId ? 'default' : 'outline'}
                                                    size="sm"
                                                    className="flex-1 gap-1 text-xs"
                                                    onClick={() => handleViewFull(leadId)}
                                                    disabled={decryptLoading === leadId}
                                                >
                                                    {decryptLoading === leadId ? (
                                                        <><RefreshCw className="h-3 w-3 animate-spin" /> Decrypting…</>
                                                    ) : expandedLead === leadId ? (
                                                        <><EyeOff className="h-3 w-3" /> Hide Data</>
                                                    ) : (
                                                        <><Eye className="h-3 w-3" /> View Full Lead</>
                                                    )}
                                                </Button>
                                            )}
                                            {lead?.id && !lead?.nftTokenId && (
                                                <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs" asChild>
                                                    <Link to={`/lead/${lead.id}`}>
                                                        View Full Lead <ArrowUpRight className="h-3 w-3" />
                                                    </Link>
                                                </Button>
                                            )}
                                            {lead?.id && (
                                                <Button
                                                    variant="glass"
                                                    size="sm"
                                                    className="gap-1 text-xs"
                                                    asChild
                                                >
                                                    <Link to={`/lead/${lead.id}`}>
                                                        <RefreshCw className="h-3 w-3" /> Resell
                                                    </Link>
                                                </Button>
                                            )}
                                        </div>

                                        {/* Decrypted Data Reveal */}
                                        {expandedLead === leadId && decryptedData[leadId] && (
                                            <div className="mt-4 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <Shield className="h-4 w-4 text-emerald-500" />
                                                    <span className="text-xs font-semibold text-emerald-500 uppercase tracking-wider">Decrypted Contact Data</span>
                                                    {decryptedData[leadId]._placeholder && (
                                                        <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30 ml-auto">Preview</Badge>
                                                    )}
                                                </div>
                                                <div className="grid grid-cols-2 gap-2.5 text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                                                        <div>
                                                            <div className="text-[10px] text-muted-foreground">Name</div>
                                                            <div className="font-medium">{decryptedData[leadId].firstName} {decryptedData[leadId].lastName}</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                                                        <div>
                                                            <div className="text-[10px] text-muted-foreground">Email</div>
                                                            <div className="font-medium">{decryptedData[leadId].email}</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                                                        <div>
                                                            <div className="text-[10px] text-muted-foreground">Phone</div>
                                                            <div className="font-medium">{decryptedData[leadId].phone}</div>
                                                        </div>
                                                    </div>
                                                    {decryptedData[leadId].address && (
                                                        <div className="flex items-center gap-2">
                                                            <Home className="h-3.5 w-3.5 text-muted-foreground" />
                                                            <div>
                                                                <div className="text-[10px] text-muted-foreground">Address</div>
                                                                <div className="font-medium">
                                                                    {decryptedData[leadId].address}
                                                                    {decryptedData[leadId].city && `, ${decryptedData[leadId].city}`}
                                                                    {decryptedData[leadId].state && `, ${decryptedData[leadId].state}`}
                                                                    {decryptedData[leadId].zip && ` ${decryptedData[leadId].zip}`}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
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
