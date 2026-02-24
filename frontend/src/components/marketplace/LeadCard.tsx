import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Shield, Zap, Users, Wallet, Star, Eye, Gift, TrendingUp, ArrowRight } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/Tooltip';
import { ChainlinkBadge } from '@/components/ui/ChainlinkBadge';
import { formatCurrency, formatMsRemaining, getPhaseLabel, formatVerticalTitle } from '@/lib/utils';
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
    creRequestedAt?: string;
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

    // ── v8: Pure server-authoritative phase machine ────────────────────────
    // storeSlice is populated by socketBridge within ~200 ms of mount.
    // Until then, treat as 'loading' (renders greyed-out neutral state).
    // Never fall back to lead.status (API prop) for phase — avoids the
    // 200 ms race where API still says IN_AUCTION on a just-closed auction.
    const auctionPhase = storeSlice?.auctionPhase ?? 'live'; // safe: forceRefreshLead on mount
    const isClosed = auctionPhase === 'closed';
    const isClosingSoon = auctionPhase === 'closing-soon';
    const isLive = !isClosed; // live || closing-soon both allow bidding
    const effectiveStatus = storeSlice?.status ?? lead.status;
    const isSealed = storeSlice?.isSealed ?? false;
    const liveBidCount = storeSlice?.liveBidCount ?? null;
    const liveHighestBid = storeSlice?.liveHighestBid ?? null;
    // liveRemainingMs: server-corrected baseline; ticked down locally each second.
    // This is the SOLE source for time display — no Date.now() in countdown.
    const storeRemainingMs = storeSlice?.liveRemainingMs ?? null;
    const phaseLabel = getPhaseLabel(effectiveStatus);
    const effectiveBidCount = liveBidCount ?? (lead._count?.bids || lead.auctionRoom?.bidCount || 0);
    // v9: isFadingOut — useState so React re-renders when setTimeout fires
    const [isFadingOut, setIsFadingOut] = useState(false);

    // ── v8: Pure-server countdown tick ───────────────────────────────
    // remainingRef tracks the current ms count. On each storeRemainingMs update
    // (arrives every ~2 s from AuctionMonitor), we re-baseline the ref to the
    // fresh server value. Between server ticks we decrement by 1000 ms locally.
    // formatMsRemaining(ms) never calls Date.now() — purely ms math.
    const remainingRef = useRef<number>(storeRemainingMs ?? 0);
    const [displayMs, setDisplayMs] = useState<number>(storeRemainingMs ?? 0);
    const [progress, setProgress] = useState<number | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Re-baseline from server whenever its value updates
    useEffect(() => {
        if (storeRemainingMs == null) return;
        remainingRef.current = storeRemainingMs;
        setDisplayMs(storeRemainingMs);
    }, [storeRemainingMs]);

    // Stop countdown immediately when store marks card as closed
    useEffect(() => {
        if (isClosed) {
            remainingRef.current = 0;
            setDisplayMs(0);
            if (intervalRef.current) clearInterval(intervalRef.current);
        }
    }, [isClosed]);

    // v9: schedule opacity fade 100ms after store sets fadeOutAt
    useEffect(() => {
        const fadeOutAt = storeSlice?.fadeOutAt;
        if (!fadeOutAt) return;
        const delay = Math.max(0, fadeOutAt - Date.now());
        const timer = setTimeout(() => setIsFadingOut(true), delay);
        return () => clearTimeout(timer);
    }, [storeSlice?.fadeOutAt]);

    useEffect(() => {
        if (!isLive) {
            setProgress(null);
            if (intervalRef.current) clearInterval(intervalRef.current);
            return;
        }

        const tick = () => {
            remainingRef.current = Math.max(0, remainingRef.current - 1_000);
            setDisplayMs(remainingRef.current);
            // Progress bar: counts from auctionDuration down (visual only)
            if (lead.auctionDuration && lead.auctionDuration > 0) {
                const elapsed = lead.auctionDuration * 1000 - remainingRef.current;
                setProgress(Math.min(Math.round((elapsed / (lead.auctionDuration * 1000)) * 100), 100));
            }
        };

        intervalRef.current = setInterval(tick, 1_000);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [isLive, lead.auctionDuration]);

    const timeLeft = isLive && displayMs > 0 ? formatMsRemaining(displayMs) : (isClosed ? 'Ended' : null);

    // Animated bid counter — pulse on change
    const prevBidCount = useRef(effectiveBidCount);
    const [bidPulse, setBidPulse] = useState(false);
    const [showNewBidFlash, setShowNewBidFlash] = useState(false);
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (effectiveBidCount > prevBidCount.current) {
            setBidPulse(true);
            setShowNewBidFlash(true);
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => {
                setBidPulse(false);
                setShowNewBidFlash(false);
            }, 800);
            prevBidCount.current = effectiveBidCount;
            return () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); };
        }
        prevBidCount.current = effectiveBidCount;
    }, [effectiveBidCount]);

    const recentBids = storeSlice?.recentBids ?? [];

    return (
        <Card
            data-auction-state={auctionPhase}
            className={`group transition-all duration-300
                ${!isClosed && isClosingSoon ? 'border-amber-400/60 ring-2 ring-amber-400/20' : ''}
                ${!isClosed && isLive && !isClosingSoon && !showNewBidFlash ? 'border-blue-500/50 glow-ready' : ''}
                ${!isClosed && showNewBidFlash ? 'border-emerald-400/70 ring-2 ring-emerald-400/30' : ''}
                ${isClosed ? 'border-border grayscale' : ''}
                ${auctionEndFeedback ? 'pointer-events-none' : ''}
                active:scale-[0.98]`}
            style={isClosed ? {
                opacity: isFadingOut ? 0 : 0.6,
                transition: isFadingOut
                    ? 'opacity 2500ms ease-out, filter 2500ms ease-out, transform 300ms'
                    : 'opacity 0.3s, filter 0.3s, transform 300ms',
                pointerEvents: isFadingOut ? 'none' : undefined,
            } : undefined}
        >
            <CardContent className="p-6">
                {/* Auction End Feedback tag — quiet, no flash */}
                {auctionEndFeedback && (
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold mb-4 ${auctionEndFeedback === 'SOLD'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}>
                        <ArrowRight className="h-3.5 w-3.5" />
                        {auctionEndFeedback === 'SOLD' ? (
                            <>
                                Auction ended → Sold
                                {liveHighestBid != null && (
                                    // R-04: Show final winning price in emerald chip
                                    <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[11px]">
                                        ${liveHighestBid.toFixed(2)}
                                    </span>
                                )}
                            </>
                        ) : (
                            <>Auction ended → Buy It Now</>
                        )}
                    </div>
                )}
                {/* v9: closing-soon does NOT show a banner; card border signals urgency subtly. */}
                {/* v9: closure is handled by card greying (className above) — no extra overlay. */}
                {/* 🔒 SEALED banner — only shown while still live (resolving) */}
                {isLive && isSealed && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 border border-orange-500/30 text-xs font-bold animate-pulse mb-3">
                        🔒 Sealed — resolving winner…
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
                        ) : (lead.creRequestedAt && Date.now() - new Date(lead.creRequestedAt).getTime() > 2 * 60 * 1000) ? (
                            <Tooltip content="Quality score pending from Chainlink DON">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide border bg-amber-500/15 text-amber-400 border-amber-500/30 cursor-help">
                                    <span className="animate-pulse">⏳</span>
                                    CRE Pending
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

                    {/* Bid count with hover tooltip showing last 3 bids */}
                    <Tooltip content={
                        recentBids.length > 0
                            ? recentBids.map((b) => `${b.buyer}: $${b.amount.toFixed(2)}`).join(' • ')
                            : `${effectiveBidCount} bid${effectiveBidCount !== 1 ? 's' : ''} placed`
                    }>
                        <div
                            className={`flex items-center gap-1 cursor-help transition-all duration-300 ${bidPulse ? 'text-emerald-400 scale-110' : ''}`}
                        >
                            <Users className="h-4 w-4" />
                            <span className="font-medium">{effectiveBidCount}</span> bids
                        </div>
                    </Tooltip>
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

                    {/* ── Action buttons ─────────────────────────────────────────────────────
                         * IRONCLAD v4 gate: isLive is the ONLY key that unlocks bid actions.
                         *   isLive = !isClosed && !isSealed && effectiveStatus === 'IN_AUCTION'
                         * If the store says the lead is closed, effectiveStatus is forced to
                         * SOLD|UNSOLD regardless of what the API prop says, so isLive is false.
                         * No bid button is ever rendered for !isLive cards — only "View Details".
                         * ─────────────────────────────────────────────────────────────────── */}
                    {showBidButton && (
                        <div className="flex items-center gap-2">
                            {isLive ? (
                                /* ── LIVE: Details + action button ── */
                                <>
                                    <Button asChild size="sm" variant="outline">
                                        <Link to={`/lead/${lead.id}`}>
                                            <Eye className="h-3.5 w-3.5 mr-1" />
                                            Details
                                        </Link>
                                    </Button>

                                    {isAuthenticated ? (
                                        /* Authenticated: Place Bid (sealed guard) */
                                        <Button
                                            asChild={!isSealed}
                                            size="sm"
                                            variant="gradient"
                                            disabled={isSealed}
                                            aria-disabled={isSealed}
                                        >
                                            {isSealed ? (
                                                <span>🔒 Sealed</span>
                                            ) : (
                                                <Link to={`/auction/${lead.id}`}>Place Bid</Link>
                                            )}
                                        </Button>
                                    ) : (
                                        /* Unauthenticated: Connect to Bid */
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
                                </>
                            ) : (
                                /* ── ENDED / SOLD / UNSOLD: passive View Details only ── */
                                <Button asChild size="sm" variant="outline" disabled>
                                    <Link to={`/lead/${lead.id}`}>
                                        <Eye className="h-3.5 w-3.5 mr-1" />
                                        View Details
                                    </Link>
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

export default LeadCard;
