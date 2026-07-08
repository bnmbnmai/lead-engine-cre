import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function AgentDocs() {
    return (
        <div className="min-h-screen bg-background">
            <header className="border-b px-6 py-4 flex items-center justify-between">
                <Link to="/" className="font-bold text-[#375BD2]">AgentRTB</Link>
                <Link to="/status" className="text-sm text-muted-foreground hover:text-foreground">Status</Link>
            </header>
            <article className="container mx-auto px-6 py-10 max-w-3xl prose prose-invert prose-sm">
                <h1 className="flex items-center gap-2"><BookOpen className="h-6 w-6" /> AgentRTB Integration Guide</h1>

                <h2>Authentication</h2>
                <p>Use <code>Authorization: Bearer lea_...</code> API keys or JWT from SIWE wallet login.</p>
                <ul>
                    <li><code>GET /api/v1/auth/nonce/:address</code> → <code>POST /api/v1/auth/wallet</code></li>
                    <li>Sandbox keys: <code>POST /api/v1/agent/api-keys</code> with <code>{`{ "sandbox": true }`}</code> (simulate only)</li>
                </ul>

                <h2>StrategySpec lifecycle</h2>
                <ol>
                    <li><code>POST /api/v1/strategies/draft</code> — optional LLM advisory</li>
                    <li><code>POST /api/v1/strategies</code> — create from JSON spec</li>
                    <li><code>POST /api/v1/strategies/:id/activate</code> — enable deterministic bidding</li>
                    <li><code>POST /api/v1/agent/simulate</code> — backtest without spending</li>
                </ol>

                <h2>Webhooks</h2>
                <p>Register HTTPS endpoints. Verify <code>X-AgentRTB-Signature</code> (HMAC-SHA256 of body with your webhook secret).</p>
                <p>Events: <code>lead.matched</code>, <code>bid.placed</code>, <code>strategy.decision</code>, <code>auction.won</code></p>
                <p>Delivery logs: <code>GET /api/v1/agent/webhooks/:id/deliveries</code></p>

                <h2>API scopes (lea_ keys)</h2>
                <ul>
                    <li><code>read</code> — traces, list strategies, simulate</li>
                    <li><code>bid</code> — create/activate strategies, pipeline enqueue</li>
                    <li><code>admin</code> — API keys, webhook registration</li>
                </ul>

                <h2>Discovery</h2>
                <ul>
                    <li><a href={`${API_BASE}/.well-known/agent.json`} target="_blank" rel="noreferrer">/.well-known/agent.json</a></li>
                    <li><a href={`${API_BASE}/api/swagger`} target="_blank" rel="noreferrer">OpenAPI / Swagger UI</a></li>
                    <li><a href={`${API_BASE}/api/openapi.json`} target="_blank" rel="noreferrer">openapi.json</a></li>
                </ul>

                <p className="text-muted-foreground text-xs mt-8">
                    Full guide in repo: <code>docs/AGENT_DEVELOPER_GUIDE.md</code> · SDK: <code>@lead-engine/agent-sdk</code>
                </p>
            </article>
        </div>
    );
}
