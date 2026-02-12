/**
 * Quarterly Reset Service
 *
 * Manages vertical lease lifecycle:
 *  - Daily cron check for expired leases
 *  - 7-day grace period before re-auction
 *  - Lease renewal (extends 90 days)
 *  - Re-auction trigger for expired verticals
 *  - Mid-auction safety: PAUSED status when active auction exists
 *  - GDPR-aware notifications for lease events
 *  - Spam caps: minimum activity for re-auction eligibility
 *
 * Chainlink Keepers stub exported for future on-chain automation.
 */

import { prisma } from '../lib/prisma';
import { hasGdprConsent, queueNotification, getHolderNotifyOptIn } from './notification.service';

// ── Constants ─────────────────────────────────────────

const GRACE_PERIOD_DAYS = 7;
const LEASE_DURATION_DAYS = 90; // ~1 quarter
const MS_PER_DAY = 86_400_000;
const MIN_BIDS_FOR_REAUCTION = 5;    // Min bids in last 90 days to participate
const MAX_REAUCTIONS_PER_CYCLE = 10; // Cap simultaneous re-auctions per reset cycle

// ── Types ─────────────────────────────────────────────

export type LeaseEvent = 'GRACE_PERIOD_ENTERED' | 'LEASE_EXPIRED' | 'LEASE_RENEWED';

export interface LeaseCheckResult {
    expiredCount: number;
    graceEnteredCount: number;
    reAuctionTriggered: string[]; // vertical slugs
    skippedActiveAuction: string[];
    pausedCount: number;          // Leases paused due to mid-auction
    notificationsSent: number;
}

export interface RenewalResult {
    success: boolean;
    newLeaseEndDate?: Date;
    error?: string;
}

export interface ResetEligibility {
    eligible: boolean;
    bidCount: number;
    reason?: string;
}

// ── GDPR-Aware Notifications ──────────────────────────

/**
 * Send a lease lifecycle notification to the holder if GDPR consent
 * and opt-in are both satisfied.
 */
export async function notifyLeaseHolder(
    auction: { verticalSlug: string; highBidder: string | null },
    event: LeaseEvent,
): Promise<boolean> {
    if (!auction.highBidder) return false;

    try {
        // Find user by wallet address
        const user = await prisma.user.findUnique({
            where: { walletAddress: auction.highBidder.toLowerCase() },
        });
        if (!user) return false;

        // GDPR gate: check consent + opt-in
        const [consent, optIn] = await Promise.all([
            hasGdprConsent(user.id),
            getHolderNotifyOptIn(user.id),
        ]);

        if (!consent || !optIn) {
            console.log(`[QUARTERLY-RESET] Skipping notification for ${auction.highBidder} (consent=${consent}, optIn=${optIn})`);
            return false;
        }

        // Queue notification
        const messages: Record<LeaseEvent, string> = {
            GRACE_PERIOD_ENTERED: `Your lease on vertical "${auction.verticalSlug}" has expired. You have ${GRACE_PERIOD_DAYS} days to renew before re-auction.`,
            LEASE_EXPIRED: `Your lease on vertical "${auction.verticalSlug}" has expired and the vertical is now open for re-auction.`,
            LEASE_RENEWED: `Your lease on vertical "${auction.verticalSlug}" has been renewed for ${LEASE_DURATION_DAYS} days.`,
        };

        queueNotification({
            userId: user.id,
            walletAddress: auction.highBidder,
            vertical: auction.verticalSlug,
            leadId: 'lease-lifecycle',
            auctionStart: new Date(),
            prePingSeconds: 0,
        });

        console.log(`[QUARTERLY-RESET] Notification queued: ${event} for ${auction.highBidder} on "${auction.verticalSlug}"`);
        return true;
    } catch (error: any) {
        console.error(`[QUARTERLY-RESET] Notification failed for ${auction.highBidder}:`, error.message);
        return false;
    }
}

// ── Spam Caps / Reset Eligibility ─────────────────────

/**
 * Check if a wallet has sufficient activity to participate in re-auctions.
 * Prevents sybil attacks during quarterly reset windows.
 *
 * @param walletAddress - Wallet to check
 * @returns eligibility status with bid count
 */
export async function checkResetEligibility(walletAddress: string): Promise<ResetEligibility> {
    const ninetyDaysAgo = new Date(Date.now() - LEASE_DURATION_DAYS * MS_PER_DAY);

    // Find user by wallet, then count their bids
    const user = await prisma.user.findUnique({
        where: { walletAddress: walletAddress.toLowerCase() },
    });

    if (!user) {
        return { eligible: false, bidCount: 0, reason: 'User not found' };
    }

    const bidCount = await prisma.bid.count({
        where: {
            buyerId: user.id,
            createdAt: { gte: ninetyDaysAgo },
        },
    });

    if (bidCount < MIN_BIDS_FOR_REAUCTION) {
        return {
            eligible: false,
            bidCount,
            reason: `Minimum ${MIN_BIDS_FOR_REAUCTION} bids in last 90 days required (found ${bidCount})`,
        };
    }

    return { eligible: true, bidCount };
}

/**
 * Returns the maximum number of re-auctions allowed per reset cycle.
 * Configurable via env for load testing.
 */
export function getResetSpamCap(): number {
    return parseInt(process.env.MAX_REAUCTIONS_PER_CYCLE || '', 10) || MAX_REAUCTIONS_PER_CYCLE;
}

// ── Core Functions ────────────────────────────────────

/**
 * Check for expired leases and process them.
 * Called daily by cron or manually for testing.
 */
export async function checkExpiredLeases(): Promise<LeaseCheckResult> {
    const now = new Date();
    const reAuctionCap = getResetSpamCap();
    const result: LeaseCheckResult = {
        expiredCount: 0,
        graceEnteredCount: 0,
        reAuctionTriggered: [],
        skippedActiveAuction: [],
        pausedCount: 0,
        notificationsSent: 0,
    };

    // 1. Find ACTIVE leases past their end date
    const expiredActive = await prisma.verticalAuction.findMany({
        where: {
            leaseStatus: 'ACTIVE',
            leaseEndDate: { not: null, lt: now },
            settled: false,
            cancelled: false,
        },
    });

    for (const auction of expiredActive) {
        result.expiredCount++;
        const entered = await enterGracePeriod(auction.id);
        if (entered) {
            result.graceEnteredCount++;
            const notified = await notifyLeaseHolder(auction, 'GRACE_PERIOD_ENTERED');
            if (notified) result.notificationsSent++;
        }
    }

    // 2. Find GRACE_PERIOD leases past renewal deadline
    const expiredGrace = await prisma.verticalAuction.findMany({
        where: {
            leaseStatus: 'GRACE_PERIOD',
            renewalDeadline: { not: null, lt: now },
            settled: false,
            cancelled: false,
        },
    });

    for (const auction of expiredGrace) {
        // Enforce re-auction cap per cycle
        if (result.reAuctionTriggered.length >= reAuctionCap) {
            console.log(`[QUARTERLY-RESET] Re-auction cap (${reAuctionCap}) reached — deferring "${auction.verticalSlug}"`);
            break;
        }

        // Check if there's an active auction for this vertical (mid-auction safety)
        const activeAuction = await prisma.verticalAuction.findFirst({
            where: {
                verticalSlug: auction.verticalSlug,
                settled: false,
                cancelled: false,
                endTime: { gt: now },
                id: { not: auction.id },
            },
        });

        if (activeAuction) {
            // PAUSED: lease check suspended until auction resolves
            await prisma.verticalAuction.update({
                where: { id: auction.id },
                data: { leaseStatus: 'PAUSED' },
            });
            console.log(`[QUARTERLY-RESET] Paused lease for "${auction.verticalSlug}" — active auction ${activeAuction.id} in progress`);
            result.skippedActiveAuction.push(auction.verticalSlug);
            result.pausedCount++;
            continue;
        }

        await expireLease(auction.id);
        const notified = await notifyLeaseHolder(auction, 'LEASE_EXPIRED');
        if (notified) result.notificationsSent++;
        result.reAuctionTriggered.push(auction.verticalSlug);
    }

    console.log(`[QUARTERLY-RESET] Check complete: ${result.expiredCount} expired, ${result.graceEnteredCount} entered grace, ${result.reAuctionTriggered.length} re-auctioned, ${result.skippedActiveAuction.length} skipped/paused, ${result.notificationsSent} notifications`);
    return result;
}

/**
 * Enter grace period for an expired lease.
 * Holder has GRACE_PERIOD_DAYS (7 days) to renew before re-auction.
 */
export async function enterGracePeriod(auctionId: string): Promise<boolean> {
    try {
        const now = new Date();
        const renewalDeadline = new Date(now.getTime() + GRACE_PERIOD_DAYS * MS_PER_DAY);

        await prisma.verticalAuction.update({
            where: { id: auctionId },
            data: {
                leaseStatus: 'GRACE_PERIOD',
                renewalDeadline,
            },
        });

        console.log(`[QUARTERLY-RESET] Auction ${auctionId} entered grace period (deadline: ${renewalDeadline.toISOString()})`);
        return true;
    } catch (error: any) {
        console.error(`[QUARTERLY-RESET] Failed to enter grace period for ${auctionId}:`, error.message);
        return false;
    }
}

/**
 * Expire a lease after grace period ends — mark EXPIRED, clear holder perks.
 * Caller should trigger re-auction for the vertical.
 */
export async function expireLease(auctionId: string): Promise<boolean> {
    try {
        const auction = await prisma.verticalAuction.update({
            where: { id: auctionId },
            data: {
                leaseStatus: 'EXPIRED',
                settled: true,
            },
        });

        // Clear holder ownership on the vertical (revoke perks)
        await prisma.vertical.update({
            where: { slug: auction.verticalSlug },
            data: {
                ownerAddress: null,
                nftTokenId: null,
            },
        });

        console.log(`[QUARTERLY-RESET] Lease expired for "${auction.verticalSlug}" — holder perks revoked`);
        return true;
    } catch (error: any) {
        console.error(`[QUARTERLY-RESET] Failed to expire lease ${auctionId}:`, error.message);
        return false;
    }
}

/**
 * Renew a lease — holder pays to extend by LEASE_DURATION_DAYS (90 days).
 *
 * @param auctionId  - VerticalAuction record ID
 * @param txHash     - On-chain renewal transaction hash (optional for off-chain testing)
 */
export async function renewLease(auctionId: string, txHash?: string): Promise<RenewalResult> {
    try {
        const auction = await prisma.verticalAuction.findUnique({ where: { id: auctionId } });
        if (!auction) return { success: false, error: 'Auction not found' };

        if (auction.leaseStatus !== 'ACTIVE' && auction.leaseStatus !== 'GRACE_PERIOD') {
            return { success: false, error: `Cannot renew — lease status is ${auction.leaseStatus}` };
        }

        const baseDate = auction.leaseEndDate || new Date();
        const newLeaseEndDate = new Date(baseDate.getTime() + LEASE_DURATION_DAYS * MS_PER_DAY);

        await prisma.verticalAuction.update({
            where: { id: auctionId },
            data: {
                leaseStatus: 'RENEWED',
                leaseEndDate: newLeaseEndDate,
                renewalDeadline: null, // Clear grace deadline
                txHash: txHash || auction.txHash,
            },
        });

        // GDPR-aware notification
        await notifyLeaseHolder(auction, 'LEASE_RENEWED');

        console.log(`[QUARTERLY-RESET] Lease renewed for auction ${auctionId} — new end: ${newLeaseEndDate.toISOString()}`);
        return { success: true, newLeaseEndDate };
    } catch (error: any) {
        console.error(`[QUARTERLY-RESET] Renewal failed for ${auctionId}:`, error.message);
        return { success: false, error: error.message };
    }
}

// ── Cron Setup ────────────────────────────────────────

let cronInitialized = false;

/**
 * Start the daily lease check cron job.
 * Uses node-cron if available, otherwise logs a warning.
 */
export function startQuarterlyResetCron(): void {
    if (cronInitialized) return;

    try {
        // Dynamic import — node-cron is optional dependency
        const cron = require('node-cron');
        cron.schedule('0 0 * * *', async () => { // Daily at midnight UTC
            console.log('[QUARTERLY-RESET] Running daily lease check...');
            await checkExpiredLeases();
        });
        cronInitialized = true;
        console.log('[QUARTERLY-RESET] Daily lease check cron scheduled (00:00 UTC)');
    } catch {
        console.warn('[QUARTERLY-RESET] node-cron not available — lease checks must be triggered manually');
    }
}

// ── Chainlink Keepers Stub ────────────────────────────

/**
 * Stub for future Chainlink Keepers integration.
 * Returns calldata for the on-chain `checkUpkeep` → `performUpkeep` pattern.
 */
export function getLeaseCheckCalldata(): { checkUpkeepSelector: string; performUpkeepSelector: string } {
    return {
        checkUpkeepSelector: '0x6e04ff0d', // checkUpkeep(bytes)
        performUpkeepSelector: '0x4585e33b', // performUpkeep(bytes)
    };
}

// ── Exports ───────────────────────────────────────────

export const LEASE_CONSTANTS = {
    GRACE_PERIOD_DAYS,
    LEASE_DURATION_DAYS,
    MIN_BIDS_FOR_REAUCTION,
    MAX_REAUCTIONS_PER_CYCLE,
} as const;
