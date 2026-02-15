import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Shield, Clock, Users, Star, ShoppingCart, Wallet, Loader2, AlertCircle, ExternalLink, ChevronDown } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';

import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChainlinkBadge } from '@/components/ui/ChainlinkBadge';
import { VerticalBreadcrumb } from '@/components/ui/VerticalBreadcrumb';
import { DynamicFieldRenderer } from '@/components/marketplace/DynamicFieldRenderer';
import { AuctionTimer } from '@/components/bidding/AuctionTimer';
import { BidPanel } from '@/components/bidding/BidPanel';
import { formatCurrency, getStatusColor, formatTimeRemaining } from '@/lib/utils';
import { useAuction } from '@/hooks/useAuction';
import useAuth from '@/hooks/useAuth';
import api from '@/lib/api';
import { toast } from '@/hooks/useToast';
import { useSocketEvents } from '@/hooks/useSocketEvents';
import socketClient from '@/lib/socket';

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
    highestBidAmount?: number | null;
    seller: {
        companyName: string;
        reputationScore: number;
        isVerified: boolean;
    } | null;
    _count: { bids: number };
}

// ─── Quality Score Bar ──────────────────────

function QualityBar({ score }: { score: number }) {
    const displayed = Math.floor(score / 100); // 0-10,000 → 0-100
    const pct = Math.min(displayed, 100);
    const color = pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
    const textColor = pct >= 70 ? 'text-emerald-500' : pct >= 50 ? 'text-amber-500' : 'text-red-500';
    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">CRE Quality Score</span>
                <span className={`text-sm font-semibold ${textColor}`}>{displayed} <span className="text-xs text-muted-foreground font-normal">/ 100</span></span>
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
    const [previewOpen, setPreviewOpen] = useState(true);
    const [buyError, setBuyError] = useState<string | null>(null);
    const [purchased, setPurchased] = useState(false);

    // Bidding state
    const [bidLoading, setBidLoading] = useState(false);
    const [myBidAmount, setMyBidAmount] = useState<number | null>(null);
    const [localHighestBid, setLocalHighestBid] = useState<number | null>(null);
    const [localBidCount, setLocalBidCount] = useState<number | null>(null);

    // Auction hook — only active for IN_AUCTION leads
    // Pass empty string when not IN_AUCTION to prevent socket join + error emission
    const auctionLeadId = lead?.status === 'IN_AUCTION' ? id! : '';
    const { state: auctionState, placeBid, error: socketError } = useAuction({
        leadId: auctionLeadId,
        onBidPlaced: (event) => {
            setLocalBidCount(event.bidCount);
            fetchLead();
        },
        onResolved: () => {
            fetchLead();
        },
    });

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

    // Listen for bid:confirmed to stop loading spinner
    useEffect(() => {
        if (!auctionLeadId) return;
        const unsub = socketClient.on('bid:confirmed', () => {
            setBidLoading(false);
        });
        return unsub;
    }, [auctionLeadId]);

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

    const handlePlaceBid = (data: { amount?: number; commitment?: string }) => {
        setBidLoading(true);
        try {
            placeBid(data);
            // Increment bid count immediately for local feedback
            setLocalBidCount((prev) => (prev ?? auctionState?.bidCount ?? lead?._count?.bids ?? 0) + 1);

            if (data.amount) {
                setMyBidAmount(data.amount);
                if (!localHighestBid || data.amount > localHighestBid) {
                    setLocalHighestBid(data.amount);
                }
                toast({
                    type: 'success',
                    title: '✅ Bid Placed!',
                    description: `Bid of ${formatCurrency(data.amount)} placed successfully.`,
                });
            } else if (data.commitment) {
                toast({
                    type: 'success',
                    title: '🔒 Sealed Bid Committed',
                    description: 'Your bid has been encrypted and submitted. It will be revealed automatically when the auction ends.',
                });
            }
        } finally {
            // Release loading state after a brief delay
            setTimeout(() => setBidLoading(false), 800);
        }
    };

    // ─── Derived values ─────────────────────
    const geoDisplay = lead
        ? [lead.geo?.city, lead.geo?.state, lead.geo?.country].filter(Boolean).join(', ') || 'Nationwide'
        : '';
    const isUnsold = lead?.status === 'UNSOLD';
    const isLive = lead?.status === 'IN_AUCTION';
    const reputationDisplay = lead?.seller
        ? `${(Number(lead.seller.reputationScore) / 100).toFixed(0)}%`
        : null;

    const phase = auctionState?.phase || 'BIDDING';
    const displayBidCount = localBidCount ?? auctionState?.bidCount ?? lead?._count?.bids ?? 0;
    const displayHighestBid = localHighestBid ?? auctionState?.highestBid ?? lead?.highestBidAmount ?? null;

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
                                        <div className="flex flex-col items-end gap-1.5">
                                            <Badge className={getStatusColor(lead.status)}>{lead.status.replace('_', ' ')}</Badge>
                                            {myBidAmount && (
                                                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30 text-xs">
                                                    Your bid: {formatCurrency(myBidAmount)}
                                                </Badge>
                                            )}
                                        </div>
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

                                    {displayBidCount > 0 && (
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Users className="h-4 w-4" />
                                            <span>{displayBidCount} bid(s) placed{isUnsold ? ' — reserve not met' : ''}</span>
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

                            {/* ─── Lead Details Preview (collapsible) ─── */}
                            <Card>
                                <CardContent className="p-0">
                                    <button
                                        className="w-full flex items-center justify-between p-5 cursor-pointer hover:bg-muted/30 transition rounded-xl"
                                        onClick={() => setPreviewOpen(v => !v)}
                                    >
                                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Lead Details Preview</h2>
                                        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${previewOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                    {previewOpen && (
                                        <div className="px-5 pb-5 space-y-4 border-t border-border/50">
                                            {/* Lead metadata */}
                                            <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-4">
                                                <div>
                                                    <dt className="text-xs text-muted-foreground">Source</dt>
                                                    <dd className="text-sm font-medium mt-0.5">{lead.source}</dd>
                                                </div>
                                                <div>
                                                    <dt className="text-xs text-muted-foreground">Submitted</dt>
                                                    <dd className="text-sm font-medium mt-0.5">{new Date(lead.createdAt).toLocaleDateString()}</dd>
                                                </div>
                                                {lead.nftTokenId && (
                                                    <div>
                                                        <dt className="text-xs text-muted-foreground">NFT Token</dt>
                                                        <dd className="text-sm font-medium mt-0.5">#{lead.nftTokenId}</dd>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Lead ID */}
                                            <div className="text-xs text-muted-foreground/50 break-all pt-2 border-t border-border/30">
                                                Lead ID: {lead.id}
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Privacy Notice */}
                            <div className="rounded-lg border border-border/50 bg-muted/30 p-4 text-sm text-muted-foreground">
                                <p><strong>Privacy Note:</strong> Personal identifiable information (PII) including name, email, and phone number is encrypted and will only be revealed to the buyer after a successful purchase via x402 escrow settlement.</p>
                            </div>
                        </div>

                        {/* ─── Sidebar (1/3) ─── */}
                        <div className="space-y-5">
                            <div className="sticky top-6 space-y-5">

                                {/* ── IN_AUCTION: bidding sidebar ── */}
                                {isLive && (
                                    <>
                                        <AuctionTimer
                                            phase={phase as any}
                                            biddingEndsAt={auctionState?.biddingEndsAt || lead.auctionEndAt || undefined}
                                            revealEndsAt={auctionState?.revealEndsAt}
                                        />

                                        <Card>
                                            <CardContent className="p-5 space-y-4">
                                                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Auction Status</h2>

                                                {lead.reservePrice != null && (
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs text-muted-foreground">Reserve</span>
                                                        <span className="text-sm font-bold gradient-text">{formatCurrency(lead.reservePrice)}</span>
                                                    </div>
                                                )}

                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-muted-foreground">Total Bids</span>
                                                    <span className="text-sm font-semibold">{displayBidCount}</span>
                                                </div>

                                                {/* Only show highest bid after reveal phase — sealed during BIDDING */}
                                                {phase !== 'BIDDING' && displayHighestBid != null && (
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs text-muted-foreground">Highest Bid</span>
                                                        <span className="text-sm font-bold text-green-500">{formatCurrency(displayHighestBid)}</span>
                                                    </div>
                                                )}

                                                {myBidAmount && (
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs text-muted-foreground">Your Bid</span>
                                                        <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30 text-xs">
                                                            {formatCurrency(myBidAmount)}
                                                        </Badge>
                                                    </div>
                                                )}
                                            </CardContent>
                                        </Card>

                                        {isAuthenticated && (
                                            <BidPanel
                                                reservePrice={lead.reservePrice ?? 0}
                                                highestBid={displayHighestBid}
                                                phase={phase as any}
                                                onPlaceBid={handlePlaceBid}
                                                isLoading={bidLoading}
                                            />
                                        )}
                                    </>
                                )}

                                {/* ── UNSOLD: Buy It Now sidebar ── */}
                                {isUnsold && (
                                    <Card className="border-green-500/30">
                                        <CardContent className="p-6 space-y-5">
                                            <div>
                                                <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">Auction Ended</h2>
                                                <p className="text-xs text-muted-foreground mt-1">Buy It Now Available</p>
                                            </div>

                                            {lead.reservePrice != null && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-muted-foreground">Reserve Price</span>
                                                    <span className="text-sm font-bold line-through text-muted-foreground">{formatCurrency(lead.reservePrice)}</span>
                                                </div>
                                            )}

                                            {lead.buyNowPrice != null && (
                                                <div>
                                                    <span className="text-xs text-muted-foreground">Buy Now Price</span>
                                                    <div className="text-3xl font-bold text-green-500 mt-1">{formatCurrency(lead.buyNowPrice)}</div>
                                                </div>
                                            )}

                                            {purchased ? (
                                                <div className="text-center py-3">
                                                    <p className="font-semibold text-green-500">✓ Lead Purchased!</p>
                                                    <p className="text-xs text-muted-foreground mt-1">Transaction processing via escrow.</p>
                                                </div>
                                            ) : isAuthenticated ? (
                                                <div className="space-y-3">
                                                    {buyError && <p className="text-xs text-red-500 text-center">{buyError}</p>}
                                                    <Button
                                                        className={`w-full text-base py-6 transition-all ${confirming ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}
                                                        disabled={buying}
                                                        onClick={handleBuyNow}
                                                    >
                                                        {buying ? (
                                                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing…</>
                                                        ) : confirming ? (
                                                            'Click again to confirm'
                                                        ) : (
                                                            <><ShoppingCart className="h-5 w-5 mr-2" />Buy Now — {formatCurrency(lead.buyNowPrice ?? 0)}</>
                                                        )}
                                                    </Button>
                                                    <p className="text-xs text-muted-foreground text-center">Instant USDC settlement after purchase</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-3">
                                                    <Button className="w-full py-6 gap-2" variant="glass" onClick={openConnectModal}>
                                                        <Wallet className="h-4 w-4" />
                                                        Connect Wallet to Purchase
                                                    </Button>
                                                    <p className="text-xs text-muted-foreground text-center">PII is revealed only after payment</p>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                )}

                                {/* ── Fallback for other statuses (SOLD, etc.) ── */}
                                {!isLive && !isUnsold && (
                                    <Card>
                                        <CardContent className="p-5">
                                            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                                                {lead.status === 'SOLD' ? 'Lead Sold' : 'Auction Closed'}
                                            </h2>
                                            <p className="text-xs text-muted-foreground mt-2">This lead is no longer available for purchase.</p>
                                        </CardContent>
                                    </Card>
                                )}

                                {/* Connect wallet CTA — only for live auctions when not authenticated */}
                                {isLive && !isAuthenticated && (
                                    <Card>
                                        <CardContent className="p-5">
                                            <Button className="w-full py-5 gap-2" variant="glass" onClick={openConnectModal}>
                                                <Wallet className="h-4 w-4" />
                                                Connect Wallet to Bid
                                            </Button>
                                            <p className="text-xs text-muted-foreground text-center mt-2">PII is revealed only after payment</p>
                                        </CardContent>
                                    </Card>
                                )}

                                {isLive && socketError && (
                                    <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                                        {socketError}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
