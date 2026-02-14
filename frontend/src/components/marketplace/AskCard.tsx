import { Link } from 'react-router-dom';
import { MapPin, Zap, Eye, Wallet } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/Tooltip';
import { ChainlinkBadge } from '@/components/ui/ChainlinkBadge';
import { VerticalBreadcrumb } from '@/components/ui/VerticalBreadcrumb';
import { formatCurrency } from '@/lib/utils';

interface Ask {
    id: string;
    vertical: string;
    geoTargets: { states?: string[]; radius?: { miles: number } };
    reservePrice: number;
    buyNowPrice?: number;
    acceptOffSite: boolean;
    auctionDuration?: number;
    status: string;
    seller?: {
        companyName: string;
        reputationScore: number;
        isVerified: boolean;
    };
    _count?: { leads: number };
}

interface AskCardProps {
    ask: Ask;
    isAuthenticated?: boolean;
    /** Link prefix for the "View Ask" button. Seller pages should pass '/seller/asks'. */
    basePath?: string;
}

export function AskCard({ ask, isAuthenticated = true, basePath = '/marketplace/ask' }: AskCardProps) {
    const { openConnectModal } = useConnectModal();
    const statesDisplay = ask.geoTargets.states?.slice(0, 3).join(', ') || 'Nationwide';
    const moreStates = (ask.geoTargets.states?.length || 0) > 3
        ? `+${ask.geoTargets.states!.length - 3} more`
        : '';

    return (
        <Card className="group hover:border-primary/50 transition-all">
            <CardContent className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="font-semibold text-lg"><VerticalBreadcrumb slug={ask.vertical} /></h3>
                        {ask.seller && (
                            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                                by {ask.seller.companyName}
                                {ask.seller.isVerified && <ChainlinkBadge size="sm" />}
                            </p>
                        )}
                    </div>

                </div>

                {/* Details */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        <span>{statesDisplay} {moreStates}</span>
                    </div>

                    {ask.acceptOffSite && (
                        <div className="flex items-center gap-2 text-sm">
                            <Zap className="h-4 w-4 text-yellow-500" />
                            <span className="text-yellow-500">Accepts off-site leads</span>
                        </div>
                    )}

                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Zap className="h-4 w-4" />
                        <span>{ask._count?.leads || 0} active leads</span>
                    </div>
                </div>

                {/* Pricing */}
                <div className="mt-4 pt-4 border-t border-border">
                    <div className="flex items-baseline justify-between">
                        <div>
                            <Tooltip content="Minimum bid amount accepted by the seller">
                                <span className="text-xs text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/40">Reserve Price</span>
                            </Tooltip>
                            <div className="text-xl font-bold gradient-text">
                                {formatCurrency(ask.reservePrice)}
                            </div>
                        </div>
                        {ask.buyNowPrice && (
                            <div className="text-right">
                                <Tooltip content="Purchase this lead immediately at this price — no bidding needed">
                                    <span className="text-xs text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/40">Buy Now</span>
                                </Tooltip>
                                <div className="text-lg font-semibold text-green-500">
                                    {formatCurrency(ask.buyNowPrice)}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>

            <CardFooter className="px-6 pb-6">
                {isAuthenticated ? (
                    <Button asChild className="w-full group-hover:scale-[1.02] transition-transform">
                        <Link to={`${basePath}/${ask.id}`}>
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                        </Link>
                    </Button>
                ) : (
                    <Button
                        className="w-full group-hover:scale-[1.02] transition-transform gap-2"
                        variant="glass"
                        onClick={openConnectModal}
                        aria-label="Connect wallet to view ask details"
                    >
                        <Wallet className="h-4 w-4" />
                        Connect to View
                    </Button>
                )}
            </CardFooter>
        </Card>
    );
}

export default AskCard;
