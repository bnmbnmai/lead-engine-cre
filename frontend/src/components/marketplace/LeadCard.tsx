import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Shield, Zap, Users, Wallet, Star, Eye, TrendingUp } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/Tooltip';
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
            className={`group transition-all duration-300 hover:z-50
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
            <CardContent className="p-5 relative">
                {/* ── Top-right badge stack ──────────────────────────────────────
                     Compact vertical pills. z-20 prevents clipping on any width.
                     Priority order: Bounty (eye-catching) → CRE → Verified
                     ────────────────────────────────────────────────────────────── */}
                <div className="absolute top-3 right-3 z-20 hover:z-50 flex flex-col items-end gap-1">
                    {/* 1. Bounty — warm gold, only when > 0 — most eye-catching badge */}
                    {(lead.parameters?._bountyTotal ?? 0) > 0 && (
                        <Tooltip content={`$${lead.parameters!._bountyTotal!.toFixed(0)} active bounty pool — seller earns a bonus on top of the winning bid`}>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border bg-gradient-to-r from-amber-500/15 to-yellow-500/10 text-amber-300 border-amber-400/30 shadow-sm shadow-amber-500/10 cursor-help">
                                💰 +${lead.parameters!._bountyTotal!.toFixed(0)}
                            </span>
                        </Tooltip>
                    )}

                    {/* 2. CRE Quality Score — muted, informational
                         NOTE: qualityScore arrives from API already as 0-100 (backend normalizes) */}
                    {lead.qualityScore != null ? (() => {
                        const score = lead.qualityScore; // already 0-100 from API
                        const colors = score >= 80
                            ? 'bg-emerald-500/10 text-emerald-400/80 border-emerald-500/20'
                            : score >= 50
                                ? 'bg-amber-500/8 text-amber-400/70 border-amber-500/15'
                                : 'bg-zinc-500/8 text-zinc-400/60 border-zinc-500/15';
                        return (
                            <Tooltip content={score === 0
                                ? 'CRE quality scoring in progress'
                                : `CRE Quality Score: ${score}/100`}
                            >
                                <span className={`inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[9px] font-medium border cursor-help ${colors}`}>
                                    CRE {score}
                                </span>
                            </Tooltip>
                        );
                    })() : (
                        <Tooltip content="CRE quality scoring pending">
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[9px] font-medium border bg-zinc-500/5 text-zinc-500/50 border-zinc-500/10 cursor-help">
                                CRE —
                            </span>
                        </Tooltip>
                    )}

                    {/* 3. Verified — tiny, subtle */}
                    {lead.isVerified && (
                        <Tooltip content="Verified on-chain via Chainlink CRE oracle network">
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[9px] font-medium border bg-blue-500/8 text-blue-400/70 border-blue-500/15 cursor-help">
                                ✓ Verified
                            </span>
                        </Tooltip>
                    )}

                    {/* 4. TEE + ACE — micro-chips, only when present */}
                    {(lead.chttEnriched || lead.aceCompliant != null) && (
                        <div className="flex items-center gap-1">
                            {lead.chttEnriched && (
                                <Tooltip content="Chainlink Confidential TEE enrichment">
                                    <span className="px-1 py-px rounded text-[8px] font-bold border bg-violet-500/10 text-violet-400/60 border-violet-500/15 cursor-help">
                                        TEE
                                    </span>
                                </Tooltip>
                            )}
                            {lead.aceCompliant != null && (
                                <Tooltip content={`ACE Compliance: ${lead.aceCompliant ? 'passed' : 'failed'}`}>
                                    <span className={`px-1 py-px rounded text-[8px] font-semibold border cursor-help ${lead.aceCompliant
                                        ? 'bg-emerald-500/8 text-emerald-400/60 border-emerald-500/15'
                                        : 'bg-rose-500/8 text-rose-400/60 border-rose-500/15'
                                        }`}>
                                        ACE
                                    </span>
                                </Tooltip>
                            )}
                        </div>
                    )}
                </div>



                {/* ── Header ──────────────────────────────────────────────────────── */}
                <div className="flex items-start gap-3 mb-3 pr-24">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${lead.isVerified ? 'bg-emerald-500/12' : 'bg-zinc-500/15'
                        }`}>
                        {lead.isVerified ? (
                            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-emerald-500" aria-label="Chainlink Verified">
                                <path d="M12 1.5L3 7v10l9 5.5L21 17V7L12 1.5zM12 4.31l6 3.67v7.04l-6 3.67-6-3.67V7.98l6-3.67z" />
                                <path d="M12 8l-4 2.45v4.1L12 17l4-2.45v-4.1L12 8z" />
                            </svg>
                        ) : (
                            <Shield className="h-5 w-5 text-zinc-500" />
                        )}
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-semibold text-[15px] leading-tight">{formatVerticalTitle(lead.vertical)}</h3>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">{lead.geo.city ? `${lead.geo.city}, ` : ''}{lead.geo.state || 'Unknown'}</span>
                        </div>
                        {lead.seller?.companyName && (
                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70 mt-0.5">
                                <Star className="h-2.5 w-2.5 text-amber-500 shrink-0" />
                                <span className="truncate max-w-[100px]">{lead.seller.companyName}</span>
                                <span className="opacity-60">{(Number(lead.seller.reputationScore) / 100).toFixed(0)}%</span>
                                {lead.seller.isVerified && <span className="text-emerald-500 font-semibold">✓</span>}
                            </div>
                        )}
                        <div className="text-[9px] text-muted-foreground/40 font-mono mt-0.5" title={lead.id}>
                            {lead.id.slice(0, 8)}…
                        </div>
                    </div>
                </div>

                {/* Source & Stats */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
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
                {isLive && progress !== null && !isClosed && (
                    <div className="mb-4">
                        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
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

                {/* Status strip — compact, no height change */}
                {(auctionEndFeedback || (isLive && isSealed)) && (
                    <div className={`flex items-center gap-1.5 text-[10px] font-semibold py-1 ${isLive && isSealed
                        ? 'text-orange-400'
                        : auctionEndFeedback === 'SOLD'
                            ? 'text-emerald-400'
                            : 'text-muted-foreground'
                        }`}>
                        {isLive && isSealed ? (
                            <><span className="animate-pulse">🔒</span> Sealed — resolving…</>
                        ) : auctionEndFeedback === 'SOLD' ? (
                            <>✅ Sold{liveHighestBid != null && <span className="ml-0.5 font-bold">${liveHighestBid.toFixed(2)}</span>}</>
                        ) : (
                            <>← Buy It Now</>
                        )}
                    </div>
                )}

                {/* Pricing & Action */}
                <div className="flex items-center justify-between pt-3 border-t border-border/50">
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
