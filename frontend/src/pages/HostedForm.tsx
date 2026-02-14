/**
 * HostedForm — Public-facing multi-step form wizard
 *
 * Route: /f/:slug  (e.g. /f/roofing--clxyz123 or /f/solar.residential--cmxyz456)
 * The slug format is: {verticalSlug}--{sellerId}
 *
 * Fetches formConfig from the public API, renders a fully functional
 * multi-step wizard with progress bar, validation, and submission.
 * Delegates all rendering to the shared FormPreview component.
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import api from '@/lib/api';
import FormPreview from '@/components/forms/FormPreview';
import type { FormPreviewColors } from '@/components/forms/FormPreview';
import { COLOR_SCHEMES } from '@/constants/formPresets';
import type { FormField, FormStep } from '@/types/formBuilder';

// ─── Default colors (Dark scheme) ─────────────────────────────────
const DEFAULT_COLORS: FormPreviewColors = {
    bg: COLOR_SCHEMES[0].vars['--form-bg'],
    text: COLOR_SCHEMES[0].vars['--form-text'],
    accent: COLOR_SCHEMES[0].vars['--form-accent'],
    border: COLOR_SCHEMES[0].vars['--form-border'],
    inputBg: COLOR_SCHEMES[0].vars['--form-input-bg'],
    muted: COLOR_SCHEMES[0].vars['--form-muted'],
};

interface FormConfig {
    fields: FormField[];
    steps: FormStep[];
    gamification?: { showProgress?: boolean; showNudges?: boolean };
}

// ─── Component ────────────────────────────────────────────────────
export default function HostedForm() {
    const { slug } = useParams<{ slug: string }>();

    const { verticalSlug, sellerId } = useMemo(() => {
        if (!slug) return { verticalSlug: '', sellerId: '' };
        const idx = slug.indexOf('--');
        if (idx > 0) {
            return {
                verticalSlug: slug.substring(0, idx),
                sellerId: slug.substring(idx + 2),
            };
        }
        return { verticalSlug: slug, sellerId: '' };
    }, [slug]);

    const [config, setConfig] = useState<FormConfig | null>(null);
    const [verticalName, setVerticalName] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Color state — starts with defaults, overridden by seller's saved config
    const [colors, setColors] = useState<FormPreviewColors>(DEFAULT_COLORS);

    const [currentStep, setCurrentStep] = useState(0);
    const [formData, setFormData] = useState<Record<string, string | boolean>>({});
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Fetch form config
    useEffect(() => {
        if (!verticalSlug) return;
        setLoading(true);
        api.getPublicFormConfig(verticalSlug)
            .then((res) => {
                if (!res.data) throw new Error('No data');
                setConfig(res.data.formConfig as FormConfig);
                setVerticalName(res.data.vertical.name);
            })
            .catch(() => setError('This form is not available or has expired.'))
            .finally(() => setLoading(false));
    }, [verticalSlug]);

    // Fetch seller-specific template colors
    useEffect(() => {
        if (!verticalSlug || !sellerId) return;
        api.getPublicTemplateConfig(verticalSlug, sellerId)
            .then((res) => {
                const tc = res.data?.templateConfig;
                if (tc?.bg && tc?.text && tc?.accent) {
                    setColors({
                        bg: tc.bg,
                        text: tc.text,
                        accent: tc.accent,
                        border: tc.border || DEFAULT_COLORS.border,
                        inputBg: tc.inputBg || DEFAULT_COLORS.inputBg,
                        muted: tc.muted || DEFAULT_COLORS.muted,
                    });
                }
            })
            .catch(() => { /* fallback to DEFAULT_COLORS */ });
    }, [verticalSlug, sellerId]);

    // Derived
    const steps = config?.steps || [];
    const fields = config?.fields || [];
    const currentFields = useMemo(() => {
        if (!steps.length || !fields.length) return fields;
        const step = steps[currentStep];
        if (!step) return [];
        return step.fieldIds
            .map(id => fields.find(f => f.id === id))
            .filter(Boolean) as FormField[];
    }, [steps, fields, currentStep]);

    const isLastStep = currentStep === Math.max(steps.length - 1, 0);

    function updateField(key: string, value: string | boolean) {
        setFormData(prev => ({ ...prev, [key]: value }));
        setFieldErrors(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }

    function validateStep(): boolean {
        const errors: Record<string, string> = {};
        for (const f of currentFields) {
            const val = formData[f.key];
            if (f.required && (val === undefined || val === '')) {
                errors[f.key] = `${f.label} is required`;
            }
            if (f.type === 'email' && val && typeof val === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
                errors[f.key] = 'Please enter a valid email';
            }
            if (f.type === 'phone' && val && typeof val === 'string' && !/^[\d\s\-+()]{7,}$/.test(val)) {
                errors[f.key] = 'Please enter a valid phone number';
            }
        }
        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    }

    function handleNext() {
        if (!validateStep()) return;
        if (isLastStep) {
            handleSubmit();
        } else {
            setCurrentStep(s => s + 1);
        }
    }

    function handleBack() {
        if (currentStep > 0) setCurrentStep(s => s - 1);
    }

    async function handleSubmit() {
        if (!validateStep()) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const geo: Record<string, string> = { country: String(formData.country || 'US') };
            if (formData.state) geo.state = String(formData.state);
            if (formData.city) geo.city = String(formData.city);
            if (formData.zip || formData.zipCode || formData.zip_code) {
                geo.zip = String(formData.zip || formData.zipCode || formData.zip_code);
            }

            const res = await api.submitPublicLead({
                sellerId,
                vertical: verticalSlug,
                parameters: formData as Record<string, unknown>,
                geo,
            });

            if (res.error) {
                throw new Error(res.error.message || res.error.error || 'Submission failed');
            }

            console.log('[HostedForm] Lead submitted:', res.data?.lead?.id);
            setSubmitted(true);
        } catch (err: any) {
            console.error('[HostedForm] Submit error:', err);
            setSubmitError(err.message || 'Something went wrong. Please try again.');
        } finally {
            setSubmitting(false);
        }
    }

    // ─── Loading state ───────────────────────────────────────
    if (loading) {
        return (
            <div style={{ minHeight: '100vh', backgroundColor: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 style={{ width: 32, height: 32, color: colors.accent, animation: 'spin 1s linear infinite' }} />
            </div>
        );
    }

    // ─── Error state ─────────────────────────────────────────
    if (error || !config) {
        return (
            <div style={{ minHeight: '100vh', backgroundColor: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                <div style={{ textAlign: 'center' }}>
                    <AlertCircle style={{ width: 48, height: 48, color: '#ef4444', margin: '0 auto 1rem' }} />
                    <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: colors.text, marginBottom: '0.5rem' }}>Form Not Found</h1>
                    <p style={{ color: colors.muted, fontSize: '0.875rem', maxWidth: 384 }}>
                        {error || 'This form is not available. Please check the URL and try again.'}
                    </p>
                </div>
            </div>
        );
    }

    // ─── Submitted state ─────────────────────────────────────
    if (submitted) {
        return (
            <div style={{ minHeight: '100vh', backgroundColor: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                <div style={{ textAlign: 'center', maxWidth: 448 }}>
                    <div style={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: 'rgba(34,197,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                        <CheckCircle style={{ width: 32, height: 32, color: '#4ade80' }} />
                    </div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: colors.text, marginBottom: '0.5rem' }}>Thank You!</h1>
                    <p style={{ color: colors.muted }}>
                        Your information has been submitted successfully. A specialist will be in touch shortly.
                    </p>
                    <p style={{ fontSize: '0.7rem', color: colors.muted, marginTop: '1.5rem', opacity: 0.5 }}>Powered by Lead Engine</p>
                </div>
            </div>
        );
    }

    // ─── Form wizard ─────────────────────────────────────────
    return (
        <FormPreview
            verticalName={verticalName}
            verticalSlug={verticalSlug}
            fields={fields}
            steps={steps}
            currentStep={currentStep}
            colors={colors}
            showProgress={config.gamification?.showProgress !== false}
            showNudges={config.gamification?.showNudges !== false}
            ctaText="Submit"
            formData={formData}
            fieldErrors={fieldErrors}
            onFieldChange={updateField}
            onNext={handleNext}
            onBack={handleBack}
            submitting={submitting}
            submitError={submitError}
        />
    );
}
