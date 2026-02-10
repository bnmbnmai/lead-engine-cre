import { Link } from 'react-router-dom';
import { MapPin, Clock, Shield, Zap, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatTimeRemaining, getStatusColor } from '@/lib/utils';

interface Lead {
    id: string;
    vertical: string;
    geo: { state?: string; city?: string };
    source: 'PLATFORM' | 'API' | 'OFFSITE';
    status: string;
    reservePrice: number;
    isVerified: boolean;
    auctionEndAt?: string;
    _count?: { bids: number };
}

interface LeadCardProps {
    lead: Lead;
    showBidButton?: boolean;
}

export function LeadCard({ lead, showBidButton = true }: LeadCardProps) {
    const isLive = lead.status === 'IN_AUCTION' || lead.status === 'REVEAL_PHASE';
    const timeRemaining = lead.auctionEndAt ? formatTimeRemaining(lead.auctionEndAt) : null;

    return (
        <Card className={`group transition-all ${isLive ? 'border-blue-500/50 glow' : ''}`}>
            <CardContent className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${lead.isVerified ? 'bg-green-500/20' : 'bg-gray-500/20'
                            }`}>
                            <Shield className={`h-6 w-6 ${lead.isVerified ? 'text-green-500' : 'text-gray-500'}`} />
                        </div>
                        <div>
                            <h3 className="font-semibold capitalize">{lead.vertical}</h3>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                {lead.geo.city ? `${lead.geo.city}, ` : ''}{lead.geo.state || 'Unknown'}
                            </div>
                        </div>
                    </div>
                    <Badge className={getStatusColor(lead.status)}>{lead.status.replace('_', ' ')}</Badge>
                </div>

                {/* Source & Stats */}
                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                    {lead.source === 'OFFSITE' && (
                        <div className="flex items-center gap-1 text-yellow-500">
                            <Zap className="h-4 w-4" />
                            Off-site
                        </div>
                    )}
                    {lead.source === 'API' && (
                        <div className="flex items-center gap-1 text-purple-500">
                            <span className="font-mono text-xs">API</span>
                        </div>
                    )}
                    <div className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        {lead._count?.bids || 0} bids
                    </div>
                    {timeRemaining && (
                        <div className="flex items-center gap-1 text-blue-500">
                            <Clock className="h-4 w-4" />
                            {timeRemaining}
                        </div>
                    )}
                </div>

                {/* Pricing & Action */}
                <div className="flex items-center justify-between pt-4 border-t border-border">
                    <div>
                        <div className="text-xs text-muted-foreground">Reserve</div>
                        <div className="text-lg font-bold">{formatCurrency(lead.reservePrice)}</div>
                    </div>

                    {showBidButton && isLive && (
                        <Button asChild size="sm" variant="gradient">
                            <Link to={`/auction/${lead.id}`}>
                                Place Bid
                            </Link>
                        </Button>
                    )}

                    {showBidButton && !isLive && (
                        <Button asChild size="sm" variant="outline">
                            <Link to={`/lead/${lead.id}`}>
                                View Details
                            </Link>
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

export default LeadCard;
