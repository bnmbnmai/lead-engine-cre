/**
 * Perks Engine — Unified Facade
 *
 * Re-exports all holder-perks and notification functions through a single
 * import point. Adds:
 *   - getPerksOverview() — combined holder status + notification prefs + stats
 *   - PerksError — shared error schema with retryable flag
 *   - MAX_VERTICAL_DEPTH — hierarchy depth limit (4 levels)
 *
 * Usage: import { getPerksOverview, PerksError } from './perks-engine';
 */

import { prisma } from '../lib/prisma';

// ── Centralized Configuration ──────────────────
export { PERKS_CONFIG } from '../config/perks.env';

// ── Holder Perks ──────────────────────────────
export {
    HolderPerks,
    PrePingStatus,
    PRE_PING_MIN,
    PRE_PING_MAX,
    HOLDER_MULTIPLIER,
    SPAM_THRESHOLD_BIDS_PER_MINUTE,
    HOLDER_SCORE_BONUS,
    DEFAULT_PERKS,
    PRE_PING_GRACE_MS,
    applyHolderPerks,
    applyMultiplier,
    getEffectiveBid,
    isInPrePingWindow,
    isInPrePingWindowLegacy,
    checkActivityThreshold,
    computePrePing,
} from './holder-perks.service';

// ── Notifications ──────────────────────────────
export {
    HolderNotification,
    setHolderNotifyOptIn,
    getHolderNotifyOptIn,
    findNotifiableHolders,
    buildHolderNotifications,
    queueNotification,
    flushNotificationDigest,
    hasGdprConsent,
    startDigestTimer,
    NOTIFICATION_CONSTANTS,
} from './notification.service';

// ── Convenience Types ──────────────────────────

/** Complete perk status for a user on a vertical */
export interface PerkStatus {
    perks: import('./holder-perks.service').HolderPerks;
    prePing: import('./holder-perks.service').PrePingStatus;
    notifyOptIn: boolean;
}

// ============================================
// Shared Error Schema
// ============================================

export interface PerksError {
    code: 'HOLDER_CHECK_FAILED' | 'NOTIFICATION_FAILED' | 'GDPR_DENIED'
    | 'RATE_LIMITED' | 'ACE_DENIED' | 'UNKNOWN';
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
}

export function createPerksError(
    code: PerksError['code'],
    message: string,
    retryable = false,
    retryAfterMs?: number,
): PerksError {
    return { code, message, retryable, retryAfterMs };
}

// ============================================
// Unified Perks Overview
// ============================================

export interface PerksOverview {
    isHolder: boolean;
    multiplier: number;
    prePingSeconds: number;
    notifyOptedIn: boolean;
    gdprConsent: boolean;
    winStats: {
        totalBids: number;
        wonBids: number;
        winRate: number;
    };
}

/**
 * Get a unified perks overview for a user.
 * Combines holder status, notification prefs, and win-rate stats in parallel.
 */
export async function getPerksOverview(
    userId: string,
    walletAddress?: string,
): Promise<PerksOverview> {
    const { getHolderNotifyOptIn } = require('./notification.service');
    const { computePrePing, HOLDER_MULTIPLIER } = require('./holder-perks.service');

    const [holderStatus, notifyOptedIn, winStats] = await Promise.all([
        // 1. Check if user is holder of any active vertical
        (async () => {
            if (!walletAddress) return { isHolder: false, multiplier: 1.0, prePingSeconds: 0 };
            const normalizedAddress = walletAddress.toLowerCase();
            const vertical = await prisma.vertical.findFirst({
                where: {
                    ownerAddress: { equals: normalizedAddress, mode: 'insensitive' as const },
                    status: 'ACTIVE',
                },
                select: { slug: true },
            });
            if (!vertical) return { isHolder: false, multiplier: 1.0, prePingSeconds: 0 };
            return {
                isHolder: true,
                multiplier: HOLDER_MULTIPLIER,
                prePingSeconds: computePrePing(vertical.slug),
            };
        })(),

        // 2. Notification opt-in
        getHolderNotifyOptIn(userId) as Promise<boolean>,

        // 3. Win stats
        (async () => {
            const [totalBids, wonBids] = await Promise.all([
                prisma.bid.count({ where: { buyerId: userId } }),
                prisma.bid.count({ where: { buyerId: userId, status: 'WON' as any } }),
            ]);
            return { totalBids, wonBids, winRate: totalBids > 0 ? Math.round((wonBids / totalBids) * 100) : 0 };
        })(),
    ]);

    return {
        ...holderStatus,
        notifyOptedIn,
        gdprConsent: notifyOptedIn,
        winStats,
    };
}

/** Maximum hierarchy depth — prevents infinite nesting bloat */
export const MAX_VERTICAL_DEPTH = 4;
