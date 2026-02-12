/**
 * Migration Script — Backfill null effectiveBid on pre-existing bids
 *
 * For bids placed before the priority bidding feature, effectiveBid is null.
 * This script sets effectiveBid = amount for all such bids, ensuring
 * resolveAuction ordering works correctly without relying on fallback logic.
 *
 * Usage:  npx ts-node scripts/backfill-effective-bid.ts
 *         npx ts-node scripts/backfill-effective-bid.ts --commit
 *         npx ts-node scripts/backfill-effective-bid.ts --commit --batch-size 50
 * Safety: Read-only by default. Pass --commit to apply changes.
 * Idempotent: Safe to re-run — only touches bids where effectiveBid IS NULL.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--commit');

/** Parse --batch-size N from CLI args (default: 100) */
function parseBatchSize(): number {
    const idx = process.argv.indexOf('--batch-size');
    if (idx !== -1 && process.argv[idx + 1]) {
        const parsed = parseInt(process.argv[idx + 1], 10);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 1000) return parsed;
        console.warn(`[BACKFILL] Invalid --batch-size, using default 100`);
    }
    return 100;
}

const BATCH_SIZE = parseBatchSize();

async function main() {
    const startTime = Date.now();

    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  Backfill effectiveBid on legacy bids    ║`);
    console.log(`║  Mode: ${DRY_RUN ? 'DRY RUN (pass --commit to apply)' : '⚠️  COMMITTING CHANGES'}       ║`);
    console.log(`║  Batch size: ${String(BATCH_SIZE).padEnd(28)}║`);
    console.log(`╚══════════════════════════════════════════╝\n`);

    // 1. Count affected bids (idempotent: only null effectiveBid)
    const nullBids = await prisma.bid.findMany({
        where: {
            effectiveBid: null,
            amount: { not: null },
        },
        select: { id: true, amount: true, leadId: true, buyerId: true },
    });

    console.log(`Found ${nullBids.length} bids with null effectiveBid\n`);

    if (nullBids.length === 0) {
        console.log('✅ Nothing to backfill — all bids have effectiveBid set.');
        logAudit(startTime, 0, 0);
        return;
    }

    // 2. Preview first 10
    console.log('Preview (first 10):');
    for (const bid of nullBids.slice(0, 10)) {
        console.log(`  Bid ${bid.id} — amount: ${bid.amount} → effectiveBid: ${bid.amount}`);
    }
    if (nullBids.length > 10) {
        console.log(`  ... and ${nullBids.length - 10} more\n`);
    }

    // 3. Apply updates
    if (DRY_RUN) {
        console.log('\n🔒 DRY RUN — no changes made. Run with --commit to apply.');
        logAudit(startTime, nullBids.length, 0);
        return;
    }

    let updated = 0;

    // Process in batched transactions for atomicity + performance
    for (let i = 0; i < nullBids.length; i += BATCH_SIZE) {
        const batch = nullBids.slice(i, i + BATCH_SIZE);
        await prisma.$transaction(
            batch.map(bid =>
                prisma.bid.update({
                    where: { id: bid.id },
                    data: { effectiveBid: bid.amount! },
                })
            )
        );
        updated += batch.length;
        const pct = ((updated / nullBids.length) * 100).toFixed(1);
        process.stdout.write(`\r  Progress: ${updated}/${nullBids.length} (${pct}%)`);
    }
    console.log(''); // newline after progress

    console.log(`\n✅ Updated ${updated} bids: effectiveBid = amount`);

    // 4. Verify
    const remaining = await prisma.bid.count({
        where: { effectiveBid: null, amount: { not: null } },
    });
    console.log(`Remaining null effectiveBid bids: ${remaining}`);
    if (remaining === 0) {
        console.log('🎉 All bids now have effectiveBid set.');
    }

    logAudit(startTime, nullBids.length, updated);
}

/** Structured audit log for deployment tracking */
function logAudit(startTime: number, found: number, updated: number): void {
    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
        event: 'MIGRATION_BACKFILL_AUDIT',
        script: 'backfill-effective-bid',
        timestamp: new Date().toISOString(),
        durationMs,
        durationSec: (durationMs / 1000).toFixed(2),
        mode: DRY_RUN ? 'dry-run' : 'commit',
        batchSize: BATCH_SIZE,
        found,
        updated,
        remaining: found - updated,
    }));
}

// Export for testing
export { parseBatchSize, DRY_RUN, BATCH_SIZE };

main()
    .catch((e) => {
        console.error('❌ Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
