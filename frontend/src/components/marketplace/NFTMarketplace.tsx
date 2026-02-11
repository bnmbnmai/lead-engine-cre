import { useState, useEffect, useCallback } from 'react';
import { Search, Gem, RefreshCw } from 'lucide-react';
import { useAccount } from 'wagmi';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import NFTCard from './NFTCard';
import type { VerticalNFT } from './NFTCard';
import api from '@/lib/api';
import useAuth from '@/hooks/useAuth';
import { toast } from '@/hooks/useToast';

// ============================================
// NFT Marketplace Section
// ============================================

export function NFTMarketplace() {
    const { isAuthenticated } = useAuth();
    const { address } = useAccount();
    const [verticals, setVerticals] = useState<VerticalNFT[]>([]);
    const [filteredVerticals, setFilteredVerticals] = useState<VerticalNFT[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [buyingSlug, setBuyingSlug] = useState<string | null>(null);

    // ─── Fetch NFTs ────────────────────────────
    const fetchNFTs = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await api.getVerticalNFTs({ status: 'ACTIVE' });
            if (result.data) {
                // Only show verticals that have been minted as NFTs
                const nftVerticals = result.data.verticals.filter(
                    (v: any) => v.nftTokenId !== null && v.nftTokenId !== undefined
                );
                setVerticals(nftVerticals);
                setFilteredVerticals(nftVerticals);
            }
        } catch (err) {
            console.error('Failed to fetch NFTs:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchNFTs();
    }, [fetchNFTs]);

    // ─── Search Filter ─────────────────────────
    useEffect(() => {
        if (!search.trim()) {
            setFilteredVerticals(verticals);
            return;
        }
        const q = search.toLowerCase();
        setFilteredVerticals(
            verticals.filter(
                (v) =>
                    v.name.toLowerCase().includes(q) ||
                    v.slug.toLowerCase().includes(q) ||
                    v.description?.toLowerCase().includes(q)
            )
        );
    }, [search, verticals]);

    // ─── Buy Handler ───────────────────────────
    const handleBuy = useCallback(async (slug: string) => {
        if (!address) {
            toast({
                type: 'error',
                title: 'Wallet Required',
                description: 'Please connect your wallet to purchase an NFT.',
            });
            return;
        }

        setBuyingSlug(slug);
        try {
            const result = await api.resaleVertical(slug, address, 1.0);

            if (result.error) {
                toast({
                    type: 'error',
                    title: 'Purchase Failed',
                    description: result.error.error || 'Transaction failed. Please try again.',
                });
                return;
            }

            if (result.data) {
                toast({
                    type: 'success',
                    title: 'NFT Purchased! 🎉',
                    description: `Token #${result.data.tokenId} transferred. Royalty: $${result.data.royalty?.amount} (${result.data.royalty?.bps / 100}%)`,
                });
                // Refresh list to update ownership badges
                await fetchNFTs();
            }
        } catch (err: any) {
            toast({
                type: 'error',
                title: 'Transaction Error',
                description: err.message || 'An unexpected error occurred.',
            });
        } finally {
            setBuyingSlug(null);
        }
    }, [address, fetchNFTs]);

    // ─── Bid Handler ───────────────────────────────
    const handleBid = useCallback(async (_slug: string, auctionId: string) => {
        if (!address) {
            toast({
                type: 'error',
                title: 'Wallet Required',
                description: 'Please connect your wallet to place a bid.',
            });
            return;
        }

        const amountStr = window.prompt('Enter your bid amount ($):');
        if (!amountStr) return;

        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
            toast({ type: 'error', title: 'Invalid Bid', description: 'Please enter a valid positive number.' });
            return;
        }

        setBuyingSlug(_slug);
        try {
            const result = await api.placeBidOnAuction(auctionId, address, amount);

            if (result.error) {
                toast({
                    type: 'error',
                    title: 'Bid Failed',
                    description: (result.error as any).error || 'Bid could not be placed.',
                });
                return;
            }

            if (result.data) {
                const perks = result.data.holderPerks;
                toast({
                    type: 'success',
                    title: perks ? '⚡ Priority Bid Placed!' : 'Bid Placed! 🎨',
                    description: perks
                        ? `$${amount} × ${perks.multiplier} = $${perks.effectiveBid} effective (${perks.prePingSeconds}s pre-ping)`
                        : `Your bid of $${amount} has been submitted.`,
                });
                await fetchNFTs();
            }
        } catch (err: any) {
            toast({
                type: 'error',
                title: 'Bid Error',
                description: err.message || 'An unexpected error occurred.',
            });
        } finally {
            setBuyingSlug(null);
        }
    }, [address, fetchNFTs]);

    // ─── Render ────────────────────────────────

    return (
        <div className="space-y-6" id="nft-marketplace">
            {/* Search Bar */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search NFTs by name or slug..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-10"
                        id="nft-search"
                    />
                </div>
                <Button
                    variant="outline"
                    size="icon"
                    onClick={fetchNFTs}
                    disabled={isLoading}
                    aria-label="Refresh NFTs"
                >
                    <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
            </div>

            {/* Loading State */}
            {isLoading && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="space-y-4 p-6 border border-border rounded-lg">
                            <Skeleton className="h-6 w-3/4" />
                            <Skeleton className="h-4 w-1/2" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                    ))}
                </div>
            )}

            {/* Empty State */}
            {!isLoading && filteredVerticals.length === 0 && (
                <div className="text-center py-16" id="nft-empty-state">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                        <Gem className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-semibold mb-1">No NFTs Available</h3>
                    <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                        {search
                            ? `No NFTs match "${search}". Try a different search term.`
                            : 'No vertical NFTs have been minted yet. Check back soon!'}
                    </p>
                </div>
            )}

            {/* NFT Grid */}
            {!isLoading && filteredVerticals.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" id="nft-grid">
                    {filteredVerticals.map((vertical) => (
                        <NFTCard
                            key={vertical.slug}
                            vertical={vertical}
                            onBuy={handleBuy}
                            onBid={handleBid}
                            isAuthenticated={isAuthenticated}
                            currentWallet={address}
                            isBuying={buyingSlug === vertical.slug}
                        />
                    ))}
                </div>
            )}

            {/* Results Count */}
            {!isLoading && filteredVerticals.length > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                    Showing {filteredVerticals.length} of {verticals.length} NFTs
                </p>
            )}
        </div>
    );
}

export default NFTMarketplace;
