/**
 * scripts/consolidate-usdc-only.mjs
 *
 * Sweeps all USDC from demo wallets → deployer wallet.
 * ETH is left untouched in every wallet.
 *
 * Steps per wallet:
 *   1. Withdraw free balance from Vault v2 (PersonalEscrowVault, active)
 *   2. Withdraw free balance from Vault v1 (retired — sweep residuals)
 *   3. Transfer wallet-level USDC → deployer
 *
 * Usage:
 *   node scripts/consolidate-usdc-only.mjs
 */

import { ethers } from 'ethers';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dir = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dir, '../backend/.env') });

// ── Config ────────────────────────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_PK = (process.env.DEPLOYER_PRIVATE_KEY || '').startsWith('0x')
    ? process.env.DEPLOYER_PRIVATE_KEY
    : '0x' + (process.env.DEPLOYER_PRIVATE_KEY || '');
const USDC_ADDR = process.env.USDC_CONTRACT_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const VAULT_V2 = process.env.VAULT_ADDRESS_BASE_SEPOLIA || '0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4';
const VAULT_V1 = '0xcB949C0867B39C5adDDe45031E6C760A0Aa0CE13'; // retired

// ── Wallets ───────────────────────────────────────────────────────────────────
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

// ── ABIs ──────────────────────────────────────────────────────────────────────
const VAULT_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function lockedBalances(address) view returns (uint256)',
    'function withdraw(uint256) external',
];
const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt6 = n => ('$' + ethers.formatUnits(n, 6)).padStart(12);
const fmtEth = n => (ethers.formatEther(n) + ' ETH').padStart(16);

async function confirm(q) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(res => rl.question(q, ans => { rl.close(); res(ans.trim().toLowerCase()); }));
}

/**
 * Top-up ETH for gas ONLY — keeps wallet ETH as-is beyond the top-up floor.
 * Used only when a wallet needs to sign a vault withdraw or USDC transfer.
 */
async function ensureGas(deployer, addr, provider) {
    const bal = await provider.getBalance(addr);
    const MIN = ethers.parseEther('0.0005');
    const TOP = ethers.parseEther('0.001');
    if (bal < MIN) {
        console.log(`  ⛽ Topping up gas ETH → ${addr.slice(0, 10)}… (+${ethers.formatEther(TOP)} ETH)`);
        const tx = await deployer.sendTransaction({ to: addr, value: TOP });
        await tx.wait();
    }
}

/** Withdraw free vault balance to wallet, then USDC transfer happens next. */
async function withdrawVault(signer, vaultAddr, tag, deployer, provider) {
    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, signer);
    try {
        const free = await vault.balanceOf(signer.address);
        const locked = await vault.lockedBalances(signer.address);
        if (locked > 0n) console.log(`  ⚠️  ${fmt6(locked).trim()} LOCKED in vault ${tag} — skipping locked portion`);
        if (free === 0n) { console.log(`  💤 Vault ${tag}: empty`); return 0n; }

        await ensureGas(deployer, signer.address, provider);
        for (let att = 1; att <= 3; att++) {
            try {
                const live = await vault.balanceOf(signer.address);
                if (live === 0n) return 0n;
                const tx = await vault.withdraw(live);
                await tx.wait();
                console.log(`  ✅ Vault ${tag} withdraw: ${fmt6(live).trim()}`);
                return live;
            } catch (e) {
                if (att < 3) {
                    console.log(`  ⚠️  Vault ${tag} withdraw att ${att}/3 failed: ${e.message?.slice(0, 70)} — retrying…`);
                    await sleep(2000 * att);
                } else {
                    console.log(`  ❌ Vault ${tag} withdraw failed: ${e.message?.slice(0, 70)}`);
                }
            }
        }
    } catch (e) {
        console.log(`  ⚠️  Vault ${tag} read error: ${e.message?.slice(0, 70)}`);
    }
    return 0n;
}

/** Transfer all wallet USDC → deployer. */
async function sweepUsdc(signer, deployerAddr, label, provider) {
    const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, signer);
    for (let att = 1; att <= 3; att++) {
        try {
            const bal = await usdc.balanceOf(signer.address);
            if (bal === 0n) return 0n;
            const fee = await provider.getFeeData();
            const gp = fee.gasPrice ? (fee.gasPrice * BigInt(100 + (att - 1) * 20)) / 100n : undefined;
            const tx = await usdc.transfer(deployerAddr, bal, gp ? { gasPrice: gp } : {});
            await tx.wait();
            console.log(`  ✅ USDC swept: ${fmt6(bal).trim()} (attempt ${att})`);
            return bal;
        } catch (e) {
            if (att < 3) {
                console.log(`  ⚠️  USDC sweep att ${att}/3 failed: ${e.message?.slice(0, 70)} — retrying…`);
                await sleep(2000 * att);
            } else {
                console.log(`  ❌ USDC sweep failed: ${e.message?.slice(0, 70)}`);
            }
        }
    }
    return 0n;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n' + '═'.repeat(70));
    console.log('  💵  USDC-ONLY Consolidation → Deployer');
    console.log('  ⚠️   ETH balances will NOT be touched.');
    console.log('  ' + new Date().toISOString());
    console.log('═'.repeat(70));

    if (!DEPLOYER_PK || DEPLOYER_PK === '0x') {
        console.error('❌ DEPLOYER_PRIVATE_KEY not set. Check backend/.env');
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
    const usdcView = new ethers.Contract(USDC_ADDR, USDC_ABI, provider);

    console.log(`\n  RPC:      ${RPC_URL}`);
    console.log(`  Deployer: ${deployer.address}`);
    console.log(`  USDC:     ${USDC_ADDR}`);
    console.log(`  Vault v2: ${VAULT_V2} (active)`);
    console.log(`  Vault v1: ${VAULT_V1} (retired)`);

    // ── ASSESSMENT ────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(70));
    console.log('  📊  BALANCES (USDC)');
    console.log('─'.repeat(70));
    console.log(
        '  ' +
        'Wallet'.padEnd(24) +
        'ETH'.padStart(16) +
        'USDC (wallet)'.padStart(14) +
        'USDC (v2)'.padStart(12) +
        'USDC (v1)'.padStart(12)
    );
    console.log('  ' + '─'.repeat(78));

    const snap = [];
    let totalEth = 0n, totalWalletUsdc = 0n, totalV2 = 0n, totalV1 = 0n;

    // Deployer row (info only — not swept)
    {
        const eth = await provider.getBalance(deployer.address);
        const usdc = await usdcView.balanceOf(deployer.address);
        const vv2 = await new ethers.Contract(VAULT_V2, VAULT_ABI, provider).balanceOf(deployer.address).catch(() => 0n);
        const vv1 = await new ethers.Contract(VAULT_V1, VAULT_ABI, provider).balanceOf(deployer.address).catch(() => 0n);
        snap.push({ label: 'Deployer', addr: deployer.address, pk: null, eth, usdc, vaultV2: vv2, vaultV1: vv1 });
        totalEth += eth;
        console.log('  ' + 'Deployer (target)'.padEnd(24) + fmtEth(eth) + fmt6(usdc) + fmt6(vv2) + fmt6(vv1));
    }

    for (const w of WALLETS) {
        const eth = await provider.getBalance(w.addr);
        const usdc = await usdcView.balanceOf(w.addr);
        const vv2 = await new ethers.Contract(VAULT_V2, VAULT_ABI, provider).balanceOf(w.addr).catch(() => 0n);
        const vv1 = await new ethers.Contract(VAULT_V1, VAULT_ABI, provider).balanceOf(w.addr).catch(() => 0n);
        snap.push({ ...w, eth, usdc, vaultV2: vv2, vaultV1: vv1 });
        totalEth += eth; totalWalletUsdc += usdc; totalV2 += vv2; totalV1 += vv1;
        console.log('  ' + w.label.padEnd(24) + fmtEth(eth) + fmt6(usdc) + fmt6(vv2) + fmt6(vv1));
        await sleep(150);
    }

    console.log('  ' + '─'.repeat(78));
    const grandUsdc = totalWalletUsdc + totalV2 + totalV1;
    console.log('  ' + 'TOTALS (demo wallets)'.padEnd(24) + fmtEth(totalEth - snap[0].eth) + fmt6(totalWalletUsdc) + fmt6(totalV2) + fmt6(totalV1));
    console.log('\n  Total USDC to sweep: ' + fmt6(grandUsdc).trim());
    console.log('  Total ETH stays:     ' + ethers.formatEther(totalEth - snap[0].eth) + ' ETH (untouched)');

    if (totalV1 > 0n) console.log('\n  ⚠️  Retired v1 vault holds ' + fmt6(totalV1).trim() + ' — will be swept.');
    if (grandUsdc === 0n) {
        console.log('\n  Nothing to sweep. All wallets are empty. Exiting.\n');
        process.exit(0);
    }

    // ── CONFIRM ───────────────────────────────────────────────────────────────
    console.log('');
    const ans = await confirm('  Proceed? USDC only, ETH untouched (yes/no): ');
    if (ans !== 'yes' && ans !== 'y') {
        console.log('\n  Aborted. No funds moved.\n');
        process.exit(0);
    }

    // ── SWEEP ─────────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(70));
    console.log('  ♻️   SWEEPING USDC');
    console.log('─'.repeat(70));

    const usdcBefore = await usdcView.balanceOf(deployer.address);
    const ethBefore = await provider.getBalance(deployer.address);
    let totalSwept = 0n;

    for (const w of snap) {
        if (!w.pk) continue; // skip deployer row
        const anyUsdc = w.usdc > 0n || w.vaultV2 > 0n || w.vaultV1 > 0n;
        if (!anyUsdc) {
            console.log(`\n  ▸ ${w.label}: no USDC — skipping`);
            continue;
        }
        console.log(`\n  ▸ ${w.label} — ${w.addr}`);
        const signer = new ethers.Wallet(w.pk, provider);

        // 1. Vault v1 (retired)
        if (w.vaultV1 > 0n) {
            totalSwept += await withdrawVault(signer, VAULT_V1, 'v1', deployer, provider);
            await sleep(500);
        }

        // 2. Vault v2 (active)
        if (w.vaultV2 > 0n) {
            totalSwept += await withdrawVault(signer, VAULT_V2, 'v2', deployer, provider);
            await sleep(500);
        }

        // 3. Wallet-level USDC
        const usdcNow = await usdcView.balanceOf(w.addr);
        if (usdcNow > 0n) {
            await ensureGas(deployer, w.addr, provider);
            totalSwept += await sweepUsdc(signer, deployer.address, w.label, provider);
        } else {
            console.log(`  💤 Wallet USDC: empty after vault withdraw`);
        }

        await sleep(300);
    }

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    const usdcAfter = await usdcView.balanceOf(deployer.address);
    const ethAfter = await provider.getBalance(deployer.address);

    console.log('\n' + '═'.repeat(70));
    console.log('  ✅  USDC CONSOLIDATION COMPLETE');
    console.log('═'.repeat(70));
    console.log('  Deployer USDC before: ' + fmt6(usdcBefore).trim());
    console.log('  Deployer USDC after:  ' + fmt6(usdcAfter).trim());
    console.log('  Net USDC gained:      ' + fmt6(usdcAfter - usdcBefore).trim());
    console.log('');
    console.log('  Deployer ETH before:  ' + ethers.formatEther(ethBefore) + ' ETH');
    console.log('  Deployer ETH after:   ' + ethers.formatEther(ethAfter) + ' ETH  (delta = gas only)');
    console.log('  ETH delta (gas cost): ' + ethers.formatEther(ethBefore > ethAfter ? ethBefore - ethAfter : 0n) + ' ETH');
    console.log('');
    console.log('  Total USDC swept:     ' + fmt6(totalSwept).trim());
    console.log('═'.repeat(70) + '\n');
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
});
