/**
 * Bounties Router — Lead Engine CRE
 *
 * Exposes bounty pool data for sellers, agents, and the buyer UI.
 *
 * Routes:
 *   GET  /api/v1/bounties/available        — Total bounty available per vertical (with criteria breakdown)
 *   GET  /api/v1/bounties/pools/:vertical  — Full pool list for a vertical
 *   POST /api/v1/bounties/deposit          — Deposit USDC into a bounty pool (buyer action)
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { bountyService, BountyDepositSchema } from '../services/bounty.service';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/v1/bounties/available
//
// Returns aggregated bounty availability.
// Query params: vertical (optional), state (future filter), minScore (future filter)
// ──────────────────────────────────────────────────────────────────────────────
router.get('/available', async (req: Request, res: Response) => {
    try {
        const { vertical, state, minScore } = req.query as Record<string, string>;

        if (vertical) {
            // Single vertical
            const total = await bountyService.getVerticalBountyTotal(vertical);

            // Pull criteria breakdown from the vertical's formConfig
            const vert = await prisma.vertical.findUnique({
                where: { slug: vertical },
                select: { formConfig: true, slug: true },
            });

            const config = (vert?.formConfig as any) || {};
            const pools: any[] = (config.bountyPools || []).filter((p: any) => p.active);

            const poolSummaries = pools
                .filter((p: any) => {
                    // Optional filters
                    if (state && p.criteria?.geoStates?.length &&
                        !p.criteria.geoStates.includes(state)) return false;
                    if (minScore && p.criteria?.minQualityScore != null &&
                        p.criteria.minQualityScore > Number(minScore)) return false;
                    return true;
                })
                .map((p: any) => ({
                    poolId: p.poolId || p.buyerId,
                    availableUSDC: Math.max(0, (p.amount || 0) - (p.totalReleased || 0)),
                    criteria: {
                        minQualityScore: p.criteria?.minQualityScore ?? null,
                        geoStates: p.criteria?.geoStates ?? null,
                        geoCountries: p.criteria?.geoCountries ?? null,
                        minCreditScore: p.criteria?.minCreditScore ?? null,
                        maxLeadAge: p.criteria?.maxLeadAge ?? null,
                    },
                }));

            const filteredTotal = poolSummaries.reduce((sum, p) => sum + p.availableUSDC, 0);

            return res.json({
                vertical,
                totalAvailableUSDC: filteredTotal || total,
                poolCount: poolSummaries.length,
                pools: poolSummaries,
                contractAddress: process.env.BOUNTY_POOL_ADDRESS || null,
                functionsEnabled: process.env.BOUNTY_FUNCTIONS_ENABLED === 'true',
            });
        }

        // All verticals with active bounties
        const verticals = await prisma.vertical.findMany({
            select: { slug: true, formConfig: true },
        });

        const results: any[] = [];
        for (const v of verticals) {
            const config = (v.formConfig as any) || {};
            const pools: any[] = (config.bountyPools || []).filter((p: any) => p.active);
            if (pools.length === 0) continue;

            const availableUSDC = pools.reduce(
                (sum, p) => sum + Math.max(0, (p.amount || 0) - (p.totalReleased || 0)), 0
            );
            if (availableUSDC <= 0) continue;

            results.push({
                vertical: v.slug,
                totalAvailableUSDC: availableUSDC,
                poolCount: pools.length,
            });
        }

        // Sort by highest total first (helps agents find best ROI)
        results.sort((a, b) => b.totalAvailableUSDC - a.totalAvailableUSDC);

        return res.json({
            verticals: results,
            totalUSDC: results.reduce((sum, r) => sum + r.totalAvailableUSDC, 0),
            contractAddress: process.env.BOUNTY_POOL_ADDRESS || null,
            functionsEnabled: process.env.BOUNTY_FUNCTIONS_ENABLED === 'true',
            matcherAddress: process.env.BOUNTY_MATCHER_ADDRESS || null,
        });
    } catch (err: any) {
        console.error('[Bounties] GET /available error:', err);
        return res.status(500).json({ error: 'Failed to fetch bounty availability' });
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/v1/bounties/pools/:vertical
//
// Returns full pool list for a vertical (buyer-facing, private pool IDs)
// ──────────────────────────────────────────────────────────────────────────────
router.get('/pools/:vertical', async (req: Request, res: Response) => {
    try {
        const { vertical } = req.params;
        const vert = await prisma.vertical.findUnique({
            where: { slug: vertical },
            select: { formConfig: true },
        });

        if (!vert) return res.status(404).json({ error: 'Vertical not found' });

        const config = (vert.formConfig as any) || {};
        const pools: any[] = config.bountyPools || [];

        return res.json({
            vertical,
            pools: pools.map((p: any) => ({
                poolId: p.poolId || p.buyerId,
                buyerId: p.buyerId,
                amount: p.amount || 0,
                totalReleased: p.totalReleased || 0,
                availableUSDC: Math.max(0, (p.amount || 0) - (p.totalReleased || 0)),
                active: p.active,
                createdAt: p.createdAt,
                criteria: p.criteria || {},
            })),
        });
    } catch (err: any) {
        console.error('[Bounties] GET /pools error:', err);
        return res.status(500).json({ error: 'Failed to fetch pools' });
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/v1/bounties/deposit
//
// Body: { buyerId, verticalSlug, amount, criteria?, buyerWallet? }
// ──────────────────────────────────────────────────────────────────────────────
router.post('/deposit', async (req: Request, res: Response) => {
    try {
        const { buyerId, verticalSlug, amount, criteria, buyerWallet } = req.body;

        if (!buyerId || !verticalSlug || !amount) {
            return res.status(400).json({ error: 'buyerId, verticalSlug, and amount are required' });
        }

        const parsed = BountyDepositSchema.safeParse({ amount, criteria });
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });
        }

        const result = await bountyService.depositBounty(
            buyerId,
            verticalSlug,
            parsed.data.amount,
            parsed.data.criteria,
            buyerWallet
        );

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        return res.status(201).json(result);
    } catch (err: any) {
        console.error('[Bounties] POST /deposit error:', err);
        return res.status(500).json({ error: 'Deposit failed' });
    }
});

export default router;
