import DashboardLayout from '@/components/layout/DashboardLayout';
import { PreferencesForm } from '@/components/forms/PreferencesForm';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Info, X } from 'lucide-react';

export function BuyerPreferences() {
    const navigate = useNavigate();
    const [showTip, setShowTip] = useState(() => {
        return !localStorage.getItem('le_prefs_tip_dismissed');
    });

    const dismissTip = () => {
        setShowTip(false);
        localStorage.setItem('le_prefs_tip_dismissed', 'true');
    };

    return (
        <DashboardLayout>
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold">Buyer Preferences</h1>
                    <p className="text-muted-foreground">
                        Set rules once — auto-bid fires instantly on matching leads across 20+ markets. Configure budgets, quality gates, and geo targeting.
                    </p>
                </div>

                {/* Onboarding tooltip for first-time visitors */}
                {showTip && (
                    <div className="mb-6 p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 flex items-start gap-3" data-testid="onboarding-tooltip">
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

                <PreferencesForm
                    onSuccess={() => {
                        navigate('/buyer');
                    }}
                />
            </div>
        </DashboardLayout>
    );
}
