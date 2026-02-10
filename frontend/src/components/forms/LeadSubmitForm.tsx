import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { Send, FileText, Globe, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LabeledSwitch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';

const VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'b2b_saas', 'real_estate', 'auto', 'legal', 'financial'];

const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

// Vertical-specific parameter definitions
const VERTICAL_FIELDS: Record<string, { key: string; label: string; type: 'text' | 'select' | 'boolean'; options?: string[] }[]> = {
    roofing: [
        { key: 'roof_type', label: 'Roof Type', type: 'select', options: ['shingle', 'tile', 'metal', 'flat', 'slate', 'other'] },
        { key: 'damage_type', label: 'Damage Type', type: 'select', options: ['storm', 'hail', 'wind', 'age', 'leak', 'none'] },
        { key: 'insurance_claim', label: 'Insurance Claim', type: 'boolean' },
        { key: 'roof_age', label: 'Roof Age (years)', type: 'text' },
        { key: 'square_footage', label: 'Square Footage', type: 'text' },
    ],
    mortgage: [
        { key: 'loan_type', label: 'Loan Type', type: 'select', options: ['purchase', 'refinance', 'heloc', 'reverse', 'construction'] },
        { key: 'credit_range', label: 'Credit Range', type: 'select', options: ['excellent_750+', 'good_700-749', 'fair_650-699', 'poor_below_650'] },
        { key: 'property_type', label: 'Property Type', type: 'select', options: ['single_family', 'condo', 'townhouse', 'multi_family', 'commercial'] },
        { key: 'purchase_price', label: 'Purchase Price ($)', type: 'text' },
        { key: 'down_payment_pct', label: 'Down Payment (%)', type: 'text' },
    ],
    solar: [
        { key: 'roof_age', label: 'Roof Age (years)', type: 'text' },
        { key: 'monthly_bill', label: 'Monthly Electric Bill ($)', type: 'text' },
        { key: 'ownership', label: 'Home Ownership', type: 'select', options: ['own', 'rent', 'buying'] },
        { key: 'panel_interest', label: 'Panel Interest', type: 'select', options: ['purchase', 'lease', 'ppa', 'undecided'] },
        { key: 'shade_level', label: 'Roof Shade', type: 'select', options: ['no_shade', 'partial', 'heavy'] },
    ],
    insurance: [
        { key: 'coverage_type', label: 'Coverage Type', type: 'select', options: ['auto', 'home', 'life', 'health', 'business', 'bundle'] },
        { key: 'current_provider', label: 'Current Provider', type: 'text' },
        { key: 'policy_expiry', label: 'Policy Expiry (days)', type: 'text' },
        { key: 'num_drivers', label: 'Number of Drivers', type: 'text' },
    ],
    home_services: [
        { key: 'service_type', label: 'Service Type', type: 'select', options: ['hvac', 'plumbing', 'electrical', 'painting', 'landscaping', 'cleaning'] },
        { key: 'urgency', label: 'Urgency', type: 'select', options: ['emergency', 'this_week', 'this_month', 'planning'] },
        { key: 'property_type', label: 'Property Type', type: 'select', options: ['residential', 'commercial'] },
    ],
    real_estate: [
        { key: 'transaction_type', label: 'Transaction', type: 'select', options: ['buying', 'selling', 'both'] },
        { key: 'property_type', label: 'Property Type', type: 'select', options: ['single_family', 'condo', 'townhouse', 'land', 'commercial'] },
        { key: 'price_range', label: 'Price Range', type: 'select', options: ['under_200k', '200k-500k', '500k-1m', 'over_1m'] },
        { key: 'timeline', label: 'Timeline', type: 'select', options: ['asap', '1-3_months', '3-6_months', '6+_months'] },
    ],
};

const leadSchema = z.object({
    vertical: z.string().min(1, 'Select a vertical'),
    geo: z.object({
        state: z.string().length(2, 'Select a state'),
        city: z.string().optional(),
        zip: z.string().optional(),
    }),
    source: z.enum(['PLATFORM', 'API', 'OFFSITE']).default('PLATFORM'),
    reservePrice: z.number().positive('Reserve price required'),
    tcpaConsentAt: z.string().optional(),
    encryptedData: z.string().optional(),
    expiresInMinutes: z.number().min(15).max(1440).default(60),
    parameters: z.record(z.unknown()).optional(),
});

type LeadFormData = z.infer<typeof leadSchema>;

interface LeadSubmitFormProps {
    source?: 'PLATFORM' | 'API' | 'OFFSITE';
    onSuccess?: (lead: any) => void;
}

export function LeadSubmitForm({ source = 'PLATFORM', onSuccess }: LeadSubmitFormProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tcpaConsent, setTcpaConsent] = useState(false);
    const [customParams, setCustomParams] = useState<Record<string, unknown>>({});

    const { register, handleSubmit, control, watch, formState: { errors } } = useForm<LeadFormData>({
        resolver: zodResolver(leadSchema),
        defaultValues: {
            source,
            expiresInMinutes: 60,
            geo: {},
        },
    });

    const selectedVertical = watch('vertical');
    const verticalFields = selectedVertical ? (VERTICAL_FIELDS[selectedVertical] || []) : [];

    const updateParam = (key: string, value: unknown) => {
        setCustomParams((prev) => ({ ...prev, [key]: value }));
    };

    const onSubmit = async (data: LeadFormData) => {
        if (!tcpaConsent) {
            setError('TCPA consent is required');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            // Merge custom params into parameters
            const nonEmptyParams = Object.fromEntries(
                Object.entries(customParams).filter(([, v]) => v !== '' && v !== undefined)
            );

            const submitData = {
                ...data,
                tcpaConsentAt: new Date().toISOString(),
                parameters: Object.keys(nonEmptyParams).length > 0 ? nonEmptyParams : undefined,
            };

            const { data: result, error: apiError } = await api.submitLead(submitData);
            if (apiError) {
                setError(apiError.error);
                return;
            }
            onSuccess?.(result?.lead);
        } catch (err) {
            setError('Failed to submit lead');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Card className="max-w-2xl mx-auto">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Send className="h-5 w-5 text-primary" />
                    Submit Lead
                </CardTitle>
            </CardHeader>

            <CardContent>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    {/* Source Badge */}
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/50">
                        {source === 'PLATFORM' && <FileText className="h-4 w-4 text-primary" />}
                        {source === 'API' && <Globe className="h-4 w-4 text-primary" />}
                        {source === 'OFFSITE' && <Globe className="h-4 w-4 text-amber-500" />}
                        <span className="text-sm font-medium">Source: {source}</span>
                    </div>

                    {/* Vertical */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">Vertical</label>
                        <Controller
                            name="vertical"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={(v) => { field.onChange(v); setCustomParams({}); }} value={field.value}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select vertical" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {VERTICALS.map((v) => (
                                            <SelectItem key={v} value={v} className="capitalize">
                                                {v.replace('_', ' ')}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                        {errors.vertical && <p className="text-xs text-destructive mt-1">{errors.vertical.message}</p>}
                    </div>

                    {/* Vertical-Specific Custom Fields */}
                    {verticalFields.length > 0 && (
                        <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/20">
                            <h4 className="text-sm font-semibold text-foreground capitalize">
                                {selectedVertical?.replace('_', ' ')} Details
                            </h4>
                            <div className="grid grid-cols-2 gap-4">
                                {verticalFields.map((field) => (
                                    <div key={field.key} className={field.type === 'boolean' ? 'col-span-2' : ''}>
                                        {field.type === 'select' && (
                                            <div>
                                                <label className="text-xs font-medium mb-1 block text-muted-foreground">{field.label}</label>
                                                <Select
                                                    value={(customParams[field.key] as string) || ''}
                                                    onValueChange={(v) => updateParam(field.key, v)}
                                                >
                                                    <SelectTrigger className="h-9 text-sm">
                                                        <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {field.options?.map((opt) => (
                                                            <SelectItem key={opt} value={opt} className="capitalize">
                                                                {opt.replace(/_/g, ' ')}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}
                                        {field.type === 'text' && (
                                            <div>
                                                <label className="text-xs font-medium mb-1 block text-muted-foreground">{field.label}</label>
                                                <Input
                                                    className="h-9 text-sm"
                                                    placeholder={field.label}
                                                    value={(customParams[field.key] as string) || ''}
                                                    onChange={(e) => updateParam(field.key, e.target.value)}
                                                />
                                            </div>
                                        )}
                                        {field.type === 'boolean' && (
                                            <LabeledSwitch
                                                label={field.label}
                                                description={`Mark if this lead involves a ${field.label.toLowerCase()}`}
                                                checked={!!customParams[field.key]}
                                                onCheckedChange={(v) => updateParam(field.key, v)}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Location */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-sm font-medium mb-2 block">State</label>
                            <Controller
                                name="geo.state"
                                control={control}
                                render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select state" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {US_STATES.map((s) => (
                                                <SelectItem key={s} value={s}>{s}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                            {errors.geo?.state && <p className="text-xs text-destructive mt-1">{errors.geo.state.message}</p>}
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-2 block">City (Optional)</label>
                            <Input placeholder="City" {...register('geo.city')} />
                        </div>
                    </div>

                    {/* ZIP */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">ZIP Code (Optional)</label>
                        <Input placeholder="33101" className="max-w-32" {...register('geo.zip')} />
                        <p className="text-xs text-muted-foreground mt-1">Improves matching accuracy with buyer asks</p>
                    </div>

                    {/* Reserve Price */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">Reserve Price (USDC)</label>
                        <Input
                            type="number"
                            step="0.01"
                            placeholder="25.00"
                            {...register('reservePrice', { valueAsNumber: true })}
                            error={errors.reservePrice?.message}
                        />
                    </div>

                    {/* Expiry */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">Lead Expiry (minutes)</label>
                        <Controller
                            name="expiresInMinutes"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value.toString()}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="30">30 minutes</SelectItem>
                                        <SelectItem value="60">1 hour</SelectItem>
                                        <SelectItem value="120">2 hours</SelectItem>
                                        <SelectItem value="240">4 hours</SelectItem>
                                        <SelectItem value="720">12 hours</SelectItem>
                                        <SelectItem value="1440">24 hours</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </div>

                    {/* Encrypted Data (for real leads) */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">Lead Data (Encrypted)</label>
                        <Textarea
                            placeholder="Paste encrypted lead data or leave empty for demo"
                            {...register('encryptedData')}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                            In production, lead PII is encrypted before submission
                        </p>
                    </div>

                    {/* TCPA Consent */}
                    <div className="p-4 rounded-xl border border-border">
                        <div className="flex items-start gap-3">
                            <Shield className="h-5 w-5 text-emerald-500 mt-0.5" />
                            <div className="flex-1">
                                <LabeledSwitch
                                    label="TCPA Consent Obtained"
                                    description="I confirm this lead has provided explicit consent for contact"
                                    checked={tcpaConsent}
                                    onCheckedChange={setTcpaConsent}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                            {error}
                        </div>
                    )}

                    {/* Submit */}
                    <Button type="submit" loading={isSubmitting} className="w-full" size="lg" disabled={!tcpaConsent}>
                        Submit Lead
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}

export default LeadSubmitForm;
