/**
 * Auto-Bid Service — Lead Engine CRE
 *
 * Evaluates incoming leads against buyer auto-bid rules and
 * automatically places bids for matching preference sets.
 *
 * Rules evaluated per preference set:
 *   1. Vertical match (exact or wildcard '*')
 *   2. Geo match (country + include/exclude states)
 *   3. Quality score gate (minQualityScore)
 *   4. Off-site toggle (acceptOffSite)
 *   5. Verified-only toggle (requireVerified)
 *   6. Daily budget enforcement
 *   7. Max bid per lead cap
 */

import { prisma } from '../lib/prisma';
import { ethers } from 'ethers';
import { evaluateFieldFilters, FieldFilterRule } from './field-filter.service';
import { dataStreamsService } from './datastreams.service';

// ============================================
// On-chain config for USDC allowance checks
// ============================================

const ESCROW_CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.ESCROW_CONTRACT_ADDRESS || '';
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
async function getUsdcAllowance(ownerAddress: string, spenderAddress: string): Promise<bigint> {
    if (!USDC_CONTRACT_ADDRESS) return BigInt(0);
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const usdc = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, provider);
    const allowance = await usdc.allowance(ownerAddress, spenderAddress);
    return BigInt(allowance.toString());
}

// ============================================
// Types
// ============================================

export interface LeadData {
    id: string;
    vertical: string;
    geo: {
        country: string;
        state?: string;
        city?: string;
        zip?: string;
    };
    source: string;
    qualityScore: number | null;
    isVerified: boolean;
    reservePrice: number;
    parameters?: Record<string, any> | null; // Field-level data for autobid matching
}

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

/**
 * Evaluate a lead against all active auto-bid rules and place matching bids.
 * Called when a new lead is submitted or its status changes to ACTIVE.
 */
export async function evaluateLeadForAutoBid(lead: LeadData): Promise<AutoBidResult> {
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

        // ── 1. Geo country match ──
        const geoCountries: string[] = Array.isArray(prefSet.geoCountries) ? prefSet.geoCountries : [prefSet.geoCountries || 'US'];
        if (!geoCountries.includes(lead.geo.country)) {
            result.skipped.push({ buyerId, preferenceSetId: setId, reason: `Country mismatch: [${geoCountries.join(',')}] does not include ${lead.geo.country}` });
            continue;
        }

        // ── 2. Geo state include/exclude ──
        const state = lead.geo.state?.toUpperCase();
        if (state && prefSet.geoInclude.length > 0) {
            const included = prefSet.geoInclude.map(s => s.toUpperCase());
            if (!included.includes(state)) {
                result.skipped.push({ buyerId, preferenceSetId: setId, reason: `State ${state} not in include list` });
                continue;
            }
        }
        if (state && prefSet.geoExclude.length > 0) {
            const excluded = prefSet.geoExclude.map(s => s.toUpperCase());
            if (excluded.includes(state)) {
                result.skipped.push({ buyerId, preferenceSetId: setId, reason: `State ${state} in exclude list` });
                continue;
            }
        }

        // ── 3. Quality score gate ──
        // Buyer sets minQualityScore on 0-100 scale; internal score is 0-10,000
        const prefMinScore = (prefSet as any).minQualityScore;
        if (prefMinScore != null && prefMinScore > 0) {
            const leadScore = lead.qualityScore ?? 0;
            const internalThreshold = prefMinScore * 100; // 0-100 → 0-10,000
            if (leadScore < internalThreshold) {
                result.skipped.push({ buyerId, preferenceSetId: setId, reason: `Quality ${Math.floor(leadScore / 100)}/100 < min ${prefMinScore}/100` });
                continue;
            }
        }

        // ── 3.5. Field-level filter rules ──
        const activeFilters = ((prefSet as any).fieldFilters || []) as Array<{
            operator: string;
            value: string;
            verticalField: { key: string; isBiddable: boolean; isPii: boolean };
        }>;
        // Only evaluate biddable, non-PII fields (security gate)
        const biddableRules: FieldFilterRule[] = activeFilters
            .filter(f => f.verticalField.isBiddable && !f.verticalField.isPii)
            .map(f => ({
                fieldKey: f.verticalField.key,
                operator: f.operator as any,
                value: f.value,
            }));

        if (biddableRules.length > 0) {
            const filterResult = evaluateFieldFilters(lead.parameters, biddableRules);
            if (!filterResult.pass) {
                const failedKeys = filterResult.failedRules.map(r => r.fieldKey).join(', ');
                result.skipped.push({ buyerId, preferenceSetId: setId, reason: `Field filter failed: ${failedKeys}` });
                continue;
            }
        }

        // ── 4. Off-site toggle ──
        if (!prefSet.acceptOffSite && lead.source === 'OFFSITE') {
            result.skipped.push({ buyerId, preferenceSetId: setId, reason: 'Off-site leads rejected' });
            continue;
        }

        // ── 5. Verified-only ──
        if (prefSet.requireVerified && !lead.isVerified) {
            result.skipped.push({ buyerId, preferenceSetId: setId, reason: 'Requires verified lead' });
            continue;
        }

        // ── 6. Bid amount calculation (Data Feeds floor-aware) ──
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

        // ── 7. Max bid per lead cap ──
        if (prefSet.maxBidPerLead) {
            const cap = Number(prefSet.maxBidPerLead);
            if (bidAmount > cap) {
                result.skipped.push({ buyerId, preferenceSetId: setId, reason: `Bid $${bidAmount} > max per lead $${cap}` });
                continue;
            }
        }

        // ── 8. Daily budget enforcement ──
        if (prefSet.dailyBudget) {
            const todaySpend = await getDailySpend(buyerId);
            const budget = Number(prefSet.dailyBudget);
            if (todaySpend + bidAmount > budget) {
                result.skipped.push({ buyerId, preferenceSetId: setId, reason: `Daily budget exceeded: $${todaySpend} + $${bidAmount} > $${budget}` });
                continue;
            }
        }

        // ── 8b. On-chain USDC allowance check ──
        const buyerWallet = prefSet.buyerProfile.user?.walletAddress;
        if (buyerWallet && ESCROW_CONTRACT_ADDRESS) {
            try {
                const allowance = await getUsdcAllowance(buyerWallet, ESCROW_CONTRACT_ADDRESS);
                const bidAmountWei = BigInt(Math.floor(bidAmount * 1e6));
                if (allowance < bidAmountWei) {
                    result.skipped.push({
                        buyerId,
                        preferenceSetId: setId,
                        reason: `Insufficient USDC allowance: $${Number(allowance) / 1e6} < $${bidAmount}`,
                    });
                    continue;
                }
            } catch (err: any) {
                // Graceful fallback: don't block auto-bids on RPC errors
                console.warn(`[AUTO-BID] Allowance check failed for ${buyerWallet}: ${err.message}. Proceeding anyway.`);
            }
        }

        // ── 9. Check for duplicate bid ──
        const existingBid = await prisma.bid.findFirst({
            where: { leadId: lead.id, buyerId: buyerId },
        });
        if (existingBid) {
            result.skipped.push({ buyerId, preferenceSetId: setId, reason: 'Already bid on this lead' });
            continue;
        }

        // ═══ Place the sealed bid ═══
        try {
            // Generate sealed-bid commitment
            const salt = ethers.hexlify(ethers.randomBytes(32));
            const commitment = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(['uint96', 'bytes32'], [bidAmount, salt])
            );

            await prisma.bid.create({
                data: {
                    leadId: lead.id,
                    buyerId: buyerId,
                    commitment,
                    amount: bidAmount,
                    salt,
                    status: 'PENDING',
                    source: 'AUTO_BID',
                },
            });

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
        } catch (err: any) {
            result.skipped.push({ buyerId, preferenceSetId: setId, reason: `Bid creation failed: ${err.message}` });
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
