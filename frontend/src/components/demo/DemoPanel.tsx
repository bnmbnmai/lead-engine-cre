/**
 * Demo Control Panel
 * 
 * Floating control panel for demo features. Only rendered in development mode.
 * Toggle with beaker icon or keyboard shortcut Ctrl+Shift+D.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { setAuthToken, API_BASE_URL } from '@/lib/api';
import { formatVerticalTitle } from '@/lib/utils';
import socketClient from '@/lib/socket';
import useAuth from '@/hooks/useAuth';
import { useAccount } from 'wagmi';
import {
    FlaskConical,
    X,
    Database,
    Zap,
    Gavel,
    BarChart3,
    User,
    UserCheck,
    LogOut,
    ChevronDown,
    ChevronUp,
    Loader2,
    Check,
    AlertCircle,
    AlertTriangle,
    Sparkles,
    Shield,
    Sprout,
    Users,
} from 'lucide-react';
import api from '@/lib/api';

// ============================================
// Types
// ============================================

interface DemoStatus {
    seeded: boolean;
    leads: number;
    bids: number;
    asks: number;
}

type ActionState = 'idle' | 'loading' | 'success' | 'error';

interface ActionResult {
    state: ActionState;
    message?: string;
}

// ============================================
// Component
// ============================================

export function DemoPanel() {
    const [isOpen, setIsOpen] = useState(false);
    const [status, setStatus] = useState<DemoStatus>({ seeded: false, leads: 0, bids: 0, asks: 0 });
    const [actions, setActions] = useState<Record<string, ActionResult>>({});
    const [mockData, setMockData] = useState(() => localStorage.getItem('VITE_USE_MOCK_DATA') === 'true');
    const [expandedSection, setExpandedSection] = useState<string | null>('marketplace');
    const [demoBuyersEnabled, setDemoBuyersEnabled] = useState(true);
    const [demoComplete, setDemoComplete] = useState<{ runId: string; totalSettled: number; elapsedSec?: number } | null>(null);
    const [recyclePercent, setRecyclePercent] = useState<number | null>(null);
    const [isRecycling, setIsRecycling] = useState(false);
    const demoCompleteRef = useRef<{ runId: string; totalSettled: number; elapsedSec?: number } | null>(null);
    const [demoMetrics, setDemoMetrics] = useState<{ activeCount: number; leadsThisMinute: number; dailyRevenue: number } | null>(null);
    const [demoRunning, setDemoRunning] = useState(false);
    const [elapsedSec, setElapsedSec] = useState(0);
    const [creNativeMode, setCreNativeMode] = useState(false);
    const demoStartRef = useRef<number | null>(null);
    const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const navigate = useNavigate();
    const { user } = useAuth();
    const { address } = useAccount();

    // Imperative guard: prevents rapid double-clicks from firing duplicate API calls
    const runningActionsRef = useRef<Set<string>>(new Set());

    // Track demo completion + recycle progress for in-panel notifications
    useEffect(() => {
        const unsubReady = socketClient.on('demo:results-ready', (data: any) => {
            demoCompleteRef.current = { runId: data.runId, totalSettled: data.totalSettled, elapsedSec: data.elapsedSec };
            setIsRecycling(true);
            setRecyclePercent(0);
            setDemoRunning(false);
            setDemoMetrics(null);
        });
        const unsubProgress = socketClient.on('demo:recycle-progress', (data: any) => {
            setRecyclePercent(data.percent ?? 0);
        });
        const unsubComplete = socketClient.on('demo:recycle-complete', () => {
            setRecyclePercent(null);
            setIsRecycling(false);
            if (demoCompleteRef.current) {
                setDemoComplete(demoCompleteRef.current);
                demoCompleteRef.current = null;
            }
        });
        const unsubMetrics = socketClient.on('demo:metrics', (data: any) => {
            setDemoMetrics(data);
        });
        const unsubStatus = socketClient.on('demo:status', (data: any) => {
            const running = data?.running ?? false;
            setDemoRunning(running);
            if (running) {
                if (!demoStartRef.current) demoStartRef.current = Date.now();
                if (!elapsedIntervalRef.current) {
                    elapsedIntervalRef.current = setInterval(() => {
                        setElapsedSec(Math.floor((Date.now() - (demoStartRef.current ?? Date.now())) / 1000));
                    }, 1000);
                }
            } else {
                if (elapsedIntervalRef.current) { clearInterval(elapsedIntervalRef.current); elapsedIntervalRef.current = null; }
                demoStartRef.current = null;
                setElapsedSec(0);
            }
        });
        return () => { unsubReady(); unsubProgress(); unsubComplete(); unsubMetrics(); unsubStatus(); };
    }, []);

    // Fetch demo status on open
    const refreshStatus = useCallback(async () => {
        try {
            const { data } = await api.demoStatus();
            if (data) setStatus(data);
        } catch {
            // Silently fail — backend might not be running
        }
    }, []);

    // demo:reset-complete — refresh status after full reset completes
    useEffect(() => {
        const unsubReset = socketClient.on('demo:reset-complete', () => {
            setRecyclePercent(null);
            refreshStatus();
        });
        return unsubReset;
    }, [refreshStatus]);

    useEffect(() => {
        if (isOpen) {
            refreshStatus();
            api.demoBuyersStatus().then(({ data }) => {
                if (data) setDemoBuyersEnabled(data.enabled);
            }).catch(() => { });
            api.demoCreModeStatus().then(({ data }) => {
                if (data) setCreNativeMode(data.enabled);
            }).catch(() => { });
        }
    }, [isOpen, refreshStatus]);

    // Keyboard shortcut: Ctrl+Shift+D
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                e.preventDefault();
                setIsOpen(prev => {
                    if (!prev) window.dispatchEvent(new CustomEvent('agent-chat:close'));
                    return !prev;
                });
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // Mutual exclusion: close when agent chat opens
    useEffect(() => {
        const handler = () => setIsOpen(false);
        window.addEventListener('demo-panel:close', handler);
        return () => window.removeEventListener('demo-panel:close', handler);
    }, []);

    // ============================================
    // Action helpers
    // ============================================

    async function runAction(key: string, fn: () => Promise<string>) {
        if (runningActionsRef.current.has(key)) return;
        runningActionsRef.current.add(key);

        setActions(prev => ({ ...prev, [key]: { state: 'loading' } }));
        try {
            const message = await fn();
            setActions(prev => ({ ...prev, [key]: { state: 'success', message } }));
            refreshStatus();
            setTimeout(() => setActions(prev => ({ ...prev, [key]: { state: 'idle' } })), 3000);
        } catch (err: any) {
            setActions(prev => ({ ...prev, [key]: { state: 'error', message: err?.message || 'Failed' } }));
            setTimeout(() => setActions(prev => ({ ...prev, [key]: { state: 'idle' } })), 4000);
        } finally {
            runningActionsRef.current.delete(key);
        }
    }

    async function handleSeed() {
        await runAction('seed', async () => {
            const { data, error } = await api.demoSeed();
            if (error) throw new Error(error.message || error.error);
            const auctionCount = (data as any)?.auctionLeads ?? '?';
            const buyNowCount = (data as any)?.buyNowLeads ?? '?';
            return `✅ Seeded ${auctionCount} auction leads + ${buyNowCount} buy-now leads, ${data?.bids} bids, ${data?.asks} asks`;
        });
    }

    async function handleInjectLead() {
        await runAction('inject', async () => {
            const { data, error } = await api.demoInjectLead();
            if (error) throw new Error(error.message || error.error);
            const title = formatVerticalTitle(data?.lead?.vertical);
            const paramCount = data?.lead?.parameters ? Object.keys(data.lead.parameters).length : 0;
            const geo = data?.lead?.geo?.state ? ` — ${data.lead.geo.state}` : '';
            return `✅ Injected demo lead: ${title} (${paramCount} fields${geo})`;
        });
    }

    async function handleSeedBounties() {
        await runAction('seedBounties', async () => {
            const { data, error } = await api.demoSeedBounties();
            if (error) throw new Error(error.message || error.error);
            return `Seeded ${data?.poolsCreated} bounty pools ($${data?.totalUSDC} USDC) — check Seller Dashboard`;
        });
    }

    async function handleResetEverything() {
        if (!window.confirm('⚠️ This will delete ALL marketplace data — leads, bids, transactions, asks, and auction rooms.\n\nThis cannot be undone. Continue?')) return;
        await runAction('wipe', async () => {
            const { data, error } = await api.demoWipe();
            if (error) throw new Error(error.message || error.error);
            const d = data?.deleted;
            return `☢️ Wiped all: ${d?.leads} leads, ${d?.bids} bids, ${d?.asks} asks, ${d?.transactions} transactions`;
        });
    }

    async function handleStartAuction() {
        await runAction('auction', async () => {
            const { data, error } = await api.demoStartAuction();
            if (error) throw new Error(error.message || error.error);
            return `🔨 Auction started for lead ${data?.leadId?.slice(0, 8)}! ${data?.simulatedBids ?? 3} bids arriving${data?.demoBuyersEnabled === false ? ' (demo buyers OFF — no bot bids)' : ' over 30s'}`;
        });
    }

    async function handleToggleDemoBuyers() {
        const next = !demoBuyersEnabled;
        setDemoBuyersEnabled(next);
        try {
            await api.demoBuyersToggle(next);
        } catch {
            setDemoBuyersEnabled(!next);
        }
    }

    async function handleToggleCreMode() {
        const next = !creNativeMode;
        setCreNativeMode(next);
        try {
            await api.demoCreModeToggle(next);
        } catch {
            setCreNativeMode(!next);
        }
    }

    function handleToggleMock() {
        const next = !mockData;
        setMockData(next);
        localStorage.setItem('VITE_USE_MOCK_DATA', next ? 'true' : 'false');
        window.dispatchEvent(new CustomEvent('mockdata:toggle'));
        setActions(prev => ({
            ...prev,
            mock: { state: 'success', message: next ? '📊 Mock data enabled' : '📊 Mock data disabled' },
        }));
        setTimeout(() => setActions(prev => ({ ...prev, mock: { state: 'idle' } })), 2000);
    }

    async function handleSimulateTrafficLead() {
        await runAction('trafficLead', async () => {
            const sampleRes = await fetch(`${API_BASE_URL}/api/v1/ingest/sample-payload`);
            if (!sampleRes.ok) throw new Error('Failed to fetch sample payload');
            const { payload } = await sampleRes.json();

            const ingestRes = await fetch(`${API_BASE_URL}/api/v1/ingest/traffic-platform`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': 'demo-traffic-key' },
                body: JSON.stringify(payload),
            });
            if (!ingestRes.ok) {
                const err = await ingestRes.json().catch(() => ({}));
                throw new Error(err.error || 'Ingestion failed');
            }
            const result = await ingestRes.json();
            return `📡 ${result.lead.platform} lead → ${result.lead.vertical} (CRE ${result.lead.qualityScore ?? '?'}/100) — auction started`;
        });
    }

    async function handlePersonaSwitch(persona: 'buyer' | 'seller' | 'guest') {
        const isDemoEnv = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true';
        const apiBase = API_BASE_URL;

        if (isDemoEnv && persona !== 'guest') {
            try {
                const role = persona === 'buyer' ? 'BUYER' : 'SELLER';
                const resp = await fetch(`${apiBase}/api/v1/demo-panel/demo-login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role, connectedWallet: address }),
                });
                const data = await resp.json();
                if (data.token) {
                    setAuthToken(data.token);
                    localStorage.setItem('le_auth_user', JSON.stringify(data.user));
                    socketClient.reconnect(data.token);
                    if (import.meta.env.DEV) console.log(`[DemoPanel] Demo login success — ${role} persona set with real JWT`);
                } else {
                    if (import.meta.env.DEV) console.warn('[DemoPanel] Demo login failed:', data.error);
                    localStorage.setItem('le_auth_user', JSON.stringify({
                        id: `demo-${persona}`,
                        walletAddress: persona === 'buyer' ? '0x424CaC929939377f221348af52d4cb1247fE4379' : '0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70',
                        role,
                        kycStatus: 'VERIFIED',
                    }));
                }
            } catch (err) {
                if (import.meta.env.DEV) console.warn('[DemoPanel] Demo login request failed:', err);
            }
        } else if (persona === 'guest') {
            setAuthToken(null);
            localStorage.removeItem('le_auth_user');
            socketClient.reconnect(undefined);
            if (import.meta.env.DEV) console.log('[DemoPanel] Guest persona — socket reconnected as GUEST role');
        }

        window.dispatchEvent(new StorageEvent('storage', {
            key: 'le_auth_user',
            newValue: localStorage.getItem('le_auth_user'),
        }));

        if (persona === 'buyer') navigate('/buyer');
        else if (persona === 'seller') navigate('/seller');
        else navigate('/');

        setActions(prev => ({
            ...prev,
            persona: { state: 'success', message: `🎭 Switched to ${persona} view${isDemoEnv ? ' (KYC bypassed)' : ''}` },
        }));
        setTimeout(() => setActions(prev => ({ ...prev, persona: { state: 'idle' } })), 2000);
    }

    async function handleDemoAdminLogin() {
        const apiBase = API_BASE_URL;
        setActions(prev => ({ ...prev, adminLogin: { state: 'loading' } }));
        try {
            const resp = await fetch(`${apiBase}/api/v1/demo-panel/demo-admin-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'admin', password: 'admin' }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Login failed');

            setAuthToken(data.token);
            localStorage.setItem('le_auth_user', JSON.stringify(data.user));
            socketClient.reconnect(data.token);

            window.dispatchEvent(new StorageEvent('storage', {
                key: 'le_auth_user',
                newValue: JSON.stringify(data.user),
            }));

            setActions(prev => ({
                ...prev,
                adminLogin: { state: 'success', message: '🔐 Logged in as Demo Admin' },
            }));
            if (import.meta.env.DEV) console.log('[DemoPanel] Demo admin login success — ADMIN persona set with real JWT');
            navigate('/admin/nfts');
            setTimeout(() => setActions(prev => ({ ...prev, adminLogin: { state: 'idle' } })), 3000);
        } catch (err: any) {
            setActions(prev => ({
                ...prev,
                adminLogin: { state: 'error', message: err?.message || 'Admin login failed' },
            }));
            setTimeout(() => setActions(prev => ({ ...prev, adminLogin: { state: 'idle' } })), 4000);
        }
    }

    // ============================================
    // Action button component
    // ============================================

    function ActionButton({
        actionKey,
        label,
        icon: Icon,
        onClick,
        variant = 'default',
        disabled = false,
    }: {
        actionKey: string;
        label: string;
        icon: typeof Database;
        onClick: () => void;
        variant?: 'default' | 'danger' | 'accent';
        disabled?: boolean;
    }) {
        const action = actions[actionKey] || { state: 'idle' };
        const isLoading = action.state === 'loading';

        const baseStyle = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 w-full';
        const variants = {
            default: 'bg-white/[0.06] hover:bg-white/[0.12] text-foreground border border-border',
            danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20',
            accent: 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20',
        };

        return (
            <div>
                <button
                    onClick={onClick}
                    disabled={isLoading || disabled}
                    className={`${baseStyle} ${variants[variant]} ${isLoading ? 'opacity-60 cursor-wait' : ''} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                    {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : action.state === 'success' ? (
                        <Check className="h-4 w-4 text-green-400" />
                    ) : action.state === 'error' ? (
                        <AlertCircle className="h-4 w-4 text-red-400" />
                    ) : (
                        <Icon className="h-4 w-4" />
                    )}
                    <span>{label}</span>
                </button>
                {/* Fixed-height slot prevents layout shift when messages appear/disappear */}
                <div className="h-5 overflow-hidden">
                    {action.message && (
                        <p className={`text-xs mt-1 px-1 truncate ${action.state === 'error' ? 'text-red-400' : 'text-muted-foreground'}`}>
                            {action.message}
                        </p>
                    )}
                </div>
            </div>
        );
    }

    // ============================================
    // Section header
    // ============================================

    function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
        const isExpanded = expandedSection === id;
        return (
            <div className="border-t border-border pt-3">
                <button
                    onClick={() => setExpandedSection(isExpanded ? null : id)}
                    className="flex items-center justify-between w-full text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition mb-2"
                >
                    <span>{title}</span>
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                {isExpanded && <div className="space-y-2">{children}</div>}
            </div>
        );
    }

    // ============================================
    // Render
    // ============================================

    const sessionRole = user?.role;
    const currentPersona = sessionRole === 'BUYER'
        ? 'buyer'
        : sessionRole === 'SELLER'
            ? 'seller'
            : sessionRole === 'ADMIN'
                ? 'admin'
                : 'guest';

    return (
        <>
            {/* Floating trigger button */}
            <button
                onClick={() => {
                    const next = !isOpen;
                    setIsOpen(next);
                    if (next) window.dispatchEvent(new CustomEvent('agent-chat:close'));
                }}
                className={`fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ${isOpen
                    ? 'bg-red-500 hover:bg-red-600 rotate-90 scale-90'
                    : 'bg-gradient-to-br from-purple-500 to-blue-600 hover:from-purple-600 hover:to-blue-700 hover:scale-110'
                    }`}
                title="Demo Control Panel (Ctrl+Shift+D)"
            >
                {isOpen ? (
                    <X className="h-5 w-5 text-white" />
                ) : (
                    <FlaskConical className="h-5 w-5 text-white" />
                )}
            </button>

            {/* Panel drawer */}
            {isOpen && (
                <div className="fixed bottom-20 right-6 z-50 w-72 max-h-[calc(100vh-120px)] overflow-y-auto rounded-2xl border border-border bg-background/95 backdrop-blur-xl shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
                    {/* Header */}
                    <div className="sticky top-0 bg-background/95 backdrop-blur-xl px-4 py-3 border-b border-border rounded-t-2xl">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
                                <FlaskConical className="h-4 w-4 text-white" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-foreground">Demo Control Panel</h3>
                                <p className="text-[10px] text-muted-foreground">Dev only • Ctrl+Shift+D</p>
                            </div>
                        </div>

                        {/* Status bar */}
                        <div className="flex items-center gap-3 mt-2 text-[11px]">
                            <span className={`flex items-center gap-1 ${status.seeded ? 'text-green-400' : 'text-muted-foreground'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${status.seeded ? 'bg-green-400' : 'bg-muted-foreground'}`} />
                                {status.seeded ? 'Seeded' : 'Empty'}
                            </span>
                            {status.seeded && (
                                <>
                                    <span className="text-muted-foreground">{status.leads} leads</span>
                                    <span className="text-muted-foreground">{status.bids} bids</span>
                                    <span className="text-muted-foreground">{status.asks} asks</span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-3 space-y-2">

                        {/* Live Metrics Banner */}
                        {demoMetrics && (
                            <div className="rounded-xl border border-red-500/30 bg-red-500/[0.08] px-3 py-2 mb-1">
                                <div className="flex items-center gap-2">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                                    </span>
                                    <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">LIVE DEMO</span>
                                    <span className="text-[10px] text-muted-foreground">Active: {demoMetrics.activeCount}</span>
                                    <span className="text-[10px] text-muted-foreground">Elapsed: {Math.floor(elapsedSec / 60)}m {elapsedSec % 60}s</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-0.5 pl-4">
                                    Platform rev today: ~${demoMetrics.dailyRevenue.toLocaleString()}
                                </p>
                            </div>
                        )}

                        {/* Demo running chip */}
                        {demoRunning && !demoMetrics && (
                            <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-blue-500/30 bg-blue-500/[0.08] mb-1">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                                </span>
                                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Demo Running…</span>
                            </div>
                        )}

                        {/* Recycling banner */}
                        {isRecycling && (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                                <div className="flex items-center gap-2">
                                    <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin" />
                                    <p className="text-xs font-semibold text-amber-400">♻️ Recycling wallets — please wait…</p>
                                </div>
                                {recyclePercent !== null && (
                                    <div className="mt-2">
                                        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                                            <span>Recovering USDC from demo wallets</span>
                                            <span>{recyclePercent}%</span>
                                        </div>
                                        <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                                            <div
                                                className="h-full bg-amber-500/60 rounded-full transition-all duration-500"
                                                style={{ width: `${recyclePercent}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Demo Complete banner */}
                        {demoComplete && !isRecycling && (
                            <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2.5">
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <p className="text-xs font-semibold text-green-400">⚡ Demo Complete – Results Ready</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">
                                            ${demoComplete.totalSettled} settled{demoComplete.elapsedSec ? ` in ${demoComplete.elapsedSec}s` : ''}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => { navigate(`/demo/results/${demoComplete.runId}`); setDemoComplete(null); }}
                                        className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-md bg-green-500/20 text-green-400 hover:bg-green-500/30 transition"
                                    >
                                        View →
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Section 1: Marketplace Data */}
                        <Section id="marketplace" title="Marketplace Data">
                            <ActionButton
                                actionKey="seed"
                                label="Seed Marketplace"
                                icon={Database}
                                onClick={handleSeed}
                                variant="accent"
                                disabled={status.seeded}
                            />
                            <ActionButton
                                actionKey="inject"
                                label="Inject Single Lead"
                                icon={Zap}
                                onClick={handleInjectLead}
                            />
                            <ActionButton
                                actionKey="seedBounties"
                                label="Seed Demo Bounties"
                                icon={Sprout}
                                onClick={handleSeedBounties}
                                variant="accent"
                            />
                            <ActionButton
                                actionKey="wipe"
                                label="Reset Everything"
                                icon={AlertTriangle}
                                onClick={handleResetEverything}
                                variant="danger"
                            />
                            <p className="text-[10px] text-red-400/70 pl-1">
                                ⚠️ Deletes ALL leads, bids, transactions, asks. Testnet data only.
                            </p>
                        </Section>

                        {/* Section 2: Live Simulation */}
                        <Section id="simulation" title="Live Simulation">
                            <ActionButton
                                actionKey="auction"
                                label={isRecycling ? 'Recycling in progress…' : 'Start Live Auction'}
                                icon={Gavel}
                                onClick={handleStartAuction}
                                variant="accent"
                                disabled={isRecycling}
                            />
                            <p className="text-[10px] text-muted-foreground pl-1">
                                60s auction{demoBuyersEnabled ? ' + 3 bot bids over 30s' : ' (no bot bids)'}. Click IN_AUCTION on Marketplace to watch live.
                            </p>

                            {/* Drip info chip */}
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-400">
                                <Sparkles className="h-3 w-3 shrink-0" />
                                <span>10 buyers · Continuous drip · ~12 leads/min simulated</span>
                            </div>

                            {/* Demo Buyers toggle */}
                            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.06] border border-border">
                                <div className="flex items-center gap-2">
                                    <Users className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm">Enable Demo Buyers</span>
                                </div>
                                <button
                                    onClick={handleToggleDemoBuyers}
                                    className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${demoBuyersEnabled ? 'bg-blue-500' : 'bg-muted'
                                        }`}
                                >
                                    <span
                                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${demoBuyersEnabled ? 'translate-x-5' : ''
                                            }`}
                                    />
                                </button>
                            </div>
                            <p className="text-[11px] text-muted-foreground pl-1">
                                {demoBuyersEnabled ? 'Bot buyers will place bids during auctions.' : 'No bot bids — only real users can bid.'}
                            </p>
                        </Section>

                        {/* Section 3: CRE Workflow Mode */}
                        <Section id="cre-workflow" title="⛓️ CRE Workflow Mode">
                            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.06] border border-border">
                                <div className="flex items-center gap-2">
                                    <Shield className="h-4 w-4 text-purple-400" />
                                    <span className="text-sm">CRE-Native</span>
                                </div>
                                <button
                                    onClick={handleToggleCreMode}
                                    className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${creNativeMode ? 'bg-purple-500' : 'bg-muted'
                                        }`}
                                >
                                    <span
                                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${creNativeMode ? 'translate-x-5' : ''
                                            }`}
                                    />
                                </button>
                            </div>
                            <p className="text-[11px] text-muted-foreground pl-1">
                                {creNativeMode
                                    ? 'CRE DON 7-gate evaluation runs on every injected lead.'
                                    : 'Classic mode — standard auction flow without CRE evaluation.'}
                            </p>
                            {creNativeMode && (
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-[10px] text-purple-400">
                                    <Shield className="h-3 w-3 shrink-0" />
                                    <span>7-gate: vertical • geo • state • quality • off-site • verified • field filters</span>
                                </div>
                            )}
                        </Section>

                        {/* Section 4: Traffic Platform Ingestion */}
                        <Section id="traffic" title="📡 Traffic Platform Ingestion">
                            <ActionButton
                                actionKey="trafficLead"
                                label="Simulate Traffic Lead"
                                icon={Zap}
                                onClick={handleSimulateTrafficLead}
                                variant="accent"
                            />
                            <p className="text-[10px] text-muted-foreground pl-1">
                                Simulates a Google Ads / Facebook / TikTok / TTD webhook → CRE pipeline → live auction.
                            </p>
                        </Section>

                        {/* Section 5: Analytics Mock Data */}
                        <Section id="analytics" title="Analytics Mock Data">
                            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.06] border border-border">
                                <div className="flex items-center gap-2">
                                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm">Mock Charts</span>
                                </div>
                                <button
                                    onClick={handleToggleMock}
                                    className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${mockData ? 'bg-blue-500' : 'bg-muted'
                                        }`}
                                >
                                    <span
                                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${mockData ? 'translate-x-5' : ''
                                            }`}
                                    />
                                </button>
                            </div>
                            {actions.mock?.message && (
                                <p className="text-[11px] text-muted-foreground pl-1">{actions.mock.message}</p>
                            )}
                            <p className="text-[11px] text-muted-foreground pl-1">
                                Toggle Faker-generated charts in buyer/seller analytics dashboards.
                            </p>
                        </Section>

                        {/* Persona Switcher — always visible, not in accordion */}
                        <div className="border-t border-border pt-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Persona Switcher</span>
                                <span className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${currentPersona === 'buyer' ? 'bg-blue-500/15 text-blue-400'
                                    : currentPersona === 'seller' ? 'bg-emerald-500/15 text-emerald-400'
                                        : currentPersona === 'admin' ? 'bg-amber-500/15 text-amber-400'
                                            : 'bg-muted/40 text-muted-foreground'
                                    }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${currentPersona === 'buyer' ? 'bg-blue-400'
                                        : currentPersona === 'seller' ? 'bg-emerald-400'
                                            : currentPersona === 'admin' ? 'bg-amber-400'
                                                : 'bg-muted-foreground'
                                        }`} />
                                    Active: {currentPersona.charAt(0).toUpperCase() + currentPersona.slice(1)}
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { key: 'buyer' as const, label: 'Buyer', icon: UserCheck },
                                    { key: 'seller' as const, label: 'Seller', icon: User },
                                    { key: 'guest' as const, label: 'Guest', icon: LogOut },
                                ].map(({ key, label, icon: Icon }) => (
                                    <button
                                        key={key}
                                        onClick={() => handlePersonaSwitch(key)}
                                        className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg text-xs font-medium transition-all ${currentPersona === key
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-white/[0.06] text-muted-foreground hover:bg-white/[0.12] hover:text-foreground border border-border'
                                            }`}
                                    >
                                        <Icon className="h-4 w-4" />
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-2 pl-1">
                                Only header nav changes persona + KYC bypass.
                            </p>
                            {actions.persona?.message && (
                                <p className="text-[11px] text-muted-foreground pl-1 mt-1">{actions.persona.message}</p>
                            )}
                        </div>

                        {/* Admin Access */}
                        <Section id="admin" title="Admin Access">
                            <button
                                onClick={handleDemoAdminLogin}
                                disabled={actions.adminLogin?.state === 'loading'}
                                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${currentPersona === 'admin'
                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                    : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:from-amber-600 hover:to-orange-700 shadow-lg hover:shadow-amber-500/20'
                                    }`}
                            >
                                {actions.adminLogin?.state === 'loading' ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Shield className="h-4 w-4" />
                                )}
                                {currentPersona === 'admin' ? 'Logged in as Admin' : 'Login as Demo Admin'}
                            </button>
                            {actions.adminLogin?.message && (
                                <p className={`text-[11px] pl-1 ${actions.adminLogin.state === 'error' ? 'text-red-400' : 'text-muted-foreground'
                                    }`}>{actions.adminLogin.message}</p>
                            )}
                            <p className="text-[10px] text-muted-foreground pl-1">
                                Uses demo credentials (admin/admin). Only available in demo mode.
                            </p>
                        </Section>

                    </div>

                    {/* Footer */}
                    <div className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground text-center">
                        Hidden in production builds • v1.0
                    </div>
                </div >
            )
            }
        </>
    );
}

export default DemoPanel;
