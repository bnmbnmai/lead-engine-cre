/**
 * Auto-Bid Service — Lead Engine CRE
 *
 * Evaluates incoming leads against buyer auto-bid rules and
 * automatically places bids for matching preference sets.
 *
 * Deterministic gates 1–7 (vertical, geo country, geo state, quality score,
 * off-site, verified, field filters) are delegated to the shared
 * @lead-engine/rules-engine package — the same code that runs inside the
 * Chainlink DON workflow. This service adds the REAL-TIME gates that depend
 * on external state:
 *   - Data Feeds floor adjustment + reserve price
 *   - Max bid per lead cap
 *   - Daily budget enforcement
 *   - Vault lock / duplicate-bid checks
 */

import { prisma } from '../lib/prisma';
import { ethers } from 'ethers';
import { evaluatePreferenceSet, type LeadData } from '@lead-engine/rules-engine';
import { toRulesPreferenceSet } from './rules-adapter';
import { dataStreamsService } from './data-feeds.service';
import { aceDevBus } from './ace.service';

export type { LeadData } from '@lead-engine/rules-engine';

// ============================================
// On-chain config for USDC allowance checks
// ============================================

const _ESCROW_CONTRACT_ADDRESS = process.env.RTB_ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.ESCROW_CONTRACT_ADDRESS || '';
const USDC_CONTRACT_ADDRESS = process.env.USDC_CONTRACT_ADDRESS || '';
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';

const ERC20_ABI = [
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
];

/**
 * Read on-chain USDC allowance for a buyer → escrow contract.
 * Returns allowance in raw wei (6 decimals for USDC).
 */
async function _getUsdcAllowance(ownerAddress: string, spenderAddress: string): Promise<bigint> {
    if (!USDC_CONTRACT_ADDRESS) return BigInt(0);
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const usdc = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, provider);
    const allowance = await usdc.allowance(ownerAddress, spenderAddress);
    return BigInt(allowance.toString());
}

// ============================================
// Types
// ============================================

export interface AutoBidResult {
    leadId: string;
    bidsPlaced: {
        buyerId: string;
        preferenceSetId: string;
        amount: number;
        reason: string;
    }[];
    skipped: {
        buyerId: string;
        preferenceSetId: string;
        reason: string;
    }[];
}

// ============================================
// Core Engine
// ============================================

export interface AutoBidOptions {
    /**
     * Phase B5 (DON feedback loop): restrict evaluation to these preference
     * set IDs — the sets the CRE workflow already matched under consensus.
     * Gates 1–7 are still re-verified locally (deterministic, same package),
     * but unmatched sets are not re-evaluated, so the DON verdict is the
     * single evaluation of record.
     */
    onlyPreferenceSetIds?: string[];
}

/**
 * Evaluate a lead against all active auto-bid rules and place matching bids.
 * Called when a new lead is submitted or its status changes to ACTIVE.
 */
export async function evaluateLeadForAutoBid(lead: LeadData, options: AutoBidOptions = {}): Promise<AutoBidResult> {
    const result: AutoBidResult = {
        leadId: lead.id,
        bidsPlaced: [],
        skipped: [],
    };

    // ── Gate: respect demo buyers toggle ──
    try {
        const { getDemoBuyersEnabled } = await import('../routes/demo-panel.routes');
        if (!(await getDemoBuyersEnabled())) {
            console.log(`[AUTO-BID] Skipped for lead ${lead.id} — demo buyers disabled`);
            return result;
        }
    } catch {
        // If demo-panel module unavailable, proceed normally
    }

    // Find all active auto-bid preference sets matching this vertical (or wildcard)
    const matchingSets = await prisma.buyerPreferenceSet.findMany({
        where: {
            vertical: { in: [lead.vertical, '*'] },
            isActive: true,
            autoBidEnabled: true,
            autoBidAmount: { not: null },
            ...(options.onlyPreferenceSetIds ? { id: { in: options.onlyPreferenceSetIds } } : {}),
        },
        include: {
            buyerProfile: {
                include: {
                    user: { select: { id: true, walletAddress: true } },
                },
            },
            fieldFilters: {
                where: { isActive: true },
                include: { verticalField: { select: { key: true, isBiddable: true, isPii: true } } },
            },
        },
        orderBy: { priority: 'asc' },
    });

    // Process each matching preference set
    for (const prefSet of matchingSets) {
        const buyerId = prefSet.buyerProfile.userId;
        const setId = prefSet.id;

        // ── Gates 1–7: deterministic evaluation via shared rules engine ──
        // Same code that runs inside the Chainlink DON workflow, so the
        // server-side path can never diverge from the DON path again.
        const match = evaluatePreferenceSet(lead, toRulesPreferenceSet({ ...prefSet, buyerProfile: { userId: buyerId } } as any));
        if (!match.matched) {
            result.skipped.push({ buyerId, preferenceSetId: setId, reason: match.reason });
            continue;
        }

        // ── Real-time gate: bid amount calculation (Data Feeds floor-aware) ──
        // Read real-time floor from Chainlink Data Feeds and adjust bid upward
        // to be competitive — but never exceed the buyer's maxBidPerLead cap.
        let bidAmount = Number(prefSet.autoBidAmount);
        let floorAdjusted = false;
        let floorPrice: number | undefined;
        try {
            const floorData = await dataStreamsService.getRealtimeBidFloor(lead.vertical, lead.geo.country);
            floorPrice = floorData.bidFloor;
            if (bidAmount < floorPrice) {
                const cap = prefSet.maxBidPerLead ? Number(prefSet.maxBidPerLead) : Infinity;
                const adjusted = Math.min(floorPrice, cap);
                if (adjusted >= lead.reservePrice) {
                    console.log(`[AUTO-BID] Floor-adjusted bid: $${bidAmount} → $${adjusted} (floor=$${floorPrice})`);
                    bidAmount = adjusted;
                    floorAdjusted = true;
                }
            }
        } catch (err: any) {
            // Graceful fallback: proceed with original bid amount if Data Feed unavailable
            console.warn(`[AUTO-BID] Data Feed floor check failed: ${err.message}. Using original amount.`);
        }
        if (bidAmount < lead.reservePrice) {
            result.skipped.push({ buyerId, preferenceSetId: setId, reason: `Bid $${bidAmount} < reserve $${lead.reservePrice}` });
            continue;
        }

        // ── Real-time gate: max bid per lead cap ──
        if (prefSet.maxBidPerLead) {
            const cap = Number(prefSet.maxBidPerLead);
            if (bidAmount > cap) {
                result.skipped.push({ buyerId, preferenceSetId: setId, reason: `Bid $${bidAmount} > max per lead $${cap}` });
                continue;
            }
        }

        // ── Real-time gate: daily budget enforcement ──
        if (prefSet.dailyBudget) {
            const todaySpend = await getDailySpend(buyerId);
            const budget = Number(prefSet.dailyBudget);
            if (todaySpend + bidAmount > budget) {
                result.skipped.push({ buyerId, preferenceSetId: setId, reason: `Daily budget exceeded: $${todaySpend} + $${bidAmount} > $${budget}` });
                continue;
            }
        }

        // Note: USDC allowance check removed — vault model uses balance-based locking,
        // not ERC20 approvals. Vault balance is checked during lockForBid below.
        const buyerWallet = prefSet.buyerProfile.user?.walletAddress;

        // ── Real-time gate: duplicate bid check ──
        const existingBid = await prisma.bid.findFirst({
            where: { leadId: lead.id, buyerId: buyerId },
        });
        if (existingBid) {
            result.skipped.push({ buyerId, preferenceSetId: setId, reason: 'Already bid on this lead' });
            continue;
        }

        // ═══ Place the sealed bid via the canonical BidService ═══
        // Server-custody mode: the engine knows the amount, so BidService
        // computes the domain-separated commitment, locks vault funds, and
        // stores amount+salt for auto-reveal at close (with saga refund on
        // DB failure). One bid path for humans, agents, and this engine.
        try {
            const { placeSealedBid } = await import('./bid.service');
            const placed = await placeSealedBid({
                leadId: lead.id,
                buyerId,
                walletAddress: buyerWallet,
                serverCustody: { amount: bidAmount },
                source: 'AUTO_BID',
                skipCompliance: true, // engine bids are pre-screened demo/auto buyers
            });

            if (!placed.ok) {
                result.skipped.push({ buyerId, preferenceSetId: setId, reason: placed.error || 'Bid placement failed' });
                continue;
            }

            // Log analytics event
            await prisma.analyticsEvent.create({
                data: {
                    eventType: 'auto_bid',
                    entityType: 'bid',
                    entityId: lead.id,
                    userId: buyerId,
                    metadata: {
                        preferenceSetId: setId,
                        vertical: lead.vertical,
                        amount: bidAmount,
                        qualityScore: lead.qualityScore,
                        geo: lead.geo,
                        floorAdjusted,
                        floorPrice,
                    },
                },
            });

            result.bidsPlaced.push({
                buyerId,
                preferenceSetId: setId,
                amount: bidAmount,
                reason: `Auto-bid: ${prefSet.label} → $${bidAmount}`,
            });

            // ── Surface agent activity in the frontend dev log ──
            aceDevBus.emit('ace:dev-log', {
                ts: new Date().toISOString(),
                action: 'agent:bid:placed',
                leadId: lead.id,
                buyerId,
                preferenceSetId: setId,
                vertical: lead.vertical,
                amount: bidAmount,
                floorAdjusted,
                floorPrice,
                ruleLabel: prefSet.label,
                message: `🤖 AI agent bid $${bidAmount} on ${lead.vertical} lead (rule: ${prefSet.label})`,
            });
        } catch (err: any) {
            result.skipped.push({ buyerId, preferenceSetId: setId, reason: `Bid creation failed: ${err.message}` });
        }
    }

    // ── Phase C1: run ACTIVE agent strategies against this lead ──
    // Strategies are user-authored StrategySpec documents executed by the
    // deterministic engine (backend/src/agents/strategy). They bid through
    // the same bid.service path; duplicate-bid upsert makes re-runs safe.
    // Restricted (DON-ingest) evaluations skip this — strategies run once
    // on the unrestricted trigger path.
    if (!options.onlyPreferenceSetIds) {
        try {
            const { runStrategiesForLead } = await import('../agents/strategy/runner');
            const outcomes = await runStrategiesForLead(lead);
            for (const o of outcomes) {
                if (o.bidPlaced && o.bidAmount != null) {
                    result.bidsPlaced.push({
                        buyerId: o.ownerId,
                        preferenceSetId: `strategy:${o.strategyId}@v${o.version}`,
                        amount: o.bidAmount,
                        reason: `Strategy "${o.strategyName}" v${o.version}: ${o.reason}`,
                    });
                } else if (o.shouldBid && !o.bidPlaced) {
                    result.skipped.push({
                        buyerId: o.ownerId,
                        preferenceSetId: `strategy:${o.strategyId}@v${o.version}`,
                        reason: `Strategy bid failed: ${o.bidError ?? 'unknown'}`,
                    });
                }
            }
        } catch (err: any) {
            console.warn(`[AUTO-BID] Strategy run failed for lead ${lead.id}: ${err.message}`);
        }
    }

    return result;
}

// ============================================
// Helpers
// ============================================

/**
 * Calculate total bid spend for a buyer today (UTC day boundary).
 */
async function getDailySpend(buyerId: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const result = await prisma.bid.aggregate({
        where: {
            buyerId: buyerId,
            createdAt: { gte: todayStart },
            source: 'AUTO_BID',
        },
        _sum: { amount: true },
    });

    return Number(result._sum?.amount ?? 0);
}

/**
 * Batch evaluate multiple leads (e.g., when auto-bid is first enabled).
 */
export async function batchEvaluateLeads(leadIds: string[]): Promise<AutoBidResult[]> {
    const leads = await prisma.lead.findMany({
        where: { id: { in: leadIds }, status: 'PENDING_AUCTION' },
    });

    const results: AutoBidResult[] = [];
    for (const lead of leads) {
        const geo = lead.geo as any;
        const result = await evaluateLeadForAutoBid({
            id: lead.id,
            vertical: lead.vertical,
            geo: {
                country: geo?.country || 'US',
                state: geo?.state || geo?.region,
                city: geo?.city,
                zip: geo?.zip,
            },
            source: lead.source as string,
            qualityScore: (lead as any).qualityScore ?? null,
            isVerified: lead.isVerified ?? false,
            reservePrice: Number(lead.reservePrice ?? 0),
            parameters: (lead as any).parameters ?? null,
        });
        results.push(result);
    }

    return results;
}
