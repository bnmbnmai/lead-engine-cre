/**
 * sweep-all-usdc.mjs — Full USDC recovery: VerticalBountyPool + Vault + Wallets → Deployer
 *
 * Phase 1: Drain VerticalBountyPool contract (withdraw all pools for 8 demo verticals)
 * Phase 2: Refund orphaned vault locks + withdraw vault balances
 * Phase 3: Sweep all USDC from demo wallets → deployer
 *
 * Usage:  node scripts/sweep-all-usdc.mjs
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
const BOUNTY_POOL_ADDR = '0x9C22418295642Df3D5521B8fA21fBb03Eb89c3c2';  // deployed VerticalBountyPool
const USDC_ADDR = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
];

const BOUNTY_POOL_ABI = [
    'function getVerticalPoolIds(bytes32 verticalSlugHash) view returns (uint256[])',
    'function pools(uint256) view returns (address buyer, bytes32 verticalSlugHash, uint256 totalDeposited, uint256 totalReleased, uint40 createdAt, bool active)',
    'function availableBalance(uint256 poolId) view returns (uint256)',
    'function withdrawBounty(uint256 poolId, uint256 amount)',
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

const DEMO_VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'real_estate', 'hvac', 'legal', 'financial_services', 'auto'];

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

// ── Main ────────────────────────────────────────────────
const deployerKey = DEPLOYER_KEY.startsWith('0x') ? DEPLOYER_KEY : '0x' + DEPLOYER_KEY;
const provider = new ethers.JsonRpcProvider(RPC);
const deployer = new ethers.Wallet(deployerKey, provider);
const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, deployer);
const DEPLOYER_ADDR = deployer.address;

console.log(`\n${'='.repeat(60)}`);
console.log(`  FULL USDC SWEEP — ${new Date().toISOString()}`);
console.log(`  Deployer: ${DEPLOYER_ADDR}`);
console.log(`  RPC: ${RPC.slice(0, 50)}…`);
console.log(`${'='.repeat(60)}\n`);

const beforeBal = await usdc.balanceOf(DEPLOYER_ADDR);
console.log(`Deployer USDC before: $${fmt(beforeBal)}\n`);

// ══════════════════════════════════════════════════════════
// PHASE 1: Drain VerticalBountyPool contract
// ══════════════════════════════════════════════════════════
console.log(`── PHASE 1: VerticalBountyPool (${BOUNTY_POOL_ADDR}) ──`);

const bpUsdc = await usdc.balanceOf(BOUNTY_POOL_ADDR);
console.log(`  Contract USDC balance: $${fmt(bpUsdc)}`);

if (bpUsdc > 0n) {
    const bp = new ethers.Contract(BOUNTY_POOL_ADDR, BOUNTY_POOL_ABI, deployer);
    let totalWithdrawn = 0n;
    let poolsFound = 0;

    for (const slug of DEMO_VERTICALS) {
        const slugHash = ethers.keccak256(ethers.toUtf8Bytes(slug));
        try {
            const poolIds = await bp.getVerticalPoolIds(slugHash);
            if (poolIds.length === 0) continue;

            console.log(`  ${slug}: ${poolIds.length} pool(s)`);
            for (const pid of poolIds) {
                try {
                    const avail = await bp.availableBalance(pid);
                    if (avail === 0n) {
                        console.log(`    Pool #${pid}: $0 (already drained)`);
                        continue;
                    }
                    poolsFound++;
                    console.log(`    Pool #${pid}: $${fmt(avail)} — withdrawing...`);
                    const tx = await bp.withdrawBounty(pid, avail);
                    await tx.wait();
                    totalWithdrawn += avail;
                    console.log(`    ✅ Withdrawn $${fmt(avail)} (${tx.hash.slice(0, 18)}…)`);
                    await sleep(500);
                } catch (err) {
                    console.log(`    ❌ Pool #${pid} failed: ${err.message?.slice(0, 80)}`);
                }
            }
        } catch (err) {
            console.log(`  ${slug}: query failed — ${err.message?.slice(0, 60)}`);
        }
    }
    console.log(`  Phase 1 total: $${fmt(totalWithdrawn)} withdrawn from ${poolsFound} pool(s)\n`);
} else {
    console.log('  No USDC in bounty pool — skipping\n');
}

// ══════════════════════════════════════════════════════════
// PHASE 2: Drain Vault (orphaned locks + free balances)
// ══════════════════════════════════════════════════════════
console.log(`── PHASE 2: Vault (${VAULT_ADDR || 'NOT SET'}) ──`);

if (VAULT_ADDR) {
    const vaultUsdc = await usdc.balanceOf(VAULT_ADDR);
    console.log(`  Vault USDC balance: $${fmt(vaultUsdc)}`);

    const vault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, deployer);
    const demoWalletSet = new Set(WALLETS.map(w => w[0].toLowerCase()));
    demoWalletSet.add(DEPLOYER_ADDR.toLowerCase());

    // 2a — Deployer vault balance
    try {
        const deployerVaultBal = await vault.balanceOf(DEPLOYER_ADDR);
        if (deployerVaultBal > 0n) {
            console.log(`  Deployer vault balance: $${fmt(deployerVaultBal)} — withdrawing...`);
            const tx = await vault.withdraw(deployerVaultBal);
            await tx.wait();
            console.log(`  ✅ Deployer vault withdrawn (${tx.hash.slice(0, 18)}…)`);
            await sleep(500);
        } else {
            console.log('  Deployer vault balance: $0');
        }
    } catch (err) {
        console.log(`  Deployer vault withdraw failed: ${err.message?.slice(0, 80)}`);
    }

    // 2b — Scan for orphaned locks and refund them
    try {
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 20000); // ~12-15 hours
        console.log(`  Scanning locks from block ${fromBlock} to ${currentBlock}...`);

        const lockedEvents = await vault.queryFilter(vault.filters.BidLocked(), fromBlock, currentBlock);
        const settledEvents = await vault.queryFilter(vault.filters.BidSettled(), fromBlock, currentBlock);
        const refundedEvents = await vault.queryFilter(vault.filters.BidRefunded(), fromBlock, currentBlock);

        const resolvedIds = new Set();
        for (const ev of settledEvents) {
            const p = vault.interface.parseLog({ topics: ev.topics, data: ev.data });
            if (p) resolvedIds.add(p.args[0].toString());
        }
        for (const ev of refundedEvents) {
            const p = vault.interface.parseLog({ topics: ev.topics, data: ev.data });
            if (p) resolvedIds.add(p.args[0].toString());
        }

        const orphaned = [];
        for (const ev of lockedEvents) {
            const p = vault.interface.parseLog({ topics: ev.topics, data: ev.data });
            if (!p) continue;
            const lid = p.args[0].toString();
            const user = p.args[1].toLowerCase();
            const amount = p.args[2];
            if (demoWalletSet.has(user) && !resolvedIds.has(lid)) {
                orphaned.push({ lid, user, amount });
            }
        }

        console.log(`  Found ${orphaned.length} orphaned lock(s)`);
        let refundedCount = 0, refundedTotal = 0n;
        for (const lock of orphaned) {
            try {
                const tx = await vault.refundBid(BigInt(lock.lid));
                await tx.wait();
                refundedCount++;
                refundedTotal += lock.amount;
                if (refundedCount % 10 === 0) console.log(`  ... refunded ${refundedCount}/${orphaned.length}`);
                await sleep(300);
            } catch (err) {
                const msg = err.shortMessage ?? err.message?.slice(0, 60) ?? '';
                // Silently skip already-resolved locks
                if (!msg.includes('already') && !msg.includes('nonce')) {
                    console.log(`  Lock #${lock.lid} refund failed: ${msg}`);
                }
            }
        }
        if (refundedCount > 0) {
            console.log(`  ✅ Refunded ${refundedCount} locks ($${fmt(refundedTotal)})`);
        }
    } catch (err) {
        console.log(`  Orphan scan failed: ${err.message?.slice(0, 80)}`);
    }

    // 2c — Withdraw + sweep each demo wallet's vault balance
    for (const [addr, pk] of WALLETS) {
        try {
            const wSigner = new ethers.Wallet(pk, provider);
            const wVault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, wSigner);

            const free = await wVault.balanceOf(addr);
            if (free > 0n) {
                const wTx = await wVault.withdraw(free);
                await wTx.wait();
                console.log(`  ${addr.slice(0, 10)}… vault withdrawn: $${fmt(free)}`);
                await sleep(300);
            }

            const wUsdc = new ethers.Contract(USDC_ADDR, USDC_ABI, wSigner);
            const bal = await wUsdc.balanceOf(addr);
            if (bal > 0n) {
                const tTx = await wUsdc.transfer(DEPLOYER_ADDR, bal);
                await tTx.wait();
                console.log(`  ${addr.slice(0, 10)}… swept: $${fmt(bal)}`);
                await sleep(300);
            }
        } catch (err) {
            console.log(`  ${addr.slice(0, 10)}… failed: ${err.message?.slice(0, 60)}`);
        }
    }
    console.log('');
} else {
    console.log('  VAULT_ADDRESS_BASE_SEPOLIA not set — skipping\n');
}

// ══════════════════════════════════════════════════════════
// FINAL SUMMARY
// ══════════════════════════════════════════════════════════
// Wait for pending txs
await sleep(5000);

const afterBal = await usdc.balanceOf(DEPLOYER_ADDR);
const bpAfter = await usdc.balanceOf(BOUNTY_POOL_ADDR);
const vaultAfter = VAULT_ADDR ? await usdc.balanceOf(VAULT_ADDR) : 0n;

console.log('='.repeat(60));
console.log('  SWEEP COMPLETE');
console.log('='.repeat(60));
console.log(`  Deployer USDC:    $${fmt(beforeBal)} → $${fmt(afterBal)} (+$${fmt(afterBal - beforeBal)})`);
console.log(`  BountyPool USDC:  $${fmt(bpUsdc)} → $${fmt(bpAfter)}`);
if (VAULT_ADDR) {
    const vaultUsdc = await usdc.balanceOf(VAULT_ADDR);
    console.log(`  Vault USDC:       $${fmt(BigInt(11593) * 1000000n)} → $${fmt(vaultAfter)}`);
}
console.log('='.repeat(60));
console.log('');
