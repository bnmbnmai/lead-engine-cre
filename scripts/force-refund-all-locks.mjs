/**
 * scripts/force-refund-all-locks.mjs
 *
 * Enumerates all active vault locks by scanning LockCreated events,
 * filters out already-settled/refunded ones, then calls refundBid()
 * on each using the deployer key (vault owner / authorized caller).
 *
 * After refunding, sweeps all wallet free balances → deployer.
 *
 * Usage:
 *   node scripts/force-refund-all-locks.mjs
 */

import { ethers } from 'ethers';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../backend/.env') });

const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';
const VAULT_ADDR = process.env.VAULT_ADDRESS_BASE_SEPOLIA;
const USDC_ADDR = process.env.USDC_CONTRACT_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;

if (!VAULT_ADDR) throw new Error('VAULT_ADDRESS_BASE_SEPOLIA not set');
if (!DEPLOYER_KEY) throw new Error('DEPLOYER_PRIVATE_KEY not set');

// Wallets 1-10 (buyers) + Wallet 11 (seller)
const BUYER_WALLETS = [
    '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9',
    '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC',
    '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58',
    '0x424CaC929939377f221348af52d4cb1247fE4379',
    '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d',
    '0x089B6Bdb4824628c5535acF60aBF80683452e862',
    '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE',
    '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C',
    '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf',
    '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad',
    '0x9Bb15F98982715E33a2113a35662036528eE0A36',
];

const WALLET_KEYS = [
    '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439', // W1
    '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618', // W2
    '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e', // W3
    '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7', // W4
    '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7', // W5
    '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75', // W6
    '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510', // W7
    '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd', // W8
    '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c', // W9
    '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382', // W10
    '0x618bee99ca60f5511dad533a998344f3a0a7b2339db5726ae33d56fd543294ce', // W11 seller
];

const VAULT_ABI = [
    'event LockCreated(uint256 indexed lockId, address indexed user, uint256 amount)',
    'event LockSettled(uint256 indexed lockId)',
    'event LockRefunded(uint256 indexed lockId)',
    'function refundBid(uint256 lockId) external',
    'function settleBid(uint256 lockId, address seller) external',
    'function balanceOf(address) view returns (uint256)',
    'function lockedBalances(address) view returns (uint256)',
    'function withdraw(uint256 amount) external',
    'function owner() view returns (address)',
];

const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
];

const f = (n) => '$' + (Number(n) / 1e6).toFixed(2);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
    const vault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, deployer);
    const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, deployer);

    const deployerAddr = deployer.address;
    console.log('Deployer:', deployerAddr);
    console.log('Vault:   ', VAULT_ADDR);

    const beforeDep = await usdc.balanceOf(deployerAddr);
    console.log('Deployer USDC before:', f(beforeDep));
    console.log('');

    // ── Step 1: Enumerate all lock IDs from events ──────────────────────────
    console.log('Scanning LockCreated events (chunked, last 100k blocks)…');
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 100000);
    const CHUNK = 9000; // Base Sepolia RPC max is 10k

    async function queryAll(filter, from, to) {
        const results = [];
        for (let start = from; start <= to; start += CHUNK) {
            const end = Math.min(start + CHUNK - 1, to);
            const chunk = await vault.queryFilter(filter, start, end);
            results.push(...chunk);
        }
        return results;
    }

    const [createdEvents, settledEvents, refundedEvents] = await Promise.all([
        queryAll(vault.filters.LockCreated(), fromBlock, currentBlock),
        queryAll(vault.filters.LockSettled(), fromBlock, currentBlock),
        queryAll(vault.filters.LockRefunded(), fromBlock, currentBlock),
    ]);

    const settledIds = new Set(settledEvents.map(e => e.args[0].toString()));
    const refundedIds = new Set(refundedEvents.map(e => e.args[0].toString()));

    const activeLocks = createdEvents
        .map(e => ({ lockId: e.args[0].toString(), user: e.args[1], amount: e.args[2] }))
        .filter(l => !settledIds.has(l.lockId) && !refundedIds.has(l.lockId));

    console.log(`Found ${createdEvents.length} created, ${settledIds.size} settled, ${refundedIds.size} refunded`);
    console.log(`Active locks to refund: ${activeLocks.length}`);
    console.log('');

    if (activeLocks.length === 0) {
        console.log('No active locks — nothing to refund.');
    } else {
        // ── Step 2: refundBid() each active lock ──────────────────────────────
        let refunded = 0;
        let failed = 0;
        let totalRefunded = 0n;

        for (const lock of activeLocks) {
            process.stdout.write(`  refundBid(${lock.lockId}) user=${lock.user.slice(0, 10)} amt=${f(lock.amount)} … `);
            try {
                const tx = await vault.refundBid(BigInt(lock.lockId));
                await tx.wait();
                console.log(`✅  (${tx.hash.slice(0, 14)}…)`);
                refunded++;
                totalRefunded += lock.amount;
                await sleep(300); // avoid nonce collisions
            } catch (err) {
                const msg = err.message?.slice(0, 80) || 'unknown';
                console.log(`⚠️  SKIP — ${msg}`);
                failed++;
            }
        }

        console.log('');
        console.log(`Refunded: ${refunded} locks (${f(totalRefunded)}) | Skipped: ${failed}`);
    }

    // ── Step 3: Withdraw vault free balances → wallet, then transfer → deployer
    console.log('');
    console.log('Sweeping vault free balances → deployer…');
    let totalSwept = 0n;

    for (let i = 0; i < BUYER_WALLETS.length; i++) {
        const walletAddr = BUYER_WALLETS[i];
        const walletKey = WALLET_KEYS[i];
        if (!walletKey) { console.log(`  ${walletAddr.slice(0, 10)} — no key, skip`); continue; }

        const walletSigner = new ethers.Wallet(walletKey, provider);
        const vaultAsWallet = vault.connect(walletSigner);
        const usdcAsWallet = usdc.connect(walletSigner);

        const freeBalance = await vault.balanceOf(walletAddr).catch(() => 0n);

        if (freeBalance === 0n) {
            process.stdout.write(`  ${walletAddr.slice(0, 10)} free=$0 `);
        } else {
            process.stdout.write(`  ${walletAddr.slice(0, 10)} free=${f(freeBalance)} → withdraw… `);
            try {
                const txW = await vaultAsWallet.withdraw(freeBalance);
                await txW.wait();
                process.stdout.write('✅ → transfer deployer… ');
            } catch (e) {
                console.log(`⚠️  withdraw failed: ${e.message?.slice(0, 60)}`);
                continue;
            }
        }

        const walletUsdc = await usdc.balanceOf(walletAddr).catch(() => 0n);
        if (walletUsdc === 0n) {
            console.log('(wallet USDC=0, skip transfer)');
            continue;
        }

        try {
            const txT = await usdcAsWallet.transfer(deployerAddr, walletUsdc);
            await txT.wait();
            console.log(`✅ swept ${f(walletUsdc)}`);
            totalSwept += walletUsdc;
        } catch (e) {
            console.log(`⚠️  transfer failed: ${e.message?.slice(0, 60)}`);
        }
    }

    const afterDep = await usdc.balanceOf(deployerAddr);
    console.log('');
    console.log('═'.repeat(60));
    console.log('  Deployer USDC before: ' + f(beforeDep));
    console.log('  Deployer USDC after:  ' + f(afterDep));
    console.log('  Net gained:           ' + f(afterDep - beforeDep));
    console.log('═'.repeat(60));
}

main().catch(e => { console.error(e); process.exit(1); });
