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
        const prefMinScore = (prefSet as any).minQualityScore;
        if (prefMinScore != null && prefMinScore > 0) {
            const leadScore = lead.qualityScore ?? 0;
            if (leadScore < prefMinScore) {
                result.skipped.push({ buyerId, preferenceSetId: setId, reason: `Quality ${leadScore} < min ${prefMinScore}` });
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

        // ── 6. Bid amount calculation ──
        const bidAmount = Number(prefSet.autoBidAmount);
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
                    source: 'AUTO_BID' as any,
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
            source: 'AUTO_BID' as any,
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
        where: { id: { in: leadIds }, status: 'PENDING_AUCTION' as any },
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
        });
        results.push(result);
    }

    return results;
}
