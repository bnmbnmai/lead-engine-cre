/**
 * demo-vault-cycle.ts — On-chain vault cycle operations
 *
 * Handles:
 *   - pendingLockIds: Set of on-chain lock IDs pending settlement/refund
 *   - abortCleanup: refunds orphaned vault locks on demo abort (BUG-04)
 *   - recycleTransfer: sends all USDC from a demo wallet back to deployer
 *   - recycleVaultWithdraw: withdraws a buyer/seller's free vault balance
 *   - recycleTokens: full post-run USDC recovery (background phase)
 *   - withRecycleTimeout: wraps recycleTokens with a hard 4-minute timeout guard
 */

import { Server as SocketServer } from 'socket.io';
import { ethers } from 'ethers';
import {
    DEMO_BUYER_WALLETS,
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

        const REPLENISH_BUYER_KEYS: Record<string, string> = {
            '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9': '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439',
            '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC': '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618',
            '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58': '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e',
            '0x424CaC929939377f221348af52d4cb1247fE4379': '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7',
            '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d': '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7',
            '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE': '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510',
            '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C': '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd',
            '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf': '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c',
            '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad': '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382',
            '0x089B6Bdb4824628c5535acF60aBF80683452e862': '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75',
        };

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
