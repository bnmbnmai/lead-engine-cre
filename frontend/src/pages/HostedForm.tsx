/**
 * HostedForm — Public-facing multi-step form wizard with CRO features
 *
 * Route: /f/:slug  (e.g. /f/roofing--clxyz123 or /f/solar.residential--cmxyz456)
 * The slug format is: {verticalSlug}--{sellerId}
 *
 * CRO features:
 *  - TrustBar + SocialProof above the form
 *  - Form state persistence via sessionStorage
 *  - UTM param pre-fill
 *  - Exit-intent modal
 *  - Speed badge on thank-you page
 *  - A/B variant support (?variant=B)
 *  - Keyboard navigation (Enter → next step)
 *  - Confetti on successful submit
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, Loader2, AlertCircle, Shield } from 'lucide-react';
import api from '@/lib/api';
import FormPreview from '@/components/forms/FormPreview';
import type { FormPreviewColors } from '@/components/forms/FormPreview';
import { COLOR_SCHEMES } from '@/constants/formPresets';
import type { FormField, FormStep, CROConfig } from '@/types/formBuilder';
import { DEFAULT_CRO_CONFIG } from '@/types/formBuilder';
import { useFormPersistence } from '@/hooks/useFormPersistence';
import { useUTMPrefill } from '@/hooks/useUTMPrefill';
import TrustBar from '@/components/forms/TrustBar';

import ExitIntentModal from '@/components/forms/ExitIntentModal';
import SpeedBadge from '@/components/forms/SpeedBadge';

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
    gamification?: { showProgress?: boolean; showNudges?: boolean; confetti?: boolean };
}

// ─── A/B Variant helpers ──────────────────────────────────────────
type Variant = 'A' | 'B';

function getVariant(): Variant {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('variant')?.toUpperCase();
    if (v === 'B') return 'B';
    // Sticky variant so user always sees the same one
    const stored = sessionStorage.getItem('form_variant');
    if (stored === 'B') return 'B';
    return 'A';
}

// ─── Vertical-specific CRO headlines ─────────────────────────────────
const VERTICAL_HEADLINES: Record<string, { headline: string; subline: string }> = {
    'solar': { headline: 'Get Your Free Solar Quote', subline: 'Compare top-rated installers in your area — no obligation.' },
    'solar.residential': { headline: 'Get Your Free Solar Quote', subline: 'See how much you can save with residential solar.' },
    'solar.commercial': { headline: 'Commercial Solar Savings', subline: 'Get custom proposals from certified commercial installers.' },
    'roofing': { headline: 'Free Roofing Estimate', subline: 'Get matched with licensed roofers near you in 60 seconds.' },
    'roofing.repair': { headline: 'Roof Repair Quotes', subline: 'Connect with vetted contractors for fast, affordable repairs.' },
    'roofing.replacement': { headline: 'Time for a New Roof?', subline: 'Compare replacement quotes from top local roofers.' },
    'mortgage': { headline: 'Find Your Best Mortgage Rate', subline: 'Compare offers from trusted lenders — no credit check to start.' },
    'mortgage.refinance': { headline: 'Lower Your Mortgage Payment', subline: 'See today\'s refinance rates from competing lenders.' },
    'mortgage.purchase': { headline: 'Get Pre-Approved Today', subline: 'Compare purchase rates from top lenders in minutes.' },
    'insurance': { headline: 'Compare Insurance Quotes', subline: 'Find the best coverage at the lowest price.' },
    'insurance.auto': { headline: 'Save on Auto Insurance', subline: 'Compare rates from top carriers in under 2 minutes.' },
    'insurance.home': { headline: 'Protect Your Home for Less', subline: 'Compare homeowners insurance from top-rated providers.' },
    'home_services': { headline: 'Get Free Estimates', subline: 'Connect with top-rated local pros in your area.' },
};

const DEFAULT_HEADLINE = { headline: 'Get Your Free Quote', subline: 'Takes less than 60 seconds — no obligation, no commitment.' };

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
    const [croConfig, setCroConfig] = useState<CROConfig>(DEFAULT_CRO_CONFIG);
    const [verticalName, setVerticalName] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Color state — starts with defaults, overridden by seller's saved config
    const [colors, setColors] = useState<FormPreviewColors>(DEFAULT_COLORS);

    // Seller branding — loaded from template config
    const [sellerCompanyName, setSellerCompanyName] = useState<string | undefined>();
    const [sellerLogoUrl, setSellerLogoUrl] = useState<string | undefined>();
    const [sellerCtaText, setSellerCtaText] = useState<string | undefined>();
    const [sellerThankYouMsg, setSellerThankYouMsg] = useState<string | undefined>();
    const [sellerGamification, setSellerGamification] = useState<{ showProgress?: boolean; showNudges?: boolean; confetti?: boolean } | undefined>();

    const [currentStep, setCurrentStep] = useState(0);
    const [formData, setFormData] = useState<Record<string, string | boolean>>({});
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    // CRO state
    const formStartTime = useRef(Date.now());
    const [elapsedMs, setElapsedMs] = useState(0);
    const variant = useMemo(() => {
        const v = getVariant();
        sessionStorage.setItem('form_variant', v);
        return v;
    }, []);

    // Fetch form config
    useEffect(() => {
        if (!verticalSlug) return;
        setLoading(true);
        api.getPublicFormConfig(verticalSlug)
            .then((res) => {
                if (!res.data) throw new Error('No data');
                setConfig(res.data.formConfig as FormConfig);
                setVerticalName(res.data.vertical.name);
                // CROConfig returned by backend (typed, no cast needed)
                if (res.data.croConfig) {
                    setCroConfig({ ...DEFAULT_CRO_CONFIG, ...res.data.croConfig });
                }
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
                // Load seller branding / gamification / CTA
                if (tc?.companyName) setSellerCompanyName(tc.companyName);
                if (tc?.logoUrl) setSellerLogoUrl(tc.logoUrl);
                if (tc?.ctaText) setSellerCtaText(tc.ctaText);
                if (tc?.thankYouMessage) setSellerThankYouMsg(tc.thankYouMessage);
                if (tc?.gamification) setSellerGamification(tc.gamification);
                // Merge any CRO overrides from seller config
                if (tc?.croConfig) {
                    setCroConfig(prev => ({ ...prev, ...tc.croConfig }));
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

    // ─── CRO Hooks ───────────────────────────────────────────
    const setFormDataCb = useCallback((data: Record<string, string | boolean>) => setFormData(data), []);
    const setCurrentStepCb = useCallback((step: number) => setCurrentStep(step), []);

    const { clear: clearPersistence } = useFormPersistence({
        slug: slug || '',
        formData,
        currentStep,
        setFormData: setFormDataCb,
        setCurrentStep: setCurrentStepCb,
        enabled: croConfig.persistFormState,
    });

    useUTMPrefill({
        fields,
        formData,
        setFormData,
        enabled: croConfig.utmPrefill && fields.length > 0,
    });

    // ─── Handlers ─────────────────────────────────────────────
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
            // Skip hidden conditional fields
            if (f.showWhen && formData[f.showWhen.field] !== f.showWhen.equals) continue;

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

    // Keyboard: Enter advances to next step
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Enter' && !submitting && !submitted && config) {
                e.preventDefault();
                handleNext();
            }
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentStep, formData, submitting, submitted, config]);

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
                parameters: {
                    ...formData,
                    _variant: variant,
                    _completionMs: Date.now() - formStartTime.current,
                } as Record<string, unknown>,
                geo,
            });

            if (res.error) {
                throw new Error(res.error.message || res.error.error || 'Submission failed');
            }

            console.log('[HostedForm] Lead submitted:', res.data?.lead?.id);
            setElapsedMs(Date.now() - formStartTime.current);
            clearPersistence();
            setSubmitted(true);
        } catch (err: any) {
            console.error('[HostedForm] Submit error:', err);
            setSubmitError(err.message || 'Something went wrong. Please try again.');
        } finally {
            setSubmitting(false);
        }
    }

    // ─── Filled field count (for ExitIntent) ──────────────────
    const filledFieldCount = useMemo(
        () => fields.filter(f => formData[f.key] !== undefined && formData[f.key] !== '').length,
        [fields, formData]
    );

    // ─── Variant-specific CTA ─────────────────────────────────
    const ctaText = sellerCtaText || (variant === 'B' ? 'See My Options Now →' : 'Get My Free Quote');

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

    // ─── Submitted / Thank You state ─────────────────────────
    if (submitted) {
        return (
            <div style={{ minHeight: '100vh', backgroundColor: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                <div style={{ textAlign: 'center', maxWidth: 448 }}>
                    <div style={{
                        width: 72,
                        height: 72,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(34,197,94,0.05))',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 1.25rem',
                        animation: 'fp-fadeIn 0.5s ease-out',
                    }}>
                        <CheckCircle style={{ width: 36, height: 36, color: '#4ade80' }} />
                    </div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: colors.text, marginBottom: '0.5rem' }}>
                        Thank You! 🎉
                    </h1>
                    <p style={{ color: colors.muted, fontSize: '0.9rem', lineHeight: 1.6 }}>
                        {sellerThankYouMsg || 'Your information has been submitted successfully. A qualified specialist will be in touch shortly.'}
                    </p>

                    {/* Speed Badge */}
                    {croConfig.showSpeedBadge && elapsedMs > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
                            <SpeedBadge elapsedMs={elapsedMs} accentColor={colors.accent} mutedColor={colors.muted} />
                        </div>
                    )}

                    {/* Trust reinforcement */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        marginTop: '1.5rem',
                        padding: '0.6rem 1rem',
                        borderRadius: '0.5rem',
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                    }}>
                        <Shield style={{ width: 14, height: 14, color: '#3b82f6' }} />
                        <span style={{ fontSize: '0.7rem', color: colors.muted }}>
                            Your info is safe — we never share without your permission
                        </span>
                    </div>

                    <p style={{ fontSize: '0.65rem', color: colors.muted, marginTop: '1.5rem', opacity: 0.4 }}>
                        Powered by Lead Engine
                    </p>
                </div>
            </div>
        );
    }

    // ─── Vertical headline ─────────────────────────────────────────────
    const headlineConfig = VERTICAL_HEADLINES[verticalSlug] || DEFAULT_HEADLINE;

    // ─── Form wizard with CRO layers ───────────────────────
    return (
        <div style={{ backgroundColor: colors.bg, minHeight: '100dvh' }}>
            <div style={{ maxWidth: 480, margin: '0 auto', padding: '2.5rem 1rem 2rem', width: '100%' }}>
                {/* Vertical-specific headline */}
                <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                    <h1 style={{
                        fontSize: '1.5rem',
                        fontWeight: 700,
                        color: colors.text,
                        marginBottom: '0.35rem',
                        lineHeight: 1.3,
                    }}>
                        {headlineConfig.headline}
                    </h1>
                    <p style={{ fontSize: '0.85rem', color: colors.muted, lineHeight: 1.5 }}>
                        {headlineConfig.subline}
                    </p>
                </div>

                {/* Trust bar + social proof — single compact line */}
                {croConfig.showTrustBar && (
                    <TrustBar mutedColor={colors.muted} />
                )}

                {/* The Form */}
                <FormPreview
                    verticalName={verticalName}
                    verticalSlug={verticalSlug}
                    fields={fields}
                    steps={steps}
                    currentStep={currentStep}
                    colors={colors}
                    showProgress={(sellerGamification?.showProgress ?? config.gamification?.showProgress) !== false}
                    showNudges={(sellerGamification?.showNudges ?? config.gamification?.showNudges) !== false}
                    ctaText={ctaText}
                    logoUrl={sellerLogoUrl}
                    companyName={sellerCompanyName}
                    formData={formData}
                    fieldErrors={fieldErrors}
                    onFieldChange={updateField}
                    onNext={handleNext}
                    onBack={handleBack}
                    submitting={submitting}
                    submitError={submitError}
                />

                {/* Exit Intent Modal */}
                {croConfig.showExitIntent && (
                    <ExitIntentModal
                        accentColor={colors.accent}
                        bgColor={colors.bg}
                        textColor={colors.text}
                        filledFieldCount={filledFieldCount}
                        totalFieldCount={fields.length}
                    />
                )}
            </div>
        </div>
    );
}
