/**
 * Chainlink Services Dev Log
 * 
 * Bottom-left toggleable panel showing real-time Chainlink service events:
 * ACE Compliance, CRE Verification, Data Feeds, VRF, Functions.
 * 
 * Only visible in demo mode. Toggle with terminal icon or Ctrl+Shift+L.
 * Auto-opens in demo mode.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, X, Trash2, Copy, Check, ExternalLink, ClipboardList, BarChart3 } from 'lucide-react';
import socketClient from '@/lib/socket';

interface DevLogEntry {
    ts: string;
    action: string;
    [key: string]: unknown;
}

const MAX_ENTRIES = 200;
const BASESCAN_TX_URL = 'https://sepolia.basescan.org/tx/';
const BASESCAN_ADDR_URL = 'https://sepolia.basescan.org/address/';

// Color-code actions by Chainlink service
function getActionColor(action: string): string {
    const a = action.toLowerCase();
    if (a.includes('verifyk') || a.includes('cantransact') || a.includes('verticalpolic') || a.includes('setvertical'))
        return '#f59e0b'; // ACE — amber
    if (a.includes('cre') || a.includes('quality') || a.includes('zkproof'))
        return '#10b981'; // CRE — emerald
    if (a.includes('datafeed') || a.includes('data_feed') || a.includes('ethprice') || a.includes('pricefeed'))
        return '#3b82f6'; // Data Feeds — blue
    if (a.includes('vrf') || a.includes('tiebreak'))
        return '#a855f7'; // VRF — purple
    if (a.includes('function') || a.includes('bounty'))
        return '#ec4899'; // Functions — pink
    if (a.includes('escrow') || a.includes('fund') || a.includes('approve'))
        return '#14b8a6'; // Escrow — teal
    if (a.includes('error') || a.includes('fail'))
        return '#ef4444'; // Errors — red
    if (a.includes('result') || a.includes('success'))
        return '#22c55e'; // Success — green
    // Demo E2E actions
    if (a.includes('demo:step') || a.includes('demo:info'))
        return '#60a5fa'; // Demo steps — light blue
    if (a.includes('demo:success'))
        return '#22c55e'; // Demo success — green
    if (a.includes('demo:warn'))
        return '#f59e0b'; // Demo warning — amber
    if (a.includes('demo:error'))
        return '#ef4444'; // Demo error — red
    return '#8b5cf6'; // Default — violet
}

// Service badge for each log line
function getServiceBadge(action: string): { label: string; color: string } | null {
    const a = action.toLowerCase();
    if (a.includes('verifyk') || a.includes('cantransact') || a.includes('verticalpolic') || a.includes('setvertical'))
        return { label: 'ACE', color: '#f59e0b' };
    if (a.includes('cre') || a.includes('quality') || a.includes('zkproof'))
        return { label: 'CRE', color: '#10b981' };
    if (a.includes('datafeed') || a.includes('data_feed') || a.includes('ethprice') || a.includes('pricefeed'))
        return { label: 'Feeds', color: '#3b82f6' };
    if (a.includes('vrf') || a.includes('tiebreak'))
        return { label: 'VRF', color: '#a855f7' };
    if (a.includes('function') || a.includes('bounty'))
        return { label: 'Fn', color: '#ec4899' };
    if (a.includes('escrow') || a.includes('fund') || a.includes('approve'))
        return { label: 'Escrow', color: '#14b8a6' };
    if (a.includes('demo') || a.startsWith('demo:'))
        return { label: 'Demo', color: '#60a5fa' };
    return null;
}

function formatTime(ts: string): string {
    try {
        const d = new Date(ts);
        return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return ts; }
}

function truncateHash(hash: string): string {
    if (hash.length > 16) return hash.slice(0, 10) + '…';
    return hash;
}

function renderValue(key: string, value: unknown): JSX.Element {
    const str = String(value);
    // txHash → Basescan link
    if (key === 'txHash' && typeof value === 'string' && value.startsWith('0x')) {
        return (
            <a
                href={`${BASESCAN_TX_URL}${value}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#60a5fa', textDecoration: 'none' }}
                title={value}
            >
                {truncateHash(value)}<ExternalLink size={9} style={{ marginLeft: '2px', verticalAlign: 'middle' }} />
            </a>
        );
    }
    // contractAddress → Basescan link
    if (key === 'contractAddress' && typeof value === 'string' && value.startsWith('0x')) {
        return (
            <a
                href={`${BASESCAN_ADDR_URL}${value}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#60a5fa', textDecoration: 'none' }}
                title={value}
            >
                {truncateHash(value)}<ExternalLink size={9} style={{ marginLeft: '2px', verticalAlign: 'middle' }} />
            </a>
        );
    }
    // Long hash/address truncation
    if (typeof value === 'string' && value.startsWith('0x') && value.length > 20) {
        return <span style={{ color: '#9ca3af' }} title={value}>{truncateHash(value)}</span>;
    }
    // Boolean values
    if (typeof value === 'boolean' || str === 'true' || str === 'false') {
        const isTrue = value === true || str === 'true';
        return <span style={{ color: isTrue ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{str}</span>;
    }
    // Truncate long strings
    if (str.length > 50) return <span style={{ color: '#9ca3af' }} title={str}>{str.slice(0, 50)}…</span>;
    return <span style={{ color: '#c4b5fd' }}>{str}</span>;
}

export function DevLogPanel() {
    // isDemo controls initial open state only — set VITE_DEMO_MODE=true in Vercel env
    // to auto-open the panel. The panel always mounts so Guest viewers receive socket
    // broadcasts (ace:dev-log, demo:log) without needing to switch persona first.
    const isDemo = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true';
    const [open, setOpen] = useState(isDemo);
    const [entries, setEntries] = useState<DevLogEntry[]>([]);
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
    const [copiedAll, setCopiedAll] = useState(false);
    const [demoComplete, setDemoComplete] = useState(false);
    const [socketStatus, setSocketStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Ensure the socket is connected — critical for Guest persona who never
        // goes through useDemo (which normally calls connect). With the backend
        // now accepting no-auth connections as 'GUEST', this is safe for all users.
        const sock = socketClient.connect();

        // Track connection status for the status dot
        const onConnect = () => {
            setSocketStatus('connected');
            // Show a reconnect notice in the log so users know the stream resumed
            setEntries(prev => {
                if (prev.length === 0) return prev; // nothing was here before, skip the notice
                return [...prev, {
                    ts: new Date().toISOString(),
                    action: 'demo:info',
                    ' ': '🔄 Socket reconnected — stream resumed (server may have redeployed)',
                }];
            });
        };
        const onDisconnect = () => {
            setSocketStatus('disconnected');
            setEntries(prev => [...prev, {
                ts: new Date().toISOString(),
                action: 'demo:warn',
                ' ': '⚠️ Socket disconnected — waiting to reconnect…',
            }]);
        };
        const onConnectError = () => setSocketStatus('disconnected');
        sock.on('connect', onConnect);
        sock.on('disconnect', onDisconnect);
        sock.on('connect_error', onConnectError);
        if (sock.connected) setSocketStatus('connected');

        // ace:dev-log events from Chainlink services (ACE, CRE, Data Feeds, VRF, Functions)
        const handler = (data: DevLogEntry) => {
            setEntries(prev => {
                const next = [...prev, data];
                return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
            });
        };
        socketClient.on('ace:dev-log', handler);

        // demo:log events — the message IS the log line; render it as the primary text.
        // Previously action=demo:level caused "demo:info" to show as the bold label
        // and "message=🔒 Bidder 1/3..." to appear tiny beside it. Fixed below:
        // action is now used as badge category (demo:log) and the message field is injected
        // as a top-level key so renderValue shows it as the main content.
        const demoHandler = (data: any) => {
            const level = data.level || 'info';
            const entry: DevLogEntry = {
                ts: data.ts || new Date().toISOString(),
                // Use level as category for color-coding but show message prominently
                action: `demo:${level}`,
                // Put message as the first extra field so it renders front-and-center
                ...(data.message ? { ' ': data.message } : {}),
                ...(data.txHash ? { tx: data.txHash } : {}),
                ...(data.cycle != null ? { cyc: `${data.cycle}/${data.totalCycles}` } : {}),
            };
            setEntries(prev => {
                const next = [...prev, entry];
                return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
            });
        };
        socketClient.on('demo:log', demoHandler);

        // Listen for demo:complete to show "View Summary" button
        const completeHandler = (data: any) => {
            setDemoComplete(true);
            const completionEntry: DevLogEntry = {
                ts: new Date().toISOString(),
                action: data.status === 'completed' ? 'demo:success' : 'demo:error',
                ' ': data.status === 'completed'
                    ? `✅ Demo Complete — ${data.totalCycles} cycles, $${data.totalSettled} settled`
                    : `❌ Demo ${data.status}: ${data.error || 'Unknown error'}`,
            };
            setEntries(prev => [...prev, completionEntry]);
        };
        socketClient.on('demo:complete', completeHandler);

        return () => {
            sock.off('connect', onConnect);
            sock.off('disconnect', onDisconnect);
            sock.off('connect_error', onConnectError);
            socketClient.off('ace:dev-log', handler);
            socketClient.off('demo:log', demoHandler);
            socketClient.off('demo:complete', completeHandler);
        };
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [entries]);

    const copyEntry = useCallback((idx: number) => {
        const entry = entries[idx];
        if (!entry) return;
        navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 1500);
    }, [entries]);

    const copyAll = useCallback(() => {
        const text = entries.map(e => JSON.stringify(e)).join('\n');
        navigator.clipboard.writeText(text);
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 1500);
    }, [entries]);

    // Toggle shortcut
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'L') {
                e.preventDefault();
                setOpen(v => !v);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // ↑ Removed: do NOT gate panel render on isDemo.
    // The panel must always mount so socket subscriptions are established for all
    // viewers including Guest persona. Missing this gate is Root Cause 1a from the
    // deep-dive analysis — without it, Guest viewers see no Dev Log events on Vercel.
    // The panel stays hidden (collapsed) by default; set VITE_DEMO_MODE=true on
    // Vercel to auto-open it, or use Ctrl+Shift+L to toggle manually.

    // Collapsed → toggle button
    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                style={{
                    position: 'fixed',
                    bottom: '16px',
                    left: '16px',
                    zIndex: 9999,
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    background: '#0f0d1a',
                    border: '1px solid #1e1b2e',
                    color: '#8b5cf6',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
                }}
                title="Open Chainlink Services Dev Log (Ctrl+Shift+L)"
            >
                <Terminal size={18} />
            </button>
        );
    }

    return (
        <div
            style={{
                position: 'fixed',
                bottom: '16px',
                left: '16px',
                zIndex: 9999,
                width: '520px',
                minHeight: '720px',
                maxHeight: '720px',
                background: '#09080f',
                border: '1px solid #1e1b2e',
                borderRadius: '12px',
                fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", monospace',
                fontSize: '12px',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 6px 32px rgba(0,0,0,0.7)',
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 14px',
                    borderBottom: '1px solid #1e1b2e',
                    gap: '8px',
                    flexShrink: 0,
                }}
            >
                <Terminal size={14} style={{ color: '#8b5cf6' }} />
                <span style={{ color: '#c4b5fd', fontWeight: 700, fontSize: '13px', flex: 1 }}>
                    Chainlink Services Dev Log
                </span>
                {/* Socket connection status dot */}
                <span
                    title={socketStatus === 'connected' ? 'Socket connected' : socketStatus === 'connecting' ? 'Connecting…' : 'Socket disconnected — events may not stream'}
                    style={{
                        width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                        background: socketStatus === 'connected' ? '#22c55e' : socketStatus === 'connecting' ? '#f59e0b' : '#ef4444',
                        boxShadow: socketStatus === 'connected' ? '0 0 4px #22c55e' : 'none',
                    }}
                />
                <span style={{
                    color: '#4a4560',
                    fontSize: '10px',
                    background: '#13111f',
                    padding: '2px 6px',
                    borderRadius: '4px',
                }}>
                    {entries.length}
                </span>
                <button
                    onClick={copyAll}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: copiedAll ? '#22c55e' : '#4a4560', padding: '2px',
                    }}
                    title="Copy All Logs"
                >
                    {copiedAll ? <Check size={13} /> : <ClipboardList size={13} />}
                </button>
                <button
                    onClick={() => { setEntries([]); setDemoComplete(false); }}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#4a4560', padding: '2px',
                    }}
                    title="Clear"
                >
                    <Trash2 size={13} />
                </button>
                <button
                    onClick={() => setOpen(false)}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#4a4560', padding: '2px',
                    }}
                    title="Close (Ctrl+Shift+L)"
                >
                    <X size={13} />
                </button>
            </div>

            {/* Log entries */}
            <div
                ref={scrollRef}
                style={{
                    overflowY: 'auto',
                    flex: 1,
                    maxHeight: demoComplete ? '590px' : '660px',
                    padding: '4px 0',
                }}
            >
                {entries.length === 0 && (
                    <div style={{ color: '#2d2a3e', textAlign: 'center', padding: '40px 16px', fontSize: '12px' }}>
                        Waiting for Chainlink service events…
                        <div style={{ marginTop: '8px', fontSize: '10px', color: '#1e1b2e' }}>
                            ACE · CRE · Data Feeds · VRF · Functions
                        </div>
                    </div>
                )}
                {entries.map((entry, idx) => {
                    const badge = getServiceBadge(entry.action);
                    return (
                        <div
                            key={idx}
                            style={{
                                padding: '5px 12px',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '6px',
                                borderBottom: '1px solid #0d0b16',
                                lineHeight: '1.5',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = '#0d0b16'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ color: '#3d3856', marginRight: '6px', fontSize: '10px' }}>
                                    {formatTime(entry.ts)}
                                </span>
                                {badge && (
                                    <span style={{
                                        fontSize: '9px',
                                        fontWeight: 700,
                                        color: badge.color,
                                        background: `${badge.color}15`,
                                        border: `1px solid ${badge.color}30`,
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        marginRight: '6px',
                                    }}>
                                        {badge.label}
                                    </span>
                                )}
                                {/* For demo:log entries, the ' ' key holds the message — render it
                                    as the primary text instead of showing 'demo:info' as the label */}
                                {entry[' '] ? (
                                    <span style={{ color: getActionColor(entry.action), fontSize: '12px', whiteSpace: 'pre-wrap' }}>
                                        {String(entry[' '])}
                                    </span>
                                ) : (
                                    <span style={{ color: getActionColor(entry.action), fontWeight: 600, fontSize: '12px' }}>
                                        {entry.action}
                                    </span>
                                )}
                                {Object.entries(entry)
                                    .filter(([k]) => k !== 'ts' && k !== 'action' && k !== ' ')
                                    .map(([k, v]) => (
                                        <span key={k} style={{ marginLeft: '8px', fontSize: '11px' }}>
                                            <span style={{ color: '#4a4560' }}>{k}=</span>
                                            {renderValue(k, v)}

                                        </span>
                                    ))}
                            </div>
                            <button
                                onClick={() => copyEntry(idx)}
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: copiedIdx === idx ? '#22c55e' : '#2d2a3e',
                                    padding: '2px', flexShrink: 0, marginTop: '1px',
                                }}
                                title="Copy entry"
                            >
                                {copiedIdx === idx ? <Check size={11} /> : <Copy size={11} />}
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Demo Complete — View Summary Link */}
            {demoComplete && (
                <div
                    style={{
                        borderTop: '1px solid #1e1b2e',
                        padding: '12px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.08), rgba(59, 130, 246, 0.08))',
                        flexShrink: 0,
                    }}
                >
                    <span style={{ fontSize: '16px' }}>🎉</span>
                    <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '13px', flex: 1 }}>
                        Demo Complete!
                    </span>
                    <a
                        href="/demo/results"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 14px',
                            borderRadius: '8px',
                            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                            color: '#fff',
                            fontWeight: 700,
                            fontSize: '12px',
                            textDecoration: 'none',
                            transition: 'all 0.15s',
                            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.03)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                    >
                        <BarChart3 size={14} />
                        View Summary →
                    </a>
                </div>
            )}
        </div>
    );
}
