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

    const { register, handleSubmit, control, formState: { errors }, setValue: _setValue } = useForm<LeadFormData>({
        resolver: zodResolver(leadSchema),
        defaultValues: {
            source,
            expiresInMinutes: 60,
            geo: {},
        },
    });

    const onSubmit = async (data: LeadFormData) => {
        if (!tcpaConsent) {
            setError('TCPA consent is required');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const submitData = {
                ...data,
                tcpaConsentAt: new Date().toISOString(),
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
                        {source === 'PLATFORM' && <FileText className="h-4 w-4 text-blue-500" />}
                        {source === 'API' && <Globe className="h-4 w-4 text-purple-500" />}
                        {source === 'OFFSITE' && <Globe className="h-4 w-4 text-yellow-500" />}
                        <span className="text-sm font-medium">Source: {source}</span>
                    </div>

                    {/* Vertical */}
                    <div>
                        <label className="text-sm font-medium mb-2 block">Vertical</label>
                        <Controller
                            name="vertical"
                            control={control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
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
                            <Shield className="h-5 w-5 text-green-500 mt-0.5" />
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
