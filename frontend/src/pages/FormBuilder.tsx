import { useState, useCallback } from 'react';
import { GripVertical, Plus, Trash2, Eye, Code, Settings2, Palette } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LabeledSwitch } from '@/components/ui/switch';

// ============================================
// Types
// ============================================

interface FormField {
    id: string;
    key: string;
    label: string;
    type: 'text' | 'select' | 'boolean' | 'number' | 'textarea' | 'email' | 'phone';
    required: boolean;
    placeholder?: string;
    options?: string[];
}

// ============================================
// Vertical Presets
// ============================================

const VERTICAL_PRESETS: Record<string, FormField[]> = {
    roofing: [
        { id: '1', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'John Doe' },
        { id: '2', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'john@example.com' },
        { id: '3', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 123-4567' },
        { id: '4', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '33101' },
        { id: '5', key: 'roof_type', label: 'Roof Type', type: 'select', required: true, options: ['Shingle', 'Tile', 'Metal', 'Flat', 'Slate'] },
        { id: '6', key: 'damage_type', label: 'Damage Type', type: 'select', required: false, options: ['Storm', 'Hail', 'Wind', 'Age', 'Leak', 'None'] },
        { id: '7', key: 'insurance_claim', label: 'Filing Insurance Claim?', type: 'boolean', required: false },
        { id: '8', key: 'roof_age', label: 'Roof Age (years)', type: 'number', required: false, placeholder: '15' },
    ],
    mortgage: [
        { id: '1', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Jane Smith' },
        { id: '2', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'jane@example.com' },
        { id: '3', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 987-6543' },
        { id: '4', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '90001' },
        { id: '5', key: 'loan_type', label: 'Loan Type', type: 'select', required: true, options: ['Purchase', 'Refinance', 'HELOC', 'Reverse', 'Construction'] },
        { id: '6', key: 'credit_range', label: 'Credit Score Range', type: 'select', required: true, options: ['Excellent (750+)', 'Good (700-749)', 'Fair (650-699)', 'Below 650'] },
        { id: '7', key: 'property_type', label: 'Property Type', type: 'select', required: false, options: ['Single Family', 'Condo', 'Townhouse', 'Multi-Family'] },
        { id: '8', key: 'purchase_price', label: 'Purchase Price', type: 'number', required: false, placeholder: '450000' },
    ],
    solar: [
        { id: '1', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Alex Johnson' },
        { id: '2', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'alex@example.com' },
        { id: '3', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 456-7890' },
        { id: '4', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '85001' },
        { id: '5', key: 'monthly_bill', label: 'Monthly Electric Bill ($)', type: 'number', required: true, placeholder: '250' },
        { id: '6', key: 'ownership', label: 'Home Ownership', type: 'select', required: true, options: ['Own', 'Rent', 'Buying'] },
        { id: '7', key: 'roof_age', label: 'Roof Age (years)', type: 'number', required: false, placeholder: '10' },
        { id: '8', key: 'shade_level', label: 'Roof Shade Level', type: 'select', required: false, options: ['No Shade', 'Partial', 'Heavy'] },
    ],
    insurance: [
        { id: '1', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Sam Wilson' },
        { id: '2', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'sam@example.com' },
        { id: '3', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 321-0987' },
        { id: '4', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '60601' },
        { id: '5', key: 'coverage_type', label: 'Coverage Type', type: 'select', required: true, options: ['Auto', 'Home', 'Life', 'Health', 'Business', 'Bundle'] },
        { id: '6', key: 'current_provider', label: 'Current Provider', type: 'text', required: false, placeholder: 'State Farm' },
        { id: '7', key: 'num_drivers', label: 'Number of Drivers', type: 'number', required: false, placeholder: '2' },
    ],
    home_services: [
        { id: '1', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Chris Lee' },
        { id: '2', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'chris@example.com' },
        { id: '3', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 654-3210' },
        { id: '4', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '10001' },
        { id: '5', key: 'service_type', label: 'Service Needed', type: 'select', required: true, options: ['HVAC', 'Plumbing', 'Electrical', 'Painting', 'Landscaping', 'Cleaning'] },
        { id: '6', key: 'urgency', label: 'Urgency', type: 'select', required: true, options: ['Emergency', 'This Week', 'This Month', 'Planning'] },
    ],
};

const VERTICALS = Object.keys(VERTICAL_PRESETS);

let fieldCounter = 100;
const genId = () => String(fieldCounter++);

// ============================================
// Component
// ============================================

export function FormBuilder() {
    const [vertical, setVertical] = useState('roofing');
    const [fields, setFields] = useState<FormField[]>([...VERTICAL_PRESETS.roofing]);
    const [previewMode, setPreviewMode] = useState<'preview' | 'json'>('preview');
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const loadPreset = (v: string) => {
        setVertical(v);
        setFields([...(VERTICAL_PRESETS[v] || [])]);
        setEditingId(null);
    };

    const addField = () => {
        const id = genId();
        setFields((prev) => [
            ...prev,
            { id, key: `field_${id}`, label: 'New Field', type: 'text', required: false, placeholder: '' },
        ]);
        setEditingId(id);
    };

    const removeField = (id: string) => {
        setFields((prev) => prev.filter((f) => f.id !== id));
        if (editingId === id) setEditingId(null);
    };

    const updateField = (id: string, updates: Partial<FormField>) => {
        setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
    };

    // ─── Drag-and-Drop ───────────────────────
    const handleDragStart = useCallback((idx: number) => {
        setDragIdx(idx);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
        e.preventDefault();
        if (dragIdx === null || dragIdx === idx) return;

        setFields((prev) => {
            const next = [...prev];
            const [moved] = next.splice(dragIdx, 1);
            next.splice(idx, 0, moved);
            return next;
        });
        setDragIdx(idx);
    }, [dragIdx]);

    const handleDragEnd = useCallback(() => {
        setDragIdx(null);
    }, []);

    // ─── Export ──────────────────────────────
    const exportConfig = () => {
        return {
            vertical,
            fields: fields.map(({ id, ...rest }) => rest),
            createdAt: new Date().toISOString(),
        };
    };

    const copyConfig = () => {
        navigator.clipboard.writeText(JSON.stringify(exportConfig(), null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <DashboardLayout>
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold">Form Builder</h1>
                    <p className="text-muted-foreground">
                        Build custom lead capture forms for any vertical — drag to reorder, click to edit
                    </p>
                </div>

                {/* Vertical Selector */}
                <div className="flex items-center gap-4 mb-6">
                    <label className="text-sm font-medium">Vertical Template:</label>
                    <div className="flex gap-2 flex-wrap">
                        {VERTICALS.map((v) => (
                            <button
                                key={v}
                                onClick={() => loadPreset(v)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${vertical === v
                                        ? 'bg-primary text-primary-foreground shadow-sm'
                                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                    }`}
                            >
                                {v.replace('_', ' ')}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid lg:grid-cols-2 gap-6">
                    {/* ─── Left: Field Editor ───────── */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <Settings2 className="h-5 w-5 text-primary" />
                                Fields ({fields.length})
                            </h2>
                            <Button variant="outline" size="sm" onClick={addField}>
                                <Plus className="h-4 w-4 mr-1" />
                                Add Field
                            </Button>
                        </div>

                        <div className="space-y-2">
                            {fields.map((field, idx) => (
                                <div
                                    key={field.id}
                                    draggable
                                    onDragStart={() => handleDragStart(idx)}
                                    onDragOver={(e) => handleDragOver(e, idx)}
                                    onDragEnd={handleDragEnd}
                                    className={`group flex items-start gap-2 p-3 rounded-xl border transition-all cursor-grab active:cursor-grabbing ${dragIdx === idx
                                            ? 'border-primary bg-primary/5 shadow-sm'
                                            : 'border-border bg-background hover:border-primary/30'
                                        } ${editingId === field.id ? 'ring-1 ring-primary' : ''}`}
                                >
                                    {/* Drag Handle */}
                                    <div className="pt-1 text-muted-foreground">
                                        <GripVertical className="h-4 w-4" />
                                    </div>

                                    {/* Field Content */}
                                    <div className="flex-1 min-w-0">
                                        {editingId === field.id ? (
                                            /* Editing Mode */
                                            <div className="space-y-3">
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Label</label>
                                                        <Input
                                                            value={field.label}
                                                            onChange={(e) => updateField(field.id, { label: e.target.value })}
                                                            className="h-8 text-sm"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Key</label>
                                                        <Input
                                                            value={field.key}
                                                            onChange={(e) => updateField(field.id, { key: e.target.value })}
                                                            className="h-8 text-sm font-mono"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Type</label>
                                                        <Select
                                                            value={field.type}
                                                            onValueChange={(v) => updateField(field.id, { type: v as FormField['type'] })}
                                                        >
                                                            <SelectTrigger className="h-8 text-sm">
                                                                <SelectValue />
                                                            </SelectTrigger>
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
                                                        <Input
                                                            value={field.placeholder || ''}
                                                            onChange={(e) => updateField(field.id, { placeholder: e.target.value })}
                                                            className="h-8 text-sm"
                                                        />
                                                    </div>
                                                </div>
                                                {field.type === 'select' && (
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Options (comma-separated)</label>
                                                        <Input
                                                            value={(field.options || []).join(', ')}
                                                            onChange={(e) => updateField(field.id, {
                                                                options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                                                            })}
                                                            className="h-8 text-sm"
                                                            placeholder="Option 1, Option 2, Option 3"
                                                        />
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between">
                                                    <LabeledSwitch
                                                        label="Required"
                                                        checked={field.required}
                                                        onCheckedChange={(v) => updateField(field.id, { required: v })}
                                                    />
                                                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                                                        Done
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : (
                                            /* Display Mode */
                                            <button
                                                className="w-full text-left"
                                                onClick={() => setEditingId(field.id)}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium">{field.label}</span>
                                                    {field.required && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">REQ</span>
                                                    )}
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{field.type}</span>
                                                </div>
                                                <div className="text-xs text-muted-foreground font-mono mt-0.5">{field.key}</div>
                                            </button>
                                        )}
                                    </div>

                                    {/* Delete */}
                                    <button
                                        onClick={() => removeField(field.id)}
                                        className="p-1 rounded text-muted-foreground hover:text-destructive transition opacity-0 group-hover:opacity-100"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {fields.length === 0 && (
                            <div className="text-center py-12 border border-dashed border-border rounded-xl">
                                <p className="text-muted-foreground mb-3">No fields yet</p>
                                <Button variant="outline" onClick={addField}>
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add Your First Field
                                </Button>
                            </div>
                        )}
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
                                    Visual
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
                            </div>
                        </div>

                        <Card className="sticky top-24">
                            {previewMode === 'preview' ? (
                                <>
                                    <CardHeader className="pb-4">
                                        <CardTitle className="text-lg capitalize">
                                            Get Your Free {vertical.replace('_', ' ')} Quote
                                        </CardTitle>
                                        <p className="text-sm text-muted-foreground">
                                            Fill out the form below and we'll connect you with top providers in your area.
                                        </p>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        {fields.map((field) => (
                                            <div key={field.id}>
                                                <label className="text-sm font-medium mb-1.5 block">
                                                    {field.label}
                                                    {field.required && <span className="text-destructive ml-0.5">*</span>}
                                                </label>

                                                {(field.type === 'text' || field.type === 'email' || field.type === 'phone' || field.type === 'number') && (
                                                    <div className="h-10 rounded-lg border border-border bg-muted/30 px-3 flex items-center text-sm text-muted-foreground">
                                                        {field.placeholder || field.label}
                                                    </div>
                                                )}

                                                {field.type === 'select' && (
                                                    <div className="h-10 rounded-lg border border-border bg-muted/30 px-3 flex items-center justify-between text-sm text-muted-foreground">
                                                        <span>Select {field.label.toLowerCase()}</span>
                                                        <span className="text-xs">▼</span>
                                                    </div>
                                                )}

                                                {field.type === 'boolean' && (
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-9 h-5 rounded-full bg-muted border border-border" />
                                                        <span className="text-sm text-muted-foreground">No</span>
                                                    </div>
                                                )}

                                                {field.type === 'textarea' && (
                                                    <div className="h-20 rounded-lg border border-border bg-muted/30 px-3 pt-2 text-sm text-muted-foreground">
                                                        {field.placeholder || field.label}
                                                    </div>
                                                )}
                                            </div>
                                        ))}

                                        {/* TCPA + Submit */}
                                        <div className="pt-2 space-y-3">
                                            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-border">
                                                <div className="w-4 h-4 rounded border border-border mt-0.5 flex-shrink-0" />
                                                <p className="text-[11px] text-muted-foreground leading-tight">
                                                    By submitting, I consent to being contacted by phone, text, or email.
                                                    I understand I may receive automated communications. Consent is not a
                                                    condition of purchase.
                                                </p>
                                            </div>
                                            <div className="h-11 rounded-lg bg-primary flex items-center justify-center text-sm font-medium text-primary-foreground">
                                                Get My Free Quote
                                            </div>
                                        </div>
                                    </CardContent>
                                </>
                            ) : (
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
