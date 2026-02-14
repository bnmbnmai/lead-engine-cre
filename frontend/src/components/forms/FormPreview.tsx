/**
 * FormPreview — Shared presentational component for the multi-step form wizard.
 *
 * Renders the same beautiful design used by the hosted lander, but driven by
 * color props so it can be themed. Used by:
 *  - HostedForm.tsx (full-page, interactive)
 *  - SellerFunnels.tsx (compact inline preview, read-only)
 */

import { CheckCircle, ArrowRight, ArrowLeft, Loader2, AlertCircle, Lock } from 'lucide-react';
import { getContrastText } from '@/lib/contrast';
import type { FormField, FormStep } from '@/types/formBuilder';
import { VERTICAL_EMOJI } from '@/components/forms/StepProgress';

// ─── Color helpers ──────────────────────────────────────────────
function lighten(hex: string, amount: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amount));
    const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amount));
    const b = Math.min(255, (num & 0xff) + Math.round(255 * amount));
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function withAlpha(hex: string, alpha: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = (num >> 16) & 0xff;
    const g = (num >> 8) & 0xff;
    const b = num & 0xff;
    return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Props ──────────────────────────────────────────────────────

export interface FormPreviewColors {
    bg: string;        // page / card background
    text: string;      // primary text
    accent: string;    // CTA / progress bar / highlights
    border: string;    // input borders
    inputBg: string;   // input background
    muted: string;     // secondary text
}

export interface FormPreviewProps {
    /** Vertical display name (e.g. "Roofing") */
    verticalName: string;
    /** Vertical slug for emoji lookup */
    verticalSlug?: string;
    /** Form fields */
    fields: FormField[];
    /** Form steps */
    steps: FormStep[];
    /** Current step index (0-based) */
    currentStep: number;
    /** Color scheme */
    colors: FormPreviewColors;
    /** Branding */
    logoUrl?: string;
    companyName?: string;
    ctaText?: string;
    /** Gamification */
    showProgress?: boolean;
    showNudges?: boolean;
    /** Is admin configured (show badge) */
    isAdminConfigured?: boolean;

    // ─── Interactive mode (used by HostedForm) ───
    /** Form data (field key → value) */
    formData?: Record<string, string | boolean>;
    /** Field errors */
    fieldErrors?: Record<string, string>;
    /** Update field callback */
    onFieldChange?: (key: string, value: string | boolean) => void;
    /** Next/submit callback */
    onNext?: () => void;
    /** Back callback */
    onBack?: () => void;
    /** Is submitting? */
    submitting?: boolean;
    /** Submit error message */
    submitError?: string | null;

    // ─── Display mode ───
    /** Compact = smaller preview embedded in dashboard */
    compact?: boolean;
}

// ─── Component ──────────────────────────────────────────────────
export default function FormPreview({
    verticalName,
    verticalSlug,
    fields,
    steps,
    currentStep,
    colors,
    logoUrl,
    companyName,
    ctaText = 'Get My Free Quote',
    showProgress = true,
    showNudges = true,
    isAdminConfigured,
    formData = {},
    fieldErrors = {},
    onFieldChange,
    onNext,
    onBack,
    submitting = false,
    submitError,
    compact = false,
}: FormPreviewProps) {
    const { bg, text, accent, border, inputBg, muted } = colors;
    const cardBg = lighten(bg, 0.03);
    const isInteractive = !!onFieldChange;

    // Derived
    const currentFields = (() => {
        if (!steps.length || !fields.length) return fields;
        const step = steps[currentStep];
        if (!step) return [];
        return step.fieldIds
            .map(id => fields.find(f => f.id === id))
            .filter(Boolean) as FormField[];
    })();

    const isLastStep = currentStep === Math.max(steps.length - 1, 0);
    const totalSteps = steps.length || 1;
    const progress = ((currentStep + 1) / totalSteps) * 100;

    // For compact mode, show first 4 fields across all steps
    const previewFields = compact ? fields.slice(0, 4) : currentFields;

    const accentGradient = `linear-gradient(135deg, ${accent}, ${lighten(accent, 0.15)})`;
    const ctaFg = getContrastText(accent);

    // ─── Field renderer ──────────────────────────────────────
    function renderField(f: FormField) {
        const value = formData[f.key] ?? '';
        const err = fieldErrors[f.key];
        const inputStyles: React.CSSProperties = {
            backgroundColor: inputBg,
            border: `1px solid ${err ? '#ef4444' : border}`,
            color: text,
            borderRadius: '0.5rem',
            padding: compact ? '0.4rem 0.75rem' : '0.65rem 1rem',
            fontSize: compact ? '0.75rem' : '0.875rem',
            width: '100%',
            outline: 'none',
            transition: 'border-color 0.2s',
        };

        return (
            <div key={f.id} style={{ marginBottom: compact ? '0.6rem' : '0.9rem' }}>
                <label style={{ display: 'block', fontSize: compact ? '0.7rem' : '0.8rem', fontWeight: 500, color: muted, marginBottom: '0.3rem' }}>
                    {f.label} {f.required && <span style={{ color: accent }}>*</span>}
                </label>

                {f.type === 'select' && f.options ? (
                    isInteractive ? (
                        <select
                            value={value as string}
                            onChange={e => onFieldChange!(f.key, e.target.value)}
                            style={{ ...inputStyles, appearance: 'none' as const }}
                        >
                            <option value="">Select {f.label.toLowerCase()}...</option>
                            {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                    ) : (
                        <div style={inputStyles}>
                            <span style={{ opacity: 0.5 }}>Select {f.label.toLowerCase()}...</span>
                        </div>
                    )
                ) : f.type === 'boolean' ? (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {['Yes', 'No'].map(opt => {
                            const isSelected = (value === true && opt === 'Yes') || (value === false && opt === 'No');
                            return (
                                <button
                                    key={opt}
                                    type="button"
                                    onClick={isInteractive ? () => onFieldChange!(f.key, opt === 'Yes') : undefined}
                                    style={{
                                        flex: 1,
                                        padding: compact ? '0.35rem' : '0.55rem',
                                        borderRadius: '0.5rem',
                                        fontSize: compact ? '0.7rem' : '0.8rem',
                                        fontWeight: 500,
                                        border: `1px solid ${isSelected ? accent : border}`,
                                        backgroundColor: isSelected ? accent : inputBg,
                                        color: isSelected ? ctaFg : muted,
                                        cursor: isInteractive ? 'pointer' : 'default',
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    {opt}
                                </button>
                            );
                        })}
                    </div>
                ) : isInteractive ? (
                    f.type === 'textarea' ? (
                        <textarea
                            value={value as string}
                            onChange={e => onFieldChange!(f.key, e.target.value)}
                            placeholder={f.placeholder || f.label}
                            rows={3}
                            style={{ ...inputStyles, resize: 'none' }}
                        />
                    ) : (
                        <input
                            type={f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text'}
                            value={value as string}
                            onChange={e => onFieldChange!(f.key, e.target.value)}
                            placeholder={f.placeholder || f.label}
                            style={inputStyles}
                        />
                    )
                ) : (
                    <div style={inputStyles}>
                        <span style={{ opacity: 0.5 }}>{f.placeholder || f.label}</span>
                    </div>
                )}

                {err && (
                    <p style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <AlertCircle style={{ width: '0.7rem', height: '0.7rem' }} />{err}
                    </p>
                )}
            </div>
        );
    }

    // ─── Render ──────────────────────────────────────────────
    const containerStyle: React.CSSProperties = compact
        ? { backgroundColor: bg, color: text, padding: '1.25rem', borderRadius: '0.75rem', minHeight: 300, fontFamily: 'inherit' }
        : { backgroundColor: bg, color: text, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem', fontFamily: 'inherit' };

    const innerWidth = compact ? '100%' : '100%';

    return (
        <div style={containerStyle}>
            <div style={{ width: innerWidth, maxWidth: compact ? undefined : 448 }}>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: compact ? '0.75rem' : '2rem' }}>
                    {(logoUrl || companyName) && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            {logoUrl && (
                                <img
                                    src={logoUrl}
                                    alt="Logo"
                                    style={{ height: compact ? 20 : 28, width: compact ? 20 : 28, borderRadius: 4, objectFit: 'cover' }}
                                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                            )}
                            {companyName && (
                                <span style={{ fontSize: compact ? '0.75rem' : '0.875rem', fontWeight: 600 }}>{companyName}</span>
                            )}
                        </div>
                    )}
                    <h1 style={{
                        fontSize: compact ? '1rem' : '1.5rem',
                        fontWeight: 700,
                        marginBottom: '0.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                    }}>
                        {VERTICAL_EMOJI[verticalSlug || ''] && (
                            <span>{VERTICAL_EMOJI[verticalSlug || '']}</span>
                        )}
                        {verticalName || 'Get Started'}
                        {isAdminConfigured && (
                            <span style={{
                                fontSize: '0.55rem',
                                padding: '0.15rem 0.4rem',
                                borderRadius: '0.25rem',
                                backgroundColor: withAlpha('#22c55e', 0.2),
                                color: '#4ade80',
                                fontWeight: 500,
                            }}>
                                Admin Configured ✓
                            </span>
                        )}
                    </h1>
                    <p style={{ fontSize: compact ? '0.7rem' : '0.875rem', color: muted }}>
                        Get your personalized quote in under 60 seconds
                    </p>
                </div>

                {/* Progress bar */}
                {showProgress && totalSteps > 1 && (
                    <div style={{ marginBottom: compact ? '0.75rem' : '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: compact ? '0.6rem' : '0.7rem', color: muted, marginBottom: '0.4rem' }}>
                            <span>Step {currentStep + 1} of {totalSteps}</span>
                            <span>{steps[currentStep]?.label || ''}</span>
                        </div>
                        <div style={{
                            height: compact ? 4 : 6,
                            backgroundColor: withAlpha(text, 0.05),
                            borderRadius: 999,
                            overflow: 'hidden',
                        }}>
                            <div style={{
                                height: '100%',
                                width: `${progress}%`,
                                background: accentGradient,
                                borderRadius: 999,
                                transition: 'width 0.5s ease-out',
                            }} />
                        </div>
                    </div>
                )}

                {/* Form card */}
                <div style={{
                    backgroundColor: cardBg,
                    border: `1px solid ${withAlpha(text, 0.05)}`,
                    borderRadius: compact ? '0.75rem' : '1rem',
                    padding: compact ? '0.85rem' : '1.5rem',
                    boxShadow: compact ? undefined : `0 25px 50px -12px ${withAlpha(bg, 0.6)}`,
                }}>
                    {previewFields.map(f => renderField(f))}

                    {/* Compact: truncation notice */}
                    {compact && fields.length > 4 && (
                        <p style={{ fontSize: '0.6rem', color: muted, fontStyle: 'italic', marginTop: '0.25rem' }}>
                            + {fields.length - 4} more fields across {steps.length} steps
                        </p>
                    )}

                    {/* Navigation buttons */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: compact ? '0.75rem' : '1.25rem' }}>
                        {!compact && currentStep > 0 && (
                            <button
                                type="button"
                                onClick={onBack}
                                style={{
                                    flex: 1,
                                    padding: '0.65rem',
                                    borderRadius: '0.5rem',
                                    backgroundColor: withAlpha(text, 0.05),
                                    color: muted,
                                    fontSize: '0.85rem',
                                    fontWeight: 500,
                                    border: 'none',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.35rem',
                                    transition: 'background-color 0.2s',
                                }}
                            >
                                <ArrowLeft style={{ width: 16, height: 16 }} /> Back
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={isInteractive ? onNext : undefined}
                            disabled={submitting}
                            style={{
                                flex: 1,
                                padding: compact ? '0.5rem' : '0.7rem',
                                borderRadius: '0.5rem',
                                background: accentGradient,
                                color: ctaFg,
                                fontSize: compact ? '0.75rem' : '0.875rem',
                                fontWeight: 600,
                                border: 'none',
                                cursor: isInteractive ? 'pointer' : 'default',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.35rem',
                                boxShadow: `0 4px 12px ${withAlpha(accent, 0.25)}`,
                                transition: 'opacity 0.2s',
                                opacity: submitting ? 0.6 : 1,
                            }}
                        >
                            {submitting ? (
                                <><Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> Submitting...</>
                            ) : isLastStep && isInteractive ? (
                                <><span>{ctaText}</span> <CheckCircle style={{ width: 16, height: 16 }} /></>
                            ) : (
                                <><span>{isInteractive && !isLastStep ? 'Next' : ctaText}</span> <ArrowRight style={{ width: 16, height: 16 }} /></>
                            )}
                        </button>
                    </div>

                    {submitError && (
                        <p style={{ fontSize: '0.7rem', color: '#ef4444', textAlign: 'center', marginTop: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                            <AlertCircle style={{ width: 12, height: 12 }} />{submitError}
                        </p>
                    )}
                </div>

                {/* Footer */}
                {showNudges && (
                    <div style={{ textAlign: 'center', marginTop: compact ? '0.5rem' : '1.25rem' }}>
                        <p style={{ fontSize: compact ? '0.55rem' : '0.65rem', color: muted, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                            <Lock style={{ width: compact ? 8 : 10, height: compact ? 8 : 10, color: '#fbbf24' }} />
                            Your data is encrypted and protected • Powered by Lead Engine
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
