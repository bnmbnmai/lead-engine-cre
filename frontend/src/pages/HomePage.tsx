import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, MapPin, X, Globe, Users, Star, Tag, ShieldCheck, Eye, Zap, DollarSign, TrendingUp, Filter, ChevronDown, ChevronUp, LayoutGrid, List } from 'lucide-react';

import DashboardLayout from '@/components/layout/DashboardLayout';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import NFTMarketplace from '@/components/marketplace/NFTMarketplace';
import { BrowseSellers } from '@/components/marketplace/BrowseSellers';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AskCard } from '@/components/marketplace/AskCard';
import { LeadCard } from '@/components/marketplace/LeadCard';
import { BuyNowCard } from '@/components/marketplace/BuyNowCard';
import { VerticalSelector } from '@/components/marketplace/VerticalSelector';
import { SuggestVerticalModal } from '@/components/marketplace/SuggestVerticalModal';
import { DynamicFieldFilter } from '@/components/marketplace/DynamicFieldFilter';

import { SkeletonCard } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tooltip } from '@/components/ui/Tooltip';

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
    const [view, setView] = useState<'asks' | 'leads' | 'buyNow' | 'nfts' | 'sellers'>('leads');
    const [layoutMode, setLayoutMode] = useState<'cards' | 'table'>('cards');
    const [vertical, setVertical] = useState('all');
    const [country, setCountry] = useState('ALL');
    const [region, setRegion] = useState('All');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [asks, setAsks] = useState<any[]>([]);
    const [leads, setLeads] = useState<any[]>([]);
    const [buyNowLeads, setBuyNowLeads] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { isAuthenticated } = useAuth();
    const [suggestOpen, setSuggestOpen] = useState(false);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [sellerName, setSellerName] = useState('');
    const [sellerInput, setSellerInput] = useState('');
    const [sellerSuggestions, setSellerSuggestions] = useState<any[]>([]);
    const [showSellerDropdown, setShowSellerDropdown] = useState(false);
    const sellerDropdownRef = useRef<HTMLDivElement>(null);

    // Field-level filters + quality score + price range + sort
    const [fieldFilters, setFieldFilters] = useState<Record<string, { op: string; value: string }>>({});
    const [qualityScore, setQualityScore] = useState<[number, number]>([0, 100]);
    const [minPrice, setMinPrice] = useState('');
    const [maxPrice, setMaxPrice] = useState('');
    const [sortBy, setSortBy] = useState('createdAt');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [matchCount, setMatchCount] = useState<number | null>(null);

    // ── Reusable client-side filter guard ──
    // Matches the same logic as the backend vertical expansion.
    // Applied to EVERY code path that updates the leads array.
    const shouldIncludeLead = useCallback((lead: any): boolean => {
        if (!lead) return false;
        const geo = typeof lead.geo === 'object' && lead.geo ? lead.geo : {} as any;
        // Vertical guard (startsWith supports parent.child hierarchy)
        if (vertical !== 'all' && !lead.vertical?.startsWith(vertical)) return false;
        // Geo guards
        if (country !== 'ALL' && geo.country !== country) return false;
        if (region !== 'All' && geo.state !== region) return false;
        // Search guard
        if (debouncedSearch && !JSON.stringify(lead).toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
        return true;
    }, [vertical, country, region, debouncedSearch]);

    const regionConfig = country !== 'ALL' ? getRegions(country) : null;

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // Seller autocomplete
    useEffect(() => {
        if (sellerInput.length < 2) {
            setSellerSuggestions([]);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const { data } = await api.searchSellers(sellerInput);
                setSellerSuggestions(data?.sellers || []);
                setShowSellerDropdown(true);
            } catch { setSellerSuggestions([]); }
        }, 300);
        return () => clearTimeout(timer);
    }, [sellerInput]);

    // Close seller dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (sellerDropdownRef.current && !sellerDropdownRef.current.contains(e.target as Node)) {
                setShowSellerDropdown(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const params: Record<string, string> = {};
                if (country !== 'ALL') params.country = country;
                if (region !== 'All') params.state = region;
                if (debouncedSearch) params.search = debouncedSearch;
                if (sellerName) params.sellerName = sellerName;

                if (view === 'asks') {
                    if (vertical !== 'all') params.vertical = vertical;
                    const { data } = await api.listAsks(params);
                    setAsks(data?.asks || []);
                    setMatchCount(data?.pagination?.total || data?.asks?.length || 0);
                } else if (view === 'leads' || view === 'buyNow') {
                    // Use advanced search for leads (supports field filters, quality score, price range)
                    if (vertical === 'all') {
                        // Fallback to basic listLeads when no vertical selected
                        const { data } = view === 'buyNow' ? await api.listBuyNowLeads(params) : await api.listLeads(params);
                        const resultLeads = (data?.leads || []).filter(shouldIncludeLead);
                        console.log('[setLeads:useEffect:basic] setting', resultLeads.length, 'leads (filtered from', data?.leads?.length, ')');
                        view === 'buyNow' ? setBuyNowLeads(resultLeads) : setLeads(resultLeads);
                        setMatchCount(data?.pagination?.total || resultLeads.length);
                    } else {
                        // Advanced search with field filters
                        const fieldFilterArray = Object.keys(fieldFilters).map(fieldKey => ({
                            fieldKey,
                            operator: fieldFilters[fieldKey].op === '==' ? 'EQUALS' :
                                fieldFilters[fieldKey].op === '!=' ? 'NOT_EQUALS' :
                                    fieldFilters[fieldKey].op === '>=' ? 'GTE' :
                                        fieldFilters[fieldKey].op === '<=' ? 'LTE' :
                                            fieldFilters[fieldKey].op === '>' ? 'GT' :
                                                fieldFilters[fieldKey].op === '<' ? 'LT' :
                                                    fieldFilters[fieldKey].op === 'includes' ? 'IN' : 'EQUALS',
                            value: fieldFilters[fieldKey].value,
                        }));

                        const { data } = await api.searchLeadsAdvanced({
                            vertical,
                            state: region !== 'All' ? region : undefined,
                            status: view === 'buyNow' ? 'UNSOLD' : 'IN_AUCTION',
                            fieldFilters: fieldFilterArray.length > 0 ? fieldFilterArray : undefined,
                            minQualityScore: qualityScore[0] > 0 ? qualityScore[0] : undefined,
                            maxQualityScore: qualityScore[1] < 100 ? qualityScore[1] : undefined,
                            minPrice: minPrice ? parseFloat(minPrice) : undefined,
                            maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
                            sortBy,
                            sortOrder,
                            limit: 50,
                        });

                        const resultLeads = (data?.leads || []).filter(shouldIncludeLead);
                        console.log('[setLeads:useEffect:advanced] setting', resultLeads.length, 'leads (filtered from', data?.leads?.length, ')');
                        view === 'buyNow' ? setBuyNowLeads(resultLeads) : setLeads(resultLeads);
                        setMatchCount(data?.total ?? resultLeads.length);
                    }
                }
            } catch (error) {
                console.error('Fetch error:', error);
                setMatchCount(0);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [view, vertical, country, region, debouncedSearch, sellerName, fieldFilters, qualityScore, minPrice, maxPrice, sortBy, sortOrder, shouldIncludeLead]);

    // Wrap fetchData for polling fallback
    const refetchData = useCallback(() => {
        const fetchData = async () => {
            try {
                const params: Record<string, string> = {};
                if (vertical !== 'all') params.vertical = vertical;
                if (country !== 'ALL') params.country = country;
                if (region !== 'All') params.state = region;
                if (debouncedSearch) params.search = debouncedSearch;

                if (view === 'asks') {
                    const { data } = await api.listAsks(params);
                    setAsks(data?.asks || []);
                } else if (view === 'buyNow') {
                    const { data } = await api.listBuyNowLeads(params);
                    setBuyNowLeads(data?.leads || []);
                } else {
                    const { data } = await api.listLeads(params);
                    const allLeads = data?.leads || [];
                    const filteredLeads = allLeads.filter(shouldIncludeLead);
                    console.log('[setLeads:refetchData] setting', filteredLeads.length, 'leads (filtered from', allLeads.length, ')');
                    setLeads(filteredLeads);
                }
            } catch (error) {
                console.error('Poll fetch error:', error);
            }
        };
        fetchData();
    }, [view, vertical, country, region, debouncedSearch, shouldIncludeLead]);

    // Aggressive polling when the current view has no leads (catch missed socket events)
    useEffect(() => {
        const currentLeads = view === 'buyNow' ? buyNowLeads : view === 'asks' ? asks : leads;
        if (currentLeads.length > 0 || isLoading) return;

        console.log('[empty-state-poll] No leads in view, polling every 8s');
        const interval = setInterval(() => {
            console.log('[empty-state-poll] firing refetchData');
            refetchData();
        }, 8_000);
        return () => clearInterval(interval);
    }, [view, leads.length, buyNowLeads.length, asks.length, isLoading, refetchData]);

    // Real-time socket listeners
    const leadsRef = useRef(leads);
    leadsRef.current = leads;

    useSocketEvents(
        {
            'marketplace:lead:new': (data: any) => {
                if (view === 'leads' && data?.lead) {
                    const lead = data.lead;

                    // ── DEBUG: log filter state + incoming lead ──
                    console.log('[socket:lead:new] Current filters:', { vertical, country, region, debouncedSearch });
                    console.log('[socket:lead:new] Incoming lead:', { id: lead.id, vertical: lead.vertical, geo: lead.geo });

                    if (!shouldIncludeLead(lead)) {
                        console.log('[socket:lead:new] BLOCKED by shouldIncludeLead');
                        return;
                    }

                    console.log('[setLeads:socket:lead:new] PASSED all guards, prepending lead');
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
                console.log('[setLeads:refreshAll] marketplace:refreshAll received, calling refetchData');
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
            'marketplace:new-bin': (data: any) => {
                // Always refresh Buy It Now data so it's ready when user switches tabs
                if (data?.leadId) {
                    console.log('[setLeads:new-bin] marketplace:new-bin received, calling refetchData');
                    refetchData();
                    if (view === 'buyNow') {
                        toast({
                            type: 'info',
                            title: 'New Buy It Now Lead',
                            description: `A ${data.vertical || ''} lead is now available for instant purchase.`,
                        });
                    }
                }
            },
            'lead:buy-now-sold': (data: any) => {
                if (data?.leadId) {
                    setBuyNowLeads((prev) => prev.filter((l) => l.id !== data.leadId));
                }
            },
            'lead:status-changed': (data: any) => {
                if (data?.leadId) {
                    console.log('[setLeads:status-changed] lead:status-changed:', data.leadId, '->', data.newStatus);
                    // Remove from Live Leads when a lead is no longer active
                    setLeads((prev) => prev.filter((l) => l.id !== data.leadId));
                    // Always refresh Buy It Now data when a lead moves to UNSOLD
                    if (data.newStatus === 'UNSOLD') {
                        console.log('[setLeads:status-changed] UNSOLD, calling refetchData');
                        refetchData();
                    }
                }
            },
        },
        refetchData,
        { autoConnect: false }, // Don't require auth for marketplace
    );

    const hasFilters = vertical !== 'all' || country !== 'ALL' || region !== 'All' || sellerName !== '' ||
        Object.keys(fieldFilters).length > 0 || qualityScore[0] > 0 || qualityScore[1] < 100 ||
        minPrice !== '' || maxPrice !== '';

    const clearFilters = () => {
        setVertical('all');
        setCountry('ALL');
        setRegion('All');
        setSellerName('');
        setSellerInput('');
        setFieldFilters({});
        setQualityScore([0, 100]);
        setMinPrice('');
        setMaxPrice('');
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

                {/* Why Lead Engine — Trust Bar */}
                <section>
                    <div className="grid md:grid-cols-3 gap-5">
                        {/* Card 1: Lead Quality */}
                        <div className="group rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.03]">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-500/10">
                                    <ShieldCheck className="h-5 w-5 text-emerald-400" />
                                </div>
                                <h3 className="font-semibold text-sm text-foreground">Verified Lead Quality</h3>
                            </div>
                            <p className="text-sm leading-relaxed text-muted-foreground">
                                Buyers no longer have to take sellers&rsquo; word for it. Every lead carries a
                                Chainlink CRE + ZK fraud-proof quality score (0&ndash;100) that cryptographically
                                proves the lead was not botted, stuffed, or generated from junk data. Sellers are
                                protected by immutable on-chain evidence.
                            </p>
                        </div>

                        {/* Card 2: Transparency */}
                        <div className="group rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 transition hover:border-blue-500/30 hover:bg-blue-500/[0.03]">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-500/10">
                                    <Eye className="h-5 w-5 text-blue-400" />
                                </div>
                                <h3 className="font-semibold text-sm text-foreground">Full Transparency</h3>
                            </div>
                            <p className="text-sm leading-relaxed text-muted-foreground">
                                Instant, on-chain USDC settlement and LeadNFT provenance give both sides
                                perfect auditability. Payment is atomic (no 30&ndash;90 day net terms, no
                                chargebacks). Ownership history and the original quality proof travel with the
                                NFT forever.
                            </p>
                        </div>

                        {/* Card 3: Instant Settlement */}
                        <div className="group rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 transition hover:border-amber-500/30 hover:bg-amber-500/[0.03]">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-500/10">
                                    <Zap className="h-5 w-5 text-amber-400" />
                                </div>
                                <h3 className="font-semibold text-sm text-foreground">Instant USDC Settlement</h3>
                            </div>
                            <p className="text-sm leading-relaxed text-muted-foreground">
                                RTBEscrow enables USDC escrow &rarr; instant release on auction win or Buy-It-Now
                                purchase. Platform fee is taken automatically; seller receives funds in seconds
                                instead of weeks.
                            </p>
                        </div>
                    </div>
                </section>

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
                                        Seller Offers
                                    </button>
                                    <button
                                        onClick={() => setView('buyNow')}
                                        className={`px-4 py-2 rounded-md text-sm font-medium transition flex items-center gap-1.5 ${view === 'buyNow' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
                                            }`}
                                    >
                                        <Tag className="h-3.5 w-3.5" />
                                        Buy Now
                                    </button>
                                    <button
                                        onClick={() => setView('nfts')}
                                        className={`px-4 py-2 rounded-md text-sm font-medium transition ${view === 'nfts' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
                                            }`}
                                        id="nfts-tab"
                                    >
                                        NFTs
                                    </button>
                                    <button
                                        onClick={() => setView('sellers')}
                                        className={`px-4 py-2 rounded-md text-sm font-medium transition ${view === 'sellers' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
                                            }`}
                                    >
                                        Sellers
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

                                {/* Seller Filter */}
                                <div className="relative" ref={sellerDropdownRef}>
                                    <Input
                                        placeholder="Filter by seller..."
                                        value={sellerInput}
                                        onChange={(e) => {
                                            setSellerInput(e.target.value);
                                            if (!e.target.value) {
                                                setSellerName('');
                                                setShowSellerDropdown(false);
                                            }
                                        }}
                                        onFocus={() => sellerSuggestions.length > 0 && setShowSellerDropdown(true)}
                                        icon={<Users className="h-4 w-4" />}
                                        className="w-full sm:w-48"
                                    />
                                    {showSellerDropdown && sellerSuggestions.length > 0 && (
                                        <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-lg shadow-xl max-h-60 overflow-auto">
                                            {sellerSuggestions.map((s) => (
                                                <button
                                                    key={s.id}
                                                    className="w-full px-3 py-2.5 text-left hover:bg-muted/60 flex items-center justify-between gap-2 text-sm transition-colors"
                                                    onClick={() => {
                                                        setSellerName(s.companyName);
                                                        setSellerInput(s.companyName);
                                                        setShowSellerDropdown(false);
                                                    }}
                                                >
                                                    <span className="truncate font-medium">{s.companyName}</span>
                                                    <span className="flex items-center gap-1 shrink-0">
                                                        <Star className="h-3 w-3 text-amber-500" />
                                                        <span className="text-xs text-muted-foreground">{(Number(s.reputationScore) / 100).toFixed(0)}%</span>
                                                        {s.isVerified && <Badge variant="outline" className="text-[10px] px-1 py-0 text-emerald-500 border-emerald-500/30">✓</Badge>}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Advanced Filters Toggle (only for leads/buyNow with vertical) */}
                        {(view === 'leads' || view === 'buyNow') && vertical !== 'all' && (
                            <div className="pt-3 border-t border-border">
                                <button
                                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                                    className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    <Filter className="h-3.5 w-3.5" />
                                    Advanced Filters
                                    {showAdvancedFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </button>
                            </div>
                        )}

                        {/* Quality Score + Price Range + Sort (collapsible) */}
                        {showAdvancedFilters && (view === 'leads' || view === 'buyNow') && vertical !== 'all' && (
                            <div className="flex flex-col gap-3 pt-3">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {/* Quality Score */}
                                    <div className="space-y-2">
                                        <label className="text-xs font-medium flex items-center gap-1.5">
                                            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                                            Quality Score: {qualityScore[0]}-{qualityScore[1]}
                                        </label>
                                        <Slider
                                            value={qualityScore}
                                            onValueChange={(val) => setQualityScore(val as [number, number])}
                                            min={0}
                                            max={100}
                                            step={5}
                                            className="w-full"
                                        />
                                    </div>

                                    {/* Price Range */}
                                    <div className="space-y-2">
                                        <label className="text-xs font-medium flex items-center gap-1.5">
                                            <DollarSign className="h-3.5 w-3.5" />
                                            Price Range
                                        </label>
                                        <div className="flex gap-2">
                                            <Input
                                                type="number"
                                                value={minPrice}
                                                onChange={(e) => setMinPrice(e.target.value)}
                                                placeholder="Min"
                                                className="h-8 text-xs"
                                            />
                                            <Input
                                                type="number"
                                                value={maxPrice}
                                                onChange={(e) => setMaxPrice(e.target.value)}
                                                placeholder="Max"
                                                className="h-8 text-xs"
                                            />
                                        </div>
                                    </div>

                                    {/* Sort */}
                                    <div className="space-y-2">
                                        <label className="text-xs font-medium flex items-center gap-1.5">
                                            <TrendingUp className="h-3.5 w-3.5" />
                                            Sort By
                                        </label>
                                        <div className="flex gap-2">
                                            <Select value={sortBy} onValueChange={setSortBy}>
                                                <SelectTrigger className="h-8 text-xs flex-1">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="createdAt">Newest</SelectItem>
                                                    <SelectItem value="reservePrice">Price</SelectItem>
                                                    <SelectItem value="auctionEndAt">Ending Soon</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as 'asc' | 'desc')}>
                                                <SelectTrigger className="h-8 text-xs w-24">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="desc">↓</SelectItem>
                                                    <SelectItem value="asc">↑</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    {/* Layout Toggle */}
                                    {(view === 'leads' || view === 'buyNow') && (
                                        <div className="flex gap-1 p-0.5 rounded-md bg-muted">
                                            <Tooltip content="Card view">
                                                <button
                                                    onClick={() => setLayoutMode('cards')}
                                                    className={`p-1.5 rounded transition-all ${layoutMode === 'cards' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                                    aria-label="Card view"
                                                >
                                                    <LayoutGrid className="h-3.5 w-3.5" />
                                                </button>
                                            </Tooltip>
                                            <Tooltip content="Table view">
                                                <button
                                                    onClick={() => setLayoutMode('table')}
                                                    className={`p-1.5 rounded transition-all ${layoutMode === 'table' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                                    aria-label="Table view"
                                                >
                                                    <List className="h-3.5 w-3.5" />
                                                </button>
                                            </Tooltip>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Field-Level Filters (collapsible) */}
                        {showAdvancedFilters && (view === 'leads' || view === 'buyNow') && vertical !== 'all' && (
                            <div className="pt-3">
                                <DynamicFieldFilter
                                    vertical={vertical}
                                    filters={fieldFilters}
                                    onChange={setFieldFilters}
                                    disabled={isLoading}
                                />
                            </div>
                        )}

                        {/* Active Filters + Match Counter */}
                        {hasFilters && (
                            <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-4 border-t border-border">
                                <div className="flex flex-wrap items-center gap-2">
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
                                    {sellerName && (
                                        <Badge variant="secondary" className="gap-1">
                                            <Users className="h-3 w-3" />
                                            {sellerName}
                                            <button onClick={() => { setSellerName(''); setSellerInput(''); }}>
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    )}
                                    {Object.keys(fieldFilters).length > 0 && (
                                        <Badge variant="secondary" className="gap-1">
                                            {Object.keys(fieldFilters).length} field filter{Object.keys(fieldFilters).length > 1 ? 's' : ''}
                                            <button onClick={() => setFieldFilters({})}>
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    )}
                                    {(qualityScore[0] > 0 || qualityScore[1] < 100) && (
                                        <Badge variant="secondary" className="gap-1">
                                            Quality {qualityScore[0]}-{qualityScore[1]}
                                            <button onClick={() => setQualityScore([0, 100])}>
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    )}
                                    {(minPrice || maxPrice) && (
                                        <Badge variant="secondary" className="gap-1">
                                            ${minPrice || '0'} - ${maxPrice || '∞'}
                                            <button onClick={() => { setMinPrice(''); setMaxPrice(''); }}>
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    )}
                                </div>

                                {/* Live Match Counter */}
                                {matchCount !== null && (
                                    <Badge variant="outline" className="text-xs font-semibold">
                                        {matchCount} lead{matchCount !== 1 ? 's' : ''} match
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
                    ) : view === 'sellers' ? (
                        <BrowseSellers
                            onViewLeads={(_sellerId, sellerDisplayName) => {
                                setSellerName(sellerDisplayName);
                                setSellerInput(sellerDisplayName);
                                setView('leads');
                            }}
                        />
                    ) : view === 'nfts' ? (
                        <NFTMarketplace />
                    ) : view === 'asks' ? (
                        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                            {asks.length === 0 ? (
                                <EmptyState
                                    icon={Search}
                                    title={hasFilters ? "No asks match your filters" : "No seller offers available"}
                                    description={hasFilters
                                        ? "Try selecting a different vertical or clearing some filters to see more asks."
                                        : "Sellers haven't created any open offers yet. Check back soon or switch to Live Leads to bid on individual leads."}
                                    action={hasFilters ? { label: 'Clear All Filters', onClick: clearFilters } : undefined}
                                />
                            ) : (
                                asks.map((ask) => <AskCard key={ask.id} ask={ask} isAuthenticated={isAuthenticated} />)
                            )}
                        </div>
                    ) : view === 'buyNow' ? (
                        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                            {buyNowLeads.length === 0 ? (
                                <EmptyState
                                    icon={Tag}
                                    title={hasFilters ? "No Buy It Now leads match" : "No Buy It Now leads available"}
                                    description={hasFilters
                                        ? vertical !== 'all'
                                            ? `No ${vertical} leads currently available for instant purchase. Try adjusting quality score, price range, or field filters.`
                                            : "No leads match your current filters. Try selecting a vertical or broadening your criteria."
                                        : "Buy It Now leads appear when auctions end without a winner, or when sellers offer instant purchase. Check back soon or browse Live Leads."}
                                    action={hasFilters ? { label: 'Clear All Filters', onClick: clearFilters } : undefined}
                                />
                            ) : (
                                buyNowLeads.map((lead) => (
                                    <BuyNowCard
                                        key={lead.id}
                                        lead={lead}
                                        onPurchased={(id) => setBuyNowLeads((prev) => prev.filter((l) => l.id !== id))}
                                    />
                                ))
                            )}
                        </div>
                    ) : (
                        layoutMode === 'table' && (view === 'leads' || view === 'buyNow') ? (
                            /* Table View for Leads / Buy Now */
                            leads.length === 0 ? (
                                <EmptyState
                                    icon={Search}
                                    title={hasFilters ? "No leads match your criteria" : "No active leads"}
                                    description={hasFilters
                                        ? "Try adjusting your filters to see more leads."
                                        : "No leads are currently in auction. Check back soon."}
                                    action={hasFilters ? { label: 'Clear All Filters', onClick: clearFilters } : undefined}
                                />
                            ) : (
                                <div className="rounded-xl border border-border overflow-hidden bg-card">
                                    <div className="overflow-x-auto">
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    <th>Vertical</th>
                                                    <th>Location</th>
                                                    <th>Reserve</th>
                                                    <th>QS</th>
                                                    <th>Bids</th>
                                                    <th>Time Left</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {leads.map((lead: any) => {
                                                    const qs = lead.qualityScore != null ? Math.floor(lead.qualityScore / 100) : null;
                                                    const endTime = lead.auctionEndAt ? new Date(lead.auctionEndAt) : null;
                                                    const timeLeft = endTime ? (() => {
                                                        const diff = endTime.getTime() - Date.now();
                                                        if (diff <= 0) return 'Ended';
                                                        const mins = Math.floor(diff / 60000);
                                                        const secs = Math.floor((diff % 60000) / 1000);
                                                        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                                                    })() : '—';
                                                    return (
                                                        <tr key={lead.id}>
                                                            <td>
                                                                <span className="font-medium capitalize">{lead.vertical?.replace(/_/g, ' ')}</span>
                                                            </td>
                                                            <td>
                                                                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                                                                    <MapPin className="h-3 w-3" />
                                                                    {lead.geo?.city ? `${lead.geo.city}, ` : ''}{lead.geo?.state || 'Unknown'}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                <span className="font-semibold">${Number(lead.reservePrice || 0).toFixed(2)}</span>
                                                            </td>
                                                            <td>
                                                                {qs !== null ? (
                                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${qs >= 70 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                                                        : qs >= 50 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                                                            : 'bg-red-500/15 text-red-400 border-red-500/30'
                                                                        }`}>
                                                                        {qs}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-muted-foreground text-xs">—</span>
                                                                )}
                                                            </td>
                                                            <td>
                                                                <span className="text-sm">{lead._count?.bids || lead.auctionRoom?.bidCount || 0}</span>
                                                            </td>
                                                            <td>
                                                                <span className={`text-sm ${timeLeft === 'Ended' ? 'text-red-500' : 'text-amber-500'}`}>
                                                                    {timeLeft}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                <a href={`/lead/${lead.id}`} className="text-primary hover:underline text-sm font-medium flex items-center gap-1">
                                                                    <Eye className="h-3.5 w-3.5" />
                                                                    View
                                                                </a>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )
                        ) : (
                            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                                {leads.length === 0 ? (
                                    <EmptyState
                                        icon={Search}
                                        title={hasFilters ? "No leads match your criteria" : "No active leads"}
                                        description={hasFilters
                                            ? vertical !== 'all'
                                                ? `No ${vertical} leads found. Try adjusting quality score (${qualityScore[0]}-${qualityScore[1]}), price range${Object.keys(fieldFilters).length > 0 ? `, or the ${Object.keys(fieldFilters).length} active field filter(s)` : ''}.`
                                                : "Select a vertical to unlock field-level filtering and see available leads."
                                            : "No leads are currently in auction. Check back soon or create an Ask if you're a seller."}
                                        action={hasFilters ? { label: 'Clear All Filters', onClick: clearFilters } : vertical === 'all' ? { label: 'Browse Verticals', onClick: () => { } } : undefined}
                                    />
                                ) : (
                                    leads.map((lead) => <LeadCard key={lead.id} lead={lead} isAuthenticated={isAuthenticated} />)
                                )}
                            </div>
                        )
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
