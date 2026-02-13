import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { ChevronRight, ChevronLeft, Check, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LabeledSwitch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { GeoFilter } from '@/components/marketplace/GeoFilter';
import api from '@/lib/api';
import { useVerticals } from '@/hooks/useVerticals';



const askSchema = z.object({
    vertical: z.string().min(1, 'Select a vertical'),
    geoTargets: z.object({
        country: z.string().length(2).default('US'),
        states: z.array(z.string()).optional(),
    }),
    reservePrice: z.number().positive('Reserve price required'),
    buyNowPrice: z.number().positive().optional(),
    acceptOffSite: z.boolean().default(true),
    auctionDuration: z.number().min(300).max(86400).default(3600),
    revealWindow: z.number().min(60).max(3600).default(900),
    expiresInDays: z.number().min(1).max(90).default(30),
    parameters: z.record(z.unknown()).optional(),
});

type AskFormData = z.infer<typeof askSchema>;

interface AskFormProps {
    onSuccess?: (ask: any) => void;
}

export function AskForm({ onSuccess }: AskFormProps) {
    const [step, setStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { flatList: dynamicVerticals, loading: verticalsLoading } = useVerticals();

    const { register, handleSubmit, control, formState: { errors } } = useForm<AskFormData>({
        resolver: zodResolver(askSchema),
        defaultValues: {
            geoTargets: { country: 'US', states: [] },
            acceptOffSite: true,
            auctionDuration: 3600,
            revealWindow: 900,
            expiresInDays: 30,
        },
    });

    const onSubmit = async (data: AskFormData) => {
        setIsSubmitting(true);
        setError(null);

        try {
            const { data: result, error: apiError } = await api.createAsk(data);
            if (apiError) {
                setError(apiError.error);
                return;
            }
            onSuccess?.(result?.ask);
        } catch (err) {
            setError('Failed to create ask');
        } finally {
            setIsSubmitting(false);
        }
    };

    const steps = [
        { num: 1, title: 'Vertical & Geo' },
        { num: 2, title: 'Pricing' },
        { num: 3, title: 'Settings' },
    ];

    return (
        <Card className="max-w-2xl mx-auto">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Tag className="h-5 w-5 text-primary" />
                    Create Ask
                </CardTitle>

                {/* Progress Steps */}
                <div className="flex items-center justify-between pt-4">
                    {steps.map((s, i) => (
                        <div key={s.num} className="flex items-center">
                            <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center font-medium text-sm ${step > s.num
                                    ? 'bg-primary text-primary-foreground'
                                    : step === s.num
                                        ? 'bg-primary/20 text-primary border-2 border-primary'
                                        : 'bg-muted text-muted-foreground'
                                    }`}
                            >
                                {step > s.num ? <Check className="h-4 w-4" /> : s.num}
                            </div>
                            <span className={`ml-2 text-sm hidden sm:inline ${step >= s.num ? '' : 'text-muted-foreground'}`}>
                                {s.title}
                            </span>
                            {i < steps.length - 1 && (
                                <div className={`w-8 sm:w-16 h-0.5 mx-2 ${step > s.num ? 'bg-primary' : 'bg-muted'}`} />
                            )}
                        </div>
                    ))}
                </div>
            </CardHeader>

            <CardContent>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    {/* Step 1: Vertical & Geo */}
                    {step === 1 && (
                        <div className="space-y-6">
                            <div>
                                <label className="text-sm font-medium mb-2 block">Vertical</label>
                                <Controller
                                    name="vertical"
                                    control={control}
                                    render={({ field }) => {
                                        const [vSearch, setVSearch] = useState('');
                                        const [vOpen, setVOpen] = useState(false);
                                        const allVerticals = dynamicVerticals.filter(v => v.depth === 0);
                                        const filtered = vSearch
                                            ? allVerticals.filter(v =>
                                                v.label.toLowerCase().includes(vSearch.toLowerCase()) ||
                                                v.value.toLowerCase().includes(vSearch.toLowerCase())
                                            )
                                            : allVerticals;
                                        const selectedLabel = allVerticals.find(v => v.value === field.value)?.label;

                                        return (
                                            <div className="relative">
                                                <div
                                                    className="flex items-center w-full rounded-xl border border-input bg-background px-4 py-2.5 cursor-pointer hover:border-primary/50 transition-colors"
                                                    onClick={() => setVOpen(!vOpen)}
                                                >
                                                    <input
                                                        type="text"
                                                        className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                                                        placeholder="Search verticals…"
                                                        value={vOpen ? vSearch : (selectedLabel || '')}
                                                        onChange={(e) => {
                                                            setVSearch(e.target.value);
                                                            if (!vOpen) setVOpen(true);
                                                        }}
                                                        onFocus={() => { setVOpen(true); setVSearch(''); }}
                                                    />
                                                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${vOpen ? 'rotate-90' : ''}`} />
                                                </div>

                                                {vOpen && (
                                                    <>
                                                        <div className="fixed inset-0 z-30" onClick={() => setVOpen(false)} />
                                                        <div className="absolute z-40 top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover shadow-xl">
                                                            {verticalsLoading ? (
                                                                <div className="px-4 py-3 text-sm text-muted-foreground">Loading verticals…</div>
                                                            ) : filtered.length === 0 ? (
                                                                <div className="px-4 py-3 text-sm text-muted-foreground">No verticals match "{vSearch}"</div>
                                                            ) : (
                                                                filtered.map((v) => (
                                                                    <button
                                                                        key={v.value}
                                                                        type="button"
                                                                        className={cn(
                                                                            'w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between',
                                                                            field.value === v.value
                                                                                ? 'bg-primary/10 text-primary font-medium'
                                                                                : 'hover:bg-muted/50'
                                                                        )}
                                                                        onClick={() => {
                                                                            field.onChange(v.value);
                                                                            setVSearch('');
                                                                            setVOpen(false);
                                                                        }}
                                                                    >
                                                                        {v.label}
                                                                        {field.value === v.value && <Check className="h-4 w-4 text-primary" />}
                                                                    </button>
                                                                ))
                                                            )}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    }}
                                />
                                {errors.vertical && <p className="text-xs text-destructive mt-1">{errors.vertical.message}</p>}
                            </div>

                            <div>
                                <label className="text-sm font-medium mb-2 block">Target Geography</label>
                                <Controller
                                    name="geoTargets"
                                    control={control}
                                    render={({ field }) => (
                                        <GeoFilter
                                            country={field.value?.country || 'US'}
                                            onCountryChange={(country) => field.onChange({ ...field.value, country, states: [] })}
                                            selectedRegions={field.value?.states || []}
                                            onRegionsChange={(states) => field.onChange({ ...field.value, states })}
                                            mode="include"
                                        />
                                    )}
                                />
                                <p className="text-xs text-muted-foreground mt-2">
                                    Select a country and optionally narrow by region. Leave regions empty to accept all.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Pricing */}
                    {step === 2 && (
                        <div className="space-y-6">
                            <div>
                                <label className="text-sm font-medium mb-2 block">Reserve Price (USDC)</label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="50.00"
                                    {...register('reservePrice', { valueAsNumber: true })}
                                    error={errors.reservePrice?.message}
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Minimum bid amount you'll accept
                                </p>
                            </div>

                            <div>
                                <label className="text-sm font-medium mb-2 block">Buy Now Price (Optional)</label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="100.00"
                                    {...register('buyNowPrice', { valueAsNumber: true })}
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Instant purchase price, skips auction
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Settings */}
                    {step === 3 && (
                        <div className="space-y-6">
                            <Controller
                                name="acceptOffSite"
                                control={control}
                                render={({ field }) => (
                                    <LabeledSwitch
                                        label="Accept Off-site Leads"
                                        description="Receive leads from external sources and landers"
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                )}
                            />

                            <div>
                                <label className="text-sm font-medium mb-2 block">Auction Duration</label>
                                <Controller
                                    name="auctionDuration"
                                    control={control}
                                    render={({ field }) => (
                                        <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value.toString()}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="1800">30 minutes</SelectItem>
                                                <SelectItem value="3600">1 hour</SelectItem>
                                                <SelectItem value="7200">2 hours</SelectItem>
                                                <SelectItem value="14400">4 hours</SelectItem>
                                                <SelectItem value="43200">12 hours</SelectItem>
                                                <SelectItem value="86400">24 hours</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                            </div>

                            <div>
                                <label className="text-sm font-medium mb-2 block">Ask Expiry</label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={90}
                                    {...register('expiresInDays', { valueAsNumber: true })}
                                />
                                <p className="text-xs text-muted-foreground mt-1">Days until this ask expires</p>
                            </div>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                            {error}
                        </div>
                    )}

                    {/* Navigation */}
                    <div className="flex justify-between pt-4">
                        {step > 1 ? (
                            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                                <ChevronLeft className="h-4 w-4 mr-1" />
                                Back
                            </Button>
                        ) : (
                            <div />
                        )}

                        {step < 3 ? (
                            <Button type="button" onClick={() => setStep(step + 1)}>
                                Next
                                <ChevronRight className="h-4 w-4 ml-1" />
                            </Button>
                        ) : (
                            <Button type="submit" loading={isSubmitting}>
                                Create Ask
                            </Button>
                        )}
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

export default AskForm;
