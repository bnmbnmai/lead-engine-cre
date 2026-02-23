/**
 * demo-buyer-scheduler.ts — Autonomous buyer profiles and bid scheduling
 *
 * Handles:
 *   - BUYER_PROFILES: 10 distinct buyer personas with vertical preferences,
 *     score thresholds, bid ceilings, and timing behaviours
 *   - scheduleBuyerBids: assigns staggered setTimeout bids to newly-injected leads
 *   - activeBidTimers / clearAllBidTimers: registry for abort-safe cleanup
 *   - sweepBuyerUSDC: mid-run on-chain USDC reclaim from buyer wallets
 *   - emitLiveMetrics: 30-second pulse to DevLog with live auction health
 */

import { Server as SocketServer } from 'socket.io';
import { ethers } from 'ethers';
import { prisma } from '../../lib/prisma';
import {
    DEMO_BUYER_WALLETS,
    DEMO_BUYER_KEYS,
    USDC_ADDRESS,
    USDC_ABI,
    VAULT_ADDRESS,
    emit,
    getSigner,
    getVault,
    getSharedProvider,
    getNextNonce,
} from './demo-shared';
import { wireScheduleBuyerBids } from './demo-lead-drip';

// ── Buyer Profiles ─────────────────────────────────

export interface BuyerProfile {
    index: number;       // 0-based, maps to DEMO_BUYER_WALLETS[index]
    name: string;        // e.g. "MortgageMaven"
    tag: string;         // e.g. "mortgage-sniper"
    verticals: string[]; // preferred verticals; ['*'] = all
    minScore: number;    // minimum quality score (0–10 000) to bid
    maxPrice: number;    // maximum bid ceiling in USDC
    aggression: number;  // 0.0 (bid early) → 1.0 (bid late)
    timingBias: number;  // seconds into [10,55] window where this buyer tends to commit
}

export const BUYER_PROFILES: BuyerProfile[] = [
    { index: 0, name: 'MortgageMaven', tag: 'mortgage-sniper', verticals: ['mortgage', 'real_estate'], minScore: 6000, maxPrice: 90, aggression: 0.80, timingBias: 48 },
    { index: 1, name: 'SolarSpecialist', tag: 'solar-only', verticals: ['solar'], minScore: 7000, maxPrice: 75, aggression: 0.60, timingBias: 38 },
    { index: 2, name: 'RoofingPro', tag: 'home-services', verticals: ['roofing', 'hvac', 'solar'], minScore: 4000, maxPrice: 55, aggression: 0.25, timingBias: 18 },
    { index: 3, name: 'InsuranceAce', tag: 'insurance', verticals: ['insurance'], minScore: 5000, maxPrice: 60, aggression: 0.50, timingBias: 30 },
    { index: 4, name: 'LegalEagle', tag: 'legal-premium', verticals: ['legal'], minScore: 4000, maxPrice: 120, aggression: 0.90, timingBias: 52 },  // was 8000
    { index: 5, name: 'FinancePilot', tag: 'fin-services', verticals: ['financial_services', 'insurance'], minScore: 4000, maxPrice: 100, aggression: 0.70, timingBias: 42 },  // was 7500
    { index: 6, name: 'GeneralistA', tag: 'bargain-hunter', verticals: ['*'], minScore: 3000, maxPrice: 45, aggression: 0.15, timingBias: 12 },
    { index: 7, name: 'GeneralistB', tag: 'mid-market', verticals: ['*'], minScore: 5000, maxPrice: 65, aggression: 0.50, timingBias: 28 },
    { index: 8, name: 'HomeServices', tag: 'hvac-solar-roof', verticals: ['roofing', 'hvac', 'solar', 'real_estate'], minScore: 4500, maxPrice: 70, aggression: 0.35, timingBias: 22 },
    { index: 9, name: 'HighRoller', tag: 'premium-all', verticals: ['*'], minScore: 6500, maxPrice: 130, aggression: 0.85, timingBias: 50 },
];

// ── Per-Lead Bid Timer Registry ────────────────────
export const activeBidTimers = new Map<string, NodeJS.Timeout[]>();

export function clearAllBidTimers(): void {
    for (const timers of activeBidTimers.values()) {
        for (const t of timers) clearTimeout(t);
    }
    activeBidTimers.clear();
}

// ── Live Metrics Pulse ──────────────────────────────

let _demoRunStartTime: number | null = null;

/** Set by demo-orchestrator when a run starts; used for daily-revenue extrapolation. */
export function setDemoRunStartTime(ts: number | null): void {
    _demoRunStartTime = ts;
}

export async function emitLiveMetrics(io: SocketServer, _runId: string): Promise<void> {
    try {
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 60_000);
        const runStart = _demoRunStartTime ? new Date(_demoRunStartTime) : new Date(now.getTime() - 60_000);

        const [activeCount, leadsThisMinute, platformRevAggregate] = await Promise.all([
            prisma.lead.count({ where: { source: 'DEMO', status: 'IN_AUCTION' } }),
            prisma.lead.count({ where: { source: 'DEMO', createdAt: { gte: oneMinuteAgo } } }),
            prisma.lead.aggregate({
                _sum: { winningBid: true },
                where: { source: 'DEMO', status: 'SOLD', createdAt: { gte: runStart } },
            }),
        ]);

        const settledThisRun = Number(platformRevAggregate._sum?.winningBid ?? 0);
        const ageMs = _demoRunStartTime ? now.getTime() - _demoRunStartTime : 60_000;
        const dailyRevenue = Math.round(settledThisRun * 0.05 * (86_400_000 / Math.max(ageMs, 1)));

        emit(io, {
            ts: now.toISOString(), level: 'info',
            message: `📊 Live: Active auctions: ${activeCount} | Leads this minute: ${leadsThisMinute} | Platform revenue today: ~$${dailyRevenue.toLocaleString()}`,
        });

        io.emit('demo:metrics', { activeCount, leadsThisMinute, dailyRevenue });
    } catch { /* non-fatal */ }
}

// ── Staggered Per-Buyer Bid Scheduling ──────────────

/**
 * scheduleBuyerBids — for each of the 10 buyer profiles, evaluates whether that
 * buyer would bid on this lead, then sets a randomised setTimeout (10–55 s).
 * All timers are stored in activeBidTimers so stopDemo / abort can cancel them.
 */
export function scheduleBuyerBids(
    io: SocketServer,
    leadId: string,
    vertical: string,
    qualityScore: number,
    reservePrice: number,
    auctionEndAt: Date,
): void {
    if (!VAULT_ADDRESS) return; // Off-chain mode — no bidding

    // ~5% of leads get 0 bids (realistic cold auctions — was 15%, reduced to keep demo lively)
    if (Math.random() < 0.05) {
        emit(io, {
            ts: new Date().toISOString(), level: 'info',
            message: `🔇 Lead ${leadId.slice(0, 8)}… — no buyers interested this round (simulating cold auction)`,
        });
        return;
    }

    const timers: NodeJS.Timeout[] = [];
    let scheduledCount = 0;

    for (const profile of BUYER_PROFILES) {
        const wantsVertical = profile.verticals.includes('*') || profile.verticals.includes(vertical);
        if (!wantsVertical) continue;

        if (qualityScore < profile.minScore) {
            emit(io, {
                ts: new Date().toISOString(), level: 'info',
                message: `🙅 Buyer #${profile.index + 1} (${profile.name} – ${profile.tag}) skipping lead ${leadId.slice(0, 8)}… — quality ${qualityScore} < threshold ${profile.minScore}`,
            });
            continue;
        }

        if (reservePrice > profile.maxPrice) {
            emit(io, {
                ts: new Date().toISOString(), level: 'info',
                message: `💸 Buyer #${profile.index + 1} (${profile.name}) not bidding — reserve $${reservePrice} > max $${profile.maxPrice}`,
            });
            continue;
        }

        // ~10% independent skip per eligible buyer
        if (Math.random() < 0.10) continue;

        const premium = Math.round(reservePrice * (Math.random() * 0.20));
        const bidAmount = Math.min(reservePrice + premium, profile.maxPrice);

        const jitter = (Math.random() * 24) - 12;
        const delaySec = Math.max(10, Math.min(55, profile.timingBias + jitter));
        const delayMs = Math.round(delaySec * 1000);

        const buyerIdx = profile.index;
        const timer = setTimeout(async () => {
            try {
                // Auction-closed guard: time-based
                if (Date.now() >= auctionEndAt.getTime()) {
                    emit(io, {
                        ts: new Date().toISOString(), level: 'info',
                        message: `⏳ Buyer #${buyerIdx + 1} (${profile.name}) skipping — auction ${leadId.slice(0, 8)}… already closed (time-based)`,
                    });
                    return;
                }

                // Auction-closed guard: DB status check
                const currentLead = await prisma.lead.findUnique({
                    where: { id: leadId },
                    select: { status: true },
                });
                if (currentLead?.status !== 'IN_AUCTION') {
                    emit(io, {
                        ts: new Date().toISOString(), level: 'info',
                        message: `⏳ Buyer #${buyerIdx + 1} (${profile.name}) skipping — auction ${leadId.slice(0, 8)}… status is ${currentLead?.status ?? 'unknown'}`,
                    });
                    return;
                }

                const deployer = getSigner();
                const vault = getVault(deployer);

                const buyerAddr = DEMO_BUYER_WALLETS[buyerIdx];
                const vaultBal = await vault.balanceOf(buyerAddr);
                const locked = await vault.lockedBalances(buyerAddr);
                const freeBalance = Number(vaultBal - locked) / 1e6;

                if (freeBalance < bidAmount) {
                    emit(io, {
                        ts: new Date().toISOString(), level: 'warn',
                        message: `⚠️ Buyer #${buyerIdx + 1} (${profile.name}) vault low ($${freeBalance.toFixed(2)} free) — skipping bid on ${leadId.slice(0, 8)}…`,
                    });
                    return;
                }

                emit(io, {
                    ts: new Date().toISOString(), level: 'info',
                    message: `🤖 Buyer #${buyerIdx + 1} (${profile.name} – ${profile.tag}) autobidding $${bidAmount} at ${Math.round(delaySec)}s — quality ${qualityScore} ≥ threshold ${profile.minScore}`,
                });

                // Nonce stagger: 50 ms × buyerIndex + 0–75 ms random jitter
                await new Promise(r => setTimeout(r, (buyerIdx * 50) + Math.floor(Math.random() * 75)));

                const nonce = await getNextNonce();
                const bidAmountUnits = ethers.parseUnits(String(bidAmount), 6);
                const tx = await vault.lockForBid(buyerAddr, bidAmountUnits, { nonce });
                const receipt = await tx.wait();

                // BUG-2 fix: query real cumulative bid count so the frontend counter increments correctly.
                // Previously hardcoded as 1, which caused the Zustand max() guard to keep it at 1 forever.
                const actualBidCount = await prisma.bid.count({
                    where: { leadId, status: { not: 'EXPIRED' } },
                }).catch(() => 1);

                io.emit('marketplace:bid:update', {
                    leadId,
                    bidCount: actualBidCount,
                    highestBid: bidAmount,
                    timestamp: new Date().toISOString(),
                    buyerName: profile.name,
                });

                // BUG-2 fix: also emit auction:updated so the countdown timer re-baselines on every drip bid.
                const leadRecord = await prisma.lead.findUnique({
                    where: { id: leadId },
                    select: { auctionEndAt: true },
                }).catch(() => null);
                if (leadRecord?.auctionEndAt) {
                    const remainingTime = Math.max(0, new Date(leadRecord.auctionEndAt).getTime() - Date.now());
                    io.emit('auction:updated', {
                        leadId,
                        remainingTime,
                        serverTs: Date.now(),  // epoch ms — BUG-1 already fixed in orchestrator; consistent here too
                        bidCount: actualBidCount,
                        highestBid: bidAmount,
                        isSealed: false,
                    });
                }

                emit(io, {
                    ts: new Date().toISOString(), level: 'success',
                    message: `✅ ${profile.name} bid confirmed: $${bidAmount} locked — tx ${receipt?.hash?.slice(0, 20)}…`,
                    txHash: receipt?.hash,
                });
            } catch (err: any) {
                const msg = err?.shortMessage || err?.message?.slice(0, 80) || 'unknown';
                emit(io, {
                    ts: new Date().toISOString(), level: 'warn',
                    message: `⚠️ Buyer #${buyerIdx + 1} (${profile.name}) bid failed for ${leadId.slice(0, 8)}…: ${msg}`,
                });
            }
        }, delayMs);

        timers.push(timer);
        scheduledCount++;

        // ~10% chance of single bid only
        if (scheduledCount === 1 && Math.random() < 0.10) break;
    }

    // Guaranteed-bid fallback: if no buyer was scheduled (score/price/skip filters),
    // GeneralistA bids within 10–45s — prevents any lead ending with 0 bids.
    if (scheduledCount === 0 && qualityScore >= 2000 && VAULT_ADDRESS) {
        const fallback = BUYER_PROFILES.find(p => p.name === 'GeneralistA');
        if (fallback && reservePrice <= fallback.maxPrice) {
            const fallbackBid = Math.min(reservePrice + 1 + Math.floor(Math.random() * 5), fallback.maxPrice);
            const fallbackDelay = Math.round((10 + Math.random() * 35) * 1000); // 10–45s window
            const buyerIdx = fallback.index;

            const fallbackTimer = setTimeout(async () => {
                try {
                    if (Date.now() >= auctionEndAt.getTime()) return;
                    const currentLead = await prisma.lead.findUnique({ where: { id: leadId }, select: { status: true } });
                    if (currentLead?.status !== 'IN_AUCTION') return;

                    const buyerAddr = DEMO_BUYER_WALLETS[buyerIdx];
                    const vaultBal = await (getVault(getSigner()) as any).balanceOf(buyerAddr).catch(() => 0n);
                    const locked = await (getVault(getSigner()) as any).lockedBalances(buyerAddr).catch(() => 0n);
                    const freeBalance = Number(vaultBal - locked) / 1e6;
                    if (freeBalance < fallbackBid) return;

                    const nonce = await getNextNonce();
                    const bidAmountUnits = ethers.parseUnits(String(fallbackBid), 6);
                    const tx = await (getVault(getSigner()) as any).lockForBid(buyerAddr, bidAmountUnits, { nonce });
                    await tx.wait();

                    const actualBidCount = await prisma.bid.count({ where: { leadId, status: { not: 'EXPIRED' } } }).catch(() => 1);
                    io.emit('marketplace:bid:update', { leadId, bidCount: actualBidCount, highestBid: fallbackBid, timestamp: new Date().toISOString(), buyerName: fallback.name });

                    const leadRecord = await prisma.lead.findUnique({ where: { id: leadId }, select: { auctionEndAt: true } }).catch(() => null);
                    if (leadRecord?.auctionEndAt) {
                        const remainingTime = Math.max(0, new Date(leadRecord.auctionEndAt).getTime() - Date.now());
                        io.emit('auction:updated', { leadId, remainingTime, serverTs: Date.now(), bidCount: actualBidCount, highestBid: fallbackBid, isSealed: false });
                    }

                    emit(io, { ts: new Date().toISOString(), level: 'info', message: `🎯 Guaranteed bid: ${fallback.name} bid $${fallbackBid} on ${leadId.slice(0, 8)}… (fallback)` });
                } catch { /* non-fatal — guaranteed bid best-effort only */ }
            }, fallbackDelay);

            timers.push(fallbackTimer);
        }
    }

    if (timers.length > 0) {
        activeBidTimers.set(leadId, timers);
    }
}

// Wire scheduleBuyerBids into demo-lead-drip at module init (breaks circular dep)
wireScheduleBuyerBids(scheduleBuyerBids);

// ── Lightweight Mid-Run USDC Sweep ─────────────────

/**
 * sweepBuyerUSDC — real on-chain USDC reclaim from buyer wallets.
 * Fires every 10 min while the demo is live.
 */
export async function sweepBuyerUSDC(io: SocketServer): Promise<void> {
    try {
        const provider = getSharedProvider();
        const deployer = getSigner();
        const deployerAddr = deployer.address;
        let totalSwept = 0n;
        let walletCount = 0;

        for (let i = 0; i < DEMO_BUYER_WALLETS.length; i++) {
            const addr = DEMO_BUYER_WALLETS[i];
            const key = DEMO_BUYER_KEYS[i];
            if (!key) continue;

            try {
                const buyerSigner = new ethers.Wallet(key, provider);
                const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, buyerSigner);

                const bal = await usdcContract.balanceOf(addr) as bigint;
                if (bal <= ethers.parseUnits('1', 6)) continue;

                const bNonce = await provider.getTransactionCount(addr, 'pending');
                const feeData = await provider.getFeeData();
                const gasPrice = feeData.gasPrice
                    ? (feeData.gasPrice * 120n) / 100n
                    : undefined;

                const tx = await usdcContract.transfer(
                    deployerAddr, bal,
                    { nonce: bNonce, ...(gasPrice ? { gasPrice } : {}) },
                );
                const receipt = await tx.wait();

                totalSwept += bal;
                walletCount++;

                emit(io, {
                    ts: new Date().toISOString(), level: 'success',
                    message: `♻️ USDC recycled: $${ethers.formatUnits(bal, 6)} reclaimed on-chain from Wallet ${i + 1} — tx ${receipt?.hash?.slice(0, 20)}…`,
                    txHash: receipt?.hash,
                });
            } catch (err: any) {
                const msg = err?.shortMessage || err?.message?.slice(0, 60) || 'unknown';
                emit(io, {
                    ts: new Date().toISOString(), level: 'warn',
                    message: `⚠️ USDC sweep skipped Wallet ${i + 1}: ${msg}`,
                });
            }
        }

        if (walletCount > 0) {
            emit(io, {
                ts: new Date().toISOString(), level: 'success',
                message: `♻️ Sweep complete: $${ethers.formatUnits(totalSwept, 6)} USDC recycled on-chain across ${walletCount} wallets — perpetual demo ready`,
            });
        }
    } catch { /* non-fatal outer */ }
}
