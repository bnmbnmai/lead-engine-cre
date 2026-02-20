/**
 * scripts/consolidate-all-funds.mjs
 *
 * Full assessment + redistribution of ETH and USDC from all demo wallets
 * back to the deployer wallet on Base Sepolia.
 *
 * Covers:
 *   - PersonalEscrowVault v2  (0x11bb8AFe…B4)   ← active
 *   - PersonalEscrowVault v1  (0xcB949C…CE13)   ← retired, may still hold funds
 *   - Wallet-level USDC balances
 *   - Residual ETH (returned to deployer after sweeping)
 *
 * Usage:
 *   node scripts/consolidate-all-funds.mjs
 *
 * Env (reads from backend/.env via dotenv, or system env):
 *   RPC_URL_BASE_SEPOLIA
 *   VAULT_ADDRESS_BASE_SEPOLIA
 *   DEPLOYER_PRIVATE_KEY
 */

import { ethers } from 'ethers';
import { createInterface } from 'readline';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Load backend/.env ─────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dir, '../backend/.env') });

// ── Config ────────────────────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_PK = (process.env.DEPLOYER_PRIVATE_KEY || '').startsWith('0x')
    ? process.env.DEPLOYER_PRIVATE_KEY
    : '0x' + (process.env.DEPLOYER_PRIVATE_KEY || '');
const USDC_ADDR = process.env.USDC_CONTRACT_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const VAULT_V2 = process.env.VAULT_ADDRESS_BASE_SEPOLIA || '0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4';
const VAULT_V1 = '0xcB949C0867B39C5adDDe45031E6C760A0Aa0CE13'; // retired — sweep residuals

// ── Wallet roster ─────────────────────────────────────────────────────────
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

// ── ABIs ──────────────────────────────────────────────────────────────────
const VAULT_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function lockedBalances(address) view returns (uint256)',
    'function withdraw(uint256) external',
    // v2 only — safe to call on v1 (will revert, caught in try/catch)
    'function refundBid(uint256 lockId) external',
];
const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
];

// ── Helpers ───────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt6 = n => ('$' + ethers.formatUnits(n, 6)).padStart(12);
const fmtEth = n => (ethers.formatEther(n) + ' ETH').padStart(16);

async function confirm(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(res => rl.question(question, ans => { rl.close(); res(ans.trim().toLowerCase()); }));
}

/**
 * Send USDC with up to 3 retries, 20% gas escalation per attempt.
 * Re-reads live balance before each attempt.
 */
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
            console.log(`  ✅ USDC sweep: ${fmt6(bal).trim()} (attempt ${att})`);
            return bal;
        } catch (e) {
            if (att < 3) {
                console.log(`  ⚠️  USDC sweep attempt ${att}/3 failed: ${e.message?.slice(0, 70)} — retrying…`);
                await sleep(2000 * att);
            } else {
                console.log(`  ❌ USDC sweep failed after 3 attempts: ${e.message?.slice(0, 70)}`);
            }
        }
    }
    return 0n;
}

/** Top-up ETH from deployer to wallet if wallet < minEth. */
async function ensureGas(deployer, addr, minEth = '0.0005', topUp = '0.001', provider) {
    const bal = await provider.getBalance(addr);
    if (bal < ethers.parseEther(minEth)) {
        console.log(`  ⛽ Topping up ETH → ${addr.slice(0, 10)}…`);
        const tx = await deployer.sendTransaction({ to: addr, value: ethers.parseEther(topUp) });
        await tx.wait();
        console.log(`  ✅ ETH top-up confirmed`);
    }
}

/** Withdraw free vault balance. Returns amount withdrawn. */
async function withdrawVault(signer, vaultAddr, label, deployer, provider) {
    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, signer);
    try {
        const free = await vault.balanceOf(signer.address);
        const locked = await vault.lockedBalances(signer.address);
        if (locked > 0n) {
            console.log(`  ⚠️  ${fmt6(locked).trim()} locked in vault ${vaultAddr.slice(0, 10)}… — cannot withdraw locked portion`);
        }
        if (free === 0n) {
            console.log(`  💤 Vault ${vaultAddr.slice(0, 10)}…: empty`);
            return 0n;
        }
        await ensureGas(deployer, signer.address, '0.0005', '0.001', provider);
        for (let att = 1; att <= 3; att++) {
            try {
                const liveFree = await vault.balanceOf(signer.address);
                if (liveFree === 0n) return 0n;
                const tx = await vault.withdraw(liveFree);
                await tx.wait();
                console.log(`  ✅ Vault ${vaultAddr.slice(0, 10)}… withdraw: ${fmt6(liveFree).trim()}`);
                return liveFree;
            } catch (e) {
                if (att < 3) {
                    console.log(`  ⚠️  Vault withdraw attempt ${att}/3 failed: ${e.message?.slice(0, 70)} — retrying…`);
                    await sleep(2000 * att);
                } else {
                    console.log(`  ❌ Vault withdraw failed: ${e.message?.slice(0, 70)}`);
                }
            }
        }
    } catch (e) {
        console.log(`  ⚠️  Vault ${vaultAddr.slice(0, 10)}… read error: ${e.message?.slice(0, 70)}`);
    }
    return 0n;
}

/** Return residual ETH to deployer (keep 0.0001 ETH for gas). */
async function returnEth(signer, deployerAddr, provider) {
    const bal = await provider.getBalance(signer.address);
    const keep = ethers.parseEther('0.0001');
    if (bal <= keep) return 0n;
    const send = bal - keep;
    // Estimate gas cost first
    const fee = await provider.getFeeData();
    const gasPrice = fee.gasPrice ?? ethers.parseUnits('1', 'gwei');
    const gasLimit = 21000n;
    const gasCost = gasPrice * gasLimit;
    if (send <= gasCost) return 0n; // not worth sending
    const netSend = send - gasCost;
    try {
        const tx = await signer.sendTransaction({ to: deployerAddr, value: netSend, gasLimit, gasPrice });
        await tx.wait();
        console.log(`  ✅ ETH returned: ${ethers.formatEther(netSend)} ETH`);
        return netSend;
    } catch (e) {
        console.log(`  ⚠️  ETH return failed: ${e.message?.slice(0, 70)}`);
        return 0n;
    }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n' + '═'.repeat(70));
    console.log('  💰 Lead Engine CRE — Full Fund Consolidation');
    console.log('  ' + new Date().toISOString());
    console.log('═'.repeat(70));

    if (!DEPLOYER_PK || DEPLOYER_PK === '0x') {
        console.error('❌ DEPLOYER_PRIVATE_KEY not set. Check backend/.env');
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
    const deployerUsdc = new ethers.Contract(USDC_ADDR, USDC_ABI, provider);

    console.log(`\n  RPC:      ${RPC_URL}`);
    console.log(`  Deployer: ${deployer.address}`);
    console.log(`  USDC:     ${USDC_ADDR}`);
    console.log(`  Vault v2: ${VAULT_V2}`);
    console.log(`  Vault v1: ${VAULT_V1} (retired)`);

    // ── ASSESSMENT PHASE ─────────────────────────────────────────────────

    console.log('\n' + '─'.repeat(70));
    console.log('  📊  ASSESSMENT');
    console.log('─'.repeat(70));
    console.log(
        '  ' +
        'Wallet'.padEnd(22) +
        'ETH'.padStart(16) +
        'USDC (wallet)'.padStart(14) +
        'USDC (v2 vault)'.padStart(16) +
        'USDC (v1 vault)'.padStart(16)
    );
    console.log('  ' + '─'.repeat(82));

    // snapshot data
    const snap = [];
    let totalEth = 0n, totalUsdc = 0n, totalVaultV2 = 0n, totalVaultV1 = 0n;

    // Deployer first
    {
        const eth = await provider.getBalance(deployer.address);
        const usdc = await deployerUsdc.balanceOf(deployer.address);
        const vv2 = await new ethers.Contract(VAULT_V2, VAULT_ABI, provider).balanceOf(deployer.address).catch(() => 0n);
        const vv1 = await new ethers.Contract(VAULT_V1, VAULT_ABI, provider).balanceOf(deployer.address).catch(() => 0n);
        snap.push({ label: 'Deployer', addr: deployer.address, pk: null, eth, usdc, vaultV2: vv2, vaultV1: vv1 });
        totalEth += eth; totalUsdc += usdc; totalVaultV2 += vv2; totalVaultV1 += vv1;
        console.log('  ' + 'Deployer'.padEnd(22) + fmtEth(eth) + fmt6(usdc) + fmt6(vv2) + fmt6(vv1));
    }

    for (const w of WALLETS) {
        const signer = new ethers.Wallet(w.pk, provider);
        const eth = await provider.getBalance(w.addr);
        const usdc = await new ethers.Contract(USDC_ADDR, USDC_ABI, provider).balanceOf(w.addr);
        const vv2 = await new ethers.Contract(VAULT_V2, VAULT_ABI, provider).balanceOf(w.addr).catch(() => 0n);
        const vv1 = await new ethers.Contract(VAULT_V1, VAULT_ABI, provider).balanceOf(w.addr).catch(() => 0n);
        snap.push({ ...w, eth, usdc, vaultV2: vv2, vaultV1: vv1 });
        totalEth += eth; totalUsdc += usdc; totalVaultV2 += vv2; totalVaultV1 += vv1;
        console.log('  ' + w.label.padEnd(22) + fmtEth(eth) + fmt6(usdc) + fmt6(vv2) + fmt6(vv1));
        await sleep(200);
    }

    console.log('  ' + '─'.repeat(82));
    const grandTotal = totalUsdc + totalVaultV2 + totalVaultV1;
    console.log('  ' + 'TOTALS'.padEnd(22) + fmtEth(totalEth) + fmt6(totalUsdc) + fmt6(totalVaultV2) + fmt6(totalVaultV1));
    console.log('\n  Grand total USDC (all sources): ' + fmt6(grandTotal).trim());
    console.log('  Grand total ETH (all wallets):  ' + ethers.formatEther(totalEth) + ' ETH');

    // Highlight anything stranded in v1
    if (totalVaultV1 > 0n) {
        console.log('\n  ⚠️  Retired v1 vault still holds ' + fmt6(totalVaultV1).trim() + ' — will be swept.');
    }

    // ── CONFIRM ──────────────────────────────────────────────────────────
    console.log('');
    const ans = await confirm('  Proceed with redistribution to deployer? (yes/no): ');
    if (ans !== 'yes' && ans !== 'y') {
        console.log('\n  Aborted. No funds moved.\n');
        process.exit(0);
    }

    // ── REDISTRIBUTION PHASE ─────────────────────────────────────────────
    console.log('\n' + '─'.repeat(70));
    console.log('  ♻️   REDISTRIBUTION');
    console.log('─'.repeat(70));

    const deployerUsdcBefore = await deployerUsdc.balanceOf(deployer.address);
    const deployerEthBefore = await provider.getBalance(deployer.address);

    let totalSweptUsdc = 0n;
    let totalReturnedEth = 0n;

    for (const w of snap) {
        if (!w.pk) continue; // skip deployer row
        console.log(`\n  ▸ ${w.label} — ${w.addr}`);
        const signer = new ethers.Wallet(w.pk, provider);

        // 1. Withdraw from v1 vault (retired)
        if (w.vaultV1 > 0n) {
            totalSweptUsdc += await withdrawVault(signer, VAULT_V1, 'v1', deployer, provider);
            await sleep(500);
        }

        // 2. Withdraw from v2 vault
        if (w.vaultV2 > 0n) {
            totalSweptUsdc += await withdrawVault(signer, VAULT_V2, 'v2', deployer, provider);
            await sleep(500);
        }

        // 3. Sweep USDC to deployer
        const usdcNow = await new ethers.Contract(USDC_ADDR, USDC_ABI, provider).balanceOf(w.addr);
        if (usdcNow > 0n) {
            await ensureGas(deployer, w.addr, '0.0005', '0.001', provider);
            totalSweptUsdc += await sweepUsdc(signer, deployer.address, w.label, provider);
            await sleep(500);
        } else {
            console.log(`  💤 Wallet USDC: empty`);
        }

        // 4. Return residual ETH to deployer
        const ethNow = await provider.getBalance(w.addr);
        if (ethNow > ethers.parseEther('0.0002')) {
            totalReturnedEth += await returnEth(signer, deployer.address, provider);
        } else {
            console.log(`  💤 ETH: ${ethers.formatEther(ethNow)} — too low to return`);
        }

        await sleep(300);
    }

    // ── FINAL SUMMARY ────────────────────────────────────────────────────
    const deployerUsdcAfter = await deployerUsdc.balanceOf(deployer.address);
    const deployerEthAfter = await provider.getBalance(deployer.address);

    console.log('\n' + '═'.repeat(70));
    console.log('  ✅  CONSOLIDATION COMPLETE');
    console.log('═'.repeat(70));
    console.log('  Deployer USDC before: ' + fmt6(deployerUsdcBefore).trim());
    console.log('  Deployer USDC after:  ' + fmt6(deployerUsdcAfter).trim());
    console.log('  Net USDC gained:      ' + fmt6(deployerUsdcAfter - deployerUsdcBefore).trim());
    console.log('');
    console.log('  Deployer ETH before:  ' + ethers.formatEther(deployerEthBefore) + ' ETH');
    console.log('  Deployer ETH after:   ' + ethers.formatEther(deployerEthAfter) + ' ETH');
    console.log('');
    console.log('  Total USDC swept:     ' + fmt6(totalSweptUsdc).trim());
    console.log('  Total ETH returned:   ' + ethers.formatEther(totalReturnedEth) + ' ETH');
    console.log('═'.repeat(70) + '\n');
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
});
