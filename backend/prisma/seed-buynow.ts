// =============================================
// Lead Engine CRE — Seed Buy It Now (UNSOLD) Demo Leads
// =============================================
// Creates 6 UNSOLD leads across different verticals, geos, and price points.
// IDEMPOTENT: skips creation if leads with matching dataHash already exist.
// SAFETY: Requires TEST_MODE=true.
//
// Usage:
//   TEST_MODE=true npx tsx prisma/seed-buynow.ts
// =============================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Safety Gate ────────────────────────────
if (process.env.TEST_MODE !== 'true') {
    console.error('❌  Seeding requires TEST_MODE=true to prevent data pollution.');
    process.exit(1);
}

// ─── Demo UNSOLD Leads ──────────────────────
// These simulate auction leads that ended without a winner.
// buyNowPrice = reservePrice × 1.2 (matching the RTB engine logic)
// expiresAt = 7 days from now

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface DemoLead {
    tag: string;                // Unique tag for idempotency
    vertical: string;
    geo: { country: string; state: string; city: string; zip: string };
    source: 'PLATFORM' | 'API' | 'OFFSITE';
    reservePrice: number;
    isVerified: boolean;
    parameters: Record<string, unknown>;
}

const DEMO_LEADS: DemoLead[] = [
    {
        tag: 'demo-bin-solar-ca',
        vertical: 'solar.residential',
        geo: { country: 'US', state: 'CA', city: 'Los Angeles', zip: '90210' },
        source: 'PLATFORM',
        reservePrice: 42.00,
        isVerified: true,
        parameters: {
            roof_age: '8',
            monthly_bill: 280,
            ownership: 'own',
            panel_interest: 'purchase',
            shade_level: 'none',
        },
    },
    {
        tag: 'demo-bin-mortgage-tx',
        vertical: 'mortgage.refinance',
        geo: { country: 'US', state: 'TX', city: 'Houston', zip: '77001' },
        source: 'API',
        reservePrice: 65.00,
        isVerified: true,
        parameters: {
            loan_type: 'refinance',
            credit_range: 'excellent_750+',
            property_type: 'single_family',
            purchase_price: 420000,
            down_payment_pct: 20,
        },
    },
    {
        tag: 'demo-bin-insurance-fl',
        vertical: 'insurance.auto',
        geo: { country: 'US', state: 'FL', city: 'Miami', zip: '33101' },
        source: 'PLATFORM',
        reservePrice: 28.50,
        isVerified: false,
        parameters: {
            coverage_type: 'auto',
            current_provider: 'Geico',
            num_drivers: 2,
        },
    },
    {
        tag: 'demo-bin-legal-ny',
        vertical: 'legal.personal_injury',
        geo: { country: 'US', state: 'NY', city: 'New York', zip: '10001' },
        source: 'PLATFORM',
        reservePrice: 85.00,
        isVerified: true,
        parameters: {
            case_type: 'personal_injury',
            urgency: 'immediate',
            has_attorney: false,
        },
    },
    {
        tag: 'demo-bin-roofing-gb',
        vertical: 'roofing',
        geo: { country: 'GB', state: 'England', city: 'London', zip: 'SW1A 1AA' },
        source: 'OFFSITE',
        reservePrice: 35.00,
        isVerified: true,
        parameters: {
            roof_type: 'tile',
            damage_type: 'storm',
            insurance_claim: true,
            roof_age: 15,
            square_footage: 2200,
        },
    },
    {
        tag: 'demo-bin-b2bsaas-au',
        vertical: 'b2b_saas',
        geo: { country: 'AU', state: 'NSW', city: 'Sydney', zip: '2000' },
        source: 'API',
        reservePrice: 120.00,
        isVerified: true,
        parameters: {
            company_size: '51-200',
            industry: 'tech',
            budget_range: '25k-100k',
            decision_timeline: '1_month',
        },
    },
];

async function main() {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║  Seed Buy It Now Demo Leads                  ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    // 1. Find an existing seller to attach leads to
    const seller = await prisma.sellerProfile.findFirst({
        orderBy: { reputationScore: 'desc' },
    });

    if (!seller) {
        console.error('❌  No seller profiles found. Run the main seed first: npm run db:seed');
        process.exit(1);
    }
    console.log(`📦 Using seller: ${seller.companyName || seller.id} (rep: ${seller.reputationScore})`);

    // 2. Seed UNSOLD leads
    let created = 0;
    let skipped = 0;

    for (const demo of DEMO_LEADS) {
        // Idempotency: check if a lead with this tag already exists
        const existing = await prisma.lead.findFirst({
            where: { dataHash: demo.tag },
        });

        if (existing) {
            console.log(`  ⏭️  ${demo.tag} — already exists (${existing.id})`);
            skipped++;
            continue;
        }

        const now = new Date();
        const buyNowPrice = +(demo.reservePrice * 1.2).toFixed(2);
        const expiresAt = new Date(now.getTime() + SEVEN_DAYS_MS);
        // Fake auction ended 1-3 hours ago
        const auctionEndAt = new Date(now.getTime() - (1 + Math.random() * 2) * 60 * 60 * 1000);
        const auctionStartAt = new Date(auctionEndAt.getTime() - 5 * 60 * 1000); // 5-min auction

        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical: demo.vertical,
                geo: demo.geo,
                source: demo.source,
                status: 'UNSOLD',
                reservePrice: demo.reservePrice,
                buyNowPrice,
                isVerified: demo.isVerified,
                parameters: demo.parameters,
                dataHash: demo.tag,    // Used as idempotency key
                expiresAt,
                auctionStartAt,
                auctionEndAt,
            },
        });

        console.log(`  ✅ ${demo.tag} → ${lead.id}  ($${demo.reservePrice} → BIN $${buyNowPrice})  expires ${expiresAt.toISOString().split('T')[0]}`);
        created++;
    }

    console.log(`\n📊 Results: ${created} created, ${skipped} skipped (already existed)`);
    console.log('🛒 Buy Now tab should now show these leads!\n');
}

main()
    .catch((e) => {
        console.error('❌ Seed error:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
