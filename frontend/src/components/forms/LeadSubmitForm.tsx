import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState, useEffect, useMemo } from 'react';
import { Send, FileText, Globe, Shield, ChevronDown, ChevronUp, Plus, Trash2, Megaphone, Code, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LabeledSwitch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { useVerticals } from '@/hooks/useVerticals';



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
    encryptedData: z.string().optional(),
    expiresInMinutes: z.number().min(5).max(1440).default(5),
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
    const { flatList: dynamicVerticals } = useVerticals();
    // Ad tracking state
    const [showAdTracking, setShowAdTracking] = useState(false);
    const [showMoreUtm, setShowMoreUtm] = useState(false);
    const [adSource, setAdSource] = useState<Record<string, string>>({});
    // Structured lead data editor
    const [leadDataRows, setLeadDataRows] = useState<{ key: string; value: string }[]>([]);
    const [rawJsonMode, setRawJsonMode] = useState(false);
    const [rawJsonText, setRawJsonText] = useState('');
    const [jsonError, setJsonError] = useState<string | null>(null);

    const regionConfig = getRegionOptions(selectedCountry);

    const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<LeadFormData>({
        resolver: zodResolver(leadSchema),
        defaultValues: {
            source,
            expiresInMinutes: 5,
            geo: { country: 'US' },
        },
    });

    const selectedVertical = watch('vertical');
    const verticalFields = selectedVertical ? (VERTICAL_FIELDS[selectedVertical] || []) : [];

    // Auto-read UTM params from URL on mount
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ad_id', 'ad_platform'];
        const found: Record<string, string> = {};
        let hasAny = false;
        for (const key of utmKeys) {
            const val = params.get(key);
            if (val) { found[key] = val; hasAny = true; }
        }
        if (hasAny) {
            setAdSource(found);
            setShowAdTracking(true);
        }
    }, []);

    // Vertical-specific placeholder data for the structured editor
    const verticalPlaceholders: Record<string, { key: string; value: string }[]> = useMemo(() => ({
        mortgage: [{ key: 'borrower_name', value: 'Jane Smith' }, { key: 'loan_amount', value: '350000' }],
        solar: [{ key: 'homeowner', value: 'Alex J.' }, { key: 'system_kw', value: '8.5' }],
        roofing: [{ key: 'roof_type', value: 'shingle' }, { key: 'damage_type', value: 'storm' }],
        insurance: [{ key: 'coverage_type', value: 'auto' }, { key: 'current_provider', value: 'State Farm' }],
        home_services: [{ key: 'service_type', value: 'hvac' }, { key: 'urgency', value: 'this_week' }],
        real_estate: [{ key: 'property_type', value: 'single_family' }, { key: 'price_range', value: '500k-1m' }],
        auto: [{ key: 'vehicle_make', value: 'Toyota' }, { key: 'vehicle_model', value: 'Camry' }],
        b2b_saas: [{ key: 'company_size', value: '51-200' }, { key: 'industry', value: 'technology' }],
        legal: [{ key: 'case_type', value: 'personal_injury' }, { key: 'urgency', value: 'this_week' }],
        financial: [{ key: 'service_type', value: 'financial_planning' }, { key: 'portfolio_size', value: '250k-1m' }],
    }), []);

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
                // Ad tracking
                adSource: Object.keys(adSource).filter(k => adSource[k]).length > 0
                    ? Object.fromEntries(Object.entries(adSource).filter(([, v]) => v))
                    : undefined,
                // Structured lead data as encrypted payload
                encryptedData: leadDataRows.length > 0
                    ? JSON.stringify(Object.fromEntries(leadDataRows.filter(r => r.key).map(r => [r.key, r.value])))
                    : data.encryptedData || undefined,
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
                                        {dynamicVerticals.filter(v => v.depth === 0).map((v) => (
                                            <SelectItem key={v.value} value={v.value}>
                                                {v.label}
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
                                        <SelectItem value="5">5 minutes</SelectItem>
                                        <SelectItem value="15">15 minutes</SelectItem>
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

                    {/* Ad Tracking (Optional) */}
                    <div className="border border-border rounded-xl overflow-hidden">
                        <button
                            type="button"
                            className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                            onClick={() => setShowAdTracking(!showAdTracking)}
                        >
                            <div className="flex items-center gap-2">
                                <Megaphone className="h-4 w-4 text-orange-500" />
                                <span className="text-sm font-medium">Ad Tracking (Optional)</span>
                                <span className="text-xs text-muted-foreground" title="Track which ad campaign generated this lead for ROI analytics">
                                    <Info className="h-3 w-3 inline" />
                                </span>
                            </div>
                            {showAdTracking ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {showAdTracking && (
                            <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                                <div className="grid grid-cols-3 gap-2">
                                    <div>
                                        <label className="text-xs text-muted-foreground mb-1 block">UTM Source</label>
                                        <Input
                                            placeholder="google"
                                            value={adSource.utm_source || ''}
                                            onChange={(e) => setAdSource(s => ({ ...s, utm_source: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-muted-foreground mb-1 block">UTM Medium</label>
                                        <Input
                                            placeholder="cpc"
                                            value={adSource.utm_medium || ''}
                                            onChange={(e) => setAdSource(s => ({ ...s, utm_medium: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-muted-foreground mb-1 block">UTM Campaign</label>
                                        <Input
                                            placeholder="solar_q1"
                                            value={adSource.utm_campaign || ''}
                                            onChange={(e) => setAdSource(s => ({ ...s, utm_campaign: e.target.value }))}
                                        />
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="text-xs text-primary hover:underline flex items-center gap-1"
                                    onClick={() => setShowMoreUtm(!showMoreUtm)}
                                >
                                    {showMoreUtm ? 'Less' : 'More tracking fields'}
                                    {showMoreUtm ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                </button>
                                {showMoreUtm && (
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-xs text-muted-foreground mb-1 block">UTM Content</label>
                                            <Input
                                                placeholder="banner_v2"
                                                value={adSource.utm_content || ''}
                                                onChange={(e) => setAdSource(s => ({ ...s, utm_content: e.target.value }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-muted-foreground mb-1 block">UTM Term</label>
                                            <Input
                                                placeholder="solar panels"
                                                value={adSource.utm_term || ''}
                                                onChange={(e) => setAdSource(s => ({ ...s, utm_term: e.target.value }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-muted-foreground mb-1 block">Ad ID</label>
                                            <Input
                                                placeholder="ad_123456"
                                                value={adSource.ad_id || ''}
                                                onChange={(e) => setAdSource(s => ({ ...s, ad_id: e.target.value }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-muted-foreground mb-1 block">Ad Platform</label>
                                            <select
                                                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                                value={adSource.ad_platform || ''}
                                                onChange={(e) => setAdSource(s => ({ ...s, ad_platform: e.target.value }))}
                                            >
                                                <option value="">Select platform</option>
                                                <option value="google">Google</option>
                                                <option value="facebook">Facebook</option>
                                                <option value="tiktok">TikTok</option>
                                                <option value="linkedin">LinkedIn</option>
                                                <option value="bing">Bing</option>
                                                <option value="other">Other</option>
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Lead Data — Structured Editor */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <label className="text-sm font-medium">Lead Data (Encrypted)</label>
                                <span className="text-xs text-muted-foreground" title="Custom lead data (encrypted before storage). Add key-value pairs for buyer matching.">
                                    <Info className="h-3 w-3 inline" />
                                </span>
                            </div>
                            <button
                                type="button"
                                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                                onClick={() => {
                                    if (!rawJsonMode && leadDataRows.length > 0) {
                                        // Switching to raw: serialize rows
                                        const obj = Object.fromEntries(leadDataRows.filter(r => r.key).map(r => [r.key, r.value]));
                                        setRawJsonText(JSON.stringify(obj, null, 2));
                                    } else if (rawJsonMode && rawJsonText.trim()) {
                                        // Switching to structured: parse JSON
                                        try {
                                            const obj = JSON.parse(rawJsonText);
                                            setLeadDataRows(Object.entries(obj).map(([k, v]) => ({ key: k, value: String(v) })));
                                            setJsonError(null);
                                        } catch {
                                            setJsonError('Invalid JSON — fix before switching');
                                            return;
                                        }
                                    }
                                    setRawJsonMode(!rawJsonMode);
                                }}
                            >
                                <Code className="h-3 w-3" />
                                {rawJsonMode ? 'Key-Value' : 'Raw JSON'}
                            </button>
                        </div>

                        {rawJsonMode ? (
                            <div>
                                <Textarea
                                    className="font-mono text-xs min-h-[120px]"
                                    placeholder='{"borrower_name": "Jane Smith", "loan_amount": "350000"}'
                                    value={rawJsonText}
                                    onChange={(e) => {
                                        setRawJsonText(e.target.value);
                                        if (jsonError) {
                                            try { JSON.parse(e.target.value); setJsonError(null); } catch { /* still invalid */ }
                                        }
                                    }}
                                    onBlur={() => {
                                        if (rawJsonText.trim()) {
                                            try {
                                                JSON.parse(rawJsonText);
                                                setJsonError(null);
                                            } catch {
                                                setJsonError('Invalid JSON format');
                                            }
                                        } else {
                                            setJsonError(null);
                                        }
                                    }}
                                />
                                {jsonError && (
                                    <p className="text-xs text-destructive mt-1">{jsonError}</p>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {leadDataRows.map((row, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                        <Input
                                            className="flex-1 text-sm"
                                            placeholder="Key"
                                            value={row.key}
                                            onChange={(e) => {
                                                const updated = [...leadDataRows];
                                                updated[idx] = { ...updated[idx], key: e.target.value };
                                                setLeadDataRows(updated);
                                            }}
                                        />
                                        <span className="text-muted-foreground text-xs">·</span>
                                        <Input
                                            className="flex-1 text-sm"
                                            placeholder="Value"
                                            value={row.value}
                                            onChange={(e) => {
                                                const updated = [...leadDataRows];
                                                updated[idx] = { ...updated[idx], value: e.target.value };
                                                setLeadDataRows(updated);
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="text-muted-foreground hover:text-destructive transition-colors"
                                            onClick={() => setLeadDataRows(rows => rows.filter((_, i) => i !== idx))}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="w-full flex items-center justify-center gap-1 py-2 border border-dashed border-border rounded-lg text-xs text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                                    onClick={() => {
                                        if (leadDataRows.length === 0 && selectedVertical && verticalPlaceholders[selectedVertical]) {
                                            setLeadDataRows(verticalPlaceholders[selectedVertical]);
                                        } else {
                                            setLeadDataRows(rows => [...rows, { key: '', value: '' }]);
                                        }
                                    }}
                                >
                                    <Plus className="h-3 w-3" />
                                    {leadDataRows.length === 0 && selectedVertical ? 'Add sample data' : 'Add field'}
                                </button>
                            </div>
                        )}
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
