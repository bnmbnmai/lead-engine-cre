import { useState, useEffect } from 'react';
import { Search, MapPin, TrendingUp, Zap, X, Globe, Shield, Lock, ChevronRight, ArrowRight, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AskCard } from '@/components/marketplace/AskCard';
import { LeadCard } from '@/components/marketplace/LeadCard';
import { GlassCard } from '@/components/ui/card';
import { SkeletonCard } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import useAuth from '@/hooks/useAuth';

const VERTICALS = ['all', 'solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'b2b_saas', 'real_estate', 'auto', 'legal', 'financial_services'];

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
// Feature Highlights for Landing Page
// ============================================

const FEATURES = [
    {
        icon: Zap,
        title: 'CRE — Lead Verification Engine',
        description: 'On-chain quality scoring (0–10,000) with TCPA compliance proofs. Buyers see verified scores before bidding.',
        color: 'from-blue-500 to-cyan-400',
    },
    {
        icon: Shield,
        title: 'ACE — Autonomous Compliance',
        description: 'Cross-border KYC, MiCA attestation, and state-level jurisdiction enforcement — automatic for every trade.',
        color: 'from-emerald-500 to-teal-400',
    },
    {
        icon: Lock,
        title: 'Auto-Bid + ZK Privacy',
        description: 'Set rules once — bids fire instantly on matching leads. AES-256-GCM encryption ensures your strategy stays private.',
        color: 'from-violet-500 to-purple-400',
    },
    {
        icon: Globe,
        title: '20+ Global Markets',
        description: 'US, EU, LATAM, APAC, Africa — including new markets in Argentina, Indonesia, Philippines, Chile, and Kenya.',
        color: 'from-orange-500 to-amber-400',
    },
];

const STATS = [
    { label: 'Active Leads', value: '2,847' },
    { label: 'Avg Bid', value: '$127' },
    { label: 'Countries', value: '20+' },
    { label: 'Verticals', value: '10' },
];

// ============================================
// Landing Page Hero (signed out)
// ============================================

function LandingHero() {
    return (
        <div className="min-h-screen bg-background">
            {/* Navbar is already at the top via DashboardLayout — just the content here */}

            {/* Hero */}
            <section className="relative overflow-hidden">
                {/* Background effects */}
                <div className="absolute inset-0 node-grid opacity-40" />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[#375BD2]/10 rounded-full blur-[120px] pointer-events-none" />
                <div className="absolute bottom-0 right-0 w-[500px] h-[400px] bg-violet-600/8 rounded-full blur-[100px] pointer-events-none" />

                <div className="relative container mx-auto px-4 sm:px-6 pt-12 pb-16 sm:pt-20 sm:pb-24">
                    {/* Tagline badge */}
                    <div className="flex justify-center mb-8">
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/[0.04] text-sm text-muted-foreground">
                            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            Powered by Chainlink &middot; Built on-chain
                        </div>
                    </div>

                    {/* Main heading */}
                    <h1 className="text-center text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
                        <span className="gradient-text">Decentralized Lead RTB</span>
                        <br />
                        <span className="text-foreground">Global. Compliant. Private.</span>
                    </h1>

                    {/* Subtext */}
                    <p className="text-center text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-10 leading-relaxed">
                        Serving a <span className="text-foreground font-semibold">$200B+</span> lead generation market.
                        Verified leads, auto-bid automation, instant x402 settlements, and
                        autonomous compliance — across 20+ countries and 10 verticals.
                    </p>

                    {/* CTAs */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
                        <Button variant="gradient" size="lg" className="w-full sm:w-auto text-base px-8 py-6 gap-2" asChild>
                            <Link to="/buyer">
                                <Wallet className="h-5 w-5" />
                                Start Buying Leads
                                <ArrowRight className="h-4 w-4" />
                            </Link>
                        </Button>
                        <Button variant="glass" size="lg" className="w-full sm:w-auto text-base px-8 py-6 gap-2" asChild>
                            <Link to="/seller">
                                Submit &amp; Sell Leads
                                <ChevronRight className="h-4 w-4" />
                            </Link>
                        </Button>
                    </div>

                    {/* Live Stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 max-w-2xl mx-auto">
                        {STATS.map((stat) => (
                            <div
                                key={stat.label}
                                className="text-center p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]"
                            >
                                <div className="text-2xl sm:text-3xl font-bold gradient-text">{stat.value}</div>
                                <div className="text-xs sm:text-sm text-muted-foreground mt-1">{stat.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Feature Highlights */}
            <section className="container mx-auto px-4 sm:px-6 pb-20">
                <div className="text-center mb-12">
                    <h2 className="text-2xl sm:text-3xl font-bold mb-3">Built Different</h2>
                    <p className="text-muted-foreground max-w-xl mx-auto">
                        Not another SaaS marketplace. Lead Engine is trust infrastructure for a $200B+ industry —
                        on-chain verification, auto-bid automation, and instant USDC settlements from day one.
                    </p>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                    {FEATURES.map((feature) => (
                        <div
                            key={feature.title}
                            className="group relative p-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-all duration-300 hover:border-white/[0.12]"
                        >
                            {/* Icon glow */}
                            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4 shadow-lg`}>
                                <feature.icon className="h-6 w-6 text-white" />
                            </div>
                            <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* How It Works */}
            <section className="container mx-auto px-4 sm:px-6 pb-20">
                <div className="glass rounded-2xl p-8 sm:p-12">
                    <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">How It Works</h2>
                    <div className="grid sm:grid-cols-3 gap-8 text-center">
                        {[
                            { step: '01', title: 'Submit or Browse', desc: 'Sellers submit verified leads across 10 verticals. Buyers browse live auctions filtered by vertical, geography, and quality score.' },
                            { step: '02', title: 'Auto-Bid or Seal', desc: 'Set auto-bid rules to fire instantly on matching leads — or place encrypted sealed bids with ZK proofs. ACE validates compliance automatically.' },
                            { step: '03', title: 'Instant Settlement', desc: 'Winning bids settle via x402 USDC escrow in seconds. Sellers reinvest in their next ad campaign instantly. PII revealed only to the winner.' },
                        ].map((item) => (
                            <div key={item.step}>
                                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#375BD2]/20 text-[#375BD2] font-bold text-lg mb-4">
                                    {item.step}
                                </div>
                                <h3 className="font-semibold text-foreground mb-2">{item.title}</h3>
                                <p className="text-sm text-muted-foreground">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Bottom CTA */}
            <section className="container mx-auto px-4 sm:px-6 pb-20">
                <div className="text-center">
                    <h2 className="text-2xl sm:text-3xl font-bold mb-4">Ready to trade leads on-chain?</h2>
                    <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
                        Connect your wallet to access 20+ markets. Auto-bid on leads while you sleep.
                        Instant USDC settlements. No sign-up forms, no gatekeeping.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Button variant="gradient" size="lg" className="w-full sm:w-auto text-base px-8 py-6 gap-2" asChild>
                            <Link to="/buyer">
                                <Wallet className="h-5 w-5" />
                                Connect &amp; Start
                            </Link>
                        </Button>
                    </div>
                </div>
            </section>
        </div>
    );
}

// ============================================
// Authenticated Marketplace View
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

        if (isAuthenticated) {
            fetchData();
        } else {
            setIsLoading(false);
        }
    }, [view, vertical, country, region, isAuthenticated]);

    const hasFilters = vertical !== 'all' || country !== 'ALL' || region !== 'All';

    const clearFilters = () => {
        setVertical('all');
        setCountry('ALL');
        setRegion('All');
    };

    const marketplaceStats = [
        { label: 'Active Leads', value: '2,847', icon: Zap, color: 'text-primary' },
        { label: 'Avg. Bid', value: '$127', icon: TrendingUp, color: 'text-emerald-500' },
        { label: 'Countries', value: '20+', icon: Globe, color: 'text-chainlink-steel' },
    ];

    // ─── Signed-out: show landing page ─────────
    if (!isAuthenticated) {
        return <LandingHero />;
    }

    // ─── Signed-in: show marketplace ───────────
    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Hero — marketplace-view (no redundant "Marketplace" label) */}
                <section className="text-center pt-4 pb-2">
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4">
                        <span className="gradient-text">Live Marketplace</span>
                    </h1>
                    <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto mb-6">
                        Browse live auctions and asks from verified sellers across all verticals
                    </p>

                    {/* Stats */}
                    <div className="flex flex-wrap justify-center gap-4 sm:gap-6 mb-4">
                        {marketplaceStats.map((stat) => (
                            <GlassCard key={stat.label} className="px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
                                <stat.icon className={`h-5 w-5 ${stat.color}`} />
                                <div className="text-left">
                                    <div className="text-xl sm:text-2xl font-bold">{stat.value}</div>
                                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                                </div>
                            </GlassCard>
                        ))}
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

                                {/* Vertical Filter */}
                                <Select value={vertical} onValueChange={setVertical}>
                                    <SelectTrigger className="w-full sm:w-44">
                                        <SelectValue placeholder="Vertical" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {VERTICALS.map((v) => (
                                            <SelectItem key={v} value={v} className="capitalize">
                                                {v === 'all' ? 'All Verticals' : v.replace(/_/g, ' ')}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
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
                                asks.map((ask) => <AskCard key={ask.id} ask={ask} />)
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
                                leads.map((lead) => <LeadCard key={lead.id} lead={lead} />)
                            )}
                        </div>
                    )}
                </section>
            </div>
        </DashboardLayout>
    );
}

export default HomePage;
