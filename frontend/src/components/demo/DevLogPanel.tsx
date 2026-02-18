/**
 * Dev Log Panel
 * 
 * Bottom-left toggleable panel showing real-time ACE compliance events.
 * Only visible in demo mode. Toggle with terminal icon or Ctrl+Shift+L.
 * Auto-opens in demo mode. Shows Basescan links for txHashes.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, X, Trash2, Copy, Check, ExternalLink } from 'lucide-react';
import socketClient from '@/lib/socket';

interface DevLogEntry {
    ts: string;
    action: string;
    [key: string]: unknown;
}

const MAX_ENTRIES = 100;
const BASESCAN_TX_URL = 'https://sepolia.basescan.org/tx/';
const BASESCAN_ADDR_URL = 'https://sepolia.basescan.org/address/';

export function DevLogPanel() {
    const isDemo = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true';
    const [open, setOpen] = useState(isDemo); // auto-open in demo mode
    const [entries, setEntries] = useState<DevLogEntry[]>([]);
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Keyboard shortcut: Ctrl+Shift+L
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'L') {
                e.preventDefault();
                setOpen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // Listen for ace:dev-log events via socketClient.on()
    useEffect(() => {
        const cleanup = socketClient.on('ace:dev-log', (entry: any) => {
            setEntries(prev => {
                const next = [...prev, entry as DevLogEntry];
                return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
            });
        });
        return cleanup;
    }, []);

    // Also listen for bid events
    useEffect(() => {
        const cleanupBid = socketClient.on('bid:confirmed', (data: any) => {
            setEntries(prev => {
                const entry: DevLogEntry = {
                    ts: new Date().toISOString(),
                    action: 'bid:confirmed',
                    bidId: data.bidId,
                    status: data.status,
                };
                const next = [...prev, entry];
                return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
            });
        });

        const cleanupErr = socketClient.on('error', (data: any) => {
            setEntries(prev => {
                const entry: DevLogEntry = {
                    ts: new Date().toISOString(),
                    action: 'error',
                    message: data.message,
                };
                const next = [...prev, entry];
                return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
            });
        });

        return () => {
            cleanupBid();
            cleanupErr();
        };
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [entries]);

    const clearLog = useCallback(() => setEntries([]), []);

    const copyEntry = useCallback((idx: number) => {
        const entry = entries[idx];
        if (!entry) return;
        navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 1500);
    }, [entries]);

    const getActionColor = (action: string) => {
        if (action.includes('error')) return '#f87171';
        if (action.includes('skip')) return '#fbbf24';
        if (action.includes('result') || action.includes('confirmed') || action.includes('initialized')) return '#4ade80';
        if (action.includes('call')) return '#60a5fa';
        if (action === 'init') return '#c084fc';
        return '#94a3b8';
    };

    const formatTime = (ts: string) => {
        try {
            return new Date(ts).toLocaleTimeString('en-US', {
                hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
            });
        } catch { return ts; }
    };

    const renderValue = (k: string, v: unknown) => {
        const s = String(v);
        // Basescan link for txHash
        if (k === 'txHash' && typeof v === 'string' && v.startsWith('0x')) {
            return (
                <a
                    href={`${BASESCAN_TX_URL}${v}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#60a5fa', textDecoration: 'underline', cursor: 'pointer' }}
                    title="View on Basescan"
                >
                    {v.slice(0, 10)}…
                    <ExternalLink size={10} style={{ display: 'inline', marginLeft: '2px', verticalAlign: 'middle' }} />
                </a>
            );
        }
        // Basescan link for contractAddress
        if (k === 'contractAddress' && typeof v === 'string' && v.startsWith('0x')) {
            return (
                <a
                    href={`${BASESCAN_ADDR_URL}${v}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#c084fc', textDecoration: 'underline', cursor: 'pointer' }}
                    title="View on Basescan"
                >
                    {v.slice(0, 10)}…
                    <ExternalLink size={10} style={{ display: 'inline', marginLeft: '2px', verticalAlign: 'middle' }} />
                </a>
            );
        }
        // Booleans
        if (typeof v === 'boolean') {
            return <span style={{ color: v ? '#4ade80' : '#f87171', fontWeight: 600 }}>{s}</span>;
        }
        // Truncate long values
        if (s.length > 30) {
            return <span style={{ color: '#e2e8f0' }} title={s}>{s.slice(0, 30)}…</span>;
        }
        return <span style={{ color: '#e2e8f0' }}>{s}</span>;
    };

    // Collapsed toggle button
    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                title="Dev Log (Ctrl+Shift+L)"
                style={{
                    position: 'fixed',
                    bottom: '20px',
                    left: '20px',
                    zIndex: 9998,
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    background: '#0d0b1a',
                    border: '1px solid #2d2b4a',
                    color: '#7c6faa',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#4f46a0';
                    e.currentTarget.style.color = '#a89fd4';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#2d2b4a';
                    e.currentTarget.style.color = '#7c6faa';
                }}
            >
                <Terminal size={18} />
                {entries.length > 0 && (
                    <span style={{
                        position: 'absolute',
                        top: '-5px',
                        right: '-5px',
                        background: '#6d28d9',
                        color: '#fff',
                        fontSize: '9px',
                        fontWeight: 700,
                        borderRadius: '999px',
                        minWidth: '16px',
                        height: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 4px',
                    }}>
                        {entries.length}
                    </span>
                )}
            </button>
        );
    }

    return (
        <div style={{
            position: 'fixed',
            bottom: '16px',
            left: '16px',
            zIndex: 9999,
            width: '480px',
            maxHeight: '580px',
            background: '#09080f',
            border: '1px solid #1e1b2e',
            borderRadius: '10px',
            overflow: 'hidden',
            fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", monospace',
            fontSize: '12px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderBottom: '1px solid #1e1b2e',
                background: '#0d0b14',
                flexShrink: 0,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Terminal size={13} color="#7c6faa" />
                    <span style={{ color: '#9b8ec4', fontWeight: 600, fontSize: '11px', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                        ACE Dev Log
                    </span>
                    <span style={{ color: '#4a4560', fontSize: '10px' }}>
                        {entries.length}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                        onClick={clearLog}
                        title="Clear log"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4a4560', padding: '2px', display: 'flex' }}
                    >
                        <Trash2 size={12} />
                    </button>
                    <button
                        onClick={() => setOpen(false)}
                        title="Close (Ctrl+Shift+L)"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4a4560', padding: '2px', display: 'flex' }}
                    >
                        <X size={12} />
                    </button>
                </div>
            </div>

            {/* Log entries */}
            <div
                ref={scrollRef}
                style={{
                    overflowY: 'auto',
                    flex: 1,
                    maxHeight: '530px',
                    padding: '4px 0',
                }}
            >
                {entries.length === 0 && (
                    <div style={{ color: '#3d3856', textAlign: 'center', padding: '32px 16px', fontSize: '11px', lineHeight: '1.6' }}>
                        No events yet.<br />Login as a demo buyer or place a bid to see ACE calls.
                    </div>
                )}
                {entries.map((entry, i) => (
                    <div
                        key={i}
                        style={{
                            padding: '5px 10px 5px 12px',
                            borderBottom: '1px solid #111019',
                            lineHeight: '1.6',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '4px',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#0f0d18'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ color: '#3d3856', marginRight: '6px', fontSize: '11px' }}>
                                {formatTime(entry.ts)}
                            </span>
                            <span style={{ color: getActionColor(entry.action), fontWeight: 600, fontSize: '12px' }}>
                                {entry.action}
                            </span>
                            {Object.entries(entry)
                                .filter(([k]) => k !== 'ts' && k !== 'action')
                                .map(([k, v]) => (
                                    <span key={k} style={{ marginLeft: '6px', fontSize: '11px' }}>
                                        <span style={{ color: '#4a4560' }}>{k}=</span>
                                        {renderValue(k, v)}
                                    </span>
                                ))}
                        </div>
                        {/* Copy button */}
                        <button
                            onClick={() => copyEntry(i)}
                            title="Copy entry JSON"
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: copiedIdx === i ? '#4ade80' : '#3d3856',
                                padding: '2px',
                                flexShrink: 0,
                                display: 'flex',
                                marginTop: '1px',
                                transition: 'color 0.15s',
                            }}
                        >
                            {copiedIdx === i ? <Check size={10} /> : <Copy size={10} />}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
