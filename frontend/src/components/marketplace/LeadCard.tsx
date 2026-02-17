import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Clock, Shield, Zap, Users, Wallet, Star, Eye } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/Tooltip';
import { ChainlinkBadge } from '@/components/ui/ChainlinkBadge';
import { formatCurrency, formatTimeRemaining, getPhaseLabel, formatVerticalTitle } from '@/lib/utils';

interface Lead {
    id: string;
    vertical: string;
    geo: { state?: string; city?: string };
    source: 'PLATFORM' | 'API' | 'OFFSITE';
    status: string;
    reservePrice: number;
    isVerified: boolean;
    qualityScore?: number;
    auctionEndAt?: string;
    auctionStartAt?: string;
    auctionDuration?: number;
    _count?: { bids: number };
    auctionRoom?: { bidCount?: number; highestBid?: number };
    seller?: {
        id: string;
        companyName: string;
        reputationScore: number;
        isVerified: boolean;
    };
}

interface LeadCardProps {
    lead: Lead;
    showBidButton?: boolean;
    isAuthenticated?: boolean;
}

export function LeadCard({ lead, showBidButton = true, isAuthenticated = true }: LeadCardProps) {
    const { openConnectModal } = useConnectModal();
    const isLive = lead.status === 'IN_AUCTION';
    const bidCount = lead._count?.bids || lead.auctionRoom?.bidCount || 0;
    const phaseLabel = getPhaseLabel(lead.status);

    // Live countdown timer — ticks every second for in-auction leads
    const [timeLeft, setTimeLeft] = useState<string | null>(
        lead.auctionEndAt ? formatTimeRemaining(lead.auctionEndAt) : null
    );
    const [progress, setProgress] = useState<number | null>(null);

    useEffect(() => {
        if (!isLive || !lead.auctionEndAt) {
            setTimeLeft(lead.auctionEndAt ? formatTimeRemaining(lead.auctionEndAt) : null);
            setProgress(null);
            return;
        }

        const tick = () => {
            setTimeLeft(formatTimeRemaining(lead.auctionEndAt!));
            if (lead.auctionStartAt) {
                const start = new Date(lead.auctionStartAt).getTime();
                const end = new Date(lead.auctionEndAt!).getTime();
                const now = Date.now();
                const total = end - start;
                if (total > 0) {
                    setProgress(Math.min(Math.round(((now - start) / total) * 100), 100));
                }
            }
        };

        tick(); // initial value
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [isLive, lead.auctionEndAt, lead.auctionStartAt]);

    // Animated bid counter — pulse on change
    const prevBidCount = useRef(bidCount);
    const [bidPulse, setBidPulse] = useState(false);

    useEffect(() => {
        if (bidCount > prevBidCount.current) {
            setBidPulse(true);
            const timer = setTimeout(() => setBidPulse(false), 600);
            prevBidCount.current = bidCount;
            return () => clearTimeout(timer);
        }
        prevBidCount.current = bidCount;
    }, [bidCount]);

    return (
        <Card className={`group transition-all ${isLive ? 'border-blue-500/50 glow-ready' : ''} active:scale-[0.98]`}>
            <CardContent className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${lead.isVerified ? 'bg-emerald-500/15 verified-glow' : 'bg-gray-500/20'
                            }`}>
                            {lead.isVerified ? (
                                <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-emerald-500" aria-label="Chainlink Verified">
                                    <path d="M12 1.5L3 7v10l9 5.5L21 17V7L12 1.5zM12 4.31l6 3.67v7.04l-6 3.67-6-3.67V7.98l6-3.67z" />
                                    <path d="M12 8l-4 2.45v4.1L12 17l4-2.45v-4.1L12 8z" />
                                </svg>
                            ) : (
                                <Shield className="h-6 w-6 text-gray-500" />
                            )}
                        </div>
                        <div>
                            <h3 className="font-semibold">{formatVerticalTitle(lead.vertical)}</h3>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                {lead.geo.city ? `${lead.geo.city}, ` : ''}{lead.geo.state || 'Unknown'}
                            </div>
                            {lead.seller?.companyName && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Star className="h-3 w-3 text-amber-500" />
                                    <span className="truncate max-w-[120px]">{lead.seller.companyName}</span>
                                    <span className="text-[10px] opacity-70">
                                        {(Number(lead.seller.reputationScore) / 100).toFixed(0)}%
                                    </span>
                                    {lead.seller.isVerified && (
                                        <span className="text-emerald-500 text-[10px] font-semibold">✓</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {lead.qualityScore != null ? (
                            <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide border ${lead.qualityScore >= 7000
                                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                    : lead.qualityScore >= 5000
                                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                        : 'bg-red-500/15 text-red-400 border-red-500/30'
                                    }`}
                                title="CRE Pre-score — confirmed on-chain after purchase"
                            >
                                QS {Math.floor(lead.qualityScore / 100)}
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide border bg-zinc-500/10 text-zinc-400 border-zinc-500/30">
                                QS —
                            </span>
                        )}
                        {lead.isVerified && <ChainlinkBadge size="sm" />}
                    </div>
                </div>

                {/* Source & Stats */}
                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                    {lead.source === 'OFFSITE' && (
                        <div className="flex items-center gap-1 text-yellow-500">
                            <Zap className="h-4 w-4" />
                            Off-site
                        </div>
                    )}
                    {lead.source === 'API' && (
                        <div className="flex items-center gap-1 text-purple-500">
                            <span className="font-mono text-xs">API</span>
                        </div>
                    )}
                    {isLive && timeLeft && (
                        <div className="flex items-center gap-1 text-violet-400">
                            <Zap className="h-3.5 w-3.5" />
                            <span className="text-xs font-semibold">
                                {phaseLabel} • {timeLeft}
                            </span>
                        </div>
                    )}
                    <div
                        className={`flex items-center gap-1 transition-all duration-300 ${bidPulse ? 'text-blue-400 scale-110' : ''
                            }`}
                    >
                        <Users className="h-4 w-4" />
                        <span className="font-medium">{bidCount}</span> bids
                    </div>
                    {!isLive && timeLeft && (
                        <div className="flex items-center gap-1 text-blue-500">
                            <Clock className="h-4 w-4" />
                            {timeLeft}
                        </div>
                    )}
                </div>

                {/* Auction Progress Bar */}
                {isLive && progress !== null && (
                    <div className="mb-4">
                        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-1000 ease-linear"
                                style={{ width: `${Math.min(progress, 100)}%` }}
                            />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                            <span>Started</span>
                            <span>{progress}% elapsed</span>
                        </div>
                    </div>
                )}

                {/* Pricing & Action */}
                <div className="flex items-center justify-between pt-4 border-t border-border">
                    <div>
                        <Tooltip content="Minimum bid amount accepted by the seller">
                            <span className="text-xs text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/40">Reserve</span>
                        </Tooltip>
                        <div className="text-lg font-bold">{formatCurrency(lead.reservePrice)}</div>
                    </div>

                    {showBidButton && isLive && (
                        <div className="flex items-center gap-2">
                            <Button asChild size="sm" variant="outline">
                                <Link to={`/lead/${lead.id}`}>
                                    <Eye className="h-3.5 w-3.5 mr-1" />
                                    Details
                                </Link>
                            </Button>
                            {isAuthenticated ? (
                                <Button asChild size="sm" variant="gradient">
                                    <Link to={`/auction/${lead.id}`}>
                                        Place Bid
                                    </Link>
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    variant="glass"
                                    onClick={openConnectModal}
                                    aria-label="Connect wallet to place a bid"
                                    className="gap-1.5"
                                >
                                    <Wallet className="h-3.5 w-3.5" />
                                    Connect to Bid
                                </Button>
                            )}
                        </div>
                    )}

                    {showBidButton && !isLive && (
                        <Button asChild size="sm" variant="outline">
                            <Link to={`/lead/${lead.id}`}>
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                View Details
                            </Link>
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card >
    );
}

export default LeadCard;
