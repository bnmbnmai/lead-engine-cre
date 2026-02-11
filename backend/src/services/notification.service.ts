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
