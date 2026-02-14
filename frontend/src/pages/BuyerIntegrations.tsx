import { useState } from 'react';
import { Webhook, Link2, Check, Shield, Copy } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { API_BASE_URL } from '@/lib/api';

export function BuyerIntegrations() {
    const [webhookUrl, setWebhookUrl] = useState('');
    const [webhookFormat, setWebhookFormat] = useState('generic');
    const [webhookSaved, setWebhookSaved] = useState(false);
    const [curlCopied, setCurlCopied] = useState(false);

    const token = localStorage.getItem('auth_token');
    const bearer = token ? token.slice(0, 12) + '…' : '<YOUR_JWT>';

    const pushCurl = `curl -X POST ${API_BASE_URL}/api/v1/crm/push \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${bearer}" \\
  -d '{
    "leadIds": ["clx_lead_id_1", "clx_lead_id_2"],
    "webhookUrl": "https://your-crm.com/leads",
    "format": "generic"
  }'`;

    const copyCurl = () => {
        navigator.clipboard.writeText(pushCurl);
        setCurlCopied(true);
        setTimeout(() => setCurlCopied(false), 2000);
    };

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
        } catch { /* global error handler */ }
    };

    return (
        <DashboardLayout>
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Header */}
                <div>
                    <h1 className="text-3xl font-bold">Integrations</h1>
                    <p className="text-muted-foreground">
                        Push purchased leads to your CRM and connect external systems
                    </p>
                </div>

                {/* ────────── CRM Push ────────── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Webhook className="h-5 w-5 text-amber-500" />
                            CRM Push
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <p className="text-sm text-muted-foreground">
                            Push purchased leads directly to your CRM via webhook. Supports HubSpot, Zapier, and
                            generic JSON payloads.
                        </p>

                        {/* Webhook registration */}
                        <div className="p-4 rounded-xl border border-border space-y-4">
                            <h4 className="text-sm font-semibold">Register Webhook</h4>
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
                        </div>

                        {/* API push example */}
                        <div className="space-y-2">
                            <h4 className="text-sm font-semibold">Push via API</h4>
                            <p className="text-xs text-muted-foreground">
                                Alternatively, push specific leads programmatically using the CRM push endpoint:
                            </p>
                            <div className="relative">
                                <pre className="p-4 rounded-xl bg-black/40 border border-border text-xs text-emerald-400 font-mono overflow-x-auto whitespace-pre leading-relaxed">
                                    {pushCurl}
                                </pre>
                                <button
                                    onClick={copyCurl}
                                    className="absolute top-3 right-3 p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition text-white/60 hover:text-white"
                                >
                                    {curlCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                </button>
                            </div>
                        </div>

                        {/* Info box */}
                        <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1">
                            <p><strong>Formats:</strong> HubSpot (Contact + Deal), Zapier (catch hook), Generic (full lead JSON)</p>
                            <p><strong>Rate limit:</strong> 60 fires / minute per webhook</p>
                            <p><strong>Retries:</strong> 3 attempts with exponential backoff; circuit breaker after 5 consecutive failures</p>
                        </div>
                    </CardContent>
                </Card>

                {/* ────────── Chainlink ────────── */}
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-start gap-4">
                            <div className="p-3 rounded-xl bg-primary/10">
                                <Shield className="h-6 w-6 text-primary" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-lg font-semibold">Chainlink Verification</h3>
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    Every lead you purchase has been verified through{' '}
                                    <strong>Chainlink CRE</strong> before the auction starts. Verification covers
                                    TCPA consent, data completeness, duplicate detection, and fraud scoring.
                                    Results are anchored on-chain for auditability.
                                </p>
                                <div className="flex flex-wrap gap-2 mt-3">
                                    {['TCPA Verified', 'Fraud Scored', 'On-Chain Proof', 'Duplicate Checked'].map((badge) => (
                                        <span key={badge} className="px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                                            {badge}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Coming soon */}
                <div className="text-center py-8 text-muted-foreground text-sm">
                    More integrations coming soon — Salesforce, Zapier App, LangChain agents
                </div>
            </div>
        </DashboardLayout>
    );
}

export default BuyerIntegrations;
