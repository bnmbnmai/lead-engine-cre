/**
 * Bounty Service — Per-vertical buyer bounty pool management
 *
 * Buyers fund standing USDC escrow pools per vertical with optional criteria filters.
 * When a matching lead is won at auction, the bounty auto-releases to the seller
 * as a bonus on top of the winning bid. Unmatched funds refund to the buyer.
 *
 * On-chain: VerticalBountyPool.sol (deposit/release/withdraw)
 * Matching: Chainlink Functions via BountyMatcher.sol (when enabled), else in-memory
 * Off-chain: Criteria matching engine (geo, QS, credit) + formConfig.bountyConfig storage
 */

import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { isVrfConfigured, requestTieBreak, waitForResolution, ResolveType } from './vrf.service';
import {
    isFunctionsConfigured,
    requestBountyMatch,
    waitForMatchResult,
} from './functions.service';

// ============================================
// Types & Schemas
// ============================================

export const BountyCriteriaSchema = z.object({
    minQualityScore: z.number().min(0).max(10000).optional(),
    geoStates: z.array(z.string().length(2)).max(50).optional(),
    geoCountries: z.array(z.string().length(2)).max(10).optional(),
    minCreditScore: z.number().min(300).max(850).optional(),
    maxLeadAge: z.number().min(1).max(168).optional(), // hours
});

export const BountyDepositSchema = z.object({
    amount: z.number().min(10).max(10000),
    criteria: BountyCriteriaSchema.optional(),
});

export type BountyCriteria = z.infer<typeof BountyCriteriaSchema>;

export interface BountyResult {
    success: boolean;
    poolId?: string;
    txHash?: string;
    error?: string;
    offChain?: boolean;
}

export interface MatchedBounty {
    poolId: string;
    buyerId: string;
    buyerWallet: string;
    amount: number;
    verticalSlug: string;
    criteria?: BountyCriteria;
}

// ============================================
// Contract ABI
// ============================================

const BOUNTY_POOL_ABI = [
    'function depositBounty(bytes32 verticalSlugHash, uint256 amount) returns (uint256)',
    'function topUpBounty(uint256 poolId, uint256 amount)',
    'function releaseBounty(uint256 poolId, address recipient, uint256 amount, string calldata leadId)',
    'function withdrawBounty(uint256 poolId, uint256 amount)',
    'function availableBalance(uint256 poolId) view returns (uint256)',
    'function getVerticalPoolIds(bytes32 verticalSlugHash) view returns (uint256[])',
    'function totalVerticalBounty(bytes32 verticalSlugHash) view returns (uint256)',
    'function pools(uint256) view returns (address buyer, bytes32 verticalSlugHash, uint256 totalDeposited, uint256 totalReleased, uint40 createdAt, bool active)',
];

// ============================================
// Constants
// ============================================

/** Bounty stacking cap: max total bounty = 2× lead price */
const BOUNTY_STACKING_CAP_MULTIPLIER = 2;

/** Toggle Chainlink Functions-based matching (env: BOUNTY_FUNCTIONS_ENABLED=true) */
const FUNCTIONS_MATCHING_ENABLED = process.env.BOUNTY_FUNCTIONS_ENABLED === 'true';

// ============================================
// Service
// ============================================

const BOUNTY_POOL_ADDRESS = process.env.BOUNTY_POOL_ADDRESS || '';
const RPC_URL = process.env.BASE_SEPOLIA_RPC || process.env.RPC_URL || '';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

class BountyService {
    private provider: ethers.JsonRpcProvider | null = null;
    private contract: ethers.Contract | null = null;
    private signer: ethers.Wallet | null = null;

    // In-memory TTL cache for vertical bounty totals (key: slug, value: { total, expiresAt })
    private totalCache = new Map<string, { value: number; expiresAt: number }>();
    private readonly CACHE_TTL_MS = 60_000; // 60 seconds

    constructor() {
        if (BOUNTY_POOL_ADDRESS && RPC_URL && DEPLOYER_KEY) {
            try {
                this.provider = new ethers.JsonRpcProvider(RPC_URL);
                this.signer = new ethers.Wallet(DEPLOYER_KEY, this.provider);
                this.contract = new ethers.Contract(BOUNTY_POOL_ADDRESS, BOUNTY_POOL_ABI, this.signer);
                console.log('[BountyService] Initialized with contract:', BOUNTY_POOL_ADDRESS);
            } catch (err) {
                console.warn('[BountyService] Failed to initialize on-chain:', err);
            }
        } else {
            console.log('[BountyService] No contract configured — off-chain mode');
        }
    }

    // ============================================
    // Deposit — Buyer funds a bounty pool
    // ============================================

    async depositBounty(
        buyerId: string,
        verticalSlug: string,
        amountUSDC: number,
        criteria?: BountyCriteria,
        buyerWallet?: string
    ): Promise<BountyResult> {
        try {
            const vertical = await prisma.vertical.findUnique({ where: { slug: verticalSlug } });
            if (!vertical) return { success: false, error: 'Vertical not found' };

            const slugHash = ethers.keccak256(ethers.toUtf8Bytes(verticalSlug));

            // On-chain deposit first (fail fast if on-chain fails)
            let poolId: string;
            let txHash: string | undefined;
            let offChain = false;

            if (this.contract && this.signer) {
                const amountWei = ethers.parseUnits(amountUSDC.toString(), 6);
                const tx = await this.contract.depositBounty(slugHash, amountWei);
                const receipt = await tx.wait();
                poolId = receipt.logs?.[0]?.args?.[0]?.toString() || '0';
                txHash = receipt.hash;
                console.log(`[BountyService] Buyer deposited $${amountUSDC} on ${verticalSlug}, pool ${poolId}, tx: ${txHash}`);
            } else {
                poolId = randomUUID();
                offChain = true;
                console.log(`[BountyService] Buyer deposited (off-chain) $${amountUSDC} on ${verticalSlug}`);
            }

            // Save bounty config in formConfig.bountyPools WITH poolId
            const existingConfig = (vertical.formConfig as any) || {};
            const existingBounties = existingConfig.bountyPools || [];

            const poolEntry = {
                poolId,
                buyerId,
                buyerWallet: buyerWallet || '',
                amount: amountUSDC,
                totalReleased: 0,
                criteria: criteria || {},
                createdAt: new Date().toISOString(),
                active: true,
            };

            await prisma.vertical.update({
                where: { slug: verticalSlug },
                data: {
                    formConfig: {
                        ...existingConfig,
                        bountyPools: [...existingBounties, poolEntry],
                    },
                },
            });

            return { success: true, poolId, txHash, offChain };
        } catch (err: any) {
            console.error('[BountyService] depositBounty error:', err);
            return { success: false, error: err.message || 'Deposit failed' };
        } finally {
            this.invalidateCache(verticalSlug);
        }
    }

    // ============================================
    // Match — Find buyer bounties matching a lead
    // ============================================

    /**
     * Match active buyer bounty pools to a lead.
     * Returns matched bounties sorted by amount descending.
     *
     * @param lead - The lead to match against (must include vertical, qualityScore, state, etc.)
     * @param leadPrice - Override price for stacking cap (defaults to lead.reservePrice).
     *                    Pass the winning bid amount for accurate cap calculation.
     */
    async matchBounties(lead: {
        id: string;
        vertical?: string;
        qualityScore?: number | null;
        state?: string | null;
        country?: string | null;
        parameters?: any;
        createdAt?: Date;
        reservePrice?: number | null;
    }, leadPrice?: number): Promise<MatchedBounty[]> {
        if (!lead.vertical) return [];

        try {
            const vertical = await prisma.vertical.findUnique({
                where: { slug: lead.vertical },
                select: { formConfig: true, slug: true },
            });

            if (!vertical) return [];

            const config = (vertical.formConfig as any) || {};
            const pools: any[] = config.bountyPools || [];

            const matched: MatchedBounty[] = [];
            let functionsAttempted = false;

            for (const pool of pools) {
                if (!pool.active) continue;

                // Available balance = deposited amount - total released so far
                const availableAmount = (pool.amount || 0) - (pool.totalReleased || 0);
                if (availableAmount <= 0) continue;

                const criteria: BountyCriteria = pool.criteria || {};

                // ── Chainlink Functions Matching ──
                // If Functions is enabled and configured, send criteria to the DON
                // for on-chain attested matching. Falls back to in-memory if unavailable.
                if (FUNCTIONS_MATCHING_ENABLED && isFunctionsConfigured() && lead.id) {
                    // Only run Functions once — it evaluates all pools in one DON call
                    if (!functionsAttempted) {
                        functionsAttempted = true;
                        try {
                            const activePools = pools.filter((p: any) => p.active && ((p.amount || 0) - (p.totalReleased || 0)) > 0);
                            const criteriaList = activePools.map((p: any) => ({
                                poolId: p.poolId || p.buyerId,
                                ...((p.criteria || {}) as BountyCriteria),
                            }));
                            const leadAgeHours = lead.createdAt
                                ? (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60)
                                : 0;

                            const txHash = await requestBountyMatch(lead.id, {
                                qualityScore: lead.qualityScore || 0,
                                creditScore: lead.parameters?.creditScore || 0,
                                geoState: lead.state || '',
                                geoCountry: lead.country || '',
                                leadAgeHours,
                            }, criteriaList);

                            if (txHash) {
                                const functionsResult = await waitForMatchResult(lead.id, 30_000);
                                if (functionsResult?.matchFound) {
                                    // Use Functions-attested pool IDs for matching
                                    const verifiedPoolIds = new Set(functionsResult.matchedPoolIds);
                                    for (const p of activePools) {
                                        const pid = p.poolId || p.buyerId;
                                        if (verifiedPoolIds.has(pid)) {
                                            const avail = (p.amount || 0) - (p.totalReleased || 0);
                                            matched.push({
                                                poolId: pid,
                                                buyerId: p.buyerId,
                                                buyerWallet: p.buyerWallet || '',
                                                amount: avail,
                                                verticalSlug: vertical.slug,
                                                criteria: p.criteria || {},
                                            });
                                        }
                                    }
                                    console.log(`[BountyService] Functions-matched ${matched.length} pools for lead ${lead.id}`);
                                    // Sort and skip to VRF/cap (bypass in-memory matching)
                                    matched.sort((a, b) => b.amount - a.amount);
                                    break; // break out of the pool loop — we've matched via Functions
                                }
                            }
                        } catch (err) {
                            console.warn('[BountyService] Functions matching failed, falling back to in-memory');
                        }
                    }
                    continue; // Skip in-memory matching when Functions is enabled
                }

                // ── In-Memory Criteria Matching (fallback) ──

                // Criteria matching engine (AND logic — all criteria must pass)
                if (criteria.minQualityScore != null && (lead.qualityScore || 0) < criteria.minQualityScore) continue;
                if (criteria.geoStates?.length && !criteria.geoStates.includes(lead.state || '')) continue;
                if (criteria.geoCountries?.length && !criteria.geoCountries.includes(lead.country || '')) continue;
                if (criteria.minCreditScore != null) {
                    const creditScore = lead.parameters?.creditScore || 0;
                    if (creditScore < criteria.minCreditScore) continue;
                }
                if (criteria.maxLeadAge != null && lead.createdAt) {
                    const ageHours = (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60);
                    if (ageHours > criteria.maxLeadAge) continue;
                }

                matched.push({
                    poolId: pool.poolId || pool.buyerId,
                    buyerId: pool.buyerId,
                    buyerWallet: pool.buyerWallet || '',
                    amount: availableAmount,
                    verticalSlug: vertical.slug,
                    criteria,
                });
            }

            // Sort by amount descending (highest bounty first)
            matched.sort((a, b) => b.amount - a.amount);

            // ── VRF Bounty Allocation ──
            // If 2+ pools tie on amount, use Chainlink VRF to fairly order them
            if (matched.length >= 2) {
                const topAmount = matched[0].amount;
                const tiedPools = matched.filter(m => m.amount === topAmount);

                if (tiedPools.length >= 2 && isVrfConfigured() && lead.id) {
                    const candidates = tiedPools
                        .map(p => p.buyerWallet)
                        .filter(w => !!w);

                    if (candidates.length >= 2) {
                        try {
                            const bountyLeadId = `bounty-${lead.id}`;
                            const txHash = await requestTieBreak(bountyLeadId, candidates, ResolveType.BOUNTY_ALLOCATION);
                            if (txHash) {
                                const vrfWinner = await waitForResolution(bountyLeadId, 15_000);
                                if (vrfWinner) {
                                    // Move VRF-selected pool to front of tied group
                                    const winnerIdx = tiedPools.findIndex(
                                        p => p.buyerWallet.toLowerCase() === vrfWinner.toLowerCase()
                                    );
                                    if (winnerIdx > 0) {
                                        const [winner] = tiedPools.splice(winnerIdx, 1);
                                        tiedPools.unshift(winner);
                                        // Reconstruct matched array: VRF-reordered ties first, rest after
                                        const rest = matched.filter(m => m.amount !== topAmount);
                                        matched.length = 0;
                                        matched.push(...tiedPools, ...rest);
                                    }
                                    console.log(`[BountyService] VRF allocated bounty priority to ${vrfWinner}`);
                                }
                            }
                        } catch (err) {
                            console.warn('[BountyService] VRF bounty allocation failed, using default order');
                        }
                    }
                }
            }

            // Apply stacking cap: total bounty ≤ 2× lead price
            // Use explicit leadPrice (winning bid) if provided, else fall back to reservePrice
            const effectivePrice = leadPrice ?? (lead.reservePrice ? Number(lead.reservePrice) : 0);
            if (effectivePrice > 0) {
                const cap = effectivePrice * BOUNTY_STACKING_CAP_MULTIPLIER;
                let runningTotal = 0;
                const capped: MatchedBounty[] = [];

                for (const m of matched) {
                    if (runningTotal >= cap) break;
                    const allowed = Math.min(m.amount, cap - runningTotal);
                    capped.push({ ...m, amount: allowed });
                    runningTotal += allowed;
                }

                return capped;
            }

            return matched;
        } catch (err) {
            console.error('[BountyService] matchBounties error:', err);
            return [];
        }
    }

    // ============================================
    // Release — On-chain release from pool to seller
    // ============================================

    async releaseBounty(
        poolId: string,
        leadId: string,
        recipientAddress: string,
        amountUSDC: number,
        verticalSlug?: string
    ): Promise<BountyResult> {
        try {
            // On-chain release (only for numeric pool IDs from the contract)
            const isOnChainPool = /^\d+$/.test(poolId);
            if (this.contract && this.signer && isOnChainPool) {
                const amountWei = ethers.parseUnits(amountUSDC.toString(), 6);
                const tx = await this.contract.releaseBounty(
                    BigInt(poolId), recipientAddress, amountWei, leadId
                );
                const receipt = await tx.wait();
                console.log(`[BountyService] Released $${amountUSDC} from pool ${poolId} to seller for lead ${leadId}`);

                // Update off-chain tracking
                if (verticalSlug) {
                    await this.updatePoolReleased(verticalSlug, poolId, amountUSDC);
                }

                return { success: true, txHash: receipt.hash };
            }

            // Off-chain release
            console.log(`[BountyService] Released (off-chain) $${amountUSDC} from pool ${poolId} for lead ${leadId}`);

            // Update off-chain tracking
            if (verticalSlug) {
                await this.updatePoolReleased(verticalSlug, poolId, amountUSDC);
            }

            return { success: true, offChain: true };
        } catch (err: any) {
            console.error('[BountyService] releaseBounty error:', err);
            return { success: false, error: err.message || 'Release failed' };
        } finally {
            if (verticalSlug) this.invalidateCache(verticalSlug);
        }
    }

    // ============================================
    // Withdraw — Buyer reclaims unreleased funds
    // ============================================

    async withdrawBounty(
        poolId: string,
        amountUSDC?: number
    ): Promise<BountyResult> {
        try {
            const isOnChainPool = /^\d+$/.test(poolId);
            if (this.contract && this.signer && isOnChainPool) {
                const amountWei = amountUSDC
                    ? ethers.parseUnits(amountUSDC.toString(), 6)
                    : BigInt(0); // 0 = withdraw all
                const tx = await this.contract.withdrawBounty(BigInt(poolId), amountWei);
                const receipt = await tx.wait();
                console.log(`[BountyService] Buyer withdrew from pool ${poolId}`);
                return { success: true, txHash: receipt.hash };
            }

            console.log(`[BountyService] Buyer withdrew (off-chain) from pool ${poolId}`);
            return { success: true, offChain: true };
        } catch (err: any) {
            console.error('[BountyService] withdrawBounty error:', err);
            return { success: false, error: err.message || 'Withdraw failed' };
        }
    }

    // ============================================
    // View — Total bounty for a vertical
    // ============================================

    async getVerticalBountyTotal(verticalSlug: string): Promise<number> {
        // Check cache first
        const cached = this.getCached(verticalSlug);
        if (cached !== null) return cached;

        let result: number;
        try {
            if (this.contract) {
                const slugHash = ethers.keccak256(ethers.toUtf8Bytes(verticalSlug));
                const totalWei = await this.contract.totalVerticalBounty(slugHash);
                return Number(ethers.formatUnits(totalWei, 6));
            }

            // Off-chain: sum available balance (amount - totalReleased) from formConfig
            const vertical = await prisma.vertical.findUnique({
                where: { slug: verticalSlug },
                select: { formConfig: true },
            });

            const config = (vertical?.formConfig as any) || {};
            const pools: any[] = config.bountyPools || [];
            result = pools
                .filter((p: any) => p.active)
                .reduce((sum: number, p: any) => sum + Math.max(0, (p.amount || 0) - (p.totalReleased || 0)), 0);
        } catch {
            return 0;
        }

        // Populate cache
        this.totalCache.set(verticalSlug, {
            value: result,
            expiresAt: Date.now() + this.CACHE_TTL_MS,
        });
        return result;
    }

    // ============================================
    // Internal — Update off-chain release tracking
    // ============================================

    private async updatePoolReleased(verticalSlug: string, poolId: string, releasedAmount: number): Promise<void> {
        try {
            const vertical = await prisma.vertical.findUnique({
                where: { slug: verticalSlug },
                select: { formConfig: true },
            });
            if (!vertical) return;

            const config = (vertical.formConfig as any) || {};
            const pools: any[] = config.bountyPools || [];

            const updatedPools = pools.map((p: any) => {
                if (p.poolId === poolId) {
                    const newTotalReleased = (p.totalReleased || 0) + releasedAmount;
                    const active = newTotalReleased < (p.amount || 0);
                    return { ...p, totalReleased: newTotalReleased, active };
                }
                return p;
            });

            await prisma.vertical.update({
                where: { slug: verticalSlug },
                data: { formConfig: { ...config, bountyPools: updatedPools } },
            });
        } catch (err) {
            console.error('[BountyService] updatePoolReleased error:', err);
        }
    }

    // ============================================
    // Internal — Cache helpers
    // ============================================

    private getCached(slug: string): number | null {
        const entry = this.totalCache.get(slug);
        if (entry && entry.expiresAt > Date.now()) return entry.value;
        if (entry) this.totalCache.delete(slug);
        return null;
    }

    /** Invalidate cache for a vertical slug */
    invalidateCache(slug: string): void {
        this.totalCache.delete(slug);
    }
}

export const bountyService = new BountyService();
