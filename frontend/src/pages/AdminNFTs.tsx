import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import {
    Gem, Shield, ExternalLink, RefreshCw, Check,
    AlertTriangle, Loader2, Coins, Hash, Clock, Gavel,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import api from '@/lib/api';
import useAuth from '@/hooks/useAuth';
import { toast } from '@/hooks/useToast';

// ============================================
// Types
// ============================================

interface VerticalRow {
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
    createdAt?: string;
}

interface MintState {
    slug: string;
    status: 'minting' | 'success' | 'error';
    tokenId?: number;
    txHash?: string;
    error?: string;
}

// ============================================
// Constants
// ============================================

const EXPLORER_BASE = 'https://sepolia.basescan.org';

function truncateHash(hash: string, chars = 6): string {
    if (!hash) return '';
    return `${hash.slice(0, chars + 2)}...${hash.slice(-chars)}`;
}

// ============================================
// Admin NFTs Page
// ============================================

export default function AdminNFTs() {
    const { user, isLoading: authLoading } = useAuth();

    const [proposed, setProposed] = useState<VerticalRow[]>([]);
    const [minted, setMinted] = useState<VerticalRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [mintStates, setMintStates] = useState<Map<string, MintState>>(new Map());

    // ─── Access Guard ──────────────────────────
    if (!authLoading && user?.role !== 'ADMIN') {
        return <Navigate to="/" replace />;
    }

    // ─── Data Fetch ────────────────────────────
    const fetchVerticals = useCallback(async () => {
        setIsLoading(true);
        try {
            // Fetch proposed verticals
            const proposedResult = await api.getVerticalNFTs({ status: 'PROPOSED' });
            if (proposedResult.data) {
                setProposed(proposedResult.data.verticals);
            }

            // Fetch active (minted) verticals
            const activeResult = await api.getVerticalNFTs({ status: 'ACTIVE' });
            if (activeResult.data) {
                setMinted(activeResult.data.verticals.filter((v: any) => v.nftTokenId != null));
            }
        } catch (err) {
            console.error('Failed to fetch verticals:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchVerticals();
    }, [fetchVerticals]);

    // ─── Mint Handler ──────────────────────────
    const handleMint = useCallback(async (slug: string) => {
        setMintStates((prev) => new Map(prev).set(slug, { slug, status: 'minting' }));

        try {
            const result = await api.activateVertical(slug);

            if (result.error) {
                setMintStates((prev) =>
                    new Map(prev).set(slug, {
                        slug,
                        status: 'error',
                        error: result.error?.error || 'Mint failed',
                    })
                );
                toast({
                    type: 'error',
                    title: 'Mint Failed',
                    description: result.error?.error || 'Transaction failed. Please try again.',
                });
                return;
            }

            if (result.data) {
                setMintStates((prev) =>
                    new Map(prev).set(slug, {
                        slug,
                        status: 'success',
                        tokenId: result.data!.tokenId,
                        txHash: result.data!.txHash,
                    })
                );
                toast({
                    type: 'success',
                    title: 'NFT Minted! ✨',
                    description: `Token #${result.data.tokenId} minted for "${slug}"`,
                });
                // Refresh data after successful mint
                await fetchVerticals();
            }
        } catch (err: any) {
            setMintStates((prev) =>
                new Map(prev).set(slug, {
                    slug,
                    status: 'error',
                    error: err.message || 'Unexpected error',
                })
            );
            toast({
                type: 'error',
                title: 'Transaction Error',
                description: err.message || 'An unexpected error occurred.',
            });
        }
    }, [fetchVerticals]);

    // ─── Start Auction Handler ──────────────────
    const handleStartAuction = useCallback(async (slug: string) => {
        const reservePrice = 0.1; // Default reserve
        const durationSecs = 3600; // 1 hour default

        try {
            const result = await api.createVerticalAuction(slug, reservePrice, durationSecs);
            if (result.error) {
                toast({
                    type: 'error',
                    title: 'Auction Failed',
                    description: result.error?.error || 'Could not start auction.',
                });
                return;
            }
            toast({
                type: 'success',
                title: 'Auction Started! 🔨',
                description: `Auction for "${slug}" ends at ${result.data?.endTime}`,
            });
            await fetchVerticals();
        } catch (err: any) {
            toast({
                type: 'error',
                title: 'Error',
                description: err.message || 'Unexpected error starting auction.',
            });
        }
    }, [fetchVerticals]);

    // ─── Settle Auction Handler ─────────────────
    const handleSettle = useCallback(async (auctionId: string) => {
        try {
            const result = await api.settleVerticalAuction(auctionId);
            if (result.error) {
                toast({
                    type: 'error',
                    title: 'Settle Failed',
                    description: result.error?.error || 'Could not settle auction.',
                });
                return;
            }
            toast({
                type: 'success',
                title: 'Auction Settled! ✅',
                description: `Winner: ${result.data?.winner} at $${result.data?.finalPrice}`,
            });
            await fetchVerticals();
        } catch (err: any) {
            toast({
                type: 'error',
                title: 'Error',
                description: err.message || 'Unexpected error settling auction.',
            });
        }
    }, [fetchVerticals]);

    // ─── Stats ─────────────────────────────────
    const totalMinted = minted.length;
    const totalPending = proposed.length;
    const totalRoyalties = minted.reduce(
        (sum, v) => sum + (v.resaleHistory?.length || 0) * 0.02,
        0
    );

    // ─── Render ────────────────────────────────
    return (
        <DashboardLayout>
            <div className="space-y-8 p-6 max-w-7xl mx-auto">
                {/* Page Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                            <Gem className="h-8 w-8 text-purple-500" />
                            NFT Admin
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            Mint vertical NFTs to the platform wallet and manage resales
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={fetchVerticals}
                        disabled={isLoading}
                        className="gap-2"
                    >
                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                                <Check className="h-6 w-6 text-green-500" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Minted NFTs</p>
                                {isLoading ? (
                                    <Skeleton className="h-8 w-16 mt-1" />
                                ) : (
                                    <p className="text-2xl font-bold">{totalMinted}</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="h-12 w-12 rounded-full bg-yellow-500/10 flex items-center justify-center">
                                <Clock className="h-6 w-6 text-yellow-500" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Pending Proposals</p>
                                {isLoading ? (
                                    <Skeleton className="h-8 w-16 mt-1" />
                                ) : (
                                    <p className="text-2xl font-bold">{totalPending}</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="h-12 w-12 rounded-full bg-purple-500/10 flex items-center justify-center">
                                <Coins className="h-6 w-6 text-purple-500" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Royalties Earned</p>
                                {isLoading ? (
                                    <Skeleton className="h-8 w-16 mt-1" />
                                ) : (
                                    <p className="text-2xl font-bold">
                                        ${totalRoyalties.toFixed(2)}
                                    </p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* ─── Proposed Verticals ──────────────── */}
                <div>
                    <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                        <Clock className="h-5 w-5 text-yellow-500" />
                        Proposed Verticals
                        {!isLoading && (
                            <Badge variant="secondary">{proposed.length}</Badge>
                        )}
                    </h2>

                    {isLoading ? (
                        <div className="space-y-3">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <Skeleton key={i} className="h-16 w-full rounded-lg" />
                            ))}
                        </div>
                    ) : proposed.length === 0 ? (
                        <Card>
                            <CardContent className="p-8 text-center">
                                <p className="text-muted-foreground">No proposed verticals awaiting mint</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-3" id="proposed-verticals-list">
                            {proposed.map((v) => {
                                const mintState = mintStates.get(v.slug);
                                return (
                                    <Card
                                        key={v.slug}
                                        className="hover:border-primary/30 transition-all"
                                    >
                                        <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                            {/* Left: Info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-semibold capitalize truncate">
                                                        {v.name}
                                                    </h3>
                                                    <Badge variant="outline" className="text-xs">
                                                        depth {v.depth}
                                                    </Badge>
                                                </div>
                                                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                                    {v.slug}
                                                </p>
                                            </div>

                                            {/* Right: Mint Button / Status */}
                                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                                {mintState?.status === 'minting' && (
                                                    <div className="flex items-center gap-2 text-sm text-muted-foreground" id={`mint-loading-${v.slug}`}>
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Minting...
                                                    </div>
                                                )}

                                                {mintState?.status === 'success' && (
                                                    <div className="flex items-center gap-2 text-sm text-green-500" id={`mint-success-${v.slug}`}>
                                                        <Check className="h-4 w-4" />
                                                        Token #{mintState.tokenId}
                                                        {mintState.txHash && (
                                                            <a
                                                                href={`${EXPLORER_BASE}/tx/${mintState.txHash}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-blue-500 hover:text-blue-400 transition-colors"
                                                            >
                                                                <ExternalLink className="h-3 w-3" />
                                                            </a>
                                                        )}
                                                    </div>
                                                )}

                                                {mintState?.status === 'error' && (
                                                    <div className="flex items-center gap-2">
                                                        <Tooltip content={mintState.error || 'Unknown error'}>
                                                            <AlertTriangle className="h-4 w-4 text-destructive cursor-help" />
                                                        </Tooltip>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleMint(v.slug)}
                                                            className="gap-1"
                                                            id={`mint-retry-${v.slug}`}
                                                        >
                                                            <RefreshCw className="h-3 w-3" />
                                                            Retry
                                                        </Button>
                                                    </div>
                                                )}

                                                {!mintState && (
                                                    <Button
                                                        size="sm"
                                                        onClick={() => handleMint(v.slug)}
                                                        className="gap-2 w-full sm:w-auto"
                                                        id={`mint-btn-${v.slug}`}
                                                    >
                                                        <Gem className="h-4 w-4" />
                                                        Mint NFT
                                                    </Button>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ─── Minted Verticals ───────────────── */}
                <div>
                    <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                        <Shield className="h-5 w-5 text-green-500" />
                        Minted NFTs
                        {!isLoading && (
                            <Badge variant="secondary">{minted.length}</Badge>
                        )}
                    </h2>

                    {isLoading ? (
                        <div className="space-y-3">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <Skeleton key={i} className="h-16 w-full rounded-lg" />
                            ))}
                        </div>
                    ) : minted.length === 0 ? (
                        <Card>
                            <CardContent className="p-8 text-center">
                                <p className="text-muted-foreground">No NFTs minted yet</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="overflow-x-auto" id="minted-verticals-table">
                            {/* Desktop Table */}
                            <table className="w-full text-sm hidden md:table">
                                <thead>
                                    <tr className="border-b border-border text-muted-foreground">
                                        <th className="text-left py-3 px-4 font-medium">Vertical</th>
                                        <th className="text-left py-3 px-4 font-medium">Token ID</th>
                                        <th className="text-left py-3 px-4 font-medium">Tx Hash</th>
                                        <th className="text-left py-3 px-4 font-medium">Owner</th>
                                        <th className="text-left py-3 px-4 font-medium">Resales</th>
                                        <th className="text-left py-3 px-4 font-medium">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {minted.map((v) => (
                                        <tr
                                            key={v.slug}
                                            className="border-b border-border/50 hover:bg-muted/50 transition-colors"
                                        >
                                            <td className="py-3 px-4">
                                                <div className="font-medium capitalize">{v.name}</div>
                                                <div className="text-xs text-muted-foreground font-mono">{v.slug}</div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-1 font-mono">
                                                    <Hash className="h-3 w-3 text-muted-foreground" />
                                                    {v.nftTokenId}
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                {v.nftTxHash ? (
                                                    <a
                                                        href={`${EXPLORER_BASE}/tx/${v.nftTxHash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-1 text-blue-500 hover:text-blue-400 transition-colors font-mono text-xs"
                                                    >
                                                        {truncateHash(v.nftTxHash)}
                                                        <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </td>
                                            <td className="py-3 px-4">
                                                {v.ownerAddress ? (
                                                    <a
                                                        href={`${EXPLORER_BASE}/address/${v.ownerAddress}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                                                    >
                                                        {truncateHash(v.ownerAddress)}
                                                    </a>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </td>
                                            <td className="py-3 px-4">
                                                <Badge variant="secondary">
                                                    {v.resaleHistory?.length || 0}
                                                </Badge>
                                            </td>
                                            <td className="py-3 px-4">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleStartAuction(v.slug)}
                                                    className="gap-1"
                                                    id={`auction-btn-${v.slug}`}
                                                >
                                                    <Gavel className="h-3 w-3" />
                                                    Start Auction
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* Mobile Cards */}
                            <div className="md:hidden space-y-3">
                                {minted.map((v) => (
                                    <Card key={v.slug}>
                                        <CardContent className="p-4 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <h3 className="font-semibold capitalize">{v.name}</h3>
                                                <Badge variant="secondary">
                                                    #{v.nftTokenId}
                                                </Badge>
                                            </div>
                                            <p className="text-xs text-muted-foreground font-mono">{v.slug}</p>
                                            {v.nftTxHash && (
                                                <a
                                                    href={`${EXPLORER_BASE}/tx/${v.nftTxHash}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-1 text-blue-500 text-xs font-mono"
                                                >
                                                    {truncateHash(v.nftTxHash)}
                                                    <ExternalLink className="h-3 w-3" />
                                                </a>
                                            )}
                                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                <span>Resales: {v.resaleHistory?.length || 0}</span>
                                                {v.ownerAddress && (
                                                    <span className="font-mono">{truncateHash(v.ownerAddress, 4)}</span>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </DashboardLayout>
    );
}
