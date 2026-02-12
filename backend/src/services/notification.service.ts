/**
 * Notification Service
 *
 * Manages opt-in notifications for NFT holders:
 *   - Pre-ping alerts when a new auction starts in their vertical
 *   - Toggle opt-in/opt-out per user
 *   - Cached lookups for fast checks during bid bursts
 *
 * Notification delivery is via Socket.io events; this service
 * handles the preference layer and holder resolution.
 */

import { prisma } from '../lib/prisma';
import { holderNotifyCache, nftOwnershipCache } from '../lib/cache';

// ============================================
// Types
// ============================================

export interface NotifyResult {
    success: boolean;
    optedIn?: boolean;
    error?: string;
}

export interface HolderNotification {
    userId: string;
    walletAddress: string;
    vertical: string;
    leadId: string;
    auctionStart: Date;
    prePingSeconds: number;
}

// ============================================
// Opt-In Management
// ============================================

/**
 * Set holder notification opt-in preference.
 */
export async function setHolderNotifyOptIn(
    userId: string,
    optIn: boolean,
): Promise<NotifyResult> {
    try {
        await prisma.buyerProfile.updateMany({
            where: { userId },
            data: { holderNotifyOptIn: optIn },
        });

        // Invalidate cache
        holderNotifyCache.delete(`notify-optin:${userId}`);

        return { success: true, optedIn: optIn };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * Get holder notification opt-in status (cached).
 */
export async function getHolderNotifyOptIn(userId: string): Promise<boolean> {
    return holderNotifyCache.getOrSet(
        `notify-optin:${userId}`,
        async () => {
            const profile = await prisma.buyerProfile.findFirst({
                where: { userId },
                select: { holderNotifyOptIn: true },
            });
            return profile?.holderNotifyOptIn ?? false;
        },
    );
}

// ============================================
// Holder Notification Resolution
// ============================================

/**
 * Find all opted-in holders for a given vertical.
 * Returns user IDs and wallet addresses for socket notification.
 */
export async function findNotifiableHolders(
    vertical: string,
): Promise<Array<{ userId: string; walletAddress: string }>> {
    try {
        // Get vertical owner address (cached)
        const ownerAddress = await nftOwnershipCache.getOrSet(
            `nft-owner:${vertical}`,
            async () => {
                const v = await prisma.vertical.findUnique({
                    where: { slug: vertical },
                    select: { ownerAddress: true, status: true },
                });
                if (!v || v.status !== 'ACTIVE') return null;
                return v.ownerAddress || null;
            },
        );

        if (!ownerAddress) return [];

        // Find buyer profiles matching this wallet that opted in
        const buyers = await prisma.buyerProfile.findMany({
            where: {
                holderNotifyOptIn: true,
                user: {
                    walletAddress: {
                        equals: ownerAddress,
                        mode: 'insensitive',
                    },
                },
            },
            select: {
                userId: true,
                user: { select: { walletAddress: true } },
            },
        });

        return buyers.map((b) => ({
            userId: b.userId,
            walletAddress: b.user.walletAddress,
        }));
    } catch (error) {
        console.error('[NOTIFICATION] Error finding notifiable holders:', error);
        return [];
    }
}

/**
 * Build holder notification payloads for a new auction.
 */
export function buildHolderNotifications(
    holders: Array<{ userId: string; walletAddress: string }>,
    vertical: string,
    leadId: string,
    auctionStart: Date,
    prePingSeconds: number,
): HolderNotification[] {
    return holders.map((h) => ({
        userId: h.userId,
        walletAddress: h.walletAddress,
        vertical,
        leadId,
        auctionStart,
        prePingSeconds,
    }));
}

// ============================================
// Notification Batching & Fatigue Reduction
// ============================================

const DIGEST_INTERVAL_MS = 5 * 60_000; // Flush every 5 minutes
const DAILY_NOTIFICATION_CAP = 50;      // Max notifications per user per day

/** Per-user notification queue (flushed every 5 min) */
const notificationQueue = new Map<string, HolderNotification[]>();

/** Per-user daily send counter (resets at midnight UTC) */
const dailySendCount = new Map<string, { count: number; date: string }>();

/**
 * Queue a notification for batched delivery.
 * Returns false if daily cap exceeded or GDPR consent missing.
 */
export async function queueNotification(notification: HolderNotification): Promise<boolean> {
    // GDPR consent check
    if (!(await hasGdprConsent(notification.userId))) {
        return false;
    }

    // Daily cap check
    const today = new Date().toISOString().slice(0, 10);
    const userCount = dailySendCount.get(notification.userId);
    if (userCount && userCount.date === today && userCount.count >= DAILY_NOTIFICATION_CAP) {
        console.log(`[NOTIFICATION] Daily cap (${DAILY_NOTIFICATION_CAP}) reached for ${notification.userId}`);
        return false;
    }

    // Enqueue
    const queue = notificationQueue.get(notification.userId) || [];
    queue.push(notification);
    notificationQueue.set(notification.userId, queue);
    return true;
}

/**
 * Flush all pending notifications as a single digest per user.
 * Called by interval timer or manually.
 */
export function flushNotificationDigest(): Map<string, HolderNotification[]> {
    const digests = new Map<string, HolderNotification[]>();
    const today = new Date().toISOString().slice(0, 10);

    for (const [userId, notifications] of notificationQueue) {
        if (notifications.length === 0) continue;

        // Update daily count
        const existing = dailySendCount.get(userId) || { count: 0, date: today };
        if (existing.date !== today) {
            existing.count = 0;
            existing.date = today;
        }

        // Cap the batch to remaining daily budget
        const remaining = DAILY_NOTIFICATION_CAP - existing.count;
        const batch = notifications.slice(0, remaining);
        if (batch.length > 0) {
            digests.set(userId, batch);
            existing.count += batch.length;
            dailySendCount.set(userId, existing);
        }
    }

    // Clear all queues after flush
    notificationQueue.clear();

    console.log(`[NOTIFICATION] Digest flushed: ${digests.size} users, ${[...digests.values()].reduce((s, v) => s + v.length, 0)} total`);
    return digests;
}

/**
 * Check if user has GDPR-compliant notification consent.
 * Uses holderNotifyOptIn as proxy — should be set via explicit consent UI.
 */
export async function hasGdprConsent(userId: string): Promise<boolean> {
    return getHolderNotifyOptIn(userId);
}

// Start digest flush interval (only once)
let digestTimerStarted = false;
export function startDigestTimer(): void {
    if (digestTimerStarted) return;
    setInterval(() => flushNotificationDigest(), DIGEST_INTERVAL_MS);
    digestTimerStarted = true;
    console.log(`[NOTIFICATION] Digest timer started (every ${DIGEST_INTERVAL_MS / 60_000} min)`);
}

// Export constants for testing
export const NOTIFICATION_CONSTANTS = {
    DIGEST_INTERVAL_MS,
    DAILY_NOTIFICATION_CAP,
} as const;
