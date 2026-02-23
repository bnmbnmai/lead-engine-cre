/**
 * gen-and-fund-wallets.mjs
 *
 * Generates 20 new Base Sepolia wallets, appends them to faucet-wallets.txt,
 * and funds each with 0.035 ETH from the deployer wallet.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=<key> node scripts/gen-and-fund-wallets.mjs
 *
 * Or set DEPLOYER_PRIVATE_KEY in backend/.env and run from project root.
 */

import { ethers } from 'ethers';
import { readFileSync, appendFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL = 'https://sepolia.base.org';
const FUND_AMOUNT = ethers.parseEther('0.035');   // 0.035 ETH per wallet
const WALLET_COUNT = 20;
const FAUCET_FILE = resolve(ROOT, 'faucet-wallets.txt');

// ── Deployer key ──────────────────────────────────────────────────────────────

// Load from env or from .env file
let deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!deployerKey) {
    try {
        const envFile = readFileSync(resolve(ROOT, 'backend', '.env'), 'utf8');
        const match = envFile.match(/^DEPLOYER_PRIVATE_KEY=(.+)$/m);
        if (match) deployerKey = match[1].trim();
    } catch { /* no .env */ }
}

if (!deployerKey) {
    console.error('❌  DEPLOYER_PRIVATE_KEY not found in env or backend/.env');
    process.exit(1);
}
if (!deployerKey.startsWith('0x')) deployerKey = '0x' + deployerKey;

// ── Setup ─────────────────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(RPC_URL);
const deployer = new ethers.Wallet(deployerKey, provider);

const deployerBal = await provider.getBalance(deployer.address);
const totalCost = FUND_AMOUNT * BigInt(WALLET_COUNT);
const gasBuffer = ethers.parseEther('0.05');

console.log(`\nDeployer:        ${deployer.address}`);
console.log(`Deployer ETH:    ${ethers.formatEther(deployerBal)} ETH`);
console.log(`Total to send:   ${ethers.formatEther(totalCost)} ETH (${WALLET_COUNT} × ${ethers.formatEther(FUND_AMOUNT)} ETH)`);
console.log(`Gas reserve:     ${ethers.formatEther(gasBuffer)} ETH`);

if (deployerBal < totalCost + gasBuffer) {
    console.error(`\n❌  Insufficient ETH. Need ${ethers.formatEther(totalCost + gasBuffer)} ETH, have ${ethers.formatEther(deployerBal)} ETH`);
    process.exit(1);
}

// ── Figure out existing wallet count ─────────────────────────────────────────

let existingCount = 0;
try {
    const content = readFileSync(FAUCET_FILE, 'utf8');
    const matches = content.match(/^Wallet \d+/gm);
    if (matches) existingCount = matches.length;
} catch { /* file may not exist */ }

// ── Generate wallets ──────────────────────────────────────────────────────────

console.log(`\n🔑  Generating ${WALLET_COUNT} new wallets (starting at Wallet ${existingCount + 1})...\n`);

const newWallets = [];
for (let i = 0; i < WALLET_COUNT; i++) {
    const wallet = ethers.Wallet.createRandom();
    newWallets.push({ index: existingCount + i + 1, address: wallet.address, pk: wallet.privateKey });
}

// ── Append to faucet-wallets.txt first ───────────────────────────────────────

let appendText = '';
for (const w of newWallets) {
    appendText += `Wallet ${w.index}: ${w.address}  PK: ${w.pk}\n`;
}
appendFileSync(FAUCET_FILE, appendText, 'utf8');
console.log(`✅  Appended ${WALLET_COUNT} wallets to faucet-wallets.txt`);

// ── Fund each wallet ──────────────────────────────────────────────────────────

console.log(`\n💸  Funding ${WALLET_COUNT} wallets with ${ethers.formatEther(FUND_AMOUNT)} ETH each...\n`);

let nonce = await provider.getTransactionCount(deployer.address, 'pending');
const feeData = await provider.getFeeData();

for (const w of newWallets) {
    try {
        const tx = await deployer.sendTransaction({
            to: w.address,
            value: FUND_AMOUNT,
            nonce: nonce++,
            maxFeePerGas: feeData.maxFeePerGas,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
            type: 2,
        });
        console.log(`  Wallet ${w.index}: ${w.address} → tx ${tx.hash.slice(0, 22)}…`);
        // Don't await each — fire-and-forget for speed, wait at end
    } catch (err) {
        console.error(`  ❌  Wallet ${w.index} funding failed: ${err.message?.slice(0, 80)}`);
    }
    // Small delay to avoid nonce races
    await new Promise(r => setTimeout(r, 150));
}

console.log('\n⏳  Waiting for transactions to confirm (~10s)...');
await new Promise(r => setTimeout(r, 12000));

// ── Verify spot-check ─────────────────────────────────────────────────────────

console.log('\n📊  Spot-check balances (first 3 and last new wallet):');
for (const w of [newWallets[0], newWallets[1], newWallets[2], newWallets[newWallets.length - 1]]) {
    const bal = await provider.getBalance(w.address);
    console.log(`  Wallet ${w.index}: ${w.address} → ${ethers.formatEther(bal)} ETH`);
}

const finalDeployerBal = await provider.getBalance(deployer.address);
console.log(`\nDeployer remaining: ${ethers.formatEther(finalDeployerBal)} ETH`);
console.log('\n✅  Done. All wallets recorded in faucet-wallets.txt\n');
