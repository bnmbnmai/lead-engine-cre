import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { keccak256, encodeAbiParameters, toHex } from 'viem';
import { Gavel, Lock, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';

const bidSchema = z.object({
    amount: z.number().positive('Amount must be positive'),
});

type BidFormData = z.infer<typeof bidSchema>;

interface BidPanelProps {
    reservePrice: number;
    highestBid?: number | null;
    phase: 'BIDDING' | 'REVEAL' | 'RESOLVED' | 'CANCELLED';
    onPlaceBid: (data: { commitment: string; amount?: number }) => void;
    onRevealBid?: (amount: number, salt: string) => void;
    myPendingBid?: { commitment: string };
    isLoading?: boolean;
}

export function BidPanel({
    reservePrice,
    highestBid,
    phase,
    onPlaceBid,
    onRevealBid,
    myPendingBid,
    isLoading,
}: BidPanelProps) {
    const [revealData, setRevealData] = useState({ amount: '', salt: '' });
    const [bidSubmitted, setBidSubmitted] = useState(false);

    // Auto-populate reveal data from localStorage when entering REVEAL phase
    useEffect(() => {
        if (phase === 'REVEAL' && myPendingBid?.commitment) {
            const stored = localStorage.getItem(`bid_salt_${myPendingBid.commitment}`);
            if (stored) {
                try {
                    const { amount, salt } = JSON.parse(stored);
                    setRevealData({ amount: String(amount), salt });
                } catch { /* corrupt entry — user fills manually */ }
            }
        }
    }, [phase, myPendingBid?.commitment]);

    const { register, handleSubmit, formState: { errors }, watch } = useForm<BidFormData>({
        resolver: zodResolver(bidSchema),
        defaultValues: {
            amount: highestBid ? highestBid + 10 : reservePrice,
        },
    });

    const currentAmount = watch('amount');
    const meetReserve = currentAmount >= reservePrice;

    const onSubmit = (data: BidFormData) => {
        // Generate proper sealed commitment: keccak256(abi.encode([uint96, bytes32], [amountWei, salt]))
        // Amount is in USDC with 6 decimals — convert to wei for on-chain matching
        const amountWei = BigInt(Math.round(data.amount * 1e6));
        const saltBytes = crypto.getRandomValues(new Uint8Array(32));
        const salt = toHex(saltBytes);
        const commitment = keccak256(
            encodeAbiParameters(
                [{ type: 'uint96' }, { type: 'bytes32' }],
                [amountWei, salt as `0x${string}`]
            )
        );
        localStorage.setItem(`bid_salt_${commitment}`, JSON.stringify({ amount: data.amount, salt }));
        onPlaceBid({ commitment, amount: data.amount });
        setBidSubmitted(true);
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
                        <Lock className="h-5 w-5 text-purple-500" />
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

    // Bidding phase — sealed commit-reveal only
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Gavel className="h-5 w-5 text-blue-500" />
                    Place Your Bid
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {bidSubmitted ? (
                    /* ── Bid submitted confirmation ── */
                    <div className="text-center space-y-3 py-2">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-500/10 border border-green-500/30">
                            <Lock className="h-5 w-5 text-green-500" />
                        </div>
                        <div>
                            <p className="font-semibold text-green-500">✓ Sealed Bid Submitted</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Your bid is encrypted and will be revealed automatically when the auction ends.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setBidSubmitted(false)}
                            className="mt-2"
                        >
                            Place Another Bid
                        </Button>
                    </div>
                ) : (
                    /* ── Bid form ── */
                    <>
                        {/* Sealed bid explanation */}
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-border">
                            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Sealed Bid — your bid is encrypted until the reveal phase. Prevents front-running and protects your strategy.
                            </p>
                        </div>

                        {/* Price Info */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 rounded-xl bg-muted/50">
                                <div className="text-xs text-muted-foreground">Reserve</div>
                                <div className="font-semibold">{formatCurrency(reservePrice)}</div>
                            </div>
                            <div className="p-3 rounded-xl bg-muted/50">
                                <div className="text-xs text-muted-foreground">Bids</div>
                                <div className="font-semibold text-muted-foreground">
                                    Sealed
                                </div>
                            </div>
                        </div>

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
                            </div>

                            <Button type="submit" loading={isLoading} className="w-full" size="lg">
                                <Lock className="h-4 w-4 mr-2" />
                                Submit Sealed Bid
                            </Button>

                            <p className="text-xs text-muted-foreground text-center">
                                Your bid amount will be hidden until the reveal phase. Save your salt!
                            </p>
                        </form>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

export default BidPanel;
