/**
 * My Funnels — Unified Seller Dashboard
 *
 * Merges the old "My Asks" list and "Templates" customization into a single
 * two-panel page. Left panel shows existing funnels (asks); right panel shows
 * the detail/create form with pricing, geo, template customization, conversion
 * tracking, and hosted form export.
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import useVerticals from '@/hooks/useVerticals';
import {
    Palette, Copy, CheckCircle2, Eye, Code, ExternalLink,
    Sparkles, Shield, Plus, Activity, Tag, MapPin,
    Pause, Play, Trash2, Save, X, DollarSign,
    Zap, ArrowRight,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { LabeledSwitch } from '@/components/ui/switch';
import { StepProgress, VERTICAL_EMOJI } from '@/components/forms/StepProgress';
import { getContrastText, meetsWcagAA, contrastRatio } from '@/lib/contrast';
import useAuth from '@/hooks/useAuth';
import { toast } from '@/hooks/useToast';
import api from '@/lib/api';
import { NestedVerticalSelect } from '@/components/ui/NestedVerticalSelect';
import { GeoFilter } from '@/components/marketplace/GeoFilter';
import { formatCurrency, getStatusColor } from '@/lib/utils';
import { SkeletonCard } from '@/components/ui/skeleton';
import {
    FormField, FormStep,
    GamificationConfig, FormColorScheme,
    COLOR_SCHEMES, VERTICAL_PRESETS, GENERIC_TEMPLATE, autoGroupSteps,
} from '@/pages/FormBuilder';

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

export default function SellerFunnels() {
    const { user } = useAuth();
    useVerticals();

    // ── Funnel list state ──
    const [funnels, setFunnels] = useState<any[]>([]);
    const [listLoading, setListLoading] = useState(true);
    const [selectedFunnelId, setSelectedFunnelId] = useState<string | null>(null);

    // ── Detail / create panel mode ──
    type PanelMode = 'idle' | 'view' | 'create';
    const [panelMode, setPanelMode] = useState<PanelMode>('idle');

    // ── Ask fields (used for both create + edit) ──
    const [vertical, setVertical] = useState('');
    const [geoCountry, setGeoCountry] = useState('US');
    const [geoStates, setGeoStates] = useState<string[]>([]);
    const [reservePrice, setReservePrice] = useState('50');
    const [buyNowPrice, setBuyNowPrice] = useState('');
    const [acceptOffSite, setAcceptOffSite] = useState(true);
    const [expiresInDays, setExpiresInDays] = useState('30');

    // ── Template customization ──
    const [colorScheme, setColorScheme] = useState<FormColorScheme>(COLOR_SCHEMES[0]);
    const [customAccent, setCustomAccent] = useState('#6366f1');
    const [customBg, setCustomBg] = useState('#1a1a2e');
    const [customText, setCustomText] = useState('#e2e8f0');
    const [logoUrl, setLogoUrl] = useState('');
    const [companyName, setCompanyName] = useState('');
    const [thankYouMessage, setThankYouMessage] = useState("Thank you! We'll be in touch shortly.");
    const [ctaText, setCtaText] = useState(APPROVED_CTA_TEXTS[0]);
    const [gamification, setGamification] = useState<GamificationConfig>({
        showProgress: true,
        showNudges: true,
        confetti: true,
    });
    const [previewMode, setPreviewMode] = useState<'preview' | 'iframe' | 'url'>('preview');
    const [copiedIframe, setCopiedIframe] = useState(false);
    const [copiedUrl, setCopiedUrl] = useState(false);

    // ── Conversion tracking ──
    const [conversionPixelUrl, setConversionPixelUrl] = useState('');
    const [conversionWebhookUrl, setConversionWebhookUrl] = useState('');
    const [convSaved, setConvSaved] = useState(false);
    const [convSaving, setConvSaving] = useState(false);

    // ── Admin form config ──
    const [configLoading, setConfigLoading] = useState(false);
    const [adminFields, setAdminFields] = useState<FormField[] | null>(null);
    const [adminSteps, setAdminSteps] = useState<FormStep[] | null>(null);

    // ── Actions ──
    const [isSaving, setIsSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ── Load funnel list ──
    const loadFunnels = useCallback(async () => {
        setListLoading(true);
        try {
            const { data } = await api.listAsks();
            setFunnels(data?.asks || []);
        } catch {
            // silent
        } finally {
            setListLoading(false);
        }
    }, []);

    useEffect(() => { loadFunnels(); }, [loadFunnels]);

    // ── Load conversion settings ──
    useEffect(() => {
        api.getConversionSettings()
            .then(res => {
                if (res.data) {
                    setConversionPixelUrl(res.data.conversionPixelUrl || '');
                    setConversionWebhookUrl(res.data.conversionWebhookUrl || '');
                }
            })
            .catch(() => { /* no profile yet */ });
    }, []);

    // ── Derived data ──
    const selectedFunnel = funnels.find(f => f.id === selectedFunnelId) || null;

    const selectedFields = useMemo(() => {
        if (adminFields) return adminFields;
        const v = panelMode === 'view' ? selectedFunnel?.vertical : vertical;
        if (!v) return [];
        return VERTICAL_PRESETS[v] || GENERIC_TEMPLATE;
    }, [vertical, selectedFunnel, panelMode, adminFields]);

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

    const textBgRatio = contrastRatio(customText, customBg);
    const textBgPasses = meetsWcagAA(customText, customBg);

    const activeVertical = panelMode === 'view' ? selectedFunnel?.vertical : vertical;
    const hostedUrl = `${window.location.origin}/f/${activeVertical}--${user?.id || 'preview'}`;
    const iframeEmbed = `<iframe src="${hostedUrl}" width="100%" height="700" frameborder="0" style="border-radius:12px;max-width:480px;"></iframe>`;

    const displayName = (slug: string) => slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // ── Select a funnel ──
    async function selectFunnel(funnel: any) {
        setSelectedFunnelId(funnel.id);
        setPanelMode('view');
        setError(null);
        setConfirmDelete(false);

        // Populate fields for editing
        setVertical(funnel.vertical);
        setReservePrice(funnel.reservePrice?.toString() || '50');
        setBuyNowPrice(funnel.buyNowPrice?.toString() || '');
        setAcceptOffSite(funnel.acceptOffSite ?? true);
        setGeoCountry(funnel.geoTargets?.country || 'US');
        setGeoStates(funnel.geoTargets?.states || []);

        // Reset template state and load config
        applyPreset(COLOR_SCHEMES[0]);
        setAdminFields(null);
        setAdminSteps(null);
        setPreviewMode('preview');
        await loadFormConfig(funnel.vertical);
    }

    // ── Start create flow ──
    function startCreate() {
        setSelectedFunnelId(null);
        setPanelMode('create');
        setError(null);
        setConfirmDelete(false);
        setVertical('');
        setReservePrice('50');
        setBuyNowPrice('');
        setAcceptOffSite(true);
        setGeoCountry('US');
        setGeoStates([]);
        setExpiresInDays('30');
        applyPreset(COLOR_SCHEMES[0]);
        setAdminFields(null);
        setAdminSteps(null);
        setPreviewMode('preview');
    }

    // ── Load form config for a vertical ──
    async function loadFormConfig(v: string) {
        setConfigLoading(true);
        try {
            const res = await api.getFormConfig(v);
            if (res.data?.formConfig) {
                const config = res.data.formConfig;
                setAdminFields(config.fields || null);
                setAdminSteps(config.steps || null);
                if (config.gamification) setGamification(config.gamification);
            }
        } catch {
            // fallback to preset
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

    // ── Create funnel (ask) ──
    async function handleCreate() {
        if (!vertical) { setError('Select a vertical'); return; }
        const rp = parseFloat(reservePrice);
        if (isNaN(rp) || rp <= 0) { setError('Reserve price is required'); return; }

        setIsSaving(true);
        setError(null);
        try {
            const payload: any = {
                vertical,
                geoTargets: { country: geoCountry, states: geoStates },
                reservePrice: rp,
                acceptOffSite,
                auctionDuration: 60,
                revealWindow: 900,
                expiresInDays: parseInt(expiresInDays) || 30,
            };
            const bnp = parseFloat(buyNowPrice);
            if (!isNaN(bnp) && bnp > 0) payload.buyNowPrice = bnp;

            const { data, error: apiError } = await api.createAsk(payload);
            if (apiError) throw new Error(apiError.error);

            toast({ type: 'success', title: 'Funnel created', description: `${displayName(vertical)} funnel is live.` });
            await loadFunnels();
            if (data?.ask) selectFunnel(data.ask);
        } catch (err: any) {
            setError(err.message || 'Failed to create funnel');
        } finally {
            setIsSaving(false);
        }
    }

    // ── Update funnel pricing ──
    async function handleUpdate() {
        if (!selectedFunnelId) return;
        setIsSaving(true);
        setError(null);
        try {
            const payload: any = { reservePrice: parseFloat(reservePrice) };
            const bnp = parseFloat(buyNowPrice);
            payload.buyNowPrice = isNaN(bnp) || buyNowPrice.trim() === '' ? null : bnp;
            payload.acceptOffSite = acceptOffSite;
            payload.geoTargets = { country: geoCountry, states: geoStates };

            const { error: apiError } = await api.updateAsk(selectedFunnelId, payload);
            if (apiError) throw new Error(apiError.error);
            toast({ type: 'success', title: 'Funnel updated' });
            await loadFunnels();
        } catch (err: any) {
            setError(err.message || 'Failed to update');
        } finally {
            setIsSaving(false);
        }
    }

    // ── Toggle status ──
    async function handleToggleStatus() {
        if (!selectedFunnel) return;
        const newStatus = selectedFunnel.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
        try {
            const { error: apiError } = await api.updateAsk(selectedFunnel.id, { status: newStatus });
            if (apiError) throw new Error(apiError.error);
            await loadFunnels();
            toast({ type: 'success', title: newStatus === 'ACTIVE' ? 'Funnel resumed' : 'Funnel paused' });
        } catch (err: any) {
            setError(err.message || 'Failed to update status');
        }
    }

    // ── Delete ──
    async function handleDelete() {
        if (!selectedFunnelId) return;
        setIsDeleting(true);
        try {
            const { error: apiError } = await api.deleteAsk(selectedFunnelId);
            if (apiError) throw new Error(apiError.error);
            toast({ type: 'success', title: 'Funnel deleted' });
            setSelectedFunnelId(null);
            setPanelMode('idle');
            await loadFunnels();
        } catch (err: any) {
            setError(err.message || 'Failed to delete');
        } finally {
            setIsDeleting(false);
            setConfirmDelete(false);
        }
    }

    // ── Save conversion settings ──
    async function saveConversionSettings() {
        setConvSaving(true);
        try {
            const res = await api.updateConversionSettings({
                conversionPixelUrl: conversionPixelUrl || undefined,
                conversionWebhookUrl: conversionWebhookUrl || undefined,
            });
            if (res.error) throw new Error(res.error.error);
            setConvSaved(true);
            toast({ type: 'success', title: 'Conversion tracking saved' });
            setTimeout(() => setConvSaved(false), 2000);
        } catch (err: any) {
            toast({ type: 'error', title: 'Save failed', description: err?.message || 'Could not save.' });
        } finally {
            setConvSaving(false);
        }
    }

    // ── On vertical change (create mode) ──
    function handleVerticalChange(v: string) {
        setVertical(v);
        setAdminFields(null);
        setAdminSteps(null);
        if (v) loadFormConfig(v);
    }

    return (
        <DashboardLayout>
            <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Zap className="h-6 w-6 text-primary" />
                            My Funnels
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            Create and manage lead funnels — set pricing, customize your hosted form, and track conversions in one place.
                        </p>
                    </div>
                    <Button onClick={startCreate}>
                        <Plus className="h-4 w-4 mr-2" />
                        New Funnel
                    </Button>
                </div>

                {/* Two-panel layout */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* ── Left: Funnel List ── */}
                    <div className="lg:col-span-4 space-y-3">
                        {listLoading ? (
                            <SkeletonCard />
                        ) : funnels.length === 0 && panelMode !== 'create' ? (
                            <Card>
                                <CardContent className="p-8 text-center">
                                    <Tag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                    <p className="text-muted-foreground mb-4">No funnels yet</p>
                                    <Button onClick={startCreate}>Create Your First Funnel</Button>
                                </CardContent>
                            </Card>
                        ) : (
                            <>
                                {funnels.map(funnel => (
                                    <Card
                                        key={funnel.id}
                                        className={`cursor-pointer transition-all hover:border-primary/40 ${selectedFunnelId === funnel.id ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : ''}`}
                                        onClick={() => selectFunnel(funnel)}
                                    >
                                        <CardContent className="p-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-lg">{VERTICAL_EMOJI[funnel.vertical] || '📋'}</span>
                                                    <span className="font-semibold capitalize text-sm">
                                                        {displayName(funnel.vertical)}
                                                    </span>
                                                </div>
                                                <Badge className={`${getStatusColor(funnel.status)} text-xs`}>
                                                    {funnel.status}
                                                </Badge>
                                            </div>
                                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                                <span className="flex items-center gap-1">
                                                    <DollarSign className="h-3 w-3" />
                                                    {formatCurrency(funnel.reservePrice)}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <MapPin className="h-3 w-3" />
                                                    {funnel.geoTargets?.states?.length
                                                        ? funnel.geoTargets.states.slice(0, 2).join(', ')
                                                        : 'All US'}
                                                    {(funnel.geoTargets?.states?.length || 0) > 2 && ` +${funnel.geoTargets.states.length - 2}`}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Tag className="h-3 w-3" />
                                                    {funnel._count?.leads || 0} leads
                                                </span>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </>
                        )}
                    </div>

                    {/* ── Right: Detail / Create Panel ── */}
                    <div className="lg:col-span-8">
                        {panelMode === 'idle' && (
                            <Card className="border-dashed">
                                <CardContent className="p-12 text-center">
                                    <Zap className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
                                    <p className="text-muted-foreground">
                                        Select a funnel from the list or create a new one to get started.
                                    </p>
                                </CardContent>
                            </Card>
                        )}

                        {(panelMode === 'create' || panelMode === 'view') && (
                            <div className="space-y-6">
                                {/* ── Section 1: Core Settings ── */}
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-lg flex items-center gap-2">
                                            <Tag className="h-5 w-5 text-primary" />
                                            {panelMode === 'create' ? 'New Funnel' : `${displayName(activeVertical || '')} Funnel`}
                                            {panelMode === 'view' && selectedFunnel && (
                                                <Badge className={`${getStatusColor(selectedFunnel.status)} ml-2`}>
                                                    {selectedFunnel.status}
                                                </Badge>
                                            )}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-5">
                                        {/* Vertical */}
                                        <div>
                                            <label className="text-sm font-medium mb-2 block">Vertical</label>
                                            {panelMode === 'create' ? (
                                                <NestedVerticalSelect
                                                    value={vertical}
                                                    onValueChange={handleVerticalChange}
                                                    placeholder="Select a vertical…"
                                                    className="w-full max-w-md"
                                                />
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-lg">{VERTICAL_EMOJI[activeVertical || ''] || '📋'}</span>
                                                    <span className="font-medium capitalize">{displayName(activeVertical || '')}</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Pricing */}
                                        <div className="grid sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-sm font-medium mb-1 block">Reserve Price (USDC)</label>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="50.00"
                                                    value={reservePrice}
                                                    onChange={(e) => setReservePrice(e.target.value)}
                                                />
                                                <p className="text-xs text-muted-foreground mt-1">Min bid accepted</p>
                                            </div>
                                            <div>
                                                <label className="text-sm font-medium mb-1 block">Buy Now Price (optional)</label>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="100.00"
                                                    value={buyNowPrice}
                                                    onChange={(e) => setBuyNowPrice(e.target.value)}
                                                />
                                                <p className="text-xs text-muted-foreground mt-1">Instant purchase, skips auction</p>
                                            </div>
                                        </div>

                                        {/* Geo */}
                                        <div>
                                            <label className="text-sm font-medium mb-2 block">Target Geography</label>
                                            <GeoFilter
                                                country={geoCountry}
                                                onCountryChange={(c) => { setGeoCountry(c); setGeoStates([]); }}
                                                selectedRegions={geoStates}
                                                onRegionsChange={setGeoStates}
                                                mode="include"
                                            />
                                            <p className="text-xs text-muted-foreground mt-2">
                                                Leave regions empty to accept all states.
                                            </p>
                                        </div>

                                        {/* Settings */}
                                        <div className="flex flex-wrap gap-6">
                                            <LabeledSwitch
                                                label="Accept Off-site Leads"
                                                description="Receive leads from external landers"
                                                checked={acceptOffSite}
                                                onCheckedChange={setAcceptOffSite}
                                            />
                                        </div>

                                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                                            ⚡ Auction Duration: <strong>60 seconds</strong> (sealed-bid)
                                        </div>

                                        {/* Error */}
                                        {error && (
                                            <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                                                {error}
                                            </div>
                                        )}

                                        {/* Actions */}
                                        <div className="flex flex-wrap gap-3 pt-2 border-t border-border">
                                            {panelMode === 'create' ? (
                                                <Button onClick={handleCreate} disabled={isSaving}>
                                                    {isSaving ? 'Creating…' : 'Create Funnel'}
                                                    <ArrowRight className="h-4 w-4 ml-1" />
                                                </Button>
                                            ) : (
                                                <>
                                                    <Button onClick={handleUpdate} disabled={isSaving} size="sm">
                                                        <Save className="h-4 w-4 mr-1" />
                                                        {isSaving ? 'Saving…' : 'Save Changes'}
                                                    </Button>
                                                    <Button
                                                        variant={selectedFunnel?.status === 'ACTIVE' ? 'outline' : 'default'}
                                                        size="sm"
                                                        onClick={handleToggleStatus}
                                                    >
                                                        {selectedFunnel?.status === 'ACTIVE' ? (
                                                            <><Pause className="h-4 w-4 mr-1" /> Pause</>
                                                        ) : (
                                                            <><Play className="h-4 w-4 mr-1" /> Resume</>
                                                        )}
                                                    </Button>
                                                    {!confirmDelete ? (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="text-destructive hover:text-destructive"
                                                            onClick={() => setConfirmDelete(true)}
                                                        >
                                                            <Trash2 className="h-4 w-4 mr-1" /> Delete
                                                        </Button>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm text-destructive">Sure?</span>
                                                            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isDeleting}>
                                                                {isDeleting ? 'Deleting…' : 'Yes'}
                                                            </Button>
                                                            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>No</Button>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                            {panelMode !== 'create' && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="ml-auto"
                                                    onClick={() => { setPanelMode('idle'); setSelectedFunnelId(null); }}
                                                >
                                                    <X className="h-4 w-4 mr-1" /> Close
                                                </Button>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* ── Section 2: Template Customization (only when vertical selected) ── */}
                                {activeVertical && (
                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                        {/* Customize */}
                                        <Card>
                                            <CardHeader>
                                                <CardTitle className="text-lg flex items-center gap-2">
                                                    <Palette className="h-5 w-5 text-primary" />
                                                    Customize Form
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
                                                            <input type="color" value={customAccent} onChange={(e) => setCustomAccent(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                                                            <span className="text-xs font-mono text-muted-foreground">{customAccent}</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-muted-foreground mb-1 block">Background</label>
                                                        <div className="flex items-center gap-2">
                                                            <input type="color" value={customBg} onChange={(e) => setCustomBg(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                                                            <span className="text-xs font-mono text-muted-foreground">{customBg}</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-muted-foreground mb-1 block">Text</label>
                                                        <div className="flex items-center gap-2">
                                                            <input type="color" value={customText} onChange={(e) => setCustomText(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                                                            <span className="text-xs font-mono text-muted-foreground">{customText}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* WCAG Contrast */}
                                                <div className={`rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${textBgPasses ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                    {textBgPasses ? (
                                                        <><CheckCircle2 className="h-3.5 w-3.5" /> WCAG AA Pass — {textBgRatio.toFixed(1)}:1</>
                                                    ) : (
                                                        <><span>⚠️</span> Low contrast ({textBgRatio.toFixed(1)}:1) — 4.5:1 required</>
                                                    )}
                                                </div>

                                                {/* Branding */}
                                                <div className="space-y-3">
                                                    <div>
                                                        <label className="text-sm font-medium mb-1 block text-foreground">Company Name</label>
                                                        <Input value={companyName} onChange={(e) => setCompanyName(e.target.value.slice(0, 60))} placeholder="Your Company Name" maxLength={60} />
                                                        <span className="text-[10px] text-muted-foreground">{companyName.length}/60</span>
                                                    </div>
                                                    <div>
                                                        <label className="text-sm font-medium mb-1 block text-foreground">Logo URL</label>
                                                        <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://yoursite.com/logo.png" type="url" />
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
                                                    <LabeledSwitch label="Step Progress Bar" checked={gamification.showProgress} onCheckedChange={(v) => setGamification(g => ({ ...g, showProgress: v }))} />
                                                    <LabeledSwitch label="Smart Nudges" checked={gamification.showNudges} onCheckedChange={(v) => setGamification(g => ({ ...g, showNudges: v }))} />
                                                    <LabeledSwitch label="Confetti on Submit" checked={gamification.confetti} onCheckedChange={(v) => setGamification(g => ({ ...g, confetti: v }))} />
                                                </div>

                                                {/* Conversion Tracking */}
                                                <div className="space-y-3 pt-2 border-t border-border">
                                                    <label className="text-sm font-medium flex items-center gap-1 text-foreground">
                                                        <Activity className="h-4 w-4 text-primary" />
                                                        Conversion Tracking
                                                    </label>
                                                    <p className="text-xs text-muted-foreground -mt-1">
                                                        Track submissions with your ad platform or CRM.
                                                    </p>
                                                    <div>
                                                        <label className="text-xs font-medium mb-1 block text-foreground">Conversion Pixel URL</label>
                                                        <Input value={conversionPixelUrl} onChange={(e) => setConversionPixelUrl(e.target.value)} placeholder="https://www.facebook.com/tr?id=...&ev=Lead" type="url" />
                                                        <p className="text-[10px] text-muted-foreground mt-0.5">Image pixel fired on submit (Facebook, Google Ads, etc.)</p>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs font-medium mb-1 block text-foreground">Conversion Webhook URL</label>
                                                        <Input value={conversionWebhookUrl} onChange={(e) => setConversionWebhookUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/..." type="url" />
                                                        <p className="text-[10px] text-muted-foreground mt-0.5">POST webhook with lead data (Zapier, Make, CRM)</p>
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="w-full"
                                                        onClick={saveConversionSettings}
                                                        disabled={convSaving || (!conversionPixelUrl && !conversionWebhookUrl)}
                                                    >
                                                        {convSaved ? (
                                                            <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Saved!</>
                                                        ) : convSaving ? 'Saving...' : 'Save Conversion Settings'}
                                                    </Button>
                                                </div>
                                            </CardContent>
                                        </Card>

                                        {/* Preview & Export */}
                                        <div className="space-y-4">
                                            {/* Mode Tabs */}
                                            <div className="flex gap-1 bg-muted/30 p-1 rounded-lg w-fit">
                                                <Button size="sm" variant={previewMode === 'preview' ? 'default' : 'ghost'} onClick={() => setPreviewMode('preview')} className="text-xs">
                                                    <Eye className="h-3.5 w-3.5 mr-1" /> Preview
                                                </Button>
                                                <Button size="sm" variant={previewMode === 'iframe' ? 'default' : 'ghost'} onClick={() => setPreviewMode('iframe')} className="text-xs">
                                                    <Code className="h-3.5 w-3.5 mr-1" /> Embed
                                                </Button>
                                                <Button size="sm" variant={previewMode === 'url' ? 'default' : 'ghost'} onClick={() => setPreviewMode('url')} className="text-xs">
                                                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> URL
                                                </Button>
                                            </div>

                                            {/* Preview */}
                                            {previewMode === 'preview' && (
                                                <Card className="overflow-hidden">
                                                    <div
                                                        className="p-6 rounded-lg min-h-[400px]"
                                                        style={{ backgroundColor: customBg, color: customText }}
                                                    >
                                                        {(logoUrl || companyName) && (
                                                            <div className="flex items-center gap-3 mb-4">
                                                                {logoUrl && (
                                                                    <img src={logoUrl} alt="Logo" className="h-8 w-8 rounded object-cover"
                                                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                                )}
                                                                {companyName && <span className="font-semibold text-sm">{companyName}</span>}
                                                            </div>
                                                        )}

                                                        <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
                                                            {VERTICAL_EMOJI[activeVertical || ''] || '📋'} {displayName(activeVertical || '')}
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
                                                                <StepProgress steps={selectedSteps} currentStep={0} vertical={activeVertical || ''} />
                                                            </div>
                                                        )}

                                                        <div className="space-y-3">
                                                            {selectedFields.slice(0, 4).map(f => (
                                                                <div key={f.id}>
                                                                    <label className="text-xs font-medium opacity-80 mb-1 block">
                                                                        {f.label} {f.required && <span style={{ color: customAccent }}>*</span>}
                                                                    </label>
                                                                    {f.type === 'select' ? (
                                                                        <div className="w-full px-3 py-2 rounded-md text-sm opacity-60"
                                                                            style={{ backgroundColor: effectiveColors['--form-input-bg'] || 'rgba(0,0,0,0.2)', border: `1px solid ${effectiveColors['--form-border'] || 'rgba(255,255,255,0.1)'}` }}>
                                                                            Select {f.label.toLowerCase()}...
                                                                        </div>
                                                                    ) : f.type === 'boolean' ? (
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="w-9 h-5 rounded-full" style={{ backgroundColor: customAccent, opacity: 0.4 }} />
                                                                            <span className="text-xs opacity-60">Yes / No</span>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="w-full px-3 py-2 rounded-md text-sm opacity-60"
                                                                            style={{ backgroundColor: effectiveColors['--form-input-bg'] || 'rgba(0,0,0,0.2)', border: `1px solid ${effectiveColors['--form-border'] || 'rgba(255,255,255,0.1)'}` }}>
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
                                                            style={{ backgroundColor: customAccent, color: getContrastText(customAccent) }}
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
                                                            Paste this into your website HTML. The form is hosted for compliance — no custom code needed.
                                                        </p>
                                                        <pre className="bg-muted/30 p-3 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap font-mono border border-border">
                                                            {iframeEmbed}
                                                        </pre>
                                                        <Button size="sm" onClick={() => copyToClipboard(iframeEmbed, 'iframe')} className="w-full">
                                                            {copiedIframe ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Copied!</> : <><Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Embed Code</>}
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
                                                            Share this link directly. The form is hosted and maintained by Lead Engine.
                                                        </p>
                                                        <div className="flex items-center gap-2">
                                                            <Input value={hostedUrl} readOnly className="font-mono text-xs" />
                                                            <Button size="sm" variant="outline" onClick={() => copyToClipboard(hostedUrl, 'url')}>
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
                        )}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
