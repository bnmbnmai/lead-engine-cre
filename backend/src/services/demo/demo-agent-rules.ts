/**
 * demo-agent-rules.ts — Kimi AI agent auto-bid rule bootstrap
 *
 * Ensures the Kimi agent's BuyerPreferenceSet rows are active in the DB
 * before the demo lead drip starts. Called by runFullDemo() during startup.
 *
 * Design:
 *   - Idempotent: upserts by (buyerProfileId, label). Safe to call every run.
 *   - Pure Prisma — no HTTP, no MCP round-trip.
 *   - One pref set per demo vertical so existing vertical-specific auto-bid
 *     logic in auto-bid.service.ts evaluateLeadForAutoBid() picks them up
 *     correctly (it matches on prefSet.vertical === lead.vertical).
 *   - BidSource for resulting bids will be AUTO_BID (engine-driven), with
 *     buyerId = agent's User.id — visible in Dev Log + Basescan tx attribution.
 */

import { prisma } from '../../lib/prisma';
import { FALLBACK_VERTICALS } from './demo-shared';

// ── Agent configuration ────────────────────────────────────────────────────
// Wallet 10 — reuses an existing demo buyer wallet (already pre-funded to $200
// each run and handled by the recycling loop). Zero extra infrastructure needed.
export const KIMI_AGENT_WALLET = '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad';

const AUTO_BID_AMOUNT = 45;   // $45 default — competitive but leaves room for human buyers
const MAX_BID_PER_LEAD = 75;   // $75 ceiling per individual lead
const DAILY_BUDGET = 500;  // $500/day — covers the full 5-min demo window comfortably
const MIN_QUALITY = 6000; // 60/100 minimum CRE quality score (0-10000 scale)

/**
 * Ensures the Kimi agent's auto-bid preference sets are active.
 * Returns the agent's buyerProfileId (for logging), or null if the agent
 * account hasn't been seeded yet (run seed-agent-buyer.ts first).
 */
export async function ensureKimiAgentRules(): Promise<string | null> {
    // Resolve profile ID — from env (fast path) or DB lookup
    const profileIdFromEnv = process.env.KIMI_AGENT_BUYER_PROFILE_ID;

    let profileId: string | null = profileIdFromEnv ?? null;

    if (!profileId) {
        const user = await prisma.user.findUnique({
            where: { walletAddress: KIMI_AGENT_WALLET },
            include: { buyerProfile: true },
        });
        profileId = user?.buyerProfile?.id ?? null;
    }

    if (!profileId) {
        console.warn(
            '[KimiAgent] BuyerProfile not found — run `npx ts-node src/scripts/seed-agent-buyer.ts` first.'
        );
        return null;
    }

    // Upsert one preference set per demo vertical.
    // auto-bid.service.ts evaluateLeadForAutoBid() matches prefSet.vertical === lead.vertical,
    // so wildcard coverage requires one set per vertical that the agent cares about.
    const verticals = FALLBACK_VERTICALS; // ['mortgage','solar','insurance', ...]

    await Promise.all(verticals.map(async (vertical) => {
        const label = `Kimi Agent — ${vertical} (US)`;

        // Check if a set with this label already exists (avoid duplicate on re-run)
        const existing = await prisma.buyerPreferenceSet.findFirst({
            where: { buyerProfileId: profileId!, label },
        });

        if (existing) {
            // Ensure it's active and values are up-to-date
            await prisma.buyerPreferenceSet.update({
                where: { id: existing.id },
                data: {
                    isActive: true,
                    autoBidEnabled: true,
                    autoBidAmount: AUTO_BID_AMOUNT,
                    maxBidPerLead: MAX_BID_PER_LEAD,
                    dailyBudget: DAILY_BUDGET,
                    minQualityScore: MIN_QUALITY,
                    geoCountries: ['US'],
                },
            });
        } else {
            await prisma.buyerPreferenceSet.create({
                data: {
                    buyerProfileId: profileId!,
                    label,
                    vertical,
                    priority: 0,        // highest priority (lower = higher)
                    geoCountries: ['US'],
                    geoInclude: [],
                    geoExclude: [],
                    autoBidEnabled: true,
                    autoBidAmount: AUTO_BID_AMOUNT,
                    maxBidPerLead: MAX_BID_PER_LEAD,
                    dailyBudget: DAILY_BUDGET,
                    minQualityScore: MIN_QUALITY,
                    isActive: true,
                },
            });
        }
    }));

    console.log(
        `[KimiAgent] ✅ Auto-bid rules active — profile ${profileId}, ` +
        `${verticals.length} verticals, $${AUTO_BID_AMOUNT} base bid, $${MAX_BID_PER_LEAD} cap`
    );

    return profileId;
}
