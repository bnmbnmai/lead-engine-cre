import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Clock, ShoppingCart, Tag, AlertTriangle, CheckCircle, Loader2, Eye } from 'lucide-react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/Tooltip';
import { VerticalBreadcrumb } from '@/components/ui/VerticalBreadcrumb';
import { formatCurrency } from '@/lib/utils';
import api from '@/lib/api';

interface BuyNowLead {
    id: string;
    vertical: string;
    geo: { country?: string; state?: string; city?: string; zip?: string };
    source: string;
    status: string;
    reservePrice?: number;
    buyNowPrice: number;
    isVerified: boolean;
    qualityScore?: number;
    aceCompliant?: boolean | null;
    expiresAt: string;
    createdAt: string;
    seller?: {
        id: string;
        companyName: string;
        reputationScore: number;
        isVerified: boolean;
    };
    _count?: { bids: number };
}

interface BuyNowCardProps {
    lead: BuyNowLead;
    onPurchased?: (leadId: string) => void;
}

function useCountdown(expiresAt: string) {
    const [, setTick] = useState(0);

    // Force re-render every minute for countdown
    useState(() => {
        const timer = setInterval(() => setTick((t) => t + 1), 60_000);
        return () => clearInterval(timer);
    });

    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Expired';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days}d ${hours}h left`;
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${mins}m left`;
}

export function BuyNowCard({ lead, onPurchased }: BuyNowCardProps) {
    const [buying, setBuying] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [purchased, setPurchased] = useState(false);

    const countdown = useCountdown(lead.expiresAt);
    const isExpired = countdown === 'Expired';
    const geoDisplay = [lead.geo?.city, lead.geo?.state].filter(Boolean).join(', ') || 'Nationwide';

    const handleBuyNow = async () => {
        if (confirming) {
            // Second click = confirm purchase
            setBuying(true);
            setError(null);
            try {
                const response = await api.buyNow(lead.id);
                if (response.error) {
                    setError(response.error.error || 'Purchase failed');
                } else {
                    setPurchased(true);
                    onPurchased?.(lead.id);
                }
            } catch {
                setError('Network error — please try again');
            } finally {
                setBuying(false);
                setConfirming(false);
            }
        } else {
            // First click = show confirm state
            setConfirming(true);
            // Auto-dismiss after 5 seconds
            setTimeout(() => setConfirming(false), 5000);
        }
    };

    if (purchased) {
        return (
            <Card className="border-green-500/50 bg-green-500/5">
                <CardContent className="p-6 flex flex-col items-center justify-center gap-3 py-10">
                    <CheckCircle className="h-10 w-10 text-green-500" />
                    <p className="font-semibold text-green-500">Lead Purchased!</p>
                    <p className="text-sm text-muted-foreground">
                        Transaction is being processed via escrow.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className={`group transition-all ${isExpired ? 'opacity-60' : 'hover:border-green-500/50 hover:shadow-lg hover:shadow-green-500/5'}`}>
            <CardContent className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="font-semibold text-lg">
                            <VerticalBreadcrumb slug={lead.vertical} />
                        </h3>
                        {lead.seller && (
                            <p className="text-sm text-muted-foreground mt-0.5">
                                by {lead.seller.companyName}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                        <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
                            <Tag className="h-3 w-3 mr-1" />
                            Buy Now
                        </Badge>
                        {/* CRE Quality Score */}
                        {lead.qualityScore != null ? (
                            <Tooltip content={`CRE Quality Score: ${Math.floor(lead.qualityScore / 100)}/100 — confirmed on-chain after purchase`}>
                                <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide border cursor-help ${lead.qualityScore >= 7000
                                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                        : lead.qualityScore >= 5000
                                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                            : 'bg-red-500/15 text-red-400 border-red-500/30'
                                        }`}
                                >
                                    CRE {Math.floor(lead.qualityScore / 100)}/100
                                </span>
                            </Tooltip>
                        ) : (
                            <Tooltip content="CRE quality score pending — confirmed on-chain after purchase">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide border bg-zinc-500/10 text-zinc-400 border-zinc-500/30 cursor-help">
                                    CRE —
                                </span>
                            </Tooltip>
                        )}
                        {/* ACE Compliance */}
                        {lead.aceCompliant != null && (
                            <Tooltip content={lead.aceCompliant
                                ? 'ACE Compliance: on-chain check passed'
                                : 'ACE Compliance: on-chain check failed'}>
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide border cursor-help ${lead.aceCompliant
                                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                        : 'bg-red-500/15 text-red-400 border-red-500/30'
                                    }`}>
                                    {lead.aceCompliant ? '✓' : '✗'} ACE
                                </span>
                            </Tooltip>
                        )}
                        {lead.isVerified && (
                            <Badge variant="outline" className="text-blue-400 border-blue-400/30 text-xs">
                                Verified
                            </Badge>
                        )}
                    </div>
                </div>

                {/* Details */}
                <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4 shrink-0" />
                        <span>{geoDisplay}</span>
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                        <Clock className={`h-4 w-4 shrink-0 ${isExpired ? 'text-red-500' : 'text-amber-500'}`} />
                        <span className={isExpired ? 'text-red-500' : 'text-amber-500'}>
                            {countdown}
                        </span>
                    </div>

                    {lead._count && lead._count.bids > 0 && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span>Had {lead._count.bids} bid(s) — reserve not met</span>
                        </div>
                    )}
                </div>

                {/* Pricing */}
                <div className="mt-4 pt-4 border-t border-border">
                    <div className="flex items-baseline justify-between">
                        <div>
                            <Tooltip content="Original reserve price set by the seller">
                                <span className="text-xs text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/40">
                                    Was
                                </span>
                            </Tooltip>
                            <div className="text-sm text-muted-foreground line-through mt-0.5">
                                {formatCurrency(lead.reservePrice || 0)}
                            </div>
                        </div>
                        <div className="text-right">
                            <Tooltip content="Purchase this lead immediately — no bidding required">
                                <span className="text-xs text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/40">
                                    Buy Now Price
                                </span>
                            </Tooltip>
                            <div className="text-2xl font-bold text-green-500 mt-0.5">
                                {formatCurrency(lead.buyNowPrice)}
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>

            <CardFooter className="px-6 pb-6">
                <div className="w-full space-y-2">
                    {error && (
                        <p className="text-xs text-red-500 text-center">{error}</p>
                    )}
                    <Button asChild variant="outline" className="w-full">
                        <Link to={`/lead/${lead.id}`}>
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                        </Link>
                    </Button>
                    <Button
                        className={`w-full transition-all ${confirming
                            ? 'bg-amber-600 hover:bg-amber-700'
                            : 'bg-green-600 hover:bg-green-700'
                            }`}
                        disabled={isExpired || buying}
                        onClick={handleBuyNow}
                    >
                        {buying ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Processing…
                            </>
                        ) : confirming ? (
                            'Click again to confirm purchase'
                        ) : (
                            <>
                                <ShoppingCart className="h-4 w-4 mr-2" />
                                Buy Now — {formatCurrency(lead.buyNowPrice)}
                            </>
                        )}
                    </Button>
                </div>
            </CardFooter>
        </Card>
    );
}

export default BuyNowCard;
