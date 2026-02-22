/**
 * scripts/usdc-forensics.mjs
 *
 * Full USDC forensic sweep — checks every address that could hold demo USDC:
 *   - All 11 demo wallets (wallet-level)
 *   - Vault v2 free balances per wallet
 *   - Vault v2 LOCKED balances per wallet
 *   - Vault v1 free + locked per wallet
 *   - Vault v2 contract's own USDC balance (total held)
 *   - Vault v1 contract's own USDC balance
 *   - Platform wallet USDC
 *   - Deployer wallet USDC
 *
 * Usage:
 *   node scripts/usdc-forensics.mjs
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
const VAULT_V1 = '0xcB949C0867B39C5adDDe45031E6C760A0Aa0CE13';

// Platform wallet — receives 5% fee + $1/lock convenience fee
const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS || '';

const DEMO_WALLETS = [
    { label: 'Wallet 1  (buyer)', addr: '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9' },
    { label: 'Wallet 2  (buyer)', addr: '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC' },
    { label: 'Wallet 3  (buyer)', addr: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58' },
    { label: 'Wallet 4  (buyer)', addr: '0x424CaC929939377f221348af52d4cb1247fE4379' },
    { label: 'Wallet 5  (buyer)', addr: '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d' },
    { label: 'Wallet 6  (buyer)', addr: '0x089B6Bdb4824628c5535acF60aBF80683452e862' },
    { label: 'Wallet 7  (buyer)', addr: '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE' },
    { label: 'Wallet 8  (buyer)', addr: '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C' },
    { label: 'Wallet 9  (buyer)', addr: '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf' },
    { label: 'Wallet 10 (buyer)', addr: '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad' },
    { label: 'Wallet 11 (seller)', addr: '0x9Bb15F98982715E33a2113a35662036528eE0A36' },
];

const VAULT_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function balances(address) view returns (uint256)',       // fallback name
    'function lockedBalances(address) view returns (uint256)',
    'function totalObligations() view returns (uint256)',
    'function lastPorSolvent() view returns (bool)',
];
const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
];

const fmt6 = n => ('$' + (Number(n) / 1e6).toFixed(2)).padStart(12);
const fmtAddr = a => a.slice(0, 10) + '…';

async function safeCall(contract, method, ...args) {
    try { return await contract[method](...args); }
    catch { return 0n; }
}

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
    const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, provider);
    const vv2 = new ethers.Contract(VAULT_V2, VAULT_ABI, provider);
    const vv1 = new ethers.Contract(VAULT_V1, VAULT_ABI, provider);

    console.log('\n' + '═'.repeat(90));
    console.log('  🔍  USDC FORENSICS — Full Balance Scan');
    console.log('  ' + new Date().toISOString());
    console.log('═'.repeat(90));
    console.log(`  Deployer:  ${deployer.address}`);
    console.log(`  Vault v2:  ${VAULT_V2}`);
    console.log(`  Vault v1:  ${VAULT_V1} (retired)`);
    console.log(`  USDC:      ${USDC_ADDR}`);
    if (PLATFORM_WALLET) console.log(`  Platform:  ${PLATFORM_WALLET}`);

    // ── Vault contract-level USDC ──────────────────────────────────────
    const vv2ContractUsdc = await safeCall(usdc, 'balanceOf', VAULT_V2);
    const vv1ContractUsdc = await safeCall(usdc, 'balanceOf', VAULT_V1);
    const vv2Obligations = await safeCall(vv2, 'totalObligations');

    console.log('\n' + '─'.repeat(90));
    console.log('  📦  VAULT CONTRACT USDC HOLDINGS');
    console.log('─'.repeat(90));
    console.log(`  Vault v2 USDC balance (contract holds): ${fmt6(vv2ContractUsdc).trim()}`);
    console.log(`  Vault v2 totalObligations:              ${fmt6(vv2Obligations).trim()}`);
    const surplusDeficit = BigInt(vv2ContractUsdc) - BigInt(vv2Obligations);
    const sign = surplusDeficit >= 0n ? '+' : '-';
    console.log(`  Vault v2 surplus/deficit:               ${sign}$${(Math.abs(Number(surplusDeficit)) / 1e6).toFixed(2)}`);
    console.log(`  Vault v1 USDC balance (contract holds): ${fmt6(vv1ContractUsdc).trim()}`);

    // ── Per-wallet breakdown ───────────────────────────────────────────
    console.log('\n' + '─'.repeat(90));
    console.log('  👛  PER-WALLET USDC BREAKDOWN');
    console.log('─'.repeat(90));
    console.log(
        '  ' +
        'Wallet'.padEnd(22) +
        'Wallet USDC'.padStart(14) +
        'V2 free'.padStart(12) +
        'V2 locked'.padStart(12) +
        'V1 free'.padStart(12) +
        'V1 locked'.padStart(12) +
        'TOTAL'.padStart(12)
    );
    console.log('  ' + '─'.repeat(84));

    let totalWallet = 0n, totalV2Free = 0n, totalV2Locked = 0n, totalV1Free = 0n, totalV1Locked = 0n;

    for (const w of DEMO_WALLETS) {
        const walletUsdc = await safeCall(usdc, 'balanceOf', w.addr);
        const v2Free = await safeCall(vv2, 'balanceOf', w.addr);
        const v2Locked = await safeCall(vv2, 'lockedBalances', w.addr);
        const v1Free = await safeCall(vv1, 'balanceOf', w.addr);
        const v1Locked = await safeCall(vv1, 'lockedBalances', w.addr);
        const total = BigInt(walletUsdc) + BigInt(v2Free) + BigInt(v2Locked) + BigInt(v1Free) + BigInt(v1Locked);

        totalWallet += BigInt(walletUsdc);
        totalV2Free += BigInt(v2Free);
        totalV2Locked += BigInt(v2Locked);
        totalV1Free += BigInt(v1Free);
        totalV1Locked += BigInt(v1Locked);

        const flags = [];
        if (v2Locked > 0n) flags.push('⚠️ LOCKED-V2');
        if (v1Locked > 0n) flags.push('⚠️ LOCKED-V1');

        console.log(
            '  ' +
            w.label.padEnd(22) +
            fmt6(walletUsdc) +
            fmt6(v2Free) +
            fmt6(v2Locked) +
            fmt6(v1Free) +
            fmt6(v1Locked) +
            fmt6(total) +
            (flags.length ? '  ' + flags.join(' ') : '')
        );
        await new Promise(r => setTimeout(r, 100));
    }

    const grandTotal = totalWallet + totalV2Free + totalV2Locked + totalV1Free + totalV1Locked;
    console.log('  ' + '─'.repeat(84));
    console.log(
        '  ' + 'DEMO WALLET TOTALS'.padEnd(22) +
        fmt6(totalWallet) + fmt6(totalV2Free) + fmt6(totalV2Locked) + fmt6(totalV1Free) + fmt6(totalV1Locked) + fmt6(grandTotal)
    );

    // ── Deployer + Platform ────────────────────────────────────────────
    console.log('\n' + '─'.repeat(90));
    console.log('  🏦  DEPLOYER + PLATFORM WALLETS');
    console.log('─'.repeat(90));
    const deployerUsdc = await safeCall(usdc, 'balanceOf', deployer.address);
    console.log(`  Deployer    ${deployer.address}   USDC: ${fmt6(deployerUsdc).trim()}`);

    let platformUsdc = 0n;
    if (PLATFORM_WALLET) {
        platformUsdc = await safeCall(usdc, 'balanceOf', PLATFORM_WALLET);
        console.log(`  Platform    ${PLATFORM_WALLET}   USDC: ${fmt6(platformUsdc).trim()}`);
    } else {
        console.log('  Platform    (PLATFORM_WALLET_ADDRESS not set in .env — cannot check)');
    }

    // ── Grand Total Accounting ─────────────────────────────────────────
    const allKnown = BigInt(deployerUsdc) + BigInt(platformUsdc) + grandTotal + BigInt(vv2ContractUsdc) + BigInt(vv1ContractUsdc);
    // Note: vaultContractUsdc INCLUDES free+locked for all wallets, so don't double-count.
    // Correct total = wallet-level + vault v2 contract actual USDC + vault v1 + deployer + platform
    const correctTotal = BigInt(deployerUsdc) + BigInt(platformUsdc) + totalWallet + BigInt(vv2ContractUsdc) + BigInt(vv1ContractUsdc);

    console.log('\n' + '─'.repeat(90));
    console.log('  📊  ACCOUNTING SUMMARY');
    console.log('─'.repeat(90));
    console.log(`  Deployer USDC:              ${fmt6(deployerUsdc).trim()}`);
    console.log(`  Platform USDC:              ${fmt6(platformUsdc).trim()}`);
    console.log(`  Demo wallet-level USDC:     ${fmt6(totalWallet).trim()}`);
    console.log(`  Vault v2 contract USDC:     ${fmt6(vv2ContractUsdc).trim()}  (free=${fmt6(totalV2Free).trim().trim()} locked=${fmt6(totalV2Locked).trim()})`);
    console.log(`  Vault v1 contract USDC:     ${fmt6(vv1ContractUsdc).trim()}  (free=${fmt6(totalV1Free).trim().trim()} locked=${fmt6(totalV1Locked).trim()})`);
    console.log('  ' + '─'.repeat(60));
    console.log(`  TOTAL ACCOUNTED:            ${fmt6(correctTotal).trim()}`);
    console.log('\n  ⚠️  Any USDC not in the above = permanently spent on-chain');
    console.log('     (settled bids → seller wallet, or convenience fees → platform wallet)');
    console.log('═'.repeat(90) + '\n');
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
});
