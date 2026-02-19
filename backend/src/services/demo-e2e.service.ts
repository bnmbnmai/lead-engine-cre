/**
 * Demo E2E Service — One-Click Full On-Chain Demo Orchestrator
 *
 * Runs an automated N-cycle on-chain demo flow on Base Sepolia:
 *   Per cycle: inject lead → lock 3 bids → settle winner → refund losers → verifyReserves
 *
 * Streams every step via Socket.IO ('demo:log' + 'ace:dev-log') so the
 * DevLogPanel shows real-time progress. Emits 'demo:complete' on finish.
 *
 * Safety: testnet-only, max 12 cycles, singleton lock, abort support.
 */

import { Server as SocketServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';
import { aceDevBus } from './ace.service';
import * as vaultService from './vault.service';
import { LEAD_AUCTION_DURATION_SECS } from '../config/perks.env';
import { computeCREQualityScore, type LeadScoringInput } from '../lib/chainlink/cre-quality-score';

// ── Config ─────────────────────────────────────────

const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const VAULT_ADDRESS = process.env.VAULT_ADDRESS_BASE_SEPOLIA || '';
const USDC_ADDRESS = process.env.USDC_CONTRACT_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const BASE_SEPOLIA_CHAIN_ID = 84532;
const MAX_CYCLES = 12;
const BASESCAN_BASE = 'https://sepolia.basescan.org/tx/';

// Demo buyer wallets (10 faucet wallets for busier auctions)
const DEMO_BUYER_WALLETS = [
    '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9',
    '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC',
    '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58',
    '0x424CaC929939377f221348af52d4cb1247fE4379',
    '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d',
    '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE',
    '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C',
    '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf',
    '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad',
    '0x089B6Bdb4824628c5535acF60aBF80683452e862',
];

// Demo seller wallet (faucet wallet 6) — PK needed to recycle USDC back after settlement
const DEMO_SELLER_WALLET = '0x089B6Bdb4824628c5535acF60aBF80683452e862';
const DEMO_SELLER_KEY = '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75';

const DEMO_VERTICALS = [
    'mortgage', 'solar', 'insurance', 'real_estate', 'roofing',
    'hvac', 'legal', 'financial_services',
];

interface GeoInfo { country: string; state: string; city: string }
const GEOS: GeoInfo[] = [
    { country: 'US', state: 'CA', city: 'Los Angeles' },
    { country: 'US', state: 'TX', city: 'Houston' },
    { country: 'US', state: 'FL', city: 'Miami' },
    { country: 'US', state: 'NY', city: 'New York' },
    { country: 'US', state: 'IL', city: 'Chicago' },
    { country: 'GB', state: 'London', city: 'London' },
    { country: 'AU', state: 'NSW', city: 'Sydney' },
];

const FALLBACK_VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'b2b_saas', 'real_estate', 'auto', 'legal', 'financial_services'];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

const VAULT_ABI = [
    'function deposit(uint256 amount) external',
    'function withdraw(uint256 amount) external',
    'function balanceOf(address user) view returns (uint256)',
    'function lockedBalances(address user) view returns (uint256)',
    'function totalObligations() view returns (uint256)',
    'function lockForBid(address user, uint256 bidAmount) returns (uint256)',
    'function settleBid(uint256 lockId, address seller) external',
    'function refundBid(uint256 lockId) external',
    'function verifyReserves() returns (bool)',
    'function lastPorSolvent() view returns (bool)',
    'event BidLocked(uint256 indexed lockId, address indexed user, uint256 amount, uint256 fee)',
    'event BidSettled(uint256 indexed lockId, address indexed winner, address indexed seller, uint256 sellerAmount, uint256 platformCut, uint256 convenienceFee)',
    'event BidRefunded(uint256 indexed lockId, address indexed user, uint256 totalRefunded)',
    'event ReservesVerified(uint256 contractBalance, uint256 claimedTotal, bool solvent, uint256 timestamp)',
];

const USDC_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
];

// ── Types ──────────────────────────────────────────

interface DemoLogEntry {
    ts: string;
    level: 'info' | 'success' | 'warn' | 'error' | 'step';
    message: string;
    txHash?: string;
    basescanLink?: string;
    data?: Record<string, any>;
    cycle?: number;
    totalCycles?: number;
}

interface CycleResult {
    cycle: number;
    vertical: string;
    buyerWallet: string;
    bidAmount: number;
    lockIds: number[];
    winnerLockId: number;
    settleTxHash: string;
    refundTxHashes: string[];
    porSolvent: boolean;
    porTxHash: string;
    gasUsed: bigint;
}

export interface DemoResult {
    runId: string;
    startedAt: string;
    completedAt: string;
    cycles: CycleResult[];
    totalGas: string;
    totalSettled: number;
    status: 'completed' | 'aborted' | 'failed';
    error?: string;
}

// ── Singleton State ────────────────────────────────

let isRunning = false;
let currentAbort: AbortController | null = null;
const resultsStore = new Map<string, DemoResult>();

// ── Helpers ────────────────────────────────────────

function getProvider() {
    return new ethers.JsonRpcProvider(RPC_URL);
}

function getSigner() {
    if (!DEPLOYER_KEY) throw new Error('DEPLOYER_PRIVATE_KEY not set');
    return new ethers.Wallet(DEPLOYER_KEY, getProvider());
}

function getVault(signer: ethers.Wallet) {
    return new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);
}

function getUSDC(signer: ethers.Wallet) {
    return new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function rand(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Lead Helpers ──────────────────────────────────

/** Build realistic demo form parameters for a given vertical */
function buildDemoParams(vertical: string): Record<string, string | boolean> {
    const root = vertical.split('.')[0];
    switch (root) {
        case 'solar':
            return {
                roofType: pick(['Asphalt Shingle', 'Metal', 'Tile', 'Flat/TPO']),
                roofAge: `${rand(2, 25)} years`,
                sqft: `${rand(1200, 4500)}`,
                electricBill: `$${rand(100, 400)}/mo`,
                creditScore: pick(['Excellent (750+)', 'Good (700-749)', 'Fair (650-699)']),
                timeline: pick(['ASAP', '1-3 months', '3-6 months']),
            };
        case 'mortgage':
            return {
                propertyType: pick(['Single Family', 'Condo', 'Townhouse']),
                homeValue: `$${rand(200, 900) * 1000}`,
                loanAmount: `$${rand(150, 750) * 1000}`,
                creditScore: pick(['Excellent (750+)', 'Good (700-749)', 'Fair (650-699)']),
                occupancy: pick(['Primary Residence', 'Second Home', 'Investment Property']),
            };
        case 'insurance':
            return {
                coverageType: pick(['Full Coverage', 'Liability Only', 'Comprehensive']),
                currentCarrier: pick(['State Farm', 'Allstate', 'Progressive', 'None']),
                claimsHistory: pick(['No claims', '1 claim', '2+ claims']),
            };
        case 'real_estate':
            return {
                propertyType: pick(['Single Family', 'Condo', 'Townhouse', 'Land']),
                transactionType: pick(['Buying', 'Selling', 'Both']),
                priceRange: `$${rand(150, 500) * 1000}-$${rand(500, 1200) * 1000}`,
                timeline: pick(['Immediately', '1-3 months', '3-6 months']),
            };
        case 'roofing':
            return {
                roofType: pick(['Asphalt Shingle', 'Metal', 'Tile']),
                roofAge: `${rand(5, 35)} years`,
                projectType: pick(['Full Replacement', 'Repair', 'Inspection']),
                urgency: pick(['Emergency', 'This week', 'Flexible']),
            };
        case 'hvac':
            return {
                serviceType: pick(['Installation', 'Repair', 'Maintenance']),
                systemAge: `${rand(3, 20)} years`,
                propertyType: pick(['Single Family', 'Condo', 'Commercial']),
                urgency: pick(['Emergency', 'This week', 'Flexible']),
            };
        case 'legal':
            return {
                caseType: pick(['Personal Injury', 'Family Law', 'Criminal Defense', 'Estate Planning']),
                urgency: pick(['Emergency', 'This week', 'Flexible']),
                consultationType: pick(['In-person', 'Virtual', 'Phone']),
            };
        case 'financial_services':
            return {
                serviceType: pick(['Tax Planning', 'Retirement Planning', 'Wealth Management']),
                investmentRange: pick(['<$50K', '$50K-$250K', '$250K-$1M', '$1M+']),
                timeline: pick(['Immediately', '1-3 months', 'Long-term planning']),
            };
        default:
            return { serviceType: 'General', urgency: 'Flexible' };
    }
}

/** Ensure a demo seller user + profile exists, return sellerId */
async function ensureDemoSeller(walletAddress: string): Promise<string> {
    // Check if seller profile already exists
    let seller = await prisma.sellerProfile.findFirst({
        where: { user: { walletAddress } },
    });
    if (seller) return seller.id;

    // Auto-create user + profile
    let user = await prisma.user.findFirst({ where: { walletAddress } });
    if (!user) {
        user = await prisma.user.create({
            data: {
                walletAddress,
                role: 'SELLER',
                sellerProfile: {
                    create: {
                        companyName: 'Demo Seller Co.',
                        verticals: FALLBACK_VERTICALS,
                        isVerified: true,
                        kycStatus: 'VERIFIED',
                    },
                },
            },
            include: { sellerProfile: true },
        });
        seller = (user as any).sellerProfile;
    } else {
        seller = await prisma.sellerProfile.create({
            data: {
                userId: user.id,
                companyName: 'Demo Seller Co.',
                verticals: FALLBACK_VERTICALS,
                isVerified: true,
                kycStatus: 'VERIFIED',
            },
        });
    }

    if (!seller) throw new Error('Failed to create demo seller profile');
    return seller.id;
}

function emit(io: SocketServer, entry: DemoLogEntry) {
    // Add basescan link if txHash present
    if (entry.txHash && !entry.basescanLink) {
        entry.basescanLink = `${BASESCAN_BASE}${entry.txHash}`;
    }

    // Emit to both channels so DevLogPanel shows it natively
    io.emit('demo:log', entry);

    // Also emit as ace:dev-log so it appears in the Chainlink Dev Log
    aceDevBus.emit('ace:dev-log', {
        ts: entry.ts,
        action: `demo:${entry.level}`,
        message: entry.message,
        txHash: entry.txHash,
        basescanLink: entry.basescanLink,
        source: 'demo-e2e',
        ...(entry.data || {}),
    });
}

// ── Transaction Helper (with retry) ────────────────

async function sendTx(
    io: SocketServer,
    label: string,
    txFn: () => Promise<any>,
    cycle?: number,
    totalCycles?: number,
    retries = 3,
): Promise<{ receipt: any; gasUsed: bigint }> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const tx = await txFn();
            const receipt = await tx.wait();

            emit(io, {
                ts: new Date().toISOString(),
                level: 'success',
                message: `✅ ${label} — tx: ${receipt.hash.slice(0, 22)}… (gas: ${receipt.gasUsed.toString()})`,
                txHash: receipt.hash,
                cycle,
                totalCycles,
                data: { gasUsed: receipt.gasUsed.toString() },
            });

            return { receipt, gasUsed: receipt.gasUsed };
        } catch (err: any) {
            const msg = err?.shortMessage || err?.message || String(err);
            emit(io, {
                ts: new Date().toISOString(),
                level: 'warn',
                message: `⚠️ ${label} attempt ${attempt}/${retries}: ${msg.slice(0, 120)}`,
                cycle,
                totalCycles,
            });
            if (attempt === retries) throw err;
            await sleep(2000 * attempt);
        }
    }
    throw new Error(`${label} failed after ${retries} attempts`);
}

// ── Staggered Lead Drip (Background) ──────────────

/**
 * Start a background drip that injects 1 new lead every 8-15 seconds.
 * Runs concurrently with vault cycles. Returns an abort handle.
 *
 * @param maxLeads   Total leads to create (default 20)
 * @param maxMinutes Stop dripping after this many minutes (default 5)
 */
function startLeadDrip(
    io: SocketServer,
    signal: AbortSignal,
    maxLeads: number = 20,
    maxMinutes: number = 5,
): { stop: () => void; promise: Promise<void> } {
    let stopped = false;
    const stop = () => { stopped = true; };

    const promise = (async () => {
        const sellerId = await ensureDemoSeller(DEMO_SELLER_WALLET);
        const deadline = Date.now() + maxMinutes * 60 * 1000;
        let created = 0;

        emit(io, {
            ts: new Date().toISOString(),
            level: 'step',
            message: `📦 Starting lead drip — 1 new lead every 8-15s for ~${maxMinutes} minutes`,
        });

        // Seed 3 leads immediately so marketplace isn't empty at launch
        for (let i = 0; i < 3 && !stopped && !signal.aborted; i++) {
            try {
                await injectOneLead(io, sellerId, created);
                created++;
            } catch { /* non-fatal */ }
            await sleep(300);
        }

        // Then drip the rest at random intervals
        while (created < maxLeads && Date.now() < deadline && !stopped && !signal.aborted) {
            const delaySec = rand(8, 15);
            // Sleep in 1-second ticks so we can respond to abort quickly
            for (let t = 0; t < delaySec && !stopped && !signal.aborted; t++) {
                await sleep(1000);
            }
            if (stopped || signal.aborted) break;

            try {
                await injectOneLead(io, sellerId, created);
                created++;
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'info',
                    message: `📋 Lead ${created}/${maxLeads} dripped into marketplace`,
                });
            } catch (err: any) {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ Lead drip #${created + 1} failed: ${err.message?.slice(0, 80)}`,
                });
            }
        }

        emit(io, {
            ts: new Date().toISOString(),
            level: 'success',
            message: `✅ Lead drip finished — ${created} leads added to marketplace`,
        });
    })();

    return { stop, promise };
}

/** Create a single demo lead and emit marketplace:lead:new */
async function injectOneLead(
    io: SocketServer,
    sellerId: string,
    index: number,
): Promise<void> {
    const vertical = DEMO_VERTICALS[index % DEMO_VERTICALS.length];
    const geo = GEOS[index % GEOS.length];
    const reservePrice = rand(12, 45);
    const params = buildDemoParams(vertical);
    const paramCount = Object.keys(params).filter(k => params[k] != null && params[k] !== '').length;
    const scoreInput: LeadScoringInput = {
        tcpaConsentAt: new Date(),
        geo: { country: geo.country, state: geo.state, zip: `${rand(10000, 99999)}` },
        hasEncryptedData: false,
        encryptedDataValid: false,
        parameterCount: paramCount,
        source: 'PLATFORM',
        zipMatchesState: false,
    };
    const qualityScore = computeCREQualityScore(scoreInput);

    const lead = await prisma.lead.create({
        data: {
            sellerId,
            vertical,
            geo: { country: geo.country, state: geo.state, city: geo.city } as any,
            source: 'DEMO',
            status: 'IN_AUCTION',
            reservePrice,
            isVerified: true,
            qualityScore,
            tcpaConsentAt: new Date(),
            auctionStartAt: new Date(),
            auctionEndAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
            parameters: params as any,
        },
    });

    await prisma.auctionRoom.create({
        data: {
            leadId: lead.id,
            roomId: `auction_${lead.id}`,
            phase: 'BIDDING',
            biddingEndsAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
            revealEndsAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
        },
    });

    io.emit('marketplace:lead:new', {
        lead: {
            id: lead.id,
            vertical,
            status: 'IN_AUCTION',
            reservePrice,
            geo: { country: geo.country, state: geo.state },
            isVerified: true,
            sellerId,
            auctionStartAt: lead.auctionStartAt?.toISOString(),
            auctionEndAt: lead.auctionEndAt?.toISOString(),
            parameters: params,
            qualityScore: qualityScore != null ? Math.floor(qualityScore / 100) : null,
            _count: { bids: 0 },
        },
    });
}

// ── Main Orchestrator ──────────────────────────────

export async function runFullDemo(
    io: SocketServer,
    cycles: number = 5,
): Promise<DemoResult> {
    // ── Singleton lock ──
    if (isRunning) {
        throw new Error('A demo is already running. Please wait or stop it first.');
    }

    // ── Validate ──
    cycles = Math.max(1, Math.min(cycles, MAX_CYCLES));

    const runId = uuidv4();
    const startedAt = new Date().toISOString();
    const cycleResults: CycleResult[] = [];
    let totalGas = 0n;
    let totalSettled = 0;

    isRunning = true;
    currentAbort = new AbortController();
    const signal = currentAbort.signal;

    try {
        // ── Validate chain ──
        const provider = getProvider();
        const network = await provider.getNetwork();
        if (Number(network.chainId) !== BASE_SEPOLIA_CHAIN_ID) {
            throw new Error(`Wrong network! Expected Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}), got ${network.chainId}`);
        }

        const signer = getSigner();
        const vault = getVault(signer);
        const usdc = getUSDC(signer);

        emit(io, {
            ts: new Date().toISOString(),
            level: 'info',
            message: `
╔══════════════════════════════════════════════════════════╗
║  🚀  ONE-CLICK FULL ON-CHAIN DEMO                      ║
║  Network: Base Sepolia (84532)                          ║
║  Cycles:  ${String(cycles).padEnd(47)}║
║  Run ID:  ${runId.slice(0, 8)}…                                        ║
╚══════════════════════════════════════════════════════════╝`,
        });

        // ── Step 0: Check deployer balance ──
        if (signal.aborted) throw new Error('Demo aborted');

        const deployerBal = await vault.balanceOf(signer.address);
        const deployerUsdc = Number(deployerBal) / 1e6;
        const ethBal = await provider.getBalance(signer.address);

        emit(io, {
            ts: new Date().toISOString(),
            level: 'info',
            message: `📊 Deployer vault balance: $${deployerUsdc.toFixed(2)} USDC | ${ethers.formatEther(ethBal)} ETH`,
            data: { vaultBalance: deployerUsdc, ethBalance: ethers.formatEther(ethBal) },
        });

        // ── Buyer private keys (from faucet-wallets.txt) ──
        const BUYER_KEYS: Record<string, string> = {
            '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9': '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439',
            '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC': '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618',
            '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58': '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e',
            '0x424CaC929939377f221348af52d4cb1247fE4379': '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7',
            '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d': '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7',
            '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE': '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510',
            '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C': '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd',
            '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf': '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c',
            '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad': '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382',
            '0x089B6Bdb4824628c5535acF60aBF80683452e862': '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75',
        };

        // ── Step 1: Gas top-up for seller ──
        try {
            if ((await provider.getBalance(DEMO_SELLER_WALLET)) < ethers.parseEther('0.0005')) {
                const gasTx = await signer.sendTransaction({
                    to: DEMO_SELLER_WALLET,
                    value: ethers.parseEther('0.001'),
                });
                await gasTx.wait();
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'success',
                    message: `✅ Gas top-up sent to seller ${DEMO_SELLER_WALLET}`,
                });
            }
        } catch (err: any) {
            emit(io, {
                ts: new Date().toISOString(),
                level: 'warn',
                message: `⚠️ Seller gas top-up failed: ${err.message?.slice(0, 80)}`,
            });
        }

        // ── Step 2: Withdraw deployer's vault balance to wallet (recover locked USDC) ──
        try {
            const deployerVaultBal = await vault.balanceOf(signer.address);
            if (deployerVaultBal > 0n) {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'step',
                    message: `📤 Withdrawing $${ethers.formatUnits(deployerVaultBal, 6)} USDC from deployer vault to wallet...`,
                });
                const withdrawTx = await vault.withdraw(deployerVaultBal);
                await withdrawTx.wait();
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'success',
                    message: `✅ Withdrawn $${ethers.formatUnits(deployerVaultBal, 6)} USDC to deployer wallet`,
                });
            }
        } catch (err: any) {
            emit(io, {
                ts: new Date().toISOString(),
                level: 'warn',
                message: `⚠️ Deployer vault withdraw failed: ${err.message?.slice(0, 80)}`,
            });
        }

        // ── Step 3: Recycle USDC from seller wallet back to deployer ──
        try {
            const sellerWallet = new ethers.Wallet(DEMO_SELLER_KEY, provider);
            const sellerUsdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, sellerWallet);
            const sellerBal = await sellerUsdc.balanceOf(sellerWallet.address);
            if (sellerBal > 0n) {
                // Gas top-up for seller if needed
                if ((await provider.getBalance(sellerWallet.address)) < ethers.parseEther('0.0005')) {
                    const gasTx = await signer.sendTransaction({ to: sellerWallet.address, value: ethers.parseEther('0.001') });
                    await gasTx.wait();
                }
                const tx = await sellerUsdc.transfer(signer.address, sellerBal);
                await tx.wait();
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'success',
                    message: `✅ Recycled $${ethers.formatUnits(sellerBal, 6)} USDC from seller to deployer`,
                });
            }
        } catch (err: any) {
            emit(io, {
                ts: new Date().toISOString(),
                level: 'warn',
                message: `⚠️ Seller recycle failed: ${err.message?.slice(0, 80)}`,
            });
        }

        // ── Step 4: Recycle USDC from all buyer wallets back to deployer ──
        for (const buyerAddr of DEMO_BUYER_WALLETS) {
            try {
                const bKey = BUYER_KEYS[buyerAddr];
                if (!bKey) continue;

                // Withdraw buyer's vault balance first
                const bSigner = new ethers.Wallet(bKey, provider);
                const bVault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, bSigner);
                const bVaultBal = await bVault.balanceOf(buyerAddr);
                if (bVaultBal > 0n) {
                    if ((await provider.getBalance(buyerAddr)) < ethers.parseEther('0.0005')) {
                        const gasTx = await signer.sendTransaction({ to: buyerAddr, value: ethers.parseEther('0.001') });
                        await gasTx.wait();
                    }
                    const wTx = await bVault.withdraw(bVaultBal);
                    await wTx.wait();
                }

                // Transfer any wallet USDC back to deployer
                const bUsdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, bSigner);
                const bWalletBal = await bUsdc.balanceOf(buyerAddr);
                if (bWalletBal > 0n) {
                    if ((await provider.getBalance(buyerAddr)) < ethers.parseEther('0.0005')) {
                        const gasTx = await signer.sendTransaction({ to: buyerAddr, value: ethers.parseEther('0.001') });
                        await gasTx.wait();
                    }
                    const tx = await bUsdc.transfer(signer.address, bWalletBal);
                    await tx.wait();
                    emit(io, {
                        ts: new Date().toISOString(),
                        level: 'success',
                        message: `✅ Recycled $${ethers.formatUnits(bWalletBal, 6)} from buyer ${buyerAddr.slice(0, 10)}…`,
                    });
                }
            } catch { /* skip */ }
        }

        // ── Step 5: One-time pre-fund — send USDC to each buyer, then each buyer deposits into vault ──
        const PRE_FUND_AMOUNT = 80; // $80 USDC per buyer
        const preFundUnits = ethers.parseUnits(String(PRE_FUND_AMOUNT), 6);

        const deployerUsdcBal = await usdc.balanceOf(signer.address);
        const totalNeeded = preFundUnits * BigInt(DEMO_BUYER_WALLETS.length);
        emit(io, {
            ts: new Date().toISOString(),
            level: 'info',
            message: `📊 Deployer wallet USDC after recycle: $${ethers.formatUnits(deployerUsdcBal, 6)} | Need: $${ethers.formatUnits(totalNeeded, 6)}`,
        });

        let buyersFunded = 0;
        for (const buyerAddr of DEMO_BUYER_WALLETS) {
            if (signal.aborted) throw new Error('Demo aborted');

            const buyerKey = BUYER_KEYS[buyerAddr];
            if (!buyerKey) continue;

            try {
                // Check if buyer already has vault balance — skip if funded
                const existingBal = await vault.balanceOf(buyerAddr);
                if (existingBal >= preFundUnits) {
                    emit(io, {
                        ts: new Date().toISOString(),
                        level: 'info',
                        message: `⏭️ Buyer ${buyerAddr.slice(0, 10)}… already has $${ethers.formatUnits(existingBal, 6)} in vault — skipping`,
                    });
                    buyersFunded++;
                    continue;
                }

                // Gas top-up for buyer if needed
                const buyerEth = await provider.getBalance(buyerAddr);
                if (buyerEth < ethers.parseEther('0.0005')) {
                    const gasTx = await signer.sendTransaction({
                        to: buyerAddr,
                        value: ethers.parseEther('0.001'),
                    });
                    await gasTx.wait();
                }

                // Deployer sends USDC to buyer
                const transferTx = await usdc.transfer(buyerAddr, preFundUnits);
                await transferTx.wait();

                // Buyer approves vault to spend USDC
                const buyerSigner = new ethers.Wallet(buyerKey, provider);
                const buyerUsdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, buyerSigner);
                const buyerVault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, buyerSigner);

                const approveTx = await buyerUsdc.approve(VAULT_ADDRESS, preFundUnits);
                await approveTx.wait();

                // Buyer deposits into their own vault
                const depositTx = await buyerVault.deposit(preFundUnits);
                await depositTx.wait();

                buyersFunded++;
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'success',
                    message: `✅ Buyer ${buyerAddr.slice(0, 10)}… funded & deposited $${PRE_FUND_AMOUNT} USDC into vault (${buyersFunded}/${DEMO_BUYER_WALLETS.length})`,
                });
            } catch (err: any) {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ Pre-fund failed for ${buyerAddr.slice(0, 10)}…: ${err.message?.slice(0, 80)}`,
                });
            }
        }

        emit(io, {
            ts: new Date().toISOString(),
            level: buyersFunded > 0 ? 'success' : 'error',
            message: `${buyersFunded > 0 ? '✅' : '❌'} Pre-fund complete: ${buyersFunded}/${DEMO_BUYER_WALLETS.length} buyers ready`,
        });

        // ── Step 2: Start staggered lead drip (runs in background) ──
        if (signal.aborted) throw new Error('Demo aborted');
        const drip = startLeadDrip(io, signal, cycles + 15, 5);

        // ── Auction Cycles (run concurrently with lead drip) ──
        for (let cycle = 1; cycle <= cycles; cycle++) {
            if (signal.aborted) throw new Error('Demo aborted');

            const vertical = DEMO_VERTICALS[(cycle - 1) % DEMO_VERTICALS.length];
            const buyerWallet = DEMO_BUYER_WALLETS[(cycle - 1) % DEMO_BUYER_WALLETS.length];

            // ── Pre-cycle buyer vault balance check — cap bid to available ──
            let bidAmount = rand(3, 10); // $3–$10 per bid (conservative to avoid exhaustion)
            try {
                // Check THIS buyer's vault balance (per-buyer model)
                const buyerVaultBal = await vault.balanceOf(buyerWallet);
                const buyerLockedBal = await vault.lockedBalances(buyerWallet);
                const availableUsdc = Math.max(0, (Number(buyerVaultBal) - Number(buyerLockedBal)) / 1e6);
                const maxPerBid = Math.floor(availableUsdc / 3); // 3 bids per cycle
                if (maxPerBid < 1) {
                    emit(io, {
                        ts: new Date().toISOString(),
                        level: 'warn',
                        message: `⚠️ Buyer ${buyerWallet.slice(0, 10)}… vault too low ($${availableUsdc.toFixed(2)} available). Skipping cycle ${cycle}.`,
                        cycle,
                        totalCycles: cycles,
                    });
                    continue;
                }
                bidAmount = Math.min(bidAmount, maxPerBid);
            } catch { /* proceed with default bid amount */ }
            const bidAmountUnits = ethers.parseUnits(String(bidAmount), 6);

            emit(io, {
                ts: new Date().toISOString(),
                level: 'step',
                message: `\n${'─'.repeat(56)}\n🔄 Cycle ${cycle}/${cycles} — ${vertical.toUpperCase()} | $${bidAmount}/bid\n${'─'.repeat(56)}`,
                cycle,
                totalCycles: cycles,
            });

            // ── Inject lead into DB + marketplace ──
            let demoLeadId: string | null = null;
            try {
                const geo = pick(GEOS);
                const params = buildDemoParams(vertical);
                const paramCount = params ? Object.keys(params).filter(k => params[k] != null && params[k] !== '').length : 0;
                const demoScoreInput: LeadScoringInput = {
                    tcpaConsentAt: new Date(),
                    geo: { country: geo.country, state: geo.state, zip: `${rand(10000, 99999)}` },
                    hasEncryptedData: false,
                    encryptedDataValid: false,
                    parameterCount: paramCount,
                    source: 'PLATFORM',
                    zipMatchesState: false,
                };
                const qualityScore = computeCREQualityScore(demoScoreInput);

                // Ensure seller exists
                const sellerId = await ensureDemoSeller(DEMO_SELLER_WALLET);

                const lead = await prisma.lead.create({
                    data: {
                        sellerId,
                        vertical,
                        geo: { country: geo.country, state: geo.state, city: geo.city } as any,
                        source: 'DEMO',
                        status: 'IN_AUCTION',
                        reservePrice: bidAmount,
                        isVerified: true,
                        qualityScore,
                        tcpaConsentAt: new Date(),
                        auctionStartAt: new Date(),
                        auctionEndAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
                        parameters: params as any,
                    },
                });

                demoLeadId = lead.id;

                // Create auction room
                await prisma.auctionRoom.create({
                    data: {
                        leadId: lead.id,
                        roomId: `auction_${lead.id}`,
                        phase: 'BIDDING',
                        biddingEndsAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
                        revealEndsAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
                    },
                });

                // Emit marketplace events so the lead appears in real time
                io.emit('marketplace:lead:new', {
                    lead: {
                        id: lead.id,
                        vertical,
                        status: 'IN_AUCTION',
                        reservePrice: bidAmount,
                        geo: { country: geo.country, state: geo.state },
                        isVerified: true,
                        sellerId,
                        auctionStartAt: lead.auctionStartAt?.toISOString(),
                        auctionEndAt: lead.auctionEndAt?.toISOString(),
                        parameters: params,
                        qualityScore: qualityScore != null ? Math.floor(qualityScore / 100) : null,
                        _count: { bids: 0 },
                    },
                });
                io.emit('marketplace:refreshAll');

                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'success',
                    message: `📝 Lead injected → ${lead.id.slice(0, 8)}… (${vertical}, $${bidAmount}, ${geo.country}/${geo.state})`,
                    cycle,
                    totalCycles: cycles,
                    data: { leadId: lead.id, vertical },
                });
            } catch (leadErr: any) {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ Lead injection skipped: ${leadErr.message?.slice(0, 100)}`,
                    cycle,
                    totalCycles: cycles,
                });
            }

            // ── Lock 3 bids ──
            const lockIds: number[] = [];
            let cycleGas = 0n;

            for (let b = 0; b < 3; b++) {
                if (signal.aborted) throw new Error('Demo aborted');

                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'info',
                    message: `🔒 Locking bid #${b + 1} — $${bidAmount} USDC from buyer ${buyerWallet.slice(0, 10)}…`,
                    cycle,
                    totalCycles: cycles,
                });

                const { receipt, gasUsed } = await sendTx(
                    io,
                    `Lock bid #${b + 1} ($${bidAmount})`,
                    () => vault.lockForBid(buyerWallet, bidAmountUnits),
                    cycle,
                    cycles,
                );
                cycleGas += gasUsed;

                // Extract lockId from BidLocked event
                const iface = new ethers.Interface(VAULT_ABI);
                for (const log of receipt.logs) {
                    try {
                        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
                        if (parsed?.name === 'BidLocked') {
                            lockIds.push(Number(parsed.args[0]));
                        }
                    } catch { /* skip other events */ }
                }

                // Emit marketplace:bid:update so bid counts tick up live on cards
                if (demoLeadId) {
                    io.emit('marketplace:bid:update', {
                        leadId: demoLeadId,
                        bidCount: b + 1,
                        highestBid: bidAmount,
                        timestamp: new Date().toISOString(),
                    });
                }

                await sleep(500); // Brief pause between txs
            }

            emit(io, {
                ts: new Date().toISOString(),
                level: 'info',
                message: `📋 Lock IDs: [${lockIds.join(', ')}]`,
                cycle,
                totalCycles: cycles,
                data: { lockIds },
            });

            // ── Settle winner (first lock) ──
            if (signal.aborted) throw new Error('Demo aborted');

            const winnerLockId = lockIds[0];
            emit(io, {
                ts: new Date().toISOString(),
                level: 'step',
                message: `💰 Settling winner — lock #${winnerLockId} → seller ${DEMO_SELLER_WALLET.slice(0, 10)}…`,
                cycle,
                totalCycles: cycles,
            });

            const { receipt: settleReceipt, gasUsed: settleGas } = await sendTx(
                io,
                `Settle winner (lock #${winnerLockId} → seller)`,
                () => vault.settleBid(winnerLockId, DEMO_SELLER_WALLET),
                cycle,
                cycles,
            );
            cycleGas += settleGas;
            totalSettled += bidAmount;

            // ── Refund losers ──
            const refundTxHashes: string[] = [];
            for (let r = 1; r < lockIds.length; r++) {
                if (signal.aborted) throw new Error('Demo aborted');

                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'info',
                    message: `🔓 Refunding loser — lock #${lockIds[r]}`,
                    cycle,
                    totalCycles: cycles,
                });

                const { receipt: refundReceipt, gasUsed: refundGas } = await sendTx(
                    io,
                    `Refund loser (lock #${lockIds[r]})`,
                    () => vault.refundBid(lockIds[r]),
                    cycle,
                    cycles,
                );
                cycleGas += refundGas;
                refundTxHashes.push(refundReceipt.hash);

                await sleep(300);
            }

            // ── PoR verify ──
            if (signal.aborted) throw new Error('Demo aborted');

            emit(io, {
                ts: new Date().toISOString(),
                level: 'step',
                message: `🏦 Running Proof of Reserves check...`,
                cycle,
                totalCycles: cycles,
            });

            const { receipt: porReceipt, gasUsed: porGas } = await sendTx(
                io,
                'verifyReserves()',
                () => vault.verifyReserves(),
                cycle,
                cycles,
            );
            cycleGas += porGas;

            const solvent = await vault.lastPorSolvent();
            const actual = await usdc.balanceOf(VAULT_ADDRESS);
            const obligations = await vault.totalObligations();

            const status = solvent ? '✅ SOLVENT' : '❌ INSOLVENT';
            emit(io, {
                ts: new Date().toISOString(),
                level: solvent ? 'success' : 'error',
                message: `🏦 PoR Result: ${status}\n   Contract USDC: $${(Number(actual) / 1e6).toFixed(2)}\n   Obligations:   $${(Number(obligations) / 1e6).toFixed(2)}\n   Margin:        $${((Number(actual) - Number(obligations)) / 1e6).toFixed(2)}`,
                txHash: porReceipt.hash,
                cycle,
                totalCycles: cycles,
                data: {
                    solvent,
                    contractBalance: (Number(actual) / 1e6).toFixed(2),
                    obligations: (Number(obligations) / 1e6).toFixed(2),
                    margin: ((Number(actual) - Number(obligations)) / 1e6).toFixed(2),
                },
            });

            totalGas += cycleGas;

            cycleResults.push({
                cycle,
                vertical,
                buyerWallet,
                bidAmount,
                lockIds,
                winnerLockId,
                settleTxHash: settleReceipt.hash,
                refundTxHashes,
                porSolvent: solvent,
                porTxHash: porReceipt.hash,
                gasUsed: cycleGas,
            });

            // Brief pause between cycles
            if (cycle < cycles) await sleep(1000);
        }

        // ── Stop background lead drip ──
        drip.stop();
        await drip.promise;

        // ── Final Summary ──
        emit(io, {
            ts: new Date().toISOString(),
            level: 'success',
            message: `
╔══════════════════════════════════════════════════════════╗
║  ✅  DEMO COMPLETE                                      ║
║  Cycles:    ${String(cycles).padEnd(44)}║
║  Settled:   $${String(totalSettled).padEnd(43)}║
║  Total Gas: ${totalGas.toString().padEnd(44)}║
║  Status:    All cycles SOLVENT                           ║
╚══════════════════════════════════════════════════════════╝`,
            data: { runId, cycles, totalSettled, totalGas: totalGas.toString() },
        });

        const result: DemoResult = {
            runId,
            startedAt,
            completedAt: new Date().toISOString(),
            cycles: cycleResults,
            totalGas: totalGas.toString(),
            totalSettled,
            status: 'completed',
        };

        resultsStore.set(runId, result);

        // Emit completion event
        io.emit('demo:complete', { runId, status: 'completed', totalCycles: cycles, totalSettled });

        return result;

    } catch (err: any) {
        const isAbort = err.message === 'Demo aborted';

        emit(io, {
            ts: new Date().toISOString(),
            level: isAbort ? 'warn' : 'error',
            message: isAbort
                ? '⏹️ Demo aborted by user'
                : `❌ Demo failed: ${err.message?.slice(0, 200) || String(err)}`,
        });

        const result: DemoResult = {
            runId,
            startedAt,
            completedAt: new Date().toISOString(),
            cycles: cycleResults,
            totalGas: totalGas.toString(),
            totalSettled,
            status: isAbort ? 'aborted' : 'failed',
            error: isAbort ? undefined : err.message,
        };

        resultsStore.set(runId, result);

        io.emit('demo:complete', {
            runId,
            status: result.status,
            totalCycles: cycleResults.length,
            totalSettled,
            error: result.error,
        });

        return result;

    } finally {
        isRunning = false;
        currentAbort = null;
    }
}

// ── Control Functions ──────────────────────────────

export function stopDemo(): boolean {
    if (!isRunning || !currentAbort) return false;
    currentAbort.abort();
    return true;
}

export function isDemoRunning(): boolean {
    return isRunning;
}

export function getResults(runId: string): DemoResult | undefined {
    return resultsStore.get(runId);
}

export function getAllResults(): DemoResult[] {
    return Array.from(resultsStore.values()).sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
}

export function getLatestResult(): DemoResult | undefined {
    const all = getAllResults();
    return all.length > 0 ? all[0] : undefined;
}
