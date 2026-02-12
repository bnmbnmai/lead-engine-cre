/**
 * LeadPreview — Non-PII Field Preview Accordion
 *
 * Shows redacted lead data grouped by form step (e.g., Property Details,
 * Financial Info). Buyers see field values like "Loan Type: Refinance"
 * without any PII exposure.
 */

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Shield, ShieldCheck, FileText, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ── Types ──────────────────────────────

interface PreviewField {
    key: string;
    label: string;
    value: string;
}

interface FormStep {
    label: string;
    fields: PreviewField[];
}

interface LeadPreviewData {
    vertical: string;
    geoState: string;
    geoCountry: string;
    source: string;
    status: string;
    isVerified: boolean;
    createdAt: string;
    reservePrice: number | null;
    zkDataHash: string | null;
    formSteps: FormStep[];
}

interface LeadPreviewProps {
    leadId: string;
    autoExpand?: boolean;
}

// ── Hook ──────────────────────────────

function useLeadPreview(leadId: string) {
    const [data, setData] = useState<LeadPreviewData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!leadId) return;

        const fetchPreview = async () => {
            try {
                setLoading(true);
                const baseUrl = import.meta.env.VITE_API_URL || '';
                const res = await fetch(`${baseUrl}/marketplace/leads/${leadId}/preview`, {
                    credentials: 'include',
                });

                if (!res.ok) {
                    throw new Error(res.status === 404 ? 'Lead not found' : 'Failed to load preview');
                }

                const json = await res.json();
                setData(json.preview);
                setError(null);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchPreview();
    }, [leadId]);

    return { data, loading, error };
}

// ── Step Accordion ──────────────────────────────

function StepAccordion({ step, defaultOpen = false }: { step: FormStep; defaultOpen?: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    const hasValues = step.fields.some((f) => f.value !== 'Not Provided');

    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition text-left"
            >
                <span className="text-sm font-medium flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    {step.label}
                    <span className="text-xs text-muted-foreground">
                        ({step.fields.filter((f) => f.value !== 'Not Provided').length}/{step.fields.length})
                    </span>
                </span>
                {open
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                }
            </button>

            {open && (
                <div className="px-4 py-3 space-y-2 bg-background">
                    {step.fields.map((field) => (
                        <div key={field.key} className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{field.label}</span>
                            <span className={field.value === 'Not Provided'
                                ? 'text-muted-foreground/50 italic text-xs'
                                : 'font-medium'
                            }>
                                {field.value}
                            </span>
                        </div>
                    ))}
                    {!hasValues && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                            <AlertCircle className="h-3 w-3" />
                            No data provided for this section
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Main Component ──────────────────────────────

export function LeadPreview({ leadId, autoExpand = false }: LeadPreviewProps) {
    const { data, loading, error } = useLeadPreview(leadId);
    const [expanded, setExpanded] = useState(autoExpand);

    if (loading) {
        return (
            <Card>
                <CardContent className="p-4">
                    <div className="animate-pulse space-y-2">
                        <div className="h-4 bg-muted rounded w-1/3" />
                        <div className="h-3 bg-muted rounded w-2/3" />
                        <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (error || !data) {
        return null; // Silently hide if preview unavailable
    }

    return (
        <Card>
            <CardHeader className="pb-2">
                <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    className="w-full flex items-center justify-between"
                >
                    <CardTitle className="text-sm flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-500" />
                        Lead Details Preview
                        {data.zkDataHash && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-600 text-xs font-normal">
                                <ShieldCheck className="h-3 w-3" />
                                ZK Verified
                            </span>
                        )}
                    </CardTitle>
                    {expanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    }
                </button>
            </CardHeader>

            {expanded && (
                <CardContent className="space-y-3 pt-0">
                    {/* Summary row */}
                    <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="p-2 rounded-lg bg-muted/30 text-center">
                            <div className="text-muted-foreground">Vertical</div>
                            <div className="font-medium capitalize">{data.vertical}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-muted/30 text-center">
                            <div className="text-muted-foreground">State</div>
                            <div className="font-medium">{data.geoState}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-muted/30 text-center">
                            <div className="text-muted-foreground">Source</div>
                            <div className="font-medium capitalize">{data.source.toLowerCase()}</div>
                        </div>
                    </div>

                    {/* Form step accordions */}
                    <div className="space-y-2">
                        {data.formSteps.map((step, i) => (
                            <StepAccordion key={step.label} step={step} defaultOpen={i === 0} />
                        ))}
                    </div>

                    {/* Privacy notice */}
                    <div className="flex items-start gap-2 p-2 rounded-lg bg-muted/20 border border-border">
                        <Shield className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Contact details and personal information are encrypted and only revealed to the winning bidder after auction settlement.
                        </p>
                    </div>
                </CardContent>
            )}
        </Card>
    );
}

export default LeadPreview;
