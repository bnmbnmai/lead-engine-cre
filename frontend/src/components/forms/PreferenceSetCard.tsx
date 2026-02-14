import { ArrowUp, ArrowDown, Trash2, Zap, Info, Shield, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { LabeledSwitch } from '@/components/ui/switch';
import { GeoFilter } from '@/components/marketplace/GeoFilter';
import { cn } from '@/lib/utils';
import { useState } from 'react';

// ============================================
// Types
// ============================================

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
    const [showAutoBidTip, setShowAutoBidTip] = useState(false);

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
        <div className="space-y-6">
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

            {/* Geo Filters */}
            <div className="space-y-4">
                <h4 className="text-sm font-semibold">Geographic Targeting</h4>
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
            </div>

            {/* Budget */}
            <div className="space-y-4">
                <h4 className="text-sm font-semibold">Budget</h4>
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
            </div>

            {/* Auto-Bid */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold flex items-center gap-1.5">
                        <Zap className="h-4 w-4 text-amber-500" />
                        Auto-Bidding
                    </h4>
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setShowAutoBidTip((v) => !v)}
                            className="p-1 rounded-full hover:bg-muted transition-colors"
                        >
                            <Info className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        {showAutoBidTip && (
                            <div className="absolute left-0 bottom-full mb-2 w-72 p-3 rounded-xl bg-popover border border-border shadow-lg text-xs text-muted-foreground z-50 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
                                <strong className="text-foreground">For manual marketplace users.</strong>{' '}
                                If you're buying programmatically via the API or through an agent,
                                use the sealed bid endpoint instead — auto-bid is optimized for
                                manual buyers who want hands-free bidding on matching leads.
                            </div>
                        )}
                    </div>
                </div>

                <LabeledSwitch
                    label="Enable Auto-Bid for this vertical"
                    description="Automatically place bids on leads matching this set's vertical, geo, and budget filters."
                    checked={set.autoBidEnabled}
                    onCheckedChange={(checked) => update({ autoBidEnabled: checked })}
                />

                {set.autoBidEnabled && (
                    <div className="pl-4 border-l-2 border-amber-500/30">
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
                    </div>
                )}
            </div>

            {/* Seller Targeting */}
            <div className="space-y-4">
                <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <Shield className="h-4 w-4 text-blue-500" />
                    Seller Targeting
                </h4>

                {/* Excluded Seller IDs */}
                <div>
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
                        Never bid on leads from these sellers. Paste seller profile IDs.
                    </p>
                </div>

                {/* Preferred Seller IDs */}
                <div>
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

                {/* Min Seller Reputation */}
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        Minimum Seller Reputation — {((set.minSellerReputation ?? 0) / 100).toFixed(1)}%
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
                        On-chain reputation score (0–10,000 basis points). Only bid on sellers with score ≥ this threshold.
                    </p>
                </div>

                {/* Require Verified Seller */}
                <LabeledSwitch
                    label="Require Verified Seller"
                    description="Only bid on leads from sellers who completed KYC verification on-chain."
                    checked={set.requireVerifiedSeller}
                    onCheckedChange={(checked) => update({ requireVerifiedSeller: checked })}
                />
            </div>

            {/* Toggles */}
            <div className="space-y-3">
                <h4 className="text-sm font-semibold">Lead Quality</h4>
                <LabeledSwitch
                    label="Accept Off-site Leads"
                    description="Receive leads from external landing pages and webhook integrations."
                    checked={set.acceptOffSite}
                    onCheckedChange={(checked) => update({ acceptOffSite: checked })}
                />
                <LabeledSwitch
                    label="Require Verified Leads Only"
                    description="Only match leads that passed CRE verification (TCPA, geo, dedup)."
                    checked={set.requireVerified}
                    onCheckedChange={(checked) => update({ requireVerified: checked })}
                />
            </div>
        </div>
    );
}

export default PreferenceSetCard;
