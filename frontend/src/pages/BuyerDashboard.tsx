import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Gavel, DollarSign, Target, ArrowUpRight, Clock } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlassCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SkeletonCard } from '@/components/ui/skeleton';
import { LeadCard } from '@/components/marketplace/LeadCard';
import api from '@/lib/api';
import { formatCurrency, getStatusColor } from '@/lib/utils';

export function BuyerDashboard() {
    const [overview, setOverview] = useState<any>(null);
    const [recentBids, setRecentBids] = useState<any[]>([]);
    const [activeLeads, setActiveLeads] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [overviewRes, bidsRes, leadsRes] = await Promise.all([
                    api.getOverview(),
                    api.getMyBids(),
                    api.listLeads({ status: 'IN_AUCTION', limit: '6' }),
                ]);

                setOverview(overviewRes.data?.stats);
                setRecentBids(bidsRes.data?.bids?.slice(0, 5) || []);
                setActiveLeads(leadsRes.data?.leads || []);
            } catch (error) {
                console.error('Dashboard fetch error:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, []);

    const stats = [
        { label: 'Total Bids', value: overview?.totalBids || 0, icon: Gavel, color: 'text-blue-500' },
        { label: 'Won Bids', value: overview?.wonBids || 0, icon: Target, color: 'text-green-500' },
        { label: 'Win Rate', value: `${overview?.winRate || 0}%`, icon: TrendingUp, color: 'text-purple-500' },
        { label: 'Total Spent', value: formatCurrency(overview?.totalSpent || 0), icon: DollarSign, color: 'text-yellow-500' },
    ];

    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Buyer Dashboard</h1>
                        <p className="text-muted-foreground">Track your bids and discover new leads</p>
                    </div>
                    <Button asChild>
                        <Link to="/marketplace">Browse Marketplace</Link>
                    </Button>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {stats.map((stat) => (
                        <GlassCard key={stat.label} className="p-6">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-xl bg-white/5 ${stat.color}`}>
                                    <stat.icon className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="text-2xl font-bold">{stat.value}</div>
                                    <div className="text-sm text-muted-foreground">{stat.label}</div>
                                </div>
                            </div>
                        </GlassCard>
                    ))}
                </div>

                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Recent Bids */}
                    <Card className="lg:col-span-1">
                        <CardHeader className="flex-row items-center justify-between">
                            <CardTitle>Recent Bids</CardTitle>
                            <Button variant="ghost" size="sm" asChild>
                                <Link to="/buyer/bids">View All</Link>
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="space-y-4">
                                    {[1, 2, 3].map((i) => (
                                        <div key={i} className="animate-pulse h-16 bg-muted rounded-xl" />
                                    ))}
                                </div>
                            ) : recentBids.length === 0 ? (
                                <p className="text-muted-foreground text-center py-8">No bids yet</p>
                            ) : (
                                <div className="space-y-3">
                                    {recentBids.map((bid) => (
                                        <div key={bid.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                    <Gavel className="h-5 w-5 text-primary" />
                                                </div>
                                                <div>
                                                    <div className="font-medium text-sm capitalize">
                                                        {bid.lead?.vertical || 'Lead'}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {new Date(bid.createdAt).toLocaleDateString()}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-semibold">
                                                    {bid.amount ? formatCurrency(bid.amount) : 'Hidden'}
                                                </div>
                                                <Badge variant="outline" className={getStatusColor(bid.status)}>
                                                    {bid.status}
                                                </Badge>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Active Leads */}
                    <div className="lg:col-span-2">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold">Live Auctions</h2>
                            <Button variant="outline" size="sm" asChild>
                                <Link to="/marketplace">
                                    See All <ArrowUpRight className="h-4 w-4 ml-1" />
                                </Link>
                            </Button>
                        </div>

                        {isLoading ? (
                            <div className="grid md:grid-cols-2 gap-4">
                                {[1, 2, 3, 4].map((i) => (
                                    <SkeletonCard key={i} />
                                ))}
                            </div>
                        ) : activeLeads.length === 0 ? (
                            <Card className="p-8 text-center">
                                <p className="text-muted-foreground">No active auctions matching your preferences</p>
                                <Button variant="outline" className="mt-4" asChild>
                                    <Link to="/buyer/preferences">Update Preferences</Link>
                                </Button>
                            </Card>
                        ) : (
                            <div className="grid md:grid-cols-2 gap-4">
                                {activeLeads.map((lead) => (
                                    <LeadCard key={lead.id} lead={lead} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}

export default BuyerDashboard;
