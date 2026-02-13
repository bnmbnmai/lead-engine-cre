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
import { FORM_CONFIG_TEMPLATES } from '../src/data/form-config-templates';

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
            { slug: 'solar.residential', name: 'Residential Solar', description: 'Home solar installations', aliases: ['home_solar'] },
            { slug: 'solar.commercial', name: 'Commercial Solar', description: 'Business and industrial solar', aliases: ['commercial_panels'] },
            { slug: 'solar.battery_storage', name: 'Battery Storage', description: 'Solar battery and energy storage systems', aliases: ['solar_battery', 'powerwall'] },
            { slug: 'solar.community', name: 'Community Solar', description: 'Shared solar farm and community programs', aliases: ['solar_garden', 'shared_solar'] },
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
            { slug: 'mortgage.purchase', name: 'Purchase', description: 'Home purchase mortgage', aliases: ['home_purchase'] },
            { slug: 'mortgage.refinance', name: 'Refinance', description: 'Mortgage refinancing', aliases: ['refi'] },
            { slug: 'mortgage.heloc', name: 'HELOC', description: 'Home equity line of credit', aliases: ['home_equity', 'equity_line'] },
            { slug: 'mortgage.reverse', name: 'Reverse Mortgage', description: 'Reverse mortgage for seniors 62+', aliases: ['hecm', 'reverse_mortgage'] },
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
            { slug: 'roofing.repair', name: 'Roof Repair', description: 'Roof damage repair and patching', aliases: ['roof_patch', 'leak_repair'] },
            { slug: 'roofing.replacement', name: 'Roof Replacement', description: 'Full roof replacement and installation', aliases: ['reroof', 'new_roof'] },
            { slug: 'roofing.inspection', name: 'Roof Inspection', description: 'Professional roof inspection and assessment', aliases: ['roof_assessment', 'roof_check'] },
            { slug: 'roofing.gutter', name: 'Gutters & Drainage', description: 'Gutter installation, repair, and drainage systems', aliases: ['gutter_install', 'downspout'] },
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
            { slug: 'insurance.home', name: 'Home Insurance', description: 'Homeowners insurance leads', aliases: ['homeowners_insurance'] },
            { slug: 'insurance.life', name: 'Life Insurance', description: 'Life insurance leads', aliases: ['life_ins'] },
            { slug: 'insurance.health', name: 'Health Insurance', description: 'Health and medical insurance leads', aliases: ['medical_insurance', 'health_plan'] },
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
            { slug: 'home_services.plumbing', name: 'Plumbing', description: 'Plumbing repair and installation', aliases: ['plumber', 'pipe_repair'] },
            { slug: 'home_services.electrical', name: 'Electrical', description: 'Electrical work and repairs', aliases: ['electrician', 'wiring'] },
            { slug: 'home_services.hvac', name: 'HVAC', description: 'Heating, ventilation, and air conditioning', aliases: ['heating_cooling', 'ac_repair'] },
            { slug: 'home_services.landscaping', name: 'Landscaping', description: 'Lawn care and landscaping services', aliases: ['lawn_care', 'yard_work'] },
        ],
    },
    {
        slug: 'b2b_saas',
        name: 'B2B SaaS',
        description: 'Business software and SaaS leads',
        aliases: ['saas', 'enterprise_software'],
        attributes: { icon: 'server' },
        children: [
            { slug: 'b2b_saas.crm', name: 'CRM Software', description: 'Customer relationship management tools', aliases: ['salesforce_alt', 'crm'] },
            { slug: 'b2b_saas.analytics', name: 'Analytics Platforms', description: 'Business intelligence and data analytics', aliases: ['bi_tools', 'data_analytics'] },
            { slug: 'b2b_saas.marketing_automation', name: 'Marketing Automation', description: 'Email marketing and campaign automation tools', aliases: ['email_marketing', 'martech'] },
            { slug: 'b2b_saas.hr_tech', name: 'HR Technology', description: 'Human resources and talent management platforms', aliases: ['hris', 'hr_software'] },
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
            { slug: 'real_estate.residential', name: 'Residential', description: 'Home buying and selling leads', aliases: ['home_buying', 'home_selling'] },
            { slug: 'real_estate.commercial', name: 'Commercial', description: 'Commercial property leads', aliases: ['commercial_property', 'office_space'] },
            { slug: 'real_estate.rental', name: 'Rental & Property Mgmt', description: 'Rental property and property management leads', aliases: ['rental', 'property_management'] },
            { slug: 'real_estate.land', name: 'Vacant Land', description: 'Land sales and development leads', aliases: ['land_sale', 'lot_sale'] },
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
            { slug: 'auto.sales', name: 'Auto Sales', description: 'New and used car sales leads', aliases: ['car_dealer', 'vehicle_sales'] },
            { slug: 'auto.warranty', name: 'Auto Warranty', description: 'Extended vehicle warranty leads', aliases: ['extended_warranty', 'vehicle_protection'] },
            { slug: 'auto.repair', name: 'Auto Repair', description: 'Auto repair and maintenance service leads', aliases: ['car_repair', 'mechanic'] },
            { slug: 'auto.insurance', name: 'Auto Insurance', description: 'Vehicle insurance comparison and quotes', aliases: ['car_insurance_quote'] },
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
            { slug: 'legal.personal_injury', name: 'Personal Injury', description: 'PI attorney and claim leads', aliases: ['pi_lawyer', 'accident_lawyer'] },
            { slug: 'legal.family', name: 'Family Law', description: 'Divorce, custody, and family legal services', aliases: ['divorce_lawyer', 'custody'] },
            { slug: 'legal.immigration', name: 'Immigration', description: 'Visa and immigration legal services', aliases: ['visa_lawyer', 'immigration_attorney'], restrictedGeos: ['CN', 'RU', 'IR'] },
            { slug: 'legal.criminal_defense', name: 'Criminal Defense', description: 'Criminal defense attorney leads', aliases: ['criminal_lawyer', 'defense_attorney'] },
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
            { slug: 'financial_services.debt_consolidation', name: 'Debt Consolidation', description: 'Debt consolidation and settlement', aliases: ['debt_relief', 'debt_settlement'] },
            { slug: 'financial_services.banking', name: 'Banking', description: 'Banking products and services', aliases: ['bank_account', 'savings'] },
            { slug: 'financial_services.credit_repair', name: 'Credit Repair', description: 'Credit score improvement services', aliases: ['credit_fix', 'credit_restoration'] },
            { slug: 'financial_services.tax_prep', name: 'Tax Preparation', description: 'Tax filing and preparation services', aliases: ['tax_filing', 'cpa', 'tax_services'] },
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
                    formConfig: (FORM_CONFIG_TEMPLATES[v.slug] ?? null) as any,
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
                        formConfig: (FORM_CONFIG_TEMPLATES[child.slug] ?? null) as any,
                    },
                });
                console.log(`    ✅ ${child.slug}`);
                created++;
            }
        }
    }

    console.log(`\n🎉 Done! Created: ${created}, Skipped: ${skipped}`);

    // Update formConfig for any existing verticals that were skipped
    console.log('\n🔄 Syncing formConfig templates to all existing verticals...');
    let configUpdated = 0;
    for (const [slug, config] of Object.entries(FORM_CONFIG_TEMPLATES)) {
        const result = await prisma.vertical.updateMany({
            where: { slug },
            data: { formConfig: config as any },
        });
        if (result.count > 0) configUpdated++;
    }
    console.log(`✅ Updated formConfig on ${configUpdated} verticals.`);
}

// Run standalone when executed directly
if (require.main === module) {
    seedVerticals()
        .catch((err) => {
            console.error('❌ Seed failed:', err);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}

export { generateDynamicVerticals, seedVerticals, SEED_DATA, DYNAMIC_INDUSTRIES, DYNAMIC_SPECIALIZATIONS };
