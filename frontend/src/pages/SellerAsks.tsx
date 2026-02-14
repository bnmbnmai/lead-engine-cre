import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Tag, MapPin, Clock, ArrowUpRight, Plus } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SkeletonTable } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { formatCurrency, getStatusColor } from '@/lib/utils';
import { useSocketEvents } from '@/hooks/useSocketEvents';

export function SellerAsks() {
    const [asks, setAsks] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');

    const fetchAsks = useCallback(async () => {
        setIsLoading(true);
        try {
            const params: Record<string, string> = {};
            if (statusFilter !== 'all') params.status = statusFilter;

            const { data } = await api.listAsks(params);
            setAsks(data?.asks || []);
        } catch (error) {
            console.error('Failed to fetch asks:', error);
        } finally {
            setIsLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { fetchAsks(); }, [fetchAsks]);

    // Real-time updates
    useSocketEvents(
        { 'marketplace:refreshAll': () => { fetchAsks(); } },
        fetchAsks,
    );

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">My Active Asks</h1>
                        <p className="text-muted-foreground">Manage your lead listing preferences</p>
                    </div>

                    <div className="flex gap-3">
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-40">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="ACTIVE">Active</SelectItem>
                                <SelectItem value="PAUSED">Paused</SelectItem>
                                <SelectItem value="EXPIRED">Expired</SelectItem>
                            </SelectContent>
                        </Select>

                        <Button asChild>
                            <Link to="/seller/asks/new">
                                <Plus className="h-4 w-4 mr-2" />
                                New Ask
                            </Link>
                        </Button>
                    </div>
                </div>

                <Card>
                    <CardContent className="p-0">
                        {isLoading ? (
                            <div className="p-6">
                                <SkeletonTable rows={6} />
                            </div>
                        ) : asks.length === 0 ? (
                            <div className="text-center py-12">
                                <Tag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                <p className="text-muted-foreground mb-4">No asks created yet</p>
                                <Button asChild>
                                    <Link to="/seller/asks/new">Create Your First Ask</Link>
                                </Button>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="border-b border-border">
                                        <tr>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Vertical</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Geo</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Reserve</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Buy Now</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Leads</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Created</th>
                                            <th className="p-4"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {asks.map((ask) => (
                                            <tr key={ask.id} className="hover:bg-muted/50 transition">
                                                <td className="p-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                                                            <Tag className="h-5 w-5 text-purple-500" />
                                                        </div>
                                                        <span className="font-medium capitalize">{ask.vertical}</span>
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-1 text-sm">
                                                        <MapPin className="h-3 w-3 text-muted-foreground" />
                                                        {ask.geoTargets?.states?.length
                                                            ? ask.geoTargets.states.slice(0, 3).join(', ')
                                                            : 'All States'}
                                                        {ask.geoTargets?.states?.length > 3 && (
                                                            <span className="text-muted-foreground">
                                                                +{ask.geoTargets.states.length - 3}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <span className="font-semibold">{formatCurrency(ask.reservePrice)}</span>
                                                </td>
                                                <td className="p-4">
                                                    {ask.buyNowPrice ? (
                                                        <span className="text-green-500">{formatCurrency(ask.buyNowPrice)}</span>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </td>
                                                <td className="p-4">
                                                    <span className="text-muted-foreground">{ask._count?.leads || 0}</span>
                                                </td>
                                                <td className="p-4">
                                                    <Badge className={getStatusColor(ask.status)}>{ask.status}</Badge>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                                        <Clock className="h-3 w-3" />
                                                        {new Date(ask.createdAt).toLocaleDateString()}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <Button variant="ghost" size="sm" asChild>
                                                        <Link to={`/marketplace/ask/${ask.id}`}>
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

export default SellerAsks;
