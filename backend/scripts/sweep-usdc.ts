/**
 * sweep-usdc.ts — Sweep all USDC from buyer/seller wallets to deployer
 *
 * Sweeps both:
 *   1. Raw USDC holdings (ERC-20 balanceOf)
 *   2. Vault free balances (withdraw + transfer)
 *
 * Usage: npx ts-node scripts/sweep-usdc.ts
 * Requires: DEPLOYER_PRIVATE_KEY, VAULT_ADDRESS_BASE_SEPOLIA in .env
 */

import 'dotenv/config';
import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const USDC_ADDRESS = process.env.USDC_CONTRACT_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const VAULT_ADDRESS = process.env.VAULT_ADDRESS_BASE_SEPOLIA || '';

const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
];

const VAULT_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function lockedBalances(address) view returns (uint256)',
    'function withdraw(uint256 amount) external',
];

// All wallets with keys (from faucet-wallets.txt)
const WALLETS = [
    { label: 'Wallet 1  (buyer)', addr: '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9', key: '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439' },
    { label: 'Wallet 2  (buyer)', addr: '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC', key: '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618' },
    { label: 'Wallet 3  (buyer)', addr: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58', key: '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e' },
    { label: 'Wallet 4  (buyer)', addr: '0x424CaC929939377f221348af52d4cb1247fE4379', key: '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7' },
    { label: 'Wallet 5  (buyer)', addr: '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d', key: '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7' },
    { label: 'Wallet 6  (buyer)', addr: '0x089B6Bdb4824628c5535acF60aBF80683452e862', key: '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75' },
    { label: 'Wallet 7  (buyer)', addr: '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE', key: '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510' },
    { label: 'Wallet 8  (buyer)', addr: '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C', key: '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd' },
    { label: 'Wallet 9  (buyer)', addr: '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf', key: '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c' },
    { label: 'Wallet 10 (buyer)', addr: '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad', key: '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382' },
    { label: 'Wallet 11 (seller)', addr: '0x9Bb15F98982715E33a2113a35662036528eE0A36', key: '0x618bee99ca60f5511dad533a998344f3a0a7b2339db5726ae33d56fd543294ce' },
];

async function main() {
    if (!DEPLOYER_KEY) { console.error('❌ DEPLOYER_PRIVATE_KEY not set'); process.exit(1); }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
    const deployerAddr = deployer.address;

    console.log(`\n🧹 USDC Sweep → Deployer ${deployerAddr}`);
    console.log(`   USDC:  ${USDC_ADDRESS}`);
    console.log(`   Vault: ${VAULT_ADDRESS || '(not set — skipping vault withdrawals)'}`);
    console.log(`   RPC:   ${RPC_URL}\n`);

    // Show deployer starting balance
    const deployerUsdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, deployer);
    const startBal = await deployerUsdc.balanceOf(deployerAddr);
    console.log(`📊 Deployer starting USDC: $${(Number(startBal) / 1e6).toFixed(2)}\n`);

    let totalSwept = 0n;
    let walletCount = 0;

    for (const { label, addr, key } of WALLETS) {
        try {
            const signer = new ethers.Wallet(key, provider);
            const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);

            // 1. Vault withdrawal (if vault is configured)
            if (VAULT_ADDRESS) {
                const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);
                const vaultFree: bigint = await vault.balanceOf(addr).catch(() => 0n);
                const vaultLocked: bigint = await vault.lockedBalances(addr).catch(() => 0n);

                if (vaultFree > 0n) {
                    try {
                        const wNonce = await provider.getTransactionCount(addr, 'pending');
                        const wTx = await vault.withdraw(vaultFree, { nonce: wNonce });
                        await wTx.wait();
                        console.log(`  🏦 ${label}: vault withdraw $${(Number(vaultFree) / 1e6).toFixed(2)}`);
                    } catch (wErr: any) {
                        console.log(`  ⚠️  ${label}: vault withdraw failed: ${wErr.message?.slice(0, 60)}`);
                    }
                }
                if (vaultLocked > 0n) {
                    console.log(`  🔒 ${label}: $${(Number(vaultLocked) / 1e6).toFixed(2)} locked (cannot withdraw)`);
                }
            }

            // 2. Raw USDC transfer to deployer
            const bal: bigint = await usdc.balanceOf(addr);
            if (bal <= 0n) {
                console.log(`  ⏭️  ${label}: $0.00 — skip`);
                continue;
            }

            const nonce = await provider.getTransactionCount(addr, 'pending');
            const tx = await usdc.transfer(deployerAddr, bal, { nonce });
            await tx.wait();

            totalSwept += bal;
            walletCount++;
            console.log(`  ✅ ${label}: swept $${(Number(bal) / 1e6).toFixed(2)} → deployer`);
        } catch (err: any) {
            console.log(`  ❌ ${label}: ${err.message?.slice(0, 80)}`);
        }
    }

    const endBal = await deployerUsdc.balanceOf(deployerAddr);
    console.log(`\n${'═'.repeat(56)}`);
    console.log(`✅ Sweep complete: $${(Number(totalSwept) / 1e6).toFixed(2)} from ${walletCount} wallets`);
    console.log(`📊 Deployer final USDC: $${(Number(endBal) / 1e6).toFixed(2)}`);
    console.log(`${'═'.repeat(56)}\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
