/**
 * Quarterly Reset Service
 *
 * Manages vertical lease lifecycle:
 *  - Daily cron check for expired leases
 *  - 7-day grace period before re-auction
 *  - Lease renewal (extends 90 days)
 *  - Re-auction trigger for expired verticals
 *  - Mid-auction safety: skip if active auction exists
 *
 * Chainlink Keepers stub exported for future on-chain automation.
 */

import { prisma } from '../lib/prisma';

// ── Constants ─────────────────────────────────────────

const GRACE_PERIOD_DAYS = 7;
const LEASE_DURATION_DAYS = 90; // ~1 quarter
const MS_PER_DAY = 86_400_000;

// ── Types ─────────────────────────────────────────────

export interface LeaseCheckResult {
    expiredCount: number;
    graceEnteredCount: number;
    reAuctionTriggered: string[]; // vertical slugs
    skippedActiveAuction: string[];
}

export interface RenewalResult {
    success: boolean;
    newLeaseEndDate?: Date;
    error?: string;
}

// ── Core Functions ────────────────────────────────────

/**
 * Check for expired leases and process them.
 * Called daily by cron or manually for testing.
 */
export async function checkExpiredLeases(): Promise<LeaseCheckResult> {
    const now = new Date();
    const result: LeaseCheckResult = {
        expiredCount: 0,
        graceEnteredCount: 0,
        reAuctionTriggered: [],
        skippedActiveAuction: [],
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
        if (entered) result.graceEnteredCount++;
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
            console.log(`[QUARTERLY-RESET] Skipping re-auction for "${auction.verticalSlug}" — active auction ${activeAuction.id} in progress`);
            result.skippedActiveAuction.push(auction.verticalSlug);
            continue;
        }

        await expireLease(auction.id);
        result.reAuctionTriggered.push(auction.verticalSlug);
    }

    console.log(`[QUARTERLY-RESET] Check complete: ${result.expiredCount} expired, ${result.graceEnteredCount} entered grace, ${result.reAuctionTriggered.length} re-auctioned, ${result.skippedActiveAuction.length} skipped`);
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
} as const;
