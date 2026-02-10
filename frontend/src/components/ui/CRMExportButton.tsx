import { useState, useRef, useEffect } from 'react';
import { Download, Upload, ChevronDown, FileText, FileJson, Loader2, Check, AlertCircle } from 'lucide-react';

interface CRMExportButtonProps {
    leadIds?: string[];
    className?: string;
}

type ExportFormat = 'csv' | 'json' | 'push';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function getAuthToken(): string | null {
    return localStorage.getItem('auth_token');
}

export function CRMExportButton({ leadIds, className = '' }: CRMExportButtonProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [statusMsg, setStatusMsg] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Auto-clear status
    useEffect(() => {
        if (status !== 'idle') {
            const t = setTimeout(() => { setStatus('idle'); setStatusMsg(''); }, 3000);
            return () => clearTimeout(t);
        }
    }, [status]);

    async function handleExport(format: ExportFormat) {
        setOpen(false);
        setLoading(true);
        setStatus('idle');

        const token = getAuthToken();
        if (!token) {
            setStatus('error');
            setStatusMsg('Not authenticated');
            setLoading(false);
            return;
        }

        try {
            if (format === 'push') {
                // Push to CRM webhook
                const res = await fetch(`${API_BASE}/api/v1/crm/push`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ leadIds: leadIds?.length ? leadIds : undefined }),
                });

                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Push failed');
                }

                setStatus('success');
                setStatusMsg(`Pushed ${data.pushed} leads to CRM`);
            } else {
                // Download CSV/JSON
                const params = new URLSearchParams({ format, days: '30' });
                const res = await fetch(`${API_BASE}/api/v1/crm/export?${params}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || 'Export failed');
                }

                // Trigger browser download
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `leads-export.${format}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                setStatus('success');
                setStatusMsg(`Downloaded as ${format.toUpperCase()}`);
            }
        } catch (err: any) {
            setStatus('error');
            setStatusMsg(err.message || 'Export failed');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div ref={dropdownRef} className={`crm-export-wrapper ${className}`} style={{ position: 'relative', display: 'inline-block' }}>
            <button
                className="crm-export-btn"
                onClick={() => setOpen(!open)}
                disabled={loading}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: '1px solid hsl(var(--border, 220 13% 91%))',
                    background: 'hsl(var(--card, 0 0% 100%))',
                    color: 'hsl(var(--foreground, 222 47% 11%))',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: loading ? 'wait' : 'pointer',
                    transition: 'all 0.15s',
                }}
            >
                {loading ? (
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                ) : status === 'success' ? (
                    <Check size={14} style={{ color: '#22c55e' }} />
                ) : status === 'error' ? (
                    <AlertCircle size={14} style={{ color: '#ef4444' }} />
                ) : (
                    <Download size={14} />
                )}
                {statusMsg || 'Push to CRM'}
                <ChevronDown size={12} style={{ opacity: 0.5 }} />
            </button>

            {open && (
                <div
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        right: 0,
                        minWidth: '180px',
                        background: 'hsl(var(--popover, 0 0% 100%))',
                        border: '1px solid hsl(var(--border, 220 13% 91%))',
                        borderRadius: '8px',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                        zIndex: 50,
                        overflow: 'hidden',
                    }}
                >
                    <DropdownItem
                        icon={<FileText size={14} />}
                        label="Export CSV"
                        description="Spreadsheet format"
                        onClick={() => handleExport('csv')}
                    />
                    <DropdownItem
                        icon={<FileJson size={14} />}
                        label="Export JSON"
                        description="Structured data"
                        onClick={() => handleExport('json')}
                    />
                    <div style={{ height: '1px', background: 'hsl(var(--border, 220 13% 91%))' }} />
                    <DropdownItem
                        icon={<Upload size={14} />}
                        label="Push to CRM"
                        description="Send via webhook"
                        onClick={() => handleExport('push')}
                    />
                </div>
            )}
        </div>
    );
}

function DropdownItem({ icon, label, description, onClick }: {
    icon: React.ReactNode;
    label: string;
    description: string;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '10px 14px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--accent, 210 40% 96%))'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
            <span style={{ color: 'hsl(var(--muted-foreground, 215 16% 47%))' }}>{icon}</span>
            <div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: 'hsl(var(--foreground, 222 47% 11%))' }}>{label}</div>
                <div style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground, 215 16% 47%))' }}>{description}</div>
            </div>
        </button>
    );
}

export default CRMExportButton;
