/**
 * Migration Script — Backfill null effectiveBid on pre-existing bids
 *
 * For bids placed before the priority bidding feature, effectiveBid is null.
 * This script sets effectiveBid = amount for all such bids, ensuring
 * resolveAuction ordering works correctly without relying on fallback logic.
 *
 * Usage:  npx ts-node scripts/backfill-effective-bid.ts
 * Safety: Read-only by default. Pass --commit to apply changes.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--commit');

async function main() {
    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  Backfill effectiveBid on legacy bids    ║`);
    console.log(`║  Mode: ${DRY_RUN ? 'DRY RUN (pass --commit to apply)' : '⚠️  COMMITTING CHANGES'}       ║`);
    console.log(`╚══════════════════════════════════════════╝\n`);

    // 1. Count affected bids
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
        return;
    }

    let updated = 0;
    const BATCH_SIZE = 100;

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
}

main()
    .catch((e) => {
        console.error('❌ Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
