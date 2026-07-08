import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Gavel, Lock, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import api from '@/lib/api';
import {
    storeSealedBid,
    getSealedBidRecord,
    computeSealedBidCommitment,
    generateBidSalt,
} from '@/utils/sealedBid';

const bidSchema = z.object({
    amount: z.number().positive('Amount must be positive'),
});

type BidFormData = z.infer<typeof bidSchema>;

interface BidPanelProps {
    /** Lead being bid on — bound into the sealed-bid commitment hash. */
    leadId: string;
    /** Authenticated buyer id — bound into the commitment (anti-replay). */
    buyerId?: string;
    reservePrice: number;
    highestBid?: number | null;
    phase: 'BIDDING' | 'REVEAL' | 'RESOLVED' | 'CANCELLED';
    /** SEALED-BID: only the commitment leaves the browser — never the amount. */
    onPlaceBid: (data: { commitment: string }) => void;
    onRevealBid?: (amount: number, salt: string) => void;
    myPendingBid?: { commitment: string };
    isLoading?: boolean;
}

export function BidPanel({
    leadId,
    buyerId,
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
    const [vaultBalance, setVaultBalance] = useState<number | null>(null);

    // Fetch vault balance on mount
    useEffect(() => {
        api.getVault().then(({ data }) => {
            if (data) setVaultBalance(data.balance ?? 0);
        }).catch(() => setVaultBalance(0));
    }, []);

    // Auto-populate reveal data from sessionStorage when entering REVEAL phase
    useEffect(() => {
        if (phase === 'REVEAL' && myPendingBid?.commitment) {
            const stored = getSealedBidRecord(myPendingBid.commitment);
            if (stored) {
                setRevealData({ amount: String(stored.amount), salt: stored.salt });
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
    const requiredVault = currentAmount + 1; // bid + $1 convenience fee
    const hasVaultFunds = vaultBalance !== null && vaultBalance >= requiredVault;

    const onSubmit = (data: BidFormData) => {
        if (!buyerId) return; // commitment requires the authenticated buyer id
        // Domain-separated sealed commitment (v1) — binds lead + bidder so a
        // commitment can never be replayed by another buyer or on another lead.
        // Matches backend/src/services/bid.service.ts byte-for-byte.
        const salt = generateBidSalt();
        const commitment = computeSealedBidCommitment({
            leadId,
            buyerId,
            amount: data.amount,
            salt,
        });
        // Tab-scoped sessionStorage — see utils/sealedBid.ts for rationale.
        storeSealedBid(commitment, { amount: data.amount, salt, leadId });
        // SEALED-BID: the amount never leaves the browser pre-reveal.
        onPlaceBid({ commitment });
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

                        {/* Vault Balance */}
                        {vaultBalance !== null && (
                            <div className={`flex items-center justify-between p-3 rounded-xl border ${hasVaultFunds ? 'border-teal-500/30 bg-teal-500/5' : 'border-red-500/30 bg-red-500/5'
                                }`}>
                                <span className="text-xs font-medium">Vault Balance</span>
                                <span className={`font-mono text-sm ${hasVaultFunds ? 'text-teal-500' : 'text-red-500'}`}>
                                    {formatCurrency(vaultBalance)} USDC
                                </span>
                            </div>
                        )}
                        {vaultBalance !== null && !hasVaultFunds && (
                            <div className="text-xs text-red-400 text-center">
                                Insufficient vault funds — need {formatCurrency(requiredVault)} (bid + $1 fee).{' '}
                                <a href="/dashboard" className="underline text-teal-400">Fund vault →</a>
                            </div>
                        )}

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

                            <Button type="submit" loading={isLoading} className="w-full" size="lg" disabled={!meetReserve || !hasVaultFunds}>
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
