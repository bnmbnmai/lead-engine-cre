/**
 * demo-vault-cycle.ts — On-chain vault cycle operations
 *
 * Handles:
 *   - pendingLockIds: Set of on-chain lock IDs pending settlement/refund
 *   - abortCleanup: refunds orphaned vault locks on demo abort (BUG-04)
 *   - recycleTransfer: sends all USDC from a demo wallet back to deployer
 *   - recycleVaultWithdraw: withdraws a buyer/seller's free vault balance
 *   - recycleTokens: full post-run USDC recovery (background phase)
 *     - R3.5: scans BidLocked/BidSettled/BidRefunded events to find and
 *       refund orphaned vault locks, preventing deployer USDC depletion
 *   - withRecycleTimeout: wraps recycleTokens with a hard 4-minute timeout guard
 */

import { Server as SocketServer } from 'socket.io';
import { ethers } from 'ethers';
import {
    DEMO_BUYER_WALLETS,
    DEMO_BUYER_KEYS,
    DEMO_SELLER_WALLET,
    DEMO_SELLER_KEY,
    VAULT_ADDRESS,
    VAULT_ABI,
    USDC_ADDRESS,
    USDC_ABI,
    emit,
    safeEmit,
    emitStatus,
    getProvider,
    getSigner,
    getVault,
    getUSDC,
    getNextNonce,
    sendWithGasEscalation,
} from './demo-shared';

// ── Module IO ref (set by orchestrator so stopDemo can emit without io param) ──
let _moduleIo: SocketServer | null = null;
export function setModuleIo(io: SocketServer | null): void { _moduleIo = io; }
export function getModuleIo(): SocketServer | null { return _moduleIo; }

// ── Recycling state (managed by orchestrator) ──────
let _isRecycling = false;
let _recycleAbort: AbortController | null = null;

export function setIsRecycling(v: boolean): void { _isRecycling = v; }
export function getIsRecycling(): boolean { return _isRecycling; }
export function setRecycleAbort(ac: AbortController | null): void { _recycleAbort = ac; }
export function getRecycleAbort(): AbortController | null { return _recycleAbort; }

// ── BUG-04: Pending Vault Lock Registry ────────────
export const pendingLockIds = new Set<number>();

/**
 * abortCleanup — refunds all on-chain vault locks that are still pending
 * (issued via lockForBid but not yet settled or refunded) when the demo is
 * aborted mid-cycle.
 *
 * Fires best-effort: one lock failure never blocks others. Always resolves.
 */
export async function abortCleanup(
    io: SocketServer,
    vault: ethers.Contract,
): Promise<void> {
    const locks = Array.from(pendingLockIds);
    if (locks.length === 0) return;

    emit(io, {
        ts: new Date().toISOString(),
        level: 'warn',
        message: `⏹️ Abort cleanup: refunding ${locks.length} orphaned vault lock${locks.length !== 1 ? 's' : ''} [${locks.join(', ')}]…`,
    });

    await Promise.allSettled(
        locks.map(async (lockId) => {
            try {
                const tx = await vault.refundBid(lockId);
                await tx.wait();
                pendingLockIds.delete(lockId);
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'info',
                    message: `✅ Abort cleanup: lock #${lockId} refunded (${tx.hash.slice(0, 12)}…)`,
                });
            } catch (refundErr: any) {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ Abort cleanup: could not refund lock #${lockId}: ${refundErr.message?.slice(0, 60)}`,
                });
            }
        })
    );
}

// ── Recycle Helpers ────────────────────────────────

/**
 * recycleTransfer — sends ALL USDC from a demo wallet back to the deployer.
 * 3-attempt retry loop with 20% gas price bump per attempt.
 */
export async function recycleTransfer(
    io: SocketServer,
    label: string,
    walletAddr: string,
    walletSigner: ethers.Wallet,
    deployerAddr: string,
    _gasTopUpSigner: ethers.Wallet,
): Promise<bigint> {
    const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, walletSigner);
    const provider = walletSigner.provider!;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const ethBal = await provider.getBalance(walletAddr);
            if (ethBal < ethers.parseEther('0.005')) {
                console.warn(`[DEMO] Wallet ${walletAddr} ETH low (${ethers.formatEther(ethBal)} ETH). Run scripts/fund-wallets-eth-permanent.mjs before next demo.`);
            }

            const bal = await usdc.balanceOf(walletAddr);
            if (bal === 0n) return 0n;

            const feeData = await provider.getFeeData();
            const gasPrice = feeData.gasPrice
                ? (feeData.gasPrice * BigInt(100 + (attempt - 1) * 20)) / 100n
                : undefined;

            const tx = await usdc.transfer(deployerAddr, bal, gasPrice ? { gasPrice } : {});
            await tx.wait();

            emit(io, {
                ts: new Date().toISOString(),
                level: 'success',
                message: `✅ Recycled $${ethers.formatUnits(bal, 6)} USDC from ${label} (attempt ${attempt})`,
            });
            return bal;

        } catch (err: any) {
            const msg = err.message?.slice(0, 100) ?? 'unknown';
            if (attempt < 3) {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ Transfer attempt ${attempt}/3 failed for ${label}: ${msg} — retrying with higher gas…`,
                });
                await new Promise(r => setTimeout(r, 1500 * attempt));
            } else {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ All 3 transfer attempts failed for ${label}: ${msg} — USDC may remain in wallet`,
                });
            }
        }
    }
    return 0n;
}

/**
 * recycleVaultWithdraw — withdraws a buyer/seller's free vault balance back to wallet.
 * 3-attempt retry with 20% gas price escalation per retry.
 */
export async function recycleVaultWithdraw(
    io: SocketServer,
    label: string,
    walletSigner: ethers.Wallet,
    vaultContract: ethers.Contract,
    walletAddr: string,
): Promise<bigint> {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const free = await vaultContract.balanceOf(walletAddr);
            if (free === 0n) return 0n;

            const provider = walletSigner.provider!;
            const feeData = await provider.getFeeData();
            const gasPrice = feeData.gasPrice
                ? (feeData.gasPrice * BigInt(100 + (attempt - 1) * 20)) / 100n
                : undefined;

            const tx = await vaultContract.withdraw(free, gasPrice ? { gasPrice } : {});
            await tx.wait();
            emit(io, { ts: new Date().toISOString(), level: 'info', message: `📤 Vault withdraw OK for ${label}: $${ethers.formatUnits(free, 6)} (attempt ${attempt})` });
            return free;
        } catch (err: any) {
            const msg = err.shortMessage ?? err.message?.slice(0, 80) ?? 'unknown';
            if (attempt < 3) {
                emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Vault withdraw attempt ${attempt}/3 failed for ${label}: ${msg} — retrying…` });
                await new Promise(r => setTimeout(r, 1500 * attempt));
            } else {
                emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ All 3 vault withdraw attempts failed for ${label}: ${msg}` });
            }
        }
    }
    return 0n;
}

/**
 * recycleTokens — runs AFTER demo:complete fires, non-blocking.
 * Full recovery path: drain all demo wallets → replenish buyer vaults.
 */
export async function recycleTokens(
    io: SocketServer,
    signal: AbortSignal,
    BUYER_KEYS: Record<string, string>,
): Promise<void> {
    _isRecycling = true;
    _recycleAbort = new AbortController();

    try {
        emit(io, {
            ts: new Date().toISOString(),
            level: 'step',
            message: '♻️  Full USDC recovery starting — draining all demo wallets back to deployer...',
        });
        safeEmit(io, 'demo:recycle-start', { ts: new Date().toISOString() });

        const provider = getProvider();
        const signer = getSigner();
        const vault = getVault(signer);
        const usdc = getUSDC(signer);
        const recycleSignal = _recycleAbort.signal;

        const deployerBalBefore = await usdc.balanceOf(signer.address);
        emit(io, {
            ts: new Date().toISOString(),
            level: 'info',
            message: `📊 Deployer USDC before recycle: $${ethers.formatUnits(deployerBalBefore, 6)}`,
        });

        let totalRecovered = 0n;
        const skippedWallets: string[] = [];

        // R1 — Seller ETH check (fund-once model)
        {
            const sellerEth = await provider.getBalance(DEMO_SELLER_WALLET);
            if (sellerEth < ethers.parseEther('0.005')) {
                console.warn(`[DEMO] Seller wallet ${DEMO_SELLER_WALLET} ETH low (${ethers.formatEther(sellerEth)} ETH). Run scripts/fund-wallets-eth-permanent.mjs to pre-fund.`);
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ Seller wallet ETH low (${ethers.formatEther(sellerEth)} ETH). Pre-funding recommended via fund-wallets-eth-permanent.mjs.`,
                });
            }
        }

        // R2 — Withdraw deployer vault balance
        try {
            const deployerVaultBal = await vault.balanceOf(signer.address);
            if (deployerVaultBal > 0n) {
                emit(io, { ts: new Date().toISOString(), level: 'info', message: `📤 Withdrawing $${ethers.formatUnits(deployerVaultBal, 6)} from deployer vault...` });
                // Use shared nonce queue to avoid nonce-too-low if other deployer txs are in-flight
                const wNonce = await getNextNonce();
                const withdrawTx = await vault.withdraw(deployerVaultBal, { nonce: wNonce });
                await withdrawTx.wait();
                totalRecovered += deployerVaultBal;
                emit(io, { ts: new Date().toISOString(), level: 'success', message: `✅ Deployer vault withdrawn: $${ethers.formatUnits(deployerVaultBal, 6)}` });
            }
        } catch (err: any) {
            emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Deployer vault withdraw failed: ${err.message?.slice(0, 80)}` });
        }

        // R3 — Seller vault withdraw + USDC transfer
        try {
            const sellerSigner = new ethers.Wallet(DEMO_SELLER_KEY, provider);
            const sellerVault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, sellerSigner);

            const sellerEthNow = await provider.getBalance(DEMO_SELLER_WALLET);
            if (sellerEthNow < ethers.parseEther('0.005')) {
                console.warn(`[DEMO] Seller wallet ${DEMO_SELLER_WALLET} ETH low (${ethers.formatEther(sellerEthNow)} ETH). Pre-funding recommended.`);
            }

            const sellerVaultFree = await sellerVault.balanceOf(DEMO_SELLER_WALLET);
            const sellerVaultLocked = await sellerVault.lockedBalances(DEMO_SELLER_WALLET);
            if (sellerVaultLocked > 0n) {
                emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Seller has $${ethers.formatUnits(sellerVaultLocked, 6)} locked in vault — cannot withdraw until bids settle` });
            }
            if (sellerVaultFree > 0n) {
                const wTx = await sellerVault.withdraw(sellerVaultFree);
                await wTx.wait();
            }

            const recovered = await recycleTransfer(io, `seller ${DEMO_SELLER_WALLET.slice(0, 10)}…`, DEMO_SELLER_WALLET, sellerSigner, signer.address, signer);
            totalRecovered += recovered;
        } catch (err: any) {
            emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Seller recycle failed: ${err.message?.slice(0, 80)}` });
        }

        // R3.5 — Orphaned lock recovery (scan events, refund stale locks)
        try {
            emit(io, {
                ts: new Date().toISOString(),
                level: 'step',
                message: '🔍 Scanning for orphaned vault locks across demo wallets...',
            });

            const currentBlock = await provider.getBlockNumber();
            // Scan last 5000 blocks (~2-3 hours on Base Sepolia)
            const fromBlock = Math.max(0, currentBlock - 5000);

            const demoWalletSet = new Set(DEMO_BUYER_WALLETS.map(a => a.toLowerCase()));

            // Query BidLocked events for demo wallets
            const lockedFilter = vault.filters.BidLocked();
            const lockedEvents = await vault.queryFilter(lockedFilter, fromBlock, currentBlock);

            // Query BidSettled and BidRefunded events to find which locks are already resolved
            const settledFilter = vault.filters.BidSettled();
            const refundedFilter = vault.filters.BidRefunded();
            const [settledEvents, refundedEvents] = await Promise.all([
                vault.queryFilter(settledFilter, fromBlock, currentBlock),
                vault.queryFilter(refundedFilter, fromBlock, currentBlock),
            ]);

            const resolvedLockIds = new Set<string>();
            for (const ev of settledEvents) {
                const parsed = vault.interface.parseLog({ topics: ev.topics as string[], data: ev.data });
                if (parsed) resolvedLockIds.add(parsed.args[0].toString());
            }
            for (const ev of refundedEvents) {
                const parsed = vault.interface.parseLog({ topics: ev.topics as string[], data: ev.data });
                if (parsed) resolvedLockIds.add(parsed.args[0].toString());
            }

            // Find orphaned locks: locked by demo wallets but not settled/refunded
            const orphanedLocks: Array<{ lockId: string; user: string; amount: bigint }> = [];
            for (const ev of lockedEvents) {
                const parsed = vault.interface.parseLog({ topics: ev.topics as string[], data: ev.data });
                if (!parsed) continue;
                const lockId = parsed.args[0].toString();
                const user = parsed.args[1].toLowerCase();
                const amount = parsed.args[2] as bigint;
                if (demoWalletSet.has(user) && !resolvedLockIds.has(lockId)) {
                    orphanedLocks.push({ lockId, user, amount });
                }
            }

            if (orphanedLocks.length > 0) {
                let totalRefunded = 0n;
                let refundCount = 0;

                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `🔓 Found ${orphanedLocks.length} orphaned lock${orphanedLocks.length !== 1 ? 's' : ''} — refunding...`,
                });

                for (const lock of orphanedLocks) {
                    if (recycleSignal.aborted || signal.aborted) break;
                    try {
                        const nonce = await getNextNonce();
                        const tx = await vault.refundBid(BigInt(lock.lockId), { nonce });
                        await tx.wait();
                        totalRefunded += lock.amount;
                        refundCount++;
                        pendingLockIds.delete(Number(lock.lockId));
                    } catch (refundErr: any) {
                        // Lock may already be resolved on-chain (event scan race) — non-fatal
                        const msg = refundErr.shortMessage ?? refundErr.message?.slice(0, 80) ?? 'unknown';
                        emit(io, {
                            ts: new Date().toISOString(),
                            level: 'info',
                            message: `ℹ️ Lock #${lock.lockId} refund skipped: ${msg}`,
                        });
                    }
                }

                if (refundCount > 0) {
                    emit(io, {
                        ts: new Date().toISOString(),
                        level: 'success',
                        message: `🔄 Refunded ${refundCount} orphaned lock${refundCount !== 1 ? 's' : ''} totaling $${ethers.formatUnits(totalRefunded, 6)}`,
                    });
                    totalRecovered += totalRefunded;
                }
            } else {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'info',
                    message: '✅ No orphaned locks found — vault is clean',
                });
            }
        } catch (orphanErr: any) {
            // Never block demo flow — orphan recovery is best-effort
            emit(io, {
                ts: new Date().toISOString(),
                level: 'warn',
                message: `⚠️ Orphaned lock scan failed (non-fatal): ${orphanErr.message?.slice(0, 100)}`,
            });
        }

        // R4 — All buyer wallets
        for (const buyerAddr of DEMO_BUYER_WALLETS) {
            if (recycleSignal.aborted || signal.aborted) break;

            const bKey = BUYER_KEYS[buyerAddr];
            if (!bKey) continue;

            try {
                const bSigner = new ethers.Wallet(bKey, provider);
                const bVault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, bSigner);

                const bEthBal = await provider.getBalance(buyerAddr);
                if (bEthBal < ethers.parseEther('0.005')) {
                    console.warn(`[DEMO] Wallet ${buyerAddr} ETH low (${ethers.formatEther(bEthBal)} ETH). Pre-funding recommended.`);
                }

                const bLocked = await bVault.lockedBalances(buyerAddr);
                if (bLocked > 0n) {
                    emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Buyer ${buyerAddr.slice(0, 10)}… has $${ethers.formatUnits(bLocked, 6)} still locked (stranded bid — will resolve on next cycle's refund)` });
                }

                await recycleVaultWithdraw(io, `buyer ${buyerAddr.slice(0, 10)}…`, bSigner, bVault, buyerAddr);

                const recovered = await recycleTransfer(io, `buyer ${buyerAddr.slice(0, 10)}…`, buyerAddr, bSigner, signer.address, signer);
                totalRecovered += recovered;
                if (recovered === 0n) skippedWallets.push(buyerAddr);

            } catch (err: any) {
                emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Buyer ${buyerAddr.slice(0, 10)}… recycle failed: ${err.message?.slice(0, 80)}` });
                skippedWallets.push(buyerAddr);
            }
        }

        // R5 — Final sweep
        emit(io, { ts: new Date().toISOString(), level: 'info', message: '🔎 Final sweep — checking all demo wallets for residual USDC...' });

        const sweepWallets: Array<{ addr: string; key: string; label: string }> = [
            { addr: DEMO_SELLER_WALLET, key: DEMO_SELLER_KEY, label: 'seller' },
            ...DEMO_BUYER_WALLETS
                .filter(addr => BUYER_KEYS[addr])
                .map(addr => ({ addr, key: BUYER_KEYS[addr], label: `buyer ${addr.slice(0, 10)}…` })),
        ];

        for (const { addr, key, label } of sweepWallets) {
            if (recycleSignal.aborted || signal.aborted) break;
            try {
                const wSigner = new ethers.Wallet(key, provider);
                const wUsdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, wSigner);
                const residual = await wUsdc.balanceOf(addr);
                if (residual > 0n) {
                    const sweepEth = await provider.getBalance(addr);
                    if (sweepEth < ethers.parseEther('0.005')) {
                        console.warn(`[DEMO] Wallet ${addr} ETH low (${ethers.formatEther(sweepEth)} ETH) during final sweep. Pre-funding recommended.`);
                    }
                    const swept = await recycleTransfer(io, `sweep:${label}`, addr, wSigner, signer.address, signer);
                    totalRecovered += swept;
                }
            } catch { /* non-fatal */ }
        }

        // R6 — Bookend
        const deployerBalAfter = await usdc.balanceOf(signer.address);
        const netRecovered = deployerBalAfter - deployerBalBefore;
        emit(io, {
            ts: new Date().toISOString(),
            level: 'success',
            message: `✅ Full USDC recovery complete\n   Before: $${ethers.formatUnits(deployerBalBefore, 6)}\n   After:  $${ethers.formatUnits(deployerBalAfter, 6)}\n   Net recovered: $${ethers.formatUnits(netRecovered > 0n ? netRecovered : 0n, 6)} (gas costs excluded)`,
        });

        // R7 — Replenish buyer vaults to $200 for next run
        const REPLENISH_AMOUNT = 200;
        const replenishUnits = ethers.parseUnits(String(REPLENISH_AMOUNT), 6);
        const replenishNeeded = replenishUnits * BigInt(DEMO_BUYER_WALLETS.length);
        const deployerUsdcNow = await usdc.balanceOf(signer.address);

        emit(io, {
            ts: new Date().toISOString(),
            level: 'step',
            message: `🔄 Resetting buyer vaults to $${REPLENISH_AMOUNT} each for next run ($${ethers.formatUnits(replenishNeeded, 6)} total needed, deployer has $${ethers.formatUnits(deployerUsdcNow, 6)})`,
        });
        if (_moduleIo) emitStatus(_moduleIo, { running: false, recycling: true, phase: 'resetting', currentCycle: 0, totalCycles: 0, percent: 0 });

        // Build wallet→key lookup from the env-loaded DEMO_BUYER_KEYS (same source as demo-shared).
        // This eliminates the former REPLENISH_BUYER_KEYS copy-paste (BUG-BK from findings.md).
        const REPLENISH_BUYER_KEYS: Record<string, string> = {};
        DEMO_BUYER_WALLETS.forEach((addr, idx) => {
            const k = DEMO_BUYER_KEYS[idx];
            if (k) REPLENISH_BUYER_KEYS[addr] = k;
        });

        for (const buyerAddr of DEMO_BUYER_WALLETS) {
            if (recycleSignal.aborted || signal.aborted) break;

            const bKey = REPLENISH_BUYER_KEYS[buyerAddr];
            if (!bKey) continue;

            try {
                const currentBal = await vault.balanceOf(buyerAddr);
                if (currentBal >= replenishUnits) {
                    emit(io, { ts: new Date().toISOString(), level: 'info', message: `⏭️ Replenish: ${buyerAddr.slice(0, 10)}… already has $${ethers.formatUnits(currentBal, 6)} — skipping` });
                    continue;
                }

                const topUp = replenishUnits - currentBal;

                const replenishEth = await provider.getBalance(buyerAddr);
                if (replenishEth < ethers.parseEther('0.005')) {
                    console.warn(`[DEMO] Wallet ${buyerAddr} ETH low (${ethers.formatEther(replenishEth)} ETH). Pre-funding recommended.`);
                    emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Buyer ${buyerAddr.slice(0, 10)}… ETH low (${ethers.formatEther(replenishEth)}). Pre-funding recommended.` });
                }

                const tNonce = await getNextNonce();
                const tTx = await sendWithGasEscalation(
                    signer,
                    { to: USDC_ADDRESS, data: usdc.interface.encodeFunctionData('transfer', [buyerAddr, topUp]), nonce: tNonce },
                    `replenish USDC ${buyerAddr.slice(0, 10)}`,
                    (msg) => emit(io, { ts: new Date().toISOString(), level: 'info', message: msg }),
                );
                await tTx.wait();

                const bSigner = new ethers.Wallet(bKey, provider);
                const bUsdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, bSigner);
                const bVault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, bSigner);

                const MAX_UINT = ethers.MaxUint256;
                let approved = false;
                for (let att = 1; att <= 3 && !approved; att++) {
                    try {
                        const curAllowance = await bUsdc.allowance(buyerAddr, VAULT_ADDRESS);
                        if (curAllowance >= topUp) {
                            approved = true;
                        } else {
                            const feeA = await provider.getFeeData();
                            const gpA = feeA.gasPrice ? (feeA.gasPrice * BigInt(100 + (att - 1) * 20)) / 100n : undefined;
                            const aTx = await bUsdc.approve(VAULT_ADDRESS, MAX_UINT, gpA ? { gasPrice: gpA } : {});
                            await aTx.wait();
                            approved = true;
                        }
                    } catch (aErr: any) {
                        emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Approve attempt ${att}/3 failed for ${buyerAddr.slice(0, 10)}…: ${aErr.shortMessage ?? aErr.message?.slice(0, 60)}` });
                        await new Promise(r => setTimeout(r, 1500 * att));
                    }
                }
                if (!approved) {
                    emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Could not approve USDC for ${buyerAddr.slice(0, 10)}… — skipping deposit` });
                    skippedWallets.push(buyerAddr);
                    continue;
                }

                let deposited = false;
                for (let att = 1; att <= 3 && !deposited; att++) {
                    try {
                        const feeD = await provider.getFeeData();
                        const gpD = feeD.gasPrice ? (feeD.gasPrice * BigInt(100 + (att - 1) * 20)) / 100n : undefined;
                        const dTx = await bVault.deposit(topUp, gpD ? { gasPrice: gpD } : {});
                        await dTx.wait();
                        deposited = true;
                    } catch (dErr: any) {
                        emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Deposit attempt ${att}/3 failed for ${buyerAddr.slice(0, 10)}…: ${dErr.shortMessage ?? dErr.message?.slice(0, 60)}` });
                        await new Promise(r => setTimeout(r, 1500 * att));
                    }
                }
                if (!deposited) {
                    emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Could not deposit for ${buyerAddr.slice(0, 10)}… after 3 attempts` });
                    skippedWallets.push(buyerAddr);
                    continue;
                }

                emit(io, { ts: new Date().toISOString(), level: 'success', message: `✅ Replenished ${buyerAddr.slice(0, 10)}… to $${ethers.formatUnits(replenishUnits, 6)} vault balance` });
            } catch (repErr: any) {
                emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Replenish failed for ${buyerAddr.slice(0, 10)}…: ${repErr.message?.slice(0, 60)}` });
            }
        }

        emit(io, { ts: new Date().toISOString(), level: 'success', message: `🟢 Demo environment fully recycled and ready for next run — you can click Full E2E again immediately!` });
        safeEmit(io, 'demo:recycle-complete', {
            ts: new Date().toISOString(),
            success: true,
            totalRecovered: ethers.formatUnits(totalRecovered, 6),
            deployerBalAfter: ethers.formatUnits(deployerBalAfter, 6),
            skippedWallets,
        });

    } catch (err: any) {
        emit(io, {
            ts: new Date().toISOString(),
            level: 'warn',
            message: `⚠️ Token redistribution encountered an error (non-fatal): ${err.message?.slice(0, 120)}`,
        });
        safeEmit(io, 'demo:recycle-complete', { ts: new Date().toISOString(), success: false, error: err.message });
    } finally {
        _isRecycling = false;
        _recycleAbort = null;
        if (_moduleIo) emitStatus(_moduleIo, { running: false, recycling: false, phase: 'idle', currentCycle: 0, totalCycles: 0, percent: 0 });
    }
}

// ── Recycle Timeout Guard ──────────────────────────

const RECYCLE_TIMEOUT_MS = 240_000; // 4 minutes

export async function withRecycleTimeout(io: SocketServer, recyclePromise: Promise<void>): Promise<void> {
    const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), RECYCLE_TIMEOUT_MS)
    );

    const result = await Promise.race([recyclePromise.then(() => 'done' as const), timeoutPromise]);

    if (result === 'timeout') {
        if (_recycleAbort) _recycleAbort.abort();
        _isRecycling = false;

        emit(io, {
            ts: new Date().toISOString(),
            level: 'warn',
            message: `⏰ Token recovery timed out after 240s — partial recovery. Some USDC may remain in demo wallets. Click "Full Reset & Recycle" to finish cleanup, or run another demo cycle.`,
        });
        if (_moduleIo) {
            emitStatus(_moduleIo, { running: false, recycling: false, phase: 'idle' });
        }
    }
}
