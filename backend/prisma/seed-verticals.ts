/**
 * Seed Verticals
 *
 * Populates the Vertical table with the 10 existing top-level
 * verticals (status: ACTIVE) plus representative sub-verticals.
 *
 * Usage:
 *   npx ts-node prisma/seed-verticals.ts
 *
 * Safe to re-run — skips existing slugs.
 */

import { PrismaClient, VerticalStatus } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedVertical {
    slug: string;
    name: string;
    description?: string;
    requiresTcpa?: boolean;
    requiresKyc?: boolean;
    aliases?: string[];
    attributes?: Record<string, any>;
    restrictedGeos?: string[];
    children?: Omit<SeedVertical, 'children'>[];
}

const SEED_DATA: SeedVertical[] = [
    {
        slug: 'solar',
        name: 'Solar',
        description: 'Solar panel installation and energy leads',
        requiresTcpa: true,
        aliases: ['solar_energy', 'solar_panels'],
        attributes: { icon: 'sun', avgBudget: '>10K' },
        children: [
            { slug: 'solar.residential', name: 'Residential Solar', description: 'Home solar installations' },
            { slug: 'solar.commercial', name: 'Commercial Solar', description: 'Business and industrial solar' },
        ],
    },
    {
        slug: 'mortgage',
        name: 'Mortgage',
        description: 'Home loan and mortgage refinance leads',
        requiresTcpa: true,
        requiresKyc: true,
        aliases: ['home_loan', 'home_mortgage'],
        attributes: { icon: 'home', compliance: ['TCPA', 'RESPA'] },
        children: [
            { slug: 'mortgage.purchase', name: 'Purchase', description: 'Home purchase mortgage' },
            { slug: 'mortgage.refinance', name: 'Refinance', description: 'Mortgage refinancing', aliases: ['refi'] },
        ],
    },
    {
        slug: 'roofing',
        name: 'Roofing',
        description: 'Roof repair and replacement leads',
        requiresTcpa: true,
        aliases: ['roof_repair', 'roof_replacement'],
        attributes: { icon: 'hard-hat' },
        children: [
            { slug: 'roofing.repair', name: 'Roof Repair', description: 'Roof damage repair and patching' },
            { slug: 'roofing.replacement', name: 'Roof Replacement', description: 'Full roof replacement and installation' },
        ],
    },
    {
        slug: 'insurance',
        name: 'Insurance',
        description: 'Insurance policy leads across all types',
        requiresTcpa: true,
        requiresKyc: true,
        aliases: ['ins'],
        attributes: { icon: 'shield' },
        children: [
            { slug: 'insurance.auto', name: 'Auto Insurance', description: 'Vehicle insurance leads', aliases: ['car_insurance'] },
            { slug: 'insurance.home', name: 'Home Insurance', description: 'Homeowners insurance leads' },
            { slug: 'insurance.life', name: 'Life Insurance', description: 'Life insurance leads' },
        ],
    },
    {
        slug: 'home_services',
        name: 'Home Services',
        description: 'General home improvement and repair leads',
        requiresTcpa: true,
        aliases: ['home_improvement', 'home_repair'],
        attributes: { icon: 'wrench' },
        children: [
            { slug: 'home_services.plumbing', name: 'Plumbing', description: 'Plumbing repair and installation', aliases: ['plumber'] },
            { slug: 'home_services.electrical', name: 'Electrical', description: 'Electrical work and repairs', aliases: ['electrician'] },
            { slug: 'home_services.hvac', name: 'HVAC', description: 'Heating, ventilation, and air conditioning', aliases: ['heating_cooling'] },
            { slug: 'home_services.landscaping', name: 'Landscaping', description: 'Lawn care and landscaping services' },
        ],
    },
    {
        slug: 'b2b_saas',
        name: 'B2B SaaS',
        description: 'Business software and SaaS leads',
        aliases: ['saas', 'enterprise_software'],
        attributes: { icon: 'server' },
        children: [
            { slug: 'b2b_saas.crm', name: 'CRM Software', description: 'Customer relationship management tools' },
            { slug: 'b2b_saas.analytics', name: 'Analytics Platforms', description: 'Business intelligence and data analytics' },
        ],
    },
    {
        slug: 'real_estate',
        name: 'Real Estate',
        description: 'Property buying, selling, and rental leads',
        requiresTcpa: true,
        aliases: ['property', 'realty'],
        attributes: { icon: 'building' },
        children: [
            { slug: 'real_estate.residential', name: 'Residential', description: 'Home buying and selling leads' },
            { slug: 'real_estate.commercial', name: 'Commercial', description: 'Commercial property leads' },
        ],
    },
    {
        slug: 'auto',
        name: 'Auto',
        description: 'Auto sales, service, and warranty leads',
        requiresTcpa: true,
        aliases: ['automotive', 'car_sales'],
        attributes: { icon: 'car' },
        children: [
            { slug: 'auto.sales', name: 'Auto Sales', description: 'New and used car sales leads' },
            { slug: 'auto.warranty', name: 'Auto Warranty', description: 'Extended vehicle warranty leads' },
        ],
    },
    {
        slug: 'legal',
        name: 'Legal',
        description: 'Legal service and attorney leads',
        requiresTcpa: true,
        requiresKyc: true,
        aliases: ['attorney', 'lawyer'],
        attributes: { icon: 'gavel', compliance: ['TCPA', 'ABA'] },
        children: [
            { slug: 'legal.personal_injury', name: 'Personal Injury', description: 'PI attorney and claim leads', aliases: ['pi_lawyer'] },
            { slug: 'legal.family', name: 'Family Law', description: 'Divorce, custody, and family legal services' },
            { slug: 'legal.immigration', name: 'Immigration', description: 'Visa and immigration legal services', restrictedGeos: ['CN', 'RU', 'IR'] },
        ],
    },
    {
        slug: 'financial_services',
        name: 'Financial Services',
        description: 'Financial product and service leads',
        requiresTcpa: true,
        requiresKyc: true,
        aliases: ['finance', 'financial'],
        attributes: { icon: 'dollar-sign', compliance: ['TCPA', 'FCRA'] },
        children: [
            { slug: 'financial_services.debt_consolidation', name: 'Debt Consolidation', description: 'Debt consolidation and settlement', aliases: ['debt_relief'] },
            { slug: 'financial_services.banking', name: 'Banking', description: 'Banking products and services' },
            { slug: 'financial_services.credit_repair', name: 'Credit Repair', description: 'Credit score improvement services', aliases: ['credit_fix'] },
        ],
    },
];

// ============================================
// Dynamic Vertical Generator
// ============================================

const DYNAMIC_INDUSTRIES = [
    'healthcare', 'education', 'fitness', 'travel', 'hospitality',
    'ecommerce', 'logistics', 'construction', 'agriculture', 'energy',
    'telecom', 'media', 'gaming', 'cybersecurity', 'blockchain',
    'biotech', 'aerospace', 'environmental', 'food_delivery', 'pet_services',
];

const DYNAMIC_SPECIALIZATIONS: Record<string, string[]> = {
    healthcare: ['telemedicine', 'dental', 'urgent_care', 'mental_health'],
    education: ['tutoring', 'online_courses', 'test_prep', 'college_admissions'],
    fitness: ['personal_training', 'gym_membership', 'yoga', 'nutrition'],
    travel: ['flights', 'hotels', 'packages', 'cruises'],
    hospitality: ['restaurants', 'catering', 'event_venues'],
    ecommerce: ['dropshipping', 'marketplace', 'subscription_box'],
    logistics: ['freight', 'last_mile', 'warehousing'],
    construction: ['commercial', 'residential', 'renovation'],
    agriculture: ['farming_equipment', 'organic', 'precision_ag'],
    energy: ['wind', 'ev_charging', 'battery_storage'],
    telecom: ['business_internet', 'voip', 'mobile_plans'],
    media: ['advertising', 'content_creation', 'streaming'],
    gaming: ['esports', 'game_dev', 'vr_experiences'],
    cybersecurity: ['penetration_testing', 'compliance', 'managed_security'],
    blockchain: ['defi', 'nft_marketplace', 'tokenization'],
    biotech: ['clinical_trials', 'diagnostics', 'gene_therapy'],
    aerospace: ['satellite', 'drone_services', 'space_tourism'],
    environmental: ['carbon_credits', 'waste_management', 'water_treatment'],
    food_delivery: ['meal_kits', 'grocery', 'restaurant_delivery'],
    pet_services: ['veterinary', 'grooming', 'pet_insurance', 'boarding'],
};

function generateDynamicVerticals(count: number): SeedVertical[] {
    const shuffled = [...DYNAMIC_INDUSTRIES].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(count, DYNAMIC_INDUSTRIES.length));

    return selected.map((industry) => {
        const specs = DYNAMIC_SPECIALIZATIONS[industry] || [];
        const childCount = Math.min(1 + Math.floor(Math.random() * 3), specs.length);
        const selectedSpecs = specs.sort(() => Math.random() - 0.5).slice(0, childCount);

        return {
            slug: industry,
            name: industry.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            description: `${industry.replace(/_/g, ' ')} leads (dynamically generated)`,
            requiresTcpa: Math.random() > 0.5,
            requiresKyc: Math.random() > 0.7,
            aliases: [industry.replace(/_/g, '')],
            attributes: { icon: 'zap', generated: true },
            children: selectedSpecs.map((spec) => ({
                slug: `${industry}.${spec}`,
                name: spec.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
                description: `${spec.replace(/_/g, ' ')} sub-vertical`,
                aliases: [spec],
            })),
        };
    });
}

async function seedVerticals() {
    // Support --dynamic flag for generating additional verticals
    const isDynamic = process.argv.includes('--dynamic');
    const dynamicCountArg = process.argv.find((a) => a.startsWith('--count='));
    const dynamicCount = dynamicCountArg ? parseInt(dynamicCountArg.split('=')[1], 10) : 20;

    const allData = [...SEED_DATA];
    if (isDynamic) {
        const dynamicVerticals = generateDynamicVerticals(dynamicCount);
        allData.push(...dynamicVerticals);
        console.log(`🔄 Dynamic mode: generating ${dynamicVerticals.length} additional verticals\n`);
    }

    console.log('🌱 Seeding verticals...\n');

    let created = 0;
    let skipped = 0;

    for (const [i, v] of allData.entries()) {
        // Upsert top-level vertical
        const existing = await prisma.vertical.findUnique({ where: { slug: v.slug } });
        let parentId: string;

        if (existing) {
            console.log(`  ⏩ ${v.slug} (exists)`);
            parentId = existing.id;
            skipped++;
        } else {
            const record = await prisma.vertical.create({
                data: {
                    slug: v.slug,
                    name: v.name,
                    description: v.description,
                    depth: 0,
                    sortOrder: i,
                    attributes: v.attributes,
                    aliases: v.aliases ?? [],
                    status: VerticalStatus.ACTIVE,
                    requiresTcpa: v.requiresTcpa ?? false,
                    requiresKyc: v.requiresKyc ?? false,
                    restrictedGeos: v.restrictedGeos ?? [],
                },
            });
            parentId = record.id;
            console.log(`  ✅ ${v.slug}`);
            created++;
        }

        // Seed children
        if (v.children) {
            for (const [j, child] of v.children.entries()) {
                const childExisting = await prisma.vertical.findUnique({ where: { slug: child.slug } });
                if (childExisting) {
                    console.log(`    ⏩ ${child.slug} (exists)`);
                    skipped++;
                    continue;
                }

                await prisma.vertical.create({
                    data: {
                        slug: child.slug,
                        name: child.name,
                        description: child.description,
                        parentId,
                        depth: 1,
                        sortOrder: j,
                        aliases: child.aliases ?? [],
                        status: VerticalStatus.ACTIVE,
                        requiresTcpa: child.requiresTcpa ?? v.requiresTcpa ?? false,
                        requiresKyc: child.requiresKyc ?? v.requiresKyc ?? false,
                        restrictedGeos: child.restrictedGeos ?? [],
                    },
                });
                console.log(`    ✅ ${child.slug}`);
                created++;
            }
        }
    }

    console.log(`\n🎉 Done! Created: ${created}, Skipped: ${skipped}`);
}

seedVerticals()
    .catch((err) => {
        console.error('❌ Seed failed:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

export { generateDynamicVerticals, SEED_DATA, DYNAMIC_INDUSTRIES, DYNAMIC_SPECIALIZATIONS };
