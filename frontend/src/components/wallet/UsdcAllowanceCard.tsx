/**
 * USDC Auto-Bid Allowance Card
 *
 * Allows buyers to approve USDC to the escrow contract so the server-side
 * auto-bidder can settle won bids without requiring a wallet signature.
 *
 * Actions: Approve (preset amounts), Revoke, View balance + current allowance.
 */

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { parseAbi, formatUnits, parseUnits } from 'viem';
import {
    Wallet,
    ShieldCheck,
    ShieldOff,
    Loader2,
    CheckCircle2,
    AlertCircle,
    ExternalLink,
    DollarSign,
    ChevronDown,
    ChevronUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CONTRACT_ADDRESSES } from '@/lib/wagmi';

// ============================================
// ABI (parsed from human-readable)
// ============================================

const USDC_ABI_PARSED = parseAbi([
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
]);

// Preset approval amounts (in USDC, 6 decimals)
const PRESETS = [
    { label: '$500', value: 500 },
    { label: '$1,000', value: 1_000 },
    { label: '$5,000', value: 5_000 },
    { label: 'Unlimited', value: -1 }, // max uint256
] as const;

const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

// ============================================
// Component
// ============================================

export function UsdcAllowanceCard() {
    const { address, isConnected } = useAccount();
    const chainId = useChainId();
    const [customAmount, setCustomAmount] = useState('');
    const [isExpanded, setIsExpanded] = useState(true);
    const [lastAction, setLastAction] = useState<'approve' | 'revoke' | null>(null);

    // Resolve addresses for current chain
    const addresses = chainId === 84532
        ? CONTRACT_ADDRESSES.baseSepolia
        : CONTRACT_ADDRESSES.sepolia;

    const usdcAddress = addresses.usdc as `0x${string}`;
    const escrowAddress = addresses.escrow as `0x${string}`;

    // ── Read: current allowance ──
    const {
        data: allowanceRaw,
        refetch: refetchAllowance,
        isLoading: isLoadingAllowance,
    } = useReadContract({
        address: usdcAddress,
        abi: USDC_ABI_PARSED,
        functionName: 'allowance',
        args: address ? [address, escrowAddress] : undefined,
        query: { enabled: isConnected && !!address && !!escrowAddress },
    });

    // ── Read: balance ──
    const {
        data: balanceRaw,
        refetch: refetchBalance,
    } = useReadContract({
        address: usdcAddress,
        abi: USDC_ABI_PARSED,
        functionName: 'balanceOf',
        args: address ? [address] : undefined,
        query: { enabled: isConnected && !!address },
    });

    // ── Write: approve ──
    const {
        data: approveTxHash,
        writeContract: approveWrite,
        isPending: isApproving,
        error: approveError,
        reset: resetApprove,
    } = useWriteContract();

    // ── Wait for tx confirmation ──
    const {
        isLoading: isWaitingForTx,
        isSuccess: txConfirmed,
    } = useWaitForTransactionReceipt({
        hash: approveTxHash,
    });

    // Refetch allowance + balance after tx confirms
    useEffect(() => {
        if (txConfirmed) {
            refetchAllowance();
            refetchBalance();
            // Auto-clear after 4s
            const t = setTimeout(() => {
                resetApprove();
                setLastAction(null);
            }, 4000);
            return () => clearTimeout(t);
        }
    }, [txConfirmed, refetchAllowance, refetchBalance, resetApprove]);

    // ── Derived values ──
    const allowance = allowanceRaw !== undefined ? Number(formatUnits(allowanceRaw, 6)) : null;
    const balance = balanceRaw !== undefined ? Number(formatUnits(balanceRaw, 6)) : null;
    const isUnlimited = allowanceRaw !== undefined && allowanceRaw > parseUnits('999999999', 6);
    const hasAllowance = allowance !== null && allowance > 0;

    // ── Handlers ──
    function handleApprove(usdcAmount: number) {
        if (!escrowAddress || !approveWrite) return;
        setLastAction('approve');
        resetApprove();
        const amount = usdcAmount === -1 ? MAX_UINT256 : parseUnits(usdcAmount.toString(), 6);
        approveWrite({
            address: usdcAddress,
            abi: USDC_ABI_PARSED,
            functionName: 'approve',
            args: [escrowAddress, amount],
        });
    }

    function handleRevoke() {
        if (!escrowAddress || !approveWrite) return;
        setLastAction('revoke');
        resetApprove();
        approveWrite({
            address: usdcAddress,
            abi: USDC_ABI_PARSED,
            functionName: 'approve',
            args: [escrowAddress, BigInt(0)],
        });
    }

    function handleCustomApprove() {
        const amount = parseFloat(customAmount);
        if (isNaN(amount) || amount <= 0) return;
        handleApprove(amount);
        setCustomAmount('');
    }

    // ── Status display ──
    const isBusy = isApproving || isWaitingForTx;

    return (
        <Card>
            <CardHeader
                className="cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5 text-green-500" />
                        USDC Auto-Bid Allowance
                    </span>
                    <div className="flex items-center gap-2">
                        {hasAllowance && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-500">
                                {isUnlimited ? '∞ Approved' : `$${allowance?.toLocaleString(undefined, { maximumFractionDigits: 2 })} approved`}
                            </span>
                        )}
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                </CardTitle>
            </CardHeader>

            {isExpanded && (
                <CardContent className="space-y-5">
                    {/* Explainer */}
                    <p className="text-sm text-muted-foreground">
                        Approve USDC to the escrow contract so auto-bids can settle without your wallet.
                        You can close your browser after approving — the server handles bidding and settlement autonomously.
                    </p>

                    {!isConnected ? (
                        /* Wallet not connected state */
                        <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/40">
                            <Wallet className="h-5 w-5 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">
                                Connect your wallet to manage USDC allowance for auto-bidding.
                            </p>
                        </div>
                    ) : !escrowAddress ? (
                        /* No escrow configured */
                        <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                            <AlertCircle className="h-5 w-5 text-amber-500" />
                            <p className="text-sm text-amber-400">
                                Escrow contract not configured. Set <code className="text-xs bg-muted px-1 rounded">VITE_ESCROW_ADDRESS_BASE</code> in your environment.
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Balance & Allowance display */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 rounded-lg bg-muted/30 border border-border">
                                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">USDC Balance</p>
                                    <p className="text-lg font-bold">
                                        {isLoadingAllowance ? (
                                            <Loader2 className="h-4 w-4 animate-spin inline" />
                                        ) : balance !== null ? (
                                            `$${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                        ) : (
                                            '—'
                                        )}
                                    </p>
                                </div>
                                <div className={`p-3 rounded-lg border ${hasAllowance ? 'bg-green-500/5 border-green-500/20' : 'bg-muted/30 border-border'}`}>
                                    <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Approved for Escrow</p>
                                    <p className={`text-lg font-bold ${hasAllowance ? 'text-green-500' : ''}`}>
                                        {isLoadingAllowance ? (
                                            <Loader2 className="h-4 w-4 animate-spin inline" />
                                        ) : isUnlimited ? (
                                            '∞ Unlimited'
                                        ) : allowance !== null ? (
                                            `$${allowance.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                        ) : (
                                            '$0.00'
                                        )}
                                    </p>
                                </div>
                            </div>

                            {/* Approve presets */}
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                                    Set Allowance
                                </p>
                                <div className="grid grid-cols-4 gap-2">
                                    {PRESETS.map(({ label, value }) => (
                                        <Button
                                            key={label}
                                            variant="outline"
                                            size="sm"
                                            disabled={isBusy}
                                            onClick={() => handleApprove(value)}
                                            className="text-xs"
                                        >
                                            {isBusy && lastAction === 'approve' ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                label
                                            )}
                                        </Button>
                                    ))}
                                </div>

                                {/* Custom amount */}
                                <div className="flex gap-2 mt-2">
                                    <input
                                        type="number"
                                        placeholder="Custom USDC amount"
                                        value={customAmount}
                                        onChange={(e) => setCustomAmount(e.target.value)}
                                        className="flex-1 px-3 py-1.5 rounded-lg bg-muted/30 border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                        min={1}
                                        disabled={isBusy}
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleCustomApprove}
                                        disabled={isBusy || !customAmount}
                                    >
                                        <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                                        Approve
                                    </Button>
                                </div>
                            </div>

                            {/* Revoke */}
                            {hasAllowance && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleRevoke}
                                    disabled={isBusy}
                                    className="text-red-400 border-red-500/20 hover:bg-red-500/10 hover:text-red-300"
                                >
                                    {isBusy && lastAction === 'revoke' ? (
                                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                    ) : (
                                        <ShieldOff className="h-3.5 w-3.5 mr-1" />
                                    )}
                                    Revoke Allowance
                                </Button>
                            )}

                            {/* Tx status */}
                            {(isApproving || isWaitingForTx || txConfirmed || approveError) && (
                                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${approveError
                                    ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                    : txConfirmed
                                        ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                        : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                    }`}>
                                    {approveError ? (
                                        <>
                                            <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                            <span className="truncate">
                                                {(approveError as Error).message?.includes('User rejected')
                                                    ? 'Transaction rejected by user'
                                                    : `Error: ${(approveError as Error).message?.slice(0, 80)}`}
                                            </span>
                                        </>
                                    ) : txConfirmed ? (
                                        <>
                                            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                                            <span>
                                                {lastAction === 'revoke' ? 'Allowance revoked' : 'Allowance approved'} — auto-bids will use the escrow contract
                                            </span>
                                            {approveTxHash && (
                                                <a
                                                    href={`https://sepolia.basescan.org/tx/${approveTxHash}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="ml-auto flex-shrink-0"
                                                >
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                </a>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                                            <span>
                                                {isApproving ? 'Confirm in your wallet\u2026' : 'Waiting for confirmation\u2026'}
                                            </span>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Contract info */}
                            <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1">
                                <p><strong>USDC:</strong> <code className="text-[10px] bg-muted px-1 rounded">{usdcAddress}</code></p>
                                <p><strong>Escrow:</strong> <code className="text-[10px] bg-muted px-1 rounded">{escrowAddress || 'Not configured'}</code></p>
                                <p><strong>Network:</strong> {chainId === 84532 ? 'Base Sepolia' : 'Sepolia'}</p>
                                <p className="mt-2 leading-relaxed">
                                    Approving USDC lets the escrow contract debit your wallet when auto-bids win.
                                    You can revoke at any time. Only the escrow contract can spend — your tokens stay in your wallet until settlement.
                                </p>
                            </div>
                        </>
                    )}
                </CardContent>
            )}
        </Card>
    );
}

export default UsdcAllowanceCard;
