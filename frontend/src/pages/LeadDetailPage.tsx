import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Shield, Clock, Users, Star, ShoppingCart, Wallet, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';

import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/Tooltip';
import { ChainlinkBadge } from '@/components/ui/ChainlinkBadge';
import { VerticalBreadcrumb } from '@/components/ui/VerticalBreadcrumb';
import { DynamicFieldRenderer } from '@/components/marketplace/DynamicFieldRenderer';
import { formatCurrency, getStatusColor, formatTimeRemaining } from '@/lib/utils';
import useAuth from '@/hooks/useAuth';
import api from '@/lib/api';
import { useSocketEvents } from '@/hooks/useSocketEvents';

// ─── Types ──────────────────────────────────

interface LeadDetail {
    id: string;
    vertical: string;
    geo: { country?: string; state?: string; city?: string; zip?: string };
    source: string;
    status: string;
    reservePrice: number | null;
    buyNowPrice: number | null;
    isVerified: boolean;
    parameters: Record<string, unknown> | null;
    formSteps?: { label: string; fields: { key: string; label: string; value: string }[] }[];
    createdAt: string;
    auctionStartAt: string | null;
    auctionEndAt: string | null;
    expiresAt: string | null;
    qualityScore: number | null;
    nftTokenId: string | null;
    seller: {
        companyName: string;
        reputationScore: number;
        isVerified: boolean;
    } | null;
    _count: { bids: number };
}

// ─── Quality Score Bar ──────────────────────

function QualityBar({ score }: { score: number }) {
    const pct = Math.min(Math.max((score / 10000) * 100, 0), 100);
    const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">CRE Quality Score</span>
                <span className="text-sm font-semibold">{score.toLocaleString()} / 10,000</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

// ─── Skeleton ───────────────────────────────

function DetailSkeleton() {
    return (
        <div className="space-y-6 animate-pulse">
            <div className="h-8 w-48 bg-muted rounded" />
            <div className="grid md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-4">
                    <div className="h-40 bg-muted rounded-xl" />
                    <div className="h-32 bg-muted rounded-xl" />
                </div>
                <div className="h-60 bg-muted rounded-xl" />
            </div>
        </div>
    );
}

// ─── Page Component ─────────────────────────

export default function LeadDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { isAuthenticated } = useAuth();
    const { openConnectModal } = useConnectModal();
    const navigate = useNavigate();

    const [lead, setLead] = useState<LeadDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Buy Now flow state
    const [confirming, setConfirming] = useState(false);
    const [buying, setBuying] = useState(false);
    const [buyError, setBuyError] = useState<string | null>(null);
    const [purchased, setPurchased] = useState(false);

    const fetchLead = useCallback(() => {
        if (!id) return;
        setLoading(true);
        setError(null);
        api.getLead(id)
            .then((res) => {
                if (res.error) {
                    setError(res.error.error || 'Lead not found');
                } else {
                    setLead((res.data as any)?.lead ?? null);
                }
            })
            .catch(() => setError('Failed to load lead details'))
            .finally(() => setLoading(false));
    }, [id]);

    useEffect(() => { fetchLead(); }, [fetchLead]);

    // Real-time updates
    useSocketEvents(
        {
            'marketplace:refreshAll': () => { fetchLead(); },
            'marketplace:bid:update': (data: any) => {
                if (data?.leadId === id && lead) {
                    setLead((prev) => prev ? { ...prev, _count: { ...prev._count, bids: data.bidCount } } : prev);
                }
            },
        },
        fetchLead,
    );

    const handleBuyNow = async () => {
        if (!lead) return;
        if (confirming) {
            setBuying(true);
            setBuyError(null);
            try {
                const res = await api.buyNow(lead.id);
                if (res.error) {
                    setBuyError(res.error.error || 'Purchase failed');
                } else {
                    setPurchased(true);
                    // Redirect to portfolio after brief confirmation
                    setTimeout(() => navigate('/buyer/portfolio'), 2000);
                }
            } catch {
                setBuyError('Network error — please try again');
            } finally {
                setBuying(false);
                setConfirming(false);
            }
        } else {
            setConfirming(true);
            setTimeout(() => setConfirming(false), 5000);
        }
    };

    // ─── Derived values ─────────────────────
    const geoDisplay = lead
        ? [lead.geo?.city, lead.geo?.state, lead.geo?.country].filter(Boolean).join(', ') || 'Nationwide'
        : '';
    const isUnsold = lead?.status === 'UNSOLD';
    const isLive = lead?.status === 'IN_AUCTION' || lead?.status === 'REVEAL_PHASE';
    const reputationDisplay = lead?.seller
        ? `${(Number(lead.seller.reputationScore) / 100).toFixed(0)}%`
        : null;

    return (
        <DashboardLayout>
            <div className="max-w-5xl mx-auto space-y-6">
                {/* Back nav */}
                <Link to="/marketplace" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Marketplace
                </Link>

                {loading && <DetailSkeleton />}

                {error && (
                    <Card className="border-red-500/30">
                        <CardContent className="p-8 flex flex-col items-center gap-4">
                            <AlertCircle className="h-10 w-10 text-red-500" />
                            <p className="text-lg font-semibold">{error}</p>
                            <Button asChild variant="outline">
                                <Link to="/marketplace">Return to Marketplace</Link>
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {lead && !loading && (
                    <div className="grid md:grid-cols-3 gap-6">
                        {/* ─── Main Content (2/3) ───────── */}
                        <div className="md:col-span-2 space-y-5">
                            {/* Header Card */}
                            <Card>
                                <CardContent className="p-6">
                                    <div className="flex items-start justify-between mb-4">
                                        <div>
                                            <h1 className="text-2xl font-bold">
                                                <VerticalBreadcrumb slug={lead.vertical} />
                                            </h1>
                                            {lead.seller && (
                                                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                                                    by {lead.seller.companyName}
                                                    {lead.seller.isVerified && <ChainlinkBadge size="sm" />}
                                                </p>
                                            )}
                                        </div>
                                        <Badge className={getStatusColor(lead.status)}>{lead.status.replace('_', ' ')}</Badge>
                                    </div>

                                    {/* Quality Score */}
                                    {lead.qualityScore != null && (
                                        <div className="mb-5">
                                            <QualityBar score={lead.qualityScore} />
                                        </div>
                                    )}

                                    {/* Verification + NFT badges */}
                                    <div className="flex flex-wrap gap-2">
                                        {lead.isVerified && (
                                            <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 gap-1">
                                                <Shield className="h-3 w-3" /> CRE Verified
                                            </Badge>
                                        )}
                                        {lead.nftTokenId && (
                                            <Badge variant="outline" className="text-blue-400 border-blue-400/30 gap-1">
                                                <ExternalLink className="h-3 w-3" /> NFT #{lead.nftTokenId}
                                            </Badge>
                                        )}
                                        <Badge variant="outline" className="text-muted-foreground">
                                            Source: {lead.source}
                                        </Badge>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Location & Details Card */}
                            <Card>
                                <CardContent className="p-6 space-y-4">
                                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Location & Details</h2>
                                    <div className="flex items-center gap-2 text-sm">
                                        <MapPin className="h-4 w-4 text-muted-foreground" />
                                        <span>{geoDisplay}</span>
                                        {lead.geo?.zip && <span className="text-muted-foreground">({lead.geo.zip})</span>}
                                    </div>

                                    {/* Seller reputation */}
                                    {lead.seller && (
                                        <div className="flex items-center gap-2 text-sm">
                                            <Star className="h-4 w-4 text-amber-500" />
                                            <span>Seller Reputation: <strong>{reputationDisplay}</strong></span>
                                        </div>
                                    )}

                                    {/* Auction info */}
                                    {lead.auctionEndAt && (
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Clock className="h-4 w-4" />
                                            <span>
                                                {isLive
                                                    ? `Auction ends: ${formatTimeRemaining(lead.auctionEndAt)}`
                                                    : `Auction ended: ${new Date(lead.auctionEndAt).toLocaleDateString()}`}
                                            </span>
                                        </div>
                                    )}

                                    {lead._count.bids > 0 && (
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Users className="h-4 w-4" />
                                            <span>{lead._count.bids} bid(s) placed{isUnsold ? ' — reserve not met' : ''}</span>
                                        </div>
                                    )}

                                    {lead.expiresAt && isUnsold && (
                                        <div className="flex items-center gap-2 text-sm text-amber-500">
                                            <Clock className="h-4 w-4" />
                                            <span>Buy Now expires: {formatTimeRemaining(lead.expiresAt)}</span>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Lead Parameters / Preview Steps */}
                            {lead.formSteps && lead.formSteps.length > 0 ? (
                                /* Buyer preview: structured form steps with redacted PII */
                                lead.formSteps.map((step, idx) => (
                                    <Card key={idx}>
                                        <CardContent className="p-6">
                                            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">{step.label}</h2>
                                            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                                {step.fields.map((field) => (
                                                    <div key={field.key}>
                                                        <dt className="text-xs text-muted-foreground">{field.label}</dt>
                                                        <dd className="text-sm font-medium mt-0.5">{field.value}</dd>
                                                    </div>
                                                ))}
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))
                            ) : lead.parameters && Object.keys(lead.parameters).length > 0 ? (
                                /* Owner view: raw parameters */
                                <Card>
                                    <CardContent className="p-6">
                                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Lead Parameters</h2>
                                        <DynamicFieldRenderer parameters={lead.parameters} />
                                    </CardContent>
                                </Card>
                            ) : null}

                            {/* Privacy Notice */}
                            <div className="rounded-lg border border-border/50 bg-muted/30 p-4 text-sm text-muted-foreground">
                                <p><strong>Privacy Note:</strong> Personal identifiable information (PII) including name, email, and phone number is encrypted and will only be revealed to the buyer after a successful purchase via x402 escrow settlement.</p>
                            </div>
                        </div>

                        {/* ─── Sidebar (1/3) ─────────────── */}
                        <div className="space-y-5">
                            {/* Pricing Card */}
                            <Card className={`sticky top-6 ${isUnsold ? 'border-green-500/30' : ''}`}>
                                <CardContent className="p-6 space-y-5">
                                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Pricing</h2>

                                    {/* Reserve */}
                                    {lead.reservePrice != null && (
                                        <div>
                                            <Tooltip content="Minimum bid amount set by the seller">
                                                <span className="text-xs text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/40">Reserve Price</span>
                                            </Tooltip>
                                            <div className={`text-lg font-bold mt-0.5 ${isUnsold ? 'line-through text-muted-foreground' : 'gradient-text'}`}>
                                                {formatCurrency(lead.reservePrice)}
                                            </div>
                                        </div>
                                    )}

                                    {/* Buy Now Price */}
                                    {lead.buyNowPrice != null && (
                                        <div>
                                            <Tooltip content="Purchase this lead immediately — no bidding required">
                                                <span className="text-xs text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/40">Buy Now Price</span>
                                            </Tooltip>
                                            <div className="text-3xl font-bold text-green-500 mt-0.5">
                                                {formatCurrency(lead.buyNowPrice)}
                                            </div>
                                        </div>
                                    )}

                                    {/* CTA */}
                                    {purchased ? (
                                        <div className="text-center py-3">
                                            <p className="font-semibold text-green-500">✓ Lead Purchased!</p>
                                            <p className="text-xs text-muted-foreground mt-1">Transaction processing via escrow.</p>
                                        </div>
                                    ) : isAuthenticated ? (
                                        <div className="space-y-2">
                                            {isUnsold && (
                                                <>
                                                    {buyError && <p className="text-xs text-red-500 text-center">{buyError}</p>}
                                                    <Button
                                                        className={`w-full text-base py-5 transition-all ${confirming ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}
                                                        disabled={buying}
                                                        onClick={handleBuyNow}
                                                    >
                                                        {buying ? (
                                                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing…</>
                                                        ) : confirming ? (
                                                            'Click again to confirm'
                                                        ) : (
                                                            <><ShoppingCart className="h-4 w-4 mr-2" />Buy Now — {formatCurrency(lead.buyNowPrice ?? 0)}</>
                                                        )}
                                                    </Button>
                                                </>
                                            )}
                                            {isLive && (
                                                <Button asChild className="w-full text-base py-5" variant="gradient">
                                                    <Link to={`/auction/${lead.id}`}>Place a Bid</Link>
                                                </Button>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <Button className="w-full py-5 gap-2" variant="glass" onClick={openConnectModal}>
                                                <Wallet className="h-4 w-4" />
                                                Connect Wallet to Purchase
                                            </Button>
                                            <p className="text-xs text-muted-foreground text-center">PII is revealed only after payment</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Lead ID */}
                            <div className="text-xs text-muted-foreground/50 text-center break-all">
                                Lead ID: {lead.id}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
