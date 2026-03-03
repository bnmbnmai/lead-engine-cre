/**
 * sweep-vault-simple.mjs — Direct vault drain (no event scanning)
 *
 * Simply queries each demo wallet's free vault balance, withdraws it,
 * then sweeps USDC to deployer. Much faster than event-based scan.
 *
 * Usage:  node scripts/sweep-vault-simple.mjs
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function readEnvVar(name) {
    try {
        const env = readFileSync(resolve(ROOT, 'backend', '.env'), 'utf8');
        const match = env.match(new RegExp(`^${name}=(.+)$`, 'm'));
        return match ? match[1].trim() : '';
    } catch { return process.env[name] ?? ''; }
}

const DEPLOYER_KEY = readEnvVar('DEPLOYER_PRIVATE_KEY');
const RPC = readEnvVar('RPC_URL_BASE_SEPOLIA') || readEnvVar('RPC_URL_SEPOLIA') || 'https://sepolia.base.org';
const VAULT_ADDR = readEnvVar('VAULT_ADDRESS_BASE_SEPOLIA');
const USDC_ADDR = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

if (!VAULT_ADDR) { console.error('VAULT_ADDRESS_BASE_SEPOLIA not set'); process.exit(1); }

const USDC_ABI = ['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)'];
const VAULT_ABI = ['function balanceOf(address) view returns (uint256)', 'function lockedBalances(address) view returns (uint256)', 'function withdraw(uint256 amount)'];

const WALLETS = [
    ['0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9', '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439'],
    ['0x55190CE8A38079d8415A1Ba15d001BC1a52718eC', '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618'],
    ['0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58', '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e'],
    ['0x424CaC929939377f221348af52d4cb1247fE4379', '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7'],
    ['0x3a9a41078992734ab24Dfb51761A327eEaac7b3d', '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7'],
    ['0x089B6Bdb4824628c5535acF60aBF80683452e862', '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75'],
    ['0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE', '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510'],
    ['0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C', '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd'],
    ['0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf', '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c'],
    ['0x7be5ce8824d5c1890bC09042837cEAc57a55fdad', '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382'],
    ['0x9Bb15F98982715E33a2113a35662036528eE0A36', '0x618bee99ca60f5511dad533a998344f3a0a7b2339db5726ae33d56fd543294ce'],
];

const fmt = (wei) => (Number(wei) / 1e6).toFixed(2);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const deployerKey = DEPLOYER_KEY.startsWith('0x') ? DEPLOYER_KEY : '0x' + DEPLOYER_KEY;
const provider = new ethers.JsonRpcProvider(RPC);
const deployer = new ethers.Wallet(deployerKey, provider);
const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, deployer);
const vault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, deployer);

console.log(`\nVault: ${VAULT_ADDR}`);
console.log(`Deployer: ${deployer.address}\n`);

const beforeBal = await usdc.balanceOf(deployer.address);
const vaultBal = await usdc.balanceOf(VAULT_ADDR);
console.log(`Deployer USDC: $${fmt(beforeBal)}`);
console.log(`Vault USDC:    $${fmt(vaultBal)}\n`);

// Step 1: Deployer vault withdraw
console.log('── Deployer vault ──');
try {
    const free = await vault.balanceOf(deployer.address);
    const locked = await vault.lockedBalances(deployer.address);
    console.log(`  Free: $${fmt(free)}  Locked: $${fmt(locked)}`);
    if (free > 0n) {
        const tx = await vault.withdraw(free);
        await tx.wait();
        console.log(`  ✅ Withdrawn $${fmt(free)}`);
        await sleep(3000);
    }
} catch (err) {
    console.log(`  Error: ${err.message?.slice(0, 80)}`);
}

// Step 2: Each demo wallet — vault withdraw + USDC sweep
console.log('\n── Demo wallets ──');
let totalRecovered = 0n;

for (const [addr, pk] of WALLETS) {
    const label = addr.slice(0, 10) + '…';
    await sleep(2000); // rate limit between wallets

    try {
        const wSigner = new ethers.Wallet(pk, provider);
        const wVault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, wSigner);
        const wUsdc = new ethers.Contract(USDC_ADDR, USDC_ABI, wSigner);

        const free = await wVault.balanceOf(addr);
        const locked = await wVault.lockedBalances(addr);

        if (free === 0n && locked === 0n) {
            // Check direct USDC balance too
            const directBal = await wUsdc.balanceOf(addr);
            if (directBal > 0n) {
                const tx = await wUsdc.transfer(deployer.address, directBal);
                await tx.wait();
                console.log(`  ${label}  swept $${fmt(directBal)} USDC (no vault balance)`);
                totalRecovered += directBal;
                await sleep(3000);
            } else {
                console.log(`  ${label}  $0 everywhere — skip`);
            }
            continue;
        }

        console.log(`  ${label}  vault free=$${fmt(free)} locked=$${fmt(locked)}`);

        // Withdraw free balance from vault
        if (free > 0n) {
            try {
                const wTx = await wVault.withdraw(free);
                await wTx.wait();
                console.log(`  ${label}  vault withdrawn: $${fmt(free)}`);
                await sleep(3000);
            } catch (err) {
                console.log(`  ${label}  vault withdraw failed: ${err.shortMessage ?? err.message?.slice(0, 60)}`);
            }
        }

        // Sweep USDC to deployer
        await sleep(1000);
        const bal = await wUsdc.balanceOf(addr);
        if (bal > 0n) {
            try {
                const tx = await wUsdc.transfer(deployer.address, bal);
                await tx.wait();
                console.log(`  ${label}  swept: $${fmt(bal)} → deployer`);
                totalRecovered += bal;
                await sleep(3000);
            } catch (err) {
                console.log(`  ${label}  sweep failed: ${err.shortMessage ?? err.message?.slice(0, 60)}`);
            }
        }
    } catch (err) {
        console.log(`  ${label}  error: ${err.message?.slice(0, 60)}`);
    }
}

// Final summary
await sleep(5000);
const afterBal = await usdc.balanceOf(deployer.address);
const vaultAfter = await usdc.balanceOf(VAULT_ADDR);

console.log(`\n${'='.repeat(50)}`);
console.log(`  Deployer: $${fmt(beforeBal)} → $${fmt(afterBal)}  (+$${fmt(afterBal - beforeBal)})`);
console.log(`  Vault:    $${fmt(vaultBal)} → $${fmt(vaultAfter)}`);
console.log(`  Swept:    $${fmt(totalRecovered)}`);
if (vaultAfter > 0n) {
    console.log(`  ⚠️  $${fmt(vaultAfter)} remains locked in vault (orphaned locks need refundBid)`);
}
console.log('='.repeat(50));
console.log('');
