import { useState, useCallback, useEffect } from 'react';
import { useAccount, useSendTransaction, usePublicClient } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { baseSepolia } from 'wagmi/chains';
import { erc20Abi, encodeFunctionData, parseUnits } from 'viem';
import { wagmiConfig, CONTRACT_ADDRESSES } from '@/lib/wagmi';
import { api } from '@/lib/api';
import { toast } from '@/hooks/useToast';

/**
 * useVault — On-chain PersonalEscrowVault deposit/withdraw for the BuyerDashboard.
 *
 * Deposit flow (mirrors useEscrow.ts pattern):
 *   1. Read current USDC allowance; skip approve if already sufficient.
 *   2. sendTransaction → USDC.approve(vaultAddress, amount)  — MetaMask prompt #1 (if needed)
 *   3. sendTransaction → vault.deposit(amount)               — MetaMask prompt #2 (or #1)
 *   4. waitForTransactionReceipt (confirmations: 1)
 *   5. api.depositVault(amount, realTxHash) → records in Prisma cache
 *
 * Withdraw flow:
 *   1. sendTransaction → vault.withdraw(amount)              — MetaMask prompt #1
 *   2. waitForTransactionReceipt (confirmations: 1)
 *   3. api.withdrawVault(amount, realTxHash) → records in Prisma cache
 *
 * Balance: read on-chain via publicClient.readContract(balanceOf) after each action.
 * Activity: fetched from backend Prisma cache (GET /api/v1/buyer/vault).
 */

// ── Minimal ABI for vault interactions ──────────────────────────────────────

const VAULT_ABI = [
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'user', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        name: 'deposit',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'withdraw',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: [],
    },
] as const;

// ── Gas limits (mirrors useEscrow.ts constants) ───────────────────────────────

const APPROVE_GAS_FALLBACK = 80_000n;
const VAULT_GAS_FALLBACK = 150_000n;
const GAS_BUFFER_MULTIPLIER = 150n; // 1.5× = 50% buffer
const GAS_BUFFER_DIVISOR = 100n;

// ── Contract addresses ────────────────────────────────────────────────────────

const VAULT_ADDRESS = CONTRACT_ADDRESSES.baseSepolia.vault as `0x${string}`;
const USDC_ADDRESS = CONTRACT_ADDRESSES.baseSepolia.usdc as `0x${string}`;

// ── USDC precision helpers ────────────────────────────────────────────────────

function usdcToUnits(amount: number): bigint {
    return parseUnits(amount.toFixed(6), 6);
}

function unitsToUsdc(units: bigint): number {
    return Number(units) / 1e6;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type VaultStep =
    | 'idle'
    | 'approving'
    | 'depositing'
    | 'withdrawing'
    | 'confirming'
    | 'done'
    | 'error';

export interface UseVaultResult {
    vaultBalance: number;
    vaultTxs: any[];
    depositLoading: boolean;
    withdrawLoading: boolean;
    depositAmount: string;
    setDepositAmount: (v: string) => void;
    step: VaultStep;
    deposit: (amount: number) => Promise<void>;
    withdraw: (amount: number) => Promise<void>;
    refreshVault: () => void;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useVault(): UseVaultResult {
    const { address, isConnected } = useAccount();
    const { sendTransactionAsync } = useSendTransaction();
    const publicClient = usePublicClient();

    const [vaultBalance, setVaultBalance] = useState(0);
    const [vaultTxs, setVaultTxs] = useState<any[]>([]);
    const [depositAmount, setDepositAmount] = useState('');
    const [depositLoading, setDepositLoading] = useState(false);
    const [withdrawLoading, setWithdrawLoading] = useState(false);
    const [step, setStep] = useState<VaultStep>('idle');

    // ── Gas estimation with 50% buffer (identical to useEscrow.ts) ────────────

    const estimateGasWithBuffer = useCallback(
        async (
            txParams: { to: `0x${string}`; data: `0x${string}`; account: `0x${string}` },
            fallback: bigint,
            label: string,
        ): Promise<bigint> => {
            try {
                if (!publicClient) throw new Error('No public client');
                const estimated = await publicClient.estimateGas(txParams);
                const buffered = (estimated * GAS_BUFFER_MULTIPLIER) / GAS_BUFFER_DIVISOR;
                console.log(`[useVault] ${label} estimateGas=${estimated}, buffered=${buffered}`);
                return buffered;
            } catch (err) {
                console.warn(`[useVault] ${label} estimateGas failed, fallback=${fallback}`, err);
                return fallback;
            }
        },
        [publicClient],
    );

    // ── Refresh: DB activity log from backend ─────────────────────────────────

    const refreshVault = useCallback(() => {
        api.getVault()
            .then(({ data }) => {
                if (data) {
                    setVaultBalance(data.balance);
                    setVaultTxs(data.transactions?.slice(0, 5) || []);
                }
            })
            .catch(() => { });
    }, []);

    // ── On-chain balance read (overrides DB cache when connected) ─────────────

    const refreshOnChainBalance = useCallback(async () => {
        if (!address || !publicClient || !VAULT_ADDRESS) return;
        try {
            const bal = await publicClient.readContract({
                address: VAULT_ADDRESS,
                abi: VAULT_ABI,
                functionName: 'balanceOf',
                args: [address],
            });
            setVaultBalance(unitsToUsdc(bal as bigint));
        } catch (err) {
            console.warn('[useVault] On-chain balanceOf failed, keeping backend value', err);
        }
    }, [address, publicClient]);

    // ── Initial load ──────────────────────────────────────────────────────────

    useEffect(() => {
        refreshVault();
    }, [refreshVault]);

    useEffect(() => {
        if (address) refreshOnChainBalance();
    }, [address, refreshOnChainBalance]);

    // ── Deposit ───────────────────────────────────────────────────────────────

    const deposit = useCallback(
        async (amount: number) => {
            if (!isConnected || !address) {
                toast({ type: 'error', title: 'Wallet Not Connected', description: 'Please connect your wallet to deposit' });
                return;
            }
            if (!VAULT_ADDRESS) {
                toast({ type: 'error', title: 'Vault Not Configured', description: 'Vault contract address not set' });
                return;
            }
            if (amount <= 0) return;

            setDepositLoading(true);
            setStep('idle');

            try {
                const amountUnits = usdcToUnits(amount);

                // 1. Check USDC allowance — skip approve if already sufficient
                let needsApproval = true;
                if (publicClient) {
                    try {
                        const currentAllowance = await publicClient.readContract({
                            address: USDC_ADDRESS,
                            abi: erc20Abi,
                            functionName: 'allowance',
                            args: [address, VAULT_ADDRESS],
                        });
                        needsApproval = currentAllowance < amountUnits;
                        console.log(`[useVault] USDC allowance: current=${currentAllowance}, needed=${amountUnits}, needsApproval=${needsApproval}`);
                    } catch (err) {
                        console.warn('[useVault] Allowance check failed, will approve anyway', err);
                    }
                }

                // 2. Approve USDC → vault (MetaMask prompt #1, if needed)
                if (needsApproval) {
                    setStep('approving');
                    const approveData = encodeFunctionData({
                        abi: erc20Abi,
                        functionName: 'approve',
                        args: [VAULT_ADDRESS, amountUnits],
                    });
                    const approveGas = await estimateGasWithBuffer(
                        { to: USDC_ADDRESS, data: approveData, account: address },
                        APPROVE_GAS_FALLBACK,
                        'USDC.approve()',
                    );
                    const approveHash = await sendTransactionAsync({
                        to: USDC_ADDRESS,
                        data: approveData,
                        chainId: baseSepolia.id,
                        gas: approveGas,
                    });
                    await waitForTransactionReceipt(wagmiConfig, { hash: approveHash, confirmations: 1 });
                    console.log(`[useVault] USDC approve confirmed: ${approveHash}`);
                } else {
                    console.log('[useVault] Sufficient USDC allowance — skipping approve()');
                }

                // 3. vault.deposit(amount) (MetaMask prompt #2, or #1 if pre-approved)
                setStep('depositing');
                const depositData = encodeFunctionData({
                    abi: VAULT_ABI,
                    functionName: 'deposit',
                    args: [amountUnits],
                });
                const depositGas = await estimateGasWithBuffer(
                    { to: VAULT_ADDRESS, data: depositData, account: address },
                    VAULT_GAS_FALLBACK,
                    'vault.deposit()',
                );
                const depositHash = await sendTransactionAsync({
                    to: VAULT_ADDRESS,
                    data: depositData,
                    chainId: baseSepolia.id,
                    gas: depositGas,
                });
                await waitForTransactionReceipt(wagmiConfig, { hash: depositHash, confirmations: 1 });
                console.log(`[useVault] vault.deposit confirmed: ${depositHash}`);

                // 4. Record real txHash in backend Prisma cache
                setStep('confirming');
                const { data: recordData } = await api.depositVault(amount, depositHash);
                if (recordData?.success) {
                    // Optimistic update — RPC may be stale for ~60s after confirmation;
                    // immediately reflect the known deposit amount without waiting for a re-read.
                    setVaultBalance(prev => prev + amount);
                    setDepositAmount('');
                    toast({ type: 'success', title: 'Vault Funded', description: `Deposited $${amount.toFixed(2)} USDC` });
                    // Refresh activity log
                    api.getVault().then(({ data: d }) => d && setVaultTxs(d.transactions?.slice(0, 5) || []));
                }

                // Background on-chain confirm — delayed 10s so stale RPC doesn't overwrite optimistic balance.
                // Base Sepolia balanceOf can return 0 for ~60s post-deposit-confirm.
                setTimeout(() => refreshOnChainBalance().catch(() => { }), 10_000);
                setStep('done');
            } catch (err: any) {
                console.error('[useVault] deposit error:', err);
                if (err.code === 4001 || err.message?.includes('rejected') || err.message?.includes('denied')) {
                    toast({ type: 'error', title: 'Deposit Cancelled', description: 'Transaction rejected in wallet' });
                } else {
                    toast({ type: 'error', title: 'Deposit Failed', description: err.shortMessage || err.message || 'Failed to deposit USDC' });
                }
                setStep('error');
            } finally {
                setDepositLoading(false);
            }
        },
        [address, isConnected, sendTransactionAsync, estimateGasWithBuffer, publicClient, refreshOnChainBalance],
    );

    // ── Withdraw ──────────────────────────────────────────────────────────────

    const withdraw = useCallback(
        async (amount: number) => {
            if (!isConnected || !address) {
                toast({ type: 'error', title: 'Wallet Not Connected', description: 'Please connect your wallet to withdraw' });
                return;
            }
            if (!VAULT_ADDRESS) {
                toast({ type: 'error', title: 'Vault Not Configured', description: 'Vault contract address not set' });
                return;
            }
            if (amount <= 0) {
                toast({ type: 'error', title: 'Nothing to Withdraw', description: 'Your vault balance is zero' });
                return;
            }

            setWithdrawLoading(true);
            setStep('withdrawing');

            try {
                const amountUnits = usdcToUnits(amount);

                // 1. vault.withdraw(amount) — MetaMask prompt #1
                const withdrawData = encodeFunctionData({
                    abi: VAULT_ABI,
                    functionName: 'withdraw',
                    args: [amountUnits],
                });
                const withdrawGas = await estimateGasWithBuffer(
                    { to: VAULT_ADDRESS, data: withdrawData, account: address },
                    VAULT_GAS_FALLBACK,
                    'vault.withdraw()',
                );
                const withdrawHash = await sendTransactionAsync({
                    to: VAULT_ADDRESS,
                    data: withdrawData,
                    chainId: baseSepolia.id,
                    gas: withdrawGas,
                });
                await waitForTransactionReceipt(wagmiConfig, { hash: withdrawHash, confirmations: 1 });
                console.log(`[useVault] vault.withdraw confirmed: ${withdrawHash}`);

                // 2. Record real txHash in backend Prisma cache
                setStep('confirming');
                const { data: recordData, error: recordError } = await api.withdrawVault(amount, withdrawHash);
                if (recordError) {
                    // On-chain tx succeeded — backend record failure is non-fatal
                    console.warn('[useVault] Backend withdraw record failed (non-fatal):', recordError);
                    toast({ type: 'error', title: 'Record Warning', description: 'On-chain withdrawal succeeded but backend record failed' });
                } else if (recordData?.success) {
                    // Optimistic update — immediately clear the withdrawn amount
                    setVaultBalance(prev => Math.max(0, prev - amount));
                    toast({ type: 'success', title: 'Withdrawn', description: `Withdrew $${amount.toFixed(2)} USDC from vault` });
                    api.getVault().then(({ data: d }) => d && setVaultTxs(d.transactions?.slice(0, 5) || []));
                }

                // Background on-chain confirm — delayed 10s so stale RPC doesn't overwrite optimistic balance.
                setTimeout(() => refreshOnChainBalance().catch(() => { }), 10_000);
                setStep('done');
            } catch (err: any) {
                console.error('[useVault] withdraw error:', err);
                if (err.code === 4001 || err.message?.includes('rejected') || err.message?.includes('denied')) {
                    toast({ type: 'error', title: 'Withdraw Cancelled', description: 'Transaction rejected in wallet' });
                } else {
                    toast({ type: 'error', title: 'Withdraw Failed', description: err.shortMessage || err.message || 'Failed to withdraw' });
                }
                setStep('error');
            } finally {
                setWithdrawLoading(false);
            }
        },
        [address, isConnected, sendTransactionAsync, estimateGasWithBuffer, publicClient, refreshOnChainBalance],
    );

    return {
        vaultBalance,
        vaultTxs,
        depositLoading,
        withdrawLoading,
        depositAmount,
        setDepositAmount,
        step,
        deposit,
        withdraw,
        refreshVault,
    };
}

export default useVault;
