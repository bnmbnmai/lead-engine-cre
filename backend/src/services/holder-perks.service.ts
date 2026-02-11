/**
 * Holder Perks Service
 *
 * Grants priority-bidding perks to holders of a vertical's NFT:
 *   - 5–10 second pre-ping window (early bid access)
 *   - 1.2× sealed-bid multiplier
 *   - Spam prevention via per-wallet activity thresholds
 *
 * Perks only apply when:
 *   - The vertical exists and is ACTIVE
 *   - The user's wallet address matches the vertical's ownerAddress
 *
 * Ownership lookups are cached via LRUCache (2 min TTL) to avoid
 * repeated Prisma queries during high-frequency bid bursts.
 */

import { prisma } from '../lib/prisma';
import { nftOwnershipCache, bidActivityCache } from '../lib/cache';

// ============================================
// Types
// ============================================

export interface HolderPerks {
    /** Whether the user holds this vertical's NFT */
    isHolder: boolean;
    /** Pre-ping window in seconds (0 for non-holders) */
    prePingSeconds: number;
    /** Bid multiplier (1.0 for non-holders, 1.2 for holders) */
    multiplier: number;
}

export interface PrePingStatus {
    /** Whether the auction is currently in the pre-ping window */
    inWindow: boolean;
    /** Milliseconds remaining in the pre-ping window (0 if expired) */
    remainingMs: number;
}

// ============================================
// Constants (exported for test assertions)
// ============================================

/** Pre-ping window range for holders (seconds) */
export const PRE_PING_MIN = 5;
export const PRE_PING_MAX = 10;

/** Sealed-bid multiplier for holders */
export const HOLDER_MULTIPLIER = 1.2;

/** Max bids per wallet per minute (spam prevention) */
export const SPAM_THRESHOLD_BIDS_PER_MINUTE = 5;

/** Score bonus for holders in RTB match ranking */
export const HOLDER_SCORE_BONUS = 2000;

/** Default (non-holder) perks */
export const DEFAULT_PERKS: HolderPerks = {
    isHolder: false,
    prePingSeconds: 0,
    multiplier: 1.0,
};

// ============================================
// Core Functions
// ============================================

/**
 * Determine pre-ping and multiplier perks for a user on a given vertical.
 *
 * Checks NFT ownership via cached Prisma lookup.
 * Only ACTIVE verticals with a matching ownerAddress grant perks.
 */
export async function applyHolderPerks(
    verticalSlug: string,
    userAddress: string | undefined | null,
): Promise<HolderPerks> {
    // No wallet → no perks
    if (!userAddress) {
        return DEFAULT_PERKS;
    }

    const normalizedAddress = userAddress.toLowerCase();

    // Check cache first, then Prisma
    const ownerAddress = await nftOwnershipCache.getOrSet(
        `nft-owner:${verticalSlug}`,
        async () => {
            const vertical = await prisma.vertical.findUnique({
                where: { slug: verticalSlug },
                select: { ownerAddress: true, status: true },
            });

            // Only ACTIVE verticals qualify
            if (!vertical || vertical.status !== 'ACTIVE') {
                return null;
            }

            return vertical.ownerAddress || null;
        },
    );

    // No owner or mismatch → standard bidding
    if (!ownerAddress || ownerAddress.toLowerCase() !== normalizedAddress) {
        return DEFAULT_PERKS;
    }

    // Holder confirmed — compute pre-ping (deterministic per slug for consistency)
    const prePingSeconds = computePrePing(verticalSlug);

    return {
        isHolder: true,
        prePingSeconds,
        multiplier: HOLDER_MULTIPLIER,
    };
}

/**
 * Apply the bid multiplier to a raw bid amount.
 * Returns the effective bid rounded to 2 decimal places.
 */
export function applyMultiplier(rawBid: number, multiplier: number): number {
    return Math.round(rawBid * multiplier * 100) / 100;
}

/**
 * Convenience wrapper: compute effective bid from raw bid and holder perks.
 */
export function getEffectiveBid(rawBid: number, perks: HolderPerks): number {
    return perks.isHolder ? applyMultiplier(rawBid, perks.multiplier) : rawBid;
}

// ============================================
// Pre-Ping Window
// ============================================

/**
 * Check if an auction is currently in the pre-ping window (holders-only bidding).
 *
 * @param auctionStart - When the auction started
 * @param slug - Vertical slug (determines pre-ping duration)
 * @returns inWindow flag and remaining milliseconds
 */
export function isInPrePingWindow(auctionStart: Date, slug: string): PrePingStatus {
    const prePingSeconds = computePrePing(slug);
    const prePingEndMs = auctionStart.getTime() + prePingSeconds * 1000;
    const now = Date.now();
    const remainingMs = Math.max(0, prePingEndMs - now);

    return {
        inWindow: now < prePingEndMs,
        remainingMs,
    };
}

// ============================================
// Spam Prevention
// ============================================

/**
 * Check if a wallet has exceeded the bid-per-minute threshold.
 * Uses in-memory LRU cache with 60s TTL for fast checks.
 *
 * @returns true if allowed (under threshold), false if spam-blocked
 */
export function checkActivityThreshold(walletAddress: string): boolean {
    const key = `bid-activity:${walletAddress.toLowerCase()}`;
    const current = bidActivityCache.get(key) || 0;

    if (current >= SPAM_THRESHOLD_BIDS_PER_MINUTE) {
        return false; // Blocked — over threshold
    }

    // Increment counter (TTL auto-resets after 60s)
    bidActivityCache.set(key, current + 1);
    return true;
}

// ============================================
// Helpers
// ============================================

/**
 * Compute a deterministic pre-ping window (5–10s) based on the vertical slug.
 * Uses a simple hash so the same vertical always gets the same window,
 * avoiding jitter across multiple calls.
 */
export function computePrePing(slug: string): number {
    let hash = 0;
    for (let i = 0; i < slug.length; i++) {
        hash = ((hash << 5) - hash + slug.charCodeAt(i)) | 0;
    }
    return PRE_PING_MIN + (Math.abs(hash) % (PRE_PING_MAX - PRE_PING_MIN + 1));
}

