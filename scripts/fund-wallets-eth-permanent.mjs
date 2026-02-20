/**
 * scripts/fund-wallets-eth-permanent.mjs
 *
 * One-off script to pre-fund all 11 demo wallets with 0.015 ETH each (~$30).
 * After running once, wallets have sufficient ETH for hundreds of demo cycles
 * with no further deployer top-ups required.
 *
 * Usage:
 *   node scripts/fund-wallets-eth-permanent.mjs
 *
 * Env (reads from backend/.env via dotenv):
 *   DEPLOYER_PRIVATE_KEY
 *   RPC_URL_BASE_SEPOLIA
 */

import { ethers } from 'ethers';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dir, '../backend/.env') });

// ── Config ────────────────────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_PK = (process.env.DEPLOYER_PRIVATE_KEY || '').startsWith('0x')
    ? process.env.DEPLOYER_PRIVATE_KEY
    : '0x' + (process.env.DEPLOYER_PRIVATE_KEY || '');

// 0.015 ETH per wallet ≈ $30 at current testnet prices
// Enough for ~300+ USDC approve+transfer transactions at typical Base Sepolia gas prices
const FUND_AMOUNT_ETH = '0.015';

// ── 11 demo wallets (10 buyers + 1 seller) ────────────────────────────────
const RECIPIENTS = [
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

const TARGET_ETH = ethers.parseEther(FUND_AMOUNT_ETH);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtEth = n => ethers.formatEther(n).padStart(14) + ' ETH';

/**
 * sendWithGasEscalation — 3-retry ETH transfer with 1.2× gas multiplier per attempt.
 * Mirrors the logic used in demo-e2e.service.ts.
 */
async function sendWithGasEscalation(deployer, to, value, label) {
    const provider = deployer.provider;
    for (let att = 1; att <= 3; att++) {
        try {
            const feeData = await provider.getFeeData();
            const gasPrice = feeData.gasPrice
                ? (feeData.gasPrice * BigInt(Math.round((1.2 ** (att - 1)) * 100))) / 100n
                : undefined;
            const tx = await deployer.sendTransaction({ to, value, ...(gasPrice ? { gasPrice } : {}) });
            const receipt = await tx.wait();
            return receipt;
        } catch (e) {
            if (att < 3) {
                console.warn(`  ⚠️  Attempt ${att}/3 failed for ${label}: ${e.message?.slice(0, 60)} — retrying…`);
                await sleep(1500 * att);
            } else {
                throw e;
            }
        }
    }
}

async function main() {
    if (!DEPLOYER_PK || DEPLOYER_PK === '0x') {
        console.error('❌ DEPLOYER_PRIVATE_KEY not set. Check backend/.env');
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_PK, provider);

    const totalNeeded = TARGET_ETH * BigInt(RECIPIENTS.length);

    console.log('\n' + '═'.repeat(68));
    console.log('  💸  Lead Engine CRE — Permanent ETH Pre-Fund (0.015 ETH each)');
    console.log('  ' + new Date().toISOString());
    console.log('═'.repeat(68));
    console.log(`  RPC:          ${RPC_URL}`);
    console.log(`  Deployer:     ${deployer.address}`);
    console.log(`  Fund per wallet: ${FUND_AMOUNT_ETH} ETH`);
    console.log(`  Wallets:      ${RECIPIENTS.length}`);
    console.log(`  Total needed: ${ethers.formatEther(totalNeeded)} ETH (est., actual less if wallets already funded)`);

    // ── Pre-flight: read all balances ────────────────────────────────────
    console.log('\n' + '─'.repeat(68));
    console.log('  📊  CURRENT BALANCES (Before)');
    console.log('─'.repeat(68));

    const deployerEthBefore = await provider.getBalance(deployer.address);
    console.log(`  Deployer${' '.repeat(22)}${fmtEth(deployerEthBefore)}`);

    const balances = [];
    for (const { label, addr } of RECIPIENTS) {
        const bal = await provider.getBalance(addr);
        balances.push(bal);
        const alreadyFunded = bal >= TARGET_ETH ? '✅ already ≥ target' : '';
        console.log(`  ${label.padEnd(22)} ${fmtEth(bal)} ${alreadyFunded}`);
        await sleep(100);
    }

    if (deployerEthBefore < ethers.parseEther('0.01')) {
        console.error(`\n❌ Deployer only has ${ethers.formatEther(deployerEthBefore)} ETH. Need at least 0.01 ETH. Bridge more ETH first.`);
        process.exit(1);
    }

    // ── Fund each wallet ─────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(68));
    console.log('  🚀  FUNDING');
    console.log('─'.repeat(68));

    let totalSent = 0n;
    let skipped = 0;

    for (let i = 0; i < RECIPIENTS.length; i++) {
        const { label, addr } = RECIPIENTS[i];
        const currentBal = balances[i];

        if (currentBal >= TARGET_ETH) {
            console.log(`  ⏭️  ${label.padEnd(22)} already has ${ethers.formatEther(currentBal)} ETH — skipping`);
            skipped++;
            continue;
        }

        const toSend = TARGET_ETH - currentBal; // top up to exactly 0.015 ETH
        process.stdout.write(`  ▸ ${label.padEnd(22)} sending ${ethers.formatEther(toSend)} ETH… `);

        try {
            await sendWithGasEscalation(deployer, addr, toSend, label);
            totalSent += toSend;
            console.log('✅');
        } catch (e) {
            console.log(`❌ FAILED: ${e.message?.slice(0, 60)}`);
        }

        await sleep(300);
    }

    // ── After balances ───────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(68));
    console.log('  📊  BALANCES AFTER');
    console.log('─'.repeat(68));

    const deployerEthAfter = await provider.getBalance(deployer.address);
    console.log(`  Deployer${' '.repeat(22)}${fmtEth(deployerEthAfter)}`);

    for (const { label, addr } of RECIPIENTS) {
        const bal = await provider.getBalance(addr);
        const ok = bal >= TARGET_ETH ? '✅' : '⚠️ LOW';
        console.log(`  ${label.padEnd(22)} ${fmtEth(bal)} ${ok}`);
        await sleep(80);
    }

    console.log('\n' + '═'.repeat(68));
    console.log(`  Deployer ETH before:  ${ethers.formatEther(deployerEthBefore)} ETH`);
    console.log(`  Deployer ETH after:   ${ethers.formatEther(deployerEthAfter)} ETH`);
    console.log(`  ETH sent to wallets:  ${ethers.formatEther(totalSent)} ETH`);
    console.log(`  Wallets skipped:      ${skipped} (already funded)`);
    console.log('═'.repeat(68));
    console.log('\n  ✅  Done. Run the demo — no more ETH top-ups needed!\n');
}

main().catch(err => {
    console.error('\n❌ Fatal:', err.message);
    process.exit(1);
});
