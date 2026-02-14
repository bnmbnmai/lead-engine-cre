import { useState } from 'react';
import { Copy, Check, Globe, Webhook, Link2, ChevronDown, ChevronUp } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { API_BASE_URL } from '@/lib/api';

/* ─── Curl example builder ─── */
function CurlExample({ token }: { token: string | null }) {
    const [copied, setCopied] = useState(false);
    const bearer = token ? token.slice(0, 12) + '…' : '<YOUR_JWT>';
    const curl = `curl -X POST ${API_BASE_URL}/api/v1/marketplace/leads \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${bearer}" \\
  -d '{
    "vertical": "solar",
    "geo": { "country": "US", "state": "FL", "zip": "33101" },
    "source": "API",
    "reservePrice": 25,
    "tcpaConsentAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "parameters": {
      "monthly_bill": "250",
      "ownership": "own",
      "roof_age": "8"
    }
  }'`;

    const copy = () => {
        navigator.clipboard.writeText(curl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="relative">
            <pre className="p-4 rounded-xl bg-black/40 border border-border text-xs text-emerald-400 font-mono overflow-x-auto whitespace-pre leading-relaxed">
                {curl}
            </pre>
            <button
                onClick={copy}
                className="absolute top-3 right-3 p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition text-white/60 hover:text-white"
            >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
        </div>
    );
}

/* ─── Field reference table ─── */
const REQUIRED_FIELDS = [
    { field: 'vertical', type: 'string', desc: 'Vertical slug (e.g. "solar", "mortgage.refinance")' },
    { field: 'geo.country', type: 'string', desc: '2-letter ISO country code' },
    { field: 'source', type: 'enum', desc: '"PLATFORM" | "API" | "OFFSITE"' },
    { field: 'reservePrice', type: 'number', desc: 'Minimum bid price in USDC' },
    { field: 'tcpaConsentAt', type: 'ISO 8601', desc: 'Timestamp of consumer TCPA consent' },
];
const OPTIONAL_FIELDS = [
    { field: 'geo.state', type: 'string', desc: 'State / province code' },
    { field: 'geo.city', type: 'string', desc: 'City name' },
    { field: 'geo.zip', type: 'string', desc: 'ZIP / postal code' },
    { field: 'parameters', type: 'object', desc: 'Vertical-specific fields (e.g. roof_type, credit_range)' },
    { field: 'adSource', type: 'object', desc: 'UTM tracking — { utm_source, utm_medium, utm_campaign, … }' },
    { field: 'expiresInMinutes', type: 'number', desc: 'Lead TTL (5–10080 min, default 5)' },
];

export function SellerIntegrations() {
    const [apiOpen, setApiOpen] = useState(false);
    const [webhookOpen, setWebhookOpen] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState('');
    const [webhookFormat, setWebhookFormat] = useState('generic');
    const [webhookSaved, setWebhookSaved] = useState(false);

    const token = localStorage.getItem('auth_token');

    const saveWebhook = async () => {
        if (!webhookUrl.trim()) return;
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/crm/webhooks`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ url: webhookUrl, format: webhookFormat }),
            });
            if (res.ok) {
                setWebhookSaved(true);
                setTimeout(() => setWebhookSaved(false), 3000);
            }
        } catch { /* toast handled by global error */ }
    };

    return (
        <DashboardLayout>
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Header */}
                <div>
                    <h1 className="text-3xl font-bold">Integrations</h1>
                    <p className="text-muted-foreground">
                        Connect your systems to the Lead Engine marketplace
                    </p>
                </div>

                {/* ────────── REST API ────────── */}
                <Card>
                    <CardHeader
                        className="cursor-pointer select-none"
                        onClick={() => setApiOpen(!apiOpen)}
                    >
                        <CardTitle className="flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <Globe className="h-5 w-5 text-primary" />
                                REST API
                            </span>
                            {apiOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </CardTitle>
                    </CardHeader>
                    {apiOpen && (
                        <CardContent className="space-y-6">
                            {/* Endpoint */}
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold">Endpoint</h4>
                                <code className="block p-3 rounded-lg bg-muted text-sm font-mono">
                                    POST {API_BASE_URL}/api/v1/marketplace/leads
                                </code>
                            </div>

                            {/* Auth */}
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold">Authentication</h4>
                                <p className="text-sm text-muted-foreground">
                                    Include your JWT in the <code className="text-xs bg-muted px-1 py-0.5 rounded">Authorization: Bearer &lt;token&gt;</code> header.
                                    Obtain a token via SIWE (Sign-In with Ethereum) at <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/v1/auth/login</code>.
                                </p>
                            </div>

                            {/* Curl example */}
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold">Example Request</h4>
                                <CurlExample token={token} />
                            </div>

                            {/* Field reference */}
                            <div className="space-y-3">
                                <h4 className="text-sm font-semibold">Required Fields</h4>
                                <div className="rounded-lg border border-border overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-muted/50">
                                                <th className="text-left px-4 py-2 font-medium">Field</th>
                                                <th className="text-left px-4 py-2 font-medium">Type</th>
                                                <th className="text-left px-4 py-2 font-medium">Description</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {REQUIRED_FIELDS.map((f) => (
                                                <tr key={f.field} className="border-t border-border">
                                                    <td className="px-4 py-2 font-mono text-xs text-primary">{f.field}</td>
                                                    <td className="px-4 py-2 text-xs text-muted-foreground">{f.type}</td>
                                                    <td className="px-4 py-2 text-xs">{f.desc}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <h4 className="text-sm font-semibold mt-4">Optional Fields</h4>
                                <div className="rounded-lg border border-border overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-muted/50">
                                                <th className="text-left px-4 py-2 font-medium">Field</th>
                                                <th className="text-left px-4 py-2 font-medium">Type</th>
                                                <th className="text-left px-4 py-2 font-medium">Description</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {OPTIONAL_FIELDS.map((f) => (
                                                <tr key={f.field} className="border-t border-border">
                                                    <td className="px-4 py-2 font-mono text-xs text-primary">{f.field}</td>
                                                    <td className="px-4 py-2 text-xs text-muted-foreground">{f.type}</td>
                                                    <td className="px-4 py-2 text-xs">{f.desc}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Response */}
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold">Response</h4>
                                <pre className="p-4 rounded-xl bg-black/40 border border-border text-xs text-sky-400 font-mono overflow-x-auto leading-relaxed">{`{
  "lead": {
    "id": "clx...",
    "vertical": "solar",
    "status": "PENDING_AUCTION",
    "reservePrice": 25,
    "createdAt": "2026-02-14T..."
  }
}`}</pre>
                            </div>
                        </CardContent>
                    )}
                </Card>

                {/* ────────── CRM / Webhooks ────────── */}
                <Card>
                    <CardHeader
                        className="cursor-pointer select-none"
                        onClick={() => setWebhookOpen(!webhookOpen)}
                    >
                        <CardTitle className="flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <Webhook className="h-5 w-5 text-amber-500" />
                                CRM / Webhooks
                            </span>
                            {webhookOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </CardTitle>
                    </CardHeader>
                    {webhookOpen && (
                        <CardContent className="space-y-5">
                            <p className="text-sm text-muted-foreground">
                                Register a webhook URL to receive real-time notifications when your lead status changes
                                (e.g. auction started, bid received, sold, expired).
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
                                <Input
                                    placeholder="https://your-crm.com/webhook"
                                    value={webhookUrl}
                                    onChange={(e) => setWebhookUrl(e.target.value)}
                                />
                                <Select value={webhookFormat} onValueChange={setWebhookFormat}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="generic">Generic JSON</SelectItem>
                                        <SelectItem value="hubspot">HubSpot</SelectItem>
                                        <SelectItem value="zapier">Zapier</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <Button onClick={saveWebhook} disabled={!webhookUrl.trim()}>
                                {webhookSaved ? (
                                    <><Check className="h-4 w-4 mr-2" /> Saved</>
                                ) : (
                                    <><Link2 className="h-4 w-4 mr-2" /> Register Webhook</>
                                )}
                            </Button>

                            <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1">
                                <p><strong>Events:</strong> lead.auction_started, lead.bid_received, lead.sold, lead.expired, lead.cancelled</p>
                                <p><strong>Rate limit:</strong> 60 fires / minute per webhook</p>
                                <p><strong>Retries:</strong> 3 attempts with exponential backoff; circuit breaker after 5 consecutive failures</p>
                            </div>
                        </CardContent>
                    )}
                </Card>

                {/* Coming soon placeholder */}
                <div className="text-center py-8 text-muted-foreground text-sm">
                    More integrations coming soon — Salesforce, Zapier App, LangChain agents
                </div>
            </div>
        </DashboardLayout>
    );
}

export default SellerIntegrations;
