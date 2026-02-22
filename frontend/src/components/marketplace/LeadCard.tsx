import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Clock, Shield, Zap, Users, Wallet, Star, Eye, Gift, TrendingUp, ArrowRight } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/Tooltip';
import { ChainlinkBadge } from '@/components/ui/ChainlinkBadge';
import { formatCurrency, formatTimeRemaining, getPhaseLabel, formatVerticalTitle } from '@/lib/utils';
import { useAuctionStore } from '@/store/auctionStore';

interface Lead {
    id: string;
    vertical: string;
    geo: { state?: string; city?: string };
    source: 'PLATFORM' | 'API' | 'OFFSITE';
    status: string;
    reservePrice: number;
    isVerified: boolean;
    qualityScore?: number;
    /** True when the score was enriched by the Chainlink CHTT TEE fraud-signal workflow. */
    chttEnriched?: boolean;
    /** CHTT-enriched score (0–100) for display. Falls back to qualityScore. */
    chttScore?: number;
    /** True when ACECompliance.isCompliant() returned true for this lead's seller/minter. */
    aceCompliant?: boolean | null;
    auctionEndAt?: string;
    auctionStartAt?: string;
    auctionDuration?: number;
    _count?: { bids: number };
    auctionRoom?: { bidCount?: number; highestBid?: number };
    parameters?: { _bountyTotal?: number };
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
    /** Real-time floor price from Chainlink Data Feeds */
    floorPrice?: number | null;
    /** Temporary feedback when an auction ends — 'UNSOLD' or 'SOLD' (from Zustand store) */
    auctionEndFeedback?: 'UNSOLD' | 'SOLD';
}

export function LeadCard({ lead, showBidButton = true, isAuthenticated = true, floorPrice, auctionEndFeedback }: LeadCardProps) {
    const { openConnectModal } = useConnectModal();

    // ── Read live auction state from Zustand store ──────────────────────────
    // The global socketBridge (mounted in App.tsx) maintains this store for ALL cards.
    // No per-card socket listeners needed — eliminates BUG-B (missed events off-screen).
    const storeSlice = useAuctionStore((s) => s.leads.get(lead.id));

    const isClosed = storeSlice?.isClosed ?? (lead.status !== 'IN_AUCTION');
    const isSealed = storeSlice?.isSealed ?? false;
    const liveBidCount = storeSlice?.liveBidCount ?? null;
    // liveRemainingMs from store is clock-drift-corrected; fall back to local auctionEndAt calc
    const storeRemainingMs = storeSlice?.liveRemainingMs ?? null;

    const isLive = !isClosed && lead.status === 'IN_AUCTION';
    const phaseLabel = getPhaseLabel(lead.status);
    const effectiveBidCount = liveBidCount ?? (lead._count?.bids || lead.auctionRoom?.bidCount || 0);

    // Bid button is disabled when auction is closed or in sealed phase
    const bidDisabled = isClosed || isSealed;

    // ── Local countdown (visual only — ticks every second) ─────────────────
    const [timeLeft, setTimeLeft] = useState<string | null>(
        lead.auctionEndAt ? formatTimeRemaining(lead.auctionEndAt) : null
    );
    const [remainingMs, setRemainingMs] = useState<number | null>(
        storeRemainingMs ?? (lead.auctionEndAt ? Math.max(0, new Date(lead.auctionEndAt).getTime() - Date.now()) : null)
    );
    const [progress, setProgress] = useState<number | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Sync remainingMs from store when it updates (drift-corrected from server)
    useEffect(() => {
        if (storeRemainingMs != null) setRemainingMs(storeRemainingMs);
    }, [storeRemainingMs]);

    // Stop countdown immediately when store marks card as closed
    useEffect(() => {
        if (isClosed) {
            setRemainingMs(0);
            if (intervalRef.current) clearInterval(intervalRef.current);
        }
    }, [isClosed]);

    useEffect(() => {
        if (!isLive || !lead.auctionEndAt) {
            setTimeLeft(lead.auctionEndAt ? formatTimeRemaining(lead.auctionEndAt) : null);
            setProgress(null);
            return;
        }

        const tick = () => {
            const endMs = new Date(lead.auctionEndAt!).getTime();
            const ms = Math.max(0, endMs - Date.now());
            setRemainingMs(ms);
            setTimeLeft(formatTimeRemaining(lead.auctionEndAt!));
            if (lead.auctionStartAt) {
                const start = new Date(lead.auctionStartAt).getTime();
                const total = endMs - start;
                if (total > 0) {
                    setProgress(Math.min(Math.round(((Date.now() - start) / total) * 100), 100));
                }
            }
        };

        tick();
        intervalRef.current = setInterval(tick, 1000);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [isLive, lead.auctionEndAt, lead.auctionStartAt]);

    // Animated bid counter — pulse on change
    const prevBidCount = useRef(effectiveBidCount);
    const [bidPulse, setBidPulse] = useState(false);

    useEffect(() => {
        if (effectiveBidCount > prevBidCount.current) {
            setBidPulse(true);
            const timer = setTimeout(() => setBidPulse(false), 600);
            prevBidCount.current = effectiveBidCount;
            return () => clearTimeout(timer);
        }
        prevBidCount.current = effectiveBidCount;
    }, [effectiveBidCount]);

    return (
        <Card className={`group transition-all duration-500 ${isLive ? 'border-blue-500/50 glow-ready' : ''} ${auctionEndFeedback ? 'opacity-50 grayscale pointer-events-none' : ''} active:scale-[0.98]`}>
            <CardContent className="p-6">
                {/* Auction End Feedback Overlay (from Zustand store 8s timer) */}
                {auctionEndFeedback && (
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold mb-4 animate-pulse ${auctionEndFeedback === 'SOLD'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        }`}>
                        <ArrowRight className="h-3.5 w-3.5" />
                        {auctionEndFeedback === 'SOLD' ? 'Auction ended → Sold' : 'Auction ended → Buy It Now'}
                    </div>
                )}
                {/* isClosed overlay — shown the instant server emits auction:closed */}
                {isClosed && !auctionEndFeedback && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold mb-4 bg-gray-500/15 text-gray-400 border border-gray-500/30">
                        <Clock className="h-3.5 w-3.5" />
                        Auction Ended
                    </div>
                )}
                {/* 🔒 SEALED banner — server accepted last bid, resolving winner */}
                {isLive && isSealed && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 border border-orange-500/30 text-xs font-bold animate-pulse mb-3">
                        🔒 Sealed — bids locked, resolving winner…
                    </div>
                )}
                {/* ⚠️ Closing imminently banner (≤10 s, not yet sealed) */}
                {isLive && !isSealed && remainingMs !== null && remainingMs > 0 && remainingMs <= 10_000 && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 text-xs font-bold animate-pulse mb-3">
                        🔒 Closing in {Math.ceil(remainingMs / 1000)}s — place final bids now
                    </div>
                )}
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
                        {/* CRE Quality Score badge */}
                        {lead.qualityScore != null ? (
                            <Tooltip content={lead.chttEnriched
                                ? `CRE Quality Score — enriched by Chainlink CHTT TEE (${Math.floor(lead.qualityScore / 100)}/100)`
                                : `CRE Quality Score: ${Math.floor(lead.qualityScore / 100)}/100 — confirmed on-chain after purchase`}
                            >
                                <span
                                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide border cursor-help ${lead.qualityScore >= 7000
                                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                        : lead.qualityScore >= 5000
                                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                            : 'bg-red-500/15 text-red-400 border-red-500/30'
                                        }`}
                                >
                                    <Shield className="h-3 w-3" />
                                    CRE {Math.floor(lead.qualityScore / 100)}/100
                                    {lead.chttEnriched && <span className="ml-0.5 opacity-75">🔒</span>}
                                </span>
                            </Tooltip>
                        ) : (
                            <Tooltip content="CRE quality score pending — confirmed on-chain after purchase">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide border bg-zinc-500/10 text-zinc-400 border-zinc-500/30 cursor-help">
                                    <Shield className="h-3 w-3" />
                                    CRE —
                                </span>
                            </Tooltip>
                        )}
                        {/* ACE Compliance badge */}
                        {lead.aceCompliant != null ? (
                            <Tooltip content={lead.aceCompliant
                                ? 'ACE Compliance: on-chain check passed — caller is compliant with all active policies'
                                : 'ACE Compliance: on-chain check failed — caller did not pass active policies'}
                            >
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide border cursor-help ${lead.aceCompliant
                                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                    : 'bg-red-500/15 text-red-400 border-red-500/30'
                                    }`}>
                                    {lead.aceCompliant ? '✓' : '✗'} ACE
                                </span>
                            </Tooltip>
                        ) : null}
                        {/* TEE badge */}
                        {lead.chttEnriched && (
                            <Tooltip content="Quality score enriched by Chainlink Confidential HTTP inside a Trusted Execution Environment (TEE). External fraud signals (phone validation, email hygiene, conversion propensity) processed securely in enclave without exposing any PII.">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-widest border bg-violet-500/25 text-violet-300 border-violet-500/50 cursor-help uppercase shadow-sm shadow-violet-500/20">
                                    🔒 TEE
                                </span>
                            </Tooltip>
                        )}
                        {lead.isVerified && (
                            <Tooltip content={lead.chttEnriched
                                ? 'Lead data verified on-chain via Chainlink CRE oracle network + Confidential HTTP TEE enrichment.'
                                : 'Lead data verified on-chain via Chainlink CRE oracle network.'}>
                                <span className="cursor-help">
                                    <ChainlinkBadge size="sm" />
                                </span>
                            </Tooltip>
                        )}
                        {(lead.parameters?._bountyTotal ?? 0) > 0 && (
                            <Tooltip content={`$${lead.parameters!._bountyTotal!.toFixed(0)} active bounty pool on this vertical`}>
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold border bg-amber-500/15 text-amber-400 border-amber-500/30 cursor-help">
                                    <Gift className="h-3 w-3" />
                                    ${lead.parameters!._bountyTotal!.toFixed(0)}
                                </span>
                            </Tooltip>
                        )}
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
                        <span className="font-medium">{effectiveBidCount}</span> bids
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
                        {/* Chainlink Data Feeds floor price */}
                        {floorPrice != null && (
                            <Tooltip content="Chainlink Data Feeds — real-time market floor for this vertical">
                                <div className={`flex items-center gap-1 text-[11px] mt-0.5 cursor-help ${floorPrice > lead.reservePrice
                                    ? 'text-amber-400'
                                    : 'text-muted-foreground'
                                    }`}>
                                    <TrendingUp className="h-3 w-3" />
                                    Floor {formatCurrency(floorPrice)}
                                </div>
                            </Tooltip>
                        )}
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
                                <Button
                                    asChild={!bidDisabled}
                                    size="sm"
                                    variant="gradient"
                                    disabled={bidDisabled}
                                    aria-disabled={bidDisabled}
                                >
                                    {bidDisabled ? (
                                        <span>{isSealed ? '🔒 Sealed' : 'Ended'}</span>
                                    ) : (
                                        <Link to={`/auction/${lead.id}`}>Place Bid</Link>
                                    )}
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
        </Card>
    );
}

export default LeadCard;
