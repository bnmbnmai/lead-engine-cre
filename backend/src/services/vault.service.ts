/**
 * On-Chain Escrow Vault Service
 *
 * Proxies to PersonalEscrowVault.sol on Base Sepolia.
 * Source of truth: on-chain contract balances.
 * DB (Prisma EscrowVault / VaultTransaction) serves as a read cache + audit trail.
 *
 * Backend sponsors gas for lockForBid/settleBid/refundBid via DEPLOYER_PRIVATE_KEY.
 * Users sign deposit/withdraw from MetaMask (frontend calls contract directly).
 */

import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';
import { aceDevBus } from './ace.service';

// ── Config ──────────────────────────────────

const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
const VAULT_ADDRESS = process.env.VAULT_ADDRESS_BASE_SEPOLIA || '';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const CONVENIENCE_FEE_USD = 1.0;

// ── ABI (minimal — only the functions we call from backend) ──

const VAULT_ABI = [
    'function balanceOf(address user) view returns (uint256)',
    'function lockedBalances(address user) view returns (uint256)',
    'function totalBalanceOf(address user) view returns (uint256)',
    'function canBid(address user, uint256 bidAmount) view returns (bool)',
    'function lockForBid(address user, uint256 bidAmount) returns (uint256)',
    'function settleBid(uint256 lockId, address seller) external',
    'function refundBid(uint256 lockId) external',
    'function verifyReserves() returns (bool)',
    'function lastPorCheck() view returns (uint256)',
    'function lastPorSolvent() view returns (bool)',
    'function activeLockCount() view returns (uint256)',
    'function bidLocks(uint256 lockId) view returns (address user, uint256 amount, uint256 fee, uint256 lockedAt, bool settled)',
    'function totalDeposited() view returns (uint256)',
    'function totalWithdrawn() view returns (uint256)',
    'event Deposited(address indexed user, uint256 amount, uint256 newBalance)',
    'event Withdrawn(address indexed user, uint256 amount, uint256 newBalance)',
    'event BidLocked(uint256 indexed lockId, address indexed user, uint256 bidAmount, uint256 fee)',
    'event BidSettled(uint256 indexed lockId, address indexed winner, address indexed seller, uint256 amount, uint256 fee)',
    'event BidRefunded(uint256 indexed lockId, address indexed user, uint256 totalRefunded)',
    'event ReservesVerified(uint256 contractBalance, uint256 claimedTotal, bool solvent, uint256 timestamp)',
];

// ── Provider / Signer ──────────────────────

function getProvider() {
    return new ethers.JsonRpcProvider(RPC_URL);
}

function getSigner() {
    if (!DEPLOYER_KEY) throw new Error('DEPLOYER_PRIVATE_KEY not set');
    return new ethers.Wallet(DEPLOYER_KEY, getProvider());
}

function getVaultContract(signerOrProvider?: ethers.Signer | ethers.Provider) {
    if (!VAULT_ADDRESS) throw new Error('VAULT_ADDRESS_BASE_SEPOLIA not set');
    return new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signerOrProvider || getProvider());
}

function getSignedVaultContract() {
    return getVaultContract(getSigner());
}

// ── Helpers ──────────────────────────────────

function usdcToUnits(amount: number): bigint {
    return BigInt(Math.round(amount * 1e6));
}

function unitsToUsdc(units: bigint): number {
    return Number(units) / 1e6;
}

async function getOrCreateVault(userId: string) {
    return prisma.escrowVault.upsert({
        where: { userId },
        create: { userId },
        update: {},
    });
}

// ── Public API ──────────────────────────────

/**
 * Get vault info: on-chain balance + DB transaction history.
 */
export async function getVaultInfo(userId: string) {
    const vault = await getOrCreateVault(userId);
    const transactions = await prisma.vaultTransaction.findMany({
        where: { vaultId: vault.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
    });

    // Read on-chain balance if contract is configured
    let onChainBalance = Number(vault.balance);
    let onChainLocked = 0;
    let porSolvent = true;
    let porLastCheck = 0;

    try {
        if (VAULT_ADDRESS) {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (user?.walletAddress) {
                const contract = getVaultContract();
                const [bal, locked, solvent, lastCheck] = await Promise.all([
                    contract.balanceOf(user.walletAddress),
                    contract.lockedBalances(user.walletAddress),
                    contract.lastPorSolvent(),
                    contract.lastPorCheck(),
                ]);
                onChainBalance = unitsToUsdc(bal);
                onChainLocked = unitsToUsdc(locked);
                porSolvent = solvent;
                porLastCheck = Number(lastCheck);
            }
        }
    } catch (err) {
        console.warn('[VaultService] On-chain read failed, using DB cache:', (err as Error).message);
    }

    return {
        balance: onChainBalance,
        lockedBalance: onChainLocked,
        totalDeposited: Number(vault.totalDeposited),
        totalSpent: Number(vault.totalSpent),
        totalRefunded: Number(vault.totalRefunded),
        porSolvent,
        porLastCheck,
        contractAddress: VAULT_ADDRESS || null,
        transactions: transactions.map((t: any) => ({
            id: t.id,
            type: t.type,
            amount: Number(t.amount),
            reference: t.reference,
            note: t.note,
            createdAt: t.createdAt,
        })),
    };
}

/**
 * Cache a deposit event in DB (on-chain deposit is done client-side via MetaMask).
 * Called by the backend when it detects a Deposited event or the frontend confirms.
 */
export async function recordDeposit(userId: string, amount: number, txHash: string) {
    if (amount <= 0) throw new Error('Amount must be positive');
    if (!txHash) throw new Error('txHash required for on-chain deposit');

    const vault = await getOrCreateVault(userId);

    const [updatedVault] = await prisma.$transaction([
        prisma.escrowVault.update({
            where: { id: vault.id },
            data: {
                balance: { increment: amount },
                totalDeposited: { increment: amount },
            },
        }),
        prisma.vaultTransaction.create({
            data: {
                vaultId: vault.id,
                type: 'DEPOSIT',
                amount,
                reference: txHash,
                note: `On-chain deposit $${amount.toFixed(2)} USDC`,
            },
        }),
    ]);

    aceDevBus.emit('ace:dev-log', {
        ts: new Date().toISOString(),
        action: 'vault:deposit',
        userId,
        amount: `$${amount.toFixed(2)}`,
        txHash,
        source: 'on-chain',
    });

    return { success: true, balance: Number(updatedVault.balance) };
}

/**
 * Lock funds for a bid on-chain (backend-signed, gas-sponsored).
 * Returns the lockId from the contract.
 */
export async function lockForBid(
    walletAddress: string,
    bidAmount: number,
    userId: string,
    reference: string,
): Promise<{ success: boolean; lockId?: number; txHash?: string; error?: string }> {
    try {
        const contract = getSignedVaultContract();
        const bidAmountUnits = usdcToUnits(bidAmount);

        // Pre-check on-chain
        const canBidResult = await contract.canBid(walletAddress, bidAmountUnits);
        if (!canBidResult) {
            return { success: false, error: 'Insufficient on-chain vault balance' };
        }

        const tx = await contract.lockForBid(walletAddress, bidAmountUnits);
        const receipt = await tx.wait();

        // Parse lockId from event
        const lockEvent = receipt.logs.find((log: any) => {
            try {
                return contract.interface.parseLog(log)?.name === 'BidLocked';
            } catch { return false; }
        });
        const parsed = lockEvent ? contract.interface.parseLog(lockEvent) : null;
        const lockId = parsed ? Number(parsed.args[0]) : 0;

        // Cache in DB
        const vault = await getOrCreateVault(userId);
        const totalDeducted = bidAmount + CONVENIENCE_FEE_USD;
        await prisma.$transaction([
            prisma.escrowVault.update({
                where: { id: vault.id },
                data: {
                    balance: { decrement: totalDeducted },
                    totalSpent: { increment: totalDeducted },
                },
            }),
            prisma.vaultTransaction.create({
                data: {
                    vaultId: vault.id,
                    type: 'DEDUCT',
                    amount: totalDeducted,
                    reference,
                    note: `Bid lock #${lockId}: $${bidAmount.toFixed(2)} + $1 fee (on-chain)`,
                },
            }),
        ]);

        aceDevBus.emit('ace:dev-log', {
            ts: new Date().toISOString(),
            action: 'vault:lock-bid',
            userId,
            walletAddress,
            bidAmount: `$${bidAmount.toFixed(2)}`,
            lockId,
            txHash: tx.hash,
            source: 'on-chain',
        });

        return { success: true, lockId, txHash: tx.hash };
    } catch (err) {
        console.error('[VaultService] lockForBid failed:', err);
        return { success: false, error: (err as Error).message };
    }
}

/**
 * Settle a winning bid on-chain: bid amount → seller, fee → platform.
 */
export async function settleBid(
    lockId: number,
    sellerAddress: string,
    userId: string,
    reference: string,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
        const contract = getSignedVaultContract();
        const tx = await contract.settleBid(lockId, sellerAddress);
        const receipt = await tx.wait();

        // Parse settlement amount from BidSettled event
        let settledAmount = 0;
        let settledFee = 0;
        const settleEvent = receipt.logs.find((log: any) => {
            try {
                return contract.interface.parseLog(log)?.name === 'BidSettled';
            } catch { return false; }
        });
        if (settleEvent) {
            const parsed = contract.interface.parseLog(settleEvent);
            if (parsed) {
                settledAmount = unitsToUsdc(parsed.args[3]); // amount
                settledFee = unitsToUsdc(parsed.args[4]); // fee
            }
        }

        // Update DB cache: record the settlement transaction
        try {
            const vault = await getOrCreateVault(userId);
            await prisma.vaultTransaction.create({
                data: {
                    vaultId: vault.id,
                    type: 'SETTLE',
                    amount: settledAmount + settledFee,
                    reference,
                    note: `Bid settled #${lockId}: $${settledAmount.toFixed(2)} to seller + $${settledFee.toFixed(2)} fee (on-chain)`,
                },
            });
        } catch (dbErr) {
            // Non-blocking: on-chain settlement succeeded, DB cache is secondary
            console.warn('[VaultService] settleBid DB cache update failed:', (dbErr as Error).message);
        }

        aceDevBus.emit('ace:dev-log', {
            ts: new Date().toISOString(),
            action: 'vault:settle-bid',
            userId,
            lockId,
            sellerAddress,
            settledAmount,
            settledFee,
            txHash: tx.hash,
            reference,
            source: 'on-chain',
        });

        return { success: true, txHash: tx.hash };
    } catch (err) {
        console.error('[VaultService] settleBid failed:', err);
        return { success: false, error: (err as Error).message };
    }
}

/**
 * Refund a losing bid on-chain: locked funds → user's vault balance.
 */
export async function refundBid(
    lockId: number,
    userId: string,
    reference: string,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
        const contract = getSignedVaultContract();
        const tx = await contract.refundBid(lockId);
        const receipt = await tx.wait();

        // Parse refund amount from BidRefunded event (authoritative source)
        let refundAmount = 0;
        const refundEvent = receipt.logs.find((log: any) => {
            try {
                return contract.interface.parseLog(log)?.name === 'BidRefunded';
            } catch { return false; }
        });
        if (refundEvent) {
            const parsed = contract.interface.parseLog(refundEvent);
            if (parsed) {
                refundAmount = unitsToUsdc(parsed.args[2]); // totalRefunded
            }
        }

        // Fallback: read from on-chain lock if event parsing failed
        if (refundAmount === 0) {
            try {
                const lock = await contract.bidLocks(lockId);
                refundAmount = unitsToUsdc(lock.amount + lock.fee);
            } catch { /* swallow — amount will be 0 in DB record */ }
        }

        // Update DB cache
        const vault = await getOrCreateVault(userId);

        await prisma.$transaction([
            prisma.escrowVault.update({
                where: { id: vault.id },
                data: {
                    balance: { increment: refundAmount },
                    totalRefunded: { increment: refundAmount },
                },
            }),
            prisma.vaultTransaction.create({
                data: {
                    vaultId: vault.id,
                    type: 'REFUND',
                    amount: refundAmount,
                    reference,
                    note: `Bid refund #${lockId}: $${refundAmount.toFixed(2)} (on-chain)`,
                },
            }),
        ]);

        aceDevBus.emit('ace:dev-log', {
            ts: new Date().toISOString(),
            action: 'vault:refund-bid',
            userId,
            lockId,
            refundAmount: `$${refundAmount.toFixed(2)}`,
            txHash: tx.hash,
            source: 'on-chain',
        });

        return { success: true, txHash: tx.hash };
    } catch (err) {
        console.error('[VaultService] refundBid failed:', err);
        return { success: false, error: (err as Error).message };
    }
}

/**
 * Check if user has enough on-chain vault balance for a bid (amount + $1 fee).
 */
export async function checkBidBalance(
    walletAddress: string,
    bidAmount: number,
): Promise<{ ok: boolean; balance: number; required: number }> {
    const required = bidAmount + CONVENIENCE_FEE_USD;

    try {
        if (VAULT_ADDRESS && walletAddress) {
            const contract = getVaultContract();
            const [canBidResult, balance] = await Promise.all([
                contract.canBid(walletAddress, usdcToUnits(bidAmount)),
                contract.balanceOf(walletAddress),
            ]);
            return { ok: canBidResult, balance: unitsToUsdc(balance), required };
        }
    } catch (err) {
        console.warn('[VaultService] On-chain balance check failed:', (err as Error).message);
    }

    return { ok: false, balance: 0, required };
}

/**
 * Verify Proof of Reserves on-chain.
 */
export async function verifyReserves(): Promise<{ solvent: boolean; txHash?: string }> {
    try {
        const contract = getSignedVaultContract();
        const tx = await contract.verifyReserves();
        const receipt = await tx.wait();

        const porEvent = receipt.logs.find((log: any) => {
            try {
                return contract.interface.parseLog(log)?.name === 'ReservesVerified';
            } catch { return false; }
        });
        const parsed = porEvent ? contract.interface.parseLog(porEvent) : null;
        const solvent = parsed ? parsed.args[2] : true;

        aceDevBus.emit('ace:dev-log', {
            ts: new Date().toISOString(),
            action: 'vault:por-verify',
            solvent,
            txHash: tx.hash,
            source: 'on-chain',
        });

        return { solvent, txHash: tx.hash };
    } catch (err) {
        console.error('[VaultService] verifyReserves failed:', err);
        return { solvent: true };
    }
}

/**
 * Get contract address for frontend.
 */
export function getContractAddress(): string {
    return VAULT_ADDRESS;
}

/**
 * Get the ABI for the vault contract (for frontend wagmi integration).
 */
export function getContractAbi() {
    return VAULT_ABI;
}

export const VAULT_FEE = CONVENIENCE_FEE_USD;

/**
 * Legacy compatibility: check bid balance by userId (looks up wallet).
 */
export async function checkBidBalanceByUserId(
    userId: string,
    bidAmount: number,
): Promise<{ ok: boolean; balance: number; required: number }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.walletAddress) {
        return { ok: false, balance: 0, required: bidAmount + CONVENIENCE_FEE_USD };
    }
    return checkBidBalance(user.walletAddress, bidAmount);
}
