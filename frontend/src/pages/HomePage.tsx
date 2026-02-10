import { useState, useEffect } from 'react';
import { Search, MapPin, TrendingUp, Zap, X } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AskCard } from '@/components/marketplace/AskCard';
import { LeadCard } from '@/components/marketplace/LeadCard';
import { GlassCard } from '@/components/ui/card';
import { SkeletonCard } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import api from '@/lib/api';
import useAuth from '@/hooks/useAuth';

const VERTICALS = ['all', 'solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'b2b_saas', 'real_estate'];
const STATES = ['All', 'CA', 'TX', 'FL', 'NY', 'AZ', 'NV', 'CO', 'WA', 'OR', 'GA'];

export function HomePage() {
    const [view, setView] = useState<'asks' | 'leads'>('leads');
    const [vertical, setVertical] = useState('all');
    const [state, setState] = useState('All');
    const [search, setSearch] = useState('');
    const [asks, setAsks] = useState<any[]>([]);
    const [leads, setLeads] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { isAuthenticated } = useAuth();

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const params: Record<string, string> = {};
                if (vertical !== 'all') params.vertical = vertical;
                if (state !== 'All') params.state = state;

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
    }, [view, vertical, state, isAuthenticated]);

    const hasFilters = vertical !== 'all' || state !== 'All';

    const clearFilters = () => {
        setVertical('all');
        setState('All');
    };

    const stats = [
        { label: 'Active Leads', value: '2,847', icon: Zap, color: 'text-primary' },
        { label: 'Avg. Bid', value: '$127', icon: TrendingUp, color: 'text-emerald-500' },
        { label: 'States', value: '48', icon: MapPin, color: 'text-chainlink-steel' },
    ];

    return (
        <div className="min-h-screen bg-background node-grid">
            <Navbar />

            <main className="pt-20 pb-12">
                <div className="container mx-auto px-6">
                    {/* Hero */}
                    <section className="py-12 text-center">
                        <h1 className="text-4xl md:text-5xl font-bold mb-4">
                            <span className="gradient-text">Marketplace</span>
                        </h1>
                        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
                            Browse live auctions and asks from verified sellers across all verticals
                        </p>

                        {/* Stats */}
                        <div className="flex justify-center gap-6 mb-8">
                            {stats.map((stat) => (
                                <GlassCard key={stat.label} className="px-6 py-4 flex items-center gap-3">
                                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                                    <div className="text-left">
                                        <div className="text-2xl font-bold">{stat.value}</div>
                                        <div className="text-xs text-muted-foreground">{stat.label}</div>
                                    </div>
                                </GlassCard>
                            ))}
                        </div>
                    </section>

                    {/* Filters */}
                    <section className="mb-8">
                        <div className="glass rounded-xl p-6">
                            <div className="flex flex-col md:flex-row gap-4">
                                {/* View Toggle */}
                                <div className="flex gap-1 p-1 rounded-lg bg-muted">
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

                                {/* Vertical Filter */}
                                <Select value={vertical} onValueChange={setVertical}>
                                    <SelectTrigger className="w-40">
                                        <SelectValue placeholder="Vertical" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {VERTICALS.map((v) => (
                                            <SelectItem key={v} value={v} className="capitalize">
                                                {v === 'all' ? 'All Verticals' : v.replace('_', ' ')}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {/* State Filter */}
                                <Select value={state} onValueChange={setState}>
                                    <SelectTrigger className="w-32">
                                        <SelectValue placeholder="State" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {STATES.map((s) => (
                                            <SelectItem key={s} value={s}>
                                                {s === 'All' ? 'All States' : s}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Active Filters */}
                            {hasFilters && (
                                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
                                    <span className="text-sm text-muted-foreground">Filters:</span>
                                    {vertical !== 'all' && (
                                        <Badge variant="secondary" className="gap-1 capitalize">
                                            {vertical.replace('_', ' ')}
                                            <button onClick={() => setVertical('all')}>
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    )}
                                    {state !== 'All' && (
                                        <Badge variant="secondary" className="gap-1">
                                            {state}
                                            <button onClick={() => setState('All')}>
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
                        {!isAuthenticated ? (
                            <EmptyState
                                icon={Zap}
                                title="Connect to browse the marketplace"
                                description="Connect your wallet to view live leads, place bids, and manage your pipeline."
                            />
                        ) : isLoading ? (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {[1, 2, 3, 4, 5, 6].map((i) => (
                                    <SkeletonCard key={i} />
                                ))}
                            </div>
                        ) : view === 'asks' ? (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {asks.length === 0 ? (
                                    <EmptyState
                                        icon={Search}
                                        title="No asks match your filters"
                                        description="Try broadening your search or adjusting vertical and state filters."
                                        action={hasFilters ? { label: 'Clear Filters', onClick: clearFilters } : undefined}
                                    />
                                ) : (
                                    asks.map((ask) => <AskCard key={ask.id} ask={ask} />)
                                )}
                            </div>
                        ) : (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
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
            </main>
        </div>
    );
}

export default HomePage;
