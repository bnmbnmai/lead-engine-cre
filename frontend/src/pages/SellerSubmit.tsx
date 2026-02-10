import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Globe, Layout, Copy, Check, ExternalLink, Wallet, UserPlus, Building2, CheckCircle } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { LeadSubmitForm } from '@/components/forms/LeadSubmitForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import useAuth from '@/hooks/useAuth';
import api from '@/lib/api';

type SourceTab = 'PLATFORM' | 'API' | 'OFFSITE';

const TABS: { key: SourceTab; label: string; icon: React.ElementType; desc: string }[] = [
    { key: 'PLATFORM', label: 'Platform', icon: FileText, desc: 'Submit leads via the built-in form' },
    { key: 'API', label: 'API', icon: Globe, desc: 'Programmatic submission via REST API' },
    { key: 'OFFSITE', label: 'Hosted Lander', icon: Layout, desc: 'Customizable landing pages per vertical' },
];

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function CurlExample({ vertical = 'roofing', state = 'FL', country = 'US', zip = '33101', params = {} as Record<string, unknown> }: {
    vertical?: string; state?: string; country?: string; zip?: string; params?: Record<string, unknown>;
}) {
    const [copied, setCopied] = useState(false);

    const paramsStr = Object.keys(params).length > 0
        ? JSON.stringify(params, null, 6).replace(/^/gm, '    ').trim()
        : `{
      "roof_type": "shingle",
      "damage_type": "storm",
      "insurance_claim": true
    }`;

    const curlCmd = `curl -X POST ${API_BASE}/api/v1/leads/submit \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "vertical": "${vertical}",
    "source": "API",
    "geo": { "country": "${country}", "state": "${state}", "zip": "${zip}" },
    "reservePrice": 35.00,
    "expiresInMinutes": 60,
    "tcpaConsentAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "parameters": ${paramsStr}
  }'`;

    const handleCopy = () => {
        navigator.clipboard.writeText(curlCmd);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="relative">
            <pre className="bg-background border border-border rounded-lg p-4 text-xs overflow-x-auto text-muted-foreground font-mono leading-relaxed">
                {curlCmd}
            </pre>
            <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2"
                onClick={handleCopy}
            >
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </Button>
        </div>
    );
}

export function SellerSubmit() {
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();
    const [activeTab, setActiveTab] = useState<SourceTab>('PLATFORM');
    const [hasProfile, setHasProfile] = useState<boolean | null>(null);
    const [profileLoading, setProfileLoading] = useState(true);

    // Profile wizard state
    const [wizardCompany, setWizardCompany] = useState('');
    const [wizardVerticals, setWizardVerticals] = useState<string[]>([]);
    const [wizardSubmitting, setWizardSubmitting] = useState(false);

    const VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'b2b_saas', 'real_estate', 'auto', 'legal', 'financial'];

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
        try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
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
            }
        } catch {
            // Profile may already exist — treat as success
            setHasProfile(true);
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
                                <div className="flex flex-wrap gap-2">
                                    {VERTICALS.map((v) => (
                                        <button
                                            key={v}
                                            onClick={() => setWizardVerticals((prev) =>
                                                prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
                                            )}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${wizardVerticals.includes(v)
                                                ? 'bg-primary text-primary-foreground border-primary'
                                                : 'bg-muted/50 text-muted-foreground border-border hover:border-primary/50'
                                                }`}
                                        >
                                            {v.replace('_', ' ')}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* KYC Note */}
                            <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
                                <strong>KYC Notice:</strong> Full identity verification will be required before your leads can settle on-chain. You can start submitting leads now and complete KYC later.
                            </div>

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
                        Add leads to the marketplace via platform form, REST API, or hosted landers
                    </p>
                </div>

                {/* Source Tabs */}
                <div className="flex gap-2 mb-6 p-1 rounded-xl bg-muted/50">
                    {TABS.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === tab.key
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                                }`}
                        >
                            <tab.icon className="h-4 w-4" />
                            <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                {activeTab === 'PLATFORM' && (
                    <LeadSubmitForm
                        source="PLATFORM"
                        onSuccess={(lead) => navigate(`/lead/${lead.id}`)}
                    />
                )}

                {activeTab === 'API' && (
                    <div className="space-y-6">
                        {/* API Overview */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Globe className="h-5 w-5 text-primary" />
                                    REST API Integration
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Endpoint */}
                                <div>
                                    <h3 className="text-sm font-semibold mb-2">Endpoint</h3>
                                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 font-mono text-sm">
                                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-xs font-bold">POST</span>
                                        <span className="text-foreground">{API_BASE}/api/v1/leads/submit</span>
                                    </div>
                                </div>

                                {/* Auth */}
                                <div>
                                    <h3 className="text-sm font-semibold mb-2">Authentication</h3>
                                    <p className="text-sm text-muted-foreground mb-2">
                                        Include your API key in the Authorization header. Obtain your key by logging in
                                        with your wallet and using the JWT token from the auth flow.
                                    </p>
                                    <div className="p-3 rounded-lg bg-muted/50 font-mono text-xs text-muted-foreground">
                                        Authorization: Bearer {"<your_jwt_token>"}
                                    </div>
                                </div>

                                {/* Request Body */}
                                <div>
                                    <h3 className="text-sm font-semibold mb-3">Required Fields</h3>
                                    <div className="border border-border rounded-lg overflow-hidden">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-border bg-muted/30">
                                                    <th className="text-left p-3 font-medium">Field</th>
                                                    <th className="text-left p-3 font-medium">Type</th>
                                                    <th className="text-left p-3 font-medium">Description</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                <tr><td className="p-3 font-mono text-xs">vertical</td><td className="p-3 text-muted-foreground">string</td><td className="p-3 text-muted-foreground">solar, mortgage, roofing, insurance, etc.</td></tr>
                                                <tr><td className="p-3 font-mono text-xs">source</td><td className="p-3 text-muted-foreground">string</td><td className="p-3 text-muted-foreground">"API" for programmatic submissions</td></tr>
                                                <tr><td className="p-3 font-mono text-xs">geo.country</td><td className="p-3 text-muted-foreground">string</td><td className="p-3 text-muted-foreground">ISO 3166-1 alpha-2 (e.g. "US", "GB", "AU")</td></tr>
                                                <tr><td className="p-3 font-mono text-xs">geo.state</td><td className="p-3 text-muted-foreground">string</td><td className="p-3 text-muted-foreground">State/province code (e.g. "FL", "ON", "NSW")</td></tr>
                                                <tr><td className="p-3 font-mono text-xs">geo.region</td><td className="p-3 text-muted-foreground">string</td><td className="p-3 text-muted-foreground">Free-text region (for countries without state lists)</td></tr>
                                                <tr><td className="p-3 font-mono text-xs">geo.zip</td><td className="p-3 text-muted-foreground">string</td><td className="p-3 text-muted-foreground">Postal code — any format (ZIP, postcode, etc.)</td></tr>
                                                <tr><td className="p-3 font-mono text-xs">reservePrice</td><td className="p-3 text-muted-foreground">number</td><td className="p-3 text-muted-foreground">Min acceptable bid in USDC</td></tr>
                                                <tr><td className="p-3 font-mono text-xs">tcpaConsentAt</td><td className="p-3 text-muted-foreground">datetime</td><td className="p-3 text-muted-foreground">ISO 8601 timestamp of consent</td></tr>
                                                <tr><td className="p-3 font-mono text-xs">parameters</td><td className="p-3 text-muted-foreground">object</td><td className="p-3 text-muted-foreground">Vertical-specific fields (roof_type, loan_type, etc.)</td></tr>
                                                <tr><td className="p-3 font-mono text-xs">expiresInMinutes</td><td className="p-3 text-muted-foreground">number</td><td className="p-3 text-muted-foreground">5–10080 (default: 60)</td></tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div>
                                    <div className="flex gap-2 mb-3">
                                        <span className="text-sm font-semibold">Example: Roofing Lead (US/FL)</span>
                                    </div>
                                    <CurlExample vertical="roofing" state="FL" country="US" zip="33101" />
                                </div>

                                <div>
                                    <div className="flex gap-2 mb-3">
                                        <span className="text-sm font-semibold">Example: Solar Lead (AU/NSW)</span>
                                    </div>
                                    <CurlExample
                                        vertical="solar"
                                        state="NSW"
                                        country="AU"
                                        zip="2000"
                                        params={{
                                            roof_age: '5',
                                            monthly_bill: 280,
                                            ownership: 'own',
                                            panel_interest: 'purchase',
                                            shade_level: 'none',
                                        }}
                                    />
                                </div>

                                {/* Response */}
                                <div>
                                    <h3 className="text-sm font-semibold mb-2">Response</h3>
                                    <pre className="bg-background border border-border rounded-lg p-4 text-xs overflow-x-auto text-muted-foreground font-mono leading-relaxed">{`{
  "lead": {
    "id": "clx...",
    "vertical": "roofing",
    "status": "IN_AUCTION",
    "isVerified": true,
    "matchingAsks": 3,
    "auctionEndAt": "2026-02-10T05:28:00Z"
  }
}`}</pre>
                                </div>

                                {/* Edge Cases */}
                                <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
                                    <h4 className="text-sm font-semibold text-amber-500 mb-2">⚠ Geo-Mismatch Handling</h4>
                                    <p className="text-xs text-muted-foreground">
                                        If the submitted geo doesn't match any active ask's geo targets, the lead will still
                                        be created but won't enter auction until a matching ask is posted. Leads expire after
                                        the specified <code className="font-mono">expiresInMinutes</code> window.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Vertical Parameters Reference */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Vertical-Specific Parameters</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4 text-sm">
                                    <div>
                                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">roofing</span>
                                        <p className="text-muted-foreground mt-1 text-xs">roof_type, damage_type, insurance_claim, roof_age, square_footage</p>
                                    </div>
                                    <div>
                                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">mortgage</span>
                                        <p className="text-muted-foreground mt-1 text-xs">loan_type, credit_range, property_type, purchase_price, down_payment_pct</p>
                                    </div>
                                    <div>
                                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">solar</span>
                                        <p className="text-muted-foreground mt-1 text-xs">roof_age, monthly_bill, ownership, panel_interest, shade_level</p>
                                    </div>
                                    <div>
                                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">insurance</span>
                                        <p className="text-muted-foreground mt-1 text-xs">coverage_type, current_provider, policy_expiry, num_drivers</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="text-center">
                            <a
                                href={`${API_BASE}/api/swagger`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                            >
                                <ExternalLink className="h-4 w-4" />
                                View Full OpenAPI Spec (Swagger UI)
                            </a>
                        </div>
                    </div>
                )}

                {activeTab === 'OFFSITE' && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Layout className="h-5 w-5 text-primary" />
                                Hosted Landing Pages
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <p className="text-muted-foreground">
                                Hosted landers are customizable lead capture pages tailored to specific verticals.
                                Each lander automatically submits captured leads to the marketplace with <code className="font-mono text-xs">source: "OFFSITE"</code>.
                            </p>

                            {/* How It Works */}
                            <div>
                                <h3 className="text-sm font-semibold mb-3">How It Works</h3>
                                <div className="grid gap-3">
                                    {[
                                        { step: '1', title: 'Choose a vertical template', desc: 'Pre-built forms for roofing, mortgage, solar, insurance, and more' },
                                        { step: '2', title: 'Customize branding & fields', desc: 'Add your logo, colors, and required qualification questions' },
                                        { step: '3', title: 'Deploy to your domain', desc: 'Get a hosted URL or embed via iframe on your existing site' },
                                        { step: '4', title: 'Leads auto-submit to marketplace', desc: 'Captured leads are verified, matched to asks, and enter auction' },
                                    ].map((item) => (
                                        <div key={item.step} className="flex gap-3 p-3 rounded-lg bg-muted/30">
                                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                                <span className="text-sm font-bold text-primary">{item.step}</span>
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium">{item.title}</div>
                                                <div className="text-xs text-muted-foreground">{item.desc}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Webhook Alternative */}
                            <div className="p-4 rounded-lg border border-border bg-muted/20">
                                <h4 className="text-sm font-semibold mb-2">Alternative: Webhook Integration</h4>
                                <p className="text-xs text-muted-foreground mb-3">
                                    Already have your own landing pages? Point your form's webhook URL to our API endpoint.
                                    Leads will be ingested with <code className="font-mono">source: "OFFSITE"</code> and processed identically.
                                </p>
                                <div className="flex items-center gap-2 p-2 rounded bg-background font-mono text-xs text-muted-foreground">
                                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-bold">POST</span>
                                    {API_BASE}/api/v1/leads/submit
                                </div>
                            </div>

                            {/* Coming Soon */}
                            <div className="text-center py-4">
                                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
                                    Visual lander builder — coming soon
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                    In the meantime, use the API tab to set up webhook-based offsite submissions
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </DashboardLayout>
    );
}

export default SellerSubmit;
