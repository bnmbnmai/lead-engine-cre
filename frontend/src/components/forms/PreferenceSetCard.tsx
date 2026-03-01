import { ArrowUp, ArrowDown, Trash2, Info, Shield, X, Filter, Loader2, MapPin, DollarSign, ChevronDown, BarChart3, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { LabeledSwitch } from '@/components/ui/switch';
import { GeoFilter } from '@/components/marketplace/GeoFilter';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import api from '@/lib/api';

// ============================================
// Types
// ============================================

export interface FieldFilter {
    op: '>=' | '<=' | '==' | 'includes';
    value: string;
}

export interface PreferenceSetData {
    id?: string;
    label: string;
    vertical: string;
    priority: number;
    geoCountries: string[];
    geoInclude: string[];
    geoExclude: string[];
    maxBidPerLead?: number;
    dailyBudget?: number;
    autoBidEnabled: boolean;
    autoBidAmount?: number;
    excludedSellerIds: string[];
    preferredSellerIds: string[];
    minSellerReputation?: number;
    requireVerifiedSeller: boolean;
    acceptOffSite: boolean;
    requireVerified: boolean;
    isActive: boolean;
    fieldFilters?: Record<string, FieldFilter>;
}


// ============================================
// Props
// ============================================

interface PreferenceSetCardProps {
    set: PreferenceSetData;
    index: number;
    total: number;
    verticalLabels: Record<string, string>;
    onChange: (updated: PreferenceSetData) => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDelete: () => void;
}

// ============================================
// Collapsible Section
// ============================================

function SectionGroup({
    icon,
    title,
    tooltip,
    badge,
    open,
    onToggle,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    tooltip?: string;
    badge?: React.ReactNode;
    open: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    const [showTooltip, setShowTooltip] = useState(false);

    return (
        <div className={cn(
            'rounded-xl border transition-all duration-200',
            open ? 'border-border bg-white/[0.02]' : 'border-border/50 hover:border-border'
        )}>
            <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-3 text-left"
                onClick={onToggle}
            >
                <div className="flex items-center gap-2.5">
                    <span className="text-muted-foreground">{icon}</span>
                    <h4 className="text-sm font-semibold">{title}</h4>
                    {badge}
                    {tooltip && (
                        <div className="relative">
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setShowTooltip(v => !v); }}
                                className="p-0.5 rounded-full hover:bg-muted transition-colors"
                            >
                                <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                            {showTooltip && (
                                <div className="absolute left-0 bottom-full mb-2 w-64 p-3 rounded-xl bg-popover border border-border shadow-lg text-xs text-muted-foreground z-50 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
                                    {tooltip}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
            </button>
            {open && (
                <div className="px-4 pb-4 pt-1 space-y-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                    {children}
                </div>
            )}
        </div>
    );
}

// ============================================
// Live Preview Panel
// ============================================

function LivePreview({ set }: { set: PreferenceSetData }) {
    const activeFilters: string[] = [];
    if (set.geoInclude.length > 0) activeFilters.push(`Geo: ${set.geoInclude.slice(0, 3).join(', ')}${set.geoInclude.length > 3 ? ` +${set.geoInclude.length - 3}` : ''}`);
    if (set.geoExclude.length > 0) activeFilters.push(`Excluding: ${set.geoExclude.slice(0, 2).join(', ')}${set.geoExclude.length > 2 ? ` +${set.geoExclude.length - 2}` : ''}`);
    if (set.maxBidPerLead) activeFilters.push(`Max bid: $${set.maxBidPerLead}`);
    if (set.dailyBudget) activeFilters.push(`Daily cap: $${set.dailyBudget}`);
    if (set.requireVerified) activeFilters.push('CRE verified only');
    if (set.requireVerifiedSeller) activeFilters.push('KYC sellers only');
    if (set.minSellerReputation && set.minSellerReputation > 0) activeFilters.push(`Rep ≥ ${(set.minSellerReputation / 100).toFixed(0)}%`);
    const fieldCount = Object.keys(set.fieldFilters || {}).length;
    if (fieldCount > 0) activeFilters.push(`${fieldCount} field filter${fieldCount > 1 ? 's' : ''}`);

    // Simulated match rate based on how restrictive the config is
    const restrictiveness = Math.min(activeFilters.length, 8);
    const matchPct = Math.max(12, 95 - restrictiveness * 10);

    return (
        <div className="rounded-xl border border-blue-500/15 bg-blue-500/[0.04] p-4 space-y-3">
            <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-blue-400" />
                <h4 className="text-sm font-semibold">Rule Preview</h4>
            </div>

            <div className="flex items-center gap-3">
                <div className="text-2xl font-bold text-blue-400">~{matchPct}%</div>
                <div className="text-xs text-muted-foreground">
                    of recent {set.vertical.replace(/[._]/g, ' ')} leads would match these rules
                </div>
            </div>

            {activeFilters.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                    {activeFilters.map((f, i) => (
                        <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-blue-500/10 text-blue-300 border border-blue-500/15">
                            {f}
                        </span>
                    ))}
                </div>
            ) : (
                <p className="text-xs text-muted-foreground">No filters set — all leads in this vertical will match</p>
            )}

            {/* Sample lead cards */}
            <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Sample matching leads</p>
                {[
                    { id: '#4821', geo: set.geoInclude[0] || 'CA', score: 82, age: '2h ago' },
                    { id: '#4819', geo: set.geoInclude[1] || 'TX', score: 74, age: '5h ago' },
                ].map((lead) => (
                    <div key={lead.id} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.03] border border-border/50 text-xs">
                        <div className="flex items-center gap-2">
                            <span className="font-mono text-muted-foreground">{lead.id}</span>
                            <span className="text-blue-300">{lead.geo}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-emerald-400">Q{lead.score}</span>
                            <span className="text-muted-foreground">{lead.age}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ============================================
// Component
// ============================================

export function PreferenceSetCard({
    set,
    index,
    total,
    verticalLabels,
    onChange,
    onMoveUp,
    onMoveDown,
    onDelete,
}: PreferenceSetCardProps) {
    const [verticalFields, setVerticalFields] = useState<any[]>([]);
    const [loadingFields, setLoadingFields] = useState(false);
    const [activeSection, setActiveSection] = useState<string | null>('geo');

    const toggleSection = (id: string) => setActiveSection(prev => prev === id ? null : id);

    // Fetch vertical-specific form fields when vertical changes
    useEffect(() => {
        if (!set.vertical) { setVerticalFields([]); return; }
        let cancelled = false;
        (async () => {
            setLoadingFields(true);
            try {
                const { data } = await api.getFormConfig(set.vertical);
                if (!cancelled && data?.formConfig?.fields) {
                    // Only show filterable fields (select/number), exclude contact fields
                    const CONTACT_KEYS = new Set(['fullName', 'email', 'phone', 'zip', 'state', 'country']);
                    const filterable = data.formConfig.fields.filter(
                        (f: any) => !CONTACT_KEYS.has(f.key) && (f.type === 'select' || f.type === 'number' || f.type === 'boolean')
                    );
                    setVerticalFields(filterable);
                }
            } catch {
                // Fail silently — fields just won't appear
            } finally {
                if (!cancelled) setLoadingFields(false);
            }
        })();
        return () => { cancelled = true; };
    }, [set.vertical]);

    const BUDGET_MAX = 99999999.99;

    const update = (patch: Partial<PreferenceSetData>) => {
        // Client-side sanitisation for budget fields
        for (const key of ['maxBidPerLead', 'dailyBudget', 'autoBidAmount'] as const) {
            if (key in patch && patch[key] !== undefined) {
                const v = patch[key]!;
                if (v > BUDGET_MAX) {
                    (patch as any)[key] = BUDGET_MAX;
                    console.warn(`[PreferenceSetCard] ${key} clamped to ${BUDGET_MAX}`);
                }
            }
        }
        // Sanitise geo arrays: remove non-alpha entries
        for (const key of ['geoInclude', 'geoExclude'] as const) {
            if (key in patch && Array.isArray(patch[key])) {
                (patch as any)[key] = [...new Set((patch[key] as string[]).filter(s => /^[A-Za-z]{1,4}$/.test(s)))];
            }
        }
        onChange({ ...set, ...patch });
    };

    return (
        <div className="space-y-4">
            {/* Header controls — label, priority arrows, delete */}
            <div className="flex items-center gap-3">
                <div className="flex-1">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Set Label
                    </label>
                    <Input
                        value={set.label}
                        onChange={(e) => update({ label: e.target.value })}
                        placeholder={`${verticalLabels[set.vertical] || set.vertical} — Region`}
                        className="font-medium"
                    />
                </div>

                <div className="flex items-center gap-1 mt-5">
                    <span
                        className={cn(
                            'inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold',
                            set.isActive
                                ? 'bg-primary/10 text-primary'
                                : 'bg-muted text-muted-foreground'
                        )}
                    >
                        {verticalLabels[set.vertical] || set.vertical}
                    </span>

                    <button
                        type="button"
                        onClick={onMoveUp}
                        disabled={index === 0}
                        className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"
                        title="Increase priority"
                    >
                        <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={onMoveDown}
                        disabled={index === total - 1}
                        className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"
                        title="Decrease priority"
                    >
                        <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={onDelete}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors"
                        title="Delete this preference set"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {/* Active toggle */}
            <LabeledSwitch
                label="Active"
                description="When disabled, this preference set is ignored during matching and auto-bidding."
                checked={set.isActive}
                onCheckedChange={(checked) => update({ isActive: checked })}
            />

            {/* ── Two-column layout: Sections + Preview ── */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
                {/* Left: Grouped config sections */}
                <div className="space-y-3">
                    {/* ── Section 1: Vertical & Geo ── */}
                    <SectionGroup
                        icon={<MapPin className="h-4 w-4" />}
                        title="Geographic Targeting"
                        tooltip="Target leads by state/region. Include narrows to specific areas; Exclude removes regions even if they match other rules."
                        badge={set.geoInclude.length > 0 ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                                {set.geoInclude.length} region{set.geoInclude.length > 1 ? 's' : ''}
                            </span>
                        ) : undefined}
                        open={activeSection === 'geo'}
                        onToggle={() => toggleSection('geo')}
                    >
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-2 block">
                                Include Regions
                            </label>
                            <GeoFilter
                                country={set.geoCountries[0] || 'US'}
                                onCountryChange={() => { }}
                                selectedRegions={set.geoInclude}
                                onRegionsChange={(geoInclude) => update({ geoInclude })}
                                mode="include"
                                multiCountry
                                countries={set.geoCountries}
                                onCountriesChange={(geoCountries) =>
                                    update({ geoCountries, geoInclude: [], geoExclude: [] })
                                }
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-2 block">
                                Exclude Regions
                            </label>
                            <GeoFilter
                                country={set.geoCountries[0] || 'US'}
                                onCountryChange={() => { }}
                                selectedRegions={set.geoExclude}
                                onRegionsChange={(geoExclude) => update({ geoExclude })}
                                mode="exclude"
                                showCountrySelector={false}
                                multiCountry
                                countries={set.geoCountries}
                            />
                        </div>
                    </SectionGroup>

                    {/* ── Section 2: Budget & Timing ── */}
                    <SectionGroup
                        icon={<DollarSign className="h-4 w-4" />}
                        title="Budget & Bidding"
                        tooltip="Control spend per lead and per day. Daily budget resets at midnight UTC. The auto-bid amount is the fixed bid placed on each matching lead."
                        badge={set.autoBidEnabled ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                                ⚡ Auto
                            </span>
                        ) : undefined}
                        open={activeSection === 'budget'}
                        onToggle={() => toggleSection('budget')}
                    >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                    Max Bid Per Lead (USDC)
                                </label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    max={BUDGET_MAX}
                                    placeholder="150.00"
                                    value={set.maxBidPerLead || ''}
                                    onChange={(e) =>
                                        update({ maxBidPerLead: parseFloat(e.target.value) || undefined })
                                    }
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Leave empty for no limit
                                </p>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                    Daily Budget (USDC)
                                </label>
                                <Input
                                    type="number"
                                    step="1"
                                    max={BUDGET_MAX}
                                    placeholder="2000"
                                    value={set.dailyBudget || ''}
                                    onChange={(e) =>
                                        update({ dailyBudget: parseFloat(e.target.value) || undefined })
                                    }
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Resets daily at midnight UTC
                                </p>
                            </div>
                        </div>

                        {/* Auto-Bid (nested) */}
                        <div className="mt-2 p-3 rounded-lg border border-amber-500/10 bg-amber-500/[0.03]">
                            <LabeledSwitch
                                label="Enable Auto-Bid"
                                description="Automatically bid on matching leads 24/7."
                                checked={set.autoBidEnabled}
                                onCheckedChange={(checked) => update({ autoBidEnabled: checked })}
                            />
                            {set.autoBidEnabled && (
                                <div className="mt-3 pl-4 border-l-2 border-amber-500/30">
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                        Auto-Bid Amount (USDC)
                                    </label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        max={BUDGET_MAX}
                                        placeholder="150.00"
                                        value={set.autoBidAmount || ''}
                                        onChange={(e) =>
                                            update({ autoBidAmount: parseFloat(e.target.value) || undefined })
                                        }
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Fixed bid placed on each matching lead.
                                        {set.maxBidPerLead
                                            ? ` Capped at your max of $${set.maxBidPerLead}.`
                                            : ' Set a max bid above to enforce a ceiling.'}
                                    </p>
                                    <p className="text-xs text-amber-400/80 mt-1">
                                        ⚡ A $1 convenience fee applies to each auto-bid win (covers gas &amp; platform costs).
                                    </p>
                                </div>
                            )}
                        </div>
                    </SectionGroup>

                    {/* ── Section 3: Quality & Seller Trust ── */}
                    <SectionGroup
                        icon={<Shield className="h-4 w-4" />}
                        title="Quality & Trust"
                        tooltip="Set CRE quality gates and seller trust requirements. Quality scores (0–100) are computed by the Chainlink DON via the Compliance Rules Engine."
                        badge={set.requireVerified ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                                Verified only
                            </span>
                        ) : undefined}
                        open={activeSection === 'quality'}
                        onToggle={() => toggleSection('quality')}
                    >
                        <LabeledSwitch
                            label="Require CRE-Verified Leads"
                            description="Only match leads that passed Compliance Rules Engine verification (TCPA, geo, dedup)."
                            checked={set.requireVerified}
                            onCheckedChange={(checked) => update({ requireVerified: checked })}
                        />
                        <LabeledSwitch
                            label="Accept Off-site Leads"
                            description="Receive leads from external landing pages and webhook integrations."
                            checked={set.acceptOffSite}
                            onCheckedChange={(checked) => update({ acceptOffSite: checked })}
                        />

                        <div className="border-t border-border/50 pt-3 mt-2">
                            <div className="flex items-center gap-2 mb-3">
                                <Users className="h-4 w-4 text-blue-400" />
                                <h5 className="text-xs font-semibold text-muted-foreground">Seller Trust</h5>
                            </div>

                            {/* Min Seller Reputation */}
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                    Minimum Seller Reputation — {((set.minSellerReputation ?? 0) / 100).toFixed(0)}%
                                </label>
                                <input
                                    type="range"
                                    min={0}
                                    max={10000}
                                    step={100}
                                    value={set.minSellerReputation ?? 0}
                                    onChange={(e) => update({ minSellerReputation: parseInt(e.target.value) || undefined })}
                                    className="w-full accent-primary"
                                />
                                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                                    <span>0%</span>
                                    <span>50%</span>
                                    <span>100%</span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    On-chain reputation score. Only bid on sellers above this threshold.
                                </p>
                            </div>

                            <div className="mt-3">
                                <LabeledSwitch
                                    label="Require KYC-Verified Seller"
                                    description="Only bid on leads from sellers who completed on-chain KYC verification."
                                    checked={set.requireVerifiedSeller}
                                    onCheckedChange={(checked) => update({ requireVerifiedSeller: checked })}
                                />
                            </div>

                            {/* Excluded Seller IDs */}
                            <div className="mt-3">
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                    Excluded Sellers
                                </label>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {set.excludedSellerIds.map((id) => (
                                        <span
                                            key={id}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-red-500/10 text-red-400 border border-red-500/20"
                                        >
                                            {id.slice(0, 8)}…
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    update({ excludedSellerIds: set.excludedSellerIds.filter((s) => s !== id) })
                                                }
                                                className="hover:text-red-300"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                                <Input
                                    placeholder="Paste seller ID and press Enter"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            const val = (e.target as HTMLInputElement).value.trim();
                                            if (val && !set.excludedSellerIds.includes(val)) {
                                                update({ excludedSellerIds: [...set.excludedSellerIds, val] });
                                                (e.target as HTMLInputElement).value = '';
                                            }
                                        }
                                    }}
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Never bid on leads from these sellers.
                                </p>
                            </div>

                            {/* Preferred Seller IDs */}
                            <div className="mt-3">
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                    Preferred Sellers
                                </label>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {set.preferredSellerIds.map((id) => (
                                        <span
                                            key={id}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                        >
                                            {id.slice(0, 8)}…
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    update({ preferredSellerIds: set.preferredSellerIds.filter((s) => s !== id) })
                                                }
                                                className="hover:text-emerald-300"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                                <Input
                                    placeholder="Paste seller ID and press Enter"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            const val = (e.target as HTMLInputElement).value.trim();
                                            if (val && !set.preferredSellerIds.includes(val)) {
                                                update({ preferredSellerIds: [...set.preferredSellerIds, val] });
                                                (e.target as HTMLInputElement).value = '';
                                            }
                                        }
                                    }}
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Prioritise bids on leads from these sellers.
                                </p>
                            </div>
                        </div>
                    </SectionGroup>

                    {/* ── Section 4: Field Filters ── */}
                    {(verticalFields.length > 0 || loadingFields) && (
                        <SectionGroup
                            icon={<Filter className="h-4 w-4 text-violet-500" />}
                            title="Field-Level Filters"
                            tooltip="Filter leads by vertical-specific fields (e.g., property type, loan amount, case type). Only leads matching ALL rules qualify for auto-bid."
                            badge={set.fieldFilters && Object.keys(set.fieldFilters).length > 0 ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-violet-500/15 text-violet-400 border border-violet-500/25">
                                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                                    {Object.keys(set.fieldFilters).length} active
                                </span>
                            ) : undefined}
                            open={activeSection === 'fields'}
                            onToggle={() => toggleSection('fields')}
                        >
                            {loadingFields ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Loading vertical filters…
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-3">
                                    {verticalFields.map((field: any) => {
                                        const currentFilter = set.fieldFilters?.[field.key];
                                        const isActive = !!currentFilter;

                                        // ── Select fields: multi-select chip cloud ──
                                        if (field.type === 'select' && field.options?.length) {
                                            const selectedValues: string[] = (() => {
                                                if (!currentFilter) return [];
                                                if (currentFilter.op === 'includes') {
                                                    try { return JSON.parse(currentFilter.value); } catch { return [currentFilter.value]; }
                                                }
                                                return [currentFilter.value];
                                            })();

                                            const toggleOption = (opt: string) => {
                                                const filters = { ...set.fieldFilters };
                                                let next: string[];
                                                if (selectedValues.includes(opt)) {
                                                    next = selectedValues.filter(v => v !== opt);
                                                } else {
                                                    next = [...selectedValues, opt];
                                                }
                                                if (next.length === 0) {
                                                    delete filters[field.key];
                                                } else if (next.length === 1) {
                                                    filters[field.key] = { op: '==', value: next[0] };
                                                } else {
                                                    filters[field.key] = { op: 'includes', value: JSON.stringify(next) };
                                                }
                                                update({ fieldFilters: filters });
                                            };

                                            return (
                                                <div key={field.id} className={cn(
                                                    'p-3 rounded-xl border transition-all duration-200',
                                                    isActive
                                                        ? 'border-violet-500/40 bg-gradient-to-br from-violet-500/5 to-violet-600/10 shadow-sm shadow-violet-500/5'
                                                        : 'border-border hover:border-muted-foreground/20'
                                                )}>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <label className="text-xs font-medium text-muted-foreground">
                                                            {field.label}
                                                        </label>
                                                        {isActive && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const filters = { ...set.fieldFilters };
                                                                    delete filters[field.key];
                                                                    update({ fieldFilters: filters });
                                                                }}
                                                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                                            >
                                                                Clear
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {field.options.map((opt: string) => {
                                                            const selected = selectedValues.includes(opt);
                                                            return (
                                                                <button
                                                                    key={opt}
                                                                    type="button"
                                                                    onClick={() => toggleOption(opt)}
                                                                    className={cn(
                                                                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150',
                                                                        selected
                                                                            ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40 shadow-sm'
                                                                            : 'bg-muted/50 text-muted-foreground border border-transparent hover:bg-muted hover:border-border'
                                                                    )}
                                                                >
                                                                    {selected && <span className="text-violet-400">✓</span>}
                                                                    {opt}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    {selectedValues.length > 1 && (
                                                        <p className="text-[10px] text-violet-400/70 mt-2">
                                                            Matches any of {selectedValues.length} selected values
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        }

                                        // ── Number fields: operator + input ──
                                        if (field.type === 'number') {
                                            return (
                                                <div key={field.id} className={cn(
                                                    'p-3 rounded-xl border transition-all duration-200',
                                                    isActive
                                                        ? 'border-violet-500/40 bg-gradient-to-br from-violet-500/5 to-violet-600/10 shadow-sm shadow-violet-500/5'
                                                        : 'border-border hover:border-muted-foreground/20'
                                                )}>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <label className="text-xs font-medium text-muted-foreground">
                                                            {field.label}
                                                        </label>
                                                        {isActive && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const filters = { ...set.fieldFilters };
                                                                    delete filters[field.key];
                                                                    update({ fieldFilters: filters });
                                                                }}
                                                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                                            >
                                                                Clear
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <select
                                                            className="w-[72px] h-9 rounded-lg border border-input bg-background px-2 text-sm font-mono"
                                                            value={currentFilter?.op || '>='}
                                                            onChange={(e) => {
                                                                const op = e.target.value as FieldFilter['op'];
                                                                const filters = { ...set.fieldFilters };
                                                                filters[field.key] = { op, value: currentFilter?.value || '' };
                                                                update({ fieldFilters: filters });
                                                            }}
                                                        >
                                                            <option value=">=">≥</option>
                                                            <option value="<=">≤</option>
                                                            <option value="==">＝</option>
                                                        </select>
                                                        <Input
                                                            type="number"
                                                            placeholder={field.placeholder || '0'}
                                                            className="flex-1"
                                                            value={currentFilter?.value || ''}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                const filters = { ...set.fieldFilters };
                                                                if (!val) {
                                                                    delete filters[field.key];
                                                                } else {
                                                                    filters[field.key] = { op: (currentFilter?.op || '>=') as FieldFilter['op'], value: val };
                                                                }
                                                                update({ fieldFilters: filters });
                                                            }}
                                                        />
                                                    </div>
                                                    {isActive && currentFilter?.value && (
                                                        <p className="text-[10px] text-violet-400/70 mt-1.5">
                                                            {currentFilter.op === '>=' && `Only leads with ${field.label.toLowerCase()} ≥ ${currentFilter.value}`}
                                                            {currentFilter.op === '<=' && `Only leads with ${field.label.toLowerCase()} ≤ ${currentFilter.value}`}
                                                            {currentFilter.op === '==' && `Only leads with ${field.label.toLowerCase()} exactly ${currentFilter.value}`}
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        }

                                        // ── Boolean fields: pretty toggle buttons ──
                                        if (field.type === 'boolean') {
                                            return (
                                                <div key={field.id} className={cn(
                                                    'p-3 rounded-xl border transition-all duration-200',
                                                    isActive
                                                        ? 'border-violet-500/40 bg-gradient-to-br from-violet-500/5 to-violet-600/10 shadow-sm shadow-violet-500/5'
                                                        : 'border-border hover:border-muted-foreground/20'
                                                )}>
                                                    <label className="text-xs font-medium text-muted-foreground mb-2 block">
                                                        {field.label}
                                                    </label>
                                                    <div className="flex gap-2">
                                                        {[
                                                            { label: 'Any', value: '' },
                                                            { label: 'Yes', value: 'true' },
                                                            { label: 'No', value: 'false' },
                                                        ].map(opt => (
                                                            <button
                                                                key={opt.value}
                                                                type="button"
                                                                onClick={() => {
                                                                    const filters = { ...set.fieldFilters };
                                                                    if (!opt.value) {
                                                                        delete filters[field.key];
                                                                    } else {
                                                                        filters[field.key] = { op: '==', value: opt.value };
                                                                    }
                                                                    update({ fieldFilters: filters });
                                                                }}
                                                                className={cn(
                                                                    'flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-150 border',
                                                                    (currentFilter?.value === opt.value) || (!currentFilter && !opt.value)
                                                                        ? 'bg-violet-500/20 text-violet-300 border-violet-500/40'
                                                                        : 'bg-muted/30 text-muted-foreground border-transparent hover:bg-muted hover:border-border'
                                                                )}
                                                            >
                                                                {opt.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        }

                                        return null;
                                    })}
                                </div>
                            )}
                        </SectionGroup>
                    )}
                </div>

                {/* Right: Live preview (desktop sidebar, mobile stacked below) */}
                <div className="lg:sticky lg:top-4 lg:self-start">
                    <LivePreview set={set} />
                </div>
            </div>
        </div>
    );
}

export default PreferenceSetCard;
