import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, UserPlus, Building2, CheckCircle, Shield } from 'lucide-react';
import { ErrorDetail, parseApiError } from '@/components/ui/ErrorDetail';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { LeadSubmitForm } from '@/components/forms/LeadSubmitForm';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import useAuth from '@/hooks/useAuth';
import { NestedVerticalSelect } from '@/components/ui/NestedVerticalSelect';
import { VerticalBreadcrumb } from '@/components/ui/VerticalBreadcrumb';
import api, { API_BASE_URL } from '@/lib/api';

export function SellerSubmit() {
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
    const [hasProfile, setHasProfile] = useState<boolean | null>(null);
    const [profileLoading, setProfileLoading] = useState(true);

    // Profile wizard state
    const [wizardCompany, setWizardCompany] = useState('');
    const [wizardVerticals, setWizardVerticals] = useState<string[]>([]);
    const [wizardSubmitting, setWizardSubmitting] = useState(false);
    const [profileError, setProfileError] = useState<any>(null);

    // Check for seller profile
    useEffect(() => {
        if (!isAuthenticated) {
            setProfileLoading(false);
            return;
        }
        const checkProfile = async () => {
            try {
                const { data } = await api.getOverview();
                setHasProfile(!!data?.stats);
            } catch {
                // If seller overview fails, assume no profile
                setHasProfile(false);
            } finally {
                setProfileLoading(false);
            }
        };
        checkProfile();
    }, [isAuthenticated]);

    const handleProfileCreate = async () => {
        if (!wizardCompany.trim() || wizardVerticals.length === 0) return;
        setWizardSubmitting(true);
        setProfileError(null);
        try {
            const token = localStorage.getItem('auth_token');
            const resp = await fetch(`${API_BASE_URL}/api/v1/seller/profile`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    companyName: wizardCompany,
                    verticals: wizardVerticals,
                }),
            });
            if (resp.ok) {
                setHasProfile(true);
            } else {
                const body = await resp.json().catch(() => ({}));
                setProfileError(body.code ? body : { error: body.error || 'Failed to create profile. Please try again.' });
            }
        } catch (err) {
            setProfileError(parseApiError(err));
        } finally {
            setWizardSubmitting(false);
        }
    };

    // Auth gate
    if (!isAuthenticated) {
        return (
            <DashboardLayout>
                <div className="max-w-xl mx-auto">
                    <Card>
                        <CardContent className="p-12 text-center">
                            <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                            <h2 className="text-lg font-semibold mb-2">Connect Your Wallet</h2>
                            <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
                                Connect a wallet to submit leads to the marketplace and start earning USDC from buyer auctions.
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Use the <strong>Connect Wallet</strong> button in the top navigation bar.
                            </p>
                        </CardContent>
                    </Card>
                </div>
            </DashboardLayout>
        );
    }

    // Profile wizard
    if (!profileLoading && !hasProfile) {
        return (
            <DashboardLayout>
                <div className="max-w-xl mx-auto">
                    <div className="mb-8">
                        <h1 className="text-3xl font-bold">Set Up Seller Profile</h1>
                        <p className="text-muted-foreground">
                            Complete your seller profile before submitting leads
                        </p>
                    </div>

                    <Card>
                        <CardContent className="p-6 space-y-6">
                            <div className="flex items-center gap-3 p-4 rounded-lg bg-primary/5 border border-primary/10">
                                <UserPlus className="h-5 w-5 text-primary flex-shrink-0" />
                                <p className="text-sm text-muted-foreground">
                                    A seller profile lets you submit leads, create auction listings, and receive USDC payments.
                                </p>
                            </div>

                            {/* Company name */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Company Name</label>
                                <div className="relative">
                                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Your company or individual name"
                                        value={wizardCompany}
                                        onChange={(e) => setWizardCompany(e.target.value)}
                                        className="pl-10"
                                    />
                                </div>
                            </div>

                            {/* Verticals */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Lead Verticals</label>
                                <p className="text-xs text-muted-foreground">Select the verticals you plan to sell leads in</p>
                                <NestedVerticalSelect
                                    value=""
                                    onValueChange={(slug) => {
                                        setWizardVerticals((prev) =>
                                            prev.includes(slug) ? prev.filter((x) => x !== slug) : [...prev, slug]
                                        );
                                    }}
                                    placeholder="Add a vertical"
                                />
                                {wizardVerticals.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {wizardVerticals.map((v) => (
                                            <button
                                                key={v}
                                                type="button"
                                                onClick={() => setWizardVerticals((prev) => prev.filter((x) => x !== v))}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/80 transition-colors"
                                            >
                                                <VerticalBreadcrumb slug={v} size="sm" />
                                                <span className="ml-0.5">×</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* KYC CTA */}
                            <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                <Shield className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                                        KYC verification required for on-chain settlement
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        You can submit leads now, but verified sellers settle faster and earn higher trust scores.
                                    </p>
                                    <button
                                        type="button"
                                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 transition"
                                        onClick={() => window.open('/seller/kyc', '_blank')}
                                    >
                                        Verify Now →
                                    </button>
                                </div>
                            </div>

                            {profileError && (
                                <ErrorDetail error={profileError} onDismiss={() => setProfileError(null)} />
                            )}

                            <Button
                                className="w-full"
                                disabled={!wizardCompany.trim() || wizardVerticals.length === 0 || wizardSubmitting}
                                onClick={handleProfileCreate}
                            >
                                {wizardSubmitting ? 'Creating Profile...' : (
                                    <>
                                        <CheckCircle className="h-4 w-4 mr-2" />
                                        Create Seller Profile & Continue
                                    </>
                                )}
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold">Submit Lead</h1>
                    <p className="text-muted-foreground">
                        Add a verified lead to the marketplace for real-time bidding
                    </p>
                </div>

                <LeadSubmitForm
                    source="PLATFORM"
                    onSuccess={(lead) => navigate(`/seller/leads/${lead.id}`)}
                />
            </div>
        </DashboardLayout>
    );
}

export default SellerSubmit;
