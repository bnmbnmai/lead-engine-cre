// =============================================
// Lead Engine CRE — Mock Data Seeder
// =============================================
// Generates 200+ realistic entries for demo/testing.
// SAFETY: Only runs when TEST_MODE=true.
//
// Usage:
//   TEST_MODE=true npx ts-node prisma/seed.ts
//   npm run db:seed  (uses db:seed script in package.json)
// =============================================

import { PrismaClient, Prisma, UserRole } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

// ─── Safety Gate ────────────────────────────
if (process.env.TEST_MODE !== 'true') {
    console.error('❌  Seeding requires TEST_MODE=true to prevent data pollution.');
    console.error('    Set TEST_MODE=true in your environment or .env file.');
    process.exit(1);
}

// ─── Constants ──────────────────────────────

const VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'b2b_saas', 'real_estate', 'auto', 'legal', 'financial'] as const;

const LEAD_STATUSES = ['PENDING_AUCTION', 'IN_AUCTION', 'REVEAL_PHASE', 'SOLD', 'EXPIRED'] as const;
const LEAD_SOURCES = ['PLATFORM', 'API', 'OFFSITE'] as const;
const ASK_STATUSES = ['ACTIVE', 'PAUSED', 'EXPIRED'] as const;
const BID_STATUSES = ['PENDING', 'REVEALED', 'ACCEPTED', 'OUTBID'] as const;

// ─── Global Geo Data ────────────────────────

interface GeoConfig {
    country: string;
    states: string[];
    zipFn: () => string;
    cities: string[];
}

const GEO_CONFIGS: GeoConfig[] = [
    {
        country: 'US',
        states: ['CA', 'TX', 'FL', 'NY', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI', 'WA', 'AZ', 'CO', 'VA', 'NV'],
        zipFn: () => faker.location.zipCode('#####'),
        cities: ['Los Angeles', 'Houston', 'Miami', 'New York', 'Chicago', 'Phoenix', 'Denver', 'Atlanta', 'Charlotte', 'Seattle'],
    },
    {
        country: 'CA',
        states: ['ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB'],
        zipFn: () => `${faker.string.alpha({ length: 1, casing: 'upper' })}${faker.number.int({ min: 1, max: 9 })}${faker.string.alpha({ length: 1, casing: 'upper' })} ${faker.number.int({ min: 1, max: 9 })}${faker.string.alpha({ length: 1, casing: 'upper' })}${faker.number.int({ min: 1, max: 9 })}`,
        cities: ['Toronto', 'Vancouver', 'Calgary', 'Montreal', 'Ottawa', 'Edmonton', 'Winnipeg'],
    },
    {
        country: 'GB',
        states: ['England', 'Scotland', 'Wales', 'N. Ireland'],
        zipFn: () => `${faker.string.alpha({ length: 2, casing: 'upper' })}${faker.number.int({ min: 1, max: 99 })} ${faker.number.int({ min: 1, max: 9 })}${faker.string.alpha({ length: 2, casing: 'upper' })}`,
        cities: ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Cardiff', 'Belfast'],
    },
    {
        country: 'AU',
        states: ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'],
        zipFn: () => `${faker.number.int({ min: 2000, max: 9999 })}`,
        cities: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Hobart', 'Darwin'],
    },
    {
        country: 'DE',
        states: ['Bavaria', 'Berlin', 'Hamburg', 'Hessen', 'NRW'],
        zipFn: () => `${faker.number.int({ min: 10000, max: 99999 })}`,
        cities: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne'],
    },
    {
        country: 'FR',
        states: ['Île-de-France', 'Provence', 'Occitanie', 'Normandie'],
        zipFn: () => `${faker.number.int({ min: 10000, max: 99999 })}`,
        cities: ['Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice'],
    },
    {
        country: 'BR',
        states: ['SP', 'RJ', 'MG', 'BA', 'PR'],
        zipFn: () => `${faker.number.int({ min: 10000, max: 99999 })}-${faker.number.int({ min: 100, max: 999 })}`,
        cities: ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Salvador'],
    },
    {
        country: 'IN',
        states: ['MH', 'KA', 'TN', 'DL', 'GJ'],
        zipFn: () => `${faker.number.int({ min: 100000, max: 999999 })}`,
        cities: ['Mumbai', 'Bangalore', 'Chennai', 'New Delhi', 'Ahmedabad'],
    },
    // ─── LATAM ──────────────────────────────
    {
        country: 'MX',
        states: ['CDMX', 'JAL', 'NLE', 'YUC', 'QRO', 'PUE'],
        zipFn: () => `${faker.number.int({ min: 10000, max: 99999 })}`,
        cities: ['Mexico City', 'Guadalajara', 'Monterrey', 'Mérida', 'Querétaro'],
    },
    {
        country: 'CO',
        states: ['BOG', 'ANT', 'VAC', 'ATL', 'SAN'],
        zipFn: () => `${faker.number.int({ min: 100000, max: 999999 })}`,
        cities: ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Bucaramanga'],
    },
    {
        country: 'AR',
        states: ['CABA', 'BUE', 'COR', 'SFE', 'MZA'],
        zipFn: () => `${faker.string.alpha({ length: 1, casing: 'upper' })}${faker.number.int({ min: 1000, max: 9999 })}${faker.string.alpha({ length: 3, casing: 'upper' })}`,
        cities: ['Buenos Aires', 'Córdoba', 'Rosario', 'Mendoza', 'Tucumán'],
    },
    {
        country: 'CL',
        states: ['RM', 'VAL', 'BIO', 'ARA', 'MAU'],
        zipFn: () => `${faker.number.int({ min: 1000000, max: 9999999 })}`,
        cities: ['Santiago', 'Valparaíso', 'Concepción', 'Temuco', 'Talca'],
    },
    {
        country: 'PE',
        states: ['LIM', 'ARE', 'LAL', 'PIU', 'CUS'],
        zipFn: () => `${faker.number.int({ min: 10000, max: 99999 })}`,
        cities: ['Lima', 'Arequipa', 'Trujillo', 'Piura', 'Cusco'],
    },
    {
        country: 'EC',
        states: ['GYE', 'UIO', 'AZU', 'MAN', 'TUN'],
        zipFn: () => `${faker.number.int({ min: 100000, max: 999999 })}`,
        cities: ['Guayaquil', 'Quito', 'Cuenca', 'Portoviejo', 'Ambato'],
    },
    // ─── APAC ───────────────────────────────
    {
        country: 'JP',
        states: ['TYO', 'OSK', 'AIC', 'FKO', 'HKD'],
        zipFn: () => `${faker.number.int({ min: 100, max: 999 })}-${faker.number.int({ min: 1000, max: 9999 })}`,
        cities: ['Tokyo', 'Osaka', 'Nagoya', 'Fukuoka', 'Sapporo'],
    },
    {
        country: 'KR',
        states: ['SEL', 'BSN', 'ICN', 'DGU', 'GGI'],
        zipFn: () => `${faker.number.int({ min: 10000, max: 99999 })}`,
        cities: ['Seoul', 'Busan', 'Incheon', 'Daegu', 'Suwon'],
    },
    {
        country: 'SG',
        states: ['CTR', 'NE', 'NW', 'SE'],
        zipFn: () => `${faker.number.int({ min: 100000, max: 999999 })}`,
        cities: ['Singapore'],
    },
    // ─── Middle East ────────────────────────
    {
        country: 'AE',
        states: ['DXB', 'AUH', 'SHJ', 'AJM'],
        zipFn: () => '',
        cities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'],
    },
    // ─── Africa ─────────────────────────────
    {
        country: 'ZA',
        states: ['GP', 'WC', 'KZN', 'EC', 'LP', 'MP'],
        zipFn: () => `${faker.number.int({ min: 1000, max: 9999 })}`,
        cities: ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Port Elizabeth'],
    },
    {
        country: 'NG',
        states: ['LA', 'ABJ', 'KN', 'RV', 'OY', 'EDO'],
        zipFn: () => `${faker.number.int({ min: 100000, max: 999999 })}`,
        cities: ['Lagos', 'Abuja', 'Kano', 'Port Harcourt', 'Ibadan'],
    },
    {
        country: 'KE',
        states: ['NBO', 'MBA', 'KSM', 'NKR', 'ELD'],
        zipFn: () => `${faker.number.int({ min: 10000, max: 99999 })}`,
        cities: ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret'],
    },
    {
        country: 'GH',
        states: ['GAR', 'ASH', 'WR', 'CR', 'ER'],
        zipFn: () => `${faker.string.alpha({ length: 2, casing: 'upper' })}-${faker.number.int({ min: 100, max: 9999 })}-${faker.number.int({ min: 1000, max: 9999 })}`,
        cities: ['Accra', 'Kumasi', 'Sekondi-Takoradi', 'Cape Coast', 'Koforidua'],
    },
    {
        country: 'EG',
        states: ['CAI', 'ALX', 'GIZ', 'ASW', 'LUX'],
        zipFn: () => `${faker.number.int({ min: 10000, max: 99999 })}`,
        cities: ['Cairo', 'Alexandria', 'Giza', 'Aswan', 'Luxor'],
    },
    {
        country: 'TZ',
        states: ['DSM', 'ARU', 'MWZ', 'DGM', 'ZNZ'],
        zipFn: () => `${faker.number.int({ min: 10000, max: 99999 })}`,
        cities: ['Dar es Salaam', 'Arusha', 'Mwanza', 'Dodoma', 'Zanzibar City'],
    },
    {
        country: 'MA',
        states: ['CAS', 'RBT', 'TNG', 'MRK', 'FES'],
        zipFn: () => `${faker.number.int({ min: 10000, max: 99999 })}`,
        cities: ['Casablanca', 'Rabat', 'Tangier', 'Marrakech', 'Fès'],
    },
];

// ─── Vertical-Specific Parameters ───────────

function generateVerticalParams(vertical: string): Record<string, unknown> {
    switch (vertical) {
        case 'solar':
            return {
                roof_age: faker.number.int({ min: 1, max: 30 }).toString(),
                monthly_bill: faker.number.int({ min: 100, max: 500 }),
                ownership: faker.helpers.arrayElement(['own', 'rent', 'mortgage']),
                panel_interest: faker.helpers.arrayElement(['purchase', 'lease', 'ppa']),
                shade_level: faker.helpers.arrayElement(['none', 'partial', 'heavy']),
            };
        case 'mortgage':
            return {
                loan_type: faker.helpers.arrayElement(['purchase', 'refinance', 'heloc']),
                credit_range: faker.helpers.arrayElement(['excellent_750+', 'good_700-749', 'fair_650-699', 'poor_below-650']),
                property_type: faker.helpers.arrayElement(['single_family', 'condo', 'townhouse', 'multi_family']),
                purchase_price: faker.number.int({ min: 150000, max: 1500000 }),
                down_payment_pct: faker.number.int({ min: 3, max: 25 }),
            };
        case 'roofing':
            return {
                roof_type: faker.helpers.arrayElement(['shingle', 'tile', 'metal', 'flat', 'slate']),
                damage_type: faker.helpers.arrayElement(['storm', 'age', 'leak', 'missing_shingles', 'none']),
                insurance_claim: faker.datatype.boolean(),
                roof_age: faker.number.int({ min: 1, max: 40 }),
                square_footage: faker.number.int({ min: 800, max: 5000 }),
            };
        case 'insurance':
            return {
                coverage_type: faker.helpers.arrayElement(['auto', 'home', 'life', 'health', 'renters']),
                current_provider: faker.helpers.arrayElement(['State Farm', 'Geico', 'Allstate', 'Progressive', 'none']),
                policy_expiry: faker.date.future({ years: 1 }).toISOString().split('T')[0],
                num_drivers: faker.number.int({ min: 1, max: 4 }),
            };
        case 'home_services':
            return {
                service_type: faker.helpers.arrayElement(['hvac', 'plumbing', 'electrical', 'landscaping', 'cleaning']),
                urgency: faker.helpers.arrayElement(['emergency', 'this_week', 'this_month', 'flexible']),
                home_size: faker.number.int({ min: 800, max: 5000 }),
                owner: faker.datatype.boolean(),
            };
        case 'b2b_saas':
            return {
                company_size: faker.helpers.arrayElement(['1-10', '11-50', '51-200', '201-1000', '1000+']),
                industry: faker.helpers.arrayElement(['tech', 'finance', 'healthcare', 'retail', 'manufacturing']),
                budget_range: faker.helpers.arrayElement(['<1k', '1k-5k', '5k-25k', '25k-100k', '100k+']),
                decision_timeline: faker.helpers.arrayElement(['immediate', '1_month', '3_months', '6_months']),
            };
        case 'real_estate':
            return {
                intent: faker.helpers.arrayElement(['buy', 'sell', 'rent']),
                property_type: faker.helpers.arrayElement(['single_family', 'condo', 'commercial', 'land', 'multi_family']),
                price_range: `${faker.number.int({ min: 100, max: 500 })}k-${faker.number.int({ min: 500, max: 2000 })}k`,
                bedrooms: faker.number.int({ min: 1, max: 6 }),
            };
        case 'auto':
            return {
                vehicle_type: faker.helpers.arrayElement(['sedan', 'suv', 'truck', 'coupe', 'van']),
                condition: faker.helpers.arrayElement(['new', 'used', 'certified_pre_owned']),
                budget: faker.number.int({ min: 15000, max: 80000 }),
                trade_in: faker.datatype.boolean(),
            };
        case 'legal':
            return {
                case_type: faker.helpers.arrayElement(['personal_injury', 'family', 'criminal', 'immigration', 'business']),
                urgency: faker.helpers.arrayElement(['immediate', 'this_week', 'this_month']),
                has_attorney: faker.datatype.boolean(),
            };
        case 'financial':
            return {
                service: faker.helpers.arrayElement(['tax_prep', 'bookkeeping', 'financial_planning', 'debt_relief', 'credit_repair']),
                annual_income: faker.helpers.arrayElement(['<50k', '50k-100k', '100k-250k', '250k+']),
                business_owner: faker.datatype.boolean(),
            };
        default:
            return {};
    }
}

// ─── Helper Functions ───────────────────────

function randomGeo() {
    const config = faker.helpers.arrayElement(GEO_CONFIGS);
    return {
        country: config.country,
        state: faker.helpers.arrayElement(config.states),
        city: faker.helpers.arrayElement(config.cities),
        zip: config.zipFn(),
    };
}

function mockWallet(): string {
    return `0xMOCK${faker.string.hexadecimal({ length: 36, casing: 'lower' }).replace('0x', '')}`;
}

// ─── Seed Functions ─────────────────────────

async function seedUsers(count: number) {
    console.log(`  Creating ${count} mock users...`);
    const users = [];

    for (let i = 0; i < count; i++) {
        const role = i < count / 2 ? 'BUYER' : 'SELLER';
        const user = await prisma.user.create({
            data: {
                walletAddress: mockWallet(),
                email: faker.internet.email({ provider: 'mockdemo.test' }),
                role: role as UserRole,
                nonce: faker.string.uuid(),
            },
        });
        users.push(user);
    }

    return users;
}

async function seedBuyerProfiles(buyerUsers: { id: string }[]) {
    console.log(`  Creating ${buyerUsers.length} buyer profiles...`);

    for (const user of buyerUsers) {
        const selectedVerticals = faker.helpers.arrayElements(VERTICALS as unknown as string[], { min: 1, max: 4 });
        const geoConfig = faker.helpers.arrayElement(GEO_CONFIGS);
        const selectedStates = faker.helpers.arrayElements(geoConfig.states, { min: 1, max: 4 });

        await prisma.buyerProfile.create({
            data: {
                userId: user.id,
                companyName: faker.company.name(),
                verticals: selectedVerticals,
                geoFilters: {
                    country: geoConfig.country,
                    states: selectedStates,
                },
                budgetMin: faker.number.float({ min: 15, max: 40, fractionDigits: 2 }),
                budgetMax: faker.number.float({ min: 50, max: 200, fractionDigits: 2 }),
                dailyBudget: faker.number.float({ min: 200, max: 2000, fractionDigits: 2 }),
                monthlyBudget: faker.number.float({ min: 5000, max: 50000, fractionDigits: 2 }),
                acceptOffSite: faker.datatype.boolean(),
                requireVerified: faker.datatype.boolean(),
                kycStatus: faker.helpers.arrayElement(['PENDING', 'VERIFIED']),
            },
        });
    }
}

async function seedSellerProfiles(sellerUsers: { id: string }[]) {
    console.log(`  Creating ${sellerUsers.length} seller profiles...`);
    const sellers = [];

    for (const user of sellerUsers) {
        const selectedVerticals = faker.helpers.arrayElements(VERTICALS as unknown as string[], { min: 1, max: 3 });

        const seller = await prisma.sellerProfile.create({
            data: {
                userId: user.id,
                companyName: faker.company.name(),
                verticals: selectedVerticals,
                reputationScore: faker.number.int({ min: 3000, max: 10000 }),
                totalLeadsSold: faker.number.int({ min: 0, max: 500 }),
                isVerified: faker.helpers.weightedArrayElement([
                    { value: true, weight: 7 },
                    { value: false, weight: 3 },
                ]),
                kycStatus: faker.helpers.arrayElement(['PENDING', 'VERIFIED']),
            },
        });
        sellers.push(seller);
    }

    return sellers;
}

async function seedAsks(sellers: { id: string; verticals: string[] }[], count: number) {
    console.log(`  Creating ${count} asks...`);
    const asks = [];

    for (let i = 0; i < count; i++) {
        const seller = faker.helpers.arrayElement(sellers);
        const vertical = faker.helpers.arrayElement(seller.verticals.length > 0 ? seller.verticals : [faker.helpers.arrayElement(VERTICALS as unknown as string[])]);
        const geoConfig = faker.helpers.arrayElement(GEO_CONFIGS);
        const selectedStates = faker.helpers.arrayElements(geoConfig.states, { min: 1, max: 5 });

        const ask = await prisma.ask.create({
            data: {
                sellerId: seller.id,
                vertical,
                geoTargets: {
                    country: geoConfig.country,
                    states: selectedStates,
                },
                reservePrice: faker.number.float({ min: 15, max: 100, fractionDigits: 2 }),
                buyNowPrice: faker.helpers.maybe(() => faker.number.float({ min: 100, max: 300, fractionDigits: 2 }), { probability: 0.4 }) ?? undefined,
                status: faker.helpers.arrayElement(ASK_STATUSES),
                acceptOffSite: faker.datatype.boolean(),
                auctionDuration: faker.helpers.arrayElement([1800, 3600, 7200, 14400]),
                revealWindow: faker.helpers.arrayElement([300, 600, 900, 1800]),
                expiresAt: faker.date.future({ years: 0.25 }),
            },
        });
        asks.push(ask);
    }

    return asks;
}

async function seedLeads(sellers: { id: string; verticals: string[] }[], asks: { id: string; vertical: string }[], count: number) {
    console.log(`  Creating ${count} leads...`);
    const leads = [];

    for (let i = 0; i < count; i++) {
        const seller = faker.helpers.arrayElement(sellers);
        const vertical = faker.helpers.arrayElement(seller.verticals.length > 0 ? seller.verticals : [faker.helpers.arrayElement(VERTICALS as unknown as string[])]);
        const geo = randomGeo();
        const status = faker.helpers.arrayElement(LEAD_STATUSES);

        // Optionally link to a matching ask
        const matchingAsks = asks.filter((a) => a.vertical === vertical);
        const linkedAsk = matchingAsks.length > 0 && faker.datatype.boolean() ? faker.helpers.arrayElement(matchingAsks) : null;

        const now = new Date();
        const createdAt = faker.date.recent({ days: 90 });
        const expiresAt = new Date(createdAt.getTime() + faker.number.int({ min: 15, max: 1440 }) * 60 * 1000);

        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                askId: linkedAsk?.id,
                vertical,
                geo,
                source: faker.helpers.arrayElement(LEAD_SOURCES),
                status,
                parameters: generateVerticalParams(vertical) as Prisma.InputJsonValue,
                reservePrice: faker.number.float({ min: 15, max: 100, fractionDigits: 2 }),
                winningBid: status === 'SOLD' ? faker.number.float({ min: 30, max: 200, fractionDigits: 2 }) : undefined,
                tcpaConsentAt: faker.date.recent({ days: 1 }),
                isVerified: faker.helpers.weightedArrayElement([
                    { value: true, weight: 8 },
                    { value: false, weight: 2 },
                ]),
                createdAt,
                auctionStartAt: ['IN_AUCTION', 'REVEAL_PHASE', 'SOLD'].includes(status) ? createdAt : undefined,
                auctionEndAt: ['SOLD', 'EXPIRED'].includes(status) ? new Date(createdAt.getTime() + 3600000) : undefined,
                soldAt: status === 'SOLD' ? new Date(createdAt.getTime() + faker.number.int({ min: 1800, max: 7200 }) * 1000) : undefined,
                expiresAt,
            },
        });
        leads.push(lead);
    }

    return leads;
}

async function seedBids(leads: { id: string; status: string }[], buyerUsers: { id: string }[], count: number) {
    console.log(`  Creating ${count} bids...`);

    const auctionLeads = leads.filter((l) => ['IN_AUCTION', 'REVEAL_PHASE', 'SOLD'].includes(l.status));
    if (auctionLeads.length === 0) return;

    for (let i = 0; i < count; i++) {
        const lead = faker.helpers.arrayElement(auctionLeads);
        const buyer = faker.helpers.arrayElement(buyerUsers);
        const status = faker.helpers.arrayElement(BID_STATUSES);

        try {
            await prisma.bid.create({
                data: {
                    leadId: lead.id,
                    buyerId: buyer.id,
                    amount: faker.number.float({ min: 20, max: 200, fractionDigits: 2 }),
                    status,
                    createdAt: faker.date.recent({ days: 30 }),
                },
            });
        } catch {
            // Unique constraint violation (buyer already bid on this lead) — skip
        }
    }
}

async function seedTransactions(leads: { id: string; status: string; winningBid: any; sellerId: string }[], buyerUsers: { id: string }[]) {
    const soldLeads = leads.filter((l) => l.status === 'SOLD');
    console.log(`  Creating transactions for ${soldLeads.length} sold leads...`);

    for (const lead of soldLeads) {
        const buyer = faker.helpers.arrayElement(buyerUsers);
        const amount = lead.winningBid ? parseFloat(lead.winningBid.toString()) : faker.number.float({ min: 30, max: 200, fractionDigits: 2 });
        const platformFee = +(amount * 0.05).toFixed(2);

        try {
            await prisma.transaction.create({
                data: {
                    leadId: lead.id,
                    buyerId: buyer.id,
                    amount,
                    platformFee,
                    currency: 'USDC',
                    status: faker.helpers.arrayElement(['CONFIRMED', 'ESCROWED', 'RELEASED']),
                    txHash: `0xMOCKTX${faker.string.hexadecimal({ length: 60, casing: 'lower' }).replace('0x', '')}`,
                    chainId: 11155111,
                    createdAt: faker.date.recent({ days: 60 }),
                },
            });
        } catch {
            // Unique constraint — skip
        }
    }
}

async function seedAnalyticsEvents(leads: { id: string; vertical: string; sellerId: string }[], buyerUsers: { id: string }[]) {
    console.log('  Creating analytics events...');
    let count = 0;

    for (const lead of leads.slice(0, 100)) {
        await prisma.analyticsEvent.create({
            data: {
                eventType: 'lead_submitted',
                entityType: 'lead',
                entityId: lead.id,
                userId: lead.sellerId,
                metadata: { vertical: lead.vertical },
                createdAt: faker.date.recent({ days: 90 }),
            },
        });
        count++;
    }

    for (let i = 0; i < 60; i++) {
        const buyer = faker.helpers.arrayElement(buyerUsers);
        const lead = faker.helpers.arrayElement(leads);
        await prisma.analyticsEvent.create({
            data: {
                eventType: faker.helpers.arrayElement(['bid_placed', 'auction_resolved', 'lead_purchased']),
                entityType: faker.helpers.arrayElement(['bid', 'lead']),
                entityId: lead.id,
                userId: buyer.id,
                metadata: { vertical: lead.vertical, amount: faker.number.float({ min: 20, max: 200, fractionDigits: 2 }) },
                createdAt: faker.date.recent({ days: 60 }),
            },
        });
        count++;
    }

    console.log(`    ${count} analytics events created`);
}

// ─── Main Seed Runner ───────────────────────

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  Lead Engine CRE — Mock Data Seeder      ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log('║  TEST_MODE=true — generating mock data   ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    const BUYER_COUNT = 20;
    const SELLER_COUNT = 15;
    const ASK_COUNT = 40;
    const LEAD_COUNT = 200;
    const BID_COUNT = 120;

    console.log('📊 Seeding plan:');
    console.log(`  • ${BUYER_COUNT} buyers + profiles`);
    console.log(`  • ${SELLER_COUNT} sellers + profiles`);
    console.log(`  • ${ASK_COUNT} asks (across ${GEO_CONFIGS.length} countries)`);
    console.log(`  • ${LEAD_COUNT} leads (10 verticals × global geos)`);
    console.log(`  • ${BID_COUNT} bids (on auction leads)`);
    console.log(`  • Transactions for all SOLD leads`);
    console.log(`  • ~160 analytics events`);
    console.log('');

    // Dynamic step tracking — auto-adjusts when new stages are added
    const TOTAL_STEPS = 8;
    let currentStep = 0;
    const step = (label: string) => console.log(`→ Step ${++currentStep}/${TOTAL_STEPS}: ${label}`);

    // 1. Users
    step('Users');
    const allUsers = await seedUsers(BUYER_COUNT + SELLER_COUNT);
    const buyerUsers = allUsers.slice(0, BUYER_COUNT);
    const sellerUsers = allUsers.slice(BUYER_COUNT);

    // 2. Profiles
    step('Profiles');
    await seedBuyerProfiles(buyerUsers);
    const sellers = await seedSellerProfiles(sellerUsers);

    // 3. Asks
    step('Asks');
    const asks = await seedAsks(sellers, ASK_COUNT);

    // 4. Leads
    step('Leads');
    const leads = await seedLeads(sellers, asks, LEAD_COUNT);

    // 5. Bids
    step('Bids');
    await seedBids(leads, buyerUsers, BID_COUNT);

    // 6. Transactions
    step('Transactions');
    await seedTransactions(leads, buyerUsers);

    // 7. Analytics events
    step('Analytics Events');
    await seedAnalyticsEvents(leads, buyerUsers);

    // 8. Holder perk scenarios (P2 #6)
    step('Holder Perk Scenarios');
    await seedHolderPerkScenarios(buyerUsers, leads);

    // Summary
    const counts = {
        users: await prisma.user.count(),
        buyers: await prisma.buyerProfile.count(),
        sellers: await prisma.sellerProfile.count(),
        asks: await prisma.ask.count(),
        leads: await prisma.lead.count(),
        bids: await prisma.bid.count(),
        transactions: await prisma.transaction.count(),
        analyticsEvents: await prisma.analyticsEvent.count(),
    };

    console.log('');
    console.log('✅ Seeding complete!');
    console.log('');
    console.log('  Database totals (including any pre-existing data):');
    Object.entries(counts).forEach(([k, v]) => console.log(`    ${k}: ${v}`));

    // Write JSON example snapshot
    const sampleLeads = await prisma.lead.findMany({ take: 5, orderBy: { createdAt: 'desc' }, include: { bids: { take: 2 } } });
    const sampleAsks = await prisma.ask.findMany({ take: 3, orderBy: { createdAt: 'desc' } });
    const example = { _note: 'Auto-generated mock data snapshot (TEST_MODE only)', summary: counts, sampleLeads, sampleAsks };
    const fs = await import('fs');
    const path = await import('path');
    const outPath = path.join(__dirname, 'seed-example.json');
    fs.writeFileSync(outPath, JSON.stringify(example, null, 2));
    console.log(`\n  📄 JSON example written to ${outPath}`);
    console.log('');
    console.log('  📌 Mock users use wallet prefix 0xMOCK...');
    console.log('     and email domain @mockdemo.test');
    console.log('  📌 Run `npm run db:clear-mock` to remove mock data only.');
    console.log('');
}

// ─── Step 8: Holder Perk Scenarios (P2 #6) ──────────────────
async function seedHolderPerkScenarios(buyerUsers: any[], leads: any[]) {
    const HOLDER_MULTIPLIER = 1.2;
    const holderWallets = [
        '0xMOCK_HOLDER_AAA1111111111111111111111111111111111111',
        '0xMOCK_HOLDER_BBB2222222222222222222222222222222222222',
        '0xMOCK_HOLDER_CCC3333333333333333333333333333333333333',
    ];

    // 1. Set 3 buyers as vertical owners
    const holderVerticals = ['solar', 'mortgage', 'insurance'];
    for (let i = 0; i < 3; i++) {
        if (buyerUsers[i]) {
            try {
                await prisma.vertical.updateMany({
                    where: { slug: holderVerticals[i] },
                    data: { ownerAddress: holderWallets[i] },
                });
                console.log(`  Holder ${i + 1}: ${holderVerticals[i]} → ${holderWallets[i].slice(0, 20)}...`);
            } catch { /* vertical may not exist yet */ }
        }
    }

    // 2. Create 10 bids with pre-computed effectiveBid (holder multiplier applied)
    const holderLeads = leads.slice(0, Math.min(10, leads.length));
    for (let i = 0; i < holderLeads.length; i++) {
        const rawBid = 50 + Math.random() * 200;
        const effectiveBid = rawBid * HOLDER_MULTIPLIER;
        try {
            await prisma.bid.create({
                data: {
                    amount: parseFloat(rawBid.toFixed(2)),
                    effectiveBid: parseFloat(effectiveBid.toFixed(2)),
                    status: 'PENDING',
                    lead: { connect: { id: holderLeads[i].id } },
                    buyer: { connect: { id: buyerUsers[i % buyerUsers.length].id } },
                },
            });
        } catch { /* skip if constraint violated */ }
    }
    console.log(`  Created 10 effectiveBid bids (${HOLDER_MULTIPLIER}x multiplier)`);

    // 3. Create 5 legacy bids with effectiveBid: null (migration edge case)
    const legacyLeads = leads.slice(10, Math.min(15, leads.length));
    for (let i = 0; i < legacyLeads.length; i++) {
        try {
            await prisma.bid.create({
                data: {
                    amount: parseFloat((30 + Math.random() * 100).toFixed(2)),
                    effectiveBid: undefined, // null — tests backfill script
                    status: 'PENDING',
                    lead: { connect: { id: legacyLeads[i].id } },
                    buyer: { connect: { id: buyerUsers[(i + 3) % buyerUsers.length].id } },
                },
            });
        } catch { /* skip if constraint violated */ }
    }
    console.log('  Created 5 legacy bids (effectiveBid: null)');

    // 4. Create 100 granular vertical suggestions for spam threshold testing
    const spamSlugs = Array.from({ length: 100 }, (_, i) => `spam-test-vertical-${String(i).padStart(3, '0')}`);
    for (const slug of spamSlugs) {
        try {
            await prisma.verticalSuggestion.create({
                data: {
                    suggestedSlug: slug,
                    suggestedName: `Spam Test ${slug}`,
                    parentSlug: 'solar',
                    confidence: 0.1 + Math.random() * 0.3,
                    reason: 'seed:spam-threshold-test',
                    sourceLeadId: leads[Math.floor(Math.random() * leads.length)]?.id || 'unknown',
                    sourceText: `Automated spam test suggestion ${slug}`,
                },
            });
        } catch { /* skip duplicates */ }
    }
    console.log('  Created 100 spam-test vertical suggestions');

    // 5. Cross-border leads with EU geo for GDPR consent scenarios
    const euCountries = ['DE', 'FR', 'IT', 'ES', 'NL'];
    for (let i = 0; i < 5; i++) {
        const geo = GEO_CONFIGS.find(g => g.country === euCountries[i]) || GEO_CONFIGS[0];
        try {
            await prisma.lead.create({
                data: {
                    sellerId: buyerUsers[0].id, // reuse any user as seller for test data
                    vertical: 'real_estate',
                    geo: { country: euCountries[i], state: geo.states[0], city: geo.cities[0], zip: geo.zipFn() },
                    source: 'PLATFORM',
                    status: 'PENDING_AUCTION',
                    parameters: { crossBorder: true, gdprRequired: true, region: 'EU' } as any,
                    reservePrice: 50 + Math.random() * 100,
                    tcpaConsentAt: new Date(),
                    isVerified: true,
                },
            });
        } catch { /* skip constraint violations */ }
    }
    console.log('  Created 5 cross-border EU leads (GDPR scenarios)');

    // 6. High-volume holder: 65 notifications queued (tests batch spillover at 60 warning + 100 limit)
    // We just annotate via a marker bid — actual notification queueing happens at runtime
    const highVolumeLeads = leads.slice(15, Math.min(80, leads.length));
    for (let i = 0; i < highVolumeLeads.length; i++) {
        try {
            await prisma.bid.create({
                data: {
                    amount: parseFloat((10 + Math.random() * 50).toFixed(2)),
                    effectiveBid: parseFloat((12 + Math.random() * 60).toFixed(2)),
                    status: 'PENDING',
                    lead: { connect: { id: highVolumeLeads[i].id } },
                    buyer: { connect: { id: buyerUsers[0].id } },  // All from same holder → high volume
                },
            });
        } catch { /* skip constraint violations */ }
    }
    console.log(`  Created ${highVolumeLeads.length} high-volume holder bids (batch spillover test)`);

    // 7. Coordinated IP data: 5 users sharing same /24 prefix (for IP diversity spam tests)
    const coordIps = [
        '192.168.42.10', '192.168.42.20', '192.168.42.30',
        '192.168.42.40', '192.168.42.50',
    ];
    for (let i = 0; i < 5; i++) {
        if (buyerUsers[i + 3]) {
            try {
                await prisma.analyticsEvent.create({
                    data: {
                        eventType: 'seed:coordinated-ip-test',
                        userId: buyerUsers[i + 3].id,
                        metadata: { testIp: coordIps[i], subnet: '192.168.42', purpose: 'P2 spam detection test' },
                    },
                });
            } catch { /* skip */ }
        }
    }
    console.log('  Created 5 coordinated-IP analytics events (subnet: 192.168.42.*)');
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
