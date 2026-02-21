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
    'event BidSettled(uint256 indexed lockId, address indexed winner, address indexed seller, uint256 sellerAmount, uint256 platformCut, uint256 convenienceFee)',
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

    // Only show real on-chain transactions (reference starts with '0x').
    // Synthetic/legacy records (demo-deposit, cache-withdraw-*, etc.) are excluded
    // regardless of creation date — some were created today during pre-restore testing.
    const transactions = await prisma.vaultTransaction.findMany({
        where: {
            vaultId: vault.id,
            reference: { startsWith: '0x' },
        },
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
        totalWithdrawn: Number((vault as any).totalWithdrawn ?? 0),
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
 * Record a vault withdrawal in the DB cache.
 *
 * ✅ RESTORED (BUG-03 resolved): When called from the frontend after the user has signed
 * vault.withdraw(amount) via MetaMask (wagmi), a real `txHash` is passed here and used
 * as the Prisma transaction reference. The on-chain state is already updated at this point.
 *
 * Legacy/fallback behaviour (no txHash): records the intent as a DB-only cache entry and
 * fires a reconcileVaultBalance() call to detect any drift.
 */
export async function recordCacheWithdraw(userId: string, amount: number, txHash?: string) {
    const vault = await getOrCreateVault(userId);

    let available: number;
    let onChainLocked = 0;

    if (txHash) {
        // ✅ Fast-path: on-chain tx already confirmed (txHash is proof of funds).
        // Do NOT re-read on-chain balance — it will be 0 post-withdrawal.
        // Trust the DB balance as the pre-withdrawal amount.
        available = Number(vault.balance);
    } else {
        // Legacy/fallback: no txHash — read on-chain to get true free balance.
        available = Number(vault.balance);
        try {
            if (VAULT_ADDRESS) {
                const user = await prisma.user.findUnique({ where: { id: userId } });
                if (user?.walletAddress) {
                    const contract = getVaultContract();
                    const [onChainBal, locked] = await Promise.all([
                        contract.balanceOf(user.walletAddress),
                        contract.lockedBalances(user.walletAddress),
                    ]);
                    onChainLocked = unitsToUsdc(locked);
                    available = Math.max(0, unitsToUsdc(onChainBal) - onChainLocked);
                }
            }
        } catch (err) {
            console.warn('[VaultService] Could not check on-chain balance, falling back to DB:', (err as Error).message);
            available = Math.max(0, Number(vault.balance) - onChainLocked);
        }
    }

    // amount 0 = withdraw all available (unlocked)
    const withdrawAmount = amount === 0 ? available : amount;
    if (withdrawAmount <= 0) throw new Error('Nothing to withdraw');
    if (!txHash && withdrawAmount > available) {
        // Only enforce cap on DB-only calls — txHash path already cleared on-chain
        const lockedNote = onChainLocked > 0 ? ` ($${onChainLocked.toFixed(2)} locked in active bids)` : '';
        throw new Error(`Insufficient balance. Available: $${available.toFixed(2)}${lockedNote}`);
    }

    // Record the withdrawal in the DB cache.
    // When txHash is provided the on-chain state is already updated (user signed via MetaMask).
    // When absent (legacy/fallback) this is a DB-only update; reconcileVaultBalance() detects drift.
    const reference = txHash ?? `cache-withdraw-${Date.now()}`;
    const note = txHash
        ? `Vault withdrawal $${withdrawAmount.toFixed(2)} USDC — on-chain tx confirmed`
        : `Vault withdrawal $${withdrawAmount.toFixed(2)} USDC (DB-cache only — awaiting on-chain confirmation)`;

    const [updatedVault] = await prisma.$transaction([
        prisma.escrowVault.update({
            where: { id: vault.id },
            data: {
                balance: { decrement: withdrawAmount },
                totalWithdrawn: { increment: withdrawAmount },
            },
        }),
        prisma.vaultTransaction.create({
            data: {
                vaultId: vault.id,
                type: 'WITHDRAW',
                amount: withdrawAmount,
                reference,
                note,
            },
        }),
    ]);

    aceDevBus.emit('ace:dev-log', {
        ts: new Date().toISOString(),
        action: 'vault:withdraw',
        userId,
        amount: `$${withdrawAmount.toFixed(2)}`,
        lockedBids: `$${onChainLocked.toFixed(2)}`,
        txHash: txHash ?? null,
        onChain: !!txHash,
    });

    return { success: true, balance: Number(updatedVault.balance), withdrawn: withdrawAmount };
}

/**
 * @deprecated Use recordCacheWithdraw() explicitly.
 * Kept for backward compatibility — emits a warning so callers are aware.
 */
export async function recordWithdraw(userId: string, amount: number) {
    console.warn(
        '[VaultService] recordWithdraw() is deprecated and DB-only. '
        + 'Use recordCacheWithdraw() and ensure the user signs the on-chain withdraw() tx. '
        + 'Call reconcileVaultBalance() afterward to verify balance consistency.'
    );
    return recordCacheWithdraw(userId, amount);
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

        // Parse settlement amounts from BidSettled event
        let sellerAmount = 0;
        let platformCut = 0;
        let convenienceFee = 0;
        const settleEvent = receipt.logs.find((log: any) => {
            try {
                return contract.interface.parseLog(log)?.name === 'BidSettled';
            } catch { return false; }
        });
        if (settleEvent) {
            const parsed = contract.interface.parseLog(settleEvent);
            if (parsed) {
                sellerAmount = unitsToUsdc(parsed.args[3]);  // sellerAmount
                platformCut = unitsToUsdc(parsed.args[4]);   // platformCut (5%)
                convenienceFee = unitsToUsdc(parsed.args[5]); // $1 convenience fee
            }
        }

        // Update DB cache: record the settlement transaction
        try {
            const vault = await getOrCreateVault(userId);
            await prisma.vaultTransaction.create({
                data: {
                    vaultId: vault.id,
                    type: 'SETTLE',
                    amount: sellerAmount + platformCut + convenienceFee,
                    reference,
                    note: `Bid settled #${lockId}: $${sellerAmount.toFixed(2)} to seller, $${platformCut.toFixed(2)} platform cut (5%), $${convenienceFee.toFixed(2)} fee`,
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
            sellerAmount,
            platformCut,
            convenienceFee,
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
 *
 * BUG-02 FIX: Returns structured { solvent, txHash?, error?, details? }.
 * - solvent defaults to FALSE (not true) when the on-chain event cannot be parsed.
 * - Catch block returns { solvent: false, error } so callers see real failures
 *   instead of a ghost "healthy" status.
 */
export async function verifyReserves(): Promise<{
    solvent: boolean;
    txHash?: string;
    error?: string;
    details?: { contractBalance?: string; obligations?: string; margin?: string };
}> {
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

        // BUG-02 FIX: default to FALSE if event not found — never assume solvent
        const solvent: boolean = parsed ? Boolean(parsed.args[2]) : false;

        // Capture PoR details for structured response
        const details = parsed ? {
            contractBalance: (Number(parsed.args[0]) / 1e6).toFixed(6),
            obligations: (Number(parsed.args[1]) / 1e6).toFixed(6),
            margin: ((Number(parsed.args[0]) - Number(parsed.args[1])) / 1e6).toFixed(6),
        } : undefined;

        if (!parsed) {
            console.warn('[VaultService] verifyReserves: ReservesVerified event not found in receipt — defaulting to solvent:false');
        }

        aceDevBus.emit('ace:dev-log', {
            ts: new Date().toISOString(),
            action: 'vault:por-verify',
            solvent,
            txHash: tx.hash,
            details,
            source: 'on-chain',
        });

        return { solvent, txHash: tx.hash, details };
    } catch (err) {
        // BUG-02 FIX: surface the real error — do NOT force solvent:true.
        // Any RPC failure, config error, or revert now propagates as solvent:false
        // so operators see real failures instead of a ghost "healthy" status.
        const message = (err as Error).message || String(err);
        console.error('[VaultService] verifyReserves failed:', message);
        return { solvent: false, error: message };
    }
}

/**
 * Compare the DB-cached vault balance against the on-chain balance for a user.
 * Logs a warning and emits an alert event if they diverge by more than $0.01
 * (the minimum meaningful USDC unit after rounding).
 *
 * Use this after recordCacheWithdraw() or any operation that may cause drift.
 *
 * @returns { dbBalance, onChainBalance, drift, driftUsd, synced }
 */
export async function reconcileVaultBalance(userAddress: string): Promise<{
    dbBalance: number;
    onChainBalance: number;
    drift: number;
    driftUsd: string;
    synced: boolean;
    error?: string;
}> {
    // Look up the user by wallet address to get the DB vault record
    const user = await prisma.user.findFirst({ where: { walletAddress: userAddress.toLowerCase() } });
    if (!user) {
        return { dbBalance: 0, onChainBalance: 0, drift: 0, driftUsd: '$0.00', synced: true, error: 'User not found' };
    }

    const vault = await prisma.escrowVault.findUnique({ where: { userId: user.id } });
    const dbBalance = vault ? Number(vault.balance) : 0;

    if (!VAULT_ADDRESS) {
        return { dbBalance, onChainBalance: dbBalance, drift: 0, driftUsd: '$0.00', synced: true, error: 'VAULT_ADDRESS not configured' };
    }

    let onChainBalance = 0;
    try {
        const contract = getVaultContract();
        const [bal, locked] = await Promise.all([
            contract.balanceOf(userAddress),
            contract.lockedBalances(userAddress),
        ]);
        // On-chain free balance = total balance − locked
        onChainBalance = Math.max(0, unitsToUsdc(bal) - unitsToUsdc(locked));
    } catch (err) {
        const message = (err as Error).message;
        console.error('[VaultService] reconcileVaultBalance: on-chain read failed:', message);
        return { dbBalance, onChainBalance: 0, drift: 0, driftUsd: '$0.00', synced: false, error: message };
    }

    const drift = Math.abs(dbBalance - onChainBalance);
    const driftFormatted = `$${drift.toFixed(2)}`;
    const synced = drift < 0.01; // $0.01 tolerance for rounding

    if (!synced) {
        const driftMsg = `[VaultService] ⚠️ BALANCE DRIFT DETECTED for ${userAddress}: `
            + `dbBalanceUsd=$${dbBalance.toFixed(2)}, onChainBalanceUsd=$${onChainBalance.toFixed(2)}, driftUsd=${driftFormatted}`;
        console.warn(driftMsg);

        // AUTO-SYNC: update Prisma EscrowVault.balance to on-chain truth
        try {
            if (vault) {
                await prisma.escrowVault.update({
                    where: { userId: user.id },
                    data: { balance: onChainBalance },
                });
                console.log(
                    `[VaultService] ✅ Auto-synced DB balance for ${userAddress}: `
                    + `$${dbBalance.toFixed(2)} → $${onChainBalance.toFixed(2)} (legacy data detected — auto-synced)`,
                );
            }
        } catch (syncErr) {
            console.error('[VaultService] Auto-sync failed (non-fatal):', (syncErr as Error).message);
        }

        aceDevBus.emit('ace:dev-log', {
            ts: new Date().toISOString(),
            action: 'vault:reconcile-drift',
            userAddress,
            dbBalanceUsd: `$${dbBalance.toFixed(2)}`,
            onChainBalanceUsd: `$${onChainBalance.toFixed(2)}`,
            driftUsd: driftFormatted,
            severity: 'INFO',
            note: 'legacy data detected — auto-synced',
        });
    }

    return {
        dbBalance: onChainBalance, // return post-sync value
        onChainBalance,
        drift,
        driftUsd: driftFormatted,
        synced: true, // always true after auto-sync
    };
}

/**
 * Delete all legacy VaultTransaction records for a user (those with synthetic
 * references that do not start with '0x' and were created before the on-chain restore),
 * then force-sync EscrowVault.balance to the live on-chain balanceOf value.
 *
 * Called by GET /api/v1/buyer/vault/cleanup-legacy (authenticated, buyer only).
 */
export async function cleanupLegacyRecords(
    userId: string,
): Promise<{ deleted: number; newBalance: number; onChainBalance: number }> {
    const vault = await getOrCreateVault(userId);

    // Delete ALL non-0x reference records — regardless of creation date.
    // Some fake records were created today (after the cutoff) during pre-restore testing.
    const { count: deleted } = await prisma.vaultTransaction.deleteMany({
        where: {
            vaultId: vault.id,
            NOT: { reference: { startsWith: '0x' } },
        },
    });

    // Read current on-chain balance
    let onChainBalance = Number(vault.balance);
    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user?.walletAddress && VAULT_ADDRESS) {
            const contract = getVaultContract();
            const bal = await contract.balanceOf(user.walletAddress);
            onChainBalance = unitsToUsdc(bal);
        }
    } catch (err) {
        console.warn('[VaultService] cleanupLegacyRecords: on-chain read failed, keeping DB value:', (err as Error).message);
    }

    // Sync Prisma to on-chain truth
    const updated = await prisma.escrowVault.update({
        where: { id: vault.id },
        data: { balance: onChainBalance },
    });

    aceDevBus.emit('ace:dev-log', {
        ts: new Date().toISOString(),
        action: 'vault:legacy-cleanup',
        userId,
        deleted,
        newBalance: `$${onChainBalance.toFixed(2)}`,
        note: 'legacy records purged, balance synced to on-chain truth',
    });

    console.log(`[VaultService] Legacy cleanup: deleted=${deleted} records, balance synced to $${onChainBalance.toFixed(2)}`);
    return { deleted, newBalance: Number(updated.balance), onChainBalance };
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
