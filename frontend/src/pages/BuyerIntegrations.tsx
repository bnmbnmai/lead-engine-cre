import { useState } from 'react';
import { Webhook, Link2, Check, Copy, Bot, Sparkles, Terminal, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { API_BASE_URL } from '@/lib/api';
import { AgentChatModal } from '@/components/integrations/AgentChatModal';

// ── Python starter code for LangChain + MCP ──

const PYTHON_STARTER = `"""
LangChain Autonomous Bidding Agent — Lead Engine CRE
Connects to the MCP JSON-RPC server to discover, evaluate, and bid on leads.
"""
import json, httpx

MCP_URL = "https://lead-engine-mcp.onrender.com/rpc"
API_KEY = "YOUR_API_KEY"

HEADERS = {"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"}

def mcp_call(method: str, params: dict | None = None) -> dict:
    """Call an MCP tool via JSON-RPC."""
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    r = httpx.post(MCP_URL, json=payload, headers=HEADERS, timeout=15)
    return r.json().get("result", r.json())

# ── Available Tools ──────────────────────────────
# search_leads      — Search marketplace by vertical, state, price
# place_bid         — Place a sealed-bid commitment on a lead
# get_bid_floor     — Get real-time bid floor pricing
# export_leads      — Export leads as CSV or JSON
# get_preferences   — Get buyer auto-bid preferences
# set_auto_bid_rules— Configure auto-bid rules per vertical
# configure_crm_webhook — Register CRM webhook
# ping_lead         — Get full lead details / status
# suggest_vertical  — AI-powered vertical classification

# ── Example: Search + Evaluate + Bid ─────────────
leads = mcp_call("search_leads", {"vertical": "solar", "state": "CA", "limit": 5})
print(f"Found {len(leads.get('asks', []))} leads")

for lead in leads.get("asks", [])[:3]:
    floor = mcp_call("get_bid_floor", {"vertical": lead["vertical"]})
    print(f"  Lead {lead['id']}: floor {floor.get('floor', '?')} USD")

# ── Example: Configure Auto-Bid ──────────────────
mcp_call("set_auto_bid_rules", {
    "vertical": "solar",
    "autoBidEnabled": True,
    "autoBidAmount": 45,
    "minQualityScore": 75,
    "dailyBudget": 500,
    "geoInclude": ["CA", "FL", "TX"],
})
print("Auto-bid configured!")
`;

export function BuyerIntegrations() {
    const [webhookUrl, setWebhookUrl] = useState('');
    const [webhookFormat, setWebhookFormat] = useState('generic');
    const [webhookSaved, setWebhookSaved] = useState(false);
    const [curlCopied, setCurlCopied] = useState(false);
    const [mcpCopied, setMcpCopied] = useState(false);
    const [pythonCopied, setPythonCopied] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [crmOpen, setCrmOpen] = useState(false);
    const [agentOpen, setAgentOpen] = useState(false);

    const token = localStorage.getItem('auth_token');
    const bearer = token ? token.slice(0, 12) + '…' : '<YOUR_JWT>';
    const mcpEndpoint = 'https://lead-engine-mcp.onrender.com/rpc';

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

    const copyMcpEndpoint = () => {
        navigator.clipboard.writeText(mcpEndpoint);
        setMcpCopied(true);
        setTimeout(() => setMcpCopied(false), 2000);
    };

    const copyPython = () => {
        navigator.clipboard.writeText(PYTHON_STARTER);
        setPythonCopied(true);
        setTimeout(() => setPythonCopied(false), 2000);
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
                    <CardHeader
                        className="cursor-pointer select-none"
                        onClick={() => setCrmOpen(!crmOpen)}
                    >
                        <CardTitle className="flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <Webhook className="h-5 w-5 text-amber-500" />
                                CRM Push
                            </span>
                            {crmOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </CardTitle>
                    </CardHeader>
                    {crmOpen && (
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
                    )}
                </Card>

                {/* ────────── LangChain Autonomous Bidding Agent ────────── */}
                <Card>
                    <CardHeader
                        className="cursor-pointer select-none"
                        onClick={() => setAgentOpen(!agentOpen)}
                    >
                        <CardTitle className="flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <div className="p-1 rounded-lg bg-gradient-to-br from-violet-500/20 to-blue-500/20">
                                    <Bot className="h-5 w-5 text-violet-400" />
                                </div>
                                Autonomous Bidding Agent (LangChain)
                            </span>
                            {agentOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </CardTitle>
                    </CardHeader>
                    {agentOpen && (
                        <CardContent className="space-y-5">
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                Run a fully autonomous AI agent that discovers, evaluates, and bids on leads
                                using our MCP tools. Connect via JSON-RPC or launch the interactive demo chat.
                            </p>

                            {/* MCP Endpoint */}
                            <div className="p-4 rounded-xl border border-border space-y-3">
                                <h4 className="text-sm font-semibold flex items-center gap-2">
                                    <Terminal className="h-4 w-4 text-muted-foreground" />
                                    MCP JSON-RPC Endpoint
                                </h4>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-border text-xs text-emerald-400 font-mono truncate">
                                        {mcpEndpoint}
                                    </code>
                                    <Button variant="outline" size="sm" onClick={copyMcpEndpoint} className="flex-shrink-0">
                                        {mcpCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                    </Button>
                                </div>
                            </div>

                            {/* Available Tools */}
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold">9 Available Tools</h4>
                                <div className="flex flex-wrap gap-1.5">
                                    {[
                                        'search_leads', 'place_bid', 'get_bid_floor',
                                        'export_leads', 'get_preferences', 'set_auto_bid_rules',
                                        'configure_crm_webhook', 'ping_lead', 'suggest_vertical',
                                    ].map((tool) => (
                                        <span key={tool} className="px-2 py-0.5 rounded-md text-xs font-mono bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                            {tool}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Python Starter Code (collapsed preview + copy) */}
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold">Python Starter Code</h4>
                                <div className="relative">
                                    <pre className="p-4 rounded-xl bg-black/40 border border-border text-xs text-emerald-400 font-mono overflow-x-auto whitespace-pre leading-relaxed max-h-48 overflow-y-auto">
                                        {`import httpx

MCP_URL = "${mcpEndpoint}"

def mcp_call(method, params=None):
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    return httpx.post(MCP_URL, json=payload, timeout=15).json()

# Search leads
leads = mcp_call("search_leads", {"vertical": "solar", "state": "CA"})

# Check bid floor
floor = mcp_call("get_bid_floor", {"vertical": "solar"})

# Configure auto-bid
mcp_call("set_auto_bid_rules", {
    "vertical": "solar", "autoBidAmount": 45, "dailyBudget": 500
})`}
                                    </pre>
                                    <button
                                        onClick={copyPython}
                                        className="absolute top-3 right-3 p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition text-white/60 hover:text-white"
                                    >
                                        {pythonCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                    </button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Full starter code with all 9 tools is copied when you click the button above.
                                </p>
                            </div>

                            {/* Action buttons */}
                            <div className="flex flex-wrap gap-3">
                                <Button
                                    onClick={() => setChatOpen(true)}
                                    className="bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700"
                                >
                                    <Sparkles className="h-4 w-4 mr-2" />
                                    Launch Demo Chat
                                </Button>
                                <Button variant="outline" asChild>
                                    <a
                                        href="https://github.com/bnmbnmai/lead-engine-cre/tree/main/mcp-server"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <FileText className="h-4 w-4 mr-2" />
                                        View Full Documentation
                                    </a>
                                </Button>
                            </div>

                            {/* Info box */}
                            <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1">
                                <p><strong>Protocol:</strong> JSON-RPC 2.0 over HTTP</p>
                                <p><strong>Auth:</strong> Bearer token in Authorization header</p>
                                <p><strong>Rate limit:</strong> 60 requests/min per agent</p>
                            </div>
                        </CardContent>
                    )}
                </Card>

                {/* Coming soon */}
                <div className="text-center py-8 text-muted-foreground text-sm">
                    More integrations coming soon — Salesforce, Zapier App
                </div>

                {/* Agent Chat Modal */}
                <AgentChatModal open={chatOpen} onOpenChange={setChatOpen} />
            </div>
        </DashboardLayout>
    );
}

export default BuyerIntegrations;
