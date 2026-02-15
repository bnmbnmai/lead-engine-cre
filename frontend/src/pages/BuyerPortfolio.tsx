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
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { useSocketEvents } from '@/hooks/useSocketEvents';

// ─── Skeleton ───────────────────────────────

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

// ─── Quality Score Badge ────────────────────

function QualityBadge({ score }: { score: number }) {
    const displayed = Math.floor(score / 100); // 0-10,000 → 0-100
    const color =
        displayed >= 70 ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' :
            displayed >= 50 ? 'text-amber-400 bg-amber-500/15 border-amber-500/30' :
                'text-red-400 bg-red-500/15 border-red-500/30';
    return (
        <Badge variant="outline" className={`text-xs ${color}`}>
            <Shield className="h-3 w-3 mr-1" />
            {displayed}/100
        </Badge>
    );
}

// ─── Page Component ─────────────────────────

export function BuyerPortfolio() {
    const [leads, setLeads] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 300);

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

    // Stats
    const totalSpent = leads.reduce((sum, b) => sum + (b.amount || 0), 0);
    const verticals = [...new Set(leads.map((b) => b.lead?.vertical).filter(Boolean))];

    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center gap-3">
                            <Briefcase className="h-8 w-8 text-primary" />
                            My Portfolio
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            All purchased LeadNFTs with full lead data and on-chain provenance
                        </p>
                    </div>
                    <Button asChild>
                        <Link to="/marketplace">Browse Marketplace</Link>
                    </Button>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card className="p-5 bg-muted/30 border-border">
                        <div className="text-sm text-muted-foreground">Total Leads Owned</div>
                        <div className="text-2xl font-bold mt-1">{leads.length}</div>
                    </Card>
                    <Card className="p-5 bg-muted/30 border-border">
                        <div className="text-sm text-muted-foreground">Total Invested</div>
                        <div className="text-2xl font-bold mt-1">{formatCurrency(totalSpent)}</div>
                    </Card>
                    <Card className="p-5 bg-muted/30 border-border">
                        <div className="text-sm text-muted-foreground">Verticals</div>
                        <div className="text-2xl font-bold mt-1">{verticals.length}</div>
                    </Card>
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
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <SkeletonCard key={i} />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <Card className="p-12 text-center">
                        <Briefcase className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
                        <p className="text-lg font-medium text-muted-foreground">
                            {q ? 'No leads match your search' : 'No leads in your portfolio yet'}
                        </p>
                        <p className="text-sm text-muted-foreground/80 mt-1">
                            Win auctions or purchase leads via Buy Now to build your portfolio.
                        </p>
                        <Button variant="outline" className="mt-6" asChild>
                            <Link to="/marketplace">Browse Marketplace</Link>
                        </Button>
                    </Card>
                ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filtered.map((bid) => {
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
                                                <QualityBadge score={lead.qualityScore} />
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
                                        </div>
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
