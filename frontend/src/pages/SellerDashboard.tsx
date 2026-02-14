import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { FileText, DollarSign, TrendingUp, Users, Plus, ArrowUpRight, LayoutDashboard, Tag, Send, BarChart3, Zap, UserPlus, Search, Satellite, Save, Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GlassCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SkeletonCard } from '@/components/ui/skeleton';
import api from '@/lib/api';
import { formatCurrency, getStatusColor } from '@/lib/utils';
import { useSocketEvents } from '@/hooks/useSocketEvents';
import { toast } from '@/hooks/useToast';
import { useDebounce } from '@/hooks/useDebounce';

const DASHBOARD_TABS = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard, path: '/seller' },
    { key: 'leads', label: 'My Leads', icon: FileText, path: '/seller/leads' },
    { key: 'asks', label: 'Active Asks', icon: Tag, path: '/seller/asks' },
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
    const [hasProfile, setHasProfile] = useState<boolean | null>(null);
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 300);

    // Conversion tracking settings
    const [convPixelUrl, setConvPixelUrl] = useState('');
    const [convWebhookUrl, setConvWebhookUrl] = useState('');
    const [convSaving, setConvSaving] = useState(false);
    const [convLoaded, setConvLoaded] = useState(false);

    const activeTab = DASHBOARD_TABS.find((t) => t.path === location.pathname)?.key || 'overview';

    useEffect(() => {
        const fetchData = async () => {
            try {
                const leadsParams: Record<string, string> = { limit: '5' };
                const asksParams: Record<string, string> = { status: 'ACTIVE', limit: '4' };
                if (debouncedSearch) {
                    leadsParams.search = debouncedSearch;
                    asksParams.search = debouncedSearch;
                }
                const [overviewRes, leadsRes, asksRes] = await Promise.all([
                    api.getOverview(),
                    api.listLeads(leadsParams),
                    api.listAsks(asksParams),
                ]);

                setOverview(overviewRes.data?.stats);
                setHasProfile(!!overviewRes.data?.stats);
                setRecentLeads(leadsRes.data?.leads || []);
                setActiveAsks(asksRes.data?.asks || []);
            } catch (error) {
                console.error('Dashboard fetch error:', error);
                setHasProfile(false);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [debouncedSearch]);

    // Fetch conversion settings once
    useEffect(() => {
        if (convLoaded) return;
        api.getConversionSettings().then((res) => {
            if (res.data) {
                setConvPixelUrl(res.data.conversionPixelUrl || '');
                setConvWebhookUrl(res.data.conversionWebhookUrl || '');
            }
            setConvLoaded(true);
        }).catch(() => setConvLoaded(true));
    }, [convLoaded]);

    const handleSaveConversion = async () => {
        setConvSaving(true);
        try {
            await api.updateConversionSettings({
                conversionPixelUrl: convPixelUrl || undefined,
                conversionWebhookUrl: convWebhookUrl || undefined,
            });
            toast({ type: 'success', title: 'Saved', description: 'Conversion tracking settings updated' });
        } catch {
            toast({ type: 'error', title: 'Error', description: 'Failed to save conversion settings' });
        } finally {
            setConvSaving(false);
        }
    };

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
                    // Refetch instead of blindly prepending — the backend
                    // scopes GET /leads to the authenticated seller, so this
                    // ensures only our leads appear in the list.
                    refetchData();
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

    // Client-side filtering for already-loaded data
    const q = debouncedSearch.toLowerCase();
    const filteredLeads = useMemo(() =>
        q ? recentLeads.filter((l: any) =>
            l.vertical?.toLowerCase().includes(q) ||
            l.id?.toLowerCase().startsWith(q) ||
            l.geo?.state?.toLowerCase().includes(q) ||
            l.geo?.city?.toLowerCase().includes(q)
        ) : recentLeads,
        [recentLeads, q]);

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

                {/* Profile creation CTA — shown when no profile detected */}
                {hasProfile === false && (
                    <div className="flex items-center gap-4 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                        <UserPlus className="h-6 w-6 text-amber-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">Complete your seller profile</p>
                            <p className="text-xs text-muted-foreground">Set up your company and verticals to start submitting leads</p>
                        </div>
                        <Button size="sm" asChild>
                            <Link to="/seller/submit">Create Profile</Link>
                        </Button>
                    </div>
                )}

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

                {/* Search Bar */}
                <div className="max-w-md">
                    <Input
                        placeholder="Search by lead ID, vertical, or location..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        icon={<Search className="h-4 w-4" />}
                    />
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

                {/* Conversion Tracking */}
                <Card>
                    <CardHeader className="flex-row items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Satellite className="h-5 w-5 text-violet-500" />
                            <CardTitle>Conversion Tracking</CardTitle>
                        </div>
                        <Badge variant="outline" className="text-violet-500 border-violet-500/30">Optional</Badge>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Fires immediately after a lead is sold (auction win or Buy Now). Supports both pixel and server-to-server webhook.
                        </p>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Conversion Pixel URL</label>
                                <Input
                                    placeholder="https://googleads.g.doubleclick.net/pagead/conversion/..."
                                    value={convPixelUrl}
                                    onChange={(e) => setConvPixelUrl(e.target.value)}
                                />
                                <p className="text-[11px] text-muted-foreground mt-1">Fires as a 1×1 image GET request on each successful sale</p>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Conversion Webhook URL</label>
                                <Input
                                    placeholder="https://mycompany.com/webhook/lead-sold"
                                    value={convWebhookUrl}
                                    onChange={(e) => setConvWebhookUrl(e.target.value)}
                                />
                                <p className="text-[11px] text-muted-foreground mt-1">Receives a JSON POST with lead_id, sale_amount, vertical, quality_score, and transaction_id</p>
                            </div>
                        </div>
                        <Button
                            size="sm"
                            onClick={handleSaveConversion}
                            disabled={convSaving}
                            className="gap-2"
                        >
                            {convSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            {convSaving ? 'Saving...' : 'Save Settings'}
                        </Button>
                    </CardContent>
                </Card>

                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Recent Leads */}
                    <Card className="lg:col-span-1">
                        <CardHeader className="flex-row items-center justify-between">
                            <CardTitle>My Recent Leads</CardTitle>
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
                            ) : filteredLeads.length === 0 ? (
                                <div className="text-center py-8">
                                    <p className="text-muted-foreground mb-4">No leads submitted yet</p>
                                    <Button variant="outline" size="sm" asChild>
                                        <Link to="/seller/submit">Submit Lead</Link>
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {filteredLeads.map((lead) => (
                                        <Link
                                            key={lead.id}
                                            to={`/seller/leads/${lead.id}`}
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
                                    <Card key={ask.id} className="group hover:border-primary/50 transition-all">
                                        <div className="p-5 space-y-3">
                                            {/* Header: Vertical + Status */}
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <h3 className="font-semibold text-base capitalize">
                                                        {ask.vertical?.replace(/_/g, ' ')}
                                                    </h3>
                                                    {ask.seller?.companyName && (
                                                        <p className="text-xs text-muted-foreground">
                                                            {ask.seller.companyName}
                                                        </p>
                                                    )}
                                                </div>
                                                <Badge className={getStatusColor(ask.status)}>
                                                    {ask.status}
                                                </Badge>
                                            </div>

                                            {/* Stats Row */}
                                            <div className="grid grid-cols-3 gap-2">
                                                <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                                                    <div className="text-lg font-bold gradient-text">
                                                        {formatCurrency(ask.reservePrice)}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground">Reserve</div>
                                                </div>
                                                <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                                                    <div className="text-lg font-bold text-emerald-500">
                                                        {ask._count?.leads || 0}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground">Active Leads</div>
                                                </div>
                                                <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                                                    <div className="text-lg font-bold text-amber-500">
                                                        {ask._count?.bids || 0}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground">Bids</div>
                                                </div>
                                            </div>

                                            {/* Geo + Buy Now */}
                                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                <span className="flex items-center gap-1">
                                                    📍 {ask.geoTargets?.states?.slice(0, 3).join(', ') || 'Nationwide'}
                                                    {(ask.geoTargets?.states?.length || 0) > 3 && (
                                                        <span> +{ask.geoTargets.states.length - 3}</span>
                                                    )}
                                                </span>
                                                {ask.buyNowPrice && (
                                                    <span className="text-green-500 font-medium">
                                                        Buy Now: {formatCurrency(ask.buyNowPrice)}
                                                    </span>
                                                )}
                                            </div>

                                            {/* View Details Button */}
                                            <Button
                                                asChild
                                                size="sm"
                                                className="w-full group-hover:scale-[1.02] transition-transform"
                                            >
                                                <Link to={`/marketplace/ask/${ask.id}`}>
                                                    View Details
                                                    <ArrowUpRight className="h-4 w-4 ml-1" />
                                                </Link>
                                            </Button>
                                        </div>
                                    </Card>
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
