import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FileText, MapPin, Clock, ArrowUpRight, Plus, Download, CheckCircle, Send, Tag, Loader2, MessageSquare } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SkeletonTable } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/Tooltip';
import api from '@/lib/api';
import { formatCurrency, getStatusColor } from '@/lib/utils';
import { toast } from '@/hooks/useToast';
import { useSocketEvents } from '@/hooks/useSocketEvents';

export function SellerLeads() {
    const [leads, setLeads] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [crmPushed, setCrmPushed] = useState<Set<string>>(new Set());
    const [crmExporting, setCrmExporting] = useState(false);
    const [requalifying, setRequalifying] = useState<Set<string>>(new Set());

    const handleCrmExportAll = () => {
        if (leads.length === 0) return;
        setCrmExporting(true);
        const headers = ['ID', 'Vertical', 'Country', 'State', 'Status', 'Source', 'Created At', 'Winning Bid'];
        const rows = leads.map((l: any) => [
            l.id,
            l.vertical || '',
            l.geo?.country || 'US',
            l.geo?.state || '',
            l.status || '',
            l.source || '',
            l.createdAt ? new Date(l.createdAt).toISOString() : '',
            l.winningBid?.amount || '',
        ].join(','));
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `crm-leads-export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setTimeout(() => setCrmExporting(false), 1500);
    };

    const handleCrmPushSingle = (leadId: string) => {
        setCrmPushed((prev) => new Set(prev).add(leadId));
        // In production, this would POST to /api/v1/crm/push with the lead ID
    };

    const handleRequalify = async (leadId: string) => {
        setRequalifying((prev) => new Set(prev).add(leadId));
        try {
            const { data, error } = await api.requalifyLead(leadId);
            if (error) {
                toast({ type: 'error', title: 'Requalify Failed', description: error.error || 'Unknown error' });
            } else {
                toast({
                    type: 'success',
                    title: 'SMS Preview',
                    description: data?.preview || 'Requalify request sent',
                });
            }
        } catch {
            toast({ type: 'error', title: 'Network Error', description: 'Failed to requalify lead' });
        } finally {
            setRequalifying((prev) => {
                const next = new Set(prev);
                next.delete(leadId);
                return next;
            });
        }
    };

    const fetchLeads = useCallback(async () => {
        setIsLoading(true);
        try {
            const params: Record<string, string> = {};
            if (statusFilter !== 'all') params.status = statusFilter;

            const { data } = await api.listLeads(params);
            setLeads(data?.leads || []);
        } catch (error) {
            console.error('Failed to fetch leads:', error);
        } finally {
            setIsLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { fetchLeads(); }, [fetchLeads]);

    // Real-time updates
    useSocketEvents(
        {
            'marketplace:refreshAll': () => { fetchLeads(); },
            'marketplace:bid:update': (data: any) => {
                if (data?.leadId) {
                    setLeads((prev) =>
                        prev.map((lead) =>
                            lead.id === data.leadId
                                ? { ...lead, _count: { ...lead._count, bids: data.bidCount } }
                                : lead,
                        ),
                    );
                }
            },
        },
        fetchLeads,
    );

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">My Leads</h1>
                        <p className="text-muted-foreground">Manage all your sold and submitted leads</p>
                    </div>

                    <div className="flex gap-3">
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-40">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="PENDING">Pending</SelectItem>
                                <SelectItem value="IN_AUCTION">In Auction</SelectItem>
                                <SelectItem value="SOLD">Sold</SelectItem>
                                <SelectItem value="UNSOLD">Unsold (Buy Now)</SelectItem>
                                <SelectItem value="EXPIRED">Expired</SelectItem>
                            </SelectContent>
                        </Select>

                        <Button asChild>
                            <Link to="/seller/submit">
                                <Plus className="h-4 w-4 mr-2" />
                                Submit Lead
                            </Link>
                        </Button>

                        <Button
                            variant="outline"
                            onClick={handleCrmExportAll}
                            disabled={leads.length === 0 || crmExporting}
                            className="gap-2"
                        >
                            {crmExporting ? (
                                <><CheckCircle className="h-4 w-4 text-emerald-500" /> Exported!</>
                            ) : (
                                <><Download className="h-4 w-4" /> Push to CRM</>
                            )}
                        </Button>
                    </div>
                </div>

                <Card>
                    <CardContent className="p-0">
                        {isLoading ? (
                            <div className="p-6">
                                <SkeletonTable rows={8} />
                            </div>
                        ) : leads.length === 0 ? (
                            <div className="text-center py-12">
                                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                <p className="text-muted-foreground mb-4">No leads submitted yet</p>
                                <Button asChild>
                                    <Link to="/seller/submit">Submit Your First Lead</Link>
                                </Button>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="border-b border-border">
                                        <tr>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Lead</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Location</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Reserve</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Bids</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Created</th>
                                            <th className="text-right p-4 font-medium text-muted-foreground">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {leads.map((lead) => (
                                            <tr key={lead.id} className="hover:bg-muted/50 transition">
                                                <td className="p-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                            <FileText className="h-5 w-5 text-primary" />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium capitalize">{lead.vertical}</div>
                                                            <div className="text-xs text-muted-foreground">{lead.source}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-1 text-sm">
                                                        <MapPin className="h-3 w-3 text-muted-foreground" />
                                                        {lead.geo?.country && lead.geo.country !== 'US' && (
                                                            <span className="text-xs text-muted-foreground">{lead.geo.country} ·</span>
                                                        )}
                                                        {lead.geo?.city && `${lead.geo.city}, `}{lead.geo?.state || lead.geo?.region || 'Unknown'}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div>
                                                        <span className="font-semibold">{formatCurrency(lead.reservePrice)}</span>
                                                        {lead.status === 'UNSOLD' && lead.buyNowPrice && (
                                                            <div className="flex items-center gap-1 mt-0.5">
                                                                <Tag className="h-3 w-3 text-green-500" />
                                                                <span className="text-xs text-green-500 font-medium">
                                                                    BIN: {formatCurrency(lead.buyNowPrice)}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <span className="text-muted-foreground">{lead._count?.bids || 0}</span>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-1.5">
                                                        <Badge className={getStatusColor(lead.status)}>
                                                            {lead.status.replace('_', ' ')}
                                                        </Badge>
                                                        {lead.status === 'UNSOLD' && lead.expiresAt && (
                                                            <Tooltip content={`Expires: ${new Date(lead.expiresAt).toLocaleString()}`}>
                                                                <span className="text-xs text-amber-500 cursor-help">
                                                                    {(() => {
                                                                        const diff = new Date(lead.expiresAt).getTime() - Date.now();
                                                                        if (diff <= 0) return 'Expired';
                                                                        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                                                                        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                                                                        return `${days}d ${hours}h left`;
                                                                    })()}
                                                                </span>
                                                            </Tooltip>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                                        <Clock className="h-3 w-3" />
                                                        {new Date(lead.createdAt).toLocaleDateString()}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center justify-end gap-1">
                                                        {lead.status === 'UNSOLD' && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => handleRequalify(lead.id)}
                                                                disabled={requalifying.has(lead.id)}
                                                                className="gap-1 text-amber-500 hover:text-amber-400"
                                                                title="Send requalification SMS to lead"
                                                            >
                                                                {requalifying.has(lead.id) ? (
                                                                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
                                                                ) : (
                                                                    <><MessageSquare className="h-3.5 w-3.5" /> Requalify</>
                                                                )}
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleCrmPushSingle(lead.id)}
                                                            disabled={crmPushed.has(lead.id)}
                                                            className="gap-1"
                                                            title="Push to CRM"
                                                        >
                                                            {crmPushed.has(lead.id) ? (
                                                                <><CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> Pushed</>
                                                            ) : (
                                                                <><Send className="h-3.5 w-3.5" /> CRM</>
                                                            )}
                                                        </Button>
                                                        <Button variant="ghost" size="sm" asChild>
                                                            <Link to={`/lead/${lead.id}`}>
                                                                View <ArrowUpRight className="h-4 w-4 ml-1" />
                                                            </Link>
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}

export default SellerLeads;
