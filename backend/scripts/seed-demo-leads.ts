/**
 * Demo Lead Seeder Script
 * 
 * Populates the database with realistic leads, bids, and transactions
 * for demo purposes. Creates a mix of:
 * - 20 leads across all 10 verticals
 * - Different statuses: IN_AUCTION (70%), SOLD (20%), EXPIRED (10%)
 * - 5-10 bids per auctioned lead
 * - Realistic pricing and geo-targeting
 * 
 * Usage:
 *   npm run demo:seed
 *   npm run demo:clear (to remove demo data)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Demo data prefix
const DEMO_PREFIX = '0x88DDA5D4';  // Prefix for identifying demo data (real Sepolia addr prefix)

const VERTICALS = [
    'solar', 'mortgage', 'roofing', 'insurance', 'home_services',
    'b2b_saas', 'real_estate', 'auto', 'legal', 'financial'
];

const STATES = ['CA', 'TX', 'FL', 'NY', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI'];

const VERTICAL_PRICING: Record<string, { min: number; max: number }> = {
    solar: { min: 25, max: 75 },
    mortgage: { min: 30, max: 100 },
    roofing: { min: 20, max: 60 },
    insurance: { min: 15, max: 50 },
    home_services: { min: 10, max: 30 },
    b2b_saas: { min: 50, max: 200 },
    real_estate: { min: 40, max: 150 },
    auto: { min: 12, max: 40 },
    legal: { min: 35, max: 120 },
    financial: { min: 45, max: 180 },
};

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem<T>(arr: T[]): T {
    return arr[randomInt(0, arr.length - 1)];
}

function randomPrice(vertical: string): number {
    const { min, max } = VERTICAL_PRICING[vertical];
    return randomInt(min, max);
}

function daysAgo(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
}

async function seed() {
    console.log('🌱 Starting demo seeder...\n');

    // Check for existing demo data
    const existingDemo = await prisma.lead.findFirst({
        where: { sellerAddress: { startsWith: DEMO_PREFIX } }
    });

    if (existingDemo) {
        console.log('⚠️  Demo data already exists. Run `npm run demo:clear` first.\n');
        return;
    }

    // Create demo users (seller and buyer wallets)
    const demoSeller = `${DEMO_PREFIX}SELLER${randomInt(1000, 9999)}`;
    const demoBuyers = Array.from({ length: 5 }, (_, i) =>
        `${DEMO_PREFIX}BUYER${i + 1}${randomInt(100, 999)}`
    );

    console.log(`👤 Demo seller: ${demoSeller}`);
    console.log(`👥 Demo buyers: ${demoBuyers.length} created\n`);

    const leads: any[] = [];
    const totalLeads = 20;

    for (let i = 0; i < totalLeads; i++) {
        const vertical = VERTICALS[i % VERTICALS.length];
        const reservePrice = randomPrice(vertical);
        const state = randomItem(STATES);
        const createdAt = daysAgo(randomInt(0, 7));

        // Determine status distribution
        const rand = Math.random();
        let status: 'IN_AUCTION' | 'SOLD' | 'EXPIRED';
        if (rand < 0.7) status = 'IN_AUCTION';
        else if (rand < 0.9) status = 'SOLD';
        else status = 'EXPIRED';

        const leadData: any = {
            sellerAddress: demoSeller,
            vertical,
            geoState: state,
            geoCity: `${state} City`,
            geoZipCode: `${randomInt(10000, 99999)}`,
            leadDataHash: `ipfs://demo-hash-${i}`,
            encryptedData: `encrypted-demo-${i}`,
            tcpaConsent: true,
            reservePrice,
            buyNowPrice: Math.random() > 0.5 ? reservePrice * 1.5 : null,
            status,
            auctionEnds: status === 'IN_AUCTION'
                ? new Date(Date.now() + randomInt(1, 72) * 3600000)  // 1-72 hours
                : new Date(createdAt.getTime() + 2 * 24 * 3600000),  // 2 days after creation
            createdAt,
            updatedAt: createdAt,
        };

        // If sold, set buyer
        if (status === 'SOLD') {
            leadData.buyerAddress = randomItem(demoBuyers);
            leadData.soldAt = daysAgo(randomInt(0, 5));
            leadData.finalPrice = randomInt(reservePrice, Math.floor(reservePrice * 1.3));
        }

        leads.push(leadData);
    }

    // Insert leads
    console.log('📦 Creating leads...');
    const createdLeads = await prisma.lead.createMany({ data: leads });
    console.log(`✅ Created ${createdLeads.count} leads\n`);

    // Fetch created leads for bidding
    const leadsInDb = await prisma.lead.findMany({
        where: { sellerAddress: demoSeller },
        select: { id: true, status: true, reservePrice: true },
    });

    // Create bids for IN_AUCTION leads
    console.log('💰 Creating bids...');
    let bidCount = 0;

    for (const lead of leadsInDb) {
        if (lead.status !== 'IN_AUCTION') continue;

        const numBids = randomInt(5, 10);
        for (let i = 0; i < numBids; i++) {
            const buyer = randomItem(demoBuyers);
            const amount = lead.reservePrice + randomInt(0, 20);

            await prisma.bid.create({
                data: {
                    leadId: lead.id,
                    buyerAddress: buyer,
                    amount,
                    isActive: i === numBids - 1,  // Last bid is active (highest)
                    createdAt: daysAgo(randomInt(1, 7)),
                },
            });

            bidCount++;
        }
    }

    console.log(`✅ Created ${bidCount} bids\n`);

    console.log('🎉 Demo seeder complete!\n');
    console.log('Summary:');
    console.log(`  - ${createdLeads.count} leads`);
    console.log(`  - ${bidCount} bids`);
    console.log(`  - ${demoBuyers.length} demo buyers`);
    console.log('\n🔍 View demo data in the marketplace!');
}

async function clear() {
    console.log('🗑️  Clearing demo data...\n');

    // Delete all demo data by prefix
    const deletedBids = await prisma.bid.deleteMany({
        where: { buyerAddress: { startsWith: DEMO_PREFIX } },
    });

    const deletedLeads = await prisma.lead.deleteMany({
        where: {
            OR: [
                { sellerAddress: { startsWith: DEMO_PREFIX } },
                { buyerAddress: { startsWith: DEMO_PREFIX } },
            ]
        },
    });

    console.log(`✅ Deleted ${deletedLeads.count} leads`);
    console.log(`✅ Deleted ${deletedBids.count} bids\n`);
    console.log('✨ Demo data cleared!');
}

// Run based on script argument
const command = process.argv[2];

async function main() {
    try {
        if (command === 'clear') {
            await clear();
        } else {
            await seed();
        }
    } catch (error) {
        console.error('❌ Seeder error:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
