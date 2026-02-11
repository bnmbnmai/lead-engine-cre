/**
 * SuggestVerticalModal — AI-powered vertical suggestion dialog
 *
 * Input a lead description → call /api/v1/verticals/suggest → show result.
 * Uses shadcn Dialog, toast for notifications.
 */

import { useState } from 'react';
import { Sparkles, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/useToast';
import api from '@/lib/api';

// ============================================
// Types
// ============================================

interface SuggestionResult {
    parentSlug: string;
    suggestedName: string;
    suggestedSlug: string;
    confidence: number;
    reasoning: string;
    source: 'ai' | 'rule';
    isExisting: boolean;
    hitCount: number;
    autoCreated: boolean;
    existingMatch?: string;
}

interface SuggestVerticalModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    parentHint?: string;
}

// ============================================
// Helpers
// ============================================

function getConfidenceColor(confidence: number): string {
    if (confidence >= 0.8) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    if (confidence >= 0.5) return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    return 'bg-red-500/15 text-red-400 border-red-500/30';
}

function getConfidenceLabel(confidence: number): string {
    if (confidence >= 0.8) return 'High';
    if (confidence >= 0.5) return 'Medium';
    return 'Low';
}

// ============================================
// Component
// ============================================

export function SuggestVerticalModal({ open, onOpenChange, parentHint }: SuggestVerticalModalProps) {
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<SuggestionResult | null>(null);

    const handleSubmit = async () => {
        if (description.trim().length < 10) {
            toast({ type: 'warning', title: 'Too short', description: 'Please describe the lead in at least 10 characters.' });
            return;
        }

        setIsSubmitting(true);
        setResult(null);

        try {
            const { data, error } = await api.suggestVertical({
                description: description.trim(),
                vertical: parentHint,
            });

            if (error) {
                toast({ type: 'error', title: 'Suggestion failed', description: error.error || 'Unknown error' });
                return;
            }

            const suggestion = data?.suggestion as SuggestionResult;
            setResult(suggestion);

            if (suggestion?.isExisting) {
                toast({
                    type: 'info',
                    title: 'Matched existing vertical',
                    description: `"${suggestion.suggestedName}" already exists in the hierarchy.`,
                });
            } else {
                toast({
                    type: 'success',
                    title: 'Suggestion submitted!',
                    description: `"${suggestion?.suggestedName}" has been proposed${suggestion?.hitCount > 1 ? ` (${suggestion.hitCount} similar requests)` : ''}.`,
                });
            }
        } catch {
            toast({ type: 'error', title: 'Network error', description: 'Could not reach the suggestion engine.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        setDescription('');
        setResult(null);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" />
                        Suggest a New Vertical
                    </DialogTitle>
                    <DialogDescription>
                        Describe a lead type and our AI will suggest the best vertical classification.
                        PII is automatically removed before processing.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Input */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="suggest-input">
                            Lead Description
                        </label>
                        <textarea
                            id="suggest-input"
                            data-testid="suggest-input"
                            className="flex min-h-[100px] w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                            placeholder='e.g., "Customer needs emergency plumbing for a leaky pipe in their bathroom"'
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            disabled={isSubmitting}
                            maxLength={2000}
                        />
                        <p className="text-xs text-muted-foreground text-right">
                            {description.length}/2000
                        </p>
                    </div>

                    {/* Parent hint badge */}
                    {parentHint && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>Hint:</span>
                            <Badge variant="outline" className="font-mono text-xs">
                                {parentHint}
                            </Badge>
                        </div>
                    )}

                    {/* Result */}
                    {result && (
                        <div
                            data-testid="suggestion-result"
                            className="rounded-xl border bg-card p-4 space-y-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {result.isExisting ? (
                                        <CheckCircle className="h-4 w-4 text-emerald-400" />
                                    ) : (
                                        <Sparkles className="h-4 w-4 text-primary" />
                                    )}
                                    <span className="font-semibold">{result.suggestedName}</span>
                                </div>
                                <Badge
                                    variant="outline"
                                    className={getConfidenceColor(result.confidence)}
                                >
                                    {getConfidenceLabel(result.confidence)} ({Math.round(result.confidence * 100)}%)
                                </Badge>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                    <span className="text-muted-foreground">Slug:</span>
                                    <p className="font-mono text-xs mt-0.5">{result.suggestedSlug}</p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Parent:</span>
                                    <p className="font-mono text-xs mt-0.5">{result.parentSlug || '(top-level)'}</p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Source:</span>
                                    <p className="text-xs mt-0.5 capitalize">{result.source}</p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Status:</span>
                                    <p className="text-xs mt-0.5">
                                        {result.isExisting ? 'Existing' : result.autoCreated ? 'Auto-created' : 'Proposed'}
                                    </p>
                                </div>
                            </div>

                            {result.reasoning && (
                                <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2">
                                    {result.reasoning}
                                </div>
                            )}

                            {!result.isExisting && result.hitCount > 1 && (
                                <div className="flex items-center gap-1.5 text-xs text-amber-400">
                                    <AlertTriangle className="h-3 w-3" />
                                    {result.hitCount} similar suggestions — {result.hitCount >= 10 ? 'auto-creation triggered' : `${10 - result.hitCount} more needed for auto-creation`}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
                        {result ? 'Close' : 'Cancel'}
                    </Button>
                    {!result && (
                        <Button
                            onClick={handleSubmit}
                            disabled={isSubmitting || description.trim().length < 10}
                            data-testid="suggest-submit"
                            className="gap-2"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Analyzing...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="h-4 w-4" />
                                    Suggest
                                </>
                            )}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default SuggestVerticalModal;
