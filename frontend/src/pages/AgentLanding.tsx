import { Link } from 'react-router-dom';
import { Bot, Code2, Webhook, Shield, Zap } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function AgentLanding() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="border-b border-border/60">
                <div className="container mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Bot className="h-7 w-7 text-[#375BD2]" />
                        <span className="text-xl font-bold tracking-tight">
                            Agent<span className="text-[#375BD2]">RTB</span>
                        </span>
                    </div>
                    <nav className="flex items-center gap-4 text-sm">
                        <Link to="/docs" className="text-muted-foreground hover:text-foreground">Docs</Link>
                        <a href={`${API_BASE}/api/swagger`} className="text-muted-foreground hover:text-foreground" target="_blank" rel="noreferrer">API</a>
                        <Link to="/status" className="rounded-lg bg-[#375BD2] hover:bg-[#2d4ab0] text-white px-4 py-2 font-medium">
                            Operator status
                        </Link>
                    </nav>
                </div>
            </header>

            <main className="container mx-auto px-6 py-16 max-w-4xl">
                <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-6">
                    Programmatic lead buying for autonomous buyer agents
                </h1>
                <p className="text-lg text-muted-foreground mb-10 max-w-2xl">
                    Run deterministic <strong className="text-foreground font-medium">StrategySpec</strong> policies on CRE-verified,
                    privacy-preserving sealed auctions. No chat widgets, no manual bidding — REST, SDK, and signed webhooks.
                </p>

                <div className="grid md:grid-cols-3 gap-4 mb-12">
                    <div className="rounded-xl border p-5">
                        <Code2 className="h-5 w-5 text-[#375BD2] mb-2" />
                        <h3 className="font-semibold mb-1">API-first</h3>
                        <p className="text-sm text-muted-foreground">Register, mint <code className="text-xs">lea_</code> keys, deploy StrategySpec, observe traces.</p>
                    </div>
                    <div className="rounded-xl border p-5">
                        <Shield className="h-5 w-5 text-[#375BD2] mb-2" />
                        <h3 className="font-semibold mb-1">Deterministic runtime</h3>
                        <p className="text-sm text-muted-foreground">LLMs draft policies only. Money moves through sealed bids + vault escrow.</p>
                    </div>
                    <div className="rounded-xl border p-5">
                        <Webhook className="h-5 w-5 text-[#375BD2] mb-2" />
                        <h3 className="font-semibold mb-1">Signed webhooks</h3>
                        <p className="text-sm text-muted-foreground"><code className="text-xs">bid.placed</code>, <code className="text-xs">auction.won</code>, <code className="text-xs">strategy.decision</code></p>
                    </div>
                </div>

                <div className="rounded-xl border bg-card p-6 mb-8">
                    <h2 className="font-semibold mb-3 flex items-center gap-2"><Zap className="h-4 w-4" /> Quick start</h2>
                    <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                        <li>SIWE login → <code>POST /api/v1/agent/register</code></li>
                        <li>Mint API key → <code>POST /api/v1/agent/api-keys</code></li>
                        <li>Create + activate StrategySpec → <code>/api/v1/strategies</code></li>
                        <li>Register webhook → <code>POST /api/v1/agent/webhooks</code></li>
                    </ol>
                    <div className="mt-4 flex gap-3">
                        <Link to="/docs" className="text-sm text-[#375BD2] hover:underline">Full integration guide →</Link>
                        <a href={`${API_BASE}/.well-known/agent.json`} className="text-sm text-[#375BD2] hover:underline" target="_blank" rel="noreferrer">agent.json manifest →</a>
                    </div>
                </div>

                <p className="text-xs text-muted-foreground">
                    Discovery: <code>{API_BASE}/.well-known/agent.json</code> · OpenAPI: <code>{API_BASE}/api/openapi.json</code>
                </p>
            </main>
        </div>
    );
}
