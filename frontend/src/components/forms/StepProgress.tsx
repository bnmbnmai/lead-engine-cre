import { cn } from '@/lib/utils';
import {
    Home, DollarSign, Sun, Shield, Wrench, Car, Scale, TrendingUp,
    Briefcase, Building2, CheckCircle2, Sparkles,
} from 'lucide-react';

// ============================================
// Types
// ============================================

export interface StepProgressProps {
    steps: { id: string; label: string }[];
    currentStep: number;
    vertical: string;
    showNudges?: boolean;
    showPercentage?: boolean;
    className?: string;
}

// ============================================
// Vertical Icons
// ============================================

const VERTICAL_ICONS: Record<string, React.ElementType> = {
    roofing: Home,
    mortgage: DollarSign,
    solar: Sun,
    insurance: Shield,
    home_services: Wrench,
    auto: Car,
    legal: Scale,
    financial_services: TrendingUp,
    b2b_saas: Briefcase,
    real_estate: Building2,
};

const VERTICAL_EMOJI: Record<string, string> = {
    roofing: '🏠',
    mortgage: '💰',
    solar: '☀️',
    insurance: '🛡️',
    home_services: '🔧',
    auto: '🚗',
    legal: '⚖️',
    financial_services: '📈',
    b2b_saas: '💼',
    real_estate: '🏢',
};

// ============================================
// Nudge Engine
// ============================================

function getNudgeMessage(currentStep: number, totalSteps: number, vertical: string): string {
    const pct = Math.round(((currentStep) / totalSteps) * 100);
    const emoji = VERTICAL_EMOJI[vertical] || '📋';
    const remaining = totalSteps - currentStep;

    if (currentStep === 0) {
        return `${emoji} Let's get started — just ${totalSteps} quick steps!`;
    }
    if (pct <= 25) {
        return `${pct}% Complete — great start! ${emoji}`;
    }
    if (pct <= 50) {
        return `${pct}% Complete — you're making progress! ${remaining} step${remaining > 1 ? 's' : ''} left`;
    }
    if (pct <= 75) {
        return `${pct}% Complete — almost there! Just ${remaining} more ${emoji}`;
    }
    if (currentStep === totalSteps - 1) {
        return `Last step — let's go! 🎉`;
    }
    return `${pct}% Complete — so close! ${emoji}`;
}

// ============================================
// Component
// ============================================

export function StepProgress({
    steps,
    currentStep,
    vertical,
    showNudges = true,
    showPercentage = true,
    className,
}: StepProgressProps) {
    const totalSteps = steps.length;
    const pct = totalSteps > 0 ? Math.round(((currentStep) / (totalSteps - 1)) * 100) : 0;
    const clampedPct = Math.min(100, Math.max(0, pct));
    const VerticalIcon = VERTICAL_ICONS[vertical] || Sparkles;

    return (
        <div className={cn('space-y-3', className)}>
            {/* Nudge message */}
            {showNudges && (
                <div className="flex items-center gap-2 text-sm text-primary font-medium animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
                    <Sparkles className="h-4 w-4 text-amber-500 animate-pulse" />
                    <span>{getNudgeMessage(currentStep, totalSteps, vertical)}</span>
                </div>
            )}

            {/* Progress bar */}
            <div className="relative">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                        className="h-full rounded-full bg-gradient-to-r from-primary via-primary/80 to-primary transition-all duration-500 ease-out"
                        style={{ width: `${clampedPct}%` }}
                    />
                </div>
                {showPercentage && (
                    <span className="absolute right-0 -top-5 text-[10px] font-semibold text-muted-foreground tabular-nums">
                        {clampedPct}%
                    </span>
                )}
            </div>

            {/* Step indicators — full on desktop, compact on mobile */}
            <div className="hidden sm:flex items-center justify-between">
                {steps.map((step, idx) => {
                    const isCompleted = idx < currentStep;
                    const isCurrent = idx === currentStep;
                    const isUpcoming = idx > currentStep;

                    return (
                        <div key={step.id} className="flex flex-col items-center gap-1 flex-1">
                            {/* Connector line */}
                            <div className="flex items-center w-full">
                                {idx > 0 && (
                                    <div
                                        className={cn(
                                            'h-0.5 flex-1 transition-colors duration-300',
                                            isCompleted || isCurrent ? 'bg-primary' : 'bg-muted'
                                        )}
                                    />
                                )}
                                {/* Step circle */}
                                <div
                                    className={cn(
                                        'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 shrink-0',
                                        isCompleted && 'bg-primary text-primary-foreground scale-90',
                                        isCurrent && 'bg-primary text-primary-foreground ring-4 ring-primary/20 scale-110',
                                        isUpcoming && 'bg-muted text-muted-foreground'
                                    )}
                                >
                                    {isCompleted ? (
                                        <CheckCircle2 className="h-4 w-4" />
                                    ) : isCurrent ? (
                                        <VerticalIcon className="h-4 w-4" />
                                    ) : (
                                        idx + 1
                                    )}
                                </div>
                                {idx < steps.length - 1 && (
                                    <div
                                        className={cn(
                                            'h-0.5 flex-1 transition-colors duration-300',
                                            isCompleted ? 'bg-primary' : 'bg-muted'
                                        )}
                                    />
                                )}
                            </div>
                            {/* Label */}
                            <span
                                className={cn(
                                    'text-[10px] font-medium text-center leading-tight max-w-[80px] truncate',
                                    isCurrent ? 'text-primary' : 'text-muted-foreground'
                                )}
                            >
                                {step.label}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Mobile compact — just current step label */}
            <div className="flex sm:hidden items-center justify-between text-xs">
                <span className="font-medium text-primary flex items-center gap-1.5">
                    <VerticalIcon className="h-3.5 w-3.5" />
                    Step {currentStep + 1}: {steps[currentStep]?.label}
                </span>
                <span className="text-muted-foreground tabular-nums">
                    {currentStep + 1} / {totalSteps}
                </span>
            </div>
        </div>
    );
}

export { VERTICAL_ICONS, VERTICAL_EMOJI, getNudgeMessage };
export default StepProgress;
