import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin, X, Globe, Users, Star, Tag, ShieldCheck, Eye, Zap, DollarSign, TrendingUp, Filter, ChevronDown, ChevronUp, LayoutGrid, List, History, BarChart3, Loader2, Rocket, Square, RotateCcw } from 'lucide-react';

import DashboardLayout from '@/components/layout/DashboardLayout';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import NFTMarketplace from '@/components/marketplace/NFTMarketplace';
import { BrowseSellers } from '@/components/marketplace/BrowseSellers';
import { MarketMetricsPanel } from '@/components/marketplace/MarketMetricsPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AskCard } from '@/components/marketplace/AskCard';
import { LeadCard } from '@/components/marketplace/LeadCard';
import { BuyNowCard } from '@/components/marketplace/BuyNowCard';
import { VerticalSelector } from '@/components/marketplace/VerticalSelector';
import { SuggestVerticalModal } from '@/components/marketplace/SuggestVerticalModal';
import { DynamicFieldFilter } from '@/components/marketplace/DynamicFieldFilter';
import { useFloorPrice } from '@/hooks/useFloorPrice';

import { SkeletonCard } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tooltip } from '@/components/ui/Tooltip';

import api from '@/lib/api';
import useAuth from '@/hooks/useAuth';
import { useSocketEvents } from '@/hooks/useSocketEvents';
import { toast } from '@/hooks/useToast';
import ConnectButton from '@/components/wallet/ConnectButton';
import { useDemo } from '@/hooks/useDemo';
import { useDemoStatus } from '@/hooks/useDemoStatus';

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
    const [view, setView] = useState<'asks' | 'leads' | 'buyNow' | 'metrics' | 'nfts' | 'sellers'>('leads');
    const [layoutMode, setLayoutMode] = useState<'cards' | 'table'>('cards');
    const [vertical, setVertical] = useState('all');

    // Chainlink Data Feeds — real-time floor price for the selected vertical
    const { floor: floorPrice } = useFloorPrice(
        vertical !== 'all' ? vertical : undefined
    );
    const [country, setCountry] = useState('ALL');
    const [region, setRegion] = useState('All');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [asks, setAsks] = useState<any[]>([]);
    const [leads, setLeads] = useState<any[]>([]);
    const [buyNowLeads, setBuyNowLeads] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [buyNowSubTab, setBuyNowSubTab] = useState<'all' | 'recent'>('all');
    // Track leads that just ended their auction for 8s overlay feedback
    const [recentlyEndedMap, setRecentlyEndedMap] = useState<Record<string, 'UNSOLD' | 'SOLD'>>({});
    const { isAuthenticated } = useAuth();
    const [suggestOpen, setSuggestOpen] = useState(false);
    // Global demo running state — used to gate polling and suppress noisy toasts
    const { isRunning: isGlobalRunning } = useDemoStatus();
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [sellerName, setSellerName] = useState('');
    const [sellerInput, setSellerInput] = useState('');
    const [sellerSuggestions, setSellerSuggestions] = useState<any[]>([]);
    const [showSellerDropdown, setShowSellerDropdown] = useState(false);
    const sellerDropdownRef = useRef<HTMLDivElement>(null);

    // Field-level filters + quality score + price range + sort
    const [fieldFilters, setFieldFilters] = useState<Record<string, { op: string; value: string }>>({})
    const [qualityScore, setQualityScore] = useState<[number, number]>([0, 100]);
    const [minPrice, setMinPrice] = useState('');
    const [maxPrice, setMaxPrice] = useState('');
    const [sortBy, setSortBy] = useState('createdAt');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [matchCount, setMatchCount] = useState<number | null>(null);

    // ── Infinite scroll pagination ──
    const LEADS_PAGE_SIZE = 100;
    const [leadsHasMore, setLeadsHasMore] = useState(false);
    const [buyNowHasMore, setBuyNowHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<() => void>(() => { });

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
            // Reset pagination on fresh fetch
            setLeadsHasMore(false);
            setBuyNowHasMore(false);
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
                    // Live Leads tab: only fetch IN_AUCTION leads so ended auctions don't appear
                    if (view === 'leads') params.status = 'IN_AUCTION';
                    params.limit = String(LEADS_PAGE_SIZE);
                    params.offset = '0';
                    // Use advanced search for leads (supports field filters, quality score, price range)
                    if (vertical === 'all') {
                        // Fallback to basic listLeads when no vertical selected
                        const { data } = view === 'buyNow' ? await api.listBuyNowLeads(params) : await api.listLeads(params);
                        const resultLeads = (data?.leads || []).filter(shouldIncludeLead);
                        console.log('[setLeads:useEffect:basic] setting', resultLeads.length, 'leads (filtered from', data?.leads?.length, ')');
                        view === 'buyNow' ? setBuyNowLeads(mergeBidCounts(resultLeads)) : setLeads(mergeBidCounts(resultLeads));
                        setMatchCount(data?.pagination?.total || resultLeads.length);
                        // Track pagination
                        if (view === 'buyNow') {
                            setBuyNowHasMore(data?.pagination?.hasMore ?? false);
                        } else {
                            setLeadsHasMore(data?.pagination?.hasMore ?? false);
                        }
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
                        view === 'buyNow' ? setBuyNowLeads(mergeBidCounts(resultLeads)) : setLeads(mergeBidCounts(resultLeads));
                        setMatchCount(data?.total ?? resultLeads.length);
                        // Advanced search returns all matches; no cursor-based pagination
                        if (view === 'buyNow') setBuyNowHasMore(false);
                        else setLeadsHasMore(false);
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

    // ── Infinite scroll: load more leads ──
    const loadMore = useCallback(async () => {
        if (loadingMore) return;
        const isBuyNow = view === 'buyNow';
        const currentList = isBuyNow ? buyNowLeads : leads;
        const hasMore = isBuyNow ? buyNowHasMore : leadsHasMore;
        if (!hasMore) return;

        setLoadingMore(true);
        try {
            const params: Record<string, string> = {};
            if (country !== 'ALL') params.country = country;
            if (region !== 'All') params.state = region;
            if (debouncedSearch) params.search = debouncedSearch;
            if (sellerName) params.sellerName = sellerName;
            if (view === 'leads') params.status = 'IN_AUCTION';
            params.limit = String(LEADS_PAGE_SIZE);
            params.offset = String(currentList.length);

            const { data } = isBuyNow
                ? await api.listBuyNowLeads(params)
                : await api.listLeads(params);

            const newLeads = (data?.leads || []).filter(shouldIncludeLead);
            if (isBuyNow) {
                setBuyNowLeads(prev => [...prev, ...newLeads]);
                setBuyNowHasMore(data?.pagination?.hasMore ?? false);
            } else {
                setLeads(prev => [...prev, ...newLeads]);
                setLeadsHasMore(data?.pagination?.hasMore ?? false);
            }
        } catch (error) {
            console.error('Load more error:', error);
        } finally {
            setLoadingMore(false);
        }
    }, [view, leads, buyNowLeads, leadsHasMore, buyNowHasMore, loadingMore, country, region, debouncedSearch, sellerName, shouldIncludeLead]);

    // Keep loadMoreRef in sync so the observer callback never has a stale closure
    loadMoreRef.current = loadMore;

    // ── Callback ref for infinite scroll sentinel ──
    // Attaches IntersectionObserver whenever the sentinel DOM element appears.
    const sentinelCallbackRef = useCallback((node: HTMLDivElement | null) => {
        // Disconnect any previous observer
        if (observerRef.current) {
            observerRef.current.disconnect();
            observerRef.current = null;
        }
        if (!node) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) loadMoreRef.current();
            },
            { rootMargin: '300px' }
        );
        observer.observe(node);
        observerRef.current = observer;
    }, []);  // stable — no deps needed since loadMoreRef is a ref

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
                    params.limit = String(LEADS_PAGE_SIZE);
                    params.offset = '0';
                    const { data } = await api.listBuyNowLeads(params);
                    setBuyNowLeads(data?.leads || []);
                    setBuyNowHasMore(data?.pagination?.hasMore ?? false);
                } else {
                    // Live Leads: only fetch IN_AUCTION so ended auctions stay out
                    params.status = 'IN_AUCTION';
                    params.limit = String(LEADS_PAGE_SIZE);
                    params.offset = '0';
                    const { data } = await api.listLeads(params);
                    const allLeads = data?.leads || [];
                    const filteredLeads = allLeads.filter(shouldIncludeLead);
                    console.log('[setLeads:refetchData] setting', filteredLeads.length, 'leads (filtered from', allLeads.length, ')');
                    setLeads(mergeBidCounts(filteredLeads));
                    setLeadsHasMore(data?.pagination?.hasMore ?? false);
                }
            } catch (error) {
                console.error('Poll fetch error:', error);
            }
        };
        fetchData();
    }, [view, vertical, country, region, debouncedSearch, shouldIncludeLead]);

    // Aggressive polling when the current view has no leads (catch missed socket events)
    // Disabled while demo is running — leads arrive continuously via marketplace:lead:new socket.
    useEffect(() => {
        const currentLeads = view === 'buyNow' ? buyNowLeads : view === 'asks' ? asks : leads;
        if (currentLeads.length > 0 || isLoading || isGlobalRunning) return;

        console.log('[empty-state-poll] No leads in view, polling every 20s');
        const interval = setInterval(() => {
            console.log('[empty-state-poll] firing refetchData');
            refetchData();
        }, 20_000);
        return () => clearInterval(interval);
    }, [view, leads.length, buyNowLeads.length, asks.length, isLoading, isGlobalRunning, refetchData]);

    // Real-time socket listeners
    const leadsRef = useRef(leads);
    leadsRef.current = leads;

    // ── Bid-count high-watermark ───────────────────────────────────────────────
    // Tracks the highest bid count ever seen per lead so that API refetches
    // (which return 0 for demo bids stored on-chain) can never reset the card.
    const bidFloor = useRef<Map<string, number>>(new Map());

    /** Merge incoming leads with the bid-count floor so counts never regress. */
    const mergeBidCounts = useCallback((incoming: any[]): any[] => {
        return incoming.map((lead) => {
            const floor = bidFloor.current.get(lead.id) ?? 0;
            const apiCount = lead._count?.bids ?? lead.auctionRoom?.bidCount ?? 0;
            const effective = Math.max(floor, apiCount);
            if (effective <= 0) return lead;
            return {
                ...lead,
                _count: { ...lead._count, bids: effective },
                auctionRoom: lead.auctionRoom
                    ? { ...lead.auctionRoom, bidCount: effective }
                    : lead.auctionRoom,
            };
        });
    }, []);

    useSocketEvents(
        {
            'marketplace:lead:new': (data: any) => {
                if (view === 'leads' && data?.lead) {
                    const lead = data.lead;

                    console.log('[socket:lead:new] Current filters:', { vertical, country, region, debouncedSearch });
                    console.log('[socket:lead:new] Incoming lead:', { id: lead.id, vertical: lead.vertical, geo: lead.geo });

                    if (!shouldIncludeLead(lead)) {
                        console.log('[socket:lead:new] BLOCKED by shouldIncludeLead');
                        return;
                    }

                    // Ensure new lead is initialised in the bid floor (starts at 0)
                    if (!bidFloor.current.has(lead.id)) {
                        bidFloor.current.set(lead.id, lead._count?.bids ?? 0);
                    }

                    console.log('[setLeads:socket:lead:new] PASSED all guards, prepending lead');
                    setLeads((prev) => {
                        // Avoid duplicates if a refetch already added this lead
                        if (prev.some((l) => l.id === lead.id)) return prev;
                        return [data.lead, ...prev];
                    });

                    // Suppress noisy per-lead toasts while demo is running — Dev Log covers it
                    if (!isGlobalRunning) {
                        toast({
                            type: 'info',
                            title: 'New Lead',
                            description: `${data.lead.vertical} lead just appeared`,
                        });
                    }
                }
            },
            'marketplace:bid:update': (data: any) => {
                if (data?.leadId && data.bidCount != null) {
                    // Update the floor so future refetches can't regress this count
                    const prev = bidFloor.current.get(data.leadId) ?? 0;
                    if (data.bidCount > prev) {
                        bidFloor.current.set(data.leadId, data.bidCount);
                    }
                    const newCount = Math.max(prev, data.bidCount);
                    setLeads((leads) =>
                        leads.map((lead) =>
                            lead.id === data.leadId
                                ? {
                                    ...lead,
                                    _count: { ...lead._count, bids: newCount },
                                    auctionRoom: lead.auctionRoom
                                        ? { ...lead.auctionRoom, highestBid: data.highestBid ?? lead.auctionRoom.highestBid, bidCount: newCount }
                                        : undefined,
                                }
                                : lead,
                        ),
                    );
                }
            },
            'marketplace:refreshAll': () => {
                // Skip during demo — socket events drive the list; refetch would overwrite live data
                if (isGlobalRunning) return;
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
                // Skip refetch during demo — only update Buy It Now tab, not Live Leads
                if (data?.leadId && !isGlobalRunning) {
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
                    const endStatus = data.newStatus === 'SOLD' ? 'SOLD' as const : 'UNSOLD' as const;

                    // Show grey "Ended" overlay for exactly 8 s, then remove the card naturally.
                    setRecentlyEndedMap((prev) => ({ ...prev, [data.leadId]: endStatus }));

                    setTimeout(() => {
                        setLeads((prev) => prev.filter((l) => l.id !== data.leadId));
                        setRecentlyEndedMap((prev) => {
                            const next = { ...prev };
                            delete next[data.leadId];
                            return next;
                        });
                        // Only trigger a Buy-It-Now refresh when demo is not running.
                        // During demo, the next lead arrives via socket anyway.
                        if (data.newStatus === 'UNSOLD' && !isGlobalRunning) {
                            console.log('[setLeads:status-changed] UNSOLD, calling refetchData after overlay');
                            refetchData();
                        }
                    }, 8_000);
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
                                    Chainlink-verified &middot; On-chain settlement
                                </div>
                            </div>

                            {/* Main heading */}
                            <h1 className="text-center text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-4">
                                <span className="text-foreground">Own the Vertical.</span>
                                <br />
                                <span className="gradient-text">Trade the Leads.</span>
                            </h1>

                            {/* Subtitle */}
                            <p className="text-center text-sm sm:text-base md:text-lg text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
                                Serving the <span className="text-foreground font-semibold">$200B</span> lead generation market with
                                Chainlink-verified quality, real-time bidding, auto-bid automation, and instant on-chain
                                USDC settlement &mdash; across <span className="text-foreground font-semibold">50+ verticals</span> in 20+ countries.
                            </p>

                            {/* CTA */}
                            <div className="flex justify-center">
                                <ConnectButton />
                            </div>
                        </div>
                    </section>
                )}

                {/* Why Lead Engine — Trust Bar (guest only) */}
                {!isAuthenticated && (
                    <section>
                        <div className="grid md:grid-cols-3 gap-5">
                            {/* Card 1: Lead Quality */}
                            <div className="group rounded-xl border border-border/50 bg-card/50 p-6 transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.04]">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-500/10">
                                        <ShieldCheck className="h-5 w-5 text-emerald-400" />
                                    </div>
                                    <h3 className="font-semibold text-sm text-foreground">Verified Lead Quality</h3>
                                </div>
                                <p className="text-sm leading-relaxed text-muted-foreground">
                                    Every lead carries a Chainlink CRE quality score (0&ndash;100) that cryptographically
                                    proves authenticity. No bots, no stuffed data, no junk &mdash; verified on-chain
                                    before it reaches the marketplace.
                                </p>
                            </div>

                            {/* Card 2: Transparency */}
                            <div className="group rounded-xl border border-border/50 bg-card/50 p-6 transition hover:border-blue-500/30 hover:bg-blue-500/[0.04]">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-500/10">
                                        <Eye className="h-5 w-5 text-blue-400" />
                                    </div>
                                    <h3 className="font-semibold text-sm text-foreground">Full Transparency</h3>
                                </div>
                                <p className="text-sm leading-relaxed text-muted-foreground">
                                    On-chain USDC settlement and LeadNFT provenance give both sides perfect
                                    auditability. Atomic payments &mdash; no net terms, no chargebacks. Ownership
                                    history and quality proof travel with the NFT.
                                </p>
                            </div>

                            {/* Card 3: Instant Settlement */}
                            <div className="group rounded-xl border border-border/50 bg-card/50 p-6 transition hover:border-amber-500/30 hover:bg-amber-500/[0.04]">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-500/10">
                                        <Zap className="h-5 w-5 text-amber-400" />
                                    </div>
                                    <h3 className="font-semibold text-sm text-foreground">Instant USDC Settlement</h3>
                                </div>
                                <p className="text-sm leading-relaxed text-muted-foreground">
                                    RTBEscrow holds USDC in smart-contract escrow and releases
                                    instantly on auction win or Buy-It-Now purchase. Sellers receive funds in
                                    seconds, not weeks.
                                </p>
                            </div>
                        </div>
                    </section>
                )}

                {/* One-Click Demo Button */}
                {(import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true') && (
                    <DemoButtonBanner />
                )}

                {/* Filters */}
                <section className="relative z-10">
                    <div className="glass rounded-xl p-4 sm:p-6">
                        <div className="flex flex-col gap-4">
                            {/* Row 1: View toggle + Search */}
                            <div className="flex flex-col sm:flex-row gap-3">
                                {/* View Toggle */}
                                <div className="flex gap-1 p-1 rounded-lg bg-muted shrink-0">
                                    <button
                                        onClick={() => setView('leads')}
                                        className={`px-4 py-2 rounded-md text-sm font-medium transition flex items-center gap-1.5 ${view === 'leads' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
                                            }`}
                                    >
                                        <Zap className="h-3.5 w-3.5" />
                                        Live Leads
                                        {leads.length > 0 && (
                                            <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold ${view === 'leads' ? 'bg-blue-500/20 text-blue-400' : 'bg-muted-foreground/15 text-muted-foreground'}`}>
                                                {leads.length}
                                            </span>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => setView('buyNow')}
                                        className={`px-4 py-2 rounded-md text-sm font-medium transition flex items-center gap-1.5 ${view === 'buyNow' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
                                            }`}
                                    >
                                        <Tag className="h-3.5 w-3.5" />
                                        Buy Now
                                        {buyNowLeads.length > 0 && (
                                            <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold ${view === 'buyNow' ? 'bg-green-500/20 text-green-400' : 'bg-muted-foreground/15 text-muted-foreground'}`}>
                                                {buyNowLeads.length}
                                            </span>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => setView('sellers')}
                                        className={`px-4 py-2 rounded-md text-sm font-medium transition flex items-center gap-1.5 ${view === 'sellers' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
                                            }`}
                                    >
                                        <Users className="h-3.5 w-3.5" />
                                        Sellers
                                    </button>
                                    <button
                                        onClick={() => setView('metrics')}
                                        className={`px-4 py-2 rounded-md text-sm font-medium transition flex items-center gap-1.5 ${view === 'metrics' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
                                            }`}
                                    >
                                        <BarChart3 className="h-3.5 w-3.5" />
                                        Metrics
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

                <section className="relative z-0">
                    {isLoading ? (
                        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                            {[1, 2, 3, 4, 5, 6].map((i) => (
                                <SkeletonCard key={i} />
                            ))}
                        </div>
                    ) : view === 'metrics' ? (
                        <MarketMetricsPanel />
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
                        <div className="space-y-4">
                            {/* Sub-tab: All / Recently Ended */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setBuyNowSubTab('all')}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${buyNowSubTab === 'all'
                                        ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                                        : 'text-muted-foreground hover:text-foreground border border-transparent'}`}
                                >
                                    All Buy Now
                                </button>
                                <button
                                    onClick={() => setBuyNowSubTab('recent')}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center gap-1.5 ${buyNowSubTab === 'recent'
                                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                        : 'text-muted-foreground hover:text-foreground border border-transparent'}`}
                                >
                                    <History className="h-3 w-3" />
                                    Recently Ended
                                    <span className="text-[10px] opacity-70">(24h)</span>
                                </button>
                            </div>
                            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                                {(() => {
                                    const filtered = buyNowSubTab === 'recent'
                                        ? buyNowLeads.filter((l) => {
                                            const created = l.createdAt ? new Date(l.createdAt).getTime() : 0;
                                            return Date.now() - created < 24 * 60 * 60 * 1000;
                                        })
                                        : buyNowLeads;
                                    return filtered.length === 0 ? (
                                        <EmptyState
                                            icon={Tag}
                                            title={buyNowSubTab === 'recent'
                                                ? "No recently ended auctions"
                                                : hasFilters ? "No Buy It Now leads match" : "No Buy It Now leads available"}
                                            description={buyNowSubTab === 'recent'
                                                ? "No auctions have ended in the last 24 hours. Try the 'All Buy Now' tab."
                                                : hasFilters
                                                    ? vertical !== 'all'
                                                        ? `No ${vertical} leads currently available for instant purchase. Try adjusting quality score, price range, or field filters.`
                                                        : "No leads match your current filters. Try selecting a vertical or broadening your criteria."
                                                    : "Buy It Now leads appear when auctions end without a winner, or when sellers offer instant purchase. Check back soon or browse Live Leads."}
                                            action={buyNowSubTab === 'recent'
                                                ? { label: 'View All', onClick: () => setBuyNowSubTab('all') }
                                                : hasFilters ? { label: 'Clear All Filters', onClick: clearFilters } : undefined}
                                        />
                                    ) : (
                                        filtered.map((lead) => (
                                            <BuyNowCard
                                                key={lead.id}
                                                lead={lead}
                                                onPurchased={(id) => setBuyNowLeads((prev) => prev.filter((l) => l.id !== id))}
                                            />
                                        ))
                                    );
                                })()}
                            </div>
                            {/* Infinite scroll sentinel for Buy Now */}
                            {buyNowHasMore && (
                                <div ref={sentinelCallbackRef} className="flex justify-center py-8">
                                    {loadingMore ? (
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Loading more leads…
                                        </div>
                                    ) : (
                                        <div className="h-4" />
                                    )}
                                </div>
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
                            <>
                                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                                    {leads.length === 0 ? (
                                        isGlobalRunning ? (
                                            // Demo is live — leads are streaming in via socket; show a warm hint
                                            // instead of the "No active leads" empty state which confuses viewers.
                                            <div className="col-span-full flex flex-col items-center justify-center py-16 gap-3" id="demo-lead-streaming">
                                                <span className="inline-block w-3 h-3 rounded-full bg-blue-400 animate-pulse" />
                                                <p className="text-sm text-muted-foreground">Demo is live — leads are streaming in…</p>
                                            </div>
                                        ) : (
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
                                        )
                                    ) : (
                                        leads.map((lead) => <LeadCard key={lead.id} lead={lead} isAuthenticated={isAuthenticated} floorPrice={floorPrice} auctionEndFeedback={recentlyEndedMap[lead.id]} />)
                                    )}
                                </div>
                                {/* Infinite scroll sentinel */}
                                {leadsHasMore && (
                                    <div ref={sentinelCallbackRef} className="flex justify-center py-8">
                                        {loadingMore ? (
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Loading more leads…
                                            </div>
                                        ) : (
                                            <div className="h-4" />
                                        )}
                                    </div>
                                )}
                            </>
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

// ── Demo Button Banner ──────────────────────────
function DemoButtonBanner() {
    const { isRunning, isComplete, startDemo, stopDemo, progress, completedRunId } = useDemo();
    const { isRunning: isGlobalRunning, isRecycling, currentCycle, totalCycles, percent } = useDemoStatus();
    const [selectedCycles, setSelectedCycles] = useState(5);
    const navigate = useNavigate();

    // The button is blocked when the global server-state says a demo is active,
    // regardless of which persona/viewer triggered it.
    const demoBlocked = isGlobalRunning || isRecycling;

    // Display text: prefer local progress (rich, per-log) if this tab started it;
    // fall back to global summary for observers.
    const statusText = isRunning
        ? progress.phase === 'seeding'
            ? '📦 Seeding marketplace with leads...'
            : `🔄 Cycle ${progress.currentCycle} of ${progress.totalCycles} • ${progress.percent}% complete`
        : isGlobalRunning
            ? totalCycles > 0
                ? `🔄 Demo in progress — Cycle ${currentCycle} of ${totalCycles} (${percent}%)`
                : '🔄 Demo in progress — watch the Dev Log (Ctrl+Shift+L)'
            : isRecycling
                ? '♻️ Recycling tokens for next run (~30s)...'
                : isComplete
                    ? '✅ Demo complete — View the results summary'
                    : 'Seed leads → lock bids → settle → refund → PoR verify';

    return (
        <section className="relative z-10">
            <div className="relative overflow-hidden rounded-xl border border-blue-500/20 bg-gradient-to-r from-blue-600/10 via-violet-600/5 to-blue-600/10">
                {/* Glow effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-violet-500/10 to-blue-500/5 animate-pulse" />

                <div className="relative flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-500/15">
                            <Rocket className="h-5 w-5 text-blue-400" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-foreground">
                                One-Click On-Chain Demo
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {statusText}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {isRunning ? (
                            <button
                                onClick={stopDemo}
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 text-sm font-medium transition border border-red-500/20"
                            >
                                <Square className="h-4 w-4" />
                                Stop Demo
                            </button>
                        ) : demoBlocked ? (
                            // Another viewer started the demo — show disabled state for all
                            <button
                                disabled
                                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-muted text-muted-foreground text-sm font-medium cursor-not-allowed opacity-60 border border-border"
                                title={isRecycling ? 'Recycling tokens — please wait ~30s' : 'A demo is already running'}
                            >
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {isRecycling ? 'Recycling...' : 'Demo Running...'}
                            </button>
                        ) : isComplete && completedRunId ? (
                            <>
                                <button
                                    onClick={() => navigate('/demo/results')}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-sm font-medium transition border border-emerald-500/20"
                                >
                                    📊 View Results
                                </button>
                                <button
                                    onClick={() => startDemo(selectedCycles)}
                                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted hover:bg-muted/80 text-sm transition"
                                >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    Run Again
                                </button>
                            </>
                        ) : (
                            <>
                                {/* Cycle selector */}
                                <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
                                    {[5, 8, 12].map(n => (
                                        <button
                                            key={n}
                                            onClick={() => setSelectedCycles(n)}
                                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${selectedCycles === n
                                                ? 'bg-blue-600 text-white shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground'
                                                }`}
                                        >
                                            {n}
                                        </button>
                                    ))}
                                    <span className="text-xs text-muted-foreground px-1">cycles</span>
                                </div>
                                <button
                                    onClick={() => startDemo(selectedCycles)}
                                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white text-sm font-bold shadow-lg shadow-blue-500/25 transition-all hover:shadow-blue-500/40 hover:scale-[1.02]"
                                >
                                    <Rocket className="h-4 w-4" />
                                    🚀 Run Full On-Chain Demo (Testnet)
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Progress bar + banner */}
                {isRunning && (
                    <div className="relative border-t border-blue-500/10">
                        {/* Progress bar */}
                        <div className="h-1 bg-blue-500/5">
                            <div
                                className="h-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-1000 ease-out"
                                style={{ width: `${progress.percent}%` }}
                            />
                        </div>
                        <div className="bg-blue-500/5 px-6 py-1.5 text-center text-xs text-blue-400/80">
                            DEMO MODE — Testnet Only • Funds are recycled • Open the Dev Log (Ctrl+Shift+L) to watch
                        </div>
                    </div>
                )}
            </div>
        </section >
    );
}

export default HomePage;

