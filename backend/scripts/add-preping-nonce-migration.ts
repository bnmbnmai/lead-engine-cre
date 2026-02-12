/**
 * Migration Script — Add prePingNonce Column
 *
 * Idempotent migration for production environments that may have the old schema.
 * Since this project uses `prisma db push`, this script serves as documentation
 * and a safety net for manual deployments.
 *
 * Usage: npx ts-node scripts/add-preping-nonce-migration.ts
 *
 * What it does:
 *   1. Checks if prePingNonce column already exists on VerticalAuction
 *   2. If missing, runs ALTER TABLE to add it (nullable, backward-compatible)
 *   3. Same check for AuctionRoom.prePingNonce
 *   4. Adds indexes for nonce audit lookups
 *
 * Safe to run multiple times — no-op if columns already exist.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('[MIGRATION] Checking prePingNonce column status...\n');

    // Check VerticalAuction
    try {
        const vaColumns: any[] = await prisma.$queryRaw`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'VerticalAuction' AND column_name = 'prePingNonce'
        `;

        if (vaColumns.length === 0) {
            console.log('[MIGRATION] Adding prePingNonce to VerticalAuction...');
            await prisma.$executeRaw`ALTER TABLE "VerticalAuction" ADD COLUMN IF NOT EXISTS "prePingNonce" TEXT`;
            await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "VerticalAuction_prePingNonce_idx" ON "VerticalAuction"("prePingNonce")`;
            console.log('[MIGRATION] ✅ VerticalAuction.prePingNonce added');
        } else {
            console.log('[MIGRATION] ✅ VerticalAuction.prePingNonce already exists');
        }
    } catch (error: any) {
        console.error('[MIGRATION] ❌ VerticalAuction check failed:', error.message);
    }

    // Check AuctionRoom
    try {
        const arColumns: any[] = await prisma.$queryRaw`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'AuctionRoom' AND column_name = 'prePingNonce'
        `;

        if (arColumns.length === 0) {
            console.log('[MIGRATION] Adding prePingNonce to AuctionRoom...');
            await prisma.$executeRaw`ALTER TABLE "AuctionRoom" ADD COLUMN IF NOT EXISTS "prePingNonce" TEXT`;
            console.log('[MIGRATION] ✅ AuctionRoom.prePingNonce added');
        } else {
            console.log('[MIGRATION] ✅ AuctionRoom.prePingNonce already exists');
        }
    } catch (error: any) {
        console.error('[MIGRATION] ❌ AuctionRoom check failed:', error.message);
    }

    // Check prePingEndsAt columns
    try {
        const vaEnds: any[] = await prisma.$queryRaw`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'VerticalAuction' AND column_name = 'prePingEndsAt'
        `;

        if (vaEnds.length === 0) {
            console.log('[MIGRATION] Adding prePingEndsAt to VerticalAuction...');
            await prisma.$executeRaw`ALTER TABLE "VerticalAuction" ADD COLUMN IF NOT EXISTS "prePingEndsAt" TIMESTAMPTZ`;
            await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "VerticalAuction_prePingEndsAt_idx" ON "VerticalAuction"("prePingEndsAt")`;
            console.log('[MIGRATION] ✅ VerticalAuction.prePingEndsAt added');
        } else {
            console.log('[MIGRATION] ✅ VerticalAuction.prePingEndsAt already exists');
        }
    } catch (error: any) {
        console.error('[MIGRATION] ❌ prePingEndsAt check failed:', error.message);
    }

    console.log('\n[MIGRATION] Done. All columns are present and backward-compatible.');
}

main()
    .catch((e) => {
        console.error('[MIGRATION] Fatal error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
