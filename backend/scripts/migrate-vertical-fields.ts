/**
 * One-time migration: Backfill VerticalField records from existing Vertical.formConfig JSON.
 *
 * Safe to run multiple times — each run deletes + recreates all VerticalField rows
 * for every vertical (idempotent).
 *
 * Usage:
 *   npx tsx scripts/migrate-vertical-fields.ts
 *
 * Requires DATABASE_URL in .env.
 */

import { PrismaClient } from '@prisma/client';
import { syncVerticalFieldsInTransaction, FormConfigField } from '../src/services/vertical-field.service';

const prisma = new PrismaClient();

async function main() {
    console.log('═'.repeat(60));
    console.log('📦 MIGRATE VERTICAL FIELDS');
    console.log('═'.repeat(60));

    const verticals = await prisma.vertical.findMany({
        select: { id: true, slug: true, name: true, formConfig: true },
        orderBy: { slug: 'asc' },
    });

    console.log(`\nFound ${verticals.length} verticals.\n`);

    let totalSynced = 0;
    let skipped = 0;
    let errors = 0;

    for (const v of verticals) {
        const config = v.formConfig as { fields?: FormConfigField[] } | null;
        const fields = config?.fields;

        if (!fields || fields.length === 0) {
            console.log(`  ⏭  ${v.slug.padEnd(40)} — no formConfig, skipped`);
            skipped++;
            continue;
        }

        try {
            const result = await syncVerticalFieldsInTransaction(v.id, fields);
            totalSynced += result.synced;
            console.log(`  ✅ ${v.slug.padEnd(40)} — ${result.synced} fields synced`);
        } catch (err) {
            errors++;
            console.error(`  ❌ ${v.slug.padEnd(40)} — ERROR: ${(err as Error).message}`);
        }
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`📋 SUMMARY`);
    console.log(`   Verticals processed: ${verticals.length}`);
    console.log(`   Fields synced:       ${totalSynced}`);
    console.log(`   Skipped (no config): ${skipped}`);
    console.log(`   Errors:              ${errors}`);
    console.log('═'.repeat(60));
}

main()
    .then(() => {
        console.log('\n✅ Migration complete.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Migration failed:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
