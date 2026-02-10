import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, MapPin, Clock, ArrowUpRight, Plus } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SkeletonTable } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { formatCurrency, getStatusColor } from '@/lib/utils';

export function SellerLeads() {
    const [leads, setLeads] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');

    useEffect(() => {
        const fetchLeads = async () => {
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
        };

        fetchLeads();
    }, [statusFilter]);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">My Leads</h1>
                        <p className="text-muted-foreground">Manage all your submitted leads</p>
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
                                <SelectItem value="EXPIRED">Expired</SelectItem>
                            </SelectContent>
                        </Select>

                        <Button asChild>
                            <Link to="/seller/submit">
                                <Plus className="h-4 w-4 mr-2" />
                                Submit Lead
                            </Link>
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
                                            <th className="p-4"></th>
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
                                                    <span className="font-semibold">{formatCurrency(lead.reservePrice)}</span>
                                                </td>
                                                <td className="p-4">
                                                    <span className="text-muted-foreground">{lead._count?.bids || 0}</span>
                                                </td>
                                                <td className="p-4">
                                                    <Badge className={getStatusColor(lead.status)}>
                                                        {lead.status.replace('_', ' ')}
                                                    </Badge>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                                        <Clock className="h-3 w-3" />
                                                        {new Date(lead.createdAt).toLocaleDateString()}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <Button variant="ghost" size="sm" asChild>
                                                        <Link to={`/lead/${lead.id}`}>
                                                            View <ArrowUpRight className="h-4 w-4 ml-1" />
                                                        </Link>
                                                    </Button>
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
