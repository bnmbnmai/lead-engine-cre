import { useState, useCallback, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import {
    GripVertical, Plus, Trash2, Eye, Code, Settings2, Palette,
    Layers, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Download,
    Save, CheckCircle,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LabeledSwitch } from '@/components/ui/switch';
import FormPreview from '@/components/forms/FormPreview';
import { VERTICAL_EMOJI } from '@/components/forms/StepProgress';
import { LanderExport } from '@/components/forms/LanderExport';

import { useVerticals } from '@/hooks/useVerticals';
import { NestedVerticalSelect } from '@/components/ui/NestedVerticalSelect';
import useAuth from '@/hooks/useAuth';
import api from '@/lib/api';
import { toast } from '@/hooks/useToast';

// ============================================
// Types & Constants — extracted to shared modules
// ============================================

// Re-export types and constants so existing imports from '@/pages/FormBuilder' still work
export type { FormField, FormStep, GamificationConfig, FormColorScheme } from '@/types/formBuilder';
export { COLOR_SCHEMES, VERTICAL_PRESETS, GENERIC_TEMPLATE } from '@/constants/formPresets';
export { autoGroupSteps, genId } from '@/utils/formSteps';

import type { FormField, FormStep, GamificationConfig, FormColorScheme } from '@/types/formBuilder';
import { COLOR_SCHEMES, VERTICAL_PRESETS, GENERIC_TEMPLATE } from '@/constants/formPresets';
import { autoGroupSteps, genId } from '@/utils/formSteps';

// ============================================
// Component
// ============================================

export function FormBuilder() {
    const { user } = useAuth();
    // Admin-only guard — sellers use /seller/templates instead
    if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;

    const [vertical, setVertical] = useState('');
    const [fields, setFields] = useState<FormField[]>([]);
    const [steps, setSteps] = useState<FormStep[]>([]);
    const [previewMode, setPreviewMode] = useState<'preview' | 'json' | 'export'>('preview');
    const [previewStep, setPreviewStep] = useState(0);
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const dragSource = useRef<{ stepIdx: number; fieldIdx: number } | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const [gamification, setGamification] = useState<GamificationConfig>({
        showProgress: true,
        showNudges: true,
        confetti: false,
    });
    const [colorScheme] = useState<FormColorScheme>(COLOR_SCHEMES[0]);

    const [isSaving, setIsSaving] = useState(false);
    const [isSaved, setIsSaved] = useState(false);
    const [hasAdminConfig, setHasAdminConfig] = useState(false);

    // Dynamic verticals from API
    const { flatList: apiVerticals } = useVerticals();

    // Auto-select first vertical on initial load
    useEffect(() => {
        if (!vertical && apiVerticals.length > 0) {
            const first = apiVerticals.find(v => v.depth === 0);
            if (first) loadPreset(first.value);
        }
    }, [apiVerticals]); // eslint-disable-line react-hooks/exhaustive-deps

    const loadPreset = async (v: string) => {
        setVertical(v);
        setIsSaved(false);
        setHasAdminConfig(false);

        // Try to load saved admin config from API
        try {
            const res = await api.getFormConfig(v);
            if (res.data?.formConfig) {
                const config = res.data.formConfig;
                setFields(config.fields || []);
                setSteps(config.steps || []);
                if (config.gamification) {
                    setGamification(config.gamification);
                }
                setHasAdminConfig(true);
                setIsSaved(true);
                setEditingId(null);
                setPreviewStep(0);

                return;
            }
        } catch {
            // No saved config — fall through to preset
        }

        // Fall back to hardcoded preset
        const presetFields = [...(VERTICAL_PRESETS[v] || GENERIC_TEMPLATE)];
        setFields(presetFields);
        setSteps(autoGroupSteps(presetFields));
        setEditingId(null);
        setPreviewStep(0);
    };

    const addField = () => {
        const id = genId();
        const newField: FormField = { id, key: `field_${id}`, label: 'New Field', type: 'text', required: false, placeholder: '' };
        setFields((prev) => [...prev, newField]);
        // Add to second-to-last step (Contact Info should always be last)
        setSteps((prev) => {
            if (prev.length === 0) return [{ id: genId(), label: 'Step 1', fieldIds: [id] }];
            const copy = [...prev];
            const lastIsContact = copy.length > 1 && copy[copy.length - 1].label.toLowerCase().includes('contact');
            const targetIdx = lastIsContact ? copy.length - 2 : copy.length - 1;
            copy[targetIdx] = { ...copy[targetIdx], fieldIds: [...copy[targetIdx].fieldIds, id] };
            return copy;
        });
        setEditingId(id);
    };

    const removeField = (id: string) => {
        setFields((prev) => prev.filter((f) => f.id !== id));
        setSteps((prev) => prev.map((s) => ({ ...s, fieldIds: s.fieldIds.filter((fid) => fid !== id) })).filter((s) => s.fieldIds.length > 0));
        if (editingId === id) setEditingId(null);
    };

    const updateField = (id: string, updates: Partial<FormField>) => {
        setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
    };

    const addStep = () => {
        setSteps((prev) => {
            const newStep = { id: genId(), label: `Step ${prev.length + 1}`, fieldIds: [] as string[] };
            // Insert before Contact Info (PII should always be the last step)
            const lastIsContact = prev.length > 0 && prev[prev.length - 1].label.toLowerCase().includes('contact');
            if (lastIsContact) {
                return [...prev.slice(0, -1), newStep, prev[prev.length - 1]];
            }
            return [...prev, newStep];
        });
    };

    const removeStep = (stepId: string) => {
        setSteps((prev) => {
            const step = prev.find((s) => s.id === stepId);
            if (!step) return prev;
            // Move orphan fields to previous step
            const remaining = prev.filter((s) => s.id !== stepId);
            if (remaining.length > 0 && step.fieldIds.length > 0) {
                remaining[remaining.length - 1] = {
                    ...remaining[remaining.length - 1],
                    fieldIds: [...remaining[remaining.length - 1].fieldIds, ...step.fieldIds],
                };
            }
            return remaining;
        });
        if (previewStep >= steps.length - 1) setPreviewStep(Math.max(0, steps.length - 2));
    };

    const moveStep = (fromIdx: number, toIdx: number) => {
        if (toIdx < 0 || toIdx >= steps.length) return;
        // Prevent Contact Info from leaving the last position
        const moving = steps[fromIdx];
        if (moving.label.toLowerCase().includes('contact') && toIdx !== steps.length - 1) return;
        // Prevent anything from pushing past Contact Info at the end
        const target = steps[toIdx];
        if (target.label.toLowerCase().includes('contact') && toIdx === steps.length - 1 && fromIdx < toIdx) return;
        setSteps((prev) => {
            const copy = [...prev];
            const [moved] = copy.splice(fromIdx, 1);
            copy.splice(toIdx, 0, moved);
            return copy;
        });
    };

    const updateStepLabel = (stepId: string, label: string) => {
        setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, label } : s)));
    };

    // ─── Drag-and-Drop ───────────────────────
    const handleDragStart = useCallback((stepIdx: number, fieldIdx: number) => {
        setDragIdx(stepIdx * 1000 + fieldIdx); // encode both indices for highlight
        dragSource.current = { stepIdx, fieldIdx };
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, targetStepIdx: number, targetFieldIdx: number) => {
        e.preventDefault();
        const src = dragSource.current;
        if (!src) return;
        if (src.stepIdx === targetStepIdx && src.fieldIdx === targetFieldIdx) return;

        setSteps((prev) => {
            const next = prev.map((s) => ({ ...s, fieldIds: [...s.fieldIds] }));
            // Remove from source step
            const [movedId] = next[src.stepIdx].fieldIds.splice(src.fieldIdx, 1);
            // Insert into target step
            next[targetStepIdx].fieldIds.splice(targetFieldIdx, 0, movedId);
            return next;
        });
        // Update source to new position
        dragSource.current = { stepIdx: targetStepIdx, fieldIdx: targetFieldIdx };
        setDragIdx(targetStepIdx * 1000 + targetFieldIdx);
    }, []);

    const handleDragEnd = useCallback(() => {
        setDragIdx(null);
        dragSource.current = null;
    }, []);

    // ─── Export ──────────────────────────────
    const exportConfig = () => {
        return {
            vertical,
            fields: fields.map(({ id, ...rest }) => ({ id, ...rest })),
            steps,
            gamification,
            createdAt: new Date().toISOString(),
        };
    };

    const copyConfig = () => {
        navigator.clipboard.writeText(JSON.stringify(exportConfig(), null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const saveConfig = async () => {
        if (!vertical || isSaving) return;
        setIsSaving(true);
        try {
            const res = await api.saveFormConfig(vertical, {
                fields,
                steps,
                gamification,
            });
            if (res.error) {
                throw new Error(res.error.error || 'Failed to save form config');
            }
            setIsSaved(true);
            setHasAdminConfig(true);

            // Show warnings about missing CRE/ACE fields if present
            const warnings = (res.data as any)?.warnings as string[] | undefined;
            if (warnings && warnings.length > 0) {
                toast({ type: 'warning', title: 'Config Saved with Warnings', description: warnings.join(' ') });
            } else {
                toast({ type: 'success', title: 'Config Saved', description: `Form config saved for ${vertical}. Sellers will now see this form.` });
            }
        } catch (err: any) {
            toast({ type: 'error', title: 'Save Failed', description: err?.response?.data?.error || 'Failed to save form config' });
        } finally {
            setIsSaving(false);
        }
    };

    // ─── Preview helpers ─────────────────────
    const emoji = VERTICAL_EMOJI[vertical] || '📋';


    return (
        <DashboardLayout>
            <div className="max-w-7xl mx-auto">
                <div className="mb-8 flex items-start justify-between">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center gap-2">
                            {emoji} Form Builder
                            <span className="text-sm font-normal px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                Multi-Step Wizard
                            </span>
                            {vertical && hasAdminConfig && (
                                <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3" /> Saved
                                </span>
                            )}
                        </h1>
                        <p className="text-muted-foreground">
                            Build gamified multi-step lead capture forms — drag to reorder, group into steps, export as hosted lander
                        </p>
                    </div>
                    {vertical && (
                        <Button onClick={saveConfig} disabled={isSaving} className="gap-2">
                            <Save className="h-4 w-4" />
                            {isSaving ? 'Saving...' : isSaved ? 'Saved ✓' : 'Save Config'}
                        </Button>
                    )}
                </div>

                {/* Vertical Selector */}
                <div className="mb-6 space-y-3">
                    <div className="flex items-center gap-4">
                        <label className="text-sm font-medium">Vertical Template:</label>
                        <NestedVerticalSelect
                            value={vertical}
                            onValueChange={loadPreset}
                            placeholder="Select a vertical…"
                            className="flex-1 max-w-sm"
                            showSuggest
                            onSuggestClick={() => window.open('/verticals/suggest', '_blank')}
                        />
                    </div>
                    {vertical && !VERTICAL_PRESETS[vertical] && (
                        <p className="text-xs text-muted-foreground italic">
                            No preset template for this vertical — using generic contact fields. Customise below.
                        </p>
                    )}
                </div>

                <div className="grid lg:grid-cols-2 gap-6">
                    {/* ─── Left: Field Editor + Step Manager ───────── */}
                    <div className="space-y-4">
                        {/* Step Manager */}
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <Layers className="h-5 w-5 text-primary" />
                                Steps ({steps.length})
                            </h2>
                            <Button variant="outline" size="sm" onClick={addStep}>
                                <Plus className="h-4 w-4 mr-1" />
                                Add Step
                            </Button>
                        </div>

                        {steps.map((step, si) => (
                            <div key={step.id} className="rounded-xl border border-border bg-background p-3 space-y-2">
                                {/* Step header */}
                                <div className="flex items-center gap-2">
                                    <div className="flex flex-col gap-0.5 shrink-0">
                                        <button
                                            onClick={() => moveStep(si, si - 1)}
                                            disabled={si === 0 || step.label.toLowerCase().includes('contact')}
                                            className="p-0.5 rounded text-muted-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition"
                                            title="Move step up"
                                        >
                                            <ChevronUp className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            onClick={() => moveStep(si, si + 1)}
                                            disabled={si === steps.length - 1 || step.label.toLowerCase().includes('contact')}
                                            className="p-0.5 rounded text-muted-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition"
                                            title="Move step down"
                                        >
                                            <ChevronDown className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                                        {si + 1}
                                    </span>
                                    <Input
                                        value={step.label}
                                        onChange={(e) => updateStepLabel(step.id, e.target.value)}
                                        className="h-7 text-sm font-medium flex-1"
                                    />
                                    {step.label.toLowerCase().includes('contact') && (
                                        <span className="text-xs text-muted-foreground shrink-0" title="Contact Info is always the last step for best conversion">🔒</span>
                                    )}
                                    {steps.length > 1 && (
                                        <button
                                            onClick={() => removeStep(step.id)}
                                            className="p-1 rounded text-muted-foreground hover:text-destructive transition"
                                            title="Remove step (fields move to previous)"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>

                                {/* Fields in step */}
                                <div className="space-y-1 pl-8">
                                    {step.fieldIds.map((fid, fi) => {
                                        const field = fields.find((f) => f.id === fid);
                                        if (!field) return null;

                                        return (
                                            <div
                                                key={field.id}
                                                draggable
                                                onDragStart={() => handleDragStart(si, fi)}
                                                onDragOver={(e) => handleDragOver(e, si, fi)}
                                                onDragEnd={handleDragEnd}
                                                className={`group flex items-start gap-2 p-2.5 rounded-lg border transition-all cursor-grab active:cursor-grabbing ${dragIdx === si * 1000 + fi
                                                    ? 'border-primary bg-primary/5 shadow-sm'
                                                    : 'border-border/50 bg-background hover:border-primary/30'
                                                    } ${editingId === field.id ? 'ring-1 ring-primary' : ''}`}
                                            >
                                                <div className="pt-0.5 text-muted-foreground">
                                                    <GripVertical className="h-3.5 w-3.5" />
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    {editingId === field.id ? (
                                                        <div className="space-y-3">
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div>
                                                                    <label className="text-xs font-medium text-muted-foreground">Label</label>
                                                                    <Input value={field.label} onChange={(e) => updateField(field.id, { label: e.target.value })} className="h-8 text-sm" />
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs font-medium text-muted-foreground">Key</label>
                                                                    <Input value={field.key} onChange={(e) => updateField(field.id, { key: e.target.value })} className="h-8 text-sm font-mono" />
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div>
                                                                    <label className="text-xs font-medium text-muted-foreground">Type</label>
                                                                    <Select value={field.type} onValueChange={(v) => updateField(field.id, { type: v as FormField['type'] })}>
                                                                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="text">Text</SelectItem>
                                                                            <SelectItem value="email">Email</SelectItem>
                                                                            <SelectItem value="phone">Phone</SelectItem>
                                                                            <SelectItem value="number">Number</SelectItem>
                                                                            <SelectItem value="select">Dropdown</SelectItem>
                                                                            <SelectItem value="boolean">Toggle</SelectItem>
                                                                            <SelectItem value="textarea">Long Text</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs font-medium text-muted-foreground">Placeholder</label>
                                                                    <Input value={field.placeholder || ''} onChange={(e) => updateField(field.id, { placeholder: e.target.value })} className="h-8 text-sm" />
                                                                </div>
                                                            </div>
                                                            {field.type === 'select' && (
                                                                <div>
                                                                    <label className="text-xs font-medium text-muted-foreground">Options (comma-separated)</label>
                                                                    <Input
                                                                        value={(field.options || []).join(', ')}
                                                                        onChange={(e) => updateField(field.id, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                                                                        className="h-8 text-sm"
                                                                        placeholder="Option 1, Option 2, Option 3"
                                                                    />
                                                                </div>
                                                            )}
                                                            <div className="flex items-center justify-between">
                                                                <LabeledSwitch label="Required" checked={field.required} onCheckedChange={(v) => updateField(field.id, { required: v })} />
                                                                <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Done</Button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <button className="w-full text-left" onClick={() => setEditingId(field.id)}>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-medium">{field.label}</span>
                                                                {field.required && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">REQ</span>}
                                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{field.type}</span>
                                                            </div>
                                                            <div className="text-xs text-muted-foreground font-mono mt-0.5">{field.key}</div>
                                                        </button>
                                                    )}
                                                </div>

                                                <button
                                                    onClick={() => removeField(field.id)}
                                                    className="p-1 rounded text-muted-foreground hover:text-destructive transition opacity-0 group-hover:opacity-100"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                    {step.fieldIds.length === 0 && (
                                        <p className="text-xs text-muted-foreground py-2 text-center">No fields — drag a field here or add a new one</p>
                                    )}
                                </div>
                            </div>
                        ))}

                        {/* Add field button */}
                        <div className="flex items-center justify-between border-t border-border pt-4">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <Settings2 className="h-5 w-5 text-primary" />
                                Fields ({fields.length})
                            </h2>
                            <Button variant="outline" size="sm" onClick={addField}>
                                <Plus className="h-4 w-4 mr-1" />
                                Add Field
                            </Button>
                        </div>


                    </div>

                    {/* ─── Right: Live Preview ──────── */}
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <Palette className="h-5 w-5 text-primary" />
                                Preview
                            </h2>
                            <div className="flex gap-1 p-1 rounded-lg bg-muted/50">
                                <button
                                    onClick={() => setPreviewMode('preview')}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${previewMode === 'preview'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                >
                                    <Eye className="h-3.5 w-3.5" />
                                    Wizard
                                </button>
                                <button
                                    onClick={() => setPreviewMode('json')}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${previewMode === 'json'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                >
                                    <Code className="h-3.5 w-3.5" />
                                    JSON
                                </button>
                                <button
                                    onClick={() => setPreviewMode('export')}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${previewMode === 'export'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    Export
                                </button>
                            </div>
                        </div>

                        <Card className="sticky top-24 overflow-hidden">
                            {previewMode === 'preview' ? (
                                <>
                                    <FormPreview
                                        verticalName={vertical.replace('_', ' ')}
                                        verticalSlug={vertical}
                                        fields={fields}
                                        steps={steps}
                                        currentStep={previewStep}
                                        colors={{
                                            bg: colorScheme.vars['--form-bg'],
                                            text: colorScheme.vars['--form-text'],
                                            accent: colorScheme.vars['--form-accent'],
                                            border: colorScheme.vars['--form-border'],
                                            inputBg: colorScheme.vars['--form-input-bg'],
                                            muted: colorScheme.vars['--form-muted'],
                                        }}
                                        showProgress={gamification.showProgress}
                                        showNudges={gamification.showNudges}
                                        ctaText="Get My Free Quote"
                                        isAdminConfigured={hasAdminConfig}
                                    />
                                    {/* Step navigation for preview */}
                                    <div className="flex gap-2 p-4 pt-0">
                                        {previewStep > 0 && (
                                            <Button
                                                variant="outline"
                                                className="flex-1"
                                                onClick={() => setPreviewStep((p) => Math.max(0, p - 1))}
                                            >
                                                <ChevronLeft className="h-4 w-4 mr-1" />
                                                Back
                                            </Button>
                                        )}
                                        {previewStep < steps.length - 1 && (
                                            <Button
                                                className="flex-1"
                                                onClick={() => setPreviewStep((p) => Math.min(steps.length - 1, p + 1))}
                                            >
                                                Next
                                                <ChevronRight className="h-4 w-4 ml-1" />
                                            </Button>
                                        )}
                                    </div>
                                </>
                            ) : previewMode === 'json' ? (
                                <CardContent className="pt-6">
                                    <pre className="bg-background border border-border rounded-lg p-4 text-xs overflow-auto font-mono text-muted-foreground max-h-[600px]">
                                        {JSON.stringify(exportConfig(), null, 2)}
                                    </pre>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="mt-3 w-full"
                                        onClick={copyConfig}
                                    >
                                        {copied ? '✓ Copied!' : 'Copy JSON Config'}
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="mt-2 w-full gap-2"
                                        onClick={saveConfig}
                                        disabled={isSaving}
                                    >
                                        <Save className="h-3.5 w-3.5" />
                                        {isSaving ? 'Saving...' : 'Save to Platform'}
                                    </Button>
                                </CardContent>
                            ) : (
                                <CardContent className="pt-6">
                                    <LanderExport
                                        vertical={vertical}
                                        fields={fields}
                                        steps={steps}
                                        gamification={gamification}
                                    />
                                </CardContent>
                            )}
                        </Card>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}

export default FormBuilder;
