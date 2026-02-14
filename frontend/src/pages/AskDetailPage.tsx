import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MapPin, Tag, Zap, ArrowLeft, Users, DollarSign, Clock, ShoppingCart, MessageSquare } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChainlinkBadge } from '@/components/ui/ChainlinkBadge';
import { Tooltip } from '@/components/ui/Tooltip';
import { SkeletonCard } from '@/components/ui/skeleton';
import api from '@/lib/api';
import useAuth from '@/hooks/useAuth';
import { formatCurrency, getStatusColor } from '@/lib/utils';
import ConnectButton from '@/components/wallet/ConnectButton';

export function AskDetailPage() {
    const { askId } = useParams<{ askId: string }>();
    const { isAuthenticated } = useAuth();
    const [ask, setAsk] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!askId) return;
        const fetchAsk = async () => {
            setIsLoading(true);
            try {
                const { data, error: apiError } = await api.getAsk(askId);
                if (apiError) throw new Error(apiError.message || apiError.error);
                setAsk(data?.ask);
            } catch (err: any) {
                setError(err.message || 'Failed to load ask');
            } finally {
                setIsLoading(false);
            }
        };
        fetchAsk();
    }, [askId]);

    if (isLoading) {
        return (
            <DashboardLayout>
                <div className="max-w-4xl mx-auto space-y-6">
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            </DashboardLayout>
        );
    }

    if (error || !ask) {
        return (
            <DashboardLayout>
                <div className="max-w-4xl mx-auto text-center py-20">
                    <Tag className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                    <h1 className="text-2xl font-bold mb-2">Ask Not Found</h1>
                    <p className="text-muted-foreground mb-6">{error || 'This ask may have been removed or expired.'}</p>
                    <Button asChild>
                        <Link to="/marketplace?view=asks">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back to Marketplace
                        </Link>
                    </Button>
                </div>
            </DashboardLayout>
        );
    }

    const states = ask.geoTargets?.states || [];
    const statesDisplay = states.length > 0 ? states.join(', ') : 'Nationwide';
    const activeLeads = ask.leads || [];

    return (
        <DashboardLayout>
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Back Navigation */}
                <Button variant="ghost" size="sm" asChild>
                    <Link to="/marketplace?view=asks">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back to Marketplace
                    </Link>
                </Button>

                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <h1 className="text-3xl font-bold capitalize">{ask.vertical?.replace(/_/g, ' ')}</h1>
                            <Badge className={getStatusColor(ask.status)}>{ask.status}</Badge>
                        </div>
                        {ask.seller && (
                            <p className="text-muted-foreground flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                by {ask.seller.companyName}
                                {ask.seller.isVerified && <ChainlinkBadge size="sm" />}
                                <span className="text-xs">• Rep: {(Number(ask.seller.reputationScore) / 100).toFixed(0)}%</span>
                            </p>
                        )}
                    </div>
                </div>

                {/* Main Content Grid */}
                <div className="grid md:grid-cols-3 gap-6">
                    {/* Left: Details */}
                    <div className="md:col-span-2 space-y-6">
                        {/* Pricing Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <DollarSign className="h-5 w-5 text-primary" />
                                    Pricing
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid sm:grid-cols-2 gap-6">
                                    <div>
                                        <Tooltip content="Minimum bid amount accepted by the seller">
                                            <span className="text-sm text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/40">
                                                Reserve Price
                                            </span>
                                        </Tooltip>
                                        <div className="text-3xl font-bold gradient-text mt-1">
                                            {formatCurrency(ask.reservePrice)}
                                        </div>
                                    </div>
                                    {ask.buyNowPrice && (
                                        <div>
                                            <Tooltip content="Purchase leads immediately at this price — no bidding needed">
                                                <span className="text-sm text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/40">
                                                    Buy Now Price
                                                </span>
                                            </Tooltip>
                                            <div className="text-3xl font-bold text-green-500 mt-1">
                                                {formatCurrency(ask.buyNowPrice)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Geo Targets Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <MapPin className="h-5 w-5 text-primary" />
                                    Geographic Targets
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="flex flex-wrap gap-2">
                                    {states.length > 0 ? (
                                        states.map((state: string) => (
                                            <Badge key={state} variant="secondary">{state}</Badge>
                                        ))
                                    ) : (
                                        <Badge variant="secondary">Nationwide</Badge>
                                    )}
                                </div>
                                {ask.geoTargets?.radius && (
                                    <p className="text-sm text-muted-foreground mt-3">
                                        Radius: {ask.geoTargets.radius.miles} miles
                                    </p>
                                )}
                            </CardContent>
                        </Card>

                        {/* Active Leads */}
                        {activeLeads.length > 0 && (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Clock className="h-5 w-5 text-primary" />
                                        Active Leads ({activeLeads.length})
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {activeLeads.map((lead: any) => (
                                            <div
                                                key={lead.id}
                                                className="flex items-center justify-between p-3 rounded-xl bg-muted/50"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                                        <Tag className="h-4 w-4 text-primary" />
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-medium font-mono">
                                                            {lead.id.slice(0, 8)}...
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {lead.auctionEndAt
                                                                ? `Ends ${new Date(lead.auctionEndAt).toLocaleString()}`
                                                                : 'Active'}
                                                        </div>
                                                    </div>
                                                </div>
                                                <Badge variant="outline" className={getStatusColor(lead.status)}>
                                                    {lead.status.replace('_', ' ')}
                                                </Badge>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </div>

                    {/* Right: CTA Sidebar */}
                    <div className="space-y-4">
                        <Card className="border-primary/20 bg-primary/5">
                            <CardContent className="p-6 space-y-4">
                                <div className="flex items-center gap-2 text-sm">
                                    <Zap className="h-4 w-4 text-violet-400" />
                                    <span className="text-violet-400 font-medium">Lightning Auction</span>
                                </div>

                                {ask.acceptOffSite && (
                                    <div className="flex items-center gap-2 text-sm">
                                        <Zap className="h-4 w-4 text-yellow-500" />
                                        <span className="text-yellow-500 font-medium">Accepts off-site leads</span>
                                    </div>
                                )}

                                <div className="text-sm text-muted-foreground">
                                    <strong>Vertical:</strong>{' '}
                                    <span className="capitalize">{ask.vertical?.replace(/_/g, ' ')}</span>
                                </div>

                                <div className="text-sm text-muted-foreground">
                                    <strong>Geo:</strong> {statesDisplay}
                                </div>

                                <div className="text-sm text-muted-foreground">
                                    <strong>Active Leads:</strong> {ask._count?.leads || activeLeads.length || 0}
                                </div>

                                <div className="pt-4 border-t border-border space-y-3">
                                    {isAuthenticated ? (
                                        <>
                                            {activeLeads.length > 0 && (
                                                <Button className="w-full gap-2" variant="gradient" asChild>
                                                    <Link to={`/auction/${activeLeads[0].id}`}>
                                                        <Zap className="h-4 w-4" />
                                                        Enter Auction
                                                    </Link>
                                                </Button>
                                            )}
                                            <Button variant="outline" className="w-full gap-2" asChild>
                                                <Link to="/marketplace?view=buyNow">
                                                    <ShoppingCart className="h-4 w-4" />
                                                    Make Buy Now Offer
                                                </Link>
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                className="w-full gap-2 text-muted-foreground"
                                                onClick={() => {
                                                    // Stub: in production this would open a messaging modal or mailto
                                                    alert(`Contact ${ask.seller?.companyName || 'Seller'} — messaging coming soon!`);
                                                }}
                                            >
                                                <MessageSquare className="h-4 w-4" />
                                                Contact Seller
                                            </Button>
                                        </>
                                    ) : (
                                        <div className="space-y-3">
                                            <p className="text-sm text-muted-foreground">
                                                Connect your wallet to bid on leads or contact this seller.
                                            </p>
                                            <ConnectButton />
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {ask.createdAt && (
                            <p className="text-xs text-muted-foreground text-center">
                                Created {new Date(ask.createdAt).toLocaleDateString()}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}

export default AskDetailPage;
