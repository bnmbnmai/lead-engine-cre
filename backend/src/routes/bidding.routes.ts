import { Router, Response } from 'express';
import { ethers } from 'ethers';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthenticatedRequest, requireBuyer } from '../middleware/auth';
import { BidCommitSchema, BidRevealSchema, BuyerPreferencesSchema, BuyerPreferencesV2Schema } from '../utils/validation';
import { rtbBiddingLimiter } from '../middleware/rateLimit';
import { dataStreamsService } from '../services/data-feeds.service';
import { evaluateLeadForAutoBid, LeadData } from '../services/auto-bid.service';
import { placeSealedBid, revealSealedBid } from '../services/bid.service';

const router = Router();

// ── Prisma error classifier ──
function classifyPrismaError(error: unknown): { status: number; message: string; code?: string } {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        switch (error.code) {
            case 'P2025': // Record not found
                return { status: 409, message: 'Preference set was modified or deleted by another session — please reload', code: 'STALE_RECORD' };
            case 'P2002': // Unique constraint violation
                return { status: 409, message: 'Duplicate preference set detected', code: 'DUPLICATE' };
            case 'P2028': // Transaction API error
                return { status: 500, message: 'Transaction failed — please retry', code: 'TX_FAILED' };
            default:
                return { status: 500, message: `Database error (${error.code})`, code: error.code };
        }
    }
    if (error instanceof Prisma.PrismaClientValidationError) {
        return { status: 400, message: 'Invalid data format — check budget and score values', code: 'VALIDATION' };
    }
    return { status: 500, message: 'Failed to update preference sets' };
}

// ============================================
// Place Sealed Bid (Commit-Reveal)
// ============================================

router.post('/', rtbBiddingLimiter, authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = BidCommitSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid bid', details: validation.error.issues });
            return;
        }

        const { leadId, commitment } = validation.data;

        // Buyer-profile preference gates (route-level; auction-state +
        // compliance + persistence happen inside BidService)
        const lead = await prisma.lead.findUnique({
            where: { id: leadId },
            select: { source: true, vertical: true, isVerified: true },
        });
        if (lead) {
            const buyer = await prisma.buyerProfile.findFirst({
                where: { user: { id: req.user!.id } },
            });
            if (buyer) {
                if (!buyer.acceptOffSite && lead.source === 'OFFSITE') {
                    res.status(400).json({ error: 'Buyer does not accept off-site leads' });
                    return;
                }
                if (buyer.verticals.length > 0 && !buyer.verticals.includes(lead.vertical)) {
                    res.status(400).json({ error: 'Lead vertical not in buyer preferences' });
                    return;
                }
                if (buyer.requireVerified && !lead.isVerified) {
                    res.status(400).json({ error: 'Buyer requires verified leads' });
                    return;
                }
            }
        }

        // Canonical sealed-bid path (Phase B2): commitment only, no amount.
        const result = await placeSealedBid({
            leadId,
            buyerId: req.user!.id,
            walletAddress: req.user!.walletAddress,
            commitment,
            source: 'MANUAL',
        });

        if (!result.ok) {
            res.status(result.statusCode ?? 400).json({ error: result.error });
            return;
        }

        res.status(201).json({
            bid: {
                id: result.bid!.id,
                leadId: result.bid!.leadId,
                status: result.bid!.status,
                committedAt: result.bid!.createdAt,
            },
            holderPerks: result.isHolder ? {
                multiplier: result.holderMultiplier,
            } : undefined,
            message: 'Bid committed. Reveal after auction ends.',
        });
    } catch (error) {
        console.error('Place bid error:', error);
        res.status(500).json({ error: 'Failed to place bid' });
    }
});

// ============================================
// Reveal Bid (after 60s auction window closes)
// ============================================

router.post('/:bidId/reveal', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = BidRevealSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid reveal', details: validation.error.issues });
            return;
        }

        const { amount, salt } = validation.data;

        // Canonical reveal path (Phase B2): domain-separated commitment
        // verification + vault lock at reveal + holder multiplier.
        const result = await revealSealedBid({
            bidId: req.params.bidId,
            buyerId: req.user!.id,
            amount,
            salt,
        });

        if (!result.ok) {
            res.status(result.statusCode ?? 400).json({ error: result.error });
            return;
        }

        res.json({ bid: result.bid });
    } catch (error) {
        console.error('Reveal bid error:', error);
        res.status(500).json({ error: 'Failed to reveal bid' });
    }
});

// ============================================
// Get My Bids
// ============================================

router.get('/my', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // SECURITY: never return encryptedData/dataHash here — PII ciphertext
        // must not be handed to every bidder. Winners decrypt via the
        // winner-verified decrypt endpoint instead.
        const leadSelect = {
            id: true,
            vertical: true,
            status: true,
            geo: true,
            qualityScore: true,
            nftTokenId: true,
            nftContractAddr: true,
            createdAt: true,
            auctionEndAt: true,
            source: true,
            reservePrice: true,
            winningBid: true,
            sellerId: true,
        };

        const bids = await prisma.bid.findMany({
            where: { buyerId: req.user!.id },
            orderBy: { createdAt: 'desc' },
            include: { lead: { select: leadSelect } },
        });

        // Pure wallet-based ownership: return only the authenticated user's own bids.
        // The demo orchestrator guarantees the Buyer persona wallet wins at least one
        // lead per run, so ACCEPTED bids appear naturally via buyerId match.
        res.json({ bids });
    } catch (error) {
        console.error('Get my bids error:', error);
        res.status(500).json({ error: 'Failed to get bids' });
    }
});

// ============================================
// Withdraw Bid
// ============================================

router.delete('/:bidId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const bid = await prisma.bid.findUnique({
            where: { id: req.params.bidId },
            include: { lead: true },
        });

        if (!bid) {
            res.status(404).json({ error: 'Bid not found' });
            return;
        }

        if (bid.buyerId !== req.user!.id) {
            res.status(403).json({ error: 'Not your bid' });
            return;
        }

        // Can only withdraw pending bids before reveal phase
        if (bid.status !== 'PENDING') {
            res.status(400).json({ error: 'Cannot withdraw revealed or processed bid' });
            return;
        }

        if (bid.lead.status === 'SOLD') {
            res.status(400).json({ error: 'Cannot withdraw after auction ended' });
            return;
        }

        await prisma.bid.update({
            where: { id: bid.id },
            data: { status: 'WITHDRAWN' },
        });

        res.json({ success: true, message: 'Bid withdrawn' });
    } catch (error) {
        console.error('Withdraw bid error:', error);
        res.status(500).json({ error: 'Failed to withdraw bid' });
    }
});

// ============================================
// Update Buyer Preferences
// ============================================

router.put('/preferences', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = BuyerPreferencesSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid preferences', details: validation.error.issues });
            return;
        }

        const data = validation.data;

        await prisma.buyerProfile.upsert({
            where: { userId: req.user!.id },
            create: {
                userId: req.user!.id,
                verticals: data.verticals || [],
                geoFilters: data.geoFilters || {},
                budgetMin: data.budgetMin,
                budgetMax: data.budgetMax,
                dailyBudget: data.dailyBudget,
                monthlyBudget: data.monthlyBudget,
                acceptOffSite: data.acceptOffSite ?? true,
                requireVerified: data.requireVerified ?? false,
                autoAcceptLeads: data.autoAcceptLeads ?? false,
            },
            update: {
                verticals: data.verticals,
                geoFilters: data.geoFilters,
                budgetMin: data.budgetMin,
                budgetMax: data.budgetMax,
                dailyBudget: data.dailyBudget,
                monthlyBudget: data.monthlyBudget,
                acceptOffSite: data.acceptOffSite,
                requireVerified: data.requireVerified,
                autoAcceptLeads: data.autoAcceptLeads,
            },
        });

        res.json({ success: true, message: 'Preferences updated' });
    } catch (error) {
        const classified = classifyPrismaError(error);
        console.error('[PREFS] Update preferences error:', {
            userId: req.user?.id,
            code: classified.code,
            message: classified.message,
            raw: error instanceof Error ? error.message : error,
        });
        res.status(classified.status).json({ error: classified.message, code: classified.code });
    }
});

// ============================================
// Data Feeds — Real-Time Bid Floor (Chainlink)
// ============================================
// Reads ETH/USD from Chainlink Price Feed on Base Sepolia,
// then derives per-vertical floor/ceiling using a market multiplier.

router.get('/bid-floor', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const vertical = (req.query.vertical as string) || 'solar';
        const country = (req.query.country as string) || 'US';

        const bidFloor = await dataStreamsService.getRealtimeBidFloor(vertical, country);
        const priceIndex = await dataStreamsService.getLeadPriceIndex(vertical);

        res.json({ bidFloor, priceIndex });
    } catch (error) {
        console.error('Bid floor error:', error);
        res.status(500).json({ error: 'Failed to get bid floor' });
    }
});

// ============================================
// Preference Sets V2 — Per-Vertical Multi-Set
// ============================================

router.get('/preferences/v2', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const profile = await prisma.buyerProfile.findFirst({
            where: { userId: req.user!.id },
            include: {
                preferenceSets: {
                    orderBy: { priority: 'asc' },
                    include: {
                        fieldFilters: {
                            where: { isActive: true },
                            include: { verticalField: { select: { key: true } } },
                        },
                    },
                },
            },
        } as any);

        if (!profile) {
            res.json({ sets: [] });
            return;
        }

        // Map BuyerFieldFilter rows → frontend-friendly Record<fieldKey, {op, value}>
        const OP_REVERSE: Record<string, string> = {
            EQUALS: '==', NOT_EQUALS: '!=', IN: 'includes', NOT_IN: '!includes',
            GT: '>', GTE: '>=', LT: '<', LTE: '<=',
            BETWEEN: 'between', CONTAINS: 'contains', STARTS_WITH: 'startsWith',
        };

        res.json({
            sets: (profile as any).preferenceSets.map((s: any) => {
                // Build fieldFilters hash from DB rows
                const fieldFilters: Record<string, { op: string; value: string }> = {};
                if (s.fieldFilters) {
                    for (const ff of s.fieldFilters) {
                        const key = ff.verticalField?.key;
                        if (key) {
                            fieldFilters[key] = {
                                op: OP_REVERSE[ff.operator] || '==',
                                value: ff.value,
                            };
                        }
                    }
                }
                return {
                    id: s.id,
                    label: s.label,
                    vertical: s.vertical,
                    priority: s.priority,
                    geoCountries: s.geoCountries,
                    geoInclude: s.geoInclude,
                    geoExclude: s.geoExclude,
                    maxBidPerLead: s.maxBidPerLead ? Number(s.maxBidPerLead) : undefined,
                    dailyBudget: s.dailyBudget ? Number(s.dailyBudget) : undefined,
                    autoBidEnabled: s.autoBidEnabled,
                    autoBidAmount: s.autoBidAmount ? Number(s.autoBidAmount) : undefined,
                    minQualityScore: s.minQualityScore ?? undefined,
                    excludedSellerIds: s.excludedSellerIds,
                    preferredSellerIds: s.preferredSellerIds,
                    minSellerReputation: s.minSellerReputation ?? undefined,
                    requireVerifiedSeller: s.requireVerifiedSeller,
                    acceptOffSite: s.acceptOffSite,
                    requireVerified: s.requireVerified,
                    isActive: s.isActive,
                    fieldFilters,
                };
            }),
        });
    } catch (error) {
        console.error('Get preference sets error:', error);
        res.status(500).json({ error: 'Failed to get preference sets' });
    }
});

router.put('/preferences/v2', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = BuyerPreferencesV2Schema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid preferences', details: validation.error.issues });
            return;
        }

        const { preferenceSets } = validation.data;

        // Ensure buyer profile exists
        const profile = await prisma.buyerProfile.upsert({
            where: { userId: req.user!.id },
            create: { userId: req.user!.id },
            update: {},
        });

        // Get existing set IDs
        const existingSets = await prisma.buyerPreferenceSet.findMany({
            where: { buyerProfileId: profile.id },
            select: { id: true },
        });
        const existingIds = new Set(existingSets.map((s) => s.id));

        // Determine which IDs to keep (ones in the payload with an id)
        const incomingIds = new Set(preferenceSets.filter((s) => s.id).map((s) => s.id!));
        const idsToDelete = [...existingIds].filter((id) => !incomingIds.has(id));

        // Map frontend operators to Prisma FilterOperator enum
        const OP_MAP: Record<string, string> = {
            '==': 'EQUALS', '!=': 'NOT_EQUALS',
            'includes': 'IN', '!includes': 'NOT_IN',
            '>': 'GT', '>=': 'GTE', '<': 'LT', '<=': 'LTE',
            'between': 'BETWEEN', 'contains': 'CONTAINS', 'startsWith': 'STARTS_WITH',
        };

        // Run upserts + deletes in a transaction
        await prisma.$transaction(async (tx) => {
            // Delete removed sets (cascades to BuyerFieldFilter)
            if (idsToDelete.length > 0) {
                await tx.buyerPreferenceSet.deleteMany({
                    where: { id: { in: idsToDelete } },
                });
            }

            // Upsert each set
            for (const set of preferenceSets) {
                const setData = {
                    label: set.label,
                    vertical: set.vertical,
                    priority: set.priority,
                    geoCountries: set.geoCountries,
                    geoInclude: set.geoInclude,
                    geoExclude: set.geoExclude,
                    maxBidPerLead: set.maxBidPerLead,
                    dailyBudget: set.dailyBudget,
                    autoBidEnabled: set.autoBidEnabled,
                    autoBidAmount: set.autoBidAmount,
                    minQualityScore: set.minQualityScore,
                    excludedSellerIds: set.excludedSellerIds,
                    preferredSellerIds: set.preferredSellerIds,
                    minSellerReputation: set.minSellerReputation,
                    requireVerifiedSeller: set.requireVerifiedSeller,
                    acceptOffSite: set.acceptOffSite,
                    requireVerified: set.requireVerified,
                    isActive: set.isActive,
                };

                let prefSetId: string;
                if (set.id && existingIds.has(set.id)) {
                    await tx.buyerPreferenceSet.update({
                        where: { id: set.id },
                        data: setData,
                    });
                    prefSetId = set.id;
                } else {
                    const created = await tx.buyerPreferenceSet.create({
                        data: { buyerProfileId: profile.id, ...setData },
                    });
                    prefSetId = created.id;
                }

                // ── Sync BuyerFieldFilter rows ──
                // Frontend sends: fieldFilters: { [fieldKey]: { op, value } }
                const fieldFilters = (set as any).fieldFilters as Record<string, { op: string; value: string }> | undefined;

                // Delete all existing filters for this set, then recreate
                await (tx as any).buyerFieldFilter.deleteMany({
                    where: { preferenceSetId: prefSetId },
                });

                if (fieldFilters && Object.keys(fieldFilters).length > 0) {
                    // Resolve field keys → VerticalField IDs
                    const vertical = await tx.vertical.findUnique({
                        where: { slug: set.vertical },
                        select: { id: true },
                    });

                    if (vertical) {
                        const vFields = await (tx as any).verticalField.findMany({
                            where: {
                                verticalId: vertical.id,
                                key: { in: Object.keys(fieldFilters) },
                                isBiddable: true,
                                isPii: false,
                            },
                            select: { id: true, key: true },
                        });
                        const keyToId = new Map(vFields.map((f: any) => [f.key, f.id]));

                        for (const [fieldKey, filter] of Object.entries(fieldFilters)) {
                            const verticalFieldId = keyToId.get(fieldKey);
                            if (!verticalFieldId) continue; // Skip unknown/non-biddable fields

                            const operator = OP_MAP[filter.op] || 'EQUALS';
                            await (tx as any).buyerFieldFilter.create({
                                data: {
                                    preferenceSetId: prefSetId,
                                    verticalFieldId,
                                    operator,
                                    value: filter.value,
                                    isActive: true,
                                },
                            });
                        }
                    }
                }
            }

            // Sync flat verticals for backward compatibility
            const uniqueVerticals = [...new Set(preferenceSets.map((s) => s.vertical))];
            await tx.buyerProfile.update({
                where: { id: profile.id },
                data: { verticals: uniqueVerticals },
            });
        });

        res.json({ success: true, message: 'Preference sets updated' });
    } catch (error) {
        const classified = classifyPrismaError(error);
        console.error('[PREFS-V2] Update preference sets error:', {
            userId: req.user?.id,
            setCount: req.body?.preferenceSets?.length,
            code: classified.code,
            message: classified.message,
            raw: error instanceof Error ? error.message : error,
        });
        res.status(classified.status).json({ error: classified.message, code: classified.code });
    }
});

// ============================================
// Auto-Bid Evaluation (Manual Trigger)
// ============================================

router.post('/auto-bid/evaluate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { leadId } = req.body;
        if (!leadId) {
            res.status(400).json({ error: 'leadId is required' });
            return;
        }

        const lead = await prisma.lead.findUnique({ where: { id: leadId } });
        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }

        const geo = lead.geo as any;
        const leadData: LeadData = {
            id: lead.id,
            vertical: lead.vertical,
            geo: {
                country: geo?.country || 'US',
                state: geo?.state || geo?.region,
                city: geo?.city,
                zip: geo?.zip,
            },
            source: lead.source,
            qualityScore: (lead as any).qualityScore ?? null,
            isVerified: lead.isVerified ?? false,
            reservePrice: Number(lead.reservePrice ?? 0),
        };

        const result = await evaluateLeadForAutoBid(leadData);
        res.json(result);
    } catch (error) {
        console.error('Auto-bid evaluate error:', error);
        res.status(500).json({ error: 'Failed to evaluate auto-bid' });
    }
});

// ============================================
// USDC Allowance Status (for auto-bid escrow)
// ============================================

const USDC_ADDRESS = process.env.USDC_CONTRACT_ADDRESS || '';
const ESCROW_ADDRESS = process.env.RTB_ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.ESCROW_CONTRACT_ADDRESS || '';
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';

const USDC_READ_ABI = [
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
];

router.get('/buyer/usdc-allowance', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // TD-04 fix: use the session wallet (from JWT), not the DB record.
        // This ensures the check targets the MetaMask wallet the user actually
        // signed in with, even if their DB record still has an old demo wallet.
        const walletAddress = req.user!.walletAddress;

        if (!walletAddress) {
            res.status(400).json({ error: 'No wallet address in session' });
            return;
        }

        if (!USDC_ADDRESS || !ESCROW_ADDRESS) {
            // Off-chain mode — return zero allowance
            res.json({
                allowance: '0',
                balance: '0',
                escrowAddress: ESCROW_ADDRESS || null,
                usdcAddress: USDC_ADDRESS || null,
                offChain: true,
            });
            return;
        }

        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const usdc = new ethers.Contract(USDC_ADDRESS, USDC_READ_ABI, provider);

        const [allowanceRaw, balanceRaw] = await Promise.all([
            usdc.allowance(walletAddress, ESCROW_ADDRESS),
            usdc.balanceOf(walletAddress),
        ]);

        res.json({
            allowance: ethers.formatUnits(allowanceRaw, 6),
            balance: ethers.formatUnits(balanceRaw, 6),
            escrowAddress: ESCROW_ADDRESS,
            usdcAddress: USDC_ADDRESS,
            offChain: false,
        });
    } catch (error: any) {
        console.error('USDC allowance check error:', error);
        res.status(500).json({ error: 'Failed to check USDC allowance', details: error.message });
    }
});

export default router;
