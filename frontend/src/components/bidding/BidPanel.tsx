import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Gavel, Eye, Lock, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { LeadPreview } from './LeadPreview';

const bidSchema = z.object({
    amount: z.number().positive('Amount must be positive'),
});

type BidFormData = z.infer<typeof bidSchema>;

interface BidPanelProps {
    leadId: string;
    reservePrice: number;
    highestBid?: number | null;
    phase: 'BIDDING' | 'REVEAL' | 'RESOLVED' | 'CANCELLED';
    onPlaceBid: (data: { amount?: number; commitment?: string }) => void;
    onRevealBid?: (amount: number, salt: string) => void;
    myPendingBid?: { commitment: string };
    isLoading?: boolean;
}

export function BidPanel({
    leadId,
    reservePrice,
    highestBid,
    phase,
    onPlaceBid,
    onRevealBid,
    myPendingBid,
    isLoading,
}: BidPanelProps) {
    const [bidMode, setBidMode] = useState<'direct' | 'commit'>('direct');
    const [revealData, setRevealData] = useState({ amount: '', salt: '' });

    const { register, handleSubmit, formState: { errors }, watch } = useForm<BidFormData>({
        resolver: zodResolver(bidSchema),
        defaultValues: {
            amount: highestBid ? highestBid + 10 : reservePrice,
        },
    });

    const currentAmount = watch('amount');
    const meetReserve = currentAmount >= reservePrice;
    const beatsHighest = !highestBid || currentAmount > highestBid;

    const onSubmit = (data: BidFormData) => {
        if (bidMode === 'direct') {
            onPlaceBid({ amount: data.amount });
        } else {
            // Generate commitment hash (simplified - real impl would use keccak256)
            const salt = crypto.randomUUID();
            const commitment = btoa(`${data.amount}:${salt}`); // Simplified for demo
            localStorage.setItem(`bid_salt_${commitment}`, JSON.stringify({ amount: data.amount, salt }));
            onPlaceBid({ commitment });
        }
    };

    const handleReveal = () => {
        const amount = parseFloat(revealData.amount);
        if (amount && revealData.salt) {
            onRevealBid?.(amount, revealData.salt);
        }
    };

    if (phase === 'RESOLVED' || phase === 'CANCELLED') {
        return (
            <Card>
                <CardContent className="p-6 text-center">
                    <div className="text-muted-foreground">
                        {phase === 'RESOLVED' ? 'Auction has ended' : 'Auction was cancelled'}
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (phase === 'REVEAL') {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Eye className="h-5 w-5 text-purple-500" />
                        Reveal Your Bid
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {myPendingBid ? (
                        <>
                            <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
                                <div className="text-sm text-muted-foreground mb-1">Your Commitment</div>
                                <div className="font-mono text-sm truncate">{myPendingBid.commitment}</div>
                            </div>

                            <div className="space-y-3">
                                <Input
                                    type="number"
                                    placeholder="Your bid amount"
                                    value={revealData.amount}
                                    onChange={(e) => setRevealData({ ...revealData, amount: e.target.value })}
                                />
                                <Input
                                    type="text"
                                    placeholder="Your salt"
                                    value={revealData.salt}
                                    onChange={(e) => setRevealData({ ...revealData, salt: e.target.value })}
                                />
                                <Button onClick={handleReveal} loading={isLoading} className="w-full">
                                    Reveal Bid
                                </Button>
                            </div>
                        </>
                    ) : (
                        <div className="text-center text-muted-foreground">
                            You don't have a pending bid to reveal
                        </div>
                    )}
                </CardContent>
            </Card>
        );
    }

    // Bidding phase
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Gavel className="h-5 w-5 text-blue-500" />
                    Place Your Bid
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Bid Mode Toggle */}
                <div className="flex gap-2 p-1 rounded-xl bg-muted">
                    <button
                        type="button"
                        onClick={() => setBidMode('direct')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${bidMode === 'direct' ? 'bg-background shadow' : ''
                            }`}
                    >
                        <Gavel className="h-4 w-4" />
                        Open Bid
                    </button>
                    <button
                        type="button"
                        onClick={() => setBidMode('commit')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${bidMode === 'commit' ? 'bg-background shadow' : ''
                            }`}
                    >
                        <Lock className="h-4 w-4" />
                        Sealed Bid
                    </button>
                </div>

                {/* Bid mode explanation */}
                <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-border">
                    <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        {bidMode === 'direct'
                            ? 'Open Bid — your bid amount is visible immediately. Simple and fast, best for quick placement.'
                            : 'Sealed Bid — your bid is encrypted until the reveal phase. Prevents front-running and protects your strategy.'}
                    </p>
                </div>

                {/* Price Info */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-xl bg-muted/50">
                        <div className="text-xs text-muted-foreground">Reserve</div>
                        <div className="font-semibold">{formatCurrency(reservePrice)}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/50">
                        <div className="text-xs text-muted-foreground">Highest Bid</div>
                        <div className="font-semibold">
                            {highestBid ? formatCurrency(highestBid) : 'No bids'}
                        </div>
                    </div>
                </div>

                {/* Lead Preview (non-PII fields) */}
                <LeadPreview leadId={leadId} />

                {/* Bid Form */}
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div>
                        <label className="text-sm font-medium mb-2 block">Your Bid (USDC)</label>
                        <Input
                            type="number"
                            step="0.01"
                            {...register('amount', { valueAsNumber: true })}
                            error={errors.amount?.message}
                        />
                    </div>

                    {/* Validation Feedback */}
                    <div className="space-y-1 text-sm">
                        <div className={meetReserve ? 'text-green-500' : 'text-red-500'}>
                            {meetReserve ? '✓' : '✗'} Meets reserve price
                        </div>
                        <div className={beatsHighest ? 'text-green-500' : 'text-yellow-500'}>
                            {beatsHighest ? '✓' : '⚠'} {beatsHighest ? 'Beats current highest' : 'Below highest bid'}
                        </div>
                    </div>

                    <Button type="submit" loading={isLoading} className="w-full" size="lg">
                        {bidMode === 'direct' ? 'Place Bid' : 'Submit Commitment'}
                    </Button>

                    {bidMode === 'commit' && (
                        <p className="text-xs text-muted-foreground text-center">
                            Your bid amount will be hidden until the reveal phase. Save your salt!
                        </p>
                    )}
                </form>
            </CardContent>
        </Card>
    );
}

export default BidPanel;
