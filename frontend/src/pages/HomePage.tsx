import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, MapPin, X, Globe } from 'lucide-react';

import DashboardLayout from '@/components/layout/DashboardLayout';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AskCard } from '@/components/marketplace/AskCard';
import { LeadCard } from '@/components/marketplace/LeadCard';
import { VerticalSelector } from '@/components/marketplace/VerticalSelector';
import { SuggestVerticalModal } from '@/components/marketplace/SuggestVerticalModal';

import { SkeletonCard } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';

import api from '@/lib/api';
import useAuth from '@/hooks/useAuth';
import { useSocketEvents } from '@/hooks/useSocketEvents';
import { toast } from '@/hooks/useToast';
import ConnectButton from '@/components/wallet/ConnectButton';

const COUNTRIES = [
    { code: 'ALL', label: 'All Countries' },
    { code: 'US', label: 'United States' },
    { code: 'CA', label: 'Canada' },
    { code: 'GB', label: 'United Kingdom' },
    { code: 'AU', label: 'Australia' },
    { code: 'DE', label: 'Germany' },
    { code: 'FR', label: 'France' },
    { code: 'BR', label: 'Brazil' },
    { code: 'MX', label: 'Mexico' },
    { code: 'AR', label: 'Argentina' },
    { code: 'CL', label: 'Chile' },
    { code: 'IN', label: 'India' },
    { code: 'JP', label: 'Japan' },
    { code: 'KR', label: 'South Korea' },
    { code: 'SG', label: 'Singapore' },
    { code: 'ID', label: 'Indonesia' },
    { code: 'PH', label: 'Philippines' },
    { code: 'AE', label: 'UAE' },
    { code: 'ZA', label: 'South Africa' },
    { code: 'NG', label: 'Nigeria' },
    { code: 'KE', label: 'Kenya' },
];

const US_STATES = ['All', 'CA', 'TX', 'FL', 'NY', 'AZ', 'NV', 'CO', 'WA', 'OR', 'GA', 'IL', 'PA', 'OH', 'NC'];
const CA_PROVINCES = ['All', 'ON', 'BC', 'AB', 'QC', 'NS', 'MB', 'SK'];
const GB_REGIONS = ['All', 'England', 'Scotland', 'Wales', 'N. Ireland'];
const AU_STATES = ['All', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS'];

function getRegions(country: string) {
    switch (country) {
        case 'US': return { label: 'State', options: US_STATES };
        case 'CA': return { label: 'Province', options: CA_PROVINCES };
        case 'GB': return { label: 'Region', options: GB_REGIONS };
        case 'AU': return { label: 'State', options: AU_STATES };
        default: return null;
    }
}




// ============================================
// Marketplace View (public + authenticated)
// ============================================

export function HomePage() {
    const [view, setView] = useState<'asks' | 'leads'>('leads');
    const [vertical, setVertical] = useState('all');
    const [country, setCountry] = useState('ALL');
    const [region, setRegion] = useState('All');
    const [search, setSearch] = useState('');
    const [asks, setAsks] = useState<any[]>([]);
    const [leads, setLeads] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { isAuthenticated } = useAuth();
    const [suggestOpen, setSuggestOpen] = useState(false);

    const regionConfig = country !== 'ALL' ? getRegions(country) : null;

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const params: Record<string, string> = {};
                if (vertical !== 'all') params.vertical = vertical;
                if (country !== 'ALL') params.country = country;
                if (region !== 'All') params.state = region;

                if (view === 'asks') {
                    const { data } = await api.listAsks(params);
                    setAsks(data?.asks || []);
                } else {
                    const { data } = await api.listLeads(params);
                    setLeads(data?.leads || []);
                }
            } catch (error) {
                console.error('Fetch error:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [view, vertical, country, region]);

    // Wrap fetchData for polling fallback
    const refetchData = useCallback(() => {
        const fetchData = async () => {
            try {
                const params: Record<string, string> = {};
                if (vertical !== 'all') params.vertical = vertical;
                if (country !== 'ALL') params.country = country;
                if (region !== 'All') params.state = region;

                if (view === 'asks') {
                    const { data } = await api.listAsks(params);
                    setAsks(data?.asks || []);
                } else {
                    const { data } = await api.listLeads(params);
                    setLeads(data?.leads || []);
                }
            } catch (error) {
                console.error('Poll fetch error:', error);
            }
        };
        fetchData();
    }, [view, vertical, country, region]);

    // Real-time socket listeners
    const leadsRef = useRef(leads);
    leadsRef.current = leads;

    useSocketEvents(
        {
            'marketplace:lead:new': (data: any) => {
                if (view === 'leads' && data?.lead) {
                    setLeads((prev) => [data.lead, ...prev]);
                    toast({
                        type: 'info',
                        title: 'New Lead',
                        description: `${data.lead.vertical} lead just appeared`,
                    });
                }
            },
            'marketplace:bid:update': (data: any) => {
                if (data?.leadId) {
                    setLeads((prev) =>
                        prev.map((lead) =>
                            lead.id === data.leadId
                                ? {
                                    ...lead,
                                    _count: { ...lead._count, bids: data.bidCount },
                                    auctionRoom: lead.auctionRoom
                                        ? { ...lead.auctionRoom, highestBid: data.highestBid, bidCount: data.bidCount }
                                        : undefined,
                                }
                                : lead,
                        ),
                    );
                }
            },
            'marketplace:refreshAll': () => {
                refetchData();
                toast({ type: 'info', title: 'Marketplace Updated', description: 'Data has been refreshed' });
            },
            'vertical:created': (data: any) => {
                // Dispatch custom event for VerticalSelector to refresh
                window.dispatchEvent(new CustomEvent('vertical:updated'));
                if (data?.name) {
                    toast({
                        type: 'success',
                        title: 'New Vertical Available',
                        description: `"${data.name}" has been added to the marketplace.`,
                    });
                }
            },
        },
        refetchData,
        { autoConnect: false }, // Don't require auth for marketplace
    );

    const hasFilters = vertical !== 'all' || country !== 'ALL' || region !== 'All';

    const clearFilters = () => {
        setVertical('all');
        setCountry('ALL');
        setRegion('All');
    };



    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Hero Section — polished lander for unauthenticated visitors */}
                {!isAuthenticated && (
                    <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#375BD2]/10 via-transparent to-violet-600/5">
                        {/* Background effects */}
                        <div className="absolute inset-0 node-grid opacity-20" />
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[#375BD2]/8 rounded-full blur-[100px] pointer-events-none" />

                        <div className="relative px-6 sm:px-10 pt-10 pb-8 sm:pt-14 sm:pb-10">
                            {/* Tagline badge */}
                            <div className="flex justify-center mb-6">
                                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/[0.04] text-sm text-muted-foreground">
                                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                    Powered by Chainlink &middot; Built on-chain
                                </div>
                            </div>

                            {/* Main heading */}
                            <h1 className="text-center text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-4">
                                <span className="gradient-text">Decentralized Lead RTB</span>
                                <br />
                                <span className="text-foreground text-2xl sm:text-3xl md:text-4xl">Global. Compliant. Private.</span>
                            </h1>

                            {/* Subtitle */}
                            <p className="text-center text-sm sm:text-base md:text-lg text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
                                Serving a <span className="text-foreground font-semibold">$200B+</span> lead generation market.
                                Verified leads, auto-bid automation, instant settlements &mdash;
                                across 20+ countries and 10 verticals.
                            </p>

                            {/* CTA */}
                            <div className="flex justify-center">
                                <ConnectButton />
                            </div>
                        </div>
                    </section>
                )}



                {/* Filters */}
                <section>
                    <div className="glass rounded-xl p-4 sm:p-6">
                        <div className="flex flex-col gap-4">
                            {/* Row 1: View toggle + Search */}
                            <div className="flex flex-col sm:flex-row gap-3">
                                {/* View Toggle */}
                                <div className="flex gap-1 p-1 rounded-lg bg-muted shrink-0">
                                    <button
                                        onClick={() => setView('leads')}
                                        className={`px-4 py-2 rounded-md text-sm font-medium transition ${view === 'leads' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
                                            }`}
                                    >
                                        Live Leads
                                    </button>
                                    <button
                                        onClick={() => setView('asks')}
                                        className={`px-4 py-2 rounded-md text-sm font-medium transition ${view === 'asks' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
                                            }`}
                                    >
                                        Browse Asks
                                    </button>
                                </div>

                                {/* Search */}
                                <div className="flex-1">
                                    <Input
                                        placeholder="Search marketplace..."
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        icon={<Search className="h-4 w-4" />}
                                    />
                                </div>
                            </div>

                            {/* Row 2: Geo + Vertical filters */}
                            <div className="flex flex-col sm:flex-row gap-3">
                                {/* Country Filter */}
                                <Select value={country} onValueChange={(v) => { setCountry(v); setRegion('All'); }}>
                                    <SelectTrigger className="w-full sm:w-44">
                                        <Globe className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
                                        <SelectValue placeholder="Country" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {COUNTRIES.map((c) => (
                                            <SelectItem key={c.code} value={c.code}>
                                                {c.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {/* Region/State Filter (conditional) */}
                                {regionConfig && (
                                    <Select value={region} onValueChange={setRegion}>
                                        <SelectTrigger className="w-full sm:w-36">
                                            <MapPin className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
                                            <SelectValue placeholder={regionConfig.label} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {regionConfig.options.map((s) => (
                                                <SelectItem key={s} value={s}>
                                                    {s === 'All' ? `All ${regionConfig.label}s` : s}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}

                                {/* Vertical Filter (hierarchical) */}
                                <VerticalSelector
                                    value={vertical}
                                    onValueChange={setVertical}
                                    showSuggest={isAuthenticated}
                                    onSuggestClick={() => setSuggestOpen(true)}
                                    disabled={false}
                                />
                            </div>
                        </div>

                        {/* Active Filters */}
                        {hasFilters && (
                            <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-border">
                                <span className="text-sm text-muted-foreground">Filters:</span>
                                {country !== 'ALL' && (
                                    <Badge variant="secondary" className="gap-1">
                                        {COUNTRIES.find((c) => c.code === country)?.label || country}
                                        <button onClick={() => { setCountry('ALL'); setRegion('All'); }}>
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                )}
                                {region !== 'All' && (
                                    <Badge variant="secondary" className="gap-1">
                                        {region}
                                        <button onClick={() => setRegion('All')}>
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                )}
                                {vertical !== 'all' && (
                                    <Badge variant="secondary" className="gap-1 capitalize">
                                        {vertical.replace('_', ' ')}
                                        <button onClick={() => setVertical('all')}>
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                )}
                            </div>
                        )}
                    </div>
                </section>

                {/* Results */}
                <section>
                    {isLoading ? (
                        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                            {[1, 2, 3, 4, 5, 6].map((i) => (
                                <SkeletonCard key={i} />
                            ))}
                        </div>
                    ) : view === 'asks' ? (
                        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                            {asks.length === 0 ? (
                                <EmptyState
                                    icon={Search}
                                    title="No asks match your filters"
                                    description="Try broadening your search or adjusting vertical and geo filters."
                                    action={hasFilters ? { label: 'Clear Filters', onClick: clearFilters } : undefined}
                                />
                            ) : (
                                asks.map((ask) => <AskCard key={ask.id} ask={ask} isAuthenticated={isAuthenticated} />)
                            )}
                        </div>
                    ) : (
                        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                            {leads.length === 0 ? (
                                <EmptyState
                                    icon={Search}
                                    title="No active leads found"
                                    description="There are no leads matching your current filters. Try adjusting or check back soon."
                                    action={hasFilters ? { label: 'Clear Filters', onClick: clearFilters } : undefined}
                                />
                            ) : (
                                leads.map((lead) => <LeadCard key={lead.id} lead={lead} isAuthenticated={isAuthenticated} />)
                            )}
                        </div>
                    )}
                </section>
            </div>

            {/* AI Vertical Suggestion Modal */}
            <SuggestVerticalModal
                open={suggestOpen}
                onOpenChange={setSuggestOpen}
                parentHint={vertical !== 'all' ? vertical : undefined}
            />
        </DashboardLayout>
    );
}

export default HomePage;
