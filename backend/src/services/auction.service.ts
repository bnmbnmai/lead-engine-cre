/**
 * Auction Service
 *
 * Backend service for VerticalAuction lifecycle:
 *   createAuction → placeBid → settleAuction → getActiveAuctions
 *
 * On-chain calls use ethers.js against VerticalAuction.sol.
 * Prisma stores auction state for fast reads / marketplace queries.
 */

import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';
import { invalidateAllForResale } from '../lib/cache';
import {
    applyHolderPerks,
    applyMultiplier,
    checkActivityThreshold,
    computePrePing,
    isInPrePingWindow,
    HolderPerks,
} from './holder-perks.service';
import {
    NFT_AUCTION_DURATION_SECS,
    LEAD_AUCTION_DURATION_SECS,
    AUTO_EXTEND_INCREMENT_SECS,
    AUTO_EXTEND_MAX,
    SPAM_THRESHOLD_BIDS_PER_MINUTE,
} from '../config/perks.env';

// ============================================
// Contract Config
// ============================================

const VERTICAL_AUCTION_ABI = [
    'function createAuction(address nftContract, uint256 tokenId, bytes32 slug, uint128 reservePrice, uint40 duration) external returns (uint256)',
    'function placeBid(uint256 auctionId) external payable',
    'function settleAuction(uint256 auctionId) external',
    'function cancelAuction(uint256 auctionId) external',
    'function getAuction(uint256 auctionId) external view returns (tuple(uint256 tokenId, address nftContract, address seller, uint128 reservePrice, uint40 startTime, uint40 endTime, address highBidder, uint128 highBid, bool settled, bool cancelled))',
    'function isAuctionActive(uint256 auctionId) external view returns (bool)',
    'function nextAuctionId() external view returns (uint256)',
] as const;

const RPC_URL = process.env.RPC_URL || process.env.ALCHEMY_RPC_URL || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const AUCTION_CONTRACT_ADDRESS = process.env.VERTICAL_AUCTION_ADDRESS || '';
const NFT_CONTRACT_ADDRESS = process.env.VERTICAL_NFT_ADDRESS || '';

// ============================================
// Provider + Contract
// ============================================

function getProvider() {
    return new ethers.JsonRpcProvider(RPC_URL);
}

function getWallet() {
    if (!DEPLOYER_KEY) throw new Error('DEPLOYER_PRIVATE_KEY not set');
    return new ethers.Wallet(DEPLOYER_KEY, getProvider());
}

function getAuctionContract(signerOrProvider?: ethers.Signer | ethers.Provider) {
    if (!AUCTION_CONTRACT_ADDRESS) return null;
    return new ethers.Contract(
        AUCTION_CONTRACT_ADDRESS,
        VERTICAL_AUCTION_ABI,
        signerOrProvider || getProvider(),
    );
}

// ============================================
// Create Auction
// ============================================

export interface CreateAuctionResult {
    success: boolean;
    auctionId?: number;
    txHash?: string;
    startTime?: string;
    endTime?: string;
    error?: string;
}

/**
 * Create an auction for a platform-owned vertical NFT.
 *
 * Duration is clamped to 60s (LEAD_AUCTION_DURATION_SECS).
 * If omitted, defaults to LEAD_AUCTION_DURATION_SECS (60s).
 */
export async function createAuction(
    slug: string,
    reservePrice: number,
    durationSecs: number = LEAD_AUCTION_DURATION_SECS,
): Promise<CreateAuctionResult> {
    // Clamp duration to configured bounds
    durationSecs = Math.max(60, Math.min(durationSecs, LEAD_AUCTION_DURATION_SECS));
    // 1. Look up vertical
    const vertical = await prisma.vertical.findUnique({ where: { slug } });
    if (!vertical) {
        return { success: false, error: `Vertical "${slug}" not found` };
    }
    if (!vertical.nftTokenId) {
        return { success: false, error: `Vertical "${slug}" has no minted NFT` };
    }

    // 2. Try on-chain auction creation
    const contract = getAuctionContract();
    let txHash = '';
    let onChainAuctionId: number | null = null;

    if (contract) {
        try {
            const wallet = getWallet();
            const connectedContract = contract.connect(wallet) as ethers.Contract;
            const reserveWei = ethers.parseEther(reservePrice.toString());
            const tx = await connectedContract.createAuction(
                NFT_CONTRACT_ADDRESS,
                vertical.nftTokenId,
                ethers.id(slug), // bytes32 slug for on-chain holder verification
                reserveWei,
                durationSecs,
            );
            const receipt = await tx.wait();
            txHash = receipt.hash;

            // Parse AuctionCreated event for the auction ID
            const nextId = await contract.nextAuctionId();
            onChainAuctionId = Number(nextId) - 1;
        } catch (error: any) {
            console.warn('[AUCTION] On-chain creation failed, storing off-chain only:', error.message);
        }
    }

    // 3. Store in Prisma
    const now = new Date();
    const endTime = new Date(now.getTime() + durationSecs * 1000);

    // 4. Compute pre-ping window with per-auction nonce for unpredictability
    const nonce = require('crypto').randomBytes(8).toString('hex');
    const prePingSeconds = computePrePing(slug, nonce);
    const prePingEndsAt = new Date(now.getTime() + prePingSeconds * 1000);

    try {
        const auctionRecord = await prisma.verticalAuction.create({
            data: {
                verticalSlug: slug,
                tokenId: vertical.nftTokenId,
                auctionId: onChainAuctionId,
                reservePrice,
                startTime: now,
                endTime,
                prePingEndsAt,
                prePingNonce: nonce, // Persist nonce for audit trail / recomputation
                txHash: txHash || undefined,
            },
        });

        console.log(`[AUCTION] Created auction for "${slug}" (ID: ${auctionRecord.id}, ends: ${endTime.toISOString()})`);

        return {
            success: true,
            auctionId: onChainAuctionId ?? undefined,
            txHash: txHash || undefined,
            startTime: now.toISOString(),
            endTime: endTime.toISOString(),
        };
    } catch (error: any) {
        return { success: false, error: `Database error: ${error.message}` };
    }
}

// ============================================
// Place Bid
// ============================================

export interface BidResult {
    success: boolean;
    txHash?: string;
    currentHighBid?: number;
    holderPerks?: { prePingSeconds: number; multiplier: number; effectiveBid: number };
    error?: string;
}

/**
 * Place a bid on an active auction.
 */
export async function placeBid(
    auctionDbId: string,
    bidderAddress: string,
    bidAmount: number,
): Promise<BidResult> {
    // 1. Fetch auction from Prisma
    const auction = await prisma.verticalAuction.findUnique({ where: { id: auctionDbId } });
    if (!auction) {
        return { success: false, error: 'Auction not found' };
    }
    if (auction.settled || auction.cancelled) {
        return { success: false, error: 'Auction is no longer active' };
    }

    const now = new Date();
    if (now > auction.endTime) {
        return { success: false, error: 'Auction has ended' };
    }

    // 2. Spam prevention
    if (!checkActivityThreshold(bidderAddress)) {
        return { success: false, error: `Rate limit exceeded — max ${SPAM_THRESHOLD_BIDS_PER_MINUTE} bids per minute` };
    }

    // 3. Check holder perks (1.2× multiplier for NFT holders)
    const perks = await applyHolderPerks(auction.verticalSlug, bidderAddress);
    const effectiveBid = perks.isHolder
        ? applyMultiplier(bidAmount, perks.multiplier)
        : bidAmount;

    // 4. Pre-ping enforcement: only holders can bid during pre-ping window
    //    Uses isInPrePingWindow() to include grace period for latency tolerance
    const prePingStatus = isInPrePingWindow(auction.prePingEndsAt ?? null);
    if (prePingStatus.inWindow && !perks.isHolder) {
        const remainingSec = Math.ceil(prePingStatus.remainingMs / 1000);
        return { success: false, error: `Pre-ping window active — holders only (${remainingSec}s remaining)` };
    }

    if (effectiveBid < auction.reservePrice) {
        return { success: false, error: `Bid $${effectiveBid} below reserve $${auction.reservePrice}` };
    }
    if (effectiveBid <= auction.highBid) {
        return { success: false, error: `Bid $${effectiveBid} not higher than current $${auction.highBid}` };
    }

    // 3. Try on-chain bid
    let txHash = '';
    const contract = getAuctionContract();
    if (contract && auction.auctionId) {
        try {
            const wallet = getWallet();
            const connectedContract = contract.connect(wallet) as ethers.Contract;
            const bidWei = ethers.parseEther(bidAmount.toString());
            const tx = await connectedContract.placeBid(auction.auctionId, { value: bidWei });
            const receipt = await tx.wait();
            txHash = receipt.hash;
        } catch (error: any) {
            console.warn('[AUCTION] On-chain bid failed, storing off-chain:', error.message);
        }
    }

    // 6. Update Prisma with effective bid + raw bid
    try {
        await prisma.verticalAuction.update({
            where: { id: auctionDbId },
            data: {
                highBidder: bidderAddress,
                highBid: effectiveBid,
                rawBid: bidAmount,
            },
        });

        // 7. Auto-extend if this is a low-activity auction near expiry
        const extended = await autoExtendAuction(auctionDbId);
        if (extended) {
            console.log(`[AUCTION] Auto-extended auction ${auctionDbId} by ${AUTO_EXTEND_INCREMENT_SECS}s`);
        }

        console.log(`[AUCTION] Bid $${bidAmount}${perks.isHolder ? ` (effective: $${effectiveBid}, 1.2× holder)` : ''} from ${bidderAddress} on auction ${auctionDbId}`);

        return {
            success: true,
            txHash: txHash || undefined,
            currentHighBid: effectiveBid,
            holderPerks: perks.isHolder ? {
                prePingSeconds: perks.prePingSeconds,
                multiplier: perks.multiplier,
                effectiveBid,
            } : undefined,
        };
    } catch (error: any) {
        return { success: false, error: `Database error: ${error.message}` };
    }
}

// ============================================
// Auto-Extend Auction
// ============================================

/**
 * Auto-extend an auction by AUTO_EXTEND_INCREMENT_SECS when:
 *  1. The auction has < AUTO_EXTEND_INCREMENT_SECS remaining
 *  2. The extension count is below AUTO_EXTEND_MAX
 *  3. The auction is still active (not settled/cancelled)
 *
 * This prevents low-volume auctions from closing before buyers
 * have a chance to respond, while capping total extension time.
 */
export async function autoExtendAuction(auctionDbId: string): Promise<boolean> {
    const auction = await prisma.verticalAuction.findUnique({ where: { id: auctionDbId } });
    if (!auction || auction.settled || auction.cancelled) return false;

    const extensions = (auction as any).extensionCount || 0;
    if (extensions >= AUTO_EXTEND_MAX) return false;

    const remainingMs = auction.endTime.getTime() - Date.now();
    if (remainingMs > AUTO_EXTEND_INCREMENT_SECS * 1000) return false;

    const newEndTime = new Date(auction.endTime.getTime() + AUTO_EXTEND_INCREMENT_SECS * 1000);
    await prisma.verticalAuction.update({
        where: { id: auctionDbId },
        data: {
            endTime: newEndTime,
            extensionCount: extensions + 1,
        },
    });

    return true;
}

// ============================================
// Settle Auction
// ============================================

export interface SettleResult {
    success: boolean;
    winner?: string;
    finalPrice?: number;
    txHash?: string;
    error?: string;
}

/**
 * Settle a completed auction. Transfers NFT to winner.
 */
export async function settleAuction(auctionDbId: string): Promise<SettleResult> {
    const auction = await prisma.verticalAuction.findUnique({ where: { id: auctionDbId } });
    if (!auction) {
        return { success: false, error: 'Auction not found' };
    }
    if (auction.settled) {
        return { success: false, error: 'Auction already settled' };
    }

    const now = new Date();
    if (now < auction.endTime) {
        return { success: false, error: 'Auction has not ended yet' };
    }
    if (!auction.highBidder) {
        return { success: false, error: 'No bids placed' };
    }

    // 1. Try on-chain settlement
    let txHash = '';
    const contract = getAuctionContract();
    if (contract && auction.auctionId) {
        try {
            const wallet = getWallet();
            const connectedContract = contract.connect(wallet) as ethers.Contract;
            const tx = await connectedContract.settleAuction(auction.auctionId);
            const receipt = await tx.wait();
            txHash = receipt.hash;
        } catch (error: any) {
            console.warn('[AUCTION] On-chain settle failed:', error.message);
        }
    }

    // 2. Update Prisma
    try {
        await prisma.verticalAuction.update({
            where: { id: auctionDbId },
            data: {
                settled: true,
                txHash: txHash || auction.txHash,
            },
        });

        // Update vertical owner
        await prisma.vertical.update({
            where: { slug: auction.verticalSlug },
            data: {
                ownerAddress: auction.highBidder,
                resaleHistory: {
                    push: {
                        buyer: auction.highBidder,
                        seller: 'platform',
                        price: auction.highBid,
                        method: 'auction',
                        auctionId: auction.id,
                        txHash: txHash || null,
                        timestamp: new Date().toISOString(),
                    },
                },
            },
        });

        // Invalidate NFT ownership cache — old owner loses perks immediately
        invalidateAllForResale(auction.verticalSlug);

        console.log(`[AUCTION] Settled: ${auction.verticalSlug} → ${auction.highBidder} for $${auction.highBid}`);

        return {
            success: true,
            winner: auction.highBidder,
            finalPrice: auction.highBid,
            txHash: txHash || undefined,
        };
    } catch (error: any) {
        return { success: false, error: `Database error: ${error.message}` };
    }
}

// ============================================
// Get Active Auctions
// ============================================

export async function getActiveAuctions() {
    return prisma.verticalAuction.findMany({
        where: {
            settled: false,
            cancelled: false,
            endTime: { gt: new Date() },
        },
        include: { vertical: true },
        orderBy: { endTime: 'asc' },
    });
}

// ============================================
// Get Auction History
// ============================================

export async function getAuctionHistory(slug: string) {
    return prisma.verticalAuction.findMany({
        where: { verticalSlug: slug },
        orderBy: { createdAt: 'desc' },
    });
}
