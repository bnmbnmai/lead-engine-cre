import { useState, useEffect } from 'react';
import { Search, Star, ShieldCheck, ExternalLink, TrendingUp, Package } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SkeletonCard } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import api from '@/lib/api';

interface SellerRow {
    id: string;
    companyName: string | null;
    verticals: string[];
    reputationScore: string | number;
    totalLeadsSold: number;
    isVerified: boolean;
    kycStatus: string;
    createdAt: string;
    _count: { leads: number; asks: number };
    leadsSold: number;
    totalLeads: number;
    successRate: number;
}

function reputationBadge(score: number) {
    if (score >= 9000) return { label: 'Elite', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
    if (score >= 7000) return { label: 'Trusted', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30' };
    if (score >= 5000) return { label: 'Standard', color: 'text-blue-500 bg-blue-500/10 border-blue-500/30' };
    return { label: 'New', color: 'text-muted-foreground bg-muted/50 border-border' };
}

interface BrowseSellersProps {
    onViewLeads: (sellerId: string, sellerName: string) => void;
}

export function BrowseSellers({ onViewLeads }: BrowseSellersProps) {
    const [sellers, setSellers] = useState<SellerRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        const fetchSellers = async () => {
            setLoading(true);
            try {
                const params: Record<string, string> = {};
                if (debouncedSearch) params.search = debouncedSearch;
                const { data } = await api.listSellers(params);
                setSellers(data?.sellers || []);
            } catch {
                setSellers([]);
            } finally {
                setLoading(false);
            }
        };
        fetchSellers();
    }, [debouncedSearch]);

    return (
        <div className="space-y-4">
            {/* Search bar */}
            <Input
                placeholder="Search sellers by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                icon={<Search className="h-4 w-4" />}
            />

            {/* Results */}
            {loading ? (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <SkeletonCard key={i} />
                    ))}
                </div>
            ) : sellers.length === 0 ? (
                <EmptyState
                    icon={Search}
                    title="No sellers found"
                    description={search ? 'Try a different search term.' : 'No sellers have registered yet.'}
                />
            ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {sellers.map((seller) => {
                        const repScore = Number(seller.reputationScore);
                        const badge = reputationBadge(repScore);
                        const repPercent = (repScore / 100).toFixed(0);

                        return (
                            <div
                                key={seller.id}
                                className="glass rounded-xl p-5 flex flex-col gap-3 hover:ring-1 hover:ring-primary/30 transition-all"
                            >
                                {/* Header: name + badges */}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <h3 className="font-semibold text-foreground truncate">
                                            {seller.companyName || 'Anonymous Seller'}
                                        </h3>
                                        <div className="flex items-center gap-1.5 mt-1">
                                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${badge.color}`}>
                                                {badge.label}
                                            </Badge>
                                            {seller.isVerified && (
                                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-500 border-emerald-500/30">
                                                    <ShieldCheck className="h-3 w-3 mr-0.5" /> KYC
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 text-amber-500 shrink-0">
                                        <Star className="h-4 w-4 fill-current" />
                                        <span className="text-sm font-semibold">{repPercent}%</span>
                                    </div>
                                </div>

                                {/* Verticals */}
                                <div className="flex flex-wrap gap-1">
                                    {seller.verticals.slice(0, 4).map((v) => (
                                        <span
                                            key={v}
                                            className="text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary font-medium capitalize"
                                        >
                                            {v.replace(/_/g, ' ')}
                                        </span>
                                    ))}
                                    {seller.verticals.length > 4 && (
                                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                                            +{seller.verticals.length - 4}
                                        </span>
                                    )}
                                </div>

                                {/* Stats row */}
                                <div className="grid grid-cols-3 gap-2 text-center">
                                    <div className="p-2 rounded-lg bg-muted/40">
                                        <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
                                            <Package className="h-3 w-3" />
                                        </div>
                                        <div className="text-sm font-semibold">{seller.totalLeads}</div>
                                        <div className="text-[10px] text-muted-foreground">Leads</div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-muted/40">
                                        <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
                                            <TrendingUp className="h-3 w-3" />
                                        </div>
                                        <div className="text-sm font-semibold">{seller.leadsSold}</div>
                                        <div className="text-[10px] text-muted-foreground">Sold</div>
                                    </div>
                                    <div className="p-2 rounded-lg bg-muted/40">
                                        <div className="flex items-center justify-center gap-1 text-emerald-500 mb-0.5">
                                            <Star className="h-3 w-3" />
                                        </div>
                                        <div className="text-sm font-semibold">{seller.successRate}%</div>
                                        <div className="text-[10px] text-muted-foreground">Success</div>
                                    </div>
                                </div>

                                {/* Action */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full mt-auto"
                                    onClick={() => onViewLeads(seller.id, seller.companyName || 'Anonymous Seller')}
                                >
                                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                    View Leads
                                </Button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default BrowseSellers;
