import { useState, useEffect } from 'react';
import { Settings, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LabeledSwitch } from '@/components/ui/switch';
import { GeoFilter } from '@/components/marketplace/GeoFilter';
import api from '@/lib/api';

const VERTICALS = [
    { value: 'solar', label: 'Solar' },
    { value: 'mortgage', label: 'Mortgage' },
    { value: 'roofing', label: 'Roofing' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'home_services', label: 'Home Services' },
    { value: 'b2b_saas', label: 'B2B SaaS' },
    { value: 'real_estate', label: 'Real Estate' },
    { value: 'auto', label: 'Auto' },
    { value: 'legal', label: 'Legal' },
    { value: 'financial', label: 'Financial' },
];

interface PreferencesFormProps {
    onSuccess?: () => void;
}

export function PreferencesForm({ onSuccess }: PreferencesFormProps) {
    const [_isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [preferences, setPreferences] = useState({
        verticals: [] as string[],
        geoFilters: {
            country: 'US',
            states: [] as string[],
            excludeStates: [] as string[],
        },
        acceptOffSite: true,
        requireVerified: false,
        maxBudgetPerLead: 0,
        dailyBudget: 0,
        autoBid: false,
    });

    // Load existing preferences
    useEffect(() => {
        // In real app, fetch from API
        setIsLoading(false);
    }, []);

    const toggleVertical = (vertical: string) => {
        setPreferences((prev) => ({
            ...prev,
            verticals: prev.verticals.includes(vertical)
                ? prev.verticals.filter((v) => v !== vertical)
                : [...prev.verticals, vertical],
        }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);

        try {
            const { error: apiError } = await api.updatePreferences(preferences);
            if (apiError) {
                setError(apiError.error);
                return;
            }
            onSuccess?.();
        } catch (err) {
            setError('Failed to save preferences');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Verticals */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Settings className="h-5 w-5" />
                        Preferred Verticals
                    </CardTitle>
                    <CardDescription>Select the lead types you want to bid on</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                        {VERTICALS.map((v) => {
                            const isSelected = preferences.verticals.includes(v.value);
                            return (
                                <button
                                    key={v.value}
                                    type="button"
                                    onClick={() => toggleVertical(v.value)}
                                    className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${isSelected
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted hover:bg-muted/80'
                                        }`}
                                >
                                    {v.label}
                                </button>
                            );
                        })}
                    </div>
                    {preferences.verticals.length === 0 && (
                        <p className="text-sm text-muted-foreground mt-3">All verticals (no filter)</p>
                    )}
                </CardContent>
            </Card>

            {/* Geographic Filters */}
            <Card>
                <CardHeader>
                    <CardTitle>Geographic Filters</CardTitle>
                    <CardDescription>Target or exclude regions across any supported country</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div>
                        <label className="text-sm font-medium mb-3 block">Include Regions</label>
                        <GeoFilter
                            country={preferences.geoFilters.country}
                            onCountryChange={(country) =>
                                setPreferences((prev) => ({
                                    ...prev,
                                    geoFilters: { ...prev.geoFilters, country, states: [], excludeStates: [] },
                                }))
                            }
                            selectedRegions={preferences.geoFilters.states}
                            onRegionsChange={(states) =>
                                setPreferences((prev) => ({
                                    ...prev,
                                    geoFilters: { ...prev.geoFilters, states },
                                }))
                            }
                            mode="include"
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-3 block">Exclude Regions</label>
                        <GeoFilter
                            country={preferences.geoFilters.country}
                            onCountryChange={() => { }}
                            selectedRegions={preferences.geoFilters.excludeStates}
                            onRegionsChange={(excludeStates) =>
                                setPreferences((prev) => ({
                                    ...prev,
                                    geoFilters: { ...prev.geoFilters, excludeStates },
                                }))
                            }
                            mode="exclude"
                            showCountrySelector={false}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Toggle Preferences */}
            <Card>
                <CardHeader>
                    <CardTitle>Lead Preferences</CardTitle>
                    <CardDescription>Configure what leads you'll receive</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <LabeledSwitch
                        label="Accept Off-site Leads"
                        description="Receive leads captured from external landing pages, partner sites, and webhook integrations. Off-site leads may have different quality profiles than platform-generated leads, but expand your supply volume significantly."
                        checked={preferences.acceptOffSite}
                        onCheckedChange={(checked) =>
                            setPreferences((prev) => ({ ...prev, acceptOffSite: checked }))
                        }
                    />

                    <LabeledSwitch
                        label="Require Verified Leads Only"
                        description="Only show leads that have passed CRE (Compliance & Risk Engine) verification — including TCPA consent validation, geo accuracy checks, and duplicate detection. Reduces volume but increases lead quality and protects against fraud."
                        checked={preferences.requireVerified}
                        onCheckedChange={(checked) =>
                            setPreferences((prev) => ({ ...prev, requireVerified: checked }))
                        }
                    />

                    <LabeledSwitch
                        label="Enable Auto-Bidding"
                        description="Automatically place bids on leads matching your vertical, geo, and budget filters. Bids are placed at your max-per-lead limit. Ideal for high-volume buyers who want to compete in real-time auctions without manual intervention — but be sure to set budget caps below."
                        checked={preferences.autoBid}
                        onCheckedChange={(checked) =>
                            setPreferences((prev) => ({ ...prev, autoBid: checked }))
                        }
                    />
                </CardContent>
            </Card>

            {/* Budget Settings */}
            <Card>
                <CardHeader>
                    <CardTitle>Budget Settings</CardTitle>
                    <CardDescription>
                        Set spending limits to control costs. Budgets are enforced in USDC and reset daily at midnight UTC.
                        When auto-bidding is enabled, these limits prevent runaway spending.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <label className="text-sm font-medium mb-2 block">Max Bid Per Lead (USDC)</label>
                        <Input
                            type="number"
                            step="0.01"
                            placeholder="100.00"
                            value={preferences.maxBudgetPerLead || ''}
                            onChange={(e) =>
                                setPreferences((prev) => ({
                                    ...prev,
                                    maxBudgetPerLead: parseFloat(e.target.value) || 0,
                                }))
                            }
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                            Leave at 0 for no limit
                        </p>
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-2 block">Daily Budget (USDC)</label>
                        <Input
                            type="number"
                            step="1"
                            placeholder="1000"
                            value={preferences.dailyBudget || ''}
                            onChange={(e) =>
                                setPreferences((prev) => ({
                                    ...prev,
                                    dailyBudget: parseFloat(e.target.value) || 0,
                                }))
                            }
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                            Maximum daily spend, leave at 0 for no limit
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Error */}
            {error && (
                <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                    {error}
                </div>
            )}

            {/* Save Button */}
            <Button onClick={handleSave} loading={isSaving} size="lg" className="w-full">
                <Save className="h-4 w-4 mr-2" />
                Save Preferences
            </Button>
        </div>
    );
}

export default PreferencesForm;
