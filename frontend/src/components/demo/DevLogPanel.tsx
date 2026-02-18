/**
 * Dev Log Panel
 * 
 * Small toggleable panel in the bottom-left corner (opposite Demo Control Panel).
 * Shows real-time ACE compliance events: contract address, canTransact/verifyKYC
 * results, bid commitments, errors. Only visible in demo mode.
 * Toggle with terminal icon or Ctrl+Shift+L.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, X, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import socketClient from '@/lib/socket';

interface DevLogEntry {
    ts: string;
    action: string;
    [key: string]: unknown;
}

const MAX_ENTRIES = 50;

export function DevLogPanel() {
    const [open, setOpen] = useState(false);
    const [minimized, setMinimized] = useState(false);
    const [entries, setEntries] = useState<DevLogEntry[]>([]);
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

    // Listen for ace:dev-log events from socket
    useEffect(() => {
        const socket = socketClient.getSocket?.();
        if (!socket) return;

        const handler = (entry: DevLogEntry) => {
            setEntries(prev => {
                const next = [...prev, entry];
                return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
            });
        };

        socket.on('ace:dev-log', handler);
        return () => { socket.off('ace:dev-log', handler); };
    }, []);

    // Also listen for bid events
    useEffect(() => {
        const socket = socketClient.getSocket?.();
        if (!socket) return;

        const bidHandler = (data: any) => {
            setEntries(prev => {
                const entry: DevLogEntry = {
                    ts: new Date().toISOString(),
                    action: 'bid:confirmed',
                    bidId: data.bidId,
                    status: data.status,
                    isHolder: data.isHolder,
                };
                const next = [...prev, entry];
                return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
            });
        };

        const errHandler = (data: any) => {
            setEntries(prev => {
                const entry: DevLogEntry = {
                    ts: new Date().toISOString(),
                    action: 'socket:error',
                    message: data.message,
                };
                const next = [...prev, entry];
                return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
            });
        };

        socket.on('bid:confirmed', bidHandler);
        socket.on('error', errHandler);
        return () => {
            socket.off('bid:confirmed', bidHandler);
            socket.off('error', errHandler);
        };
    }, []);

    // Auto-scroll to bottom on new entries
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [entries]);

    const clearLog = useCallback(() => setEntries([]), []);

    const getActionColor = (action: string) => {
        if (action.includes('error')) return '#ef4444';
        if (action.includes('result') || action.includes('confirmed')) return '#22c55e';
        if (action.includes('call')) return '#3b82f6';
        if (action === 'init') return '#a855f7';
        return '#94a3b8';
    };

    const formatTime = (ts: string) => {
        try {
            return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch { return ts; }
    };

    // Floating toggle button
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
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #1e1b4b, #312e81)',
                    border: '1px solid rgba(139, 92, 246, 0.4)',
                    color: '#a78bfa',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
                    transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #312e81, #4c1d95)';
                    e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.7)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #1e1b4b, #312e81)';
                    e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                }}
            >
                <Terminal size={20} />
                {entries.length > 0 && (
                    <span style={{
                        position: 'absolute',
                        top: '-4px',
                        right: '-4px',
                        background: '#7c3aed',
                        color: '#fff',
                        fontSize: '10px',
                        fontWeight: 700,
                        borderRadius: '999px',
                        width: '18px',
                        height: '18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
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
            bottom: '20px',
            left: '20px',
            zIndex: 9999,
            width: '420px',
            maxHeight: minimized ? '48px' : '360px',
            background: 'linear-gradient(180deg, #0f0a1e 0%, #131127 100%)',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            borderRadius: '14px',
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(139,92,246,0.1)',
            fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
            fontSize: '11px',
            display: 'flex',
            flexDirection: 'column',
            transition: 'max-height 0.2s ease',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderBottom: minimized ? 'none' : '1px solid rgba(139, 92, 246, 0.15)',
                background: 'rgba(139, 92, 246, 0.05)',
                flexShrink: 0,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Terminal size={14} color="#a78bfa" />
                    <span style={{ color: '#c4b5fd', fontWeight: 600, fontSize: '12px', letterSpacing: '0.5px' }}>
                        ACE DEV LOG
                    </span>
                    <span style={{ color: '#6b7280', fontSize: '10px' }}>
                        ({entries.length})
                    </span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                        onClick={clearLog}
                        title="Clear"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '2px' }}
                    >
                        <Trash2 size={13} />
                    </button>
                    <button
                        onClick={() => setMinimized(!minimized)}
                        title={minimized ? 'Expand' : 'Minimize'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '2px' }}
                    >
                        {minimized ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <button
                        onClick={() => setOpen(false)}
                        title="Close (Ctrl+Shift+L)"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '2px' }}
                    >
                        <X size={13} />
                    </button>
                </div>
            </div>

            {/* Log entries */}
            {!minimized && (
                <div
                    ref={scrollRef}
                    style={{
                        overflowY: 'auto',
                        flex: 1,
                        padding: '6px 10px',
                    }}
                >
                    {entries.length === 0 && (
                        <div style={{ color: '#4b5563', textAlign: 'center', padding: '24px 0', fontSize: '11px' }}>
                            No events yet. Place a bid or login as buyer to see ACE logs.
                        </div>
                    )}
                    {entries.map((entry, i) => (
                        <div
                            key={i}
                            style={{
                                padding: '4px 0',
                                borderBottom: i < entries.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                                lineHeight: '1.5',
                            }}
                        >
                            <span style={{ color: '#4b5563', marginRight: '6px' }}>
                                {formatTime(entry.ts)}
                            </span>
                            <span style={{ color: getActionColor(entry.action), fontWeight: 600 }}>
                                {entry.action}
                            </span>
                            {Object.entries(entry)
                                .filter(([k]) => k !== 'ts' && k !== 'action')
                                .map(([k, v]) => (
                                    <span key={k} style={{ color: '#94a3b8', marginLeft: '8px' }}>
                                        <span style={{ color: '#6b7280' }}>{k}=</span>
                                        <span style={{ color: typeof v === 'boolean' ? (v ? '#22c55e' : '#ef4444') : '#e2e8f0' }}>
                                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                        </span>
                                    </span>
                                ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
