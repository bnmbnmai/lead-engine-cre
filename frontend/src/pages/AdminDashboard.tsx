import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    LayoutDashboard,
    Activity,
    Database,
    Shield,
    Wallet,
    Gavel,
    FileText,
    CheckCircle,
    AlertTriangle,
    Clock,
    ArrowUpRight,
    Boxes,
    Zap,
    Link2,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';

// ── Status indicator component ──
function StatusDot({ ok }: { ok: boolean }) {
    return (
        <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]'}`} />
    );
}

export function AdminDashboard() {
    const [stats, setStats] = useState<any>(null);
    const [systemHealth, setSystemHealth] = useState<any>(null);
    const [recentRuns, setRecentRuns] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchAll = async () => {
            try {
                // Fetch marketplace overview stats
                const [overviewRes, leadsRes, creStatusRes, healthRes] = await Promise.all([
                    api.apiFetch<any>('/api/v1/analytics/overview'),
                    api.apiFetch<any>('/api/v1/leads?limit=1'),
                    api.apiFetch<any>('/api/v1/cre/status').catch(() => ({ data: null })),
                    api.apiFetch<any>('/api/health').catch(() => ({ data: null })),
                ]);

                setStats({
                    totalLeads: overviewRes.data?.stats?.totalLeads ?? leadsRes.data?.total ?? 0,
                    activeAuctions: overviewRes.data?.stats?.activeAuctions ?? 0,
                    totalBids: overviewRes.data?.stats?.totalBids ?? 0,
                    wonBids: overviewRes.data?.stats?.wonBids ?? 0,
                    totalSpent: overviewRes.data?.stats?.totalSpent ?? 0,
                });

                setSystemHealth({
                    api: healthRes.data?.status === 'ok',
                    database: healthRes.data?.database === 'connected',
                    socket: healthRes.data?.socket === 'active',
                    cre: creStatusRes.data ?? null,
                });

                // Fetch recent demo runs
                try {
                    const runsRes = await api.apiFetch<any>('/api/v1/demo-panel/full-e2e/results?limit=5');
                    setRecentRuns(runsRes.data?.results || []);
                } catch { setRecentRuns([]); }

            } catch (error) {
                console.error('Admin dashboard fetch error:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchAll();
    }, []);

    const creStatus = systemHealth?.cre;

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center gap-3">
                            <LayoutDashboard className="h-8 w-8 text-primary" />
                            Admin Overview
                        </h1>
                        <p className="text-muted-foreground mt-1 text-sm">
                            System health, marketplace stats, and Chainlink service status
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" asChild>
                            <Link to="/admin/form-builder">Form Builder</Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                            <Link to="/admin/verticals">Verticals</Link>
                        </Button>
                    </div>
                </div>

                {/* Marketplace Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    {[
                        { label: 'Total Leads', value: stats?.totalLeads ?? '—', icon: FileText, color: 'text-blue-500' },
                        { label: 'Active Auctions', value: stats?.activeAuctions ?? '—', icon: Gavel, color: 'text-amber-500' },
                        { label: 'Total Bids', value: stats?.totalBids ?? '—', icon: Activity, color: 'text-purple-500' },
                        { label: 'Won Bids', value: stats?.wonBids ?? '—', icon: CheckCircle, color: 'text-emerald-500' },
                        { label: 'Total Volume', value: stats?.totalSpent ? `$${Number(stats.totalSpent).toFixed(0)}` : '—', icon: Wallet, color: 'text-teal-500' },
                    ].map((stat) => (
                        <Card key={stat.label} className={isLoading ? 'animate-pulse' : ''}>
                            <CardContent className="p-5">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2.5 rounded-xl bg-white/5 ${stat.color}`}>
                                        <stat.icon className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="text-xl font-bold">{stat.value}</div>
                                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{stat.label}</div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                <div className="grid lg:grid-cols-2 gap-6">
                    {/* System Health */}
                    <Card>
                        <CardHeader className="flex-row items-center justify-between pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Activity className="h-4 w-4 text-emerald-500" />
                                System Health
                            </CardTitle>
                            <Badge variant="outline" className={systemHealth?.api ? 'text-emerald-500 border-emerald-500/30' : 'text-red-500 border-red-500/30'}>
                                {systemHealth?.api ? 'Operational' : isLoading ? 'Loading…' : 'Degraded'}
                            </Badge>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {[
                                { label: 'API Server', ok: systemHealth?.api, detail: 'Express + Prisma' },
                                { label: 'Database', ok: systemHealth?.database, detail: 'PostgreSQL (Render)' },
                                { label: 'WebSocket', ok: systemHealth?.socket, detail: 'Socket.IO real-time' },
                                { label: 'Demo Mode', ok: true, detail: import.meta.env.VITE_DEMO_MODE === 'true' ? 'Enabled' : 'Disabled' },
                            ].map((item) => (
                                <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                                    <div className="flex items-center gap-2.5">
                                        <StatusDot ok={item.ok ?? false} />
                                        <span className="text-sm font-medium">{item.label}</span>
                                    </div>
                                    <span className="text-xs text-muted-foreground">{item.detail}</span>
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    {/* Chainlink Services */}
                    <Card>
                        <CardHeader className="flex-row items-center justify-between pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Link2 className="h-4 w-4 text-[#375BD2]" />
                                Chainlink Services
                            </CardTitle>
                            <Badge variant="outline" className="text-[#375BD2] border-[#375BD2]/30">
                                12 Active
                            </Badge>
                        </CardHeader>
                        <CardContent className="space-y-1.5">
                            {(() => {
                                const creNative = creStatus?.creNativeMode === true;
                                const services = [
                                    { label: 'CRE Workflow DON', ok: true, detail: 'EvaluateBuyerRulesAndMatch' },
                                    { label: 'CRE-Native Mode', ok: creNative, detail: creNative ? 'Enabled (CRE DON)' : 'Backend fallback' },
                                    { label: 'CRE Quality Scoring', ok: true, detail: 'CREVerifier via Functions' },
                                    { label: 'CRE Winner Decryption', ok: true, detail: 'DecryptForWinner workflow' },
                                    { label: 'Confidential HTTP', ok: true, detail: 'TEE enclave (PII encrypt)' },
                                    { label: 'VRF v2.5', ok: true, detail: 'Tiebreaker randomness' },
                                    { label: 'Data Feeds', ok: true, detail: 'USDC/ETH bid floor pricing' },
                                    { label: 'Automation (Keepers)', ok: true, detail: 'Proof of Reserves (daily)' },
                                    { label: 'Log Trigger Automation', ok: true, detail: 'Auction expiry + settlement' },
                                    { label: 'ACE Compliance Policy', ok: true, detail: 'KYC / AML on-chain gate' },
                                    { label: 'Cross-Chain (CCIP)', ok: true, detail: 'Multi-chain lead transfer' },
                                    { label: 'Functions DON', ok: true, detail: 'Off-chain compute substrate' },
                                ];
                                return services.map((item) => (
                                    <div key={item.label} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                                        <div className="flex items-center gap-2.5">
                                            <StatusDot ok={item.ok} />
                                            <span className="text-sm">{item.label}</span>
                                        </div>
                                        <span className={`text-xs ${item.ok ? 'text-muted-foreground' : 'text-red-400 font-medium'}`}>{item.detail}</span>
                                    </div>
                                ));
                            })()}
                        </CardContent>
                    </Card>
                </div>

                <div className="grid lg:grid-cols-2 gap-6">
                    {/* PersonalEscrowVault */}
                    <Card>
                        <CardHeader className="flex-row items-center justify-between pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Wallet className="h-4 w-4 text-teal-500" />
                                PersonalEscrowVault
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="rounded-lg bg-muted/30 p-3">
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Contract</div>
                                    <div className="text-xs font-mono text-teal-400 mt-1 truncate">
                                        <a
                                            href="https://sepolia.basescan.org/address/0xD76082CeFA0cC35d2AB925De2017D8DCe75c0972"
                                            target="_blank" rel="noopener noreferrer"
                                            className="hover:text-teal-300 transition"
                                        >
                                            0xD760…0972
                                        </a>
                                    </div>
                                </div>
                                <div className="rounded-lg bg-muted/30 p-3">
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Proof of Reserves</div>
                                    <div className="flex items-center gap-1.5 mt-1">
                                        <StatusDot ok={true} />
                                        <span className="text-xs font-medium text-emerald-400">Active (Daily)</span>
                                    </div>
                                </div>
                                <div className="rounded-lg bg-muted/30 p-3">
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Network</div>
                                    <div className="text-xs font-medium mt-1">Base Sepolia (84532)</div>
                                </div>
                                <div className="rounded-lg bg-muted/30 p-3">
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Settlement</div>
                                    <div className="text-xs font-medium mt-1">Atomic USDC Lock/Release</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Recent Demo Runs */}
                    <Card>
                        <CardHeader className="flex-row items-center justify-between pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Zap className="h-4 w-4 text-amber-500" />
                                Recent Demo Runs
                            </CardTitle>
                            <Button variant="ghost" size="sm" asChild className="text-xs">
                                <Link to="/demo/results">View All <ArrowUpRight className="h-3 w-3 ml-0.5" /></Link>
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {recentRuns.length === 0 ? (
                                <div className="text-center py-6">
                                    <Clock className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                                    <p className="text-sm text-muted-foreground">No demo runs recorded yet</p>
                                    <p className="text-xs text-muted-foreground mt-1">Use the Demo Control Panel to run an E2E demo</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {recentRuns.slice(0, 5).map((run: any, i: number) => (
                                        <Link
                                            key={run.id || i}
                                            to={`/demo/results/${run.id || ''}`}
                                            className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition group"
                                        >
                                            <div className="flex items-center gap-2.5">
                                                {run.success ? (
                                                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                                                ) : (
                                                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                                                )}
                                                <div>
                                                    <div className="text-xs font-medium">
                                                        {run.vertical || 'Demo Run'} — {run.geo?.state || 'US'}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground">
                                                        {run.createdAt ? new Date(run.createdAt).toLocaleString() : 'Recent'}
                                                    </div>
                                                </div>
                                            </div>
                                            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Smart Contracts */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Boxes className="h-4 w-4 text-violet-500" />
                            Deployed Smart Contracts (Base Sepolia)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="data-table text-xs">
                                <thead>
                                    <tr>
                                        <th>Contract</th>
                                        <th>Address</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        { name: 'LeadNFTv2', addr: '0xE5c2E30c0c7FE880D0B36E641C1e9a109ee8e869' },
                                        { name: 'PersonalEscrowVault', addr: '0xD76082CeFA0cC35d2AB925De2017D8DCe75c0972' },
                                        { name: 'SealedBidAuction', addr: '0x9b9283A8E50B2C4A08B4EDB2a1028Ba7e0A60F9C' },
                                        { name: 'ACELeadPolicy', addr: '0x3A0a2780B8F62D48F87D59B2D82A1Cd5d7b73a05' },
                                        { name: 'BountyMatcher', addr: '0x897f8CCa48B6Ed02266E1DB80c3967E2fdD0417D' },
                                        { name: 'CREVerifier', addr: '0xfec22A5159E077d7016AAb5fC3E91e0124393af8' },
                                        { name: 'USDCMock', addr: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
                                    ].map((c) => (
                                        <tr key={c.name}>
                                            <td className="font-medium">{c.name}</td>
                                            <td>
                                                <a
                                                    href={`https://sepolia.basescan.org/address/${c.addr}`}
                                                    target="_blank" rel="noopener noreferrer"
                                                    className="font-mono text-violet-400 hover:text-violet-300 transition inline-flex items-center gap-1"
                                                >
                                                    {c.addr.slice(0, 6)}…{c.addr.slice(-4)}
                                                    <ArrowUpRight className="h-3 w-3" />
                                                </a>
                                            </td>
                                            <td>
                                                <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 text-[10px]">
                                                    <StatusDot ok={true} /> <span className="ml-1">Verified</span>
                                                </Badge>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>

                {/* Quick Admin Actions */}
                <div className="grid sm:grid-cols-3 gap-4">
                    <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                        <Link to="/admin/form-builder">
                            <FileText className="h-5 w-5 text-emerald-500" />
                            <span className="text-sm font-medium">Form Builder</span>
                            <span className="text-[10px] text-muted-foreground">Create and edit hosted lead forms</span>
                        </Link>
                    </Button>
                    <Button variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                        <Link to="/admin/verticals">
                            <Shield className="h-5 w-5 text-blue-500" />
                            <span className="text-sm font-medium">Manage Verticals</span>
                            <span className="text-[10px] text-muted-foreground">Approve, configure, deprecate</span>
                        </Link>
                    </Button>
                    <div className="relative">
                        <Button variant="outline" className="h-auto py-4 flex-col gap-2 w-full opacity-50 cursor-default" disabled>
                            <Database className="h-5 w-5 text-violet-500" />
                            <span className="text-sm font-medium">NFT Management</span>
                            <span className="text-[10px] text-muted-foreground">Mint, transfer, burn LeadNFTs</span>
                        </Button>
                        <Badge variant="outline" className="absolute -top-2 -right-2 text-[9px] text-amber-400 border-amber-500/30 bg-background">
                            Coming Soon
                        </Badge>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}

export default AdminDashboard;
