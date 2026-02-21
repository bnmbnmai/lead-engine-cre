import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import {
    Search, Check, X, Loader2, ChevronLeft, ChevronRight,
    Sparkles, Gem, AlertTriangle, Pause, Play, Trash2, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import api from '@/lib/api';
import useAuth from '@/hooks/useAuth';
import { toast } from '@/hooks/useToast';

// ============================================
// Types
// ============================================

interface Suggestion {
    id: string;
    suggestedSlug: string;
    suggestedName: string;
    parentSlug: string;
    confidence: number;
    source: string;
    hitCount: number;
    status: string;
    reasoning?: string;
    createdAt: string;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// P2-13: sync-status result shape
interface SyncStatus {
    inSync: boolean;
    missingFields: string[];
    extraFields: string[];
    warnings: string[];
}

type TabStatus = 'PROPOSED' | 'ACTIVE' | 'DEPRECATED' | 'REJECTED';

// ============================================
// Admin Verticals Page
// ============================================

export default function AdminVerticals() {
    const { user } = useAuth();
    const [tab, setTab] = useState<TabStatus>('PROPOSED');
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [showRejectDialog, setShowRejectDialog] = useState<string | null>(null);

    // P2-13: per-row sync-check loading and result state
    const [syncLoading, setSyncLoading] = useState<string | null>(null);
    const [syncResults, setSyncResults] = useState<Record<string, SyncStatus>>({});

    // Redirect non-admins
    if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;

    const fetchSuggestions = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const params: Record<string, string> = {
                status: tab,
                page: String(page),
                limit: '20',
            };
            if (search) params.search = search;

            const res = await api.getVerticalSuggestions(params);
            if (res.data) {
                setSuggestions(res.data.suggestions);
                setPagination(res.data.pagination);
                // Clear stale sync results when the list refreshes
                setSyncResults({});
            }
        } catch {
            toast({ title: 'Failed to load suggestions', type: 'error' });
        } finally {
            setLoading(false);
        }
    }, [tab, search]);

    useEffect(() => { fetchSuggestions(1); }, [fetchSuggestions]);

    const handleApprove = async (id: string, mintNft = false) => {
        setActionLoading(id);
        try {
            const res = await api.approveSuggestion(id, mintNft);
            if (res.data) {
                toast({ title: res.data.message, type: 'success' });
                fetchSuggestions(pagination.page);
            } else {
                toast({ title: res.error?.error || 'Failed', type: 'error' });
            }
        } finally {
            setActionLoading(null);
        }
    };

    const handleReject = async (id: string) => {
        setActionLoading(id);
        try {
            const res = await api.rejectSuggestion(id, rejectReason);
            if (res.data) {
                toast({ title: res.data.message, type: 'success' });
                setShowRejectDialog(null);
                setRejectReason('');
                fetchSuggestions(pagination.page);
            } else {
                toast({ title: res.error?.error || 'Failed', type: 'error' });
            }
        } finally {
            setActionLoading(null);
        }
    };

    const handleUpdateStatus = async (id: string, status: 'ACTIVE' | 'DEPRECATED' | 'REJECTED') => {
        setActionLoading(id);
        try {
            const res = await api.updateSuggestionStatus(id, status);
            if (res.data) {
                toast({ title: res.data.message, type: 'success' });
                fetchSuggestions(pagination.page);
            } else {
                toast({ title: res.error?.error || 'Failed', type: 'error' });
            }
        } finally {
            setActionLoading(null);
        }
    };

    // P2-13: Sync Check handler — calls GET /api/v1/verticals/:id/sync-status
    const handleSyncCheck = async (id: string, name: string) => {
        setSyncLoading(id);
        try {
            const res = await api.getVerticalSyncStatus(id);
            if (res.data) {
                setSyncResults((prev) => ({ ...prev, [id]: res.data! }));
                if (res.data.inSync) {
                    toast({ title: `✅ "${name}" fields are in sync`, type: 'success' });
                } else {
                    const parts: string[] = [];
                    if (res.data.missingFields.length)
                        parts.push(`Missing: ${res.data.missingFields.join(', ')}`);
                    if (res.data.extraFields.length)
                        parts.push(`Extra: ${res.data.extraFields.join(', ')}`);
                    if (res.data.warnings.length)
                        parts.push(`Warnings: ${res.data.warnings.length}`);
                    toast({
                        title: `⚠️ "${name}" out of sync`,
                        description: parts.join(' | '),
                        type: 'error',
                    });
                }
            } else {
                toast({ title: res.error?.error || 'Sync check failed', type: 'error' });
            }
        } finally {
            setSyncLoading(null);
        }
    };

    const tabs: { key: TabStatus; label: string; icon: React.ReactNode }[] = [
        { key: 'PROPOSED', label: 'Pending', icon: <Sparkles className="h-4 w-4" /> },
        { key: 'ACTIVE', label: 'Approved', icon: <Check className="h-4 w-4" /> },
        { key: 'DEPRECATED', label: 'Paused', icon: <Pause className="h-4 w-4" /> },
        { key: 'REJECTED', label: 'Rejected', icon: <X className="h-4 w-4" /> },
    ];

    return (
        <DashboardLayout>
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Gem className="h-6 w-6 text-primary" />
                            Vertical Suggestions
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            Review and manage community-submitted vertical proposals
                        </p>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2">
                    {tabs.map((t) => (
                        <Button
                            key={t.key}
                            variant={tab === t.key ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => { setTab(t.key); }}
                            className="flex items-center gap-1.5"
                        >
                            {t.icon}
                            {t.label}
                        </Button>
                    ))}
                </div>

                {/* Search */}
                <div className="relative max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name or slug..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9"
                        id="suggestion-search"
                    />
                </div>

                {/* Table */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg">
                            {tab === 'PROPOSED' ? 'Pending Review' : tab === 'ACTIVE' ? 'Approved Verticals' : 'Rejected Proposals'}
                            <span className="text-muted-foreground font-normal ml-2 text-sm">({pagination.total})</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : suggestions.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground">
                                No {tab.toLowerCase()} suggestions found.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b text-muted-foreground">
                                            <th className="text-left py-2 px-3 font-medium">Name</th>
                                            <th className="text-left py-2 px-3 font-medium">Slug</th>
                                            <th className="text-left py-2 px-3 font-medium">Parent</th>
                                            <th className="text-right py-2 px-3 font-medium">Confidence</th>
                                            <th className="text-right py-2 px-3 font-medium">Hits</th>
                                            <th className="text-left py-2 px-3 font-medium">Source</th>
                                            <th className="text-center py-2 px-3 font-medium">Fields</th>
                                            {tab === 'PROPOSED' && <th className="text-right py-2 px-3 font-medium">Actions</th>}
                                            {(tab === 'ACTIVE' || tab === 'DEPRECATED') && <th className="text-right py-2 px-3 font-medium">Manage</th>}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {suggestions.map((s) => {
                                            const sync = syncResults[s.id];
                                            return (
                                                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                                                    <td className="py-2.5 px-3 font-medium">{s.suggestedName}</td>
                                                    <td className="py-2.5 px-3 text-muted-foreground font-mono text-xs">{s.suggestedSlug}</td>
                                                    <td className="py-2.5 px-3 text-muted-foreground">{s.parentSlug || '—'}</td>
                                                    <td className="py-2.5 px-3 text-right tabular-nums">
                                                        <span className={s.confidence >= 0.7 ? 'text-emerald-500' : s.confidence >= 0.4 ? 'text-amber-500' : 'text-red-400'}>
                                                            {(s.confidence * 100).toFixed(0)}%
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right tabular-nums">{s.hitCount}</td>
                                                    <td className="py-2.5 px-3">
                                                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{s.source}</span>
                                                    </td>
                                                    {/* P2-13: Sync Check button + inline badge */}
                                                    <td className="py-2.5 px-3 text-center">
                                                        <div className="flex items-center gap-1 justify-center">
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-6 w-6 p-0"
                                                                disabled={syncLoading === s.id}
                                                                onClick={() => handleSyncCheck(s.id, s.suggestedName)}
                                                                title="Check VerticalField sync status"
                                                                id={`sync-check-${s.id}`}
                                                            >
                                                                {syncLoading === s.id
                                                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                                                    : <RefreshCw className="h-3 w-3" />}
                                                            </Button>
                                                            {sync != null && (
                                                                <span
                                                                    className={`text-xs px-1 py-0.5 rounded font-mono ${sync.inSync
                                                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                                                            : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                                                                        }`}
                                                                    title={
                                                                        sync.inSync
                                                                            ? 'All fields in sync'
                                                                            : [
                                                                                sync.missingFields.length ? `Missing: ${sync.missingFields.join(', ')}` : '',
                                                                                sync.extraFields.length ? `Extra: ${sync.extraFields.join(', ')}` : '',
                                                                                ...sync.warnings,
                                                                            ]
                                                                                .filter(Boolean)
                                                                                .join('\n')
                                                                    }
                                                                >
                                                                    {sync.inSync ? '✓' : '!'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    {tab === 'PROPOSED' && (
                                                        <td className="py-2.5 px-3 text-right">
                                                            <div className="flex items-center gap-1.5 justify-end">
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs text-emerald-600 border-emerald-600/30 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                                                    disabled={actionLoading === s.id}
                                                                    onClick={() => handleApprove(s.id, false)}
                                                                >
                                                                    {actionLoading === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                                                    Approve
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs text-emerald-600 border-emerald-600/30 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                                                    disabled={actionLoading === s.id}
                                                                    onClick={() => handleApprove(s.id, true)}
                                                                    title="Approve and mint as NFT"
                                                                >
                                                                    <Gem className="h-3 w-3" />
                                                                    + NFT
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs text-red-500 border-red-500/30 hover:bg-red-50 dark:hover:bg-red-950"
                                                                    disabled={actionLoading === s.id}
                                                                    onClick={() => setShowRejectDialog(s.id)}
                                                                >
                                                                    <X className="h-3 w-3" />
                                                                    Reject
                                                                </Button>
                                                            </div>
                                                        </td>
                                                    )}
                                                    {tab === 'ACTIVE' && (
                                                        <td className="py-2.5 px-3 text-right">
                                                            <div className="flex items-center gap-1.5 justify-end">
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs text-amber-600 border-amber-600/30 hover:bg-amber-50 dark:hover:bg-amber-950"
                                                                    disabled={actionLoading === s.id}
                                                                    onClick={() => handleUpdateStatus(s.id, 'DEPRECATED')}
                                                                    title="Pause — hides from marketplace but keeps data"
                                                                >
                                                                    {actionLoading === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
                                                                    Pause
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs text-red-500 border-red-500/30 hover:bg-red-50 dark:hover:bg-red-950"
                                                                    disabled={actionLoading === s.id}
                                                                    onClick={() => handleUpdateStatus(s.id, 'REJECTED')}
                                                                    title="Delete — removes this vertical"
                                                                >
                                                                    {actionLoading === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                                                                    Delete
                                                                </Button>
                                                            </div>
                                                        </td>
                                                    )}
                                                    {tab === 'DEPRECATED' && (
                                                        <td className="py-2.5 px-3 text-right">
                                                            <div className="flex items-center gap-1.5 justify-end">
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs text-emerald-600 border-emerald-600/30 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                                                    disabled={actionLoading === s.id}
                                                                    onClick={() => handleUpdateStatus(s.id, 'ACTIVE')}
                                                                    title="Reactivate this vertical"
                                                                >
                                                                    {actionLoading === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                                                    Reactivate
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs text-red-500 border-red-500/30 hover:bg-red-50 dark:hover:bg-red-950"
                                                                    disabled={actionLoading === s.id}
                                                                    onClick={() => handleUpdateStatus(s.id, 'REJECTED')}
                                                                    title="Permanently delete this vertical"
                                                                >
                                                                    {actionLoading === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                                                                    Delete
                                                                </Button>
                                                            </div>
                                                        </td>
                                                    )}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* Pagination */}
                        {pagination.totalPages > 1 && (
                            <div className="flex items-center justify-between mt-4 pt-4 border-t">
                                <span className="text-xs text-muted-foreground">
                                    Page {pagination.page} of {pagination.totalPages}
                                </span>
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={pagination.page <= 1}
                                        onClick={() => fetchSuggestions(pagination.page - 1)}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={pagination.page >= pagination.totalPages}
                                        onClick={() => fetchSuggestions(pagination.page + 1)}
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Reject Dialog */}
                {showRejectDialog && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                        <Card className="w-full max-w-md">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                                    Reject Suggestion
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Input
                                    placeholder="Reason for rejection (optional)"
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                    id="reject-reason"
                                />
                                <div className="flex gap-2 justify-end">
                                    <Button variant="outline" onClick={() => { setShowRejectDialog(null); setRejectReason(''); }}>
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        disabled={actionLoading === showRejectDialog}
                                        onClick={() => handleReject(showRejectDialog)}
                                    >
                                        {actionLoading === showRejectDialog ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reject'}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
