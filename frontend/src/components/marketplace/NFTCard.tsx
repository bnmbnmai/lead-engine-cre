import { useState, useEffect } from 'react';
import { ExternalLink, Shield, Tag, Gem, Wallet, Timer, Gavel } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/Tooltip';
import { ChainlinkBadge } from '@/components/ui/ChainlinkBadge';

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
                            <span className="text-xs font-semibold text-amber-500 flex items-center gap-1">
                                <Gavel className="h-3 w-3" />
                                Auction Live
                            </span>
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
                    </div>
                )}
            </CardContent>

            <CardFooter className="px-6 pb-6">
                {hasAuction && auctionActive ? (
                    isAuthenticated ? (
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
                                    Place Bid
                                </>
                            )}
                        </Button>
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
