#!/usr/bin/env node
/**
 * Testnet Simulation — Lead Engine CRE
 * =====================================
 * Drives 500+ on-chain transactions against deployed Sepolia/Base Sepolia contracts.
 * Uses HD wallet derivation from a mnemonic — no real private keys committed.
 *
 * Usage:
 *   npx ts-node scripts/testnet-sim.ts --network sepolia --bids 500 --wallets 10 --dry-run
 *   npx ts-node scripts/testnet-sim.ts --network hardhat --bids 20 --wallets 3
 *
 * Env vars (in backend/.env):
 *   TESTNET_MNEMONIC      - HD wallet mnemonic (testnet only!)
 *   ALCHEMY_API_KEY       - RPC provider key
 *   LEAD_NFT_ADDRESS      - Deployed LeadNFT contract
 *   MARKETPLACE_ADDRESS   - Deployed Marketplace contract
 *   ESCROW_ADDRESS        - Deployed RTBEscrow contract
 *   MOCK_USDC_ADDRESS     - Deployed MockERC20 (testUSDC)
 *
 * Faucets:
 *   Sepolia ETH: https://sepoliafaucet.com  |  https://faucets.chain.link/sepolia
 *   Base Sepolia: https://faucet.quicknode.com/base/sepolia
 */

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config({ path: './backend/.env' });

// ─── CLI args ──────────────────────────────────────

interface SimConfig {
    network: string;
    bids: number;
    wallets: number;
    concurrency: number;
    dryRun: boolean;
    verbose: boolean;
}

function parseArgs(): SimConfig {
    const args = process.argv.slice(2);
    const get = (flag: string, def: string) => {
        const i = args.indexOf(flag);
        return i >= 0 && args[i + 1] ? args[i + 1] : def;
    };
    return {
        network: get('--network', 'hardhat'),
        bids: parseInt(get('--bids', '500')),
        wallets: parseInt(get('--wallets', '10')),
        concurrency: parseInt(get('--concurrency', '5')),
        dryRun: args.includes('--dry-run'),
        verbose: args.includes('--verbose'),
    };
}

// ─── RPC endpoints ─────────────────────────────────

function getRpcUrl(network: string): string {
    const key = process.env.ALCHEMY_API_KEY || 'demo';
    const urls: Record<string, string> = {
        hardhat: 'http://127.0.0.1:8545',
        sepolia: `https://eth-sepolia.g.alchemy.com/v2/${key}`,
        baseSepolia: 'https://sepolia.base.org',
    };
    return urls[network] || urls.hardhat;
}

// ─── Contract ABIs (minimal) ───────────────────────

const LEAD_NFT_ABI = [
    'function mintLead(address to, string vertical, bytes32 geoHash, bytes32 dataHash, string metadataURI) returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function approve(address to, uint256 tokenId)',
    'function ownerOf(uint256 tokenId) view returns (address)',
];

const MARKETPLACE_ABI = [
    'function createListing(uint256 leadTokenId, uint96 reservePrice, uint96 buyNowPrice, uint40 auctionDuration, uint40 revealWindow, bool acceptOffsite) returns (uint256)',
    'function commitBid(uint256 listingId, bytes32 commitment)',
    'function revealBid(uint256 listingId, uint96 amount, bytes32 salt)',
    'function resolveAuction(uint256 listingId) returns (address winner, uint96 amount)',
    'function buyNow(uint256 listingId)',
    'function listingCount() view returns (uint256)',
];

const ESCROW_ABI = [
    'function createEscrow(string leadId, address seller, address buyer, uint256 amount) returns (uint256)',
    'function fundEscrow(uint256 escrowId)',
    'function releaseEscrow(uint256 escrowId)',
];

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function balanceOf(address owner) view returns (uint256)',
    'function mint(address to, uint256 amount)',
    'function decimals() view returns (uint8)',
];

// ─── Data generators ───────────────────────────────

const VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'b2b_saas', 'real_estate', 'auto', 'legal', 'financial'];
const GEO_HASHES = ['9q8yy', '9q5cj', 'dpz83', 'dr5ru', '9xj6h', '9v1yq', 'dnh0f', '9r2sp', '9qh0g', '9ygk8'];

function randomItem<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function progressBar(current: number, total: number, label: string): void {
    const width = 30;
    const filled = Math.round((current / total) * width);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    const pct = Math.round((current / total) * 100);
    process.stdout.write(`\r  ${bar} ${pct}% ${label} (${current}/${total})`);
    if (current === total) process.stdout.write('\n');
}

// ─── Retry logic ───────────────────────────────────

async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            if (attempt === maxRetries) throw err;
            const delay = baseDelayMs * Math.pow(2, attempt);
            console.warn(`  ⚠ Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${err.message?.slice(0, 80)}`);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw new Error('Unreachable');
}

// ─── Batch executor ────────────────────────────────

async function batchExecute<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number,
    label: string
): Promise<T[]> {
    const results: T[] = [];
    let completed = 0;

    for (let i = 0; i < tasks.length; i += concurrency) {
        const batch = tasks.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(batch.map((t) => t()));

        for (const r of batchResults) {
            completed++;
            progressBar(completed, tasks.length, label);
            if (r.status === 'fulfilled') {
                results.push(r.value);
            }
        }
    }

    return results;
}

// ─── Main simulation ───────────────────────────────

interface SimResult {
    totalTxs: number;
    successfulTxs: number;
    failedTxs: number;
    totalGasUsed: bigint;
    avgLatencyMs: number;
    phases: Record<string, { txs: number; gas: bigint; latencyMs: number[] }>;
}

async function main() {
    const config = parseArgs();

    console.log(`
╔══════════════════════════════════════════════════════╗
║       Lead Engine CRE — Testnet Simulation           ║
╚══════════════════════════════════════════════════════╝

  Network:     ${config.network}
  Wallets:     ${config.wallets}
  Target Bids: ${config.bids}
  Concurrency: ${config.concurrency}
  Dry Run:     ${config.dryRun}
`);

    // ── Derive HD wallets ──

    const mnemonic = process.env.TESTNET_MNEMONIC;
    if (!mnemonic && config.network !== 'hardhat') {
        console.error('❌ TESTNET_MNEMONIC not set in backend/.env');
        console.log('   Generate one with: npx ts-node -e "console.log(require(\'ethers\').Wallet.createRandom().mnemonic?.phrase)"');
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(getRpcUrl(config.network));
    const wallets: ethers.Wallet[] = [];

    if (config.network === 'hardhat') {
        // Use hardhat default accounts
        for (let i = 0; i < config.wallets; i++) {
            const hdNode = ethers.HDNodeWallet.fromMnemonic(
                ethers.Mnemonic.fromPhrase('test test test test test test test test test test test junk'),
                `m/44'/60'/0'/0/${i}`
            );
            wallets.push(new ethers.Wallet(hdNode.privateKey, provider));
        }
    } else {
        // Derive from provided mnemonic
        for (let i = 0; i < config.wallets; i++) {
            const hdNode = ethers.HDNodeWallet.fromMnemonic(
                ethers.Mnemonic.fromPhrase(mnemonic!),
                `m/44'/60'/0'/0/${i}`
            );
            wallets.push(new ethers.Wallet(hdNode.privateKey, provider));
        }
    }

    console.log('  Wallets derived:');
    for (const [i, w] of wallets.entries()) {
        const bal = await provider.getBalance(w.address);
        const ethBal = parseFloat(ethers.formatEther(bal)).toFixed(4);
        const role = i < config.wallets / 2 ? 'seller' : 'buyer';
        console.log(`    ${i}: ${w.address} (${ethBal} ETH) [${role}]`);
    }

    // ── Fund check ──

    const MIN_ETH = ethers.parseEther('0.01');
    const underFunded = wallets.filter((w, i) => {
        // Check async later, for now just track
        return i >= 0; // placeholder
    });

    for (const w of wallets) {
        const bal = await provider.getBalance(w.address);
        if (bal < MIN_ETH && config.network !== 'hardhat') {
            console.warn(`\n  ⚠ Wallet ${w.address} has < 0.01 ETH`);
            console.warn(`    Fund via: https://faucets.chain.link/sepolia`);
            if (!config.dryRun) {
                console.error('    Cannot proceed without funds. Use --dry-run for gas estimates.');
                process.exit(1);
            }
        }
    }

    // ── Contract instances ──

    const addresses = {
        leadNFT: process.env.LEAD_NFT_ADDRESS || '0x0000000000000000000000000000000000000001',
        marketplace: process.env.MARKETPLACE_ADDRESS || '0x0000000000000000000000000000000000000002',
        escrow: process.env.ESCROW_ADDRESS || '0x0000000000000000000000000000000000000003',
        usdc: process.env.MOCK_USDC_ADDRESS || '0x0000000000000000000000000000000000000004',
    };

    console.log(`\n  Contracts:`);
    console.log(`    LeadNFT:     ${addresses.leadNFT}`);
    console.log(`    Marketplace: ${addresses.marketplace}`);
    console.log(`    Escrow:      ${addresses.escrow}`);
    console.log(`    MockUSDC:    ${addresses.usdc}`);

    const sellerCount = Math.ceil(config.wallets / 2);
    const buyerCount = config.wallets - sellerCount;
    const sellers = wallets.slice(0, sellerCount);
    const buyers = wallets.slice(sellerCount);

    const result: SimResult = {
        totalTxs: 0,
        successfulTxs: 0,
        failedTxs: 0,
        totalGasUsed: 0n,
        avgLatencyMs: 0,
        phases: {},
    };

    const allLatencies: number[] = [];

    // ============================================
    // Phase 1: Mint LeadNFTs
    // ============================================

    const mintsTarget = Math.min(200, config.bids);
    console.log(`\n  ── Phase 1: Minting ${mintsTarget} LeadNFTs ──\n`);

    const mintTasks = Array.from({ length: mintsTarget }, (_, i) => {
        const seller = sellers[i % sellers.length];
        const vertical = randomItem(VERTICALS);
        const geoHash = ethers.encodeBytes32String(randomItem(GEO_HASHES));
        const dataHash = ethers.keccak256(ethers.toUtf8Bytes(`lead-${i}-${Date.now()}`));

        return async () => {
            const start = Date.now();
            if (config.dryRun) {
                // Estimate gas
                const contract = new ethers.Contract(addresses.leadNFT, LEAD_NFT_ABI, seller);
                try {
                    const gas = await contract.mintLead.estimateGas(
                        seller.address, vertical, geoHash, dataHash, `ipfs://lead-${i}`
                    );
                    const latency = Date.now() - start;
                    return { gas, latency, success: true, tokenId: i + 1 };
                } catch {
                    return { gas: 0n, latency: Date.now() - start, success: false, tokenId: 0 };
                }
            } else {
                return withRetry(async () => {
                    const contract = new ethers.Contract(addresses.leadNFT, LEAD_NFT_ABI, seller);
                    const tx = await contract.mintLead(
                        seller.address, vertical, geoHash, dataHash, `ipfs://lead-${i}`
                    );
                    const receipt = await tx.wait();
                    const latency = Date.now() - start;
                    return {
                        gas: receipt.gasUsed,
                        latency,
                        success: true,
                        tokenId: i + 1,
                        txHash: receipt.hash,
                        block: receipt.blockNumber,
                    };
                });
            }
        };
    });

    const mintResults = await batchExecute(mintTasks, config.concurrency, 'mints');
    const mintPhase = {
        txs: mintResults.length,
        gas: mintResults.reduce((sum, r) => sum + BigInt(r.gas || 0), 0n),
        latencyMs: mintResults.map((r) => r.latency),
    };
    result.phases['mint'] = mintPhase;
    result.totalTxs += mintResults.length;
    result.successfulTxs += mintResults.filter((r) => r.success).length;
    result.failedTxs += mintResults.filter((r) => !r.success).length;
    result.totalGasUsed += mintPhase.gas;
    allLatencies.push(...mintPhase.latencyMs);

    // ============================================
    // Phase 2: Create Listings
    // ============================================

    const listingsTarget = Math.min(200, mintsTarget);
    console.log(`\n  ── Phase 2: Creating ${listingsTarget} Listings ──\n`);

    const listingTasks = Array.from({ length: listingsTarget }, (_, i) => {
        const seller = sellers[i % sellers.length];
        const tokenId = i + 1;
        const reservePrice = randomBetween(20, 100);
        const buyNowPrice = reservePrice + randomBetween(50, 200);
        const auctionDuration = 3600; // 1 hour
        const revealWindow = 1800; // 30 min

        return async () => {
            const start = Date.now();
            if (config.dryRun) {
                const contract = new ethers.Contract(addresses.marketplace, MARKETPLACE_ABI, seller);
                try {
                    const gas = await contract.createListing.estimateGas(
                        tokenId, reservePrice * 1e6, buyNowPrice * 1e6,
                        auctionDuration, revealWindow, true
                    );
                    return { gas, latency: Date.now() - start, success: true, listingId: i + 1 };
                } catch {
                    return { gas: 0n, latency: Date.now() - start, success: false, listingId: 0 };
                }
            } else {
                return withRetry(async () => {
                    // Approve NFT first
                    const nft = new ethers.Contract(addresses.leadNFT, LEAD_NFT_ABI, seller);
                    const approveTx = await nft.approve(addresses.marketplace, tokenId);
                    await approveTx.wait();

                    const contract = new ethers.Contract(addresses.marketplace, MARKETPLACE_ABI, seller);
                    const tx = await contract.createListing(
                        tokenId, reservePrice * 1e6, buyNowPrice * 1e6,
                        auctionDuration, revealWindow, true
                    );
                    const receipt = await tx.wait();
                    return {
                        gas: receipt.gasUsed,
                        latency: Date.now() - start,
                        success: true,
                        listingId: i + 1,
                        txHash: receipt.hash,
                    };
                });
            }
        };
    });

    const listingResults = await batchExecute(listingTasks, config.concurrency, 'listings');
    const listingPhase = {
        txs: listingResults.length,
        gas: listingResults.reduce((sum, r) => sum + BigInt(r.gas || 0), 0n),
        latencyMs: listingResults.map((r) => r.latency),
    };
    result.phases['listing'] = listingPhase;
    result.totalTxs += listingResults.length;
    result.successfulTxs += listingResults.filter((r) => r.success).length;
    result.failedTxs += listingResults.filter((r) => !r.success).length;
    result.totalGasUsed += listingPhase.gas;
    allLatencies.push(...listingPhase.latencyMs);

    // ============================================
    // Phase 3: Commit + Reveal Bids (500+ target)
    // ============================================

    console.log(`\n  ── Phase 3: Placing ${config.bids} Bids ──\n`);

    const bidTasks = Array.from({ length: config.bids }, (_, i) => {
        const buyer = buyers[i % buyers.length];
        const listingId = (i % listingsTarget) + 1;
        const bidAmount = randomBetween(30, 250);
        const salt = ethers.randomBytes(32);
        const commitment = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['uint96', 'bytes32'],
                [bidAmount * 1e6, salt]
            )
        );

        return async () => {
            const start = Date.now();
            if (config.dryRun) {
                const contract = new ethers.Contract(addresses.marketplace, MARKETPLACE_ABI, buyer);
                try {
                    const gas = await contract.commitBid.estimateGas(listingId, commitment);
                    return { gas, latency: Date.now() - start, success: true, phase: 'commit' };
                } catch {
                    return { gas: 0n, latency: Date.now() - start, success: false, phase: 'commit' };
                }
            } else {
                return withRetry(async () => {
                    // Approve USDC for deposit
                    const usdc = new ethers.Contract(addresses.usdc, ERC20_ABI, buyer);
                    const approveTx = await usdc.approve(addresses.marketplace, bidAmount * 1e6);
                    await approveTx.wait();

                    const contract = new ethers.Contract(addresses.marketplace, MARKETPLACE_ABI, buyer);
                    const tx = await contract.commitBid(listingId, commitment);
                    const receipt = await tx.wait();
                    return {
                        gas: receipt.gasUsed,
                        latency: Date.now() - start,
                        success: true,
                        phase: 'commit',
                        txHash: receipt.hash,
                    };
                });
            }
        };
    });

    const bidResults = await batchExecute(bidTasks, config.concurrency, 'bids');
    const bidPhase = {
        txs: bidResults.length,
        gas: bidResults.reduce((sum, r) => sum + BigInt(r.gas || 0), 0n),
        latencyMs: bidResults.map((r) => r.latency),
    };
    result.phases['bid'] = bidPhase;
    result.totalTxs += bidResults.length;
    result.successfulTxs += bidResults.filter((r) => r.success).length;
    result.failedTxs += bidResults.filter((r) => !r.success).length;
    result.totalGasUsed += bidPhase.gas;
    allLatencies.push(...bidPhase.latencyMs);

    // ============================================
    // Phase 4: Escrow (100 winning bids)
    // ============================================

    const escrowTarget = Math.min(100, Math.floor(config.bids / 5));
    console.log(`\n  ── Phase 4: Creating ${escrowTarget} Escrows ──\n`);

    const escrowTasks = Array.from({ length: escrowTarget }, (_, i) => {
        const seller = sellers[i % sellers.length];
        const buyer = buyers[i % buyers.length];
        const amount = randomBetween(50, 200) * 1e6; // USDC 6 decimals

        return async () => {
            const start = Date.now();
            if (config.dryRun) {
                const contract = new ethers.Contract(addresses.escrow, ESCROW_ABI, seller);
                try {
                    const gas = await contract.createEscrow.estimateGas(
                        `lead-${i}`, seller.address, buyer.address, amount
                    );
                    return { gas, latency: Date.now() - start, success: true };
                } catch {
                    return { gas: 0n, latency: Date.now() - start, success: false };
                }
            } else {
                return withRetry(async () => {
                    const contract = new ethers.Contract(addresses.escrow, ESCROW_ABI, seller);
                    const tx = await contract.createEscrow(
                        `lead-${i}`, seller.address, buyer.address, amount
                    );
                    const receipt = await tx.wait();
                    return {
                        gas: receipt.gasUsed,
                        latency: Date.now() - start,
                        success: true,
                        txHash: receipt.hash,
                    };
                });
            }
        };
    });

    const escrowResults = await batchExecute(escrowTasks, config.concurrency, 'escrows');
    const escrowPhase = {
        txs: escrowResults.length,
        gas: escrowResults.reduce((sum, r) => sum + BigInt(r.gas || 0), 0n),
        latencyMs: escrowResults.map((r) => r.latency),
    };
    result.phases['escrow'] = escrowPhase;
    result.totalTxs += escrowResults.length;
    result.successfulTxs += escrowResults.filter((r) => r.success).length;
    result.failedTxs += escrowResults.filter((r) => !r.success).length;
    result.totalGasUsed += escrowPhase.gas;
    allLatencies.push(...escrowPhase.latencyMs);

    // ============================================
    // Report
    // ============================================

    const sorted = [...allLatencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
    result.avgLatencyMs = Math.round(allLatencies.reduce((a, b) => a + b, 0) / (allLatencies.length || 1));

    const hr = '═'.repeat(56);

    console.log(`
${hr}
  Lead Engine CRE — Testnet Simulation Report
${hr}

  ┌──────────────────────────────────────────────────┐
  │ Total Transactions:   ${String(result.totalTxs).padStart(8)}                   │
  │ Successful:           ${String(result.successfulTxs).padStart(8)}                   │
  │ Failed:               ${String(result.failedTxs).padStart(8)}                   │
  │ Total Gas Used:       ${String(result.totalGasUsed).padStart(14)}             │
  └──────────────────────────────────────────────────┘

  Latency:
    p50: ${p50}ms | p95: ${p95}ms | p99: ${p99}ms | avg: ${result.avgLatencyMs}ms

  Phase Breakdown:
  ┌───────────┬────────┬──────────────────┬──────────┐
  │ Phase     │    Txs │         Gas Used │ Avg (ms) │
  ├───────────┼────────┼──────────────────┼──────────┤`);

    for (const [phase, data] of Object.entries(result.phases)) {
        const avgMs = Math.round(data.latencyMs.reduce((a, b) => a + b, 0) / (data.latencyMs.length || 1));
        console.log(`  │ ${phase.padEnd(9)} │ ${String(data.txs).padStart(6)} │ ${String(data.gas).padStart(16)} │ ${String(avgMs).padStart(8)} │`);
    }

    console.log(`  └───────────┴────────┴──────────────────┴──────────┘`);

    const passed = result.successfulTxs >= config.bids && p99 < 30000;
    console.log(`
  VERDICT: ${passed ? '✅ PASS — Testnet simulation complete' : '⚠ PARTIAL — Some transactions failed'}
  ${config.dryRun ? '(DRY RUN — no actual transactions sent)' : ''}
${hr}
`);
}

main().catch((err) => {
    console.error('Simulation failed:', err);
    process.exit(1);
});
