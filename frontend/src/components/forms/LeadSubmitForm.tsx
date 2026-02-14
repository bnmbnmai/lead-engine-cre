import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState, useEffect } from 'react';
import { Send, FileText, Globe, Shield, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LabeledSwitch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NestedVerticalSelect } from '@/components/ui/NestedVerticalSelect';
import api from '@/lib/api';



const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];
const CA_PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
const GB_REGIONS = ['England', 'Scotland', 'Wales', 'N. Ireland'];
const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

const COUNTRIES = [
    { code: 'US', label: 'United States' },
    { code: 'CA', label: 'Canada' },
    { code: 'GB', label: 'United Kingdom' },
    { code: 'AU', label: 'Australia' },
    { code: 'DE', label: 'Germany' },
    { code: 'FR', label: 'France' },
    { code: 'BR', label: 'Brazil' },
    { code: 'MX', label: 'Mexico' },
    { code: 'IN', label: 'India' },
    { code: 'JP', label: 'Japan' },
    { code: 'KR', label: 'South Korea' },
    { code: 'SG', label: 'Singapore' },
    { code: 'AE', label: 'UAE' },
    { code: 'ZA', label: 'South Africa' },
    { code: 'NG', label: 'Nigeria' },
    { code: 'OTHER', label: 'Other' },
];

function getRegionOptions(country: string) {
    switch (country) {
        case 'US': return { label: 'State', options: US_STATES };
        case 'CA': return { label: 'Province', options: CA_PROVINCES };
        case 'GB': return { label: 'Region', options: GB_REGIONS };
        case 'AU': return { label: 'State', options: AU_STATES };
        default: return null;
    }
}

// Vertical-specific parameter definitions (fallback when no admin config saved)
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
    auto: [
        { key: 'vehicle_year', label: 'Vehicle Year', type: 'text' },
        { key: 'vehicle_make', label: 'Make', type: 'text' },
        { key: 'vehicle_model', label: 'Model', type: 'text' },
        { key: 'mileage', label: 'Mileage', type: 'text' },
        { key: 'coverage_type', label: 'Coverage', type: 'select', options: ['liability', 'collision', 'comprehensive', 'full', 'minimum'] },
        { key: 'current_insured', label: 'Currently Insured', type: 'boolean' },
    ],
    b2b_saas: [
        { key: 'company_size', label: 'Company Size', type: 'select', options: ['1-10', '11-50', '51-200', '201-1000', '1000+'] },
        { key: 'industry', label: 'Industry', type: 'select', options: ['technology', 'finance', 'healthcare', 'retail', 'manufacturing', 'other'] },
        { key: 'budget_range', label: 'Monthly Budget', type: 'select', options: ['under_500', '500-2000', '2000-10000', '10000+'] },
        { key: 'decision_timeline', label: 'Decision Timeline', type: 'select', options: ['immediate', '1-3_months', '3-6_months', 'evaluating'] },
        { key: 'current_solution', label: 'Current Solution', type: 'text' },
    ],
    legal: [
        { key: 'case_type', label: 'Case Type', type: 'select', options: ['personal_injury', 'family_law', 'criminal_defense', 'immigration', 'business', 'estate_planning', 'bankruptcy'] },
        { key: 'urgency', label: 'Urgency', type: 'select', options: ['emergency', 'this_week', 'this_month', 'planning'] },
        { key: 'has_representation', label: 'Has Attorney', type: 'boolean' },
        { key: 'case_value', label: 'Estimated Case Value ($)', type: 'text' },
    ],
    financial: [
        { key: 'service_type', label: 'Service Type', type: 'select', options: ['tax_prep', 'bookkeeping', 'financial_planning', 'debt_consolidation', 'investment', 'retirement'] },
        { key: 'portfolio_size', label: 'Portfolio/Revenue', type: 'select', options: ['under_50k', '50k-250k', '250k-1m', 'over_1m'] },
        { key: 'risk_tolerance', label: 'Risk Tolerance', type: 'select', options: ['conservative', 'moderate', 'aggressive'] },
        { key: 'existing_advisor', label: 'Has Existing Advisor', type: 'boolean' },
    ],
};

const leadSchema = z.object({
    vertical: z.string().min(1, 'Select a vertical'),
    geo: z.object({
        country: z.string().length(2).default('US').optional(),
        state: z.string().optional(),
        region: z.string().optional(),
        city: z.string().optional(),
        zip: z.string().optional(),
    }),
    source: z.enum(['PLATFORM', 'API', 'OFFSITE']).default('PLATFORM'),
    reservePrice: z.number().positive('Reserve price required'),
    tcpaConsentAt: z.string().optional(),
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
    const [selectedCountry, setSelectedCountry] = useState('US');
    // Fraud warning checkbox
    const [fraudAcknowledged, setFraudAcknowledged] = useState(false);
    // Admin-configured fields from API
    const [adminVerticalFields, setAdminVerticalFields] = useState<{ key: string; label: string; type: 'text' | 'select' | 'boolean'; options?: string[] }[] | null>(null);


    const regionConfig = getRegionOptions(selectedCountry);

    const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<LeadFormData>({
        resolver: zodResolver(leadSchema),
        defaultValues: {
            source,
            geo: { country: 'US' },
        },
    });

    const selectedVertical = watch('vertical');
    // Extract root slug for VERTICAL_FIELDS lookup (e.g. "solar.battery_storage" → "solar")
    const verticalRoot = selectedVertical?.split('.')[0] || '';

    // Fetch admin-saved form config when vertical changes
    const CONTACT_KEYS = new Set(['fullName', 'full_name', 'first_name', 'last_name', 'name', 'email', 'phone', 'phone_number', 'zip', 'zipcode', 'zip_code', 'state', 'country', 'city', 'address', 'region']);
    useEffect(() => {
        if (!selectedVertical) { setAdminVerticalFields(null); return; }
        api.getFormConfig(selectedVertical)
            .then(res => {
                if (res.data?.formConfig?.fields) {
                    // Filter out contact/geo fields — those are handled by the form's own geo section
                    const nonContact = res.data.formConfig.fields
                        .filter((f: any) => !CONTACT_KEYS.has(f.key))
                        .map((f: any) => ({ key: f.key, label: f.label, type: f.type === 'number' || f.type === 'email' || f.type === 'phone' || f.type === 'textarea' ? 'text' as const : f.type as 'text' | 'select' | 'boolean', options: f.options }));
                    setAdminVerticalFields(nonContact.length > 0 ? nonContact : null);
                } else {
                    setAdminVerticalFields(null);
                }
            })
            .catch(() => setAdminVerticalFields(null));
    }, [selectedVertical]); // eslint-disable-line react-hooks/exhaustive-deps

    // Use admin-configured fields if available, otherwise fall back to hardcoded presets
    const verticalFields = adminVerticalFields || (verticalRoot ? (VERTICAL_FIELDS[verticalRoot] || []) : []);

    const updateParam = (key: string, value: unknown) => {
        setCustomParams((prev) => ({ ...prev, [key]: value }));
    };

    const onSubmit = async (data: LeadFormData) => {
        if (!tcpaConsent) {
            setError('TCPA consent is required');
            return;
        }
        if (!fraudAcknowledged) {
            setError('You must acknowledge the fresh-leads policy');
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
                                <NestedVerticalSelect
                                    value={field.value}
                                    onValueChange={(v) => { field.onChange(v); setCustomParams({}); }}
                                    placeholder="Select vertical"
                                    error={errors.vertical?.message}
                                />
                            )}
                        />
                    </div>

                    {/* Vertical-Specific Custom Fields */}
                    {verticalFields.length > 0 && (
                        <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/20">
                            <h4 className="text-sm font-semibold text-foreground capitalize">
                                {verticalRoot?.replace('_', ' ')} Details
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

                    {/* Location — Country */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">Country</label>
                        <Controller
                            name="geo.country"
                            control={control}
                            render={({ field }) => (
                                <Select
                                    onValueChange={(v) => {
                                        field.onChange(v);
                                        setSelectedCountry(v);
                                        setValue('geo.state', '');
                                        setValue('geo.region', '');
                                    }}
                                    value={field.value || 'US'}
                                >
                                    <SelectTrigger>
                                        <Globe className="h-4 w-4 mr-2 text-muted-foreground" />
                                        <SelectValue placeholder="Select country" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {COUNTRIES.map((c) => (
                                            <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </div>

                    {/* State / Region */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            {regionConfig ? (
                                <>
                                    <label className="text-sm font-medium mb-2 block">{regionConfig.label}</label>
                                    <Controller
                                        name="geo.state"
                                        control={control}
                                        render={({ field }) => (
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder={`Select ${regionConfig.label.toLowerCase()}`} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {regionConfig.options.map((s) => (
                                                        <SelectItem key={s} value={s}>{s}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </>
                            ) : (
                                <>
                                    <label className="text-sm font-medium mb-2 block">Region / State</label>
                                    <Input placeholder="e.g. Bavaria, Ontario" {...register('geo.region')} />
                                </>
                            )}
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-2 block">City (Optional)</label>
                            <Input placeholder="City" {...register('geo.city')} />
                        </div>
                    </div>

                    {/* Postal Code */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">
                            {selectedCountry === 'US' ? 'ZIP Code' : 'Postal Code'} (Optional)
                        </label>
                        <Input
                            placeholder={selectedCountry === 'US' ? '33101' : selectedCountry === 'GB' ? 'SW1A 1AA' : selectedCountry === 'CA' ? 'M5V 3L9' : '12345'}
                            className="max-w-40"
                            {...register('geo.zip')}
                        />
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

                    {/* Fraud Warning */}
                    <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                                    Fresh leads only. Form stuffing is fraud.
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Every submission is verified for authenticity. Fabricated, recycled, or bot-generated leads
                                    will be flagged, and repeat offenders will be permanently banned.
                                </p>
                                <label className="flex items-center gap-2 mt-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={fraudAcknowledged}
                                        onChange={(e) => setFraudAcknowledged(e.target.checked)}
                                        className="h-4 w-4 rounded border-amber-500/50 accent-amber-500"
                                    />
                                    <span className="text-xs font-medium text-foreground">
                                        I confirm this is a genuine, fresh lead from a real consumer
                                    </span>
                                </label>
                            </div>
                        </div>
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
                    <Button type="submit" loading={isSubmitting} className="w-full" size="lg" disabled={!tcpaConsent || !fraudAcknowledged}>
                        Submit Lead
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}

export default LeadSubmitForm;
