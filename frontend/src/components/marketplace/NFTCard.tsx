import { useState, useEffect, useMemo } from 'react';
import { ExternalLink, Shield, Tag, Gem, Wallet, Timer, Gavel, Zap, Clock } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/Tooltip';
import { ChainlinkBadge } from '@/components/ui/ChainlinkBadge';
import { HolderPerksBadge } from './HolderPerksBadge';

// ============================================
// Types
// ============================================

export interface VerticalNFT {
    slug: string;
    name: string;
    description?: string;
    status: string;
    depth: number;
    nftTokenId?: number | null;
    nftTxHash?: string | null;
    ownerAddress?: string | null;
    resaleHistory?: any[];
    parent?: { slug: string; name: string } | null;
    auction?: {
        id: string;
        endTime: string;
        highBid: number;
        highBidder?: string;
        reservePrice: number;
    } | null;
}

interface NFTCardProps {
    vertical: VerticalNFT;
    onBuy?: (slug: string) => void;
    onBid?: (slug: string, auctionId: string) => void;
    isAuthenticated?: boolean;
    currentWallet?: string;
    isBuying?: boolean;
}

// ============================================
// Helpers
// ============================================

const EXPLORER_BASE = 'https://sepolia.basescan.org';

function truncateHash(hash: string, chars = 6): string {
    if (!hash) return '';
    return `${hash.slice(0, chars + 2)}...${hash.slice(-chars)}`;
}

function getOwnershipBadge(
    ownerAddress: string | null | undefined,
    platformWallet: string | undefined,
    currentWallet: string | undefined,
): { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; className: string } {
    if (!ownerAddress) {
        return { label: 'Unminted', variant: 'outline', className: 'border-muted-foreground/30' };
    }

    const normalOwner = ownerAddress.toLowerCase();

    if (currentWallet && normalOwner === currentWallet.toLowerCase()) {
        return { label: 'Your NFT', variant: 'default', className: 'bg-green-500/10 text-green-500 border-green-500/30 hover:bg-green-500/20' };
    }

    // Check if platform-owned (heuristic: if no resaleHistory or ownerAddress matches common deployer patterns)
    // In production, you'd compare against the known platform wallet
    if (platformWallet && normalOwner === platformWallet.toLowerCase()) {
        return { label: 'Platform Owned', variant: 'default', className: 'bg-blue-500/10 text-blue-500 border-blue-500/30 hover:bg-blue-500/20' };
    }

    return { label: 'Sold', variant: 'secondary', className: 'bg-muted text-muted-foreground' };
}

// ============================================
// Component
// ============================================

export function NFTCard({
    vertical,
    onBuy,
    onBid,
    isAuthenticated = true,
    currentWallet,
    isBuying = false,
}: NFTCardProps) {
    const { openConnectModal } = useConnectModal();
    const { address } = useAccount();
    const wallet = currentWallet || address;

    const platformWallet = import.meta.env.VITE_PLATFORM_WALLET_ADDRESS;
    const ownerBadge = getOwnershipBadge(vertical.ownerAddress, platformWallet, wallet);
    const isPlatformOwned = vertical.ownerAddress?.toLowerCase() === platformWallet?.toLowerCase();
    const hasMintedNFT = !!vertical.nftTokenId;
    const hasAuction = !!vertical.auction;
    const canBuy = hasMintedNFT && isPlatformOwned && vertical.status === 'ACTIVE' && !hasAuction;
    const resaleCount = vertical.resaleHistory?.length || 0;

    // Holder perks detection
    const isHolder = useMemo(() => {
        if (!wallet || !vertical.ownerAddress) return false;
        return wallet.toLowerCase() === vertical.ownerAddress.toLowerCase();
    }, [wallet, vertical.ownerAddress]);

    const holderMultiplier = 1.2;
    const holderPrePing = useMemo(() => {
        // Deterministic pre-ping per slug (mirrors backend logic)
        let hash = 0;
        for (let i = 0; i < vertical.slug.length; i++) {
            hash = ((hash << 5) - hash + vertical.slug.charCodeAt(i)) | 0;
        }
        return 5 + (Math.abs(hash) % 6);
    }, [vertical.slug]);

    // Bid preview state (for multiplier preview)
    const [bidPreview, setBidPreview] = useState<number>(0);
    const effectiveBidPreview = isHolder
        ? Math.round(bidPreview * holderMultiplier * 100) / 100
        : bidPreview;

    // "Powered by" — show owner attribution when not platform-owned and has an owner
    const showPoweredBy = vertical.ownerAddress && !isPlatformOwned;

    // Auction countdown
    const [timeLeft, setTimeLeft] = useState('');
    const [auctionActive, setAuctionActive] = useState(false);

    useEffect(() => {
        if (!vertical.auction?.endTime) return;
        const endMs = new Date(vertical.auction.endTime).getTime();

        const tick = () => {
            const diff = endMs - Date.now();
            if (diff <= 0) {
                setTimeLeft('Ended');
                setAuctionActive(false);
                return;
            }
            setAuctionActive(true);
            const h = Math.floor(diff / 3_600_000);
            const m = Math.floor((diff % 3_600_000) / 60_000);
            const s = Math.floor((diff % 60_000) / 1_000);
            setTimeLeft(`${h}h ${m}m ${s}s`);
        };

        tick();
        const iv = setInterval(tick, 1_000);
        return () => clearInterval(iv);
    }, [vertical.auction?.endTime]);

    return (
        <Card className="group hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 relative overflow-hidden">
            {/* Gradient accent bar */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity" />

            <CardContent className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <Gem className="h-4 w-4 text-purple-500 flex-shrink-0" />
                            <h3 className="font-semibold text-lg capitalize truncate">
                                {vertical.name}
                            </h3>
                        </div>
                        {vertical.parent && (
                            <p className="text-xs text-muted-foreground ml-6">
                                ↳ {vertical.parent.name}
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1 font-mono ml-6">
                            {vertical.slug}
                        </p>
                    </div>

                    <Badge variant={ownerBadge.variant} className={ownerBadge.className}>
                        {ownerBadge.label}
                    </Badge>
                </div>

                {/* Description */}
                {vertical.description && (
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                        {vertical.description}
                    </p>
                )}

                {/* NFT Details */}
                {hasMintedNFT && (
                    <div className="space-y-2 mb-4">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground flex items-center gap-1.5">
                                <Tag className="h-3.5 w-3.5" />
                                Token ID
                            </span>
                            <span className="font-mono font-semibold">#{vertical.nftTokenId}</span>
                        </div>

                        {vertical.nftTxHash && (
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Tx Hash</span>
                                <a
                                    href={`${EXPLORER_BASE}/tx/${vertical.nftTxHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-blue-500 hover:text-blue-400 transition-colors font-mono text-xs"
                                >
                                    {truncateHash(vertical.nftTxHash)}
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                        )}

                        {vertical.ownerAddress && (
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Owner</span>
                                <a
                                    href={`${EXPLORER_BASE}/address/${vertical.ownerAddress}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors font-mono text-xs"
                                >
                                    {truncateHash(vertical.ownerAddress)}
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                        )}
                    </div>
                )}

                {/* Royalty & Resale Info */}
                <div className="mt-4 pt-4 border-t border-border">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Tooltip content="ERC-2981 royalty paid to the platform on each resale">
                                <span className="text-xs text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/40 flex items-center gap-1">
                                    <Shield className="h-3 w-3" />
                                    Royalty
                                </span>
                            </Tooltip>
                            <span className="text-sm font-semibold text-purple-500">2%</span>
                            <ChainlinkBadge size="sm" />
                        </div>
                        {resaleCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                                {resaleCount} resale{resaleCount !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                </div>

                {/* Auction Info */}
                {hasAuction && (
                    <div className="mt-3 pt-3 border-t border-border">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-amber-500 flex items-center gap-1">
                                    <Gavel className="h-3 w-3" />
                                    Auction Live
                                </span>
                                {isHolder && (
                                    <HolderPerksBadge
                                        isHolder={true}
                                        prePingSeconds={holderPrePing}
                                        multiplier={holderMultiplier}
                                        ownerAddress={vertical.ownerAddress}
                                        compact={true}
                                    />
                                )}
                            </div>
                            <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                                <Timer className="h-3 w-3" />
                                {timeLeft}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">High Bid</span>
                            <span className="font-semibold text-green-500">
                                {vertical.auction!.highBid > 0
                                    ? `$${vertical.auction!.highBid.toLocaleString()}`
                                    : `Reserve: $${vertical.auction!.reservePrice.toLocaleString()}`
                                }
                            </span>
                        </div>

                        {/* Holder multiplier preview */}
                        {isHolder && auctionActive && (
                            <div className="mt-2 space-y-1.5" id="holder-bid-preview">
                                <div className="flex items-center gap-1.5">
                                    <input
                                        type="number"
                                        placeholder="Your bid $"
                                        className="flex-1 h-7 px-2 text-xs rounded border border-amber-500/30 bg-amber-500/5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                                        min={0}
                                        step={0.01}
                                        onChange={(e) => setBidPreview(Number(e.target.value) || 0)}
                                        id="bid-preview-input"
                                    />
                                </div>
                                {bidPreview > 0 && (
                                    <div className="text-[11px] text-amber-400 flex items-center gap-1" id="effective-bid-display">
                                        <Zap className="h-3 w-3" />
                                        Effective: ${bidPreview.toFixed(2)} × {holderMultiplier} = <span className="font-semibold text-green-400">${effectiveBidPreview.toFixed(2)}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Powered by owner */}
                {showPoweredBy && (
                    <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1" id="powered-by-owner">
                        Powered by <span className="font-mono text-foreground/60">{truncateHash(vertical.ownerAddress!, 4)}</span>
                    </div>
                )}
            </CardContent>

            <CardFooter className="px-6 pb-6">
                {hasAuction && auctionActive ? (
                    isAuthenticated ? (
                        <div className="w-full space-y-2">
                            {/* Pre-ping indicator for holders */}
                            {isHolder && (
                                <div className="flex items-center justify-center gap-1.5 text-[11px] text-blue-400 bg-blue-500/5 border border-blue-500/20 rounded px-2 py-1" id="preping-indicator">
                                    <Clock className="h-3 w-3" />
                                    <span>Pre-Ping: {holderPrePing}s early access</span>
                                </div>
                            )}
                            <Button
                                className="w-full group-hover:scale-[1.02] transition-transform gap-2 bg-amber-600 hover:bg-amber-700"
                                onClick={() => onBid?.(vertical.slug, vertical.auction!.id)}
                                disabled={isBuying}
                            >
                                {isBuying ? (
                                    <>
                                        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        Bidding...
                                    </>
                                ) : (
                                    <>
                                        <Gavel className="h-4 w-4" />
                                        {isHolder ? 'Place Priority Bid' : 'Place Bid'}
                                    </>
                                )}
                            </Button>
                        </div>
                    ) : (
                        <Button
                            className="w-full group-hover:scale-[1.02] transition-transform gap-2"
                            variant="outline"
                            onClick={openConnectModal}
                            aria-label="Connect wallet to bid"
                        >
                            <Wallet className="h-4 w-4" />
                            Connect to Bid
                        </Button>
                    )
                ) : canBuy ? (
                    isAuthenticated ? (
                        <Button
                            className="w-full group-hover:scale-[1.02] transition-transform gap-2"
                            onClick={() => onBuy?.(vertical.slug)}
                            disabled={isBuying}
                        >
                            {isBuying ? (
                                <>
                                    <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Gem className="h-4 w-4" />
                                    Buy / Resell
                                </>
                            )}
                        </Button>
                    ) : (
                        <Button
                            className="w-full group-hover:scale-[1.02] transition-transform gap-2"
                            variant="outline"
                            onClick={openConnectModal}
                            aria-label="Connect wallet to buy NFT"
                        >
                            <Wallet className="h-4 w-4" />
                            Connect to Buy
                        </Button>
                    )
                ) : hasMintedNFT ? (
                    <Button className="w-full" variant="outline" disabled>
                        {ownerBadge.label === 'Your NFT' ? 'You Own This' : 'Not Available'}
                    </Button>
                ) : (
                    <Button className="w-full" variant="outline" disabled>
                        Not Minted
                    </Button>
                )}
            </CardFooter>
        </Card>
    );
}

export default NFTCard;
