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

/** Seconds earlier that holders receive lead:ping vs non-holders */
export const HOLDER_EARLY_PING_SECONDS = 12;

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
 * Flow: NFT ownership check → ACE compliance gate → compute perks
 * ACE gate ensures sanctioned/non-KYC holders don't get bidding advantages.
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

    // ── ACE Compliance Gate ──
    // Holders must pass ACE compliance to receive perks.
    // Non-compliant holders (expired KYC, blacklisted, jurisdiction-blocked)
    // are downgraded to standard bidding — they can still bid, but without
    // multiplier or pre-ping advantages.
    try {
        const { aceService } = require('./ace.service');
        const verticalHash = require('ethers').ethers.id(verticalSlug);
        const compliance = await aceService.canTransact(normalizedAddress, verticalSlug, verticalHash);
        if (!compliance.allowed) {
            console.log(`[HOLDER-PERKS] ACE denied perks for ${normalizedAddress} on ${verticalSlug}: ${compliance.reason}`);
            return DEFAULT_PERKS;
        }
    } catch (error) {
        // ACE service failure should not block all perks — log and allow
        // (fail-open for availability, fail-closed would block legitimate holders)
        console.warn('[HOLDER-PERKS] ACE check failed, allowing perks (fail-open):', error);
    }

    // Holder confirmed + ACE compliant — compute pre-ping
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

/** Grace period (ms) added to pre-ping window to tolerate network latency */
export const PRE_PING_GRACE_MS = 1500;

/**
 * Check if an auction is currently in the pre-ping window (holders-only bidding).
 * Uses the DB-stored prePingEndsAt timestamp (set by createAuction) to avoid
 * recomputation desync when nonces are involved.
 *
 * @param prePingEndsAt - Stored pre-ping end time from VerticalAuction/AuctionRoom
 * @returns inWindow flag and remaining milliseconds (including grace period)
 */
export function isInPrePingWindow(prePingEndsAt: Date | null): PrePingStatus {
    if (!prePingEndsAt) return { inWindow: false, remainingMs: 0 };
    const now = Date.now();
    const endWithGrace = prePingEndsAt.getTime() + PRE_PING_GRACE_MS;
    const remainingMs = Math.max(0, endWithGrace - now);

    return {
        inWindow: now < endWithGrace,
        remainingMs,
    };
}

/**
 * @deprecated Use isInPrePingWindow(prePingEndsAt) with the DB-stored value.
 * This wrapper recomputes from slug (no nonce) — only for backward compat in tests.
 */
export function isInPrePingWindowLegacy(auctionStart: Date, slug: string): PrePingStatus {
    const prePingSeconds = computePrePing(slug);
    const prePingEndsAt = new Date(auctionStart.getTime() + prePingSeconds * 1000);
    return isInPrePingWindow(prePingEndsAt);
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
 * Compute a deterministic pre-ping window (5–10s) based on the vertical slug
 * and an optional per-auction nonce. The nonce prevents trivial prediction
 * of pre-ping windows across auctions for the same vertical.
 *
 * @param slug   Vertical slug for deterministic base
 * @param nonce  Per-auction random component (e.g., auctionId or crypto random hex)
 */
export function computePrePing(slug: string, nonce: string = ''): number {
    const input = `${slug}:${nonce}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return PRE_PING_MIN + (Math.abs(hash) % (PRE_PING_MAX - PRE_PING_MIN + 1));
}

/**
 * Verify a stored prePingNonce against the DB-stored prePingEndsAt.
 * Used in audit/dispute workflows to prove the pre-ping window was correctly computed.
 *
 * @param slug              Vertical slug
 * @param storedNonce       The nonce persisted in VerticalAuction.prePingNonce
 * @param auctionStartTime  When the auction started (VerticalAuction.startTime)
 * @param storedPrePingEndsAt  The prePingEndsAt from the DB record
 * @returns valid flag, the expected end time, and any drift in ms
 */
export function verifyPrePingNonce(
    slug: string,
    storedNonce: string,
    auctionStartTime: Date,
    storedPrePingEndsAt: Date,
): { valid: boolean; expectedEndsAt: Date; driftMs: number } {
    const recomputedSeconds = computePrePing(slug, storedNonce);
    const expectedEndsAt = new Date(auctionStartTime.getTime() + recomputedSeconds * 1000);
    const driftMs = Math.abs(expectedEndsAt.getTime() - storedPrePingEndsAt.getTime());

    return {
        valid: driftMs < 1000, // Allow <1s drift for rounding / clock resolution
        expectedEndsAt,
        driftMs,
    };
}

