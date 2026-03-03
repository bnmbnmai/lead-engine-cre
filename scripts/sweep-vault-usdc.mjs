/**
 * sweep-vault-usdc.mjs — Vault-focused USDC recovery with rate-limit handling
 *
 * Drains the LeadRTB vault contract by:
 *   1. Refunding ALL orphaned locks (scans 50k blocks)
 *   2. Withdrawing free vault balances for all demo wallets
 *   3. Sweeping USDC from demo wallets → deployer
 *
 * Rate-limit aware: exponential backoff + 2s between txs + retry on 429/32600
 *
 * Usage:  node scripts/sweep-vault-usdc.mjs
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

// ── Config ─────────────────────────────────────────────
const ALCHEMY_KEY = readEnvVar('ALCHEMY_API_KEY');
const DEPLOYER_KEY = readEnvVar('DEPLOYER_PRIVATE_KEY');
const RPC = ALCHEMY_KEY
    ? `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`
    : readEnvVar('RPC_URL_BASE_SEPOLIA') || readEnvVar('RPC_URL_SEPOLIA') || 'https://sepolia.base.org';
const VAULT_ADDR = readEnvVar('VAULT_ADDRESS_BASE_SEPOLIA');
const USDC_ADDR = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

if (!VAULT_ADDR) { console.error('VAULT_ADDRESS_BASE_SEPOLIA not set in backend/.env'); process.exit(1); }

const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
];
const VAULT_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function lockedBalances(address) view returns (uint256)',
    'function withdraw(uint256 amount)',
    'function refundBid(uint256 lockId)',
    'event BidLocked(uint256 indexed lockId, address indexed user, uint256 amount)',
    'event BidSettled(uint256 indexed lockId, address indexed buyer, address indexed seller, uint256 amount)',
    'event BidRefunded(uint256 indexed lockId, address indexed user, uint256 amount)',
];

// 10 buyer wallets + 1 seller
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

// ── Helpers ─────────────────────────────────────────────
const fmt = (wei) => (Number(wei) / 1e6).toFixed(2);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Retry with exponential backoff for rate-limited RPCs */
async function withRetry(fn, label, maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const msg = err.message || '';
            const isRateLimit = msg.includes('429') || msg.includes('32600') || msg.includes('Free tier')
                || msg.includes('rate') || msg.includes('Too Many');
            const isNonce = msg.includes('nonce') || msg.includes('already been used') || msg.includes('replacement');

            if (isNonce) {
                // Nonce issues — wait and retry with fresh nonce
                console.log(`  ⏳ ${label}: nonce conflict, waiting 3s (attempt ${attempt}/${maxRetries})`);
                await sleep(3000);
                continue;
            }
            if (isRateLimit && attempt < maxRetries) {
                const backoff = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
                console.log(`  ⏳ ${label}: rate limited, backoff ${(backoff / 1000).toFixed(0)}s (attempt ${attempt}/${maxRetries})`);
                await sleep(backoff);
                continue;
            }
            if (attempt === maxRetries) {
                console.log(`  ❌ ${label}: failed after ${maxRetries} attempts — ${msg.slice(0, 80)}`);
                return null;
            }
            // Other errors — still retry with delay
            await sleep(2000 * attempt);
        }
    }
    return null;
}

// ── Main ────────────────────────────────────────────────
const deployerKey = DEPLOYER_KEY.startsWith('0x') ? DEPLOYER_KEY : '0x' + DEPLOYER_KEY;
const provider = new ethers.JsonRpcProvider(RPC);
const deployer = new ethers.Wallet(deployerKey, provider);
const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, deployer);
const vault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, deployer);
const DEPLOYER_ADDR = deployer.address;

const demoWalletSet = new Set(WALLETS.map(w => w[0].toLowerCase()));
demoWalletSet.add(DEPLOYER_ADDR.toLowerCase());

console.log(`\n${'='.repeat(60)}`);
console.log(`  VAULT USDC SWEEP — ${new Date().toISOString()}`);
console.log(`  Deployer: ${DEPLOYER_ADDR}`);
console.log(`  Vault:    ${VAULT_ADDR}`);
console.log(`  RPC:      ${RPC.slice(0, 50)}…`);
console.log(`${'='.repeat(60)}\n`);

const beforeBal = await usdc.balanceOf(DEPLOYER_ADDR);
const vaultBal = await usdc.balanceOf(VAULT_ADDR);
console.log(`Deployer USDC: $${fmt(beforeBal)}`);
console.log(`Vault USDC:    $${fmt(vaultBal)}\n`);

// ══════════════════════════════════════════════════════════
// STEP 1: Deployer vault balance
// ══════════════════════════════════════════════════════════
console.log('── Step 1: Deployer vault balance ──');
const deployerFree = await withRetry(() => vault.balanceOf(DEPLOYER_ADDR), 'deployer-bal');
if (deployerFree && deployerFree > 0n) {
    console.log(`  Free: $${fmt(deployerFree)} — withdrawing...`);
    await withRetry(async () => {
        const tx = await vault.withdraw(deployerFree);
        await tx.wait();
        console.log(`  ✅ Deployed vault withdrawn ($${fmt(deployerFree)})`);
    }, 'deployer-withdraw');
    await sleep(2000);
} else {
    console.log('  $0 free — skip');
}

// ══════════════════════════════════════════════════════════
// STEP 2: Scan and refund orphaned locks (chunk event queries)
// ══════════════════════════════════════════════════════════
console.log('\n── Step 2: Orphaned lock scan ──');
const currentBlock = await provider.getBlockNumber();
const SCAN_DEPTH = 50000; // ~1-2 days on Base Sepolia
const fromBlock = Math.max(0, currentBlock - SCAN_DEPTH);
console.log(`  Scanning blocks ${fromBlock} → ${currentBlock} (${SCAN_DEPTH} blocks)`);

// Chunk event queries to avoid RPC limits (2000 blocks per query)
const CHUNK = 2000;
let allLocked = [];
let allSettled = new Set();
let allRefunded = new Set();

for (let start = fromBlock; start < currentBlock; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, currentBlock);
    const pct = Math.round(((start - fromBlock) / SCAN_DEPTH) * 100);
    process.stdout.write(`\r  Scanning... ${pct}% (block ${start})`);

    const [locked, settled, refunded] = await withRetry(async () => {
        const l = await vault.queryFilter(vault.filters.BidLocked(), start, end);
        await sleep(500); // rate limit pause between queries
        const s = await vault.queryFilter(vault.filters.BidSettled(), start, end);
        await sleep(500);
        const r = await vault.queryFilter(vault.filters.BidRefunded(), start, end);
        return [l, s, r];
    }, `scan-${start}`) || [[], [], []];

    for (const ev of (locked || [])) {
        const p = vault.interface.parseLog({ topics: ev.topics, data: ev.data });
        if (p) allLocked.push({ lid: p.args[0].toString(), user: p.args[1].toLowerCase(), amount: p.args[2] });
    }
    for (const ev of (settled || [])) {
        const p = vault.interface.parseLog({ topics: ev.topics, data: ev.data });
        if (p) allSettled.add(p.args[0].toString());
    }
    for (const ev of (refunded || [])) {
        const p = vault.interface.parseLog({ topics: ev.topics, data: ev.data });
        if (p) allRefunded.add(p.args[0].toString());
    }

    await sleep(1000); // respect rate limits between chunks
}

console.log(`\r  Scan complete: ${allLocked.length} locks, ${allSettled.size} settled, ${allRefunded.size} refunded`);

// Filter to orphaned demo wallet locks
const orphaned = allLocked.filter(l =>
    demoWalletSet.has(l.user) && !allSettled.has(l.lid) && !allRefunded.has(l.lid)
);

console.log(`  Orphaned locks: ${orphaned.length}`);

let refundedCount = 0;
let refundedTotal = 0n;
let skipCount = 0;

for (let i = 0; i < orphaned.length; i++) {
    const lock = orphaned[i];
    const pct = Math.round(((i + 1) / orphaned.length) * 100);
    process.stdout.write(`\r  Refunding... ${pct}% (${i + 1}/${orphaned.length})`);

    const result = await withRetry(async () => {
        const tx = await vault.refundBid(BigInt(lock.lid));
        await tx.wait();
        return true;
    }, `refund-${lock.lid}`);

    if (result) {
        refundedCount++;
        refundedTotal += lock.amount;
    } else {
        skipCount++;
    }

    await sleep(2000); // 2s between txs to respect rate limits
}

console.log(`\r  ✅ Refunded ${refundedCount} locks ($${fmt(refundedTotal)}), skipped ${skipCount}`);

// ══════════════════════════════════════════════════════════
// STEP 3: Withdraw vault balances + sweep USDC for each wallet
// ══════════════════════════════════════════════════════════
console.log('\n── Step 3: Vault withdraw + USDC sweep ──');

let totalSwept = 0n;

for (const [addr, pk] of WALLETS) {
    const label = addr.slice(0, 10) + '…';

    try {
        const wSigner = new ethers.Wallet(pk, provider);
        const wVault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, wSigner);

        // Check vault balance
        const free = await withRetry(() => wVault.balanceOf(addr), `${label}-vbal`);
        const locked = await withRetry(() => wVault.lockedBalances(addr), `${label}-locked`);

        if (locked && locked > 0n) {
            console.log(`  ${label}  vault locked: $${fmt(locked)} (will need lock refund)`);
        }

        if (free && free > 0n) {
            const result = await withRetry(async () => {
                const tx = await wVault.withdraw(free);
                await tx.wait();
                return true;
            }, `${label}-vwith`);

            if (result) {
                console.log(`  ${label}  vault withdrawn: $${fmt(free)}`);
                await sleep(2000);
            }
        }

        // Check + sweep USDC
        const wUsdc = new ethers.Contract(USDC_ADDR, USDC_ABI, wSigner);
        const bal = await withRetry(() => wUsdc.balanceOf(addr), `${label}-ubal`);

        if (bal && bal > 0n) {
            const result = await withRetry(async () => {
                const tx = await wUsdc.transfer(DEPLOYER_ADDR, bal);
                await tx.wait();
                return true;
            }, `${label}-sweep`);

            if (result) {
                totalSwept += bal;
                console.log(`  ${label}  swept: $${fmt(bal)} → deployer`);
                await sleep(2000);
            }
        } else {
            console.log(`  ${label}  $0 — skip`);
        }
    } catch (err) {
        console.log(`  ${label}  error: ${err.message?.slice(0, 60)}`);
    }
}

// ══════════════════════════════════════════════════════════
// FINAL SUMMARY
// ══════════════════════════════════════════════════════════
console.log('\n  Waiting for confirmations...');
await sleep(8000);

const afterBal = await usdc.balanceOf(DEPLOYER_ADDR);
const vaultAfter = await usdc.balanceOf(VAULT_ADDR);

console.log(`\n${'='.repeat(60)}`);
console.log('  VAULT SWEEP COMPLETE');
console.log('='.repeat(60));
console.log(`  Deployer USDC:  $${fmt(beforeBal)} → $${fmt(afterBal)}  (+$${fmt(afterBal - beforeBal)})`);
console.log(`  Vault USDC:     $${fmt(vaultBal)} → $${fmt(vaultAfter)}  (-$${fmt(vaultBal - vaultAfter)})`);
console.log(`  Locks refunded: ${refundedCount}  ($${fmt(refundedTotal)})`);
console.log(`  Wallets swept:  $${fmt(totalSwept)}`);
console.log('='.repeat(60));
console.log('');
