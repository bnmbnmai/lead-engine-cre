import DashboardLayout from '@/components/layout/DashboardLayout';
import { PreferencesForm } from '@/components/forms/PreferencesForm';
import { UsdcAllowanceCard } from '@/components/wallet/UsdcAllowanceCard';
import { useState } from 'react';
import { Info, X, CheckCircle } from 'lucide-react';

export function BuyerPreferences() {
    const [showTip, setShowTip] = useState(() => {
        return !localStorage.getItem('le_prefs_tip_dismissed');
    });
    const [saved, setSaved] = useState(false);

    const dismissTip = () => {
        setShowTip(false);
        localStorage.setItem('le_prefs_tip_dismissed', 'true');
    };

    return (
        <DashboardLayout>
            <div className="max-w-4xl mx-auto space-y-8">
                <div>
                    <h1 className="text-3xl font-bold">Auto Bidding</h1>
                    <p className="text-muted-foreground mt-2 max-w-2xl">
                        Configure auto-bid rules per vertical — set budgets, quality gates, geo targeting, and field-level
                        filters. Approve USDC via the allowance card below, then close your browser. The server bids and
                        settles 24/7 using your on-chain allowance.
                    </p>
                </div>

                {/* Success banner */}
                {saved && (
                    <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 flex items-center gap-3 animate-in fade-in duration-300">
                        <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
                        <p className="text-sm font-medium text-emerald-300">Preferences saved successfully!</p>
                        <button onClick={() => setSaved(false)} className="ml-auto text-muted-foreground hover:text-foreground transition">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}

                {/* Onboarding tooltip for first-time visitors */}
                {showTip && (
                    <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 flex items-start gap-3" data-testid="onboarding-tooltip">
                        <Info className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="text-sm font-medium text-foreground mb-1">Getting started with auto-bid</p>
                            <p className="text-sm text-muted-foreground">
                                Create a preference set for each vertical you buy. Enable <strong>auto-bid</strong> to
                                automatically place bids when matching leads appear. Set <strong>daily budgets</strong> to
                                control spend and <strong>quality gates</strong> (0–10,000) to filter low-quality leads.
                                Your rules run 24/7 — bid on leads while you sleep.
                            </p>
                        </div>
                        <button onClick={dismissTip} className="text-muted-foreground hover:text-foreground transition">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}

                {/* USDC allowance for offline auto-bidding */}
                <div>
                    <UsdcAllowanceCard />
                </div>

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
