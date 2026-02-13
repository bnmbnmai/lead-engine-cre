import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Gavel, Clock, ArrowUpRight } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SkeletonTable } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { formatCurrency, getStatusColor } from '@/lib/utils';
import { formatSealedBid } from '@/utils/sealedBid';

export function BuyerBids() {
    const [bids, setBids] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');

    useEffect(() => {
        const fetchBids = async () => {
            setIsLoading(true);
            try {
                const params: Record<string, string> = {};
                if (statusFilter !== 'all') params.status = statusFilter;

                const { data } = await api.getMyBids(params);
                setBids(data?.bids || []);
            } catch (error) {
                console.error('Failed to fetch bids:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchBids();
    }, [statusFilter]);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">My Bids</h1>
                        <p className="text-muted-foreground">Track all your bids across auctions</p>
                    </div>

                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-40">
                            <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Status</SelectItem>
                            <SelectItem value="PENDING">Pending</SelectItem>
                            <SelectItem value="REVEALED">Revealed</SelectItem>
                            <SelectItem value="ACCEPTED">Won</SelectItem>
                            <SelectItem value="OUTBID">Outbid</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <Card>
                    <CardContent className="p-0">
                        {isLoading ? (
                            <div className="p-6">
                                <SkeletonTable rows={8} />
                            </div>
                        ) : bids.length === 0 ? (
                            <div className="text-center py-12">
                                <Gavel className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                <p className="text-muted-foreground mb-4">No bids found</p>
                                <Button asChild>
                                    <Link to="/">Browse Marketplace</Link>
                                </Button>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="border-b border-border">
                                        <tr>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Lead</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Amount</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
                                            <th className="text-left p-4 font-medium text-muted-foreground">Date</th>
                                            <th className="p-4"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {bids.map((bid) => (
                                            <tr key={bid.id} className="hover:bg-muted/50 transition">
                                                <td className="p-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                            <Gavel className="h-5 w-5 text-primary" />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium capitalize">
                                                                {bid.lead?.vertical || 'Lead'}
                                                            </div>
                                                            <div className="text-sm text-muted-foreground">
                                                                {bid.lead?.geo?.state || 'Unknown'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <span className="font-semibold">
                                                        {bid.amount ? formatCurrency(bid.amount) : (() => {
                                                            const sealed = formatSealedBid(bid.commitment);
                                                            return sealed.isRevealed
                                                                ? <span title="Sealed bid (not yet revealed)">{sealed.display}</span>
                                                                : <span className="text-muted-foreground">Sealed</span>;
                                                        })()}
                                                    </span>
                                                </td>
                                                <td className="p-4">
                                                    <Badge className={getStatusColor(bid.status)}>{bid.status}</Badge>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                                        <Clock className="h-3 w-3" />
                                                        {new Date(bid.createdAt).toLocaleDateString()}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <Button variant="ghost" size="sm" asChild>
                                                        <Link to={`/auction/${bid.leadId}`}>
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

export default BuyerBids;
