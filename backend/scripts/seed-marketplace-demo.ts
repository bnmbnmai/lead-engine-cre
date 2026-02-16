/**
 * Seed demo marketplace leads for testing field-level filters.
 * Creates 15 leads across 5 verticals with varied quality scores, prices, and field values.
 * 
 * Usage:
 *   npx tsx scripts/seed-marketplace-demo.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_LEADS = [
    // Solar Residential (5 leads)
    {
        vertical: 'solar.residential',
        geo: { state: 'CA', city: 'San Diego', zip: '92101', country: 'US' },
        parameters: {
            roof_condition: 'Excellent',
            system_size: 15,
            homeowner: true,
            electric_bill: 250,
            roof_age: 5,
        },
        reservePrice: 180,
        buyNowPrice: 250,
        qualityScore: 92,
    },
    {
        vertical: 'solar.residential',
        geo: { state: 'TX', city: 'Austin', zip: '78701', country: 'US' },
        parameters: {
            roof_condition: 'Good',
            system_size: 12,
            homeowner: true,
            electric_bill: 180,
            roof_age: 10,
        },
        reservePrice: 120,
        qualityScore: 78,
    },
    {
        vertical: 'solar.residential',
        geo: { state: 'FL', city: 'Miami', zip: '33101', country: 'US' },
        parameters: {
            roof_condition: 'Fair',
            system_size: 8,
            homeowner: false,
            electric_bill: 150,
            roof_age: 15,
        },
        reservePrice: 60,
        qualityScore: 54,
    },
    {
        vertical: 'solar.residential',
        geo: { state: 'AZ', city: 'Phoenix', zip: '85001', country: 'US' },
        parameters: {
            roof_condition: 'Excellent',
            system_size: 20,
            homeowner: true,
            electric_bill: 300,
            roof_age: 3,
        },
        reservePrice: 220,
        buyNowPrice: 300,
        qualityScore: 95,
    },
    {
        vertical: 'solar.residential',
        geo: { state: 'NV', city: 'Las Vegas', zip: '89101', country: 'US' },
        parameters: {
            roof_condition: 'Good',
            system_size: 10,
            homeowner: true,
            electric_bill: 200,
            roof_age: 8,
        },
        reservePrice: 100,
        qualityScore: 71,
    },

    // Roofing Replacement (3 leads)
    {
        vertical: 'roofing.replacement',
        geo: { state: 'NY', city: 'New York', zip: '10001', country: 'US' },
        parameters: {
            roof_type: 'Asphalt Shingle',
            roof_age: 25,
            roof_size: 2500,
            leak_present: true,
            insurance_claim: false,
        },
        reservePrice: 150,
        buyNowPrice: 200,
        qualityScore: 88,
    },
    {
        vertical: 'roofing.replacement',
        geo: { state: 'WA', city: 'Seattle', zip: '98101', country: 'US' },
        parameters: {
            roof_type: 'Metal',
            roof_age: 15,
            roof_size: 1800,
            leak_present: false,
            insurance_claim: true,
        },
        reservePrice: 120,
        qualityScore: 65,
    },
    {
        vertical: 'roofing.replacement',
        geo: { state: 'GA', city: 'Atlanta', zip: '30301', country: 'US' },
        parameters: {
            roof_type: 'Tile',
            roof_age: 30,
            roof_size: 3000,
            leak_present: true,
            insurance_claim: true,
        },
        reservePrice: 200,
        qualityScore: 81,
    },

    // Mortgage Purchase (3 leads)
    {
        vertical: 'mortgage.purchase',
        geo: { state: 'CA', city: 'Los Angeles', zip: '90001', country: 'US' },
        parameters: {
            property_type: 'Single Family',
            purchase_price: 750000,
            down_payment: 150000,
            credit_score: 780,
            first_time_buyer: false,
        },
        reservePrice: 300,
        buyNowPrice: 400,
        qualityScore: 93,
    },
    {
        vertical: 'mortgage.purchase',
        geo: { state: 'IL', city: 'Chicago', zip: '60601', country: 'US' },
        parameters: {
            property_type: 'Condo',
            purchase_price: 450000,
            down_payment: 90000,
            credit_score: 720,
            first_time_buyer: true,
        },
        reservePrice: 180,
        qualityScore: 76,
    },
    {
        vertical: 'mortgage.purchase',
        geo: { state: 'TX', city: 'Dallas', zip: '75201', country: 'US' },
        parameters: {
            property_type: 'Townhouse',
            purchase_price: 350000,
            down_payment: 70000,
            credit_score: 680,
            first_time_buyer: true,
        },
        reservePrice: 120,
        qualityScore: 62,
    },

    // Insurance Auto (2 leads)
    {
        vertical: 'insurance.auto',
        geo: { state: 'FL', city: 'Tampa', zip: '33601', country: 'US' },
        parameters: {
            vehicle_year: 2022,
            vehicle_make: 'Toyota',
            vehicle_model: 'Camry',
            coverage_type: 'Full Coverage',
            drivers: 2,
        },
        reservePrice: 40,
        buyNowPrice: 60,
        qualityScore: 84,
    },
    {
        vertical: 'insurance.auto',
        geo: { state: 'OH', city: 'Columbus', zip: '43201', country: 'US' },
        parameters: {
            vehicle_year: 2019,
            vehicle_make: 'Honda',
            vehicle_model: 'Accord',
            coverage_type: 'Liability Only',
            drivers: 1,
        },
        reservePrice: 25,
        qualityScore: 58,
    },

    // HVAC (2 leads)
    {
        vertical: 'home_services.hvac',
        geo: { state: 'AZ', city: 'Tucson', zip: '85701', country: 'US' },
        parameters: {
            service_needed: 'Installation',
            system_type: 'Central AC',
            home_size: 2200,
            urgency: 'Within 1 week',
            current_system_age: 20,
        },
        reservePrice: 90,
        buyNowPrice: 130,
        qualityScore: 87,
    },
    {
        vertical: 'home_services.hvac',
        geo: { state: 'CO', city: 'Denver', zip: '80201', country: 'US' },
        parameters: {
            service_needed: 'Repair',
            system_type: 'Heat Pump',
            home_size: 1800,
            urgency: 'Emergency',
            current_system_age: 8,
        },
        reservePrice: 50,
        qualityScore: 72,
    },
];

async function main() {
    console.log('═'.repeat(60));
    console.log('🌱 SEED MARKETPLACE DEMO LEADS');
    console.log('═'.repeat(60));

    // Find a demo seller (or create one)
    let seller = await prisma.user.findFirst({
        where: { role: 'SELLER', companyName: { not: null } },
    });

    if (!seller) {
        console.log('\n⚠️  No seller found. Creating demo seller...');
        seller = await prisma.user.create({
            data: {
                address: '0xDEMOSELLER0000000000000000000000000000',
                role: 'SELLER',
                companyName: 'Demo Lead Co.',
                isVerified: true,
                reputationScore: 8500,
            },
        });
        console.log(`✅ Created demo seller: ${seller.companyName} (${seller.id})`);
    }

    console.log(`\n📦 Using seller: ${seller.companyName || seller.address}\n`);

    let created = 0;
    let skipped = 0;

    for (const leadData of DEMO_LEADS) {
        try {
            // Check if a similar lead already exists (same vertical + state + qualityScore)
            const existing = await prisma.lead.findFirst({
                where: {
                    vertical: leadData.vertical,
                    geo: { path: ['state'], equals: leadData.geo.state },
                    qualityScore: leadData.qualityScore,
                    status: 'IN_AUCTION',
                },
            });

            if (existing) {
                skipped++;
                console.log(`  ⏭  ${leadData.vertical.padEnd(30)} — already exists (${leadData.geo.state})`);
                continue;
            }

            const lead = await prisma.lead.create({
                data: {
                    vertical: leadData.vertical,
                    geo: leadData.geo,
                    parameters: leadData.parameters,
                    status: 'IN_AUCTION',
                    source: 'demo-seed',
                    reservePrice: leadData.reservePrice,
                    buyNowPrice: leadData.buyNowPrice,
                    qualityScore: leadData.qualityScore,
                    isVerified: true,
                    auctionEndAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24h from now
                    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
                    sellerId: seller.id,
                },
            });

            created++;
            console.log(
                `  ✅ ${leadData.vertical.padEnd(30)} — $${leadData.reservePrice.toString().padStart(3)} | Q${leadData.qualityScore} | ${leadData.geo.state}`
            );
        } catch (err) {
            console.error(`  ❌ ${leadData.vertical} — ERROR: ${(err as Error).message}`);
        }
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`📋 SUMMARY`);
    console.log(`   Leads created:  ${created}`);
    console.log(`   Skipped (dupe): ${skipped}`);
    console.log('═'.repeat(60));
}

main()
    .then(() => {
        console.log('\n✅ Seed complete.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Seed failed:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
