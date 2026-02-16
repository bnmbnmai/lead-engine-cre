import { useState, useCallback } from 'react';
import { useAccount, useSendTransaction } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { wagmiConfig } from '@/lib/wagmi';
import { api } from '@/lib/api';

/**
 * useEscrow — Client-side signing flow for escrow creation.
 *
 * Steps:
 * 1. Calls backend to get unsigned tx calldata (prepareEscrow).
 * 2. Sends USDC approve() via MetaMask.
 * 3. Sends createEscrow() via MetaMask.
 * 4. Calls backend to confirm the on-chain tx (confirmEscrow).
 */

export type EscrowStep = 'idle' | 'preparing' | 'approving' | 'creating' | 'confirming' | 'done' | 'error';

interface UseEscrowResult {
    step: EscrowStep;
    error: string | null;
    escrowId: string | null;
    txHash: string | null;
    fundEscrow: (leadId: string) => Promise<void>;
    reset: () => void;
}

export function useEscrow(): UseEscrowResult {
    const { address, isConnected } = useAccount();
    const { sendTransactionAsync } = useSendTransaction();

    const [step, setStep] = useState<EscrowStep>('idle');
    const [error, setError] = useState<string | null>(null);
    const [escrowId, setEscrowId] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);

    const reset = useCallback(() => {
        setStep('idle');
        setError(null);
        setEscrowId(null);
        setTxHash(null);
    }, []);

    const fundEscrow = useCallback(async (leadId: string) => {
        if (!isConnected || !address) {
            setError('Wallet not connected');
            setStep('error');
            return;
        }

        setStep('preparing');
        setError(null);
        setEscrowId(null);
        setTxHash(null);

        try {
            // 1. Get unsigned tx data from backend
            const { data: txData, error: prepError } = await api.prepareEscrow(leadId);
            if (prepError || !txData) {
                throw new Error(prepError?.message || 'Failed to prepare escrow transaction');
            }

            // 2. USDC approve — MetaMask prompt #1
            setStep('approving');
            const approveHash = await sendTransactionAsync({
                to: txData.usdcContractAddress as `0x${string}`,
                data: txData.approveCalldata as `0x${string}`,
                chainId: txData.chainId,
            });

            // Wait for approval to be confirmed on-chain
            await waitForTransactionReceipt(wagmiConfig, {
                hash: approveHash,
                confirmations: 1,
            });

            // 3. Create escrow — MetaMask prompt #2
            setStep('creating');
            const escrowHash = await sendTransactionAsync({
                to: txData.escrowContractAddress as `0x${string}`,
                data: txData.createEscrowCalldata as `0x${string}`,
                chainId: txData.chainId,
            });

            setTxHash(escrowHash);

            // Wait for escrow tx to be confirmed on-chain
            await waitForTransactionReceipt(wagmiConfig, {
                hash: escrowHash,
                confirmations: 1,
            });

            // 4. Confirm with backend
            setStep('confirming');
            const { data: confirmData, error: confirmError } = await api.confirmEscrow(
                leadId,
                escrowHash,
            );

            if (confirmError || !confirmData?.success) {
                throw new Error(confirmError?.message || 'Failed to confirm escrow on backend');
            }

            setEscrowId(confirmData.escrowId);
            setStep('done');
        } catch (err: any) {
            console.error('[useEscrow] Error:', err);
            // User rejected the MetaMask prompt
            if (err.code === 4001 || err.message?.includes('rejected') || err.message?.includes('denied')) {
                setError('Transaction rejected — please try again');
            } else {
                setError(err.shortMessage || err.message || 'Escrow creation failed');
            }
            setStep('error');
        }
    }, [address, isConnected, sendTransactionAsync]);

    return { step, error, escrowId, txHash, fundEscrow, reset };
}

export default useEscrow;
