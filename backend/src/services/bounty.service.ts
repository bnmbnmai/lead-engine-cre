/**
 * Bounty Service — Per-vertical buyer bounty pool management
 *
 * Buyers fund standing USDC escrow pools per vertical with optional criteria filters.
 * When a matching lead is won at auction, the bounty auto-releases to the seller
 * as a bonus on top of the winning bid. Unmatched funds refund to the buyer.
 *
 * On-chain: VerticalBountyPool.sol (deposit/release/withdraw)
 * Off-chain: Criteria matching engine (geo, QS, credit) + formConfig.bountyConfig storage
 */

import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';
import { z } from 'zod';

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
        criteria?: BountyCriteria
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
                poolId = `offchain-${Date.now()}`;
                offChain = true;
                console.log(`[BountyService] Buyer deposited (off-chain) $${amountUSDC} on ${verticalSlug}`);
            }

            // Save bounty config in formConfig.bountyPools WITH poolId
            const existingConfig = (vertical.formConfig as any) || {};
            const existingBounties = existingConfig.bountyPools || [];

            const poolEntry = {
                poolId,
                buyerId,
                amount: amountUSDC,
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
        }
    }

    // ============================================
    // Match — Find buyer bounties matching a lead
    // ============================================

    /**
     * Match active buyer bounty pools to a lead.
     * Returns matched bounties sorted by amount descending.
     * If leadPrice is provided, caps total bounty at 2× lead price (stacking cap).
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
    }): Promise<MatchedBounty[]> {
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

            for (const pool of pools) {
                if (!pool.active) continue;

                const criteria: BountyCriteria = pool.criteria || {};

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
                    amount: pool.amount,
                    verticalSlug: vertical.slug,
                    criteria,
                });
            }

            // Sort by amount descending (highest bounty first)
            matched.sort((a, b) => b.amount - a.amount);

            // Apply stacking cap: total bounty ≤ 2× lead price
            const leadPrice = lead.reservePrice || 0;
            if (leadPrice > 0) {
                const cap = leadPrice * BOUNTY_STACKING_CAP_MULTIPLIER;
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
        amountUSDC: number
    ): Promise<BountyResult> {
        try {
            if (this.contract && this.signer) {
                const amountWei = ethers.parseUnits(amountUSDC.toString(), 6);
                const tx = await this.contract.releaseBounty(
                    BigInt(poolId), recipientAddress, amountWei, leadId
                );
                const receipt = await tx.wait();
                console.log(`[BountyService] Released $${amountUSDC} from pool ${poolId} to seller for lead ${leadId}`);
                return { success: true, txHash: receipt.hash };
            }

            // Off-chain fallback
            console.log(`[BountyService] Released (off-chain) $${amountUSDC} from pool ${poolId}`);
            return { success: true, offChain: true };
        } catch (err: any) {
            console.error('[BountyService] releaseBounty error:', err);
            return { success: false, error: err.message || 'Release failed' };
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
            if (this.contract && this.signer) {
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
        try {
            if (this.contract) {
                const slugHash = ethers.keccak256(ethers.toUtf8Bytes(verticalSlug));
                const totalWei = await this.contract.totalVerticalBounty(slugHash);
                return Number(ethers.formatUnits(totalWei, 6));
            }

            // Off-chain: sum from formConfig
            const vertical = await prisma.vertical.findUnique({
                where: { slug: verticalSlug },
                select: { formConfig: true },
            });

            const config = (vertical?.formConfig as any) || {};
            const pools: any[] = config.bountyPools || [];
            return pools
                .filter((p: any) => p.active)
                .reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
        } catch {
            return 0;
        }
    }
}

export const bountyService = new BountyService();
