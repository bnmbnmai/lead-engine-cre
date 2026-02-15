import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MapPin, Shield, Users, ArrowLeft, ExternalLink } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlassCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AuctionTimer } from '@/components/bidding/AuctionTimer';
import { BidPanel } from '@/components/bidding/BidPanel';
import { LeadPreview } from '@/components/bidding/LeadPreview';
import { useAuction } from '@/hooks/useAuction';
import api from '@/lib/api';
import { formatCurrency, getStatusColor } from '@/lib/utils';
import { toast } from '@/hooks/useToast';
import { useSocketEvents } from '@/hooks/useSocketEvents';

export function AuctionPage() {
    const { leadId } = useParams<{ leadId: string }>();
    const [lead, setLead] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [bidLoading, setBidLoading] = useState(false);
    const [myBidAmount, setMyBidAmount] = useState<number | null>(null);

    // Optimistic local overrides — updated immediately on bid, then reconciled via socket
    const [localHighestBid, setLocalHighestBid] = useState<number | null>(null);
    const [localBidCount, setLocalBidCount] = useState<number | null>(null);

    const { state: auctionState, placeBid, error: socketError } = useAuction({
        leadId: leadId!,
        onBidPlaced: (event) => {
            // Reconcile optimistic state with server-confirmed values
            setLocalHighestBid(event.highestBid);
            setLocalBidCount(event.bidCount);
            fetchLead();
        },
        onResolved: (event) => {
            if (import.meta.env.DEV) console.log('Auction resolved:', event);
            fetchLead();
        },
    });

    const fetchLead = async () => {
        try {
            const { data } = await api.getLead(leadId!);
            setLead(data?.lead);
        } catch (error) {
            console.error('Failed to fetch lead:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (leadId) {
            fetchLead();
        }
    }, [leadId]);

    // Refresh on marketplace-wide events (demo clear/reset/seed)
    useSocketEvents(
        { 'marketplace:refreshAll': () => { fetchLead(); } },
        fetchLead,
    );

    const handlePlaceBid = async (data: { amount?: number; commitment?: string }) => {
        setBidLoading(true);
        try {
            placeBid(data);

            // Always increment bid count — works for both sealed and open bids
            setLocalBidCount((prev) => (prev ?? auctionState?.bidCount ?? lead?._count?.bids ?? 0) + 1);

            if (data.amount) {
                // Optimistic UI updates — don't wait for socket roundtrip
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
                setMyBidAmount(lead?.reservePrice ?? null); // Show something for "Your Bid"
                toast({
                    type: 'success',
                    title: 'Sealed Bid Committed',
                    description: 'Your bid has been encrypted and submitted. Remember to reveal during the reveal phase!',
                });
            }
        } finally {
            setTimeout(() => setBidLoading(false), 600);
        }
    };

    if (isLoading) {
        return (
            <DashboardLayout>
                <div className="space-y-6">
                    <Skeleton className="h-10 w-48" />
                    <div className="grid lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 space-y-6">
                            <Skeleton className="h-64" />
                            <Skeleton className="h-48" />
                        </div>
                        <Skeleton className="h-96" />
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    if (!lead) {
        return (
            <DashboardLayout>
                <div className="text-center py-20">
                    <h1 className="text-2xl font-bold mb-4">Lead Not Found</h1>
                    <Button asChild>
                        <Link to="/">Back to Marketplace</Link>
                    </Button>
                </div>
            </DashboardLayout>
        );
    }

    const phase = auctionState?.phase || 'BIDDING';

    // Derived bid stats — prefer optimistic local → socket state → lead data
    const displayBidCount = localBidCount ?? auctionState?.bidCount ?? lead._count?.bids ?? 0;
    const displayHighestBid = localHighestBid ?? auctionState?.highestBid ?? lead.highestBidAmount ?? null;

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Back Link */}
                <Link
                    to="/"
                    className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition mb-6"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Marketplace
                </Link>

                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Lead Details */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Header Card */}
                        <Card>
                            <CardContent className="p-6">
                                <div className="flex items-start justify-between mb-6">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${lead.isVerified ? 'bg-green-500/20' : 'bg-gray-500/20'
                                            }`}>
                                            <Shield className={`h-8 w-8 ${lead.isVerified ? 'text-green-500' : 'text-gray-500'}`} />
                                        </div>
                                        <div>
                                            <h1 className="text-2xl font-bold capitalize">{lead.vertical} Lead</h1>
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                <MapPin className="h-4 w-4" />
                                                {lead.geo?.city && `${lead.geo.city}, `}{lead.geo?.state || 'Unknown Location'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1.5">
                                        <Badge className={getStatusColor(lead.status)} variant="outline">
                                            {lead.status.replace('_', ' ')}
                                        </Badge>
                                        {myBidAmount && (
                                            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30 text-xs">
                                                Your bid: {formatCurrency(myBidAmount)}
                                            </Badge>
                                        )}
                                    </div>
                                </div>

                                {/* Stats */}
                                <div className="grid grid-cols-3 gap-4">
                                    <GlassCard className="p-4 text-center">
                                        <div className="text-2xl font-bold gradient-text">
                                            {displayBidCount}
                                        </div>
                                        <div className="text-sm text-muted-foreground">Total Bids</div>
                                    </GlassCard>
                                    <GlassCard className="p-4 text-center">
                                        <div className="text-2xl font-bold text-green-500">
                                            {displayHighestBid
                                                ? formatCurrency(displayHighestBid)
                                                : displayBidCount > 0
                                                    ? 'Sealed'
                                                    : 'No bids'}
                                        </div>
                                        <div className="text-sm text-muted-foreground">Highest Bid</div>
                                    </GlassCard>
                                    <GlassCard className="p-4 text-center">
                                        <div className="text-2xl font-bold">
                                            {formatCurrency(lead.reservePrice)}
                                        </div>
                                        <div className="text-sm text-muted-foreground">Reserve</div>
                                    </GlassCard>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Timer */}
                        <AuctionTimer
                            phase={phase as any}
                            biddingEndsAt={auctionState?.biddingEndsAt || lead.auctionEndAt}
                            revealEndsAt={auctionState?.revealEndsAt}
                        />

                        {/* Lead Info */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Lead Information</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <div className="text-sm text-muted-foreground">Source</div>
                                        <div className="font-medium">{lead.source}</div>
                                    </div>
                                    <div>
                                        <div className="text-sm text-muted-foreground">Verified</div>
                                        <div className="font-medium">{lead.isVerified ? 'Yes ✓' : 'No'}</div>
                                    </div>
                                    <div>
                                        <div className="text-sm text-muted-foreground">Quality Score</div>
                                        <div className={`font-medium ${lead.qualityScore ? (Math.floor(lead.qualityScore / 100) >= 70 ? 'text-emerald-500' : Math.floor(lead.qualityScore / 100) >= 50 ? 'text-amber-500' : 'text-red-500') : ''}`}>{lead.qualityScore ? `${Math.floor(lead.qualityScore / 100)} / 100` : 'N/A'}</div>
                                    </div>
                                    <div>
                                        <div className="text-sm text-muted-foreground">Seller</div>
                                        <div className="font-medium">{lead.seller?.companyName || 'Anonymous'}</div>
                                    </div>
                                </div>

                                {lead.seller && (
                                    <div className="pt-4 border-t border-border">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Users className="h-4 w-4 text-muted-foreground" />
                                                <span className="text-sm text-muted-foreground">
                                                    Reputation: {lead.seller.reputationScore}
                                                </span>
                                            </div>
                                            {lead.seller.isVerified && (
                                                <Badge variant="success">Verified Seller</Badge>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Non-PII Lead Preview (Form Fields) */}
                        <LeadPreview leadId={lead.id} autoExpand={true} />
                    </div>

                    {/* Bid Panel */}
                    <div className="space-y-6">
                        <BidPanel
                            reservePrice={lead.reservePrice}
                            highestBid={displayHighestBid}
                            phase={phase as any}
                            onPlaceBid={handlePlaceBid}
                            isLoading={bidLoading}
                        />

                        {socketError && (
                            <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                                {socketError}
                            </div>
                        )}

                        {/* Contract Link */}
                        {(() => {
                            const explorerUrl = import.meta.env.VITE_BLOCK_EXPLORER_URL || 'https://sepolia.etherscan.io';
                            const isMockId = !lead.id || !/^0x[0-9a-fA-F]{40}$/.test(lead.id);
                            return (
                                <Card>
                                    <CardContent className="p-4">
                                        <a
                                            href={isMockId ? '#' : `${explorerUrl}/address/${lead.id}`}
                                            target={isMockId ? undefined : '_blank'}
                                            rel="noopener noreferrer"
                                            className={`flex items-center justify-between text-sm transition ${isMockId ? 'text-muted-foreground/50 cursor-default' : 'text-muted-foreground hover:text-foreground'}`}
                                            onClick={isMockId ? (e: React.MouseEvent) => e.preventDefault() : undefined}
                                        >
                                            <span className="flex items-center gap-2">
                                                View on Etherscan
                                                {isMockId && (
                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                                                        MOCK
                                                    </span>
                                                )}
                                            </span>
                                            <ExternalLink className="h-4 w-4" />
                                        </a>
                                    </CardContent>
                                </Card>
                            );
                        })()}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}

export default AuctionPage;
