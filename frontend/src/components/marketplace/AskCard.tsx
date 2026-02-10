import { Link } from 'react-router-dom';
import { MapPin, Clock, Zap, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, getStatusColor } from '@/lib/utils';

interface Ask {
    id: string;
    vertical: string;
    geoTargets: { states?: string[]; radius?: { miles: number } };
    reservePrice: number;
    buyNowPrice?: number;
    acceptOffSite: boolean;
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
}

export function AskCard({ ask }: AskCardProps) {
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
                        <h3 className="font-semibold text-lg capitalize">{ask.vertical}</h3>
                        {ask.seller && (
                            <p className="text-sm text-muted-foreground">
                                by {ask.seller.companyName}
                                {ask.seller.isVerified && (
                                    <span className="ml-1 text-blue-500">✓</span>
                                )}
                            </p>
                        )}
                    </div>
                    <Badge className={getStatusColor(ask.status)}>{ask.status}</Badge>
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
                        <Clock className="h-4 w-4" />
                        <span>{ask._count?.leads || 0} active leads</span>
                    </div>
                </div>

                {/* Pricing */}
                <div className="mt-4 pt-4 border-t border-border">
                    <div className="flex items-baseline justify-between">
                        <div>
                            <div className="text-xs text-muted-foreground">Reserve Price</div>
                            <div className="text-xl font-bold gradient-text">
                                {formatCurrency(ask.reservePrice)}
                            </div>
                        </div>
                        {ask.buyNowPrice && (
                            <div className="text-right">
                                <div className="text-xs text-muted-foreground">Buy Now</div>
                                <div className="text-lg font-semibold text-green-500">
                                    {formatCurrency(ask.buyNowPrice)}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>

            <CardFooter className="px-6 pb-6">
                <Button asChild className="w-full group-hover:scale-[1.02] transition-transform">
                    <Link to={`/marketplace/ask/${ask.id}`}>
                        View Ask
                        <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                </Button>
            </CardFooter>
        </Card>
    );
}

export default AskCard;
