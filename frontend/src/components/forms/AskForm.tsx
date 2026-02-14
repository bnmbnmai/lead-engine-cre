import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { ChevronRight, ChevronLeft, Check, Tag, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LabeledSwitch } from '@/components/ui/switch';
import { NestedVerticalSelect } from '@/components/ui/NestedVerticalSelect';
import { GeoFilter } from '@/components/marketplace/GeoFilter';
import api from '@/lib/api';



const askSchema = z.object({
    vertical: z.string().min(1, 'Select a vertical'),
    geoTargets: z.object({
        country: z.string().length(2).default('US'),
        states: z.array(z.string()).optional(),
    }),
    reservePrice: z.number().positive('Reserve price required'),
    buyNowPrice: z.number().positive().optional(),
    acceptOffSite: z.boolean().default(true),
    auctionDuration: z.number().min(30).max(300).default(60),
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

    const { register, handleSubmit, control, formState: { errors } } = useForm<AskFormData>({
        resolver: zodResolver(askSchema),
        defaultValues: {
            geoTargets: { country: 'US', states: [] },
            acceptOffSite: true,
            auctionDuration: 60,
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
                                    render={({ field }) => (
                                        <NestedVerticalSelect
                                            value={field.value}
                                            onValueChange={field.onChange}
                                            placeholder="Select a vertical"
                                            error={errors.vertical?.message}
                                        />
                                    )}
                                />
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
                                <label className="text-sm font-medium mb-1 flex items-center gap-2">
                                    <Zap className="h-4 w-4 text-violet-400" />
                                    Smart Lightning
                                </label>
                                <p className="text-xs text-muted-foreground mb-3">
                                    All leads flow through Smart Lightning — ping buyers instantly, then fallback to auction if needed.
                                </p>
                                <Controller
                                    name="auctionDuration"
                                    control={control}
                                    render={({ field }) => (
                                        <div className="grid grid-cols-3 gap-3">
                                            {([
                                                { value: 60, label: 'Hot', icon: '⚡', desc: '60s ping-post only — fastest close', sub: 'Ping-Post' },
                                                { value: 360, label: 'Standard', icon: '🎯', desc: '60s ping-post + 5m auction fallback', sub: 'Recommended' },
                                                { value: 300, label: 'Extended', icon: '🔍', desc: '5m direct auction — max price discovery', sub: 'Full Auction' },
                                            ] as const).map((preset) => (
                                                <button
                                                    key={preset.value}
                                                    type="button"
                                                    onClick={() => field.onChange(preset.value)}
                                                    className={`relative flex flex-col items-center p-4 rounded-xl border-2 text-center transition-all duration-200 cursor-pointer
                                                        ${field.value === preset.value
                                                            ? 'border-violet-500 bg-violet-500/5 ring-2 ring-violet-500/20 shadow-sm'
                                                            : 'border-border hover:border-violet-400/40 hover:bg-accent/50'
                                                        }`}
                                                >
                                                    <span className="text-2xl mb-1.5">{preset.icon}</span>
                                                    <span className="font-semibold text-sm">{preset.label}</span>
                                                    <span className="text-xs font-medium text-violet-400 mt-0.5">{preset.sub}</span>
                                                    <span className="text-[10px] text-muted-foreground mt-1 leading-tight">{preset.desc}</span>
                                                    {field.value === preset.value && (
                                                        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center">
                                                            <Check className="h-3 w-3 text-white" />
                                                        </div>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
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
