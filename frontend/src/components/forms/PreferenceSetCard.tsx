import { ArrowUp, ArrowDown, Trash2, Zap, Info } from 'lucide-react';
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
    geoCountry: string;
    geoInclude: string[];
    geoExclude: string[];
    maxBidPerLead?: number;
    dailyBudget?: number;
    autoBidEnabled: boolean;
    autoBidAmount?: number;
    acceptOffSite: boolean;
    requireVerified: boolean;
    isActive: boolean;
}

const VERTICAL_LABELS: Record<string, string> = {
    solar: 'Solar',
    mortgage: 'Mortgage',
    roofing: 'Roofing',
    insurance: 'Insurance',
    home_services: 'Home Services',
    b2b_saas: 'B2B SaaS',
    real_estate: 'Real Estate',
    auto: 'Auto',
    legal: 'Legal',
    financial: 'Financial',
};

// ============================================
// Props
// ============================================

interface PreferenceSetCardProps {
    set: PreferenceSetData;
    index: number;
    total: number;
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
    onChange,
    onMoveUp,
    onMoveDown,
    onDelete,
}: PreferenceSetCardProps) {
    const [showAutoBidTip, setShowAutoBidTip] = useState(false);

    const update = (patch: Partial<PreferenceSetData>) => {
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
                        placeholder={`${VERTICAL_LABELS[set.vertical] || set.vertical} — Region`}
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
                        {VERTICAL_LABELS[set.vertical] || set.vertical}
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
                        country={set.geoCountry}
                        onCountryChange={(country) =>
                            update({ geoCountry: country, geoInclude: [], geoExclude: [] })
                        }
                        selectedRegions={set.geoInclude}
                        onRegionsChange={(geoInclude) => update({ geoInclude })}
                        mode="include"
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">
                        Exclude Regions
                    </label>
                    <GeoFilter
                        country={set.geoCountry}
                        onCountryChange={() => { }}
                        selectedRegions={set.geoExclude}
                        onRegionsChange={(geoExclude) => update({ geoExclude })}
                        mode="exclude"
                        showCountrySelector={false}
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
                                use the direct bid endpoint instead — auto-bid is optimized for
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
