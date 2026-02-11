import { useState, useEffect } from 'react';
import { Save, Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    Accordion,
    AccordionItem,
    AccordionTrigger,
    AccordionContent,
} from '@/components/ui/accordion';
import { PreferenceSetCard, type PreferenceSetData } from './PreferenceSetCard';
import { ConflictModal } from '@/components/preferences/ConflictModal';
import api from '@/lib/api';

// ============================================
// Verticals
// ============================================

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

const VERTICAL_LABELS: Record<string, string> = Object.fromEntries(
    VERTICALS.map((v) => [v.value, v.label])
);

// ============================================
// Defaults
// ============================================

function createDefaultSet(vertical: string, priority: number): PreferenceSetData {
    return {
        label: `${VERTICAL_LABELS[vertical] || vertical} — US`,
        vertical,
        priority,
        geoCountry: 'US',
        geoInclude: [],
        geoExclude: [],
        maxBidPerLead: undefined,
        dailyBudget: undefined,
        autoBidEnabled: false,
        autoBidAmount: undefined,
        excludedSellerIds: [],
        preferredSellerIds: [],
        minSellerReputation: undefined,
        requireVerifiedSeller: false,
        acceptOffSite: true,
        requireVerified: false,
        isActive: true,
    };
}

// ============================================
// Component
// ============================================

interface PreferencesFormProps {
    onSuccess?: () => void;
}

export function PreferencesForm({ onSuccess }: PreferencesFormProps) {
    const [sets, setSets] = useState<PreferenceSetData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showVerticalPicker, setShowVerticalPicker] = useState(false);
    const [conflictModalOpen, setConflictModalOpen] = useState(false);
    const [serverSets, setServerSets] = useState<PreferenceSetData[]>([]);

    // Load existing preference sets
    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.getPreferenceSets();
                if (data?.sets && data.sets.length > 0) {
                    setSets(data.sets);
                }
            } catch {
                // If v2 endpoint not available, start fresh
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    // ── Handlers ──

    const addSet = (vertical: string) => {
        setSets((prev) => [...prev, createDefaultSet(vertical, prev.length)]);
        setShowVerticalPicker(false);
    };

    const updateSet = (index: number, updated: PreferenceSetData) => {
        setSets((prev) => prev.map((s, i) => (i === index ? updated : s)));
    };

    const deleteSet = (index: number) => {
        setSets((prev) => {
            const next = prev.filter((_, i) => i !== index);
            // Re-index priorities
            return next.map((s, i) => ({ ...s, priority: i }));
        });
    };

    const moveSet = (from: number, to: number) => {
        setSets((prev) => {
            const next = [...prev];
            const [item] = next.splice(from, 1);
            next.splice(to, 0, item);
            return next.map((s, i) => ({ ...s, priority: i }));
        });
    };

    const handleSave = async () => {
        if (sets.length === 0) {
            setError('Add at least one preference set');
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            console.info('[PreferencesForm] Saving', sets.length, 'preference sets');
            const res = await api.updatePreferenceSets({
                preferenceSets: sets,
            });

            if (res.error) {
                const { error: apiErr, code, status } = res.error as any;

                // 409 — stale record, show conflict modal
                if (status === 409 || code === 'STALE_RECORD' || code === 'DUPLICATE') {
                    console.warn('[PreferencesForm] Conflict detected, showing modal:', code);
                    try {
                        const { data } = await api.getPreferenceSets();
                        if (data?.sets) {
                            setServerSets(data.sets);
                            setConflictModalOpen(true);
                        }
                    } catch {
                        setError('Failed to fetch server version. Please refresh the page.');
                    }
                    return;
                }

                // 401 — auth expired
                if (status === 401) {
                    setError('Session expired — please reconnect your wallet');
                    return;
                }

                // Other server errors
                setError(apiErr ?? 'Failed to save preferences');
                return;
            }
            onSuccess?.();
        } catch (err: any) {
            console.error('[PreferencesForm] Save failed:', err);

            // Axios-style error with response
            if (err?.response?.status === 409) {
                try {
                    const { data } = await api.getPreferenceSets();
                    if (data?.sets) {
                        setServerSets(data.sets);
                        setConflictModalOpen(true);
                    }
                } catch {
                    setError('Failed to fetch server version. Please refresh the page.');
                }
                return;
            }
            if (err?.response?.status === 401) {
                setError('Session expired — please reconnect your wallet');
                return;
            }

            setError(err?.response?.data?.error ?? 'Failed to save preferences');
        } finally {
            setIsSaving(false);
        }
    };

    // ── Overlap warning ──

    const overlapWarnings: string[] = [];
    const verticalCounts = sets.reduce<Record<string, number>>((acc, s) => {
        if (s.isActive) acc[s.vertical] = (acc[s.vertical] || 0) + 1;
        return acc;
    }, {});
    for (const [v, count] of Object.entries(verticalCounts)) {
        if (count > 1) {
            overlapWarnings.push(
                `${VERTICAL_LABELS[v] || v} has ${count} active sets — highest priority wins when a lead matches multiple.`
            );
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Overview */}
            <Card>
                <CardHeader>
                    <CardTitle>Preference Sets</CardTitle>
                    <CardDescription>
                        Create one set per vertical / geo combination. Enable auto-bid to place bids automatically
                        when matching leads appear. Each set has its own budget cap, quality gate (0–10,000), and geo
                        targeting. Sets are matched in priority order (top = highest).
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {sets.length === 0 ? (
                        <div className="text-center py-8 space-y-3">
                            <p className="text-muted-foreground text-sm">
                                No preference sets yet. Add your first vertical to get started.
                            </p>
                            <div className="flex flex-wrap justify-center gap-2">
                                {VERTICALS.map((v) => (
                                    <Button
                                        key={v.value}
                                        variant="outline"
                                        size="sm"
                                        onClick={() => addSet(v.value)}
                                    >
                                        <Plus className="h-3.5 w-3.5 mr-1" />
                                        {v.label}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <Accordion defaultOpen={sets.length === 1 ? [sets[0].id || '0'] : []}>
                            {sets.map((set, i) => {
                                const itemId = set.id || String(i);
                                return (
                                    <AccordionItem key={itemId} id={itemId}>
                                        <AccordionTrigger id={itemId}>
                                            <div className="flex items-center gap-3">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-primary/10 text-primary">
                                                    #{i + 1}
                                                </span>
                                                <span className="font-medium text-sm">
                                                    {set.label || `${VERTICAL_LABELS[set.vertical]} set`}
                                                </span>
                                                {!set.isActive && (
                                                    <span className="text-xs text-muted-foreground italic">
                                                        paused
                                                    </span>
                                                )}
                                                {set.autoBidEnabled && (
                                                    <span className="text-xs text-amber-500 font-medium">
                                                        ⚡ Auto-bid
                                                    </span>
                                                )}
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent id={itemId}>
                                            <PreferenceSetCard
                                                set={set}
                                                index={i}
                                                total={sets.length}
                                                onChange={(updated) => updateSet(i, updated)}
                                                onMoveUp={() => moveSet(i, i - 1)}
                                                onMoveDown={() => moveSet(i, i + 1)}
                                                onDelete={() => deleteSet(i)}
                                            />
                                        </AccordionContent>
                                    </AccordionItem>
                                );
                            })}
                        </Accordion>
                    )}
                </CardContent>
            </Card>

            {/* Add Preference Set */}
            {sets.length > 0 && (
                <div className="relative">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowVerticalPicker((v) => !v)}
                        className="w-full border-dashed"
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Preference Set
                    </Button>

                    {showVerticalPicker && (
                        <div className="absolute top-full left-0 right-0 mt-2 p-3 rounded-xl bg-popover border border-border shadow-lg z-50 animate-in fade-in-0 slide-in-from-top-2 duration-200">
                            <p className="text-xs font-medium text-muted-foreground mb-2">
                                Select a vertical:
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                                {VERTICALS.map((v) => (
                                    <button
                                        key={v.value}
                                        type="button"
                                        onClick={() => addSet(v.value)}
                                        className="px-3 py-2 rounded-lg text-xs font-medium bg-muted hover:bg-primary hover:text-primary-foreground transition-colors"
                                    >
                                        {v.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Overlap Warnings */}
            {overlapWarnings.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm space-y-1">
                    <div className="flex items-center gap-2 font-medium">
                        <AlertTriangle className="h-4 w-4" />
                        Overlap detected
                    </div>
                    {overlapWarnings.map((w, i) => (
                        <p key={i} className="text-xs ml-6">{w}</p>
                    ))}
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                    {error}
                </div>
            )}

            {/* Save */}
            <Button
                onClick={handleSave}
                loading={isSaving}
                disabled={sets.length === 0}
                size="lg"
                className="w-full"
            >
                <Save className="h-4 w-4 mr-2" />
                Save Preferences ({sets.length} {sets.length === 1 ? 'set' : 'sets'})
            </Button>

            {/* Conflict Resolution Modal */}
            <ConflictModal
                open={conflictModalOpen}
                onOpenChange={setConflictModalOpen}
                localSets={sets}
                serverSets={serverSets}
                onKeepLocal={() => {
                    // User chose to keep local changes, retry save
                    setConflictModalOpen(false);
                    handleSave();
                }}
                onAcceptServer={() => {
                    // User chose to accept server version
                    setSets(serverSets);
                    setConflictModalOpen(false);
                    setError(null);
                }}
            />
        </div>
    );
}

export default PreferencesForm;
