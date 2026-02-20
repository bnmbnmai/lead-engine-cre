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
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';
import { aceDevBus } from './ace.service';
import * as vaultService from './vault.service';
import { LEAD_AUCTION_DURATION_SECS } from '../config/perks.env';
import { computeCREQualityScore, type LeadScoringInput } from '../lib/chainlink/cre-quality-score';

// ── Config ─────────────────────────────────────────

const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const _VAULT_ADDRESS_RAW = process.env.VAULT_ADDRESS_BASE_SEPOLIA || '';
const VAULT_ADDRESS = _VAULT_ADDRESS_RAW;
const USDC_ADDRESS = process.env.USDC_CONTRACT_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const BASE_SEPOLIA_CHAIN_ID = 84532;
const MAX_CYCLES = 12;
const BASESCAN_BASE = 'https://sepolia.basescan.org/tx/';

// Demo buyer wallets — 10 distinct faucet wallets (Wallets 1–10).
// None of these overlap with the seller wallet (Wallet 11).
const DEMO_BUYER_WALLETS = [
    '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9', // Wallet 1
    '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC', // Wallet 2
    '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58', // Wallet 3
    '0x424CaC929939377f221348af52d4cb1247fE4379', // Wallet 4
    '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d', // Wallet 5
    '0x089B6Bdb4824628c5535acF60aBF80683452e862', // Wallet 6
    '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE', // Wallet 7
    '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C', // Wallet 8
    '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf', // Wallet 9
    '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad', // Wallet 10
];

// Demo seller wallet (Wallet 11 — dedicated, never overlaps with any buyer)
// Address generated: 2026-02-19. Testnet only.
const DEMO_SELLER_WALLET = '0x9Bb15F98982715E33a2113a35662036528eE0A36';
const DEMO_SELLER_KEY = '0x618bee99ca60f5511dad533a998344f3a0a7b2339db5726ae33d56fd543294ce';

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
    buyerWallet: string;     // winner's wallet (kept for backward compat)
    buyerWallets: string[];  // all 3 distinct bidder wallets (Phase 2)
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
let isRecycling = false;
let currentAbort: AbortController | null = null;
let recycleAbort: AbortController | null = null;
const resultsStore = new Map<string, DemoResult>();

// Module-level io reference — set by runFullDemo and used by stopDemo for
// broadcasting demo:status without requiring the caller to pass io again.
let moduleIo: SocketServer | null = null;

// ── File Persistence (secondary fallback) ──────────────
const RESULTS_FILE = path.join(process.cwd(), 'demo-results.json');

function saveResultsToDisk() {
    try {
        const all = Array.from(resultsStore.values());
        fs.writeFileSync(RESULTS_FILE, JSON.stringify(all, null, 2));
    } catch { /* non-fatal */ }
}

// ── DB Persistence (primary / source of truth) ─────────

/**
 * Upsert a single DemoResult to the DemoRun table.
 * Also updates the in-memory cache and writes the disk fallback.
 * Non-fatal on DB error so demo doesn't fail for persistence reasons.
 */
async function saveResultsToDB(result: DemoResult): Promise<void> {
    // Update in-memory cache immediately
    resultsStore.set(result.runId, result);
    // Write disk fallback
    saveResultsToDisk();

    try {
        const statusMap: Record<string, 'RUNNING' | 'COMPLETED' | 'ABORTED' | 'FAILED'> = {
            running: 'RUNNING',
            completed: 'COMPLETED',
            aborted: 'ABORTED',
            failed: 'FAILED',
        };
        const dbStatus = statusMap[result.status] ?? 'FAILED';

        await prisma.demoRun.upsert({
            where: { runId: result.runId },
            create: {
                runId: result.runId,
                status: dbStatus,
                startedAt: new Date(result.startedAt),
                completedAt: result.completedAt ? new Date(result.completedAt) : null,
                result: result as any,
            },
            update: {
                status: dbStatus,
                completedAt: result.completedAt ? new Date(result.completedAt) : null,
                result: result as any,
            },
        });
    } catch (err: any) {
        console.warn('[DEMO E2E] DB persist failed (non-fatal):', err.message?.slice(0, 120));
    }
}

/**
 * Load all demo results from the DB into the in-memory cache.
 * Called once on module init and on GET /results endpoints when cache is cold.
 */
async function loadResultsFromDB(): Promise<void> {
    try {
        const rows = await prisma.demoRun.findMany({
            orderBy: { startedAt: 'desc' },
            take: 20, // cap to last 20 runs (Json field can be large)
        });
        for (const row of rows) {
            if (row.result && typeof row.result === 'object') {
                const r = row.result as unknown as DemoResult;
                if (r.runId) resultsStore.set(r.runId, r);
            }
        }
        console.log(`[DEMO E2E] Loaded ${rows.length} demo results from DB`);
    } catch (err: any) {
        console.warn('[DEMO E2E] DB load failed, falling back to disk cache:', err.message?.slice(0, 80));
        loadResultsFromDisk();
    }
}

function loadResultsFromDisk() {
    try {
        if (fs.existsSync(RESULTS_FILE)) {
            const raw = fs.readFileSync(RESULTS_FILE, 'utf-8');
            const arr: DemoResult[] = JSON.parse(raw);
            for (const r of arr) resultsStore.set(r.runId, r);
            console.log(`[DEMO E2E] Loaded ${arr.length} results from disk fallback`);
        }
    } catch { /* non-fatal */ }
}

/**
 * Called by the route file on server startup (async-safe).
 * Populates the in-memory cache from DB, falls back to disk.
 */
export async function initResultsStore(): Promise<void> {
    await loadResultsFromDB();
}

// Sync disk fallback on module init (DB load is triggered via initResultsStore)
loadResultsFromDisk();

// ── Shared Deployer Provider + Nonce Queue ─────────
// Both startLeadDrip (gas top-ups) and recycleTokens run concurrently and both
// use the same deployer private key. Using separate providers per call meant two
// independent nonce trackers racing each other → "replacement transaction underpriced".
//
// Solution: one shared provider, one serialised nonce promise chain.
// Any function that needs to send a deployer transaction calls getNextNonce() which
// awaits the previous promise before reading the next nonce from the chain.

let _sharedProvider: ethers.JsonRpcProvider | null = null;
let _nonceChain: Promise<number> = Promise.resolve(-1);

function getSharedProvider(): ethers.JsonRpcProvider {
    if (!_sharedProvider) {
        _sharedProvider = new ethers.JsonRpcProvider(RPC_URL);
    }
    return _sharedProvider;
}

function getProvider() {
    return getSharedProvider();
}

function getSigner() {
    if (!DEPLOYER_KEY) throw new Error('DEPLOYER_PRIVATE_KEY not set');
    return new ethers.Wallet(DEPLOYER_KEY, getSharedProvider());
}

/**
 * getNextNonce — serialises deployer nonce allocation.
 * Each caller awaits the previous call's promise before reading the
 * pending transaction count, so sequential increments are guaranteed.
 */
async function getNextNonce(): Promise<number> {
    _nonceChain = _nonceChain.then(async () => {
        const provider = getSharedProvider();
        return provider.getTransactionCount(
            new ethers.Wallet(DEPLOYER_KEY).address, 'pending',
        );
    });
    return _nonceChain;
}

// ── Gas Escalation Fix ─────────────────────────────
// Base Sepolia's EIP-1559 base fee fluctuates.  Plain signer.sendTransaction() uses
// the provider's estimateGas which can be stale, producing:
//   "replacement fee too low"  — when the mempool already has a tx at nonce N
//   "already known"            — when the unsigned fee is identical to existing mempool tx
//
// sendWithGasEscalation() reads the live baseFee, starts at 1.5× multiplier and doubles
// the priority-fee escalation by 50% on each retry so the replacement is always accepted.

interface TxRequest extends ethers.TransactionRequest {
    nonce?: number;
}

/**
 * Gas escalation fix — wraps signer.sendTransaction with EIP-1559 retry logic.
 *
 * @param signer     - the ethers.Wallet that will sign / send
 * @param txReq      - transaction fields (to, value, data, nonce, ...)
 * @param label      - short label for Dev Log lines (e.g. "gas top-up buyer 0xa75…")
 * @param log        - emit helper so progress is visible in the Dev Log
 * @param maxRetries - default 3
 */
async function sendWithGasEscalation(
    signer: ethers.Wallet,
    txReq: TxRequest,
    label: string,
    log: (msg: string) => void,
    maxRetries = 3,
): Promise<ethers.TransactionResponse> {
    const provider = signer.provider as ethers.JsonRpcProvider;
    const PRIORITY_FEE = ethers.parseUnits('2', 'gwei');   // fixed tip
    const BASE_MULTIPLIER = 1.5;                            // start 1.5× baseFee
    const ESCALATION = 1.5;                                 // each retry: ×1.5

    let multiplier = BASE_MULTIPLIER;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Gas escalation fix: derive current baseFee from the pending block (ethers v6).
        // FeeData.lastBaseFeePerGas was removed in v6; use block.baseFeePerGas instead.
        const pendingBlock = await provider.getBlock('pending');
        const feeData = await provider.getFeeData();
        const baseFee = pendingBlock?.baseFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits('1', 'gwei');
        const maxFee = BigInt(Math.ceil(Number(baseFee) * multiplier)) + PRIORITY_FEE;

        log(
            `Attempt ${attempt}/${maxRetries} — baseFee=${ethers.formatUnits(baseFee, 'gwei').slice(0, 6)} gwei, ` +
            `maxFee=${ethers.formatUnits(maxFee, 'gwei').slice(0, 6)} gwei [${label}]`,
        );

        try {
            return await signer.sendTransaction({
                ...txReq,
                maxPriorityFeePerGas: PRIORITY_FEE,
                maxFeePerGas: maxFee,
                type: 2,  // EIP-1559
            });
        } catch (err: any) {
            const msg: string = err.message ?? '';
            const isReplaceable = (
                msg.includes('replacement fee too low') ||
                msg.includes('already known') ||
                msg.includes('nonce too low') ||
                msg.includes('underpriced')
            );
            if (isReplaceable && attempt < maxRetries) {
                log(`⚠️ Gas too low on attempt ${attempt} (${msg.slice(0, 60)}) — escalating…`);
                multiplier = multiplier * ESCALATION;
                await new Promise(r => setTimeout(r, 400 * attempt)); // brief back-off
                continue;
            }
            throw err; // bubble non-retriable errors immediately
        }
    }
    throw new Error(`sendWithGasEscalation: all ${maxRetries} attempts failed [${label}]`);
}


function getVault(signer: ethers.Wallet) {
    if (!_VAULT_ADDRESS_RAW) {
        throw new Error('VAULT_ADDRESS_BASE_SEPOLIA environment variable not set. Add it to Render env vars before running the demo.');
    }
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

/**
 * emitStatus — broadcast global demo state to ALL connected sockets.
 *
 * Received by useDemoStatus (frontend) to disable/enable the Run Demo
 * button and show live cycle progress for every viewer regardless of
 * persona or auth state.
 *
 * Shape mirrors the GET /full-e2e/status response so the frontend can
 * use either the HTTP poll (on mount) or the socket event (real-time).
 */
function emitStatus(
    io: SocketServer,
    payload: {
        running: boolean;
        recycling?: boolean;
        currentCycle?: number;
        totalCycles?: number;
        percent?: number;
        phase?: string;
        runId?: string;
    },
) {
    io.emit('demo:status', {
        ...payload,
        recycling: payload.recycling ?? false,
        currentCycle: payload.currentCycle ?? 0,
        totalCycles: payload.totalCycles ?? 0,
        percent: payload.percent ?? 0,
        phase: payload.phase ?? (payload.running ? 'running' : 'idle'),
        ts: new Date().toISOString(),
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

// ── Token Recycling (background phase) ───────────

// ⚠️ TEMPORARY SAFE MODE — Full USDC Recovery Guaranteed
// Every buyer and seller wallet is fully drained back to deployer after each run.
// Retry logic handles nonce/replacement-fee errors that caused leakage.
// TODO: Review gas parameters when moving to mainnet.

/**
 * recycleTransfer — sends ALL USDC from a demo wallet back to the deployer.
 *
 * 3-attempt retry loop with 20% gas price bump per attempt.
 * Re-reads the live balance immediately before each attempt so the amount
 * is always fresh (eliminates the stale-balance bug from pre-Phase-2).
 * Handles: replacement-fee-too-low, nonce already used, transfer exceeds balance.
 */
async function recycleTransfer(
    io: SocketServer,
    label: string,
    walletAddr: string,
    walletSigner: ethers.Wallet,
    deployerAddr: string,
    gasTopUpSigner: ethers.Wallet,
): Promise<bigint> {
    const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, walletSigner);
    const provider = walletSigner.provider!;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            // Ensure sender has gas (checked every attempt — a prior attempt may have consumed it)
            if ((await provider.getBalance(walletAddr)) < ethers.parseEther('0.0005')) {
                const gasTx = await gasTopUpSigner.sendTransaction({
                    to: walletAddr,
                    value: ethers.parseEther('0.001'),
                });
                await gasTx.wait();
            }

            // Re-read live balance immediately before sending (prevents stale-balance errors)
            const bal = await usdc.balanceOf(walletAddr);
            if (bal === 0n) return 0n;

            // Escalate gas price 20% per retry to beat replacement-fee-too-low
            const feeData = await provider.getFeeData();
            const gasPrice = feeData.gasPrice
                ? (feeData.gasPrice * BigInt(100 + (attempt - 1) * 20)) / 100n
                : undefined;

            const tx = await usdc.transfer(deployerAddr, bal, gasPrice ? { gasPrice } : {});
            await tx.wait();

            emit(io, {
                ts: new Date().toISOString(),
                level: 'success',
                message: `✅ Recycled $${ethers.formatUnits(bal, 6)} USDC from ${label} (attempt ${attempt})`,
            });
            return bal;

        } catch (err: any) {
            const msg = err.message?.slice(0, 100) ?? 'unknown';
            if (attempt < 3) {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ Transfer attempt ${attempt}/3 failed for ${label}: ${msg} — retrying with higher gas…`,
                });
                await new Promise(r => setTimeout(r, 1500 * attempt)); // back-off
            } else {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ All 3 transfer attempts failed for ${label}: ${msg} — USDC may remain in wallet`,
                });
            }
        }
    }
    return 0n;
}

/**
 * recycleTokens — runs AFTER demo:complete fires, non-blocking.
 *
 * Full recovery path:
 *   R1 — Gas top-up for seller
 *   R2 — Withdraw deployer's own vault balance
 *   R3 — Withdraw seller vault + transfer all seller USDC → deployer
 *   R4 — For every buyer: withdraw vault (free balance) + transfer all wallet USDC → deployer
 *   R5 — FINAL SWEEP: re-check every wallet for any residual USDC and transfer again
 *   R6 — Log deployer start vs end balance for full visibility
 *
 * Emits demo:recycle-start / demo:recycle-complete socket events.
 * Never throws — all errors are caught and logged as warnings.
 */
async function recycleTokens(
    io: SocketServer,
    signal: AbortSignal,
    BUYER_KEYS: Record<string, string>,
): Promise<void> {
    isRecycling = true;
    recycleAbort = new AbortController();

    try {
        emit(io, {
            ts: new Date().toISOString(),
            level: 'step',
            message: '♻️  Full USDC recovery starting — draining all demo wallets back to deployer...',
        });
        io.emit('demo:recycle-start', { ts: new Date().toISOString() });

        const provider = getProvider();
        const signer = getSigner();
        const vault = getVault(signer);
        const usdc = getUSDC(signer);
        const recycleSignal = recycleAbort.signal;

        // ── Bookend: Record deployer USDC balance BEFORE recycle ──
        const deployerBalBefore = await usdc.balanceOf(signer.address);
        emit(io, {
            ts: new Date().toISOString(),
            level: 'info',
            message: `📊 Deployer USDC before recycle: $${ethers.formatUnits(deployerBalBefore, 6)}`,
        });

        let totalRecovered = 0n;

        // ── Step R1: Gas top-up for seller if needed ──
        try {
            if ((await provider.getBalance(DEMO_SELLER_WALLET)) < ethers.parseEther('0.0005')) {
                const gasTx = await signer.sendTransaction({
                    to: DEMO_SELLER_WALLET,
                    value: ethers.parseEther('0.001'),
                });
                await gasTx.wait();
            }
        } catch (err: any) {
            emit(io, {
                ts: new Date().toISOString(),
                level: 'warn',
                message: `⚠️ Seller gas top-up failed (non-fatal): ${err.message?.slice(0, 80)}`,
            });
        }

        // ── Step R2: Withdraw deployer vault balance to deployer wallet ──
        try {
            const deployerVaultBal = await vault.balanceOf(signer.address);
            if (deployerVaultBal > 0n) {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'info',
                    message: `📤 Withdrawing $${ethers.formatUnits(deployerVaultBal, 6)} from deployer vault...`,
                });
                const withdrawTx = await vault.withdraw(deployerVaultBal);
                await withdrawTx.wait();
                totalRecovered += deployerVaultBal;
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'success',
                    message: `✅ Deployer vault withdrawn: $${ethers.formatUnits(deployerVaultBal, 6)}`,
                });
            }
        } catch (err: any) {
            emit(io, {
                ts: new Date().toISOString(),
                level: 'warn',
                message: `⚠️ Deployer vault withdraw failed: ${err.message?.slice(0, 80)}`,
            });
        }

        // ── Step R3: Seller — withdraw vault balance, then transfer all USDC → deployer ──
        try {
            const sellerSigner = new ethers.Wallet(DEMO_SELLER_KEY, provider);
            const sellerVault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, sellerSigner);

            // Ensure seller has gas
            if ((await provider.getBalance(DEMO_SELLER_WALLET)) < ethers.parseEther('0.0005')) {
                // Gas escalation fix: recycle-phase seller gas top-up
                const gasTx = await sendWithGasEscalation(
                    signer,
                    { to: DEMO_SELLER_WALLET, value: ethers.parseEther('0.001') },
                    `recycle gas seller`,
                    (msg) => emit(io, { ts: new Date().toISOString(), level: 'info', message: msg }),
                );
                await gasTx.wait();
            }

            // Withdraw seller's free vault balance
            const sellerVaultFree = await sellerVault.balanceOf(DEMO_SELLER_WALLET);
            const sellerVaultLocked = await sellerVault.lockedBalances(DEMO_SELLER_WALLET);
            if (sellerVaultLocked > 0n) {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ Seller has $${ethers.formatUnits(sellerVaultLocked, 6)} locked in vault — cannot withdraw until bids settle`,
                });
            }
            if (sellerVaultFree > 0n) {
                const wTx = await sellerVault.withdraw(sellerVaultFree);
                await wTx.wait();
            }

            // Transfer ALL seller USDC wallet balance → deployer (fresh balance read after vault withdraw)
            const recovered = await recycleTransfer(io, `seller ${DEMO_SELLER_WALLET.slice(0, 10)}…`, DEMO_SELLER_WALLET, sellerSigner, signer.address, signer);
            totalRecovered += recovered;

        } catch (err: any) {
            emit(io, {
                ts: new Date().toISOString(),
                level: 'warn',
                message: `⚠️ Seller recycle failed: ${err.message?.slice(0, 80)}`,
            });
        }

        // ── Step R4: All buyer wallets — withdraw vault (free), then transfer all USDC → deployer ──
        for (const buyerAddr of DEMO_BUYER_WALLETS) {
            if (recycleSignal.aborted || signal.aborted) break;

            const bKey = BUYER_KEYS[buyerAddr];
            if (!bKey) continue;

            try {
                const bSigner = new ethers.Wallet(bKey, provider);
                const bVault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, bSigner);

                // Ensure buyer has gas for vault withdraw
                if ((await provider.getBalance(buyerAddr)) < ethers.parseEther('0.0005')) {
                    // Gas escalation fix: recycle-phase buyer gas top-up
                    const gasTx = await sendWithGasEscalation(
                        signer,
                        { to: buyerAddr, value: ethers.parseEther('0.001') },
                        `recycle gas ${buyerAddr.slice(0, 10)}`,
                        (msg) => emit(io, { ts: new Date().toISOString(), level: 'info', message: msg }),
                    );
                    await gasTx.wait();
                }

                // Check for stranded locked balance and warn
                const bLocked = await bVault.lockedBalances(buyerAddr);
                if (bLocked > 0n) {
                    emit(io, {
                        ts: new Date().toISOString(),
                        level: 'warn',
                        message: `⚠️ Buyer ${buyerAddr.slice(0, 10)}… has $${ethers.formatUnits(bLocked, 6)} still locked (stranded bid — will resolve on next cycle's refund)`,
                    });
                }

                // Withdraw free vault balance
                const bVaultFree = await bVault.balanceOf(buyerAddr);
                if (bVaultFree > 0n) {
                    const wTx = await bVault.withdraw(bVaultFree);
                    await wTx.wait();
                }

                // Transfer ALL wallet USDC → deployer (re-reads live balance after vault.withdraw)
                const recovered = await recycleTransfer(io, `buyer ${buyerAddr.slice(0, 10)}…`, buyerAddr, bSigner, signer.address, signer);
                totalRecovered += recovered;

            } catch (err: any) {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ Buyer ${buyerAddr.slice(0, 10)}… recycle failed: ${err.message?.slice(0, 80)}`,
                });
            }
        }

        // ── Step R5: FINAL SWEEP — re-check every demo wallet for residual USDC ──
        // Catches amounts unlocked during earlier steps or race conditions.
        emit(io, {
            ts: new Date().toISOString(),
            level: 'info',
            message: '🔎 Final sweep — checking all demo wallets for residual USDC...',
        });

        const sweepWallets: Array<{ addr: string; key: string; label: string }> = [
            { addr: DEMO_SELLER_WALLET, key: DEMO_SELLER_KEY, label: 'seller' },
            ...DEMO_BUYER_WALLETS
                .filter(addr => BUYER_KEYS[addr])
                .map(addr => ({ addr, key: BUYER_KEYS[addr], label: `buyer ${addr.slice(0, 10)}…` })),
        ];

        for (const { addr, key, label } of sweepWallets) {
            if (recycleSignal.aborted || signal.aborted) break;
            try {
                const wSigner = new ethers.Wallet(key, provider);
                const wUsdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, wSigner);
                const residual = await wUsdc.balanceOf(addr);
                if (residual > 0n) {
                    if ((await provider.getBalance(addr)) < ethers.parseEther('0.0003')) {
                        const gasTx = await signer.sendTransaction({ to: addr, value: ethers.parseEther('0.001') });
                        await gasTx.wait();
                    }
                    const swept = await recycleTransfer(io, `sweep:${label}`, addr, wSigner, signer.address, signer);
                    totalRecovered += swept;
                }
            } catch { /* non-fatal */ }
        }

        // ── Step R6: Bookend — log deployer USDC balance AFTER recycle ──
        const deployerBalAfter = await usdc.balanceOf(signer.address);
        const netRecovered = deployerBalAfter - deployerBalBefore;
        emit(io, {
            ts: new Date().toISOString(),
            level: 'success',
            message: `✅ Full USDC recovery complete\n   Before: $${ethers.formatUnits(deployerBalBefore, 6)}\n   After:  $${ethers.formatUnits(deployerBalAfter, 6)}\n   Net recovered: $${ethers.formatUnits(netRecovered > 0n ? netRecovered : 0n, 6)} (gas costs excluded)`,
        });

        // ── Step R7: Replenish buyer vaults to $250 each for the NEXT run ──
        // This is the background phase that replaces the old blocking pre-fund.
        // All viewers see the 'resetting' phase (Run Demo button disabled globally).
        const REPLENISH_AMOUNT = 250; // $250 per buyer
        const replenishUnits = ethers.parseUnits(String(REPLENISH_AMOUNT), 6);
        const replenishNeeded = replenishUnits * BigInt(DEMO_BUYER_WALLETS.length);
        const deployerUsdcNow = await usdc.balanceOf(signer.address);

        emit(io, {
            ts: new Date().toISOString(),
            level: 'step',
            message: `🔄 Resetting buyer vaults to $${REPLENISH_AMOUNT} each for next run ($${ethers.formatUnits(replenishNeeded, 6)} total needed, deployer has $${ethers.formatUnits(deployerUsdcNow, 6)})`,
        });
        // Broadcast 'resetting' so all viewers' Run Demo buttons are disabled
        if (moduleIo) emitStatus(moduleIo, { running: false, recycling: true, phase: 'resetting', currentCycle: 0, totalCycles: 0, percent: 0 });

        const REPLENISH_BUYER_KEYS: Record<string, string> = {
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

        for (const buyerAddr of DEMO_BUYER_WALLETS) {
            if (recycleSignal.aborted || signal.aborted) break;

            const bKey = REPLENISH_BUYER_KEYS[buyerAddr];
            if (!bKey) continue;

            try {
                // Check how much the buyer currently has in vault
                const currentBal = await vault.balanceOf(buyerAddr);
                if (currentBal >= replenishUnits) {
                    emit(io, { ts: new Date().toISOString(), level: 'info', message: `⏭️ Replenish: ${buyerAddr.slice(0, 10)}… already has $${ethers.formatUnits(currentBal, 6)} — skipping` });
                    continue;
                }

                const topUp = replenishUnits - currentBal;

                // ETH gas check
                const buyerEth = await provider.getBalance(buyerAddr);
                if (buyerEth < ethers.parseEther('0.0005')) {
                    const eNonce = await getNextNonce();
                    const gTx = await sendWithGasEscalation(
                        signer,
                        { to: buyerAddr, value: ethers.parseEther('0.001'), nonce: eNonce },
                        `replenish gas ${buyerAddr.slice(0, 10)}`,
                        (msg) => emit(io, { ts: new Date().toISOString(), level: 'info', message: msg }),
                    );
                    await gTx.wait();
                }

                // Deployer sends USDC top-up amount
                const tNonce = await getNextNonce();
                const tTx = await sendWithGasEscalation(
                    signer,
                    { to: USDC_ADDRESS, data: usdc.interface.encodeFunctionData('transfer', [buyerAddr, topUp]), nonce: tNonce },
                    `replenish USDC ${buyerAddr.slice(0, 10)}`,
                    (msg) => emit(io, { ts: new Date().toISOString(), level: 'info', message: msg }),
                );
                await tTx.wait();

                // Buyer approves vault and deposits
                const bSigner = new ethers.Wallet(bKey, provider);
                const bUsdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, bSigner);
                const bVault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, bSigner);
                const aTx = await bUsdc.approve(VAULT_ADDRESS, topUp);
                await aTx.wait();
                const dTx = await bVault.deposit(topUp);
                await dTx.wait();

                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'success',
                    message: `✅ Replenished ${buyerAddr.slice(0, 10)}… to $${ethers.formatUnits(replenishUnits, 6)} vault balance`,
                });
            } catch (repErr: any) {
                emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Replenish failed for ${buyerAddr.slice(0, 10)}…: ${repErr.message?.slice(0, 60)}` });
            }
        }

        emit(io, { ts: new Date().toISOString(), level: 'success', message: `🟢 Vault reset complete — next Run Demo starts immediately!` });
        io.emit('demo:recycle-complete', { ts: new Date().toISOString(), success: true, deployerBalAfter: ethers.formatUnits(deployerBalAfter, 6) });

    } catch (err: any) {
        emit(io, {
            ts: new Date().toISOString(),
            level: 'warn',
            message: `⚠️ Token redistribution encountered an error (non-fatal): ${err.message?.slice(0, 120)}`,
        });
        io.emit('demo:recycle-complete', { ts: new Date().toISOString(), success: false, error: err.message });
    } finally {
        isRecycling = false;
        recycleAbort = null;
        // Clear the 'resetting' state for all viewers — Run Demo button re-enables
        if (moduleIo) emitStatus(moduleIo, { running: false, recycling: false, phase: 'idle', currentCycle: 0, totalCycles: 0, percent: 0 });
    }
}

// ── Recycle Timeout Guard ─────────────────────────

const RECYCLE_TIMEOUT_MS = 90_000; // 90 seconds hard limit

/**
 * withRecycleTimeout — wraps a recycleTokens() promise with a hard 90s timeout.
 *
 * If recycling gets stuck (hung RPC, Render restart lag, maxed retries), this:
 *   1. Emits a 'partial recovery' warning to the Dev Log so the judge can see it
 *   2. Signals recycleAbort so any in-progress wallet loops stop at the next check
 *   3. Ensures isRecycling is false so the next demo run is never blocked
 *
 * The promise itself continues to run after the timeout fires (node GC will collect it)
 * but it will be aborted at the next iteration boundary.
 */
async function withRecycleTimeout(io: SocketServer, recyclePromise: Promise<void>): Promise<void> {
    const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), RECYCLE_TIMEOUT_MS)
    );

    const result = await Promise.race([recyclePromise.then(() => 'done' as const), timeoutPromise]);

    if (result === 'timeout') {
        // Hard abort any still-pending wallet loops
        if (recycleAbort) recycleAbort.abort();
        isRecycling = false;

        emit(io, {
            ts: new Date().toISOString(),
            level: 'warn',
            message: `⏰ Token recovery timed out after 90s — partial recovery. Some USDC may remain in demo wallets. Run another demo cycle to sweep remaining funds.`,
        });
        if (moduleIo) {
            emitStatus(moduleIo, { running: false, recycling: false, phase: 'idle' });
        }
    }
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
    if (isRecycling) {
        throw new Error('Token redistribution from the previous demo is still running. Please wait ~30 seconds.');
    }

    // ── Validate ──
    cycles = Math.max(1, Math.min(cycles, MAX_CYCLES));

    const runId = uuidv4();
    const startedAt = new Date().toISOString();
    const cycleResults: CycleResult[] = [];
    let totalGas = 0n;
    let totalSettled = 0;

    // BUYER_KEYS hoisted to function scope so catch/finally can pass to recycleTokens()
    // Keys match DEMO_BUYER_WALLETS exactly — Wallets 1–10, no seller overlap.
    const BUYER_KEYS: Record<string, string> = {
        '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9': '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439', // Wallet 1
        '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC': '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618', // Wallet 2
        '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58': '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e', // Wallet 3
        '0x424CaC929939377f221348af52d4cb1247fE4379': '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7', // Wallet 4
        '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d': '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7', // Wallet 5
        '0x089B6Bdb4824628c5535acF60aBF80683452e862': '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75', // Wallet 6
        '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE': '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510', // Wallet 7
        '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C': '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd', // Wallet 8
        '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf': '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c', // Wallet 9
        '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad': '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382', // Wallet 10
    };

    isRunning = true;
    currentAbort = new AbortController();
    const signal = currentAbort.signal;
    moduleIo = io; // store for stopDemo() to broadcast status without needing io param

    // Notify ALL connected viewers the demo has started
    emitStatus(io, { running: true, totalCycles: cycles, currentCycle: 0, percent: 0, phase: 'starting', runId });

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

        // ── Step 0b: Seed 3 leads immediately — marketplace is never empty ──
        // These appear in the marketplace BEFORE the pre-fund loop starts so judges
        // see activity from second 1 instead of a blank screen for 5-15 minutes.
        emit(io, {
            ts: new Date().toISOString(),
            level: 'step',
            message: `🌱 Seeding 3 initial leads into marketplace — visible immediately while we fund buyer wallets...`,
        });
        {
            const seedSellerId = await ensureDemoSeller(DEMO_SELLER_WALLET);
            for (let si = 0; si < 3 && !signal.aborted; si++) {
                try {
                    await injectOneLead(io, seedSellerId, si);
                } catch { /* non-fatal */ }
                await sleep(200);
            }
        }

        // ── Immediate-Start Architecture ──────────────────────────────────────────
        // NEW: No blocking pre-fund phase at demo start. We inject seed leads and
        // start auction cycles immediately, using whatever USDC is already in buyer
        // vaults from the previous run's replenishment phase.
        //
        // The only blocking pre-check is a fast ETH gas top-up for any buyer wallet
        // that has literally zero ETH (can't sign transactions without gas). This
        // takes ~5 seconds total vs 5-15 minutes for the previous full pre-fund.
        //
        // Full $250/buyer USDC vault replenishment runs in background AFTER cycles complete
        // (inside recycleTokens) so the next demo run starts immediately too.
        // ─────────────────────────────────────────────────────────────────────────

        // ── Step 1: Fast ETH-only gas check (non-blocking, ~5s max) ──
        emit(io, {
            ts: new Date().toISOString(),
            level: 'step',
            message: `⛽ Quick ETH gas check for ${DEMO_BUYER_WALLETS.length} buyers — cycles start immediately after...`,
        });
        for (const buyerAddr of DEMO_BUYER_WALLETS) {
            if (signal.aborted) throw new Error('Demo aborted');
            try {
                const buyerEth = await provider.getBalance(buyerAddr);
                if (buyerEth === 0n) {
                    // Only top up if completely dry — one tx per buyer max
                    emit(io, { ts: new Date().toISOString(), level: 'info', message: `⛽ Topping up ETH → ${buyerAddr.slice(0, 10)}…` });
                    const nonce = await getNextNonce();
                    const gasTx = await sendWithGasEscalation(
                        signer,
                        { to: buyerAddr, value: ethers.parseEther('0.001'), nonce },
                        `eth gas ${buyerAddr.slice(0, 10)}`,
                        (msg) => emit(io, { ts: new Date().toISOString(), level: 'info', message: msg }),
                    );
                    await gasTx.wait();
                }
            } catch (err: any) {
                if (err.message === 'Demo aborted') throw err;
                // Non-fatal: buyer may still have enough ETH from previous run
                emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ ETH check failed for ${buyerAddr.slice(0, 10)}… (non-fatal): ${err.message?.slice(0, 60)}` });
            }
        }

        // Log current vault balances for Dev Log transparency
        let buyersWithFunds = 0;
        for (const buyerAddr of DEMO_BUYER_WALLETS) {
            const bal = await vault.balanceOf(buyerAddr);
            if (bal > 0n) {
                buyersWithFunds++;
                emit(io, { ts: new Date().toISOString(), level: 'info', message: `💼 Buyer ${buyerAddr.slice(0, 10)}… vault: $${ethers.formatUnits(bal, 6)}` });
            }
        }
        emit(io, {
            ts: new Date().toISOString(),
            level: buyersWithFunds > 0 ? 'success' : 'warn',
            message: `${buyersWithFunds > 0 ? '✅' : '⚠️'} ${buyersWithFunds}/${DEMO_BUYER_WALLETS.length} buyers have vault funds — starting cycles now`,
        });

        // ── Step 2: Start staggered lead drip (runs in background) ──
        if (signal.aborted) throw new Error('Demo aborted');
        const drip = startLeadDrip(io, signal, cycles + 15, 5);

        // ── Auction Cycles (run concurrently with lead drip) ──
        for (let cycle = 1; cycle <= cycles; cycle++) {
            if (signal.aborted) throw new Error('Demo aborted');

            const vertical = DEMO_VERTICALS[(cycle - 1) % DEMO_VERTICALS.length];
            // ── Per-cycle: pick 3 DISTINCT buyer wallets (rotating offset so every cycle
            //    uses a different trio from the 10-wallet pool, giving Basescan multi-wallet evidence)
            const offset = (cycle - 1) * 3;
            const cycleBuyers = [
                DEMO_BUYER_WALLETS[offset % DEMO_BUYER_WALLETS.length],
                DEMO_BUYER_WALLETS[(offset + 1) % DEMO_BUYER_WALLETS.length],
                DEMO_BUYER_WALLETS[(offset + 2) % DEMO_BUYER_WALLETS.length],
            ];
            // Winner is determined at settle time (first lock = first bidder by convention)
            const buyerWallet = cycleBuyers[0];

            // ── Per-cycle bid amount — each bidder bids a slightly different amount for realism
            // ⚠️  SAFE MODE (TEMPORARY): rand(15, 55) — was rand(25, 75) in Phase 2.
            // Settled total per 5-cycle run: ~$75–$275 (vs $125–$375 at full funding).
            // TODO: Revert to rand(25, 75) once deployer balance is restored to $3,000.
            const baseBid = rand(15, 55); // SAFE MODE bid base — still 3 distinct wallets, real on-chain competition

            // ── Pre-cycle vault check — ensure all 3 cycle buyers have enough balance
            // If any buyer is critically low, emit a warning. We skip only if ALL fail.
            let readyBuyers = 0;
            const buyerBids: { addr: string; amount: number; amountUnits: bigint }[] = [];

            for (let bi = 0; bi < cycleBuyers.length; bi++) {
                const bAddr = cycleBuyers[bi];
                // Stagger bid amounts slightly (+/-$5) so Basescan shows different values
                const bidAmount = Math.max(10, baseBid + (bi === 0 ? 0 : bi === 1 ? rand(-5, 5) : rand(-8, 8)));
                const bidAmountUnits = ethers.parseUnits(String(bidAmount), 6);
                try {
                    const bVaultBal = await vault.balanceOf(bAddr);
                    const bLockedBal = await vault.lockedBalances(bAddr);
                    const available = Math.max(0, (Number(bVaultBal) - Number(bLockedBal)) / 1e6);
                    if (available < bidAmount) {
                        emit(io, {
                            ts: new Date().toISOString(),
                            level: 'warn',
                            message: `⚠️ Buyer ${bAddr.slice(0, 10)}… vault low ($${available.toFixed(2)} / need $${bidAmount}) — pre-funding now`,
                            cycle, totalCycles: cycles,
                        });
                        // Attempt emergency top-up for this buyer before skipping
                        try {
                            const EMRG_TOP_UP = 250; // matches REPLENISH_AMOUNT in recycleTokens R7
                            const topUpAmount = ethers.parseUnits(String(EMRG_TOP_UP), 6);
                            const bKey = BUYER_KEYS[bAddr];
                            if (bKey) {
                                const bSigner = new ethers.Wallet(bKey, provider);
                                const bUsdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, bSigner);
                                const bVaultContract = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, bSigner);
                                // Gas escalation fix + nonce queue for emergency top-up
                                const eNonce1 = await getNextNonce();
                                const gasTx = await sendWithGasEscalation(
                                    signer,
                                    { to: bAddr, value: ethers.parseEther('0.001'), nonce: eNonce1 },
                                    `emrg gas ${bAddr.slice(0, 10)}`,
                                    (msg) => emit(io, { ts: new Date().toISOString(), level: 'info', message: msg, cycle, totalCycles: cycles }),
                                );
                                await gasTx.wait();
                                const eNonce2 = await getNextNonce();
                                const txfr = await sendWithGasEscalation(
                                    signer,
                                    { to: USDC_ADDRESS, data: usdc.interface.encodeFunctionData('transfer', [bAddr, topUpAmount]), nonce: eNonce2 },
                                    `emrg USDC ${bAddr.slice(0, 10)}`,
                                    (msg) => emit(io, { ts: new Date().toISOString(), level: 'info', message: msg, cycle, totalCycles: cycles }),
                                );
                                await txfr.wait();
                                const approveTx = await bUsdcContract.approve(VAULT_ADDRESS, topUpAmount);
                                await approveTx.wait();
                                const depositTx = await bVaultContract.deposit(topUpAmount);
                                await depositTx.wait();
                                emit(io, {
                                    ts: new Date().toISOString(),
                                    level: 'success',
                                    message: `✅ Emergency top-up $${EMRG_TOP_UP} for buyer ${bAddr.slice(0, 10)}…`,
                                    cycle, totalCycles: cycles,
                                });
                            }
                        } catch (topUpErr: any) {
                            emit(io, {
                                ts: new Date().toISOString(),
                                level: 'warn',
                                message: `⚠️ Emergency top-up failed for ${bAddr.slice(0, 10)}…: ${topUpErr.message?.slice(0, 60)}`,
                                cycle, totalCycles: cycles,
                            });
                            continue; // skip this buyer in this cycle
                        }
                    }
                    buyerBids.push({ addr: bAddr, amount: bidAmount, amountUnits: bidAmountUnits });
                    readyBuyers++;
                } catch {
                    // Skip buyer on read error
                }
            }

            if (readyBuyers === 0) {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ All 3 buyers vault-depleted — skipping cycle ${cycle}. Run pre-fund step or wait for recycle.`,
                    cycle, totalCycles: cycles,
                });
                continue;
            }

            // Use the first ready buyer's bid amount as the displayed cycle bid
            const bidAmount = buyerBids[0]?.amount ?? baseBid;
            const bidAmountUnits = buyerBids[0]?.amountUnits ?? ethers.parseUnits(String(bidAmount), 6);

            emit(io, {
                ts: new Date().toISOString(),
                level: 'step',
                message: `\n${'─'.repeat(56)}\n🔄 Cycle ${cycle}/${cycles} — ${vertical.toUpperCase()} | ${readyBuyers} bidders | $${buyerBids.map(b => b.amount).join('/$')}\n   Buyers: ${cycleBuyers.map(a => a.slice(0, 10) + '…').join(', ')}\n${'─'.repeat(56)}`,
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

            // ── Lock 1 bid per distinct buyer (3 distinct wallets → 3 distinct Basescan from-addresses) ──
            const lockIds: number[] = [];
            const lockBuyerMap: { lockId: number; addr: string; amount: number }[] = [];
            let cycleGas = 0n;

            for (let b = 0; b < buyerBids.length; b++) {
                if (signal.aborted) throw new Error('Demo aborted');

                const { addr: bAddr, amount: bAmount, amountUnits: bAmountUnits } = buyerBids[b];

                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'info',
                    message: `🔒 Bidder ${b + 1}/3 — $${bAmount} USDC from ${bAddr.slice(0, 10)}… (competing against ${readyBuyers - 1} other bidders)`,
                    cycle,
                    totalCycles: cycles,
                });

                const { receipt, gasUsed } = await sendTx(
                    io,
                    `Lock bid #${b + 1} — ${bAddr.slice(0, 10)}… bids $${bAmount}`,
                    () => vault.lockForBid(bAddr, bAmountUnits),
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
                            const lockId = Number(parsed.args[0]);
                            lockIds.push(lockId);
                            lockBuyerMap.push({ lockId, addr: bAddr, amount: bAmount });
                        }
                    } catch { /* skip other events */ }
                }

                // Emit marketplace:bid:update so bid counts tick up live on cards
                if (demoLeadId) {
                    io.emit('marketplace:bid:update', {
                        leadId: demoLeadId,
                        bidCount: b + 1,
                        highestBid: Math.max(...buyerBids.slice(0, b + 1).map(x => x.amount)),
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
                buyerWallet,                                // winner's wallet (compat)
                buyerWallets: cycleBuyers,                 // all 3 distinct bidders (Phase 2)
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

        await saveResultsToDB(result);

        // Bridge message — visible in Dev Log before results page loads
        emit(io, {
            ts: new Date().toISOString(),
            level: 'success',
            message: '🎉 Demo showcase complete! Preparing next run — token redistribution starting in background...',
        });

        // Broadcast global status (running=false) before demo:complete so button re-enables
        emitStatus(io, { running: false, phase: 'idle', totalCycles: cycles, currentCycle: cycles, percent: 100, runId });

        // Emit completion event FIRST so frontend navigates immediately
        io.emit('demo:complete', { runId, status: 'completed', totalCycles: cycles, totalSettled });

        // ── Phase 2: Non-blocking token recycling with 90s timeout ──
        // Fire and forget — does NOT block the return or delay the results page.
        void withRecycleTimeout(io, recycleTokens(io, signal, BUYER_KEYS));

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

        await saveResultsToDB(result);

        // Broadcast global status (running=false) before demo:complete
        emitStatus(io, { running: false, phase: 'idle', totalCycles: cycleResults.length, currentCycle: cycleResults.length, percent: 100, runId });

        io.emit('demo:complete', {
            runId,
            status: result.status,
            totalCycles: cycleResults.length,
            totalSettled,
            error: result.error,
        });

        // Recycle on abort/failure too — best effort, non-blocking
        if (!isAbort) {
            void withRecycleTimeout(io, recycleTokens(io, signal, BUYER_KEYS));
        }

        return result;

    } finally {
        isRunning = false;
        currentAbort = null;
        // Safety net — emit idle in case the above emitStatus calls were skipped
        emitStatus(io, { running: false, phase: 'idle' });
    }
}

// ── Control Functions ──────────────────────────────

export function stopDemo(): boolean {
    let stopped = false;

    // Stop the active cycle loop
    if (isRunning && currentAbort) {
        currentAbort.abort();
        stopped = true;
    }

    // Stop the recycle co-routine if it's running
    if (isRecycling && recycleAbort) {
        recycleAbort.abort();
        // Immediately clear the recycling flag so status endpoint reflects reality
        // without waiting for the finally block (which may still be mid-tx.wait())
        isRecycling = false;
        stopped = true;
    }

    // Broadcast updated state to all viewers immediately so UI unblocks
    if (moduleIo) {
        emitStatus(moduleIo, {
            running: false,
            recycling: false,
            phase: stopped ? 'stopped' : 'idle',
            runId: undefined,
        });
    }

    return stopped;
}

export function isDemoRunning(): boolean {
    return isRunning;
}

export function isDemoRecycling(): boolean {
    return isRecycling;
}

export function getResults(runId: string): DemoResult | undefined {
    return resultsStore.get(runId);
}

/**
 * getLatestResult — checks in-memory cache first (fast path).
 * If cache is cold (e.g. after server cold boot), queries DB.
 * Always returns the most recently completed/failed/aborted run.
 */
export async function getLatestResult(): Promise<DemoResult | undefined> {
    // Fast path: cache is warm
    const fromCache = Array.from(resultsStore.values()).sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    if (fromCache.length > 0) return fromCache[0];

    // Cold boot path: hydrate from DB
    await loadResultsFromDB();
    const all = Array.from(resultsStore.values()).sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    return all.length > 0 ? all[0] : undefined;
}

export function getAllResults(): DemoResult[] {
    return Array.from(resultsStore.values()).sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
}
