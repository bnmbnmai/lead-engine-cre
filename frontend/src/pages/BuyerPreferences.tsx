import DashboardLayout from '@/components/layout/DashboardLayout';
import { PreferencesForm } from '@/components/forms/PreferencesForm';
import { UsdcAllowanceCard } from '@/components/wallet/UsdcAllowanceCard';
import { useState } from 'react';
import { Info, X, CheckCircle, ChevronDown, Wallet } from 'lucide-react';

export function BuyerPreferences() {
    const [showTip, setShowTip] = useState(() => {
        return !localStorage.getItem('le_prefs_tip_dismissed');
    });
    const [saved, setSaved] = useState(false);
    const [showAllowance, setShowAllowance] = useState(false);

    const dismissTip = () => {
        setShowTip(false);
        localStorage.setItem('le_prefs_tip_dismissed', 'true');
    };

    return (
        <DashboardLayout>
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold">Auto Bidding</h1>
                        <p className="text-muted-foreground mt-1.5 max-w-xl text-sm">
                            Configure rules per vertical — budgets, quality gates, geo targeting, and field filters.
                            The server bids and settles 24/7 using your on-chain USDC allowance.
                        </p>
                    </div>

                    {/* Compact USDC Allowance toggle */}
                    <button
                        type="button"
                        onClick={() => setShowAllowance(v => !v)}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] hover:bg-emerald-500/10 transition-colors text-sm font-medium text-emerald-400 shrink-0"
                    >
                        <Wallet className="h-4 w-4" />
                        USDC Allowance
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showAllowance ? 'rotate-180' : ''}`} />
                    </button>
                </div>

                {/* Success banner */}
                {saved && (
                    <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 flex items-center gap-3 animate-in fade-in duration-300">
                        <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                        <p className="text-sm font-medium text-emerald-300">Preferences saved!</p>
                        <button onClick={() => setSaved(false)} className="ml-auto text-muted-foreground hover:text-foreground transition">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}

                {/* Onboarding tooltip for first-time visitors */}
                {showTip && (
                    <div className="p-3 rounded-xl border border-blue-500/20 bg-blue-500/5 flex items-start gap-3" data-testid="onboarding-tooltip">
                        <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="text-sm font-medium text-foreground mb-0.5">Getting started</p>
                            <p className="text-xs text-muted-foreground">
                                Create a preference set per vertical. Enable <strong>auto-bid</strong> for hands-free bidding.
                                Set <strong>daily budgets</strong> and <strong>quality gates</strong> to control spend. Rules run 24/7.
                            </p>
                        </div>
                        <button onClick={dismissTip} className="text-muted-foreground hover:text-foreground transition">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}

                {/* Collapsible USDC Allowance — compact, below header */}
                {showAllowance && (
                    <div className="animate-in fade-in-0 slide-in-from-top-2 duration-200">
                        <UsdcAllowanceCard />
                    </div>
                )}

                {/* Hero: Preference Sets (immediately visible) */}
                <PreferencesForm
                    onSuccess={() => {
                        setSaved(true);
                        setTimeout(() => setSaved(false), 5000);
                    }}
                />
            </div>
        </DashboardLayout>
    );
}
