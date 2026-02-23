/**
 * scripts/refund-stale-locks.mjs
 *
 * Enumerates all active BidLock entries in the PersonalEscrowVault,
 * calls refundBid(lockId) on each unsettled lock (deployer is authorized caller),
 * then sweeps freed wallet USDC → deployer.
 *
 * Safe to run any time — refundBid() reverts if already settled.
 *
 * Usage:
 *   node scripts/refund-stale-locks.mjs
 */

import { ethers } from 'ethers';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dir, '../backend/.env') });

const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_PK = (process.env.DEPLOYER_PRIVATE_KEY || '').startsWith('0x')
    ? process.env.DEPLOYER_PRIVATE_KEY
    : '0x' + (process.env.DEPLOYER_PRIVATE_KEY || '');
const USDC_ADDR = process.env.USDC_CONTRACT_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const VAULT_V2 = process.env.VAULT_ADDRESS_BASE_SEPOLIA || '0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4';

const WALLETS = [
    { label: 'Wallet 1  (buyer)', addr: '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9', pk: '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439' },
    { label: 'Wallet 2  (buyer)', addr: '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC', pk: '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618' },
    { label: 'Wallet 3  (buyer)', addr: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58', pk: '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e' },
    { label: 'Wallet 4  (buyer)', addr: '0x424CaC929939377f221348af52d4cb1247fE4379', pk: '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7' },
    { label: 'Wallet 5  (buyer)', addr: '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d', pk: '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7' },
    { label: 'Wallet 6  (buyer)', addr: '0x089B6Bdb4824628c5535acF60aBF80683452e862', pk: '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75' },
    { label: 'Wallet 7  (buyer)', addr: '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE', pk: '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510' },
    { label: 'Wallet 8  (buyer)', addr: '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C', pk: '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd' },
    { label: 'Wallet 9  (buyer)', addr: '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf', pk: '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c' },
    { label: 'Wallet 10 (buyer)', addr: '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad', pk: '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382' },
    { label: 'Wallet 11 (seller)', addr: '0x9Bb15F98982715E33a2113a35662036528eE0A36', pk: '0x618bee99ca60f5511dad533a998344f3a0a7b2339db5726ae33d56fd543294ce' },
];

const VAULT_ABI = [
    'function activeLockCount() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function lockedBalances(address) view returns (uint256)',
    'function refundBid(uint256 lockId) external',
    'function bidLocks(uint256) view returns (address user, uint256 amount, uint256 fee, uint256 lockedAt, bool settled)',
    // _activeLockIds is private — we enumerate by scanning lockId 1..nextLockId
    'function _nextLockId() view returns (uint256)',
];
const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt6 = n => '$' + (Number(n) / 1e6).toFixed(2);

async function main() {
    if (!DEPLOYER_PK || DEPLOYER_PK === '0x') {
        console.error('ERROR: DEPLOYER_PRIVATE_KEY not set in backend/.env'); process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
    const vault = new ethers.Contract(VAULT_V2, VAULT_ABI, deployer);
    const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, provider);

    console.log('\nDeployer:', deployer.address);
    console.log('Vault v2:', VAULT_V2);

    // ── Step 1: Count active locks ────────────────────────────────────────
    let activeLockCount = 0n;
    try { activeLockCount = await vault.activeLockCount(); } catch { }
    console.log('\nActive lock count:', activeLockCount.toString());

    // ── Step 2: Scan all lock IDs (contract uses 1-based sequential IDs) ──
    // _nextLockId() may be private — fall back to scanning up to 500
    let maxId = 500n;
    try { maxId = await vault._nextLockId(); } catch { }
    console.log('Scanning lock IDs 1 ..' + maxId.toString());

    const staleLocks = [];
    for (let id = 1n; id <= maxId; id++) {
        try {
            const lock = await vault.bidLocks(id);
            // lock = [user, amount, fee, lockedAt, settled]
            if (lock.user !== ethers.ZeroAddress && !lock.settled) {
                staleLocks.push({
                    id,
                    user: lock.user,
                    amount: lock.amount,
                    fee: lock.fee,
                    lockedAt: Number(lock.lockedAt),
                });
            }
        } catch { /* non-existent lockId — skip */ }
        if (id % 50n === 0n) process.stdout.write('.');
    }
    console.log('\n');

    if (staleLocks.length === 0) {
        console.log('No unsettled locks found. Nothing to refund.\n');
        process.exit(0);
    }

    const totalLocked = staleLocks.reduce((sum, l) => sum + l.amount + l.fee, 0n);
    console.log(`Found ${staleLocks.length} unsettled locks totalling ${fmt6(totalLocked)}`);
    console.log('Age of oldest lock:', Math.round((Date.now() / 1000 - staleLocks[0].lockedAt) / 3600) + 'h');

    // ── Step 3: refundBid() each lock (deployer is authorized caller + owner) ──
    console.log('\nRefunding locks...');
    let refunded = 0;
    let refundedAmount = 0n;

    for (const lock of staleLocks) {
        for (let att = 1; att <= 3; att++) {
            try {
                const tx = await vault.refundBid(lock.id);
                await tx.wait();
                console.log(`  OK lockId=${lock.id} user=${lock.user.slice(0, 10)} amount=${fmt6(lock.amount + lock.fee)} (tx: ${tx.hash.slice(0, 10)}...)`);
                refunded++;
                refundedAmount += lock.amount + lock.fee;
                break;
            } catch (e) {
                const msg = e.message?.slice(0, 80) ?? 'unknown';
                if (msg.includes('Already settled')) {
                    console.log(`  SKIP lockId=${lock.id} (already settled)`);
                    break;
                }
                if (att < 3) {
                    console.log(`  RETRY lockId=${lock.id} att ${att}/3: ${msg}`);
                    await sleep(2000 * att);
                } else {
                    console.log(`  FAIL lockId=${lock.id}: ${msg}`);
                }
            }
        }
        await sleep(300);
    }

    console.log(`\nRefunded ${refunded}/${staleLocks.length} locks — ${fmt6(refundedAmount)} returned to free balances`);

    // ── Step 4: Now vault withdraw + sweep each wallet → deployer ────────
    console.log('\nWithdrawing freed balances + sweeping to deployer...');
    const usdcBefore = await usdc.balanceOf(deployer.address);
    let totalSwept = 0n;

    for (const w of WALLETS) {
        const free = await vault.balanceOf(w.addr).catch(() => 0n);
        if (free === 0n) continue;

        console.log(`\n  ${w.label} — free: ${fmt6(free)}`);
        const signer = new ethers.Wallet(w.pk, provider);
        const vaultSigner = new ethers.Contract(VAULT_V2, VAULT_ABI, signer);
        const usdcSigner = new ethers.Contract(USDC_ADDR, USDC_ABI, signer);

        // Ensure gas
        const ethBal = await provider.getBalance(w.addr);
        if (ethBal < ethers.parseEther('0.0005')) {
            const topup = await deployer.sendTransaction({ to: w.addr, value: ethers.parseEther('0.001') });
            await topup.wait();
            console.log('    Gas topped up');
        }

        // vault.withdraw
        try {
            const tx = await vaultSigner.withdraw(free);
            await tx.wait();
            console.log(`    Vault withdraw OK: ${fmt6(free)}`);
        } catch (e) {
            console.log(`    Vault withdraw FAILED: ${e.message?.slice(0, 80)}`);
            continue;
        }

        await sleep(400);

        // USDC transfer to deployer
        try {
            const walletBal = await usdc.balanceOf(w.addr);
            if (walletBal === 0n) { console.log('    Wallet USDC empty after withdraw'); continue; }
            const tx = await usdcSigner.transfer(deployer.address, walletBal);
            await tx.wait();
            console.log(`    USDC swept: ${fmt6(walletBal)}`);
            totalSwept += walletBal;
        } catch (e) {
            console.log(`    USDC sweep FAILED: ${e.message?.slice(0, 80)}`);
        }
        await sleep(300);
    }

    const usdcAfter = await usdc.balanceOf(deployer.address);
    console.log('\n' + '='.repeat(60));
    console.log('  DONE');
    console.log('  Deployer USDC before: ' + fmt6(usdcBefore));
    console.log('  Deployer USDC after:  ' + fmt6(usdcAfter));
    console.log('  Net gained:           ' + fmt6(usdcAfter - usdcBefore));
    console.log('  Total swept:          ' + fmt6(totalSwept));
    console.log('='.repeat(60) + '\n');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
