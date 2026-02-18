/**
 * Escrow Vault Service
 *
 * Per-user USDC pool tracked in the database.
 * Deposits/withdrawals backed by existing RTBEscrow contract on-chain.
 * Vault balance checked before bids/bounties, deducted on win.
 */

import { prisma } from '../lib/prisma';
import { aceDevBus } from './ace.service';

const CONVENIENCE_FEE_USD = 1.0;

// ── Helpers ──────────────────────────────────

async function getOrCreateVault(userId: string) {
    return prisma.escrowVault.upsert({
        where: { userId },
        create: { userId },
        update: {},
    });
}

// ── Public API ──────────────────────────────

/**
 * Get vault balance and recent transactions.
 */
export async function getVaultInfo(userId: string) {
    const vault = await getOrCreateVault(userId);
    const transactions = await prisma.vaultTransaction.findMany({
        where: { vaultId: vault.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
    });
    return {
        balance: Number(vault.balance),
        totalDeposited: Number(vault.totalDeposited),
        totalSpent: Number(vault.totalSpent),
        totalRefunded: Number(vault.totalRefunded),
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
 * Deposit USDC into vault.
 */
export async function deposit(userId: string, amount: number, txHash?: string) {
    if (amount <= 0) throw new Error('Amount must be positive');

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
                reference: txHash || null,
                note: `Deposited $${amount.toFixed(2)} USDC`,
            },
        }),
    ]);

    aceDevBus.emit('ace:dev-log', {
        ts: new Date().toISOString(),
        action: 'vault:deposit',
        userId,
        amount: `$${amount.toFixed(2)}`,
        newBalance: `$${Number(updatedVault.balance).toFixed(2)}`,
        txHash,
    });

    return { success: true, balance: Number(updatedVault.balance) };
}

/**
 * Deduct from vault (bid won, bounty matched, etc.).
 */
export async function deduct(userId: string, amount: number, reference: string, note?: string) {
    if (amount <= 0) throw new Error('Amount must be positive');

    const vault = await getOrCreateVault(userId);
    const currentBalance = Number(vault.balance);

    if (currentBalance < amount) {
        return { success: false, error: `Insufficient vault balance: $${currentBalance.toFixed(2)} < $${amount.toFixed(2)}` };
    }

    const [updatedVault] = await prisma.$transaction([
        prisma.escrowVault.update({
            where: { id: vault.id },
            data: {
                balance: { decrement: amount },
                totalSpent: { increment: amount },
            },
        }),
        prisma.vaultTransaction.create({
            data: {
                vaultId: vault.id,
                type: 'DEDUCT',
                amount,
                reference,
                note: note || `Deducted $${amount.toFixed(2)} USDC`,
            },
        }),
    ]);

    aceDevBus.emit('ace:dev-log', {
        ts: new Date().toISOString(),
        action: 'vault:deduct',
        userId,
        amount: `$${amount.toFixed(2)}`,
        reference,
        newBalance: `$${Number(updatedVault.balance).toFixed(2)}`,
    });

    return { success: true, balance: Number(updatedVault.balance) };
}

/**
 * Charge $1 convenience fee.
 */
export async function chargeFee(userId: string, reference: string) {
    const vault = await getOrCreateVault(userId);
    const currentBalance = Number(vault.balance);

    if (currentBalance < CONVENIENCE_FEE_USD) {
        return { success: false, error: `Insufficient vault balance for $${CONVENIENCE_FEE_USD} fee` };
    }

    const [updatedVault] = await prisma.$transaction([
        prisma.escrowVault.update({
            where: { id: vault.id },
            data: {
                balance: { decrement: CONVENIENCE_FEE_USD },
                totalSpent: { increment: CONVENIENCE_FEE_USD },
            },
        }),
        prisma.vaultTransaction.create({
            data: {
                vaultId: vault.id,
                type: 'FEE',
                amount: CONVENIENCE_FEE_USD,
                reference,
                note: `Convenience fee $${CONVENIENCE_FEE_USD.toFixed(2)}`,
            },
        }),
    ]);

    aceDevBus.emit('ace:dev-log', {
        ts: new Date().toISOString(),
        action: 'vault:fee',
        userId,
        fee: `$${CONVENIENCE_FEE_USD}`,
        reference,
    });

    return { success: true, balance: Number(updatedVault.balance) };
}

/**
 * Refund to vault (bid lost, bounty unmatched).
 */
export async function refund(userId: string, amount: number, reference: string, note?: string) {
    if (amount <= 0) return { success: true, balance: 0 };

    const vault = await getOrCreateVault(userId);

    const [updatedVault] = await prisma.$transaction([
        prisma.escrowVault.update({
            where: { id: vault.id },
            data: {
                balance: { increment: amount },
                totalRefunded: { increment: amount },
            },
        }),
        prisma.vaultTransaction.create({
            data: {
                vaultId: vault.id,
                type: 'REFUND',
                amount,
                reference,
                note: note || `Refunded $${amount.toFixed(2)} USDC`,
            },
        }),
    ]);

    aceDevBus.emit('ace:dev-log', {
        ts: new Date().toISOString(),
        action: 'vault:refund',
        userId,
        amount: `$${amount.toFixed(2)}`,
        reference,
        newBalance: `$${Number(updatedVault.balance).toFixed(2)}`,
    });

    return { success: true, balance: Number(updatedVault.balance) };
}

/**
 * Withdraw USDC from vault back to wallet.
 */
export async function withdraw(userId: string, amount: number) {
    if (amount <= 0) throw new Error('Amount must be positive');

    const vault = await getOrCreateVault(userId);
    const currentBalance = Number(vault.balance);

    if (currentBalance < amount) {
        return { success: false, error: `Insufficient balance: $${currentBalance.toFixed(2)} < $${amount.toFixed(2)}` };
    }

    const [updatedVault] = await prisma.$transaction([
        prisma.escrowVault.update({
            where: { id: vault.id },
            data: {
                balance: { decrement: amount },
            },
        }),
        prisma.vaultTransaction.create({
            data: {
                vaultId: vault.id,
                type: 'WITHDRAW',
                amount,
                note: `Withdrew $${amount.toFixed(2)} USDC to wallet`,
            },
        }),
    ]);

    aceDevBus.emit('ace:dev-log', {
        ts: new Date().toISOString(),
        action: 'vault:withdraw',
        userId,
        amount: `$${amount.toFixed(2)}`,
        newBalance: `$${Number(updatedVault.balance).toFixed(2)}`,
    });

    return { success: true, balance: Number(updatedVault.balance) };
}

/**
 * Check if vault has enough balance for a bid (amount + $1 fee).
 */
export function getRequiredBidAmount(bidAmount: number): number {
    return bidAmount + CONVENIENCE_FEE_USD;
}

export async function checkBidBalance(userId: string, bidAmount: number): Promise<{ ok: boolean; balance: number; required: number }> {
    const vault = await getOrCreateVault(userId);
    const balance = Number(vault.balance);
    const required = getRequiredBidAmount(bidAmount);
    return { ok: balance >= required, balance, required };
}

export const VAULT_FEE = CONVENIENCE_FEE_USD;
