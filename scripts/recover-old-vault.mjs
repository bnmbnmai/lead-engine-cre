/**
 * scripts/recover-old-vault.mjs
 *
 * Recovers USDC stranded in the OLD PersonalEscrowVault
 * (0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4 — the hardcoded default
 * that was replaced by the current vault 0xf09cf1d4…).
 *
 * Per wallet:
 *   1. vault.withdraw(free balance)  → USDC lands back in wallet
 *   2. usdc.transfer(deployer, all)  → USDC goes to deployer
 *
 * Usage:
 *   node scripts/recover-old-vault.mjs
 */

import { ethers } from 'ethers';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dir = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dir, '../backend/.env') });

const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_PK = (process.env.DEPLOYER_PRIVATE_KEY || '').startsWith('0x')
    ? process.env.DEPLOYER_PRIVATE_KEY
    : '0x' + (process.env.DEPLOYER_PRIVATE_KEY || '');
const USDC_ADDR = process.env.USDC_CONTRACT_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const OLD_VAULT = '0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4'; // ← the stranded vault

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
    'function balanceOf(address) view returns (uint256)',
    'function lockedBalances(address) view returns (uint256)',
    'function withdraw(uint256) external',
];
const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt6 = n => '$' + (Number(n) / 1e6).toFixed(2);

async function confirm(q) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(res => rl.question(q, ans => { rl.close(); res(ans.trim().toLowerCase()); }));
}

async function ensureGas(deployer, addr, provider) {
    const bal = await provider.getBalance(addr);
    const MIN = ethers.parseEther('0.0005');
    const TOP = ethers.parseEther('0.001');
    if (bal < MIN) {
        console.log(`  ⛽ Topping up gas ETH → ${addr.slice(0, 10)}…`);
        const tx = await deployer.sendTransaction({ to: addr, value: TOP });
        await tx.wait();
    }
}

async function main() {
    console.log('\n' + '═'.repeat(70));
    console.log('  🚨  RECOVERY: Old Vault 0x11bb8AFe → Deployer');
    console.log('  ' + new Date().toISOString());
    console.log('═'.repeat(70));

    if (!DEPLOYER_PK || DEPLOYER_PK === '0x') {
        console.error('❌ DEPLOYER_PRIVATE_KEY not set.'); process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
    const usdcView = new ethers.Contract(USDC_ADDR, USDC_ABI, provider);

    // ── Assessment ─────────────────────────────────────────────────────
    console.log('\n  Scanning old vault for balances...\n');
    const snap = [];
    let totalFree = 0n, totalLocked = 0n;

    for (const w of WALLETS) {
        const vault = new ethers.Contract(OLD_VAULT, VAULT_ABI, provider);
        const free = await vault.balanceOf(w.addr).catch(() => 0n);
        const locked = await vault.lockedBalances(w.addr).catch(() => 0n);
        if (free > 0n || locked > 0n) {
            console.log(`  ${w.label.padEnd(20)} free=${fmt6(free).padStart(10)}  locked=${fmt6(locked).padStart(10)}`);
        }
        snap.push({ ...w, free, locked });
        totalFree += BigInt(free);
        totalLocked += BigInt(locked);
        await sleep(100);
    }

    const totalVaultUsdc = await usdcView.balanceOf(OLD_VAULT).catch(() => 0n);
    const deployerBefore = await usdcView.balanceOf(deployer.address).catch(() => 0n);

    console.log('\n  ' + '─'.repeat(50));
    console.log(`  Old vault USDC held:   ${fmt6(totalVaultUsdc)}`);
    console.log(`  Sum free balances:     ${fmt6(totalFree)}`);
    console.log(`  Sum locked balances:   ${fmt6(totalLocked)}`);
    console.log(`  Deployer USDC before:  ${fmt6(deployerBefore)}`);
    console.log('  ' + '─'.repeat(50));

    if (totalLocked > 0n) {
        console.log('\n  ⚠️  Some balances are LOCKED — these cannot be withdrawn until bids are settled/refunded.');
        console.log('     Locked USDC will remain in the old vault for now.');
    }

    if (totalFree === 0n) {
        console.log('\n  Nothing free to withdraw. Exiting.\n');
        process.exit(0);
    }

    console.log(`\n  Ready to recover ${fmt6(totalFree)} from old vault → deployer`);
    const ans = await confirm('  Proceed? (yes/no): ');
    if (ans !== 'yes' && ans !== 'y') {
        console.log('\n  Aborted.\n'); process.exit(0);
    }

    // ── Recovery ──────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(70));
    console.log('  🔄  WITHDRAWING + SWEEPING');
    console.log('─'.repeat(70));

    let totalRecovered = 0n;

    for (const w of snap) {
        if (w.free === 0n) continue;
        console.log(`\n  ▸ ${w.label} — ${w.addr}`);
        const signer = new ethers.Wallet(w.pk, provider);
        const vault = new ethers.Contract(OLD_VAULT, VAULT_ABI, signer);
        const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, signer);

        // Step 1: withdraw from old vault → wallet
        let withdrawn = 0n;
        for (let att = 1; att <= 3; att++) {
            try {
                const live = await vault.balanceOf(w.addr);
                if (live === 0n) { console.log('  💤 Already empty'); break; }
                await ensureGas(deployer, w.addr, provider);
                const tx = await vault.withdraw(live);
                await tx.wait();
                console.log(`  ✅ Vault withdraw: ${fmt6(live)}`);
                withdrawn = live;
                break;
            } catch (e) {
                if (att < 3) {
                    console.log(`  ⚠️  Withdraw att ${att}/3 failed: ${e.message?.slice(0, 70)} — retrying…`);
                    await sleep(2000 * att);
                } else {
                    console.log(`  ❌ Withdraw failed after 3 attempts: ${e.message?.slice(0, 70)}`);
                }
            }
        }

        if (withdrawn === 0n) continue;
        await sleep(600);

        // Step 2: sweep wallet USDC → deployer
        for (let att = 1; att <= 3; att++) {
            try {
                const bal = await usdc.balanceOf(w.addr);
                if (bal === 0n) { console.log('  💤 Wallet USDC empty after withdraw'); break; }
                const fee = await provider.getFeeData();
                const gp = fee.gasPrice ? (fee.gasPrice * BigInt(100 + (att - 1) * 20)) / 100n : undefined;
                const tx = await usdc.transfer(deployer.address, bal, gp ? { gasPrice: gp } : {});
                await tx.wait();
                console.log(`  ✅ USDC swept to deployer: ${fmt6(bal)}`);
                totalRecovered += bal;
                break;
            } catch (e) {
                if (att < 3) {
                    console.log(`  ⚠️  Sweep att ${att}/3 failed: ${e.message?.slice(0, 70)} — retrying…`);
                    await sleep(2000 * att);
                } else {
                    console.log(`  ❌ Sweep failed: ${e.message?.slice(0, 70)}`);
                }
            }
        }

        await sleep(400);
    }

    // ── Summary ────────────────────────────────────────────────────────
    const deployerAfter = await usdcView.balanceOf(deployer.address).catch(() => 0n);
    const oldVaultAfter = await usdcView.balanceOf(OLD_VAULT).catch(() => 0n);

    console.log('\n' + '═'.repeat(70));
    console.log('  ✅  RECOVERY COMPLETE');
    console.log('═'.repeat(70));
    console.log(`  Deployer USDC before: ${fmt6(deployerBefore)}`);
    console.log(`  Deployer USDC after:  ${fmt6(deployerAfter)}`);
    console.log(`  Net recovered:        ${fmt6(deployerAfter - deployerBefore)}`);
    console.log(`  Old vault remaining:  ${fmt6(oldVaultAfter)} (locked positions not withdrawable)`);
    console.log('═'.repeat(70) + '\n');
}

main().catch(err => { console.error('\n❌ Fatal:', err.message); process.exit(1); });
