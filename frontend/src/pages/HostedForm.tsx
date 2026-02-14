/**
 * HostedForm — Public-facing multi-step form wizard
 *
 * Route: /f/:slug  (e.g. /f/roofing--clxyz123 or /f/solar.residential--cmxyz456)
 * The slug format is: {verticalSlug}--{sellerId}
 *
 * Fetches formConfig from the public API, renders a fully functional
 * multi-step wizard with progress bar, validation, and submission.
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, ArrowRight, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import api from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────
interface FormField {
    id: string;
    key: string;
    label: string;
    type: 'text' | 'email' | 'phone' | 'number' | 'select' | 'boolean' | 'textarea' | 'date' | 'url';
    required: boolean;
    placeholder?: string;
    options?: string[];
    validation?: { min?: number; max?: number; pattern?: string };
}

interface FormStep {
    id: string;
    label: string;
    fieldIds: string[];
}

interface FormConfig {
    fields: FormField[];
    steps: FormStep[];
    gamification?: { showProgress?: boolean; showNudges?: boolean };
}

// ─── Component ────────────────────────────────────────────────────
export default function HostedForm() {
    const { slug } = useParams<{ slug: string }>();

    // Parse the slug: format is {verticalSlug}--{sellerId}
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
    const totalSteps = steps.length || 1;
    const progress = ((currentStep + 1) / totalSteps) * 100;

    // ─── Field rendering ──────────────────────────────────────
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
            // Extract geo fields from form data if present
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

    function renderField(f: FormField) {
        const value = formData[f.key] ?? '';
        const err = fieldErrors[f.key];
        const inputClasses = `w-full px-4 py-3 rounded-lg bg-[#1a1a2e] border text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all ${err ? 'border-red-500' : 'border-white/10'}`;

        return (
            <div key={f.id} className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">
                    {f.label} {f.required && <span className="text-indigo-400">*</span>}
                </label>

                {f.type === 'select' && f.options ? (
                    <select
                        value={value as string}
                        onChange={e => updateField(f.key, e.target.value)}
                        className={inputClasses}
                    >
                        <option value="">Select {f.label.toLowerCase()}...</option>
                        {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                ) : f.type === 'boolean' ? (
                    <div className="flex gap-3">
                        {['Yes', 'No'].map(opt => (
                            <button
                                key={opt}
                                type="button"
                                onClick={() => updateField(f.key, opt === 'Yes')}
                                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border ${(value === true && opt === 'Yes') || (value === false && opt === 'No')
                                    ? 'bg-indigo-600 border-indigo-500 text-white'
                                    : 'bg-[#1a1a2e] border-white/10 text-gray-400 hover:border-white/20'
                                    }`}
                            >
                                {opt}
                            </button>
                        ))}
                    </div>
                ) : f.type === 'textarea' ? (
                    <textarea
                        value={value as string}
                        onChange={e => updateField(f.key, e.target.value)}
                        placeholder={f.placeholder || f.label}
                        rows={3}
                        className={inputClasses}
                    />
                ) : (
                    <input
                        type={f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : f.type === 'email' ? 'email' : 'text'}
                        value={value as string}
                        onChange={e => updateField(f.key, e.target.value)}
                        placeholder={f.placeholder || f.label}
                        className={inputClasses}
                    />
                )}

                {err && <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{err}</p>}
            </div>
        );
    }

    // ─── Loading / Error states ───────────────────────────────
    if (loading) {
        return (
            <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
            </div>
        );
    }

    if (error || !config) {
        return (
            <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center px-4">
                <div className="text-center space-y-4">
                    <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
                    <h1 className="text-xl font-semibold text-white">Form Not Found</h1>
                    <p className="text-gray-400 text-sm max-w-sm">
                        {error || 'This form is not available. Please check the URL and try again.'}
                    </p>
                </div>
            </div>
        );
    }

    // ─── Submitted ────────────────────────────────────────────
    if (submitted) {
        return (
            <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center px-4">
                <div className="text-center space-y-4 max-w-md">
                    <div className="h-16 w-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                        <CheckCircle className="h-8 w-8 text-green-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">Thank You!</h1>
                    <p className="text-gray-400">
                        Your information has been submitted successfully. A specialist will be in touch shortly.
                    </p>
                    <div className="pt-4">
                        <p className="text-xs text-gray-600">Powered by Lead Engine</p>
                    </div>
                </div>
            </div>
        );
    }

    // ─── Form wizard ──────────────────────────────────────────
    return (
        <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold text-white mb-1">{verticalName || 'Get Started'}</h1>
                    <p className="text-sm text-gray-400">Get your personalized quote in under 60 seconds</p>
                </div>

                {/* Progress bar */}
                {totalSteps > 1 && (
                    <div className="mb-8">
                        <div className="flex justify-between text-xs text-gray-500 mb-2">
                            <span>Step {currentStep + 1} of {totalSteps}</span>
                            <span>{steps[currentStep]?.label || ''}</span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500 ease-out"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Form card */}
                <div className="bg-[#16162a] border border-white/5 rounded-2xl p-6 shadow-2xl">
                    <div className="space-y-4">
                        {currentFields.map(f => renderField(f))}
                    </div>

                    {/* Navigation */}
                    <div className="flex gap-3 mt-6">
                        {currentStep > 0 && (
                            <button
                                type="button"
                                onClick={handleBack}
                                className="flex-1 px-4 py-3 rounded-lg bg-white/5 text-gray-300 text-sm font-medium hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                            >
                                <ArrowLeft className="h-4 w-4" /> Back
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleNext}
                            disabled={submitting}
                            className="flex-1 px-4 py-3 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold hover:from-indigo-500 hover:to-purple-500 transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                            {submitting ? (
                                <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</>
                            ) : isLastStep ? (
                                <>Submit <CheckCircle className="h-4 w-4" /></>
                            ) : (
                                <>Next <ArrowRight className="h-4 w-4" /></>
                            )}
                        </button>
                    </div>

                    {submitError && (
                        <p className="text-xs text-red-400 text-center mt-3 flex items-center justify-center gap-1">
                            <AlertCircle className="h-3 w-3" />{submitError}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="text-center mt-6">
                    <p className="text-[11px] text-gray-600">
                        🔒 Your data is encrypted and protected • Powered by Lead Engine
                    </p>
                </div>
            </div>
        </div>
    );
}
