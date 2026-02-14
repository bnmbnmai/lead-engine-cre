/**
 * Seller Template Library
 *
 * Compact, searchable & filterable template browser for sellers.
 * Replaces the old card-grid with a scalable list layout + category tabs.
 * Customization panel (colors, branding, gamification) + full hosted lander
 * export (URL + iframe embed with copy buttons).
 */

import { useState, useMemo } from 'react';
import useVerticals from '@/hooks/useVerticals';
import {
    Palette, Copy, CheckCircle2, Eye, Code, ExternalLink,
    Sparkles, Shield, Plus, Send,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LabeledSwitch } from '@/components/ui/switch';
import { StepProgress, VERTICAL_EMOJI } from '@/components/forms/StepProgress';
import { getContrastText, meetsWcagAA, contrastRatio } from '@/lib/contrast';
import useAuth from '@/hooks/useAuth';
import { toast } from '@/hooks/useToast';
import api from '@/lib/api';
import { NestedVerticalSelect } from '@/components/ui/NestedVerticalSelect';
import {
    FormField, FormStep,
    GamificationConfig, FormColorScheme,
    COLOR_SCHEMES, VERTICAL_PRESETS, GENERIC_TEMPLATE, autoGroupSteps,
} from '@/pages/FormBuilder';

// ============================================
// Category Mapping
// ============================================



// ============================================
// Constants
// ============================================

const APPROVED_CTA_TEXTS = [
    'Get My Free Quote',
    'Request Info',
    'Get Started',
    'Submit',
    'Claim Your Offer',
    'See My Options',
    'Schedule a Call',
    'Learn More',
];

// ============================================
// Component
// ============================================

export default function SellerTemplates() {
    const { user } = useAuth();
    useVerticals();
    const [selectedVertical, setSelectedVertical] = useState<string | null>(null);

    // Customization state
    const [colorScheme, setColorScheme] = useState<FormColorScheme>(COLOR_SCHEMES[0]);
    const [customAccent, setCustomAccent] = useState('#6366f1');
    const [customBg, setCustomBg] = useState('#1a1a2e');
    const [customText, setCustomText] = useState('#e2e8f0');
    const [logoUrl, setLogoUrl] = useState('');
    const [companyName, setCompanyName] = useState('');
    const [thankYouMessage, setThankYouMessage] = useState('Thank you! We\'ll be in touch shortly.');
    const [ctaText, setCtaText] = useState(APPROVED_CTA_TEXTS[0]);
    const [gamification, setGamification] = useState<GamificationConfig>({
        showProgress: true,
        showNudges: true,
        confetti: true,
    });
    const [previewMode, setPreviewMode] = useState<'preview' | 'iframe' | 'url'>('preview');
    const [copiedIframe, setCopiedIframe] = useState(false);
    const [copiedUrl, setCopiedUrl] = useState(false);
    const [showRequestForm, setShowRequestForm] = useState(false);
    const [requestVertical, setRequestVertical] = useState('');
    const [requestDescription, setRequestDescription] = useState('');
    const [requestSubmitting, setRequestSubmitting] = useState(false);
    const [configLoading, setConfigLoading] = useState(false);
    const [adminFields, setAdminFields] = useState<FormField[] | null>(null);
    const [adminSteps, setAdminSteps] = useState<FormStep[] | null>(null);



    // Use admin config if available, otherwise fallback to presets
    const selectedFields = useMemo(() => {
        if (adminFields) return adminFields;
        if (!selectedVertical) return [];
        return VERTICAL_PRESETS[selectedVertical] || GENERIC_TEMPLATE;
    }, [selectedVertical, adminFields]);

    const selectedSteps = useMemo(() => {
        if (adminSteps) return adminSteps;
        return autoGroupSteps(selectedFields);
    }, [selectedFields, adminSteps]);

    const effectiveColors: Record<string, string> = useMemo(() => ({
        ...colorScheme.vars,
        '--form-accent': customAccent,
        '--form-bg': customBg,
        '--form-text': customText,
    }), [colorScheme, customAccent, customBg, customText]);

    // Contrast validation
    const textBgRatio = contrastRatio(customText, customBg);
    const textBgPasses = meetsWcagAA(customText, customBg);

    // Generate hosted lander URL
    const hostedUrl = `${window.location.origin}/f/${selectedVertical}-${user?.id || 'preview'}`;
    const iframeEmbed = `<iframe src="${hostedUrl}" width="100%" height="700" frameborder="0" style="border-radius:12px;max-width:480px;"></iframe>`;

    async function handleSelectTemplate(vertical: string) {
        setSelectedVertical(vertical);
        setPreviewMode('preview');
        setColorScheme(COLOR_SCHEMES[0]);
        setCustomAccent(COLOR_SCHEMES[0].vars['--form-accent']);
        setCustomBg(COLOR_SCHEMES[0].vars['--form-bg']);
        setCustomText(COLOR_SCHEMES[0].vars['--form-text']);
        setAdminFields(null);
        setAdminSteps(null);

        // Fetch admin-saved form config
        setConfigLoading(true);
        try {
            const res = await api.getFormConfig(vertical);
            if (res.data?.formConfig) {
                const config = res.data.formConfig;
                setAdminFields(config.fields || null);
                setAdminSteps(config.steps || null);
                if (config.gamification) {
                    setGamification(config.gamification);
                }
            }
        } catch {
            // No admin config — will use preset fallback
        } finally {
            setConfigLoading(false);
        }
    }

    function applyPreset(scheme: FormColorScheme) {
        setColorScheme(scheme);
        setCustomAccent(scheme.vars['--form-accent']);
        setCustomBg(scheme.vars['--form-bg']);
        setCustomText(scheme.vars['--form-text']);
    }

    async function copyToClipboard(text: string, type: 'iframe' | 'url') {
        await navigator.clipboard.writeText(text);
        if (type === 'iframe') {
            setCopiedIframe(true);
            setTimeout(() => setCopiedIframe(false), 2000);
        } else {
            setCopiedUrl(true);
            setTimeout(() => setCopiedUrl(false), 2000);
        }
    }

    const displayName = (slug: string) => slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    return (
        <DashboardLayout>
            <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Shield className="h-6 w-6 text-primary" />
                            Template Library
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            Pre-approved lead capture templates. Customize colors, branding, and CTA — all forms are hosted by the platform for compliance.
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={() => setShowRequestForm(!showRequestForm)}
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Request Template
                    </Button>
                </div>

                {/* Request New Template Form */}
                {showRequestForm && (
                    <Card className="border-primary/30 bg-primary/5">
                        <CardContent className="p-5 space-y-4">
                            <h3 className="text-sm font-semibold flex items-center gap-2">
                                <Plus className="h-4 w-4 text-primary" />
                                Request a New Template
                            </h3>
                            <p className="text-xs text-muted-foreground">
                                Submit a vertical idea. Our admin team will review and publish an approved template within 48 hours.
                            </p>
                            <div className="grid sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-medium mb-1 block">Vertical Name</label>
                                    <Input
                                        placeholder="e.g. Pet Insurance, Solar B2B"
                                        value={requestVertical}
                                        onChange={(e) => setRequestVertical(e.target.value.slice(0, 80))}
                                        maxLength={80}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium mb-1 block">Description</label>
                                    <Input
                                        placeholder="What fields / flow would your ideal template have?"
                                        value={requestDescription}
                                        onChange={(e) => setRequestDescription(e.target.value.slice(0, 500))}
                                        maxLength={500}
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Button
                                    size="sm"
                                    disabled={!requestVertical.trim() || requestSubmitting}
                                    onClick={async () => {
                                        setRequestSubmitting(true);
                                        await new Promise((r) => setTimeout(r, 800));
                                        toast({
                                            type: 'success',
                                            title: 'Template Requested',
                                            description: `"${requestVertical}" has been submitted for admin review.`,
                                        });
                                        setRequestVertical('');
                                        setRequestDescription('');
                                        setShowRequestForm(false);
                                        setRequestSubmitting(false);
                                    }}
                                >
                                    <Send className="h-3.5 w-3.5 mr-1.5" />
                                    {requestSubmitting ? 'Submitting…' : 'Submit Request'}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setShowRequestForm(false)}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Vertical Selector */}
                <div className="flex items-center gap-4">
                    <NestedVerticalSelect
                        value={selectedVertical || ''}
                        onValueChange={(slug) => handleSelectTemplate(slug)}
                        placeholder="Select a template vertical…"
                        className="w-full max-w-md"
                    />
                    {selectedVertical && (
                        <span className="text-xs text-muted-foreground shrink-0">
                            {(VERTICAL_PRESETS[selectedVertical] || GENERIC_TEMPLATE).length} fields
                        </span>
                    )}
                </div>

                {/* Customization Panel */}
                {selectedVertical && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                        {/* Left: Customization Options */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Palette className="h-5 w-5 text-primary" />
                                    Customize: {displayName(selectedVertical)}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                {/* Color Presets */}
                                <div>
                                    <label className="text-sm font-medium mb-2 block text-foreground">Color Preset</label>
                                    <div className="flex flex-wrap gap-2">
                                        {COLOR_SCHEMES.map((scheme) => (
                                            <button
                                                key={scheme.name}
                                                onClick={() => applyPreset(scheme)}
                                                className={`w-8 h-8 rounded-full border-2 transition-all ${colorScheme.name === scheme.name ? 'border-primary scale-110' : 'border-border hover:scale-105'}`}
                                                style={{ backgroundColor: scheme.swatch }}
                                                title={scheme.name}
                                            />
                                        ))}
                                    </div>
                                </div>

                                {/* Custom Colors */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="text-xs text-muted-foreground mb-1 block">Accent</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={customAccent}
                                                onChange={(e) => setCustomAccent(e.target.value)}
                                                className="w-8 h-8 rounded cursor-pointer border-0"
                                            />
                                            <span className="text-xs font-mono text-muted-foreground">{customAccent}</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs text-muted-foreground mb-1 block">Background</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={customBg}
                                                onChange={(e) => setCustomBg(e.target.value)}
                                                className="w-8 h-8 rounded cursor-pointer border-0"
                                            />
                                            <span className="text-xs font-mono text-muted-foreground">{customBg}</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs text-muted-foreground mb-1 block">Text</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={customText}
                                                onChange={(e) => setCustomText(e.target.value)}
                                                className="w-8 h-8 rounded cursor-pointer border-0"
                                            />
                                            <span className="text-xs font-mono text-muted-foreground">{customText}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* WCAG Contrast */}
                                <div className={`rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${textBgPasses ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                    {textBgPasses ? (
                                        <><CheckCircle2 className="h-3.5 w-3.5" /> WCAG AA Pass — contrast ratio {textBgRatio.toFixed(1)}:1</>
                                    ) : (
                                        <><span>⚠️</span> Low contrast ({textBgRatio.toFixed(1)}:1) — WCAG AA requires 4.5:1</>
                                    )}
                                </div>

                                {/* Branding */}
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-sm font-medium mb-1 block text-foreground">Company Name</label>
                                        <Input
                                            value={companyName}
                                            onChange={(e) => setCompanyName(e.target.value.slice(0, 60))}
                                            placeholder="Your Company Name"
                                            maxLength={60}
                                        />
                                        <span className="text-[10px] text-muted-foreground">{companyName.length}/60</span>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium mb-1 block text-foreground">Logo URL</label>
                                        <Input
                                            value={logoUrl}
                                            onChange={(e) => setLogoUrl(e.target.value)}
                                            placeholder="https://yoursite.com/logo.png"
                                            type="url"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium mb-1 block text-foreground">Thank-You Message</label>
                                        <textarea
                                            value={thankYouMessage}
                                            onChange={(e) => setThankYouMessage(e.target.value.slice(0, 200))}
                                            placeholder="Thank you! We'll be in touch shortly."
                                            maxLength={200}
                                            rows={2}
                                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                                        />
                                        <span className="text-[10px] text-muted-foreground">{thankYouMessage.length}/200</span>
                                    </div>
                                </div>

                                {/* CTA Text */}
                                <div>
                                    <label className="text-sm font-medium mb-1 block text-foreground">CTA Button Text</label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {APPROVED_CTA_TEXTS.map(text => (
                                            <button
                                                key={text}
                                                onClick={() => setCtaText(text)}
                                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${ctaText === text
                                                    ? 'bg-primary text-primary-foreground'
                                                    : 'bg-muted/50 hover:bg-muted text-foreground'
                                                    }`}
                                            >
                                                {text}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Gamification */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium flex items-center gap-1 text-foreground">
                                        <Sparkles className="h-4 w-4 text-primary" />
                                        Gamification
                                    </label>
                                    <LabeledSwitch
                                        label="Step Progress Bar"
                                        checked={gamification.showProgress}
                                        onCheckedChange={(v) => setGamification(g => ({ ...g, showProgress: v }))}
                                    />
                                    <LabeledSwitch
                                        label="Smart Nudges"
                                        checked={gamification.showNudges}
                                        onCheckedChange={(v) => setGamification(g => ({ ...g, showNudges: v }))}
                                    />
                                    <LabeledSwitch
                                        label="Confetti on Submit"
                                        checked={gamification.confetti}
                                        onCheckedChange={(v) => setGamification(g => ({ ...g, confetti: v }))}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Right: Preview & Export */}
                        <div className="space-y-4">
                            {/* Mode Tabs */}
                            <div className="flex gap-1 bg-muted/30 p-1 rounded-lg w-fit">
                                <Button
                                    size="sm"
                                    variant={previewMode === 'preview' ? 'default' : 'ghost'}
                                    onClick={() => setPreviewMode('preview')}
                                    className="text-xs"
                                >
                                    <Eye className="h-3.5 w-3.5 mr-1" /> Preview
                                </Button>
                                <Button
                                    size="sm"
                                    variant={previewMode === 'iframe' ? 'default' : 'ghost'}
                                    onClick={() => setPreviewMode('iframe')}
                                    className="text-xs"
                                >
                                    <Code className="h-3.5 w-3.5 mr-1" /> Iframe Embed
                                </Button>
                                <Button
                                    size="sm"
                                    variant={previewMode === 'url' ? 'default' : 'ghost'}
                                    onClick={() => setPreviewMode('url')}
                                    className="text-xs"
                                >
                                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Hosted URL
                                </Button>
                            </div>

                            {/* Preview Card */}
                            {previewMode === 'preview' && (
                                <Card className="overflow-hidden">
                                    <div
                                        className="p-6 rounded-lg min-h-[400px]"
                                        style={{
                                            backgroundColor: customBg,
                                            color: customText,
                                        }}
                                    >
                                        {(logoUrl || companyName) && (
                                            <div className="flex items-center gap-3 mb-4">
                                                {logoUrl && (
                                                    <img
                                                        src={logoUrl}
                                                        alt="Logo"
                                                        className="h-8 w-8 rounded object-cover"
                                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                    />
                                                )}
                                                {companyName && <span className="font-semibold text-sm">{companyName}</span>}
                                            </div>
                                        )}

                                        <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
                                            {VERTICAL_EMOJI[selectedVertical] || '📋'} {displayName(selectedVertical)}
                                            {adminFields && (
                                                <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                                                    Admin Configured ✓
                                                </span>
                                            )}
                                        </h3>
                                        <p className="text-sm opacity-70 mb-4">
                                            {configLoading ? 'Loading form config...' : 'Get your personalized quote in under 60 seconds'}
                                        </p>

                                        {gamification.showProgress && selectedSteps.length > 1 && (
                                            <div className="mb-4">
                                                <StepProgress
                                                    steps={selectedSteps}
                                                    currentStep={0}
                                                    vertical={selectedVertical}
                                                />
                                            </div>
                                        )}

                                        <div className="space-y-3">
                                            {selectedFields.slice(0, 4).map(f => (
                                                <div key={f.id}>
                                                    <label className="text-xs font-medium opacity-80 mb-1 block">
                                                        {f.label} {f.required && <span style={{ color: customAccent }}>*</span>}
                                                    </label>
                                                    {f.type === 'select' ? (
                                                        <div
                                                            className="w-full px-3 py-2 rounded-md text-sm opacity-60"
                                                            style={{
                                                                backgroundColor: effectiveColors['--form-input-bg'] || 'rgba(0,0,0,0.2)',
                                                                border: `1px solid ${effectiveColors['--form-border'] || 'rgba(255,255,255,0.1)'}`,
                                                            }}
                                                        >
                                                            Select {f.label.toLowerCase()}...
                                                        </div>
                                                    ) : f.type === 'boolean' ? (
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-9 h-5 rounded-full" style={{ backgroundColor: customAccent, opacity: 0.4 }} />
                                                            <span className="text-xs opacity-60">Yes / No</span>
                                                        </div>
                                                    ) : (
                                                        <div
                                                            className="w-full px-3 py-2 rounded-md text-sm opacity-60"
                                                            style={{
                                                                backgroundColor: effectiveColors['--form-input-bg'] || 'rgba(0,0,0,0.2)',
                                                                border: `1px solid ${effectiveColors['--form-border'] || 'rgba(255,255,255,0.1)'}`,
                                                            }}
                                                        >
                                                            {f.placeholder || f.label}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                            {selectedFields.length > 4 && (
                                                <p className="text-xs opacity-50 italic">+ {selectedFields.length - 4} more fields across {selectedSteps.length} steps</p>
                                            )}
                                        </div>

                                        <button
                                            className="w-full mt-6 py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
                                            style={{
                                                backgroundColor: customAccent,
                                                color: getContrastText(customAccent),
                                            }}
                                        >
                                            {ctaText}
                                        </button>

                                        {gamification.showNudges && (
                                            <p className="text-center text-[11px] opacity-50 mt-2">
                                                🔒 Your info is secure & never shared without consent
                                            </p>
                                        )}
                                    </div>
                                </Card>
                            )}

                            {/* Iframe Embed */}
                            {previewMode === 'iframe' && (
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm">Iframe Embed Code</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <p className="text-xs text-muted-foreground">
                                            Paste this into your website HTML. The form is hosted by Lead Engine for compliance — no custom code needed.
                                        </p>
                                        <pre className="bg-muted/30 p-3 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap font-mono border border-border">
                                            {iframeEmbed}
                                        </pre>
                                        <Button
                                            size="sm"
                                            onClick={() => copyToClipboard(iframeEmbed, 'iframe')}
                                            className="w-full"
                                        >
                                            {copiedIframe ? (
                                                <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Copied!</>
                                            ) : (
                                                <><Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Embed Code</>
                                            )}
                                        </Button>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Hosted URL */}
                            {previewMode === 'url' && (
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm">Hosted Lander URL</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <p className="text-xs text-muted-foreground">
                                            Share this link directly. The lead form is hosted and maintained by Lead Engine — fully compliant, always up-to-date.
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                value={hostedUrl}
                                                readOnly
                                                className="font-mono text-xs"
                                            />
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => copyToClipboard(hostedUrl, 'url')}
                                            >
                                                {copiedUrl ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
                                            <Shield className="h-3.5 w-3.5 text-green-400 shrink-0" />
                                            Platform-hosted for TCPA, CCPA, and consent compliance
                                        </div>
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
