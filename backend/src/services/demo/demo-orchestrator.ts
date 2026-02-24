/**
 * demo-orchestrator.ts — Main demo flow orchestration
 *
 * Handles:
 *   - Singleton state (isRunning, currentAbort, resultsStore)
 *   - saveResultsToDB / loadResultsFromDB / initResultsStore
 *   - checkDeployerUSDCReserve (P0 guard)
 *   - cleanupLockedFundsForDemoBuyers (P1/P4 pre-run cleanup)
 *   - runFullDemo: main N-cycle on-chain demo entry point
 *   - stopDemo / isDemoRunning / isDemoRecycling
 *   - getResults / getLatestResult / getAllResults
 */

import { Server as SocketServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import { prisma } from '../../lib/prisma';
import { redisClient } from '../../lib/redis';
import { computeCREQualityScore, type LeadScoringInput } from '../../lib/chainlink/cre-quality-score';
import { checkVrfSubscriptionBalance } from '../vrf.service';
import {
    DEMO_SELLER_WALLET,
    DEMO_BUYER_WALLETS,
    DEMO_BUYER_KEYS,
    DEMO_VERTICALS,
    GEOS,
    USDC_ADDRESS,
    USDC_ABI,
    VAULT_ADDRESS,
    VAULT_ABI,
    BASE_SEPOLIA_CHAIN_ID,
    DEMO_DEPLOYER_USDC_MIN_REQUIRED,
    LEAD_AUCTION_DURATION_SECS,
    DEMO_MIN_ACTIVE_LEADS,
    type DemoLogEntry,
    type CycleResult,
    type DemoResult,
    emit,
    safeEmit,
    emitStatus,
    getProvider,
    getSigner,
    getVault,
    getUSDC,
    getNextNonce,
    sendTx,
    sendWithGasEscalation,
    sleep,
    rand,
    pick,
} from './demo-shared';
import {
    buildDemoParams,
    ensureDemoSeller,
    injectOneLead,
    checkActiveLeadsAndTopUp,
    startLeadDrip,
} from './demo-lead-drip';
import {
    DEMO_INITIAL_LEADS,
    DEMO_LEAD_DRIP_INTERVAL_MS,
} from '../../config/perks.env';
import {
    clearAllBidTimers,
    emitLiveMetrics,
    sweepBuyerUSDC,
    setDemoRunStartTime,
} from './demo-buyer-scheduler';
import {
    pendingLockIds,
    abortCleanup,
    recycleTokens,
    withRecycleTimeout,
    setModuleIo,
    getModuleIo,
    getIsRecycling,
    setIsRecycling,
    getRecycleAbort,
    setRecycleAbort as _setRecycleAbort,
} from './demo-vault-cycle';
import { nftService } from '../nft.service';
import { creService } from '../cre.service';
import { ensureKimiAgentRules, KIMI_AGENT_WALLET } from './demo-agent-rules';

// Re-export types for external consumers
export type { DemoLogEntry, CycleResult, DemoResult };

// ── Singleton State ────────────────────────────────
let isRunning = false;
let currentAbort: AbortController | null = null;

// ── Per-Lead Lock Registry ─────────────────────────
// Maps leadId → array of confirmed on-chain lockIds from scheduled buyer bids.
// The settlement monitor reads this at expiry to settle winner + refund losers.
// Manual "Place Bid" from the frontend also writes here via the bid API.
export const leadLockRegistry = new Map<string, { lockId: number; addr: string; amount: number }[]>();

/**
 * Schedule N automated buyer bids to fire at random times WITHIN the auction's
 * 60-second live window. Each bid:
 *   1. Calls vault.lockForBid(buyerAddr, amount) — real on-chain tx
 *   2. Parses the BidLocked event to get the lockId
 *   3. Pushes { lockId, addr, amount } into leadLockRegistry[leadId]
 *   4. Emits marketplace:bid:update so all clients see the live bid count
 *
 * The settlement monitor at expiry reads leadLockRegistry[leadId] and only
 * calls settleBid + refundBid — it never calls lockForBid itself.
 *
 * Manual frontend bidders also participate: their lockForBid (via bid API)
 * should call registerManualBid(leadId, lockId, addr, amount) to be included.
 */
export function scheduleBidsForLead(
    io: SocketServer,
    leadId: string,
    reservePrice: number,
    auctionEndMs: number,
    signal: AbortSignal,
): void {
    if (!VAULT_ADDRESS) return;

    const now = Date.now();
    const windowMs = auctionEndMs - now;
    if (windowMs < 10_000) return; // too close to expiry to schedule anything

    // Pick 3–5 buyers for this lead
    const vault = getVault(getSigner());
    const iface = new ethers.Interface(VAULT_ABI);


    const numBuyers = rand(3, 5);
    // Round-robin from a fresh random starting offset each lead
    const startOffset = Math.floor(Math.random() * DEMO_BUYER_WALLETS.length);
    const buyers = Array.from({ length: numBuyers }, (_, i) =>
        DEMO_BUYER_WALLETS[(startOffset + i) % DEMO_BUYER_WALLETS.length]
    );

    // Initialize registry for this lead (manual bids from UI can also push here)

    emit(io, {
        ts: new Date().toISOString(), level: 'info',
        message: `🎯 Scheduling ${numBuyers} bids for lead ${leadId.slice(0, 8)}… over ${Math.round(windowMs / 1000)}s window`,
    });

    buyers.forEach((buyerAddr, idx) => {
        const variance = Math.round(reservePrice * 0.20);
        const bidAmount = Math.max(10, reservePrice + (idx === 0 ? 0 : rand(-variance, variance)));
        const bidAmountUnits = ethers.parseUnits(String(bidAmount), 6);

        // Stagger: spread bids from 8s after drip to 15s before expiry
        const earliest = 8_000;
        const latest = Math.max(8_000, windowMs - 15_000);
        const delayMs = rand(earliest, latest);

        setTimeout(async () => {
            if (signal.aborted) return;

            // Re-check auction is still live
            const nowMs = Date.now();
            if (nowMs >= auctionEndMs) return;

            try {
                // Check vault balance
                const bVaultBal: bigint = await vault.balanceOf(buyerAddr).catch(() => 0n);
                const available = Number(bVaultBal) / 1e6;
                if (available < bidAmount) {
                    emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Scheduled bid skipped — buyer ${buyerAddr.slice(0, 10)}… vault $${available.toFixed(0)} < $${bidAmount}` });
                    return;
                }

                const nonce = await getNextNonce();
                const tx = await vault.lockForBid(buyerAddr, bidAmountUnits, { nonce });
                const receipt = await tx.wait();

                // Parse lockId from BidLocked event
                let lockId: number | null = null;
                for (const log of receipt.logs) {
                    try {
                        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
                        if (parsed?.name === 'BidLocked') {
                            lockId = Number(parsed.args[0]);
                        }
                    } catch { /* skip */ }
                }

                if (lockId == null) return;

                // Register this lock in Redis
                const lockEntry = JSON.stringify({ lockId, addr: buyerAddr, amount: bidAmount });
                const redisKey = `lead:lock:${leadId}`;
                let reg: any[] = [];

                if (redisClient) {
                    await redisClient.rpush(redisKey, lockEntry);
                    // TTL covers the auction window + 5 minutes buffer
                    await redisClient.expire(redisKey, 600);
                    const list = await redisClient.lrange(redisKey, 0, -1);
                    reg = list.map((item: any) => JSON.parse(item));
                } else {
                    // Fallback to in-memory if Redis is off
                    if (!leadLockRegistry.has(leadId)) leadLockRegistry.set(leadId, []);
                    reg = leadLockRegistry.get(leadId)!;
                    reg.push({ lockId, addr: buyerAddr, amount: bidAmount });
                }

                pendingLockIds.add(lockId); // BUG-04 orphan tracking

                const totalBids = reg.length;
                const highestBid = Math.max(...reg.map(r => r.amount));

                const isAgentBid = buyerAddr.toLowerCase() === KIMI_AGENT_WALLET.toLowerCase();
                const bidLabel = isAgentBid
                    ? `🤖 Kimi AI bid — ${buyerAddr.slice(0, 10)}… bid $${bidAmount} on ${leadId.slice(0, 8)}… (lock #${lockId}, bid ${totalBids}/${numBuyers}) tx: ${receipt.hash.slice(0, 22)}…`
                    : `✅ Live bid — ${buyerAddr.slice(0, 10)}… bid $${bidAmount} on ${leadId.slice(0, 8)}… (lock #${lockId}, bid ${totalBids}/${numBuyers}) tx: ${receipt.hash.slice(0, 22)}…`;
                emit(io, {
                    ts: new Date().toISOString(), level: 'success',
                    message: bidLabel,
                    txHash: receipt.hash,
                    basescanLink: `https://sepolia.basescan.org/tx/${receipt.hash}`,
                });

                // Emit live bid to all connected clients — card updates in real time
                io.emit('marketplace:bid:update', {
                    leadId,
                    bidCount: totalBids,
                    highestBid,
                    timestamp: new Date().toISOString(),
                    buyerName: `Buyer ${idx + 1}`,
                });

                const remainingMs = Math.max(0, auctionEndMs - Date.now());
                io.emit('auction:updated', {
                    leadId,
                    remainingTime: remainingMs,
                    serverTs: Date.now(),
                    bidCount: totalBids,
                    highestBid,
                    isSealed: false,
                });

                if (remainingMs <= 10_000 && remainingMs > 0) {
                    io.emit('auction:closing-soon', { leadId, remainingTime: remainingMs });
                }

            } catch (err: any) {
                const msg = err?.shortMessage || err?.message?.slice(0, 80) || 'unknown';
                emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Scheduled bid failed for ${leadId.slice(0, 8)}…: ${msg}` });
            }
        }, delayMs);
    });
}

/** Register a manual bid (from Place Bid UI) into the lead's lock registry. */
export async function registerManualBid(leadId: string, lockId: number, addr: string, amount: number): Promise<void> { // CHANGED TO ASYNC
    const lockEntry = JSON.stringify({ lockId, addr, amount });
    const redisKey = `lead:lock:${leadId}`;

    if (redisClient) {
        const existing = await redisClient.lrange(redisKey, 0, -1);
        const alreadyRegistered = existing.some((item: any) => JSON.parse(item).lockId === lockId);
        if (!alreadyRegistered) {
            await redisClient.rpush(redisKey, lockEntry);
            await redisClient.expire(redisKey, 600);
            pendingLockIds.add(lockId);
        }
    } else {
        const reg = leadLockRegistry.get(leadId) ?? [];
        if (reg.some(r => r.lockId === lockId)) return; // already registered
        reg.push({ lockId, addr, amount });
        leadLockRegistry.set(leadId, reg);
        pendingLockIds.add(lockId);
    }
}



// ── Results Store ──────────────────────────────────
const resultsStore = new Map<string, DemoResult>();

// ── Persistence Helpers (file-based) ──────────────

const RESULTS_FILE = path.join(process.cwd(), 'demo-results.json');

/** Persist a result to the in-memory cache and atomically to disk. */
function saveResultsToDisk(result: DemoResult): void {
    resultsStore.set(result.runId, result);
    try {
        const all = Array.from(resultsStore.values());
        fs.writeFileSync(RESULTS_FILE, JSON.stringify(all, null, 2), 'utf8');
    } catch (err: any) {
        console.warn('[DEMO] saveResultsToDisk failed (non-fatal):', err.message?.slice(0, 80));
    }
}

// Alias used in runFullDemo and catch blocks
const saveResultsToDB = async (result: DemoResult): Promise<void> => {
    saveResultsToDisk(result);
};

function loadResultsFromDisk(): void {
    try {
        if (fs.existsSync(RESULTS_FILE)) {
            const data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
            if (Array.isArray(data)) {
                for (const r of data) {
                    if (r?.runId) resultsStore.set(r.runId, r as DemoResult);
                }
            }
        }
    } catch { /* non-fatal */ }
}

/** Call once at startup to warm the in-memory cache from disk. */
export async function initResultsStore(): Promise<void> {
    loadResultsFromDisk();
}

// ── P0 Guard: Deployer USDC Reserve Check ──────────

async function checkDeployerUSDCReserve(io: SocketServer): Promise<void> {
    const requiredUnits = ethers.parseUnits(String(DEMO_DEPLOYER_USDC_MIN_REQUIRED), 6);

    try {
        const provider = getProvider();
        const signer = getSigner();
        const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
        const balance: bigint = await usdc.balanceOf(signer.address);
        const balanceUsd = Number(ethers.formatUnits(balance, 6));
        const shortfall = DEMO_DEPLOYER_USDC_MIN_REQUIRED - balanceUsd;

        if (balance < requiredUnits) {
            const msg =
                `🚫 Deployer USDC reserve too low. ` +
                `Required: $${DEMO_DEPLOYER_USDC_MIN_REQUIRED.toFixed(2)} | Current: $${balanceUsd.toFixed(2)} (short by $${shortfall.toFixed(2)}).\n` +
                `   Tip: fund the deployer wallet ${signer.address} via testnet faucet or bridge.\n` +
                `   (Note: platform fees from each run help replenish the reserve automatically.)`;
            emit(io, { ts: new Date().toISOString(), level: 'error', message: msg });
            safeEmit(io, 'demo:status', {
                running: false,
                recycling: false,
                error: 'insufficient_deployer_funds',
                required: DEMO_DEPLOYER_USDC_MIN_REQUIRED,
                current: balanceUsd,
                shortfall,
                phase: 'idle',
                ts: new Date().toISOString(),
            });
            return;
        }

        emit(io, {
            ts: new Date().toISOString(),
            level: 'success',
            message: `✅ Deployer USDC reserve sufficient ($${balanceUsd.toFixed(2)} ≥ $${DEMO_DEPLOYER_USDC_MIN_REQUIRED}) — proceeding.`,
        });
        isRunning = true;
    } catch (err: any) {
        console.warn('[DEMO] USDC reserve check failed (non-fatal):', err.message?.slice(0, 80));
        isRunning = true;
    }
}

// ── Pre-Run Cleanup (P1 + P4) ──────────────────────

/**
 * cleanupLockedFundsForDemoBuyers — refunds stranded locked bids across all 10 buyer wallets.
 * Called automatically at the start of runFullDemo() and exposed for the /reset endpoint.
 */
export async function cleanupLockedFundsForDemoBuyers(io: SocketServer): Promise<void> {
    const provider = getProvider();
    const signer = getSigner();
    const deployerVault = getVault(signer);

    emit(io, {
        ts: new Date().toISOString(),
        level: 'step',
        message: '🔓 Pre-run cleanup: scanning for stranded locked funds across all buyer wallets...',
    });

    const CLEANUP_BUYER_WALLETS = [
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
    ];

    let totalRecovered = 0n;
    let totalWalletsFixed = 0;

    for (const buyerAddr of CLEANUP_BUYER_WALLETS) {
        try {
            const locked: bigint = await deployerVault.lockedBalances(buyerAddr);
            if (locked === 0n) continue;

            emit(io, {
                ts: new Date().toISOString(),
                level: 'warn',
                message: `🔓 Found $${ethers.formatUnits(locked, 6)} locked for ${buyerAddr.slice(0, 10)}… — scanning for refundable lockIds...`,
            });

            const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);
            const currentBlock = await provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 50_000);

            const filter = vault.filters.BidLocked(null, buyerAddr);
            const events = await vault.queryFilter(filter, fromBlock, currentBlock);

            let refundedCount = 0;
            for (const event of events) {
                const lockId: bigint = (event as any).args[0];

                try {
                    const nonce = await getNextNonce();
                    const tx = await sendWithGasEscalation(
                        signer,
                        {
                            to: VAULT_ADDRESS,
                            data: deployerVault.interface.encodeFunctionData('refundBid', [lockId]),
                            nonce,
                        },
                        `refundBid lockId ${lockId} buyer ${buyerAddr.slice(0, 10)}`,
                        (msg) => emit(io, { ts: new Date().toISOString(), level: 'info', message: msg }),
                    );
                    const receipt = await tx.wait();

                    const refundEvent = receipt?.logs
                        .map((log: any) => { try { return vault.interface.parseLog(log); } catch { return null; } })
                        .find((parsed: any) => parsed?.name === 'BidRefunded');
                    const refundedAmt: bigint = refundEvent?.args?.[2] ?? 0n;

                    emit(io, {
                        ts: new Date().toISOString(),
                        level: 'success',
                        message: `✅ Recovered $${ethers.formatUnits(refundedAmt, 6)} USDC from ${buyerAddr.slice(0, 10)}… via refundBid(${lockId})`,
                        txHash: receipt?.hash,
                    });
                    totalRecovered += refundedAmt;
                    refundedCount++;
                } catch (refundErr: any) {
                    const msg: string = refundErr.message ?? '';
                    if (!msg.includes('already') && !msg.includes('invalid')) {
                        emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ refundBid(${lockId}) for ${buyerAddr.slice(0, 10)}…: ${msg.slice(0, 70)}` });
                    }
                }

                await sleep(500);
            }

            if (refundedCount > 0) totalWalletsFixed++;

        } catch (err: any) {
            emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Locked-funds cleanup for ${buyerAddr.slice(0, 10)}…: ${err.message?.slice(0, 80)}` });
        }
    }

    emit(io, {
        ts: new Date().toISOString(),
        level: totalWalletsFixed > 0 ? 'success' : 'info',
        message: totalWalletsFixed > 0
            ? `✅ Pre-run cleanup done — recovered $${ethers.formatUnits(totalRecovered, 6)} from ${totalWalletsFixed} wallet(s). Starting fresh.`
            : '✅ Pre-run cleanup: no stranded locked funds found — all buyer wallets are clean.',
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
    if (getIsRecycling()) {
        emit(io, { ts: new Date().toISOString(), level: 'warn', message: '⏳ Demo is still recycling (~3 min on testnet) — please wait or click Full Reset & Recycle.' });
        safeEmit(io, 'demo:status', { running: false, recycling: true, error: 'recycling_in_progress', phase: 'recycling', ts: new Date().toISOString() });
        return {} as DemoResult;
    }

    cycles = Math.max(1, Math.min(cycles, 20)); // cap at 20 (MAX_CYCLES removed — natural settlement model)

    await checkDeployerUSDCReserve(io);
    if (!isRunning) return {} as DemoResult;

    // ── Kimi Agent: bootstrap auto-bid rules before drip starts ──────────────
    // Idempotent: upserts pref sets for all demo verticals so the auto-bid engine
    // immediately fires on behalf of the agent when leads appear.
    const agentProfileId = await ensureKimiAgentRules();
    emit(io, {
        ts: new Date().toISOString(),
        level: agentProfileId ? 'step' : 'warn',
        message: agentProfileId
            ? `🤖 Kimi AI agent active — wallet ${KIMI_AGENT_WALLET.slice(0, 10)}… | auto-bid rules live`
            : '⚠️  Kimi agent account not found — run seed-agent-buyer.ts to enable agent bidding',
    });

    const runId = uuidv4();
    const startedAt = new Date().toISOString();
    const cycleResults: CycleResult[] = [];
    let totalGas = 0n;
    let totalSettled = 0;
    let totalPlatformIncome = 0;
    let totalTiebreakers = 0;
    const vrfProofLinks: string[] = [];

    // Build wallet→key lookup from env-loaded DEMO_BUYER_KEYS (single source of truth).
    // This eliminates the former BUYER_KEYS copy-paste (third instance — BUG-BK from findings.md).
    const BUYER_KEYS: Record<string, string> = {};
    DEMO_BUYER_WALLETS.forEach((addr, idx) => {
        const k = DEMO_BUYER_KEYS[idx];
        if (k) BUYER_KEYS[addr] = k;
    });

    isRunning = true;
    currentAbort = new AbortController();
    const signal = currentAbort.signal;
    setModuleIo(io);

    emitStatus(io, { running: true, totalCycles: cycles, currentCycle: 0, percent: 0, phase: 'starting', runId });

    emit(io, { ts: new Date().toISOString(), level: 'success', message: '=== DEMO STARTED — Socket events are streaming ===' });
    emit(io, { ts: new Date().toISOString(), level: 'info', message: '🚀 Starting production-realistic demo (full 60 s auctions, continuous natural drip)' });

    // VRF Subscription Balance Warning Check
    try {
        await checkVrfSubscriptionBalance();
    } catch { /* non-fatal */ }

    try {
        await cleanupLockedFundsForDemoBuyers(io);
    } catch (cleanupErr: any) {
        emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Pre-run locked funds cleanup encountered an error (non-fatal): ${cleanupErr.message?.slice(0, 80)}` });
    }

    let replenishInterval: ReturnType<typeof setInterval> | null = null;
    let sweepInterval: ReturnType<typeof setInterval> | null = null;
    let metricsInterval: ReturnType<typeof setInterval> | null = null;
    let activeLeadInterval: ReturnType<typeof setInterval> | null = null;
    let leadDrip: { stop: () => void; promise: Promise<void> } | null = null;

    setDemoRunStartTime(Date.now());

    let vault: ethers.Contract = null!;

    try {
        const provider = getProvider();
        const network = await provider.getNetwork();
        if (Number(network.chainId) !== BASE_SEPOLIA_CHAIN_ID) {
            throw new Error(`Wrong network! Expected Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}), got ${network.chainId}`);
        }

        const signer = getSigner();
        vault = getVault(signer);
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

        // ── Startup: Ensure deployer is authorizedMinter on LeadNFTv2 ──────────
        // If not authorized, the BuyItNow fallback mintLead tx will revert.
        // Self-heal: call setAuthorizedMinter(deployer, true) before any cycle.
        {
            const LEAD_NFT_ADDR = process.env.LEAD_NFT_CONTRACT_ADDRESS_BASE_SEPOLIA
                || process.env.LEAD_NFT_CONTRACT_ADDRESS
                || '';
            if (LEAD_NFT_ADDR) {
                try {
                    const nftCheck = new ethers.Contract(LEAD_NFT_ADDR, [
                        'function authorizedMinters(address) view returns (bool)',
                        'function setAuthorizedMinter(address,bool) external',
                    ], signer);
                    const isMinter = await nftCheck.authorizedMinters(signer.address);
                    console.log(`[NFT MINT] Pre-flight — Is Authorized Minter: ${isMinter} (deployer=${signer.address.slice(0, 10)}…)`);
                    emit(io, {
                        ts: new Date().toISOString(), level: isMinter ? 'success' : 'warn',
                        message: `[NFT MINT] Authorized Minter check: ${isMinter ? '✅ true' : '⚠️ false — self-healing…'}`,
                    });
                    if (!isMinter) {
                        const authTx = await nftCheck.setAuthorizedMinter(signer.address, true, { gasLimit: 100_000 });
                        await authTx.wait(1);
                        const isMinterAfter = await nftCheck.authorizedMinters(signer.address);
                        console.log(`[NFT MINT] setAuthorizedMinter tx: ${authTx.hash} — Is Authorized Minter now: ${isMinterAfter}`);
                        emit(io, {
                            ts: new Date().toISOString(), level: isMinterAfter ? 'success' : 'error',
                            message: `[NFT MINT] setAuthorizedMinter complete — Is Authorized Minter: ${isMinterAfter ? '✅ true' : '❌ still false'}`,
                        });
                    }
                } catch (nftCheckErr: any) {
                    console.warn(`[NFT MINT] authorizedMinter pre-flight failed (non-fatal): ${nftCheckErr.message?.slice(0, 80)}`);
                }
            } else {
                console.warn('[NFT MINT] LEAD_NFT_CONTRACT_ADDRESS not set — skipping authorizedMinter check');
            }
        }

        if (signal.aborted) throw new Error('Demo aborted');

        const deployerBal = await vault.balanceOf(signer.address);
        const deployerUsdc = Number(deployerBal) / 1e6;
        const ethBal = await provider.getBalance(signer.address);

        // Pre-flight ETH balance summary
        {
            const allWallets = [
                { wallet: 'Deployer', addr: signer.address },
                { wallet: 'Wallet 1  (buyer)', addr: '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9' },
                { wallet: 'Wallet 2  (buyer)', addr: '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC' },
                { wallet: 'Wallet 3  (buyer)', addr: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58' },
                { wallet: 'Wallet 4  (buyer)', addr: '0x424CaC929939377f221348af52d4cb1247fE4379' },
                { wallet: 'Wallet 5  (buyer)', addr: '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d' },
                { wallet: 'Wallet 6  (buyer)', addr: '0x089B6Bdb4824628c5535acF60aBF80683452e862' },
                { wallet: 'Wallet 7  (buyer)', addr: '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE' },
                { wallet: 'Wallet 8  (buyer)', addr: '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C' },
                { wallet: 'Wallet 9  (buyer)', addr: '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf' },
                { wallet: 'Wallet 10 (buyer)', addr: '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad' },
                { wallet: 'Wallet 11 (seller)', addr: DEMO_SELLER_WALLET },
            ];
            const ethTable: Record<string, string> = {};
            for (const { wallet, addr } of allWallets) {
                const bal = await provider.getBalance(addr);
                const lowFlag = bal < ethers.parseEther('0.005') ? ' ⚠️LOW' : '';
                ethTable[wallet] = ethers.formatEther(bal) + ' ETH' + lowFlag;
            }
            console.log('[DEMO] Pre-flight ETH balances:');
            console.table(ethTable);
        }

        emit(io, {
            ts: new Date().toISOString(),
            level: 'info',
            message: `📊 Deployer vault balance: $${deployerUsdc.toFixed(2)} USDC | ${ethers.formatEther(ethBal)} ETH`,
            data: { vaultBalance: deployerUsdc, ethBalance: ethers.formatEther(ethBal) },
        });


        // Step 1: Pre-fund ALL buyer vaults to $200 (10 buyers × $200 = $2,000 — within deployer limit)
        const PRE_FUND_TARGET = 200;
        const PRE_FUND_THRESHOLD = 160;
        const preFundUnits = ethers.parseUnits(String(PRE_FUND_TARGET), 6);

        emit(io, {
            ts: new Date().toISOString(), level: 'step',
            message: `💰 Pre-funding ${DEMO_BUYER_WALLETS.length} buyer vaults to $${PRE_FUND_TARGET} each — natural auction flow starts after drip…`,
        });

        let preFundedCount = 0;
        for (const buyerAddr of DEMO_BUYER_WALLETS) {
            if (signal.aborted) throw new Error('Demo aborted');

            let funded = false;
            for (let attempt = 1; attempt <= 2 && !funded; attempt++) {
                try {
                    const buyerEth = await provider.getBalance(buyerAddr);
                    if (buyerEth === 0n) {
                        emit(io, { ts: new Date().toISOString(), level: 'info', message: `⛽ ETH top-up → ${buyerAddr.slice(0, 10)}…` });
                        const nonce = await getNextNonce();
                        const gasTx = await sendWithGasEscalation(
                            signer, { to: buyerAddr, value: ethers.parseEther('0.001'), nonce },
                            `eth gas ${buyerAddr.slice(0, 10)}`,
                            (msg) => emit(io, { ts: new Date().toISOString(), level: 'info', message: msg }),
                        );
                        await gasTx.wait();
                    }

                    // vault.balanceOf() returns balances[user] = FREE (unlocked) balance only.
                    // lockedBalances is a separate mapping — never subtract it from balanceOf.
                    const vaultBal = await vault.balanceOf(buyerAddr);
                    const availableUsd = Number(vaultBal) / 1e6;

                    if (availableUsd >= PRE_FUND_THRESHOLD) {
                        emit(io, { ts: new Date().toISOString(), level: 'info', message: `✅ ${buyerAddr.slice(0, 10)}… vault $${availableUsd.toFixed(0)} — no top-up needed` });
                        funded = true;
                        break;
                    }

                    const topUp = preFundUnits > vaultBal ? preFundUnits - vaultBal : 0n;
                    if (topUp === 0n) { funded = true; break; }

                    const bKey = BUYER_KEYS[buyerAddr];
                    if (!bKey) break;
                    const bSigner = new ethers.Wallet(bKey, provider);
                    const bUsdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, bSigner);
                    const bVault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, bSigner);

                    const deployerUsdcBal = await usdc.balanceOf(await signer.getAddress());
                    if (deployerUsdcBal < topUp) {
                        emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Deployer only has $${Number(deployerUsdcBal) / 1e6} USDC — skipping ${buyerAddr.slice(0, 10)}… (need $${Number(topUp) / 1e6})` });
                        break;
                    }
                    const tNonce = await getNextNonce();
                    const tTx = await sendWithGasEscalation(
                        signer,
                        { to: USDC_ADDRESS, data: usdc.interface.encodeFunctionData('transfer', [buyerAddr, topUp]), nonce: tNonce },
                        `prefund USDC ${buyerAddr.slice(0, 10)}`,
                        (msg) => emit(io, { ts: new Date().toISOString(), level: 'info', message: msg }),
                    );
                    await tTx.wait();

                    // FIX: Always approve MaxUint256 regardless of current allowance/topUp
                    // to prevent "ERC20: transfer amount exceeds allowance" on deposit().
                    const MAX_UINT = ethers.MaxUint256;
                    const bNonce0 = await provider.getTransactionCount(buyerAddr, 'pending');
                    try {
                        const aTx = await bUsdc.approve(VAULT_ADDRESS, MAX_UINT, { nonce: bNonce0 });
                        await aTx.wait();
                        console.log(`[DEMO-PREFUND] approve(MaxUint256) OK for ${buyerAddr.slice(0, 10)}…`);
                    } catch (aErr: any) {
                        console.error(`[DEMO-REVERT] approve failed for ${buyerAddr.slice(0, 10)}… | raw="${(aErr.shortMessage ?? aErr.message ?? '').slice(0, 120)}"`);
                        emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ approve failed for ${buyerAddr.slice(0, 10)}…: ${(aErr.shortMessage ?? aErr.message ?? '').slice(0, 80)} — deposit may fail` });
                    }

                    // Re-fetch nonce after approve confirms — prevents stale nonce race on congested testnet.
                    const bNonce1 = await provider.getTransactionCount(buyerAddr, 'pending');
                    try {
                        const dTx = await bVault.deposit(topUp, { nonce: bNonce1 });
                        await dTx.wait();
                    } catch (dErr: any) {
                        console.error(`[DEMO-REVERT] deposit failed for ${buyerAddr.slice(0, 10)}… | raw="${(dErr.shortMessage ?? dErr.message ?? '').slice(0, 120)}"`);
                        throw dErr; // rethrow so the outer attempt loop can retry
                    }

                    funded = true;
                    emit(io, {
                        ts: new Date().toISOString(), level: 'success',
                        message: `✅ ${buyerAddr.slice(0, 10)}… pre-funded +$${ethers.formatUnits(topUp, 6)} → vault $${PRE_FUND_TARGET}`,
                    });
                } catch (err: any) {
                    if (err.message === 'Demo aborted') throw err;
                    if (attempt < 2) {
                        emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Pre-fund attempt ${attempt}/2 for ${buyerAddr.slice(0, 10)}… failed: ${err.message?.slice(0, 60)} — retrying…` });
                        await new Promise(r => setTimeout(r, 2000));
                    } else {
                        emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Pre-fund failed for ${buyerAddr.slice(0, 10)}… after 2 attempts: ${err.message?.slice(0, 60)}` });
                    }
                }
            }
            if (funded) preFundedCount++;
        }

        emit(io, {
            ts: new Date().toISOString(),
            level: preFundedCount > 0 ? 'success' : 'warn',
            message: `${preFundedCount > 0 ? '🚀' : '⚠️'} ${preFundedCount}/${DEMO_BUYER_WALLETS.length} buyers pre-funded to $${PRE_FUND_TARGET} — natural auction flow starting!`,
        });

        // Replenishment watchdog — runs every 15s independently of the drip loop.
        // emits `leads:updated` so all tabs re-poll the API, and logs the gap.
        // Active injection is performed by checkActiveLeadsAndTopUp inside startLeadDrip.
        replenishInterval = setInterval(async () => {
            try {
                const activeCount = await prisma.lead.count({ where: { source: 'DEMO', status: 'IN_AUCTION' } });
                if (activeCount < DEMO_MIN_ACTIVE_LEADS) {
                    emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Active leads: ${activeCount} (target ≥${DEMO_MIN_ACTIVE_LEADS}) — drip will replenish shortly` });
                    io.emit('leads:updated', { activeCount, source: 'watchdog' });
                }
            } catch { /* non-fatal */ }
        }, 15_000);

        sweepInterval = setInterval(() => { void sweepBuyerUSDC(io); }, 10 * 60_000);
        metricsInterval = setInterval(() => { void emitLiveMetrics(io, runId); }, 5_000); // R-02: 5s cadence for live metrics

        // Mid-demo vault top-up: every 75s, replenish any buyer below $80 to $200
        // Keeps bidding active throughout the full 5-min demo window.
        const TOPUP_LOW = 80;   // $ threshold to trigger replenishment
        const TOPUP_TO = 200;  // $ target after replenishment
        const vaultTopupInterval = setInterval(async () => {
            // Deployer balance warning — alert if running low
            try {
                const deployerUsdc2 = Number(await usdc.balanceOf(signer.address)) / 1e6;
                if (deployerUsdc2 < 500) {
                    emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Deployer USDC low: $${deployerUsdc2.toFixed(2)} — top-ups may fail soon` });
                }
            } catch { /* non-fatal */ }

            for (const buyerAddr of DEMO_BUYER_WALLETS) {
                try {
                    const bKey = BUYER_KEYS[buyerAddr];
                    if (!bKey) continue;
                    // vault.balanceOf() = free balance; lockedBalances is separate — do not subtract.
                    const vaultBal = await vault.balanceOf(buyerAddr);
                    const free = Number(vaultBal) / 1e6;
                    if (free >= TOPUP_LOW) continue;
                    const topUpAmt = Math.round((TOPUP_TO - free) * 1e6);
                    if (topUpAmt <= 0) continue;
                    const topUpUnits = BigInt(topUpAmt);
                    const deployerBal2 = await usdc.balanceOf(signer.address);
                    if (deployerBal2 < topUpUnits) continue; // deployer dry
                    const nonce = await getNextNonce();
                    const tTx = await sendWithGasEscalation(
                        signer,
                        { to: USDC_ADDRESS, data: usdc.interface.encodeFunctionData('transfer', [buyerAddr, topUpUnits]), nonce },
                        `topup USDC ${buyerAddr.slice(0, 10)}`,
                        (msg) => emit(io, { ts: new Date().toISOString(), level: 'info', message: msg }),
                    );
                    await tTx.wait();
                    const bSigner = new ethers.Wallet(bKey, provider);
                    const bUsdc2 = new ethers.Contract(USDC_ADDRESS, USDC_ABI, bSigner);
                    const bVault2 = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, bSigner);
                    const bNonce0 = await provider.getTransactionCount(buyerAddr, 'pending');
                    await (await bUsdc2.approve(VAULT_ADDRESS, ethers.MaxUint256, { nonce: bNonce0 })).wait();
                    // Re-fetch nonce after approve confirms — prevents stale nonce race.
                    const bNonce1mid = await provider.getTransactionCount(buyerAddr, 'pending');
                    await (await bVault2.deposit(topUpUnits, { nonce: bNonce1mid })).wait();
                    emit(io, { ts: new Date().toISOString(), level: 'info', message: `💧 Mid-demo top-up: ${buyerAddr.slice(0, 10)}… +$${(topUpAmt / 1e6).toFixed(0)} → vault ≥$${TOPUP_TO}` });
                } catch { /* non-fatal — best-effort */ }
            }
        }, 75_000);

        // Stranded-lock recycle: every 20s, check all buyer wallets for stale locks.
        // If a buyer has locked funds but no active IN_AUCTION leads, the lock is stranded
        // and should be freed to keep bidding healthy between top-up cycles.
        const strandedLockInterval = setInterval(async () => {
            try {
                const hasActiveLead = await prisma.lead.count({
                    where: { source: 'DEMO', status: 'IN_AUCTION' },
                }) > 0;
                if (hasActiveLead) return; // locks may still be needed — skip
                for (const buyerAddr of DEMO_BUYER_WALLETS) {
                    try {
                        const locked = await vault.lockedBalances(buyerAddr);
                        if (locked <= 0n) continue;
                        const nonce = await getNextNonce();
                        await vault.unlockBid(buyerAddr, locked, { nonce });
                        emit(io, { ts: new Date().toISOString(), level: 'info', message: `🔓 Stranded lock recycled: ${buyerAddr.slice(0, 10)}… +$${(Number(locked) / 1e6).toFixed(2)} freed` });
                    } catch { /* non-fatal per-buyer */ }
                }
            } catch { /* non-fatal outer */ }
        }, 20_000);


        // Step 2: Start continuous lead drip (runs in background, parallel to vault cycles)
        // Marketplace starts completely empty — leads appear naturally one-by-one.
        if (signal.aborted) throw new Error('Demo aborted');
        const maxDripLeads = 15; // hard cap: 15 total leads in a 5-min demo at 20s avg drip
        emit(io, { ts: new Date().toISOString(), level: 'step', message: `🌱 Starting marketplace drip — 1 lead every ~${Math.round(DEMO_LEAD_DRIP_INTERVAL_MS / 1000)}s (max ${maxDripLeads} total)…` });
        leadDrip = startLeadDrip(io, signal, maxDripLeads, 30, (leadId, reservePrice, auctionEndMs) => {
            // Each new lead gets automated buyer bids scheduled during its live window.
            // scheduleBidsForLead fires real lockForBid txs at random offsets within 60s,
            // pushing lockIds into leadLockRegistry so the settlement monitor can settle.
            scheduleBidsForLead(io, leadId, reservePrice, auctionEndMs, signal);
        });


        // Active-lead observability — emits live count to DevLog every 10s
        activeLeadInterval = setInterval(async () => {
            try {
                const n = await prisma.lead.count({ where: { source: 'DEMO', status: 'IN_AUCTION' } });
                emit(io, { ts: new Date().toISOString(), level: 'info', message: `📊 Active leads: ${n}/${DEMO_MIN_ACTIVE_LEADS} target` });
            } catch { /* non-fatal */ }
        }, 10_000);

        // Wait up to 30 s for at least 1 live lead before settlement monitor starts.
        // No initial burst — drip produces the first lead within 5–15 s.
        {
            const WAIT_LEADS = 1;
            const WAIT_DEADLINE = Date.now() + 30_000;
            let liveCount = 0;
            while (Date.now() < WAIT_DEADLINE && !signal.aborted) {
                liveCount = await prisma.lead.count({
                    where: { source: 'DEMO', status: 'IN_AUCTION', auctionEndAt: { gt: new Date() } },
                }).catch(() => 0);
                if (liveCount >= WAIT_LEADS) break;
                emit(io, { ts: new Date().toISOString(), level: 'info', message: `⏳ Waiting for leads… ${liveCount}/${WAIT_LEADS} live (drip in progress)` });
                await sleep(2000);
            }
            emit(io, { ts: new Date().toISOString(), level: 'step', message: `✅ ${liveCount} live leads ready — natural settlement monitor starting` });
        }

        // ── Natural Auction Settlement Monitor ──────────────────────────────────────
        // Replaces fixed cycle count: runs for DEMO_DURATION_MS and settles each
        // auction as it naturally expires, giving a continuous, fluid demo flow.
        const DEMO_DURATION_MS = 5 * 60 * 1000; // 5 minutes
        const DEMO_END_TIME = Date.now() + DEMO_DURATION_MS;
        const processedLeadIds = new Set<string>();
        const buyerRoundRobinOffset = 0;
        let settlementCycle = 0;

        emit(io, { ts: new Date().toISOString(), level: 'step', message: `🏁 Natural settlement monitor started — auctions settle as they expire over ${DEMO_DURATION_MS / 60000} min` });
        emitStatus(io, { running: true, phase: 'on-chain', runId, percent: 0 });

        while (!signal.aborted && Date.now() < DEMO_END_TIME) {
            // Poll every 5 s for an auction that has expired but not yet been settled
            await sleep(5000);
            if (signal.aborted) break;

            const nextLead = await prisma.lead.findFirst({
                where: {
                    source: 'DEMO',
                    status: 'IN_AUCTION',
                    auctionEndAt: { lte: new Date() },        // expired
                    id: { notIn: Array.from(processedLeadIds) },
                },
                orderBy: { auctionEndAt: 'asc' },
            }).catch(() => null);

            if (!nextLead) continue; // no expired lead yet — keep polling

            settlementCycle++;
            processedLeadIds.add(nextLead.id);
            const vertical = nextLead.vertical;
            const baseBid = nextLead.reservePrice;
            const demoLeadId = nextLead.id;

            // ── Read bids from the pre-populated registry ──────────────────────
            // scheduleBidsForLead() fired lockForBid during the live window and pushed
            // each confirmed lock into redis list. Manual UI bids are also here
            // via registerManualBid(). We just settle and refund — no new locks needed.
            let registryBids: { lockId: number, addr: string, amount: number }[] = [];

            if (redisClient) {
                const redisKey = `lead:lock:${demoLeadId}`;
                const rawBids = await redisClient.lrange(redisKey, 0, -1);
                registryBids = rawBids.map((item: any) => JSON.parse(item));
                await redisClient.del(redisKey); // clean up after reading
            } else {
                registryBids = leadLockRegistry.get(demoLeadId) ?? [];
                leadLockRegistry.delete(demoLeadId);
            }

            // Determine winner — highest amount wins; ties broken by first-lock-wins
            // (consistent with VRF tie-break which already ran during lockForBid)
            const sortedBids = [...registryBids].sort((a, b) => b.amount - a.amount);
            const winnerEntry = sortedBids[0];
            const loserEntries = sortedBids.slice(1);

            const buyerWallet = winnerEntry?.addr ?? DEMO_BUYER_WALLETS[0];
            const bidAmount = winnerEntry?.amount ?? Number(baseBid ?? 35);
            const lockIds: number[] = registryBids.map(r => r.lockId);
            const readyBuyers = registryBids.length;

            // Detect tiebreaker (two bids at the same max amount)
            const hadTiebreaker = sortedBids.length >= 2 && sortedBids[0].amount === sortedBids[1].amount;
            if (hadTiebreaker) {
                emit(io, { ts: new Date().toISOString(), level: 'info', message: `⚡ Tie detected — ${sortedBids[0].addr.slice(0, 10)}… and ${sortedBids[1].addr.slice(0, 10)}… both bid $${sortedBids[0].amount} — winner: first lock wins`, cycle: settlementCycle, totalCycles: 0 });
            }

            emit(io, {
                ts: new Date().toISOString(), level: 'step',
                message: `\n${'─'.repeat(56)}\n🔄 Settlement #${settlementCycle} — ${vertical.toUpperCase()} | ${readyBuyers} pre-placed bid(s) | winner: $${bidAmount}${registryBids.length > 0 ? ` from ${buyerWallet.slice(0, 10)}…` : ' (no bids — BuyItNow fallback)'}\n${'─'.repeat(56)}`,
                cycle: settlementCycle, totalCycles: 0,
            });

            emitStatus(io, { running: true, currentCycle: settlementCycle, totalCycles: 0, percent: Math.round((Date.now() - (DEMO_END_TIME - DEMO_DURATION_MS)) / DEMO_DURATION_MS * 100), phase: 'on-chain', runId });

            // ── Settle / Refund (wrapped for BuyItNow fallback) ────────────────
            let cycleUsedBuyItNow = false;
            let cycleGas = 0n;
            let settleReceiptHash = '';
            const refundTxHashes: string[] = [];
            let cyclePlatformIncome = 0;
            let vrfTxHashForCycle: string | undefined;

            try {
                emit(io, { ts: new Date().toISOString(), level: 'info', message: `📋 Lock IDs: [${lockIds.join(', ')}]`, cycle: settlementCycle, totalCycles: 0, data: { lockIds } });

                // ── Zero-bid / no-winner guard ──
                if (registryBids.length === 0) {

                    emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ Settlement #${settlementCycle} — no successful locks (zero bids) → marking lead UNSOLD`, cycle: settlementCycle, totalCycles: 0 });
                    cyclePlatformIncome = 0;
                    if (demoLeadId) {
                        await prisma.lead.update({ where: { id: demoLeadId }, data: { status: 'UNSOLD' } }).catch(() => { /* non-fatal */ });
                        io.emit('auction:closed', { leadId: demoLeadId, status: 'UNSOLD', remainingTime: 0, isClosed: true, serverTs: Date.now() });
                        // Fix 4: emit leads:updated with final closed state so frontend
                        // never re-fetches a stale IN_AUCTION snapshot for this lead.
                        io.emit('leads:updated', { leadId: demoLeadId, status: 'UNSOLD', isClosed: true, source: 'auction-closed' });
                        console.log(`[AUCTION-CLOSED] leadId=${demoLeadId} status=UNSOLD (zero locks)`);
                    }
                    // Skip settle / VRF / refund — jump directly to cycleResults
                    throw Object.assign(new Error('__ZERO_BIDS__'), { isZeroBids: true });
                }

                // Settle winner
                if (signal.aborted) throw new Error('Demo aborted');

                const winnerLockId = lockIds[0];
                emit(io, { ts: new Date().toISOString(), level: 'step', message: `💰 Settling winner — lock #${winnerLockId} → seller ${DEMO_SELLER_WALLET.slice(0, 10)}…`, cycle: settlementCycle, totalCycles: 0 });

                const { receipt: settleReceipt, gasUsed: settleGas } = await sendTx(
                    io,
                    `Settle winner (lock #${winnerLockId} → seller)`,
                    () => vault.settleBid(winnerLockId, DEMO_SELLER_WALLET),
                    settlementCycle, 0,
                );
                cycleGas += settleGas;
                pendingLockIds.delete(winnerLockId); // BUG-04
                totalSettled += bidAmount;
                settleReceiptHash = settleReceipt.hash;

                // Winner-only fee model: 5% of winning bid + $1 convenience fee.
                // Losers get 100% refund — NO fee charged to losers.
                const cyclePlatformFee = parseFloat((bidAmount * 0.05).toFixed(2));
                cyclePlatformIncome = parseFloat((cyclePlatformFee + 1).toFixed(2));
                totalPlatformIncome = parseFloat((totalPlatformIncome + cyclePlatformIncome).toFixed(2));
                vrfTxHashForCycle = hadTiebreaker ? settleReceipt.hash : undefined;
                if (hadTiebreaker) { totalTiebreakers++; }
                if (vrfTxHashForCycle) { vrfProofLinks.push(`https://sepolia.basescan.org/tx/${vrfTxHashForCycle}`); }
                emit(io, { ts: new Date().toISOString(), level: 'success', message: `💰 Platform earned $${cyclePlatformIncome.toFixed(2)} this settlement (5% of $${bidAmount} = $${cyclePlatformFee.toFixed(2)} + $1 winner fee)`, cycle: settlementCycle, totalCycles: 0 });

                // Refund losers
                for (let r = 1; r < lockIds.length; r++) {
                    if (signal.aborted) throw new Error('Demo aborted');

                    emit(io, { ts: new Date().toISOString(), level: 'info', message: `🔓 Refunding loser — lock #${lockIds[r]}`, cycle: settlementCycle, totalCycles: 0 });

                    const { receipt: refundReceipt, gasUsed: refundGas } = await sendTx(
                        io,
                        `Refund loser (lock #${lockIds[r]})`,
                        () => vault.refundBid(lockIds[r]),
                        settlementCycle, 0,
                    );
                    cycleGas += refundGas;
                    pendingLockIds.delete(lockIds[r]); // BUG-04
                    refundTxHashes.push(refundReceipt.hash);

                    await sleep(300);
                }

                // AUCTION-SYNC (BUG-C fix): auction:closed emitted AFTER refund loop —
                // frontend receives final closed state only when all DB writes are complete.
                if (demoLeadId) {
                    io.emit('auction:closed', {
                        leadId: demoLeadId,
                        status: 'SOLD',
                        winnerId: buyerWallet,
                        winningAmount: bidAmount,
                        settleTxHash: settleReceiptHash,
                        remainingTime: 0,
                        isClosed: true,
                        serverTs: Date.now(),  // ms epoch
                    });
                    // Fix 4: emit leads:updated with final closed state so frontend
                    // never re-fetches a stale IN_AUCTION snapshot for this lead.
                    io.emit('leads:updated', { leadId: demoLeadId, status: 'SOLD', isClosed: true, source: 'auction-closed' });
                    console.log(`[AUCTION-CLOSED] leadId=${demoLeadId} winner=${buyerWallet} amount=${bidAmount} tx=${settleReceiptHash}`);
                }

            } catch (vaultErr: any) {
                if (signal.aborted) throw vaultErr; // propagate abort

                // Zero-bid path: UNSOLD already emitted in guard above — skip BuyItNow.
                if ((vaultErr as any).isZeroBids) {
                    cycleUsedBuyItNow = false; // treat as normal cycle for cycleResults shape
                    /* fall through to totalGas / cycleResults.push below */
                } else {


                    const vaultMsg = vaultErr?.reason || vaultErr?.shortMessage || vaultErr?.message || String(vaultErr);
                    console.error(`[DEMO-BUYNOW] settlement ${settlementCycle} — vault tx failed (${vaultMsg.slice(0, 120)}), switching to BuyItNow path`);
                    emit(io, {
                        ts: new Date().toISOString(), level: 'warn',
                        message: `⚡ [DEMO-BUYNOW] Vault tx failed (${vaultMsg.slice(0, 120)}) — switching to BuyItNow path for settlement ${settlementCycle}`,
                        cycle: settlementCycle, totalCycles: 0,
                    });

                    // BuyItNow path: mint NFT + CRE dispatch to guarantee [CRE-DISPATCH] fires
                    cycleUsedBuyItNow = true;
                    if (demoLeadId) {
                        try {
                            console.log(`[CRE-DISPATCH] settlement ${settlementCycle} BuyItNow — minting NFT for leadId=${demoLeadId}`);
                            emit(io, {
                                ts: new Date().toISOString(), level: 'info',
                                message: `[CRE-DISPATCH] BuyItNow mint — leadId=${demoLeadId} seller=${DEMO_SELLER_WALLET.slice(0, 10)}…`,
                                cycle: settlementCycle, totalCycles: 0,
                            });
                            const mintResult = await nftService.mintLeadNFT(demoLeadId);
                            if (mintResult?.tokenId) {
                                console.log(`[CRE-DISPATCH] BuyItNow mint successful — tokenId=${mintResult.tokenId} txHash=${mintResult.txHash ?? '—'}`);
                                emit(io, {
                                    ts: new Date().toISOString(), level: 'success',
                                    message: `[CRE-DISPATCH] BuyItNow mint ✅ — tokenId=${mintResult.tokenId} tx=${mintResult.txHash?.slice(0, 22) ?? '—'}`,
                                    cycle: settlementCycle, totalCycles: 0,
                                });
                                // Fire CRE score request
                                try {
                                    console.log(`[CRE-DISPATCH] settlement ${settlementCycle} BuyItNow — requestOnChainQualityScore leadId=${demoLeadId} tokenId=${mintResult.tokenId}`);
                                    const creResult = await creService.requestOnChainQualityScore(demoLeadId, Number(mintResult.tokenId));
                                    console.log(`[CRE-DISPATCH] BuyItNow CRE dispatch confirmed — requestId=${creResult ?? '—'}`);
                                    emit(io, {
                                        ts: new Date().toISOString(), level: 'success',
                                        message: `[CRE-DISPATCH] BuyItNow CRE ✅ — requestId=${String(creResult ?? '—').slice(0, 22)}`,
                                        cycle: settlementCycle, totalCycles: 0,
                                    });
                                } catch (creErr: any) {
                                    console.error(`[CRE-DISPATCH] BuyItNow CRE failed: ${creErr?.message?.slice(0, 100)}`);
                                    emit(io, { ts: new Date().toISOString(), level: 'warn', message: `[CRE-DISPATCH] BuyItNow CRE error: ${creErr?.message?.slice(0, 80)}`, cycle: settlementCycle, totalCycles: 0 });
                                }
                            } else {
                                console.error(`[CRE-DISPATCH] BuyItNow mint returned no tokenId — skipping CRE`);
                            }
                        } catch (mintErr: any) {
                            console.error(`[DEMO-REVERT] BuyItNow mint failed: ${mintErr?.message?.slice(0, 120)}`);
                            emit(io, { ts: new Date().toISOString(), level: 'warn', message: `[DEMO-REVERT] BuyItNow mint failed: ${mintErr?.message?.slice(0, 80)}`, cycle: settlementCycle, totalCycles: 0 });
                        }
                    } else {
                        emit(io, { ts: new Date().toISOString(), level: 'warn', message: `[DEMO-BUYNOW] No demoLeadId available for settlement ${settlementCycle} — CRE dispatch skipped`, cycle: settlementCycle, totalCycles: 0 });
                    }

                    // AUCTION-SYNC: closed broadcast for BuyItNow (unsold) path
                    if (demoLeadId) {
                        io.emit('auction:closed', {
                            leadId: demoLeadId,
                            status: 'UNSOLD',
                            remainingTime: 0,
                            isClosed: true,
                            serverTs: Date.now(),  // ms epoch
                        });
                        // Fix 4: emit leads:updated with final closed state so frontend
                        // never re-fetches a stale IN_AUCTION snapshot for this lead.
                        io.emit('leads:updated', { leadId: demoLeadId, status: 'UNSOLD', isClosed: true, source: 'auction-closed-buynow' });
                        console.log(`[AUCTION-CLOSED] leadId=${demoLeadId} status=UNSOLD (BuyItNow fallback)`);
                    }
                }

            } // end catch (vaultErr)

            // Accumulate results — runs after both success and caught-error paths
            totalGas += cycleGas;

            cycleResults.push({
                cycle: settlementCycle, vertical,
                buyerWallet, buyerWallets: registryBids.map(r => r.addr),
                bidAmount,
                lockIds: cycleUsedBuyItNow ? [] : lockIds,
                winnerLockId: cycleUsedBuyItNow ? 0 : (winnerEntry?.lockId ?? lockIds[0] ?? 0),
                settleTxHash: settleReceiptHash,
                refundTxHashes,
                porSolvent: true, porTxHash: '',
                gasUsed: cycleGas.toString(),
                platformIncome: cyclePlatformIncome,
                hadTiebreaker: cycleUsedBuyItNow ? false : hadTiebreaker,
                vrfTxHash: vrfTxHashForCycle,
            });

            await sleep(1000);
        } // end while (natural expiry monitor)

        // Batched verifyReserves
        emit(io, { ts: new Date().toISOString(), level: 'step', message: `🏦 Running batched Proof of Reserves check (1 tx for all ${settlementCycle} settlements)...` });
        clearInterval(vaultTopupInterval);

        let porSolventFinal = true;
        let porTxHashFinal = '';
        try {
            const { receipt: porReceipt, gasUsed: porGas } = await sendTx(io, 'verifyReserves() [batched]', () => vault.verifyReserves());
            totalGas += porGas;
            porTxHashFinal = porReceipt.hash;

            porSolventFinal = await vault.lastPorSolvent();
            const actual = await usdc.balanceOf(VAULT_ADDRESS);
            const obligations = await vault.totalObligations();
            const porStatus = porSolventFinal ? '✅ SOLVENT' : '❌ INSOLVENT';

            emit(io, {
                ts: new Date().toISOString(), level: porSolventFinal ? 'success' : 'error',
                message: `🏦 PoR Result: ${porStatus}\n   Contract USDC: $${(Number(actual) / 1e6).toFixed(2)}\n   Obligations:   $${(Number(obligations) / 1e6).toFixed(2)}\n   Margin:        $${((Number(actual) - Number(obligations)) / 1e6).toFixed(2)}`,
                txHash: porReceipt.hash,
                data: { solvent: porSolventFinal, contractBalance: (Number(actual) / 1e6).toFixed(2), obligations: (Number(obligations) / 1e6).toFixed(2), margin: ((Number(actual) - Number(obligations)) / 1e6).toFixed(2) },
            });

            for (const cr of cycleResults) {
                cr.porSolvent = porSolventFinal;
                cr.porTxHash = porTxHashFinal;
            }
        } catch (porErr: any) {
            emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ batched verifyReserves failed (non-fatal): ${porErr.message?.slice(0, 80)}` });
        }

        const elapsedSec = Math.round((Date.now() - new Date(startedAt).getTime()) / 1000);
        emit(io, {
            ts: new Date().toISOString(), level: 'success',
            message: `
╔══════════════════════════════════════════════════════════╗
║  ✅  DEMO COMPLETE                                      ║
║  Cycles:    ${String(cycles).padEnd(44)}║
║  Settled:   $${String(totalSettled).padEnd(43)}║
║  Revenue:   $${String(totalPlatformIncome.toFixed(2)).padEnd(43)}║
║  Tiebreaks: ${String(totalTiebreakers).padEnd(44)}║
║  Total Gas: ${totalGas.toString().padEnd(44)}║
║  Status:    All cycles SOLVENT                           ║
╚══════════════════════════════════════════════════════════╝`,
            data: { runId, cycles, totalSettled, totalGas: totalGas.toString() },
        });
        emit(io, { ts: new Date().toISOString(), level: 'success', message: `💰 Total platform revenue: $${totalPlatformIncome.toFixed(2)} | Tiebreakers triggered: ${totalTiebreakers} | VRF proofs: ${vrfProofLinks.length > 0 ? vrfProofLinks.join(', ') : 'none'}` });

        console.log(`[DEMO] Demo run completed in ${elapsedSec}s | Deployer ETH spent: 0 (fund-once active)`);

        // ── Demo CRE Dispatch Fallback ─────────────────────────────
        // Guarantee [CRE-DISPATCH] appears in every Render run by minting the NFT
        // for the first settled lead and dispatching requestOnChainQualityScore.
        // Non-blocking — errors are logged but do not affect the result object.
        if (cycleResults.length > 0) {
            void (async () => {
                try {
                    // Find a DB lead created during this demo run that hasn't been minted yet.
                    const demoLead = await prisma.lead.findFirst({
                        where: { nftTokenId: null, nftMintFailed: false },
                        orderBy: { createdAt: 'desc' },
                    });

                    if (demoLead) {
                        console.log(`[CRE-DISPATCH] demo fallback mint — leadId=${demoLead.id}`);
                        emit(io, { ts: new Date().toISOString(), level: 'step', message: `🔗 [CRE-DISPATCH] Minting Lead NFT for CRE dispatch fallback — leadId=${demoLead.id}` });

                        const mintResult = await nftService.mintLeadNFT(demoLead.id);
                        if (mintResult.success && mintResult.tokenId) {
                            console.log(`[CRE-DISPATCH] demo fallback mint ✅ tokenId=${mintResult.tokenId}`);
                            emit(io, { ts: new Date().toISOString(), level: 'success', message: `✅ [CRE-DISPATCH] NFT minted tokenId=${mintResult.tokenId} — dispatching CRE quality score…`, txHash: mintResult.txHash });

                            const creResult = await creService.requestOnChainQualityScore(demoLead.id, Number(mintResult.tokenId), demoLead.id);
                            if (creResult.submitted) {
                                console.log(`[CRE-DISPATCH] demo fallback CRE submitted — requestId=${creResult.requestId}`);
                                emit(io, { ts: new Date().toISOString(), level: 'success', message: `✅ [CRE-DISPATCH] Chainlink CRE quality score dispatched — requestId=${creResult.requestId}` });
                            } else {
                                console.warn(`[CRE-DISPATCH] demo fallback CRE skipped/failed: ${creResult.error}`);
                                emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ [CRE-DISPATCH] CRE skipped: ${creResult.error}` });
                            }
                        } else {
                            console.warn(`[CRE-DISPATCH] demo fallback mint failed: ${mintResult.error}`);
                            emit(io, { ts: new Date().toISOString(), level: 'warn', message: `⚠️ [CRE-DISPATCH] NFT mint failed (non-fatal): ${mintResult.error?.slice(0, 120)}` });
                        }
                    } else {
                        console.log('[CRE-DISPATCH] demo fallback: no un-minted lead found in DB — skipping');
                    }
                } catch (fbErr: any) {
                    console.error(`[CRE-DISPATCH] demo fallback error (non-fatal): ${fbErr.message}`);
                }
            })();
        }

        const result: DemoResult = {
            runId, startedAt, completedAt: new Date().toISOString(),
            cycles: cycleResults, totalGas: totalGas.toString(), totalSettled,
            status: 'completed', totalPlatformIncome, totalTiebreakers, vrfProofLinks,
        };

        await saveResultsToDB(result);

        emitStatus(io, { running: false, phase: 'idle', totalCycles: cycles, currentCycle: cycles, percent: 100, runId });

        try {
            safeEmit(io, 'demo:results-ready', { runId, status: 'completed', totalCycles: cycles, totalSettled, elapsedSec, cycles: cycleResults });
        } catch (emitErr: any) {
            console.error('[DEMO] demo:results-ready emit failed (non-fatal):', emitErr.message);
        }

        try {
            safeEmit(io, 'demo:complete', { runId, status: 'completed', totalCycles: cycles, totalSettled });
        } catch (emitErr: any) {
            console.error('[DEMO] demo:complete emit failed (non-fatal):', emitErr.message);
        }

        emit(io, { ts: new Date().toISOString(), level: 'success', message: `🎉 Demo run completed in ${elapsedSec}s | $${totalSettled} settled | Deployer ETH spent: 0 (fund-once active) — recycling wallets in background...` });

        void withRecycleTimeout(io, recycleTokens(io, signal, BUYER_KEYS));

        return result;

    } catch (err: any) {
        const isAbort = err.message === 'Demo aborted';

        emit(io, {
            ts: new Date().toISOString(), level: isAbort ? 'warn' : 'error',
            message: isAbort ? '⏹️ Demo aborted by user' : `❌ Demo failed: ${err.message?.slice(0, 200) || String(err)}`,
        });

        const result: DemoResult = {
            runId, startedAt, completedAt: new Date().toISOString(),
            cycles: cycleResults, totalGas: totalGas.toString(), totalSettled,
            status: isAbort ? 'aborted' : 'failed',
            error: isAbort ? undefined : err.message,
        };

        await saveResultsToDB(result);

        emitStatus(io, { running: false, phase: 'idle', totalCycles: cycleResults.length, currentCycle: cycleResults.length, percent: 100, runId });

        try {
            safeEmit(io, 'demo:results-ready', { runId, status: result.status, totalCycles: cycleResults.length, totalSettled, elapsedSec: Math.round((Date.now() - new Date(startedAt).getTime()) / 1000), cycles: cycleResults });
        } catch (emitErr: any) { console.error('[DEMO] demo:results-ready (error path) emit failed (non-fatal):', emitErr.message); }

        try {
            safeEmit(io, 'demo:complete', { runId, status: result.status, totalCycles: cycleResults.length, totalSettled, error: result.error });
        } catch (emitErr: any) { console.error('[DEMO] demo:complete (error path) emit failed (non-fatal):', emitErr.message); }

        if (isAbort) {
            if (vault) {
                void abortCleanup(io, vault).catch((e: Error) =>
                    console.warn('[DEMO] abortCleanup failed (non-fatal):', e.message)
                );
            } else {
                pendingLockIds.clear();
            }
        } else {
            void withRecycleTimeout(io, recycleTokens(io, signal, BUYER_KEYS));
        }

        return result;

    } finally {
        clearAllBidTimers();
        if (leadDrip) leadDrip.stop();

        if (replenishInterval) { clearInterval(replenishInterval); replenishInterval = null; }
        if (sweepInterval) { clearInterval(sweepInterval); sweepInterval = null; }
        if (metricsInterval) { clearInterval(metricsInterval); metricsInterval = null; }
        if (activeLeadInterval) { clearInterval(activeLeadInterval); activeLeadInterval = null; }

        setDemoRunStartTime(null);
        isRunning = false;
        currentAbort = null;
        emitStatus(io, { running: false, phase: 'idle' });
    }
}

// ── Control Functions ──────────────────────────────

export function stopDemo(): boolean {
    let stopped = false;

    if (isRunning && currentAbort) {
        currentAbort.abort();
        stopped = true;
    }

    if (getIsRecycling() && getRecycleAbort()) {
        getRecycleAbort()!.abort();
        setIsRecycling(false);
        stopped = true;
    }

    clearAllBidTimers();

    const storedIo = getModuleIo();
    if (storedIo) {
        emitStatus(storedIo, {
            running: false,
            recycling: false,
            phase: stopped ? 'stopped' : 'idle',
            runId: undefined,
        });
    }

    return stopped;
}

export function isDemoRunning(): boolean { return isRunning; }
export function isDemoRecycling(): boolean { return getIsRecycling(); }

export function getResults(runId: string): DemoResult | undefined {
    return resultsStore.get(runId);
}

export async function getLatestResult(): Promise<DemoResult | undefined> {
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
