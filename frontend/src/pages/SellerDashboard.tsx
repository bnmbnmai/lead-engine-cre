import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { FileText, DollarSign, TrendingUp, Users, Plus, ArrowUpRight, LayoutDashboard, Tag, Send, BarChart3, Zap } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlassCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AskCard } from '@/components/marketplace/AskCard';
import { SkeletonCard } from '@/components/ui/skeleton';
import api from '@/lib/api';
import { formatCurrency, getStatusColor } from '@/lib/utils';
import { useSocketEvents } from '@/hooks/useSocketEvents';
import { toast } from '@/hooks/useToast';

const DASHBOARD_TABS = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard, path: '/seller' },
    { key: 'leads', label: 'Leads', icon: FileText, path: '/seller/leads' },
    { key: 'asks', label: 'Asks', icon: Tag, path: '/seller/asks' },
    { key: 'submit', label: 'Submit', icon: Send, path: '/seller/submit' },
    { key: 'analytics', label: 'Analytics', icon: BarChart3, path: '/seller/analytics' },
] as const;

export function SellerDashboard() {
    const navigate = useNavigate();
    const location = useLocation();
    const [overview, setOverview] = useState<any>(null);
    const [recentLeads, setRecentLeads] = useState<any[]>([]);
    const [activeAsks, setActiveAsks] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const activeTab = DASHBOARD_TABS.find((t) => t.path === location.pathname)?.key || 'overview';

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [overviewRes, leadsRes, asksRes] = await Promise.all([
                    api.getOverview(),
                    api.listLeads({ limit: '5' }),
                    api.listAsks({ status: 'ACTIVE', limit: '4' }),
                ]);

                setOverview(overviewRes.data?.stats);
                setRecentLeads(leadsRes.data?.leads || []);
                setActiveAsks(asksRes.data?.asks || []);
            } catch (error) {
                console.error('Dashboard fetch error:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, []);

    // Re-fetch callback for socket events & polling fallback
    const refetchData = useCallback(() => {
        const fetchData = async () => {
            try {
                const [overviewRes, leadsRes, asksRes] = await Promise.all([
                    api.getOverview(),
                    api.listLeads({ limit: '5' }),
                    api.listAsks({ status: 'ACTIVE', limit: '4' }),
                ]);
                setOverview(overviewRes.data?.stats);
                setRecentLeads(leadsRes.data?.leads || []);
                setActiveAsks(asksRes.data?.asks || []);
            } catch (error) {
                console.error('Poll fetch error:', error);
            }
        };
        fetchData();
    }, []);

    // Real-time socket listeners
    useSocketEvents(
        {
            'marketplace:lead:new': (data: any) => {
                if (data?.lead) {
                    setRecentLeads((prev) => [data.lead, ...prev].slice(0, 5));
                    toast({
                        type: 'success',
                        title: 'New Lead',
                        description: `${data.lead.vertical} lead submitted`,
                    });
                }
            },
            'marketplace:bid:update': (data: any) => {
                if (data?.leadId) {
                    setRecentLeads((prev) =>
                        prev.map((lead) =>
                            lead.id === data.leadId
                                ? {
                                    ...lead,
                                    _count: { ...lead._count, bids: data.bidCount },
                                }
                                : lead,
                        ),
                    );
                }
            },
            'marketplace:refreshAll': () => {
                refetchData();
            },
        },
        refetchData,
    );

    const stats = [
        { label: 'Total Leads', value: overview?.totalLeads || 0, icon: FileText, color: 'text-primary' },
        { label: 'Leads Sold', value: overview?.soldLeads || 0, icon: Users, color: 'text-emerald-500' },
        { label: 'Conversion', value: `${overview?.conversionRate || 0}%`, icon: TrendingUp, color: 'text-chainlink-steel' },
        { label: 'Revenue', value: formatCurrency(overview?.totalRevenue || 0), icon: DollarSign, color: 'text-amber-500' },
    ];

    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Seller Dashboard</h1>
                        <p className="text-muted-foreground">Pipeline, auctions, and instant USDC settlements via x402</p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="outline" asChild>
                            <Link to="/seller/asks/new">
                                <Plus className="h-4 w-4 mr-2" />
                                New Ask
                            </Link>
                        </Button>
                        <Button asChild>
                            <Link to="/seller/submit">Submit Lead</Link>
                        </Button>
                    </div>
                </div>

                {/* Inline Tab Strip */}
                <div className="flex gap-1 p-1 rounded-xl bg-muted/50 overflow-x-auto">
                    {DASHBOARD_TABS.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => navigate(tab.path)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${activeTab === tab.key
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                                }`}
                        >
                            <tab.icon className="h-4 w-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

                {/* Quick Actions */}
                <div className="grid sm:grid-cols-3 gap-4">
                    {[
                        {
                            title: 'Submit Lead',
                            desc: 'Add a new lead via form, API, or webhook',
                            href: '/seller/submit',
                            icon: Zap,
                            color: 'from-blue-500 to-cyan-400',
                        },
                        {
                            title: 'Create Auction',
                            desc: 'Post an ask to start receiving sealed bids',
                            href: '/seller/asks/new',
                            icon: Tag,
                            color: 'from-emerald-500 to-teal-400',
                        },
                        {
                            title: 'View Analytics',
                            desc: 'Revenue, conversion rates, and gas costs',
                            href: '/seller/analytics',
                            icon: BarChart3,
                            color: 'from-violet-500 to-purple-400',
                        },
                    ].map((action) => (
                        <Link
                            key={action.href}
                            to={action.href}
                            className="group flex items-start gap-4 p-5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.12] transition-all"
                        >
                            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${action.color} flex items-center justify-center flex-shrink-0`}>
                                <action.icon className="h-5 w-5 text-white" />
                            </div>
                            <div>
                                <div className="font-medium text-sm text-foreground group-hover:text-primary transition">{action.title}</div>
                                <div className="text-xs text-muted-foreground mt-0.5">{action.desc}</div>
                            </div>
                        </Link>
                    ))}
                </div>

                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Recent Leads */}
                    <Card className="lg:col-span-1">
                        <CardHeader className="flex-row items-center justify-between">
                            <CardTitle>Recent Leads</CardTitle>
                            <Button variant="ghost" size="sm" asChild>
                                <Link to="/seller/leads">View All</Link>
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {isLoading ? (
                                <div className="space-y-4">
                                    {[1, 2, 3].map((i) => (
                                        <div key={i} className="animate-pulse h-16 bg-muted rounded-xl" />
                                    ))}
                                </div>
                            ) : recentLeads.length === 0 ? (
                                <div className="text-center py-8">
                                    <p className="text-muted-foreground mb-4">No leads submitted yet</p>
                                    <Button variant="outline" size="sm" asChild>
                                        <Link to="/seller/submit">Submit Lead</Link>
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {recentLeads.map((lead) => (
                                        <Link
                                            key={lead.id}
                                            to={`/lead/${lead.id}`}
                                            className="flex items-center justify-between p-3 rounded-xl bg-muted/50 hover:bg-muted transition"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                    <FileText className="h-5 w-5 text-primary" />
                                                </div>
                                                <div>
                                                    <div className="font-medium text-sm capitalize">{lead.vertical}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {lead.geo?.state || 'Unknown'} • {lead._count?.bids || 0} bids
                                                    </div>
                                                </div>
                                            </div>
                                            <Badge variant="outline" className={getStatusColor(lead.status)}>
                                                {lead.status.replace('_', ' ')}
                                            </Badge>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Active Asks */}
                    <div className="lg:col-span-2">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold">Your Active Asks</h2>
                            <Button variant="outline" size="sm" asChild>
                                <Link to="/seller/asks">
                                    Manage All <ArrowUpRight className="h-4 w-4 ml-1" />
                                </Link>
                            </Button>
                        </div>

                        {isLoading ? (
                            <div className="grid md:grid-cols-2 gap-4">
                                {[1, 2, 3, 4].map((i) => (
                                    <SkeletonCard key={i} />
                                ))}
                            </div>
                        ) : activeAsks.length === 0 ? (
                            <Card className="p-8 text-center">
                                <p className="text-muted-foreground mb-4">
                                    Create an ask to start receiving bids on your leads
                                </p>
                                <Button asChild>
                                    <Link to="/seller/asks/new">
                                        <Plus className="h-4 w-4 mr-2" />
                                        Create Your First Ask
                                    </Link>
                                </Button>
                            </Card>
                        ) : (
                            <div className="grid md:grid-cols-2 gap-4">
                                {activeAsks.map((ask) => (
                                    <AskCard key={ask.id} ask={ask} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}

export default SellerDashboard;
