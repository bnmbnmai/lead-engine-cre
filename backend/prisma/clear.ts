// =============================================
// Lead Engine CRE — Mock Data Cleaner
// =============================================
// Safely removes ONLY mock data (0xMOCK... wallets + @mockdemo.test emails).
// Does NOT touch real user data.
// SAFETY: Requires TEST_MODE=true.
//
// Usage:
//   TEST_MODE=true npx ts-node prisma/clear.ts
//   npm run db:clear-mock
// =============================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

if (process.env.TEST_MODE !== 'true') {
    console.error('❌  Clearing mock data requires TEST_MODE=true.');
    process.exit(1);
}

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  Lead Engine CRE — Clear Mock Data        ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log('║  Removing data with 0xMOCK... wallets    ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    // Find mock users by wallet prefix
    const mockUsers = await prisma.user.findMany({
        where: {
            walletAddress: { startsWith: '0xMOCK' },
        },
        select: { id: true, walletAddress: true },
    });

    if (mockUsers.length === 0) {
        console.log('  No mock data found. Database is clean.');
        return;
    }

    const mockUserIds = mockUsers.map((u) => u.id);
    console.log(`  Found ${mockUsers.length} mock users to remove.`);

    // Find related profiles
    const sellerProfiles = await prisma.sellerProfile.findMany({
        where: { userId: { in: mockUserIds } },
        select: { id: true },
    });
    const sellerIds = sellerProfiles.map((s) => s.id);

    const buyerProfiles = await prisma.buyerProfile.findMany({
        where: { userId: { in: mockUserIds } },
        select: { id: true },
    });

    // Delete in dependency order (deepest first)
    console.log('  → Deleting bids...');
    const bidsDeleted = await prisma.bid.deleteMany({
        where: {
            OR: [
                { buyerId: { in: mockUserIds } },
                { lead: { sellerId: { in: sellerIds } } },
            ],
        },
    });
    console.log(`    ${bidsDeleted.count} bids removed`);

    console.log('  → Deleting transactions...');
    const txDeleted = await prisma.transaction.deleteMany({
        where: {
            OR: [
                { buyerId: { in: mockUserIds } },
                { lead: { sellerId: { in: sellerIds } } },
            ],
        },
    });
    console.log(`    ${txDeleted.count} transactions removed`);

    console.log('  → Deleting auction rooms...');
    const roomsDeleted = await prisma.auctionRoom.deleteMany({
        where: { lead: { sellerId: { in: sellerIds } } },
    });
    console.log(`    ${roomsDeleted.count} auction rooms removed`);

    console.log('  → Deleting leads...');
    const leadsDeleted = await prisma.lead.deleteMany({
        where: { sellerId: { in: sellerIds } },
    });
    console.log(`    ${leadsDeleted.count} leads removed`);

    console.log('  → Deleting asks...');
    const asksDeleted = await prisma.ask.deleteMany({
        where: { sellerId: { in: sellerIds } },
    });
    console.log(`    ${asksDeleted.count} asks removed`);

    console.log('  → Deleting compliance checks...');
    const complianceDeleted = await prisma.complianceCheck.deleteMany({
        where: { entityId: { in: mockUserIds } },
    });
    console.log(`    ${complianceDeleted.count} compliance checks removed`);

    console.log('  → Deleting analytics events...');
    const auditDeleted = await prisma.analyticsEvent.deleteMany({
        where: { userId: { in: mockUserIds } },
    });
    console.log(`    ${auditDeleted.count} audit events removed`);

    console.log('  → Deleting sessions & API keys...');
    await prisma.session.deleteMany({ where: { userId: { in: mockUserIds } } });
    await prisma.apiKey.deleteMany({ where: { userId: { in: mockUserIds } } });

    console.log('  → Deleting profiles...');
    await prisma.buyerProfile.deleteMany({ where: { userId: { in: mockUserIds } } });
    await prisma.sellerProfile.deleteMany({ where: { userId: { in: mockUserIds } } });

    console.log('  → Deleting users...');
    const usersDeleted = await prisma.user.deleteMany({
        where: { id: { in: mockUserIds } },
    });
    console.log(`    ${usersDeleted.count} users removed`);

    console.log('');
    console.log('✅ Mock data cleared!');
    console.log('');
    console.log('  Summary:');
    console.log(`    Users:     ${usersDeleted.count}`);
    console.log(`    Leads:     ${leadsDeleted.count}`);
    console.log(`    Asks:      ${asksDeleted.count}`);
    console.log(`    Bids:      ${bidsDeleted.count}`);
    console.log(`    Profiles:  ${sellerProfiles.length + buyerProfiles.length}`);
    console.log('');
}

main()
    .catch((e) => {
        console.error('❌ Clear failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
