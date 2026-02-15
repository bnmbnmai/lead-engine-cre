/**
 * Demo Panel API Routes
 * 
 * Development-only endpoints for demo control panel.
 * Gated by NODE_ENV check — returns 403 in production.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { LEAD_AUCTION_DURATION_SECS } from '../config/perks.env';
import { clearAllCaches } from '../lib/cache';
import { generateToken } from '../middleware/auth';
import { FORM_CONFIG_TEMPLATES } from '../data/form-config-templates';

const router = Router();

// ============================================
// Production Guard — block all demo routes in prod
// ============================================

const devOnly = (_req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
        res.status(403).json({ error: 'Demo endpoints disabled in production' });
        return;
    }
    next();
};

router.use(devOnly);

const DEMO_TAG = 'DEMO_PANEL';  // Tag for identifying demo data

// Real Sepolia wallet addresses for demo personas (replaces old 0xDEMO_ placeholders)
const DEMO_WALLETS = {
    PANEL_USER: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58',   // Demo seller / panel user
    ADMIN: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58',   // Admin (same as panel user)
    BUYER: '0x424CaC929939377f221348af52d4cb1247fE4379',   // Demo buyer
    BUYER_1: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58',   // Auction bidder 1
    BUYER_2: '0x424CaC929939377f221348af52d4cb1247fE4379',   // Auction bidder 2
    BUYER_3: '0x089B6Bdb4824628c5535acF60aBF80683452e862',   // Auction bidder 3
    SELLER_KYC: '0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70',   // Verified seller (deployer)
};

// In-memory toggle: when OFF, demo buyers will NOT place bids
let demoBuyersEnabled = true;

/** Read the current toggle state from other modules */
export function getDemoBuyersEnabled(): boolean {
    return demoBuyersEnabled;
}

// ============================================
// Demo Login — returns a real JWT for demo personas
// ============================================

router.post('/demo-login', async (req: Request, res: Response) => {
    try {
        const { role } = req.body as { role?: string };
        const isBuyer = role === 'BUYER';
        const walletAddress = isBuyer ? DEMO_WALLETS.BUYER : DEMO_WALLETS.PANEL_USER;
        const targetRole = isBuyer ? 'BUYER' : 'SELLER';

        // Find or create the demo user
        let user = await prisma.user.findFirst({ where: { walletAddress } });
        if (!user) {
            user = await prisma.user.create({
                data: {
                    walletAddress,
                    role: targetRole,
                },
            });
        }

        // Generate real JWT
        const token = generateToken({ userId: user.id, walletAddress, role: targetRole });

        // Create or refresh session so authMiddleware finds it
        await prisma.session.upsert({
            where: { token },
            update: { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), lastActiveAt: new Date() },
            create: {
                userId: user.id,
                token,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                lastActiveAt: new Date(),
            },
        });

        console.log(`[DEMO] Demo login: ${targetRole} token issued for ${walletAddress}`);
        res.json({ token, user: { id: user.id, walletAddress, role: targetRole } });
    } catch (err: any) {
        console.error('[DEMO] Demo login error:', err);
        res.status(500).json({ error: 'Demo login failed', details: err.message });
    }
});

// ============================================
// Demo Admin Login — username/password for admin panel access
// Only works when DEMO_MODE=true (already gated by devOnly middleware above)
// ============================================

router.post('/demo-admin-login', async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body as { username?: string; password?: string };

        if (username !== 'admin' || password !== 'admin') {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }

        const walletAddress = DEMO_WALLETS.ADMIN;

        // Find or create the demo admin user
        let user = await prisma.user.findFirst({ where: { walletAddress } });
        if (!user) {
            user = await prisma.user.create({
                data: { walletAddress, role: 'ADMIN' },
            });
        } else if (user.role !== 'ADMIN') {
            // Ensure role is ADMIN (may have been changed)
            user = await prisma.user.update({
                where: { id: user.id },
                data: { role: 'ADMIN' },
            });
        }

        // Generate real JWT
        const token = generateToken({ userId: user.id, walletAddress, role: 'ADMIN' });

        // Create or refresh session so authMiddleware finds it
        await prisma.session.upsert({
            where: { token },
            update: { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), lastActiveAt: new Date() },
            create: {
                userId: user.id,
                token,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                lastActiveAt: new Date(),
            },
        });

        console.log('[DEMO] Demo admin login used');
        res.json({ token, user: { id: user.id, walletAddress, role: 'ADMIN' } });
    } catch (err: any) {
        console.error('[DEMO] Demo admin login error:', err);
        res.status(500).json({ error: 'Demo admin login failed', details: err.message });
    }
});

// ── Hierarchical verticals: parent.child slugs (all 40 children matching form-config-templates) ──
const HIERARCHICAL_VERTICALS = [
    // Solar (4)
    { parent: 'solar', child: 'solar.residential', name: 'Residential Solar' },
    { parent: 'solar', child: 'solar.commercial', name: 'Commercial Solar' },
    { parent: 'solar', child: 'solar.battery_storage', name: 'Battery Storage' },
    { parent: 'solar', child: 'solar.community', name: 'Community Solar' },
    // Mortgage (4)
    { parent: 'mortgage', child: 'mortgage.purchase', name: 'Mortgage Purchase' },
    { parent: 'mortgage', child: 'mortgage.refinance', name: 'Mortgage Refinance' },
    { parent: 'mortgage', child: 'mortgage.heloc', name: 'HELOC' },
    { parent: 'mortgage', child: 'mortgage.reverse', name: 'Reverse Mortgage' },
    // Roofing (4)
    { parent: 'roofing', child: 'roofing.repair', name: 'Roof Repair' },
    { parent: 'roofing', child: 'roofing.replacement', name: 'Roof Replacement' },
    { parent: 'roofing', child: 'roofing.inspection', name: 'Roof Inspection' },
    { parent: 'roofing', child: 'roofing.gutter', name: 'Gutter & Drainage' },
    // Insurance (4)
    { parent: 'insurance', child: 'insurance.auto', name: 'Auto Insurance' },
    { parent: 'insurance', child: 'insurance.home', name: 'Home Insurance' },
    { parent: 'insurance', child: 'insurance.life', name: 'Life Insurance' },
    { parent: 'insurance', child: 'insurance.health', name: 'Health Insurance' },
    // Home Services (4)
    { parent: 'home_services', child: 'home_services.plumbing', name: 'Plumbing' },
    { parent: 'home_services', child: 'home_services.electrical', name: 'Electrical' },
    { parent: 'home_services', child: 'home_services.hvac', name: 'HVAC' },
    { parent: 'home_services', child: 'home_services.landscaping', name: 'Landscaping' },
    // B2B SaaS (4)
    { parent: 'b2b_saas', child: 'b2b_saas.crm', name: 'CRM Software' },
    { parent: 'b2b_saas', child: 'b2b_saas.analytics', name: 'Analytics Platforms' },
    { parent: 'b2b_saas', child: 'b2b_saas.marketing_automation', name: 'Marketing Automation' },
    { parent: 'b2b_saas', child: 'b2b_saas.hr_tech', name: 'HR Technology' },
    // Real Estate (4)
    { parent: 'real_estate', child: 'real_estate.residential', name: 'Residential' },
    { parent: 'real_estate', child: 'real_estate.commercial', name: 'Commercial Real Estate' },
    { parent: 'real_estate', child: 'real_estate.rental', name: 'Rental & Property Mgmt' },
    { parent: 'real_estate', child: 'real_estate.land', name: 'Vacant Land' },
    // Auto (4)
    { parent: 'auto', child: 'auto.sales', name: 'Auto Sales' },
    { parent: 'auto', child: 'auto.warranty', name: 'Auto Warranty' },
    { parent: 'auto', child: 'auto.repair', name: 'Auto Repair' },
    { parent: 'auto', child: 'auto.insurance', name: 'Auto Insurance Quotes' },
    // Legal (4)
    { parent: 'legal', child: 'legal.personal_injury', name: 'Personal Injury' },
    { parent: 'legal', child: 'legal.family', name: 'Family Law' },
    { parent: 'legal', child: 'legal.immigration', name: 'Immigration' },
    { parent: 'legal', child: 'legal.criminal_defense', name: 'Criminal Defense' },
    // Financial Services (4)
    { parent: 'financial_services', child: 'financial_services.debt_consolidation', name: 'Debt Consolidation' },
    { parent: 'financial_services', child: 'financial_services.banking', name: 'Banking' },
    { parent: 'financial_services', child: 'financial_services.credit_repair', name: 'Credit Repair' },
    { parent: 'financial_services', child: 'financial_services.tax_prep', name: 'Tax Preparation' },
];

// Flat list of child slugs for picking
const DEMO_VERTICALS = HIERARCHICAL_VERTICALS.map(v => v.child);

// Keep old parents for fallback
const FALLBACK_VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'b2b_saas', 'real_estate', 'auto', 'legal', 'financial_services'];

// ── Multi-country geos ──
interface GeoInfo { country: string; state: string; city: string }
const GEOS: GeoInfo[] = [
    { country: 'US', state: 'CA', city: 'Los Angeles' },
    { country: 'US', state: 'TX', city: 'Houston' },
    { country: 'US', state: 'FL', city: 'Miami' },
    { country: 'US', state: 'NY', city: 'New York' },
    { country: 'US', state: 'IL', city: 'Chicago' },
    { country: 'GB', state: 'London', city: 'London' },
    { country: 'GB', state: 'Manchester', city: 'Manchester' },
    { country: 'AU', state: 'NSW', city: 'Sydney' },
    { country: 'AU', state: 'VIC', city: 'Melbourne' },
];

const PRICING: Record<string, { min: number; max: number }> = {
    solar: { min: 25, max: 75 }, 'solar.residential': { min: 25, max: 75 }, 'solar.commercial': { min: 40, max: 120 },
    mortgage: { min: 30, max: 100 }, 'mortgage.refinance': { min: 30, max: 100 }, 'mortgage.purchase': { min: 35, max: 110 },
    roofing: { min: 20, max: 60 }, 'roofing.replacement': { min: 25, max: 75 },
    insurance: { min: 15, max: 50 }, 'insurance.auto': { min: 12, max: 40 }, 'insurance.homeowners': { min: 18, max: 55 },
    home_services: { min: 10, max: 30 }, 'home_services.plumbing': { min: 12, max: 35 }, 'home_services.hvac': { min: 15, max: 45 },
    real_estate: { min: 40, max: 150 }, 'real_estate.commercial': { min: 60, max: 200 },
    legal: { min: 35, max: 120 }, 'legal.personal_injury': { min: 50, max: 180 }, 'legal.family_law': { min: 30, max: 100 },
    financial_services: { min: 45, max: 180 }, 'financial_services.wealth': { min: 60, max: 220 },
    b2b_saas: { min: 50, max: 200 }, 'b2b_saas.crm': { min: 50, max: 200 },
    auto: { min: 12, max: 40 },
};

function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[rand(0, arr.length - 1)]; }
function priceFor(v: string) { return PRICING[v] || PRICING[v.split('.')[0]] || { min: 15, max: 60 }; }

// Non-PII demo form-field values — uses parent slug to match existing field schemas
function buildVerticalDemoParams(vertical: string): Record<string, string | boolean> {
    const root = vertical.split('.')[0];
    switch (root) {
        case 'solar':
            return {
                roofType: pick(['Asphalt Shingle', 'Metal', 'Tile', 'Flat/TPO']),
                roofAge: `${rand(2, 25)} years`,
                sqft: `${rand(1200, 4500)}`,
                electricBill: `$${rand(100, 400)}/mo`,
                creditScore: pick(['Excellent (750+)', 'Good (700-749)', 'Fair (650-699)', 'Below 650']),
                systemSize: pick(['4-6 kW', '6-8 kW', '8-10 kW', '10+ kW']),
                timeline: pick(['ASAP', '1-3 months', '3-6 months', 'Just researching']),
                shading: pick(['No shading', 'Partial shade', 'Heavy shade']),
            };
        case 'mortgage':
            return {
                propertyType: pick(['Single Family', 'Condo', 'Townhouse', 'Multi-Family']),
                homeValue: `$${rand(200, 900) * 1000}`,
                loanAmount: `$${rand(150, 750) * 1000}`,
                loanType: vertical.includes('refinance') ? pick(['Refinance', 'Cash-Out Refinance']) : pick(['Purchase', 'FHA Purchase']),
                creditScore: pick(['Excellent (750+)', 'Good (700-749)', 'Fair (650-699)']),
                purchaseTimeline: pick(['Immediately', '1-3 months', '3-6 months', '6+ months']),
                occupancy: pick(['Primary Residence', 'Second Home', 'Investment Property']),
                downPayment: pick(['3%', '5%', '10%', '20%', '25%+']),
            };
        case 'roofing':
            return {
                propertyType: pick(['Single Family', 'Townhouse', 'Commercial']),
                roofType: pick(['Asphalt Shingle', 'Metal', 'Tile', 'Flat/TPO', 'Slate']),
                roofAge: `${rand(5, 35)} years`,
                projectBudget: `$${rand(5, 25) * 1000}-$${rand(25, 50) * 1000}`,
                projectType: pick(['Full Replacement', 'Repair', 'Inspection', 'Storm Damage']),
                urgency: pick(['Emergency', 'This week', '1-2 weeks', 'Flexible']),
                sqft: `${rand(1000, 4000)}`,
                stories: pick(['1 Story', '2 Stories', '3+ Stories']),
            };
        case 'insurance':
            return {
                propertyType: pick(['Single Family', 'Condo', 'Townhouse', 'Rental Property']),
                coverageType: vertical.includes('auto') ? pick(['Full Coverage', 'Liability Only', 'Comprehensive']) : pick(['Homeowners', 'Renters', 'Umbrella', 'Bundled']),
                currentCarrier: pick(['State Farm', 'Allstate', 'Progressive', 'GEICO', 'None']),
                homeAge: `${rand(1, 50)} years`,
                sqft: `${rand(900, 5000)}`,
                claimsHistory: pick(['No claims', '1 claim (3+ years ago)', '1 claim (recent)', '2+ claims']),
            };
        case 'home_services':
            return {
                propertyType: pick(['Single Family', 'Condo', 'Townhouse']),
                serviceType: vertical.includes('plumbing') ? 'Plumbing' : vertical.includes('hvac') ? 'HVAC' : pick(['Plumbing', 'Electrical', 'HVAC', 'Landscaping', 'Painting']),
                projectScope: pick(['Minor Repair', 'Major Repair', 'Full Installation', 'Maintenance']),
                urgency: pick(['Emergency', 'This week', '1-2 weeks', 'Flexible']),
                timeline: pick(['ASAP', '1-2 weeks', '1 month', 'Flexible']),
                sqft: `${rand(800, 5000)}`,
                budget: `$${rand(500, 15000)}`,
            };
        case 'real_estate':
            return {
                propertyType: vertical.includes('commercial') ? pick(['Office', 'Retail', 'Industrial', 'Multi-Family']) : pick(['Single Family', 'Condo', 'Townhouse', 'Land']),
                transactionType: pick(['Buying', 'Selling', 'Both', 'Investing']),
                priceRange: `$${rand(150, 500) * 1000}-$${rand(500, 1200) * 1000}`,
                bedrooms: pick(['1-2', '3', '4', '5+']),
                sqft: `${rand(800, 5000)}`,
                timeline: pick(['Immediately', '1-3 months', '3-6 months', '6+ months']),
                preApproved: pick(['Yes', 'No', 'In progress']),
                financing: pick(['Conventional', 'FHA', 'VA', 'Cash', 'Other']),
            };
        case 'auto':
            return {
                coverageType: pick(['Full Coverage', 'Liability Only', 'Comprehensive']),
                vehicleType: pick(['Sedan', 'SUV', 'Truck', 'Sports Car', 'Minivan']),
                vehicleYear: `${rand(2015, 2025)}`,
                currentCarrier: pick(['State Farm', 'Allstate', 'Progressive', 'GEICO', 'None']),
                drivingRecord: pick(['Clean', '1 ticket', '1 accident', 'Multiple incidents']),
                annualMileage: `${rand(5, 25) * 1000}`,
                multiCar: pick(['Yes', 'No']),
            };
        case 'b2b_saas':
            return {
                companySize: pick(['1-10', '11-50', '51-200', '201-500', '500+']),
                industry: pick(['Technology', 'Healthcare', 'Finance', 'Retail', 'Manufacturing']),
                currentSolution: pick(['None', 'Spreadsheets', 'Competitor SaaS', 'In-house tool']),
                budget: pick(['<$1K/mo', '$1K-$5K/mo', '$5K-$10K/mo', '$10K+/mo']),
                decisionTimeline: pick(['Immediately', '1-3 months', '3-6 months', 'Evaluating']),
                painPoints: pick(['Scalability', 'Cost', 'Integration', 'Ease of use', 'Support']),
                usersNeeded: pick(['1-5', '6-20', '21-50', '50+']),
            };
        case 'legal':
            return {
                caseType: vertical.includes('personal_injury') ? 'Personal Injury' : vertical.includes('family_law') ? 'Family Law' : pick(['Personal Injury', 'Family Law', 'Criminal Defense', 'Estate Planning']),
                urgency: pick(['Emergency', 'This week', '1-2 weeks', 'Flexible']),
                priorRepresentation: pick(['Yes', 'No']),
                caseTimeline: pick(['Ongoing', 'New case', 'Appeal', 'Consultation only']),
                consultationType: pick(['In-person', 'Virtual', 'Phone', 'No preference']),
            };
        case 'financial_services':
            return {
                serviceType: vertical.includes('wealth') ? 'Wealth Management' : pick(['Tax Planning', 'Retirement Planning', 'Business Consulting', 'Debt Management']),
                investmentRange: pick(['<$50K', '$50K-$250K', '$250K-$1M', '$1M+']),
                riskTolerance: pick(['Conservative', 'Moderate', 'Aggressive']),
                timeline: pick(['Immediately', '1-3 months', '6+ months', 'Long-term planning']),
                currentAdvisor: pick(['Yes', 'No', 'Looking to switch']),
                accountType: pick(['Individual', 'Joint', 'Business', 'Trust']),
            };
        default:
            return {};
    }
}




// Demo buyer profiles for multi-user bid simulation (kept small so user can outbid)
const DEMO_BUYERS = [
    { wallet: DEMO_WALLETS.BUYER_1, company: 'SolarPro Acquisitions' },
    { wallet: DEMO_WALLETS.BUYER_2, company: 'FinanceLead Partners' },
];

// ============================================
// GET /demo-buyers-toggle — read current state
// POST /demo-buyers-toggle — flip it
// ============================================

router.get('/demo-buyers-toggle', (_req: Request, res: Response) => {
    res.json({ enabled: demoBuyersEnabled });
});

router.post('/demo-buyers-toggle', (req: Request, res: Response) => {
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled === 'boolean') {
        demoBuyersEnabled = enabled;
    } else {
        demoBuyersEnabled = !demoBuyersEnabled;
    }
    console.log(`[DEMO] Demo buyers toggled → ${demoBuyersEnabled ? 'ON' : 'OFF'}`);
    res.json({ enabled: demoBuyersEnabled });
});

// ============================================
// GET /demo-wallets — return addresses for display
// ============================================

router.get('/demo-wallets', (_req: Request, res: Response) => {
    res.json({
        seller: DEMO_WALLETS.PANEL_USER,
        deployer: DEMO_WALLETS.SELLER_KYC,
        buyers: DEMO_BUYERS.map(b => b.wallet),
    });
});

// ============================================
// Seed Vertical table records — parents + hierarchical children
// ============================================

const VERTICAL_DISPLAY_NAMES: Record<string, string> = {
    solar: 'Solar', mortgage: 'Mortgage', roofing: 'Roofing', insurance: 'Insurance',
    home_services: 'Home Services', b2b_saas: 'B2B SaaS', real_estate: 'Real Estate',
    auto: 'Auto', legal: 'Legal', financial_services: 'Financial Services',
};

async function seedVerticals(): Promise<number> {
    let seeded = 0;

    // 1. Seed parent (depth 0) verticals
    for (let i = 0; i < FALLBACK_VERTICALS.length; i++) {
        const slug = FALLBACK_VERTICALS[i];
        const name = VERTICAL_DISPLAY_NAMES[slug] || slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        await prisma.vertical.upsert({
            where: { slug },
            update: { status: 'ACTIVE', sortOrder: i },
            create: {
                slug, name, depth: 0, sortOrder: i, status: 'ACTIVE',
                aliases: [], restrictedGeos: [],
                requiresTcpa: ['mortgage', 'insurance', 'solar'].includes(slug),
                requiresKyc: ['financial_services', 'legal'].includes(slug),
            },
        });
        seeded++;
    }

    // 2. Seed child (depth 1) verticals
    for (let i = 0; i < HIERARCHICAL_VERTICALS.length; i++) {
        const { parent, child, name } = HIERARCHICAL_VERTICALS[i];
        const parentRecord = await prisma.vertical.findUnique({ where: { slug: parent } });
        await prisma.vertical.upsert({
            where: { slug: child },
            update: { status: 'ACTIVE', sortOrder: i },
            create: {
                slug: child, name, depth: 1, sortOrder: i, status: 'ACTIVE',
                parentId: parentRecord?.id || undefined,
                aliases: [], restrictedGeos: [],
                requiresTcpa: ['mortgage', 'insurance', 'solar'].includes(parent),
                requiresKyc: ['financial_services', 'legal'].includes(parent),
            },
        });
        seeded++;
    }

    clearAllCaches();
    console.log(`[DEMO] Seeded ${seeded} verticals (parents + children) into Vertical table`);
    return seeded;
}

// ============================================
// GET /status — current demo data counts
// ============================================
router.get('/status', async (_req: Request, res: Response) => {
    try {
        // Count demo-tagged data using consentProof field as tag
        const [leads, bids, asks] = await Promise.all([
            prisma.lead.count({ where: { consentProof: DEMO_TAG } }),
            prisma.bid.count({ where: { lead: { consentProof: DEMO_TAG } } }),
            prisma.ask.count({ where: { parameters: { path: ['_demoTag'], equals: DEMO_TAG } } }),
        ]);

        res.json({
            seeded: leads > 0,
            leads,
            bids,
            asks,
        });
    } catch (error) {
        console.error('Demo status error:', error);
        res.json({ seeded: false, leads: 0, bids: 0, asks: 0 });
    }
});

// ============================================
// POST /seed — populate marketplace with demo data
// ============================================
router.post('/seed', async (req: Request, res: Response) => {
    try {
        // Seed Vertical table records first (ensures hierarchy API returns data)
        await seedVerticals();

        // Fetch verticals dynamically from DB, fall back to hard-coded list
        let VERTICALS = FALLBACK_VERTICALS;
        try {
            const dbVerticals = await (prisma as any).vertical?.findMany?.({
                where: { status: 'ACTIVE', depth: 0 },
                select: { slug: true },
                orderBy: { sortOrder: 'asc' },
            });
            if (dbVerticals && dbVerticals.length > 0) {
                VERTICALS = dbVerticals.map((v: any) => v.slug);
                console.log(`[DEMO] Using ${VERTICALS.length} dynamic verticals from DB`);
            } else {
                console.log(`[DEMO] No DB verticals found, using ${FALLBACK_VERTICALS.length} fallback verticals`);
            }
        } catch {
            console.log(`[DEMO] Vertical table not available, using fallback verticals`);
        }

        // Auto-clear existing demo data (makes seed idempotent)
        // Must delete in FK dependency order: Transaction uses RESTRICT on leadId
        const existing = await prisma.lead.count({ where: { consentProof: DEMO_TAG } });
        if (existing > 0) {
            console.log(`[DEMO] Auto-clearing ${existing} existing demo leads before re-seed`);
            await prisma.bid.deleteMany({ where: { lead: { consentProof: DEMO_TAG } } });
            await prisma.transaction.deleteMany({ where: { lead: { consentProof: DEMO_TAG } } });
            await prisma.auctionRoom.deleteMany({ where: { lead: { consentProof: DEMO_TAG } } });

            await prisma.lead.deleteMany({ where: { consentProof: DEMO_TAG } });
            await prisma.ask.deleteMany({ where: { parameters: { path: ['_demoTag'], equals: DEMO_TAG } } });
            clearAllCaches();
        }

        // Find or create a demo user + profiles
        let demoUser = await prisma.user.findFirst({ where: { walletAddress: DEMO_WALLETS.PANEL_USER } });
        if (!demoUser) {
            demoUser = await prisma.user.create({
                data: {
                    walletAddress: DEMO_WALLETS.PANEL_USER,
                    role: 'SELLER',
                    sellerProfile: {
                        create: {
                            companyName: 'Demo Seller Co.',
                            verticals: VERTICALS,
                            isVerified: true,
                            kycStatus: 'VERIFIED',
                        },
                    },
                    buyerProfile: {
                        create: {
                            companyName: 'Demo Buyer Corp.',
                            verticals: VERTICALS,
                            acceptOffSite: true,
                        },
                    },
                },
                include: { sellerProfile: true, buyerProfile: true },
            });
        } else {
            // Ensure profiles exist for previously created user
            const existingSeller = await prisma.sellerProfile.findFirst({ where: { userId: demoUser.id } });
            if (!existingSeller) {
                await prisma.sellerProfile.create({
                    data: { userId: demoUser.id, companyName: 'Demo Seller Co.', verticals: VERTICALS, isVerified: true, kycStatus: 'VERIFIED' },
                });
            }
            const existingBuyer = await prisma.buyerProfile.findFirst({ where: { userId: demoUser.id } });
            if (!existingBuyer) {
                await prisma.buyerProfile.create({
                    data: { userId: demoUser.id, companyName: 'Demo Buyer Corp.', verticals: VERTICALS, acceptOffSite: true },
                });
            }
        }

        const seller = await prisma.sellerProfile.findFirst({ where: { userId: demoUser.id } });
        if (!seller) {
            res.status(500).json({ error: 'Failed to create demo seller profile' });
            return;
        }

        // Create demo buyer users for multi-user bid simulation
        const buyerUserIds: string[] = [];
        for (const buyer of DEMO_BUYERS) {
            let buyerUser = await prisma.user.findFirst({ where: { walletAddress: buyer.wallet } });
            if (!buyerUser) {
                buyerUser = await prisma.user.create({
                    data: {
                        walletAddress: buyer.wallet,
                        role: 'BUYER',
                        buyerProfile: {
                            create: {
                                companyName: buyer.company,
                                verticals: VERTICALS.slice(0, 5),
                                acceptOffSite: true,
                            },
                        },
                    },
                });
            }
            buyerUserIds.push(buyerUser.id);
        }

        // Create 5 asks (one per 2 verticals)
        let askCount = 0;
        for (let i = 0; i < 5; i++) {
            const vertical = VERTICALS[i * 2];
            const askGeo = pick(GEOS);
            const askGeo2 = pick(GEOS);
            await prisma.ask.create({
                data: {
                    sellerId: seller.id,
                    vertical,
                    geoTargets: { country: askGeo.country, states: [askGeo.state, askGeo2.state] as string[] },
                    reservePrice: rand(priceFor(vertical).min, priceFor(vertical).max),
                    status: 'ACTIVE',
                    parameters: { _demoTag: DEMO_TAG },
                    auctionDuration: LEAD_AUCTION_DURATION_SECS,
                },
            });
            askCount++;
        }

        // Create 10 leads using hierarchical verticals — mix of IN_AUCTION + UNSOLD
        let leadCount = 0;
        const leadIds: string[] = [];

        for (let i = 0; i < 10; i++) {
            const vertical = DEMO_VERTICALS[i % DEMO_VERTICALS.length];
            const geo = pick(GEOS);
            const pr = priceFor(vertical);
            const price = rand(pr.min, pr.max);

            // Status distribution: 60% IN_AUCTION, 30% UNSOLD (Buy Now), 10% SOLD
            const r = Math.random();
            const status = r < 0.6 ? 'IN_AUCTION' : r < 0.9 ? 'UNSOLD' : 'SOLD';

            const now = new Date();
            const createdAt = new Date(now.getTime() - rand(0, 3) * 86400000);
            // Only IN_AUCTION leads get a ticking countdown; UNSOLD/SOLD don't have auction timers
            const auctionEnd = status === 'IN_AUCTION'
                ? new Date(now.getTime() + LEAD_AUCTION_DURATION_SECS * 1000)
                : undefined;

            // Build non-PII parameters
            const params = buildVerticalDemoParams(vertical);

            const lead = await prisma.lead.create({
                data: {
                    sellerId: seller.id,
                    vertical,
                    geo: { country: geo.country, state: geo.state, city: geo.city, zip: `${rand(10000, 99999)}` },
                    source: 'PLATFORM',
                    status: status as any,
                    reservePrice: price,
                    buyNowPrice: status === 'UNSOLD' ? Math.round(price * 1.2) : undefined,
                    expiresAt: status === 'UNSOLD' ? new Date(now.getTime() + 7 * 86400000) : undefined,
                    winningBid: status === 'SOLD' ? price * 1.2 : undefined,
                    isVerified: true,
                    tcpaConsentAt: createdAt,
                    consentProof: DEMO_TAG,
                    createdAt,
                    auctionStartAt: createdAt,
                    auctionEndAt: auctionEnd ?? undefined,
                    soldAt: status === 'SOLD' ? new Date(createdAt.getTime() + rand(1, 3) * 86400000) : undefined,
                    parameters: params as any,
                },
            });

            leadIds.push(lead.id);
            leadCount++;
        }

        // Create bids for IN_AUCTION leads
        let bidCount = 0;
        const auctionLeads = await prisma.lead.findMany({
            where: { id: { in: leadIds }, status: 'IN_AUCTION' },
            select: { id: true, reservePrice: true },
        });

        for (const lead of auctionLeads) {
            // Create bids from different demo buyers (respects @@unique([leadId, buyerId]))
            const shuffledBuyers = [...buyerUserIds].sort(() => Math.random() - 0.5);
            // Only 1 bot bid per lead — conservative so the user can win
            const numBidders = demoBuyersEnabled ? 1 : 0;
            const baseAmount = Number(lead.reservePrice || 20);

            for (let b = 0; b < numBidders; b++) {
                await prisma.bid.create({
                    data: {
                        leadId: lead.id,
                        buyerId: shuffledBuyers[b],
                        amount: baseAmount + rand(1, 8),
                        status: 'REVEALED',
                        source: 'MANUAL',
                    },
                });
                bidCount++;
            }
        }

        // Notify all clients to refresh marketplace
        const io = req.app.get('io');
        if (io) io.emit('marketplace:refreshAll');

        res.json({
            success: true,
            leads: leadCount,
            bids: bidCount,
            asks: askCount,
        });
    } catch (error) {
        console.error('Demo seed error:', error);
        res.status(500).json({ error: 'Failed to seed demo data', details: String(error) });
    }
});

// ============================================
// POST /clear — remove all demo data
// ============================================
router.post('/clear', async (req: Request, res: Response) => {
    try {
        // Delete ALL data in dependency order — ensures old long-duration / orphan records are removed
        const deletedBids = await prisma.bid.deleteMany({});
        await prisma.auctionRoom.deleteMany({});
        await prisma.transaction.deleteMany({});
        const deletedLeads = await prisma.lead.deleteMany({});
        const deletedAsks = await prisma.ask.deleteMany({});

        // Flush all in-memory LRU caches so stale data doesn't persist
        const cachesFlushed = clearAllCaches();

        // Notify clients marketplace is empty
        const io = req.app.get('io');
        if (io) io.emit('marketplace:refreshAll');

        res.json({
            success: true,
            deleted: {
                leads: deletedLeads.count,
                bids: deletedBids.count,
                asks: deletedAsks.count,
            },
            cachesFlushed,
        });
    } catch (error) {
        console.error('Demo clear error:', error);
        res.status(500).json({ error: 'Failed to clear demo data', details: String(error) });
    }
});

// ============================================
// POST /lead — inject single random lead
// ============================================
router.post('/lead', async (req: Request, res: Response) => {
    try {
        const vertical = req.body?.vertical || pick(DEMO_VERTICALS);
        const geo = pick(GEOS);
        const pr = priceFor(vertical);
        const price = rand(pr.min, pr.max);

        let seller = await prisma.sellerProfile.findFirst({
            where: { user: { walletAddress: DEMO_WALLETS.PANEL_USER } },
        });

        if (!seller) {
            // Auto-create demo seller so inject works without prior seed
            let demoUser = await prisma.user.findFirst({ where: { walletAddress: DEMO_WALLETS.PANEL_USER } });
            if (!demoUser) {
                demoUser = await prisma.user.create({
                    data: {
                        walletAddress: DEMO_WALLETS.PANEL_USER,
                        role: 'SELLER',
                        sellerProfile: { create: { companyName: 'Demo Seller Co.', verticals: FALLBACK_VERTICALS, isVerified: true, kycStatus: 'VERIFIED' } },
                    },
                    include: { sellerProfile: true },
                });
            } else {
                await prisma.sellerProfile.create({
                    data: { userId: demoUser.id, companyName: 'Demo Seller Co.', verticals: FALLBACK_VERTICALS, isVerified: true, kycStatus: 'VERIFIED' },
                });
            }
            seller = await prisma.sellerProfile.findFirst({ where: { user: { walletAddress: DEMO_WALLETS.PANEL_USER } } });
            if (!seller) {
                res.status(500).json({ error: 'Failed to auto-create demo seller profile' });
                return;
            }
            // Also seed verticals so hierarchy API works
            await seedVerticals();
        }

        // Build non-PII form parameters from vertical schema (randomized)
        const params = buildVerticalDemoParams(vertical);

        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical,
                geo: { country: geo.country, state: geo.state, city: geo.city, zip: `${rand(10000, 99999)}` },
                source: 'PLATFORM',
                status: 'IN_AUCTION',
                reservePrice: price,
                isVerified: true,
                tcpaConsentAt: new Date(),
                consentProof: DEMO_TAG,
                auctionStartAt: new Date(),
                auctionEndAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
                parameters: params as any,
            },
        });

        // Emit real-time event for new lead
        const io = req.app.get('io');
        if (io) {
            io.emit('marketplace:lead:new', {
                lead: {
                    id: lead.id,
                    vertical,
                    status: 'IN_AUCTION',
                    reservePrice: price,
                    geo: { country: geo.country, state: geo.state },
                    isVerified: true,
                    sellerId: seller.id,
                    auctionStartAt: lead.auctionStartAt?.toISOString(),
                    auctionEndAt: lead.auctionEndAt?.toISOString(),
                    parameters: params,
                    _count: { bids: 0 },
                },
            });
        }

        res.json({ success: true, lead: { id: lead.id, vertical, geo: { country: geo.country, state: geo.state }, price, parameters: params } });
    } catch (error) {
        console.error('Demo inject lead error:', error);
        res.status(500).json({ error: 'Failed to inject lead' });
    }
});

// ============================================
// POST /auction — simulate live auction (create lead + bids over time)
// ============================================
router.post('/auction', async (req: Request, res: Response) => {
    try {
        const vertical = req.body?.vertical || pick(DEMO_VERTICALS);
        const geo = pick(GEOS);
        const pr = priceFor(vertical);
        const reservePrice = rand(pr.min, pr.max);

        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { walletAddress: DEMO_WALLETS.PANEL_USER } },
        });

        const demoUser = await prisma.user.findFirst({
            where: { walletAddress: DEMO_WALLETS.PANEL_USER },
        });

        // Gather all demo buyer IDs for multi-user bids
        const demoBuyerUsers = await prisma.user.findMany({
            where: { walletAddress: { in: DEMO_BUYERS.map(b => b.wallet) } },
            select: { id: true, walletAddress: true },
        });
        // Fallback to demoUser if buyers don't exist yet
        const bidderIds = demoBuyerUsers.length > 0
            ? demoBuyerUsers.map(u => u.id)
            : demoUser ? [demoUser.id] : [];

        if (!seller || !demoUser) {
            res.status(400).json({ error: 'Demo data not seeded. Seed marketplace first.' });
            return;
        }

        // Create lead in auction
        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical,
                geo: { country: geo.country, state: geo.state, city: geo.city, zip: `${rand(10000, 99999)}` },
                source: 'PLATFORM',
                status: 'IN_AUCTION',
                reservePrice,
                isVerified: true,
                tcpaConsentAt: new Date(),
                consentProof: DEMO_TAG,
                auctionStartAt: new Date(),
                auctionEndAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000), // 60s auction
            },
        });

        // Create auction room
        await prisma.auctionRoom.create({
            data: {
                leadId: lead.id,
                roomId: `demo-auction-${lead.id}`,
                phase: 'BIDDING',
                biddingEndsAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
                revealEndsAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000), // no separate reveal
                participants: [demoUser.id],
            },
        });

        // Emit real-time event for new auction lead
        const io = req.app.get('io');
        if (io) {
            io.emit('marketplace:lead:new', {
                lead: {
                    id: lead.id,
                    vertical,
                    status: 'IN_AUCTION',
                    reservePrice,
                    geo: { country: geo.country, state: geo.state },
                    isVerified: true,
                    auctionStartAt: new Date().toISOString(),
                    auctionEndAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000).toISOString(),
                    _count: { bids: 0 },
                },
            });
        }

        // Simulate bids arriving over auction window (conservative — user should outbid)
        // Only if demo buyers are enabled
        const bidIntervals = demoBuyersEnabled ? [5000, 15000, 30000] : []; // 3 bids at 5s, 15s, 30s
        let currentBid = reservePrice;

        bidIntervals.forEach((delay, index) => {
            setTimeout(async () => {
                try {
                    currentBid += rand(1, 4);  // small increments — easy to outbid
                    const bidderId = bidderIds[index % bidderIds.length];
                    await prisma.bid.create({
                        data: {
                            leadId: lead.id,
                            buyerId: bidderId,
                            amount: currentBid,
                            status: 'REVEALED',
                            source: 'MANUAL',
                        },
                    });
                    await prisma.auctionRoom.update({
                        where: { leadId: lead.id },
                        data: { bidCount: { increment: 1 }, highestBid: currentBid },
                    });

                    // Emit real-time bid update
                    if (io) {
                        io.emit('marketplace:bid:update', {
                            leadId: lead.id,
                            bidCount: index + 1,
                            highestBid: currentBid,
                            timestamp: new Date().toISOString(),
                        });
                    }
                } catch (err) {
                    console.error('Demo auction bid error:', err);
                }
            }, delay);
        });

        res.json({
            success: true,
            leadId: lead.id,
            vertical,
            reservePrice,
            auctionEndsIn: '60 seconds',
            simulatedBids: bidIntervals.length,  // 0 if demo buyers off, 3 if on
            demoBuyersEnabled,
        });
    } catch (error) {
        console.error('Demo auction error:', error);
        res.status(500).json({ error: 'Failed to start demo auction' });
    }
});

// ============================================
// POST /reset — clear ALL data + reseed fresh short auctions
// ============================================
router.post('/reset', async (req: Request, res: Response) => {
    try {
        // 1. Clear everything (FK dependency order)
        await prisma.bid.deleteMany({});
        await prisma.auctionRoom.deleteMany({});
        await prisma.transaction.deleteMany({});
        const cleared = await prisma.lead.deleteMany({});
        await prisma.ask.deleteMany({});

        // Flush all in-memory LRU caches so stale data doesn't persist
        clearAllCaches();

        // Keep verticals seeded so hierarchy API stays functional
        await seedVerticals();

        // 2. Notify clients to refresh (dashboards will now be empty)
        const io = req.app.get('io');
        if (io) io.emit('marketplace:refreshAll');

        res.json({
            success: true,
            cleared: cleared.count,
            message: 'All marketplace data cleared. Both dashboards are now empty. Use Seed or Inject to add data.',
        });
    } catch (error) {
        console.error('Demo reset error:', error);
        res.status(500).json({ error: 'Failed to reset demo state', details: String(error) });
    }
});

// ============================================
// POST /seed-templates — Reset + seed all formConfig templates
// ============================================
router.post('/seed-templates', async (req: Request, res: Response) => {
    try {
        // 1. Clear all existing formConfig
        await prisma.vertical.updateMany({
            where: { formConfig: { not: undefined } },
            data: { formConfig: undefined },
        });

        // 2. Ensure verticals exist
        await seedVerticals();

        // 3. Apply all templates
        let updated = 0;
        for (const [slug, config] of Object.entries(FORM_CONFIG_TEMPLATES)) {
            const result = await prisma.vertical.updateMany({
                where: { slug },
                data: { formConfig: config as any },
            });
            if (result.count > 0) updated++;
        }

        res.json({
            success: true,
            templatesApplied: updated,
            totalTemplates: Object.keys(FORM_CONFIG_TEMPLATES).length,
            message: `Applied ${updated} form config templates across all verticals.`,
        });
    } catch (error) {
        console.error('Seed templates error:', error);
        res.status(500).json({ error: 'Failed to seed form templates', details: String(error) });
    }
});

// ============================================
// Settle (x402 Escrow Release) — on-chain settlement
// ============================================

router.post('/settle', async (req: Request, res: Response) => {
    try {
        const { leadId } = req.body as { leadId?: string };
        const { x402Service } = await import('../services/x402.service');

        console.log(`[DEMO SETTLE] Request received — leadId=${leadId || '(auto-detect)'}`);

        // ── Guard: on-chain infra must be configured ──
        if (!process.env.DEPLOYER_PRIVATE_KEY) {
            res.status(503).json({
                error: 'Server signer not configured',
                hint: 'Set DEPLOYER_PRIVATE_KEY env var on Render',
            });
            return;
        }
        if (!process.env.ESCROW_CONTRACT_ADDRESS) {
            res.status(503).json({
                error: 'Escrow contract address not configured',
                hint: 'Set ESCROW_CONTRACT_ADDRESS env var on Render',
            });
            return;
        }

        // 1. Find the most recent unsettled transaction
        let transaction = await prisma.transaction.findFirst({
            where: {
                ...(leadId ? { leadId } : {}),
                escrowReleased: false,
            },
            orderBy: { createdAt: 'desc' },
            include: {
                lead: {
                    select: {
                        id: true, vertical: true, status: true, nftTokenId: true,
                        sellerId: true,
                        seller: {
                            select: {
                                user: { select: { walletAddress: true } },
                            },
                        },
                    },
                },
                buyer: { select: { id: true, walletAddress: true } },
            },
        });

        if (!transaction) {
            // ── Auto-create Transaction from winning bid ──
            // Demo/manual bids may resolve the auction without creating a Transaction record.
            // Find a SOLD lead with an ACCEPTED bid and create the Transaction on the fly.
            console.warn(`[DEMO SETTLE] No unsettled transaction found — attempting to create from winning bid`);

            const soldLead = await prisma.lead.findFirst({
                where: {
                    ...(leadId ? { id: leadId } : {}),
                    status: 'SOLD',
                },
                include: {
                    bids: {
                        where: { status: 'ACCEPTED' },
                        take: 1,
                        include: { buyer: { select: { id: true, walletAddress: true } } },
                    },
                    seller: {
                        select: { user: { select: { walletAddress: true } } },
                    },
                },
                orderBy: { soldAt: 'desc' },
            });

            if (!soldLead || soldLead.bids.length === 0) {
                console.warn(`[DEMO SETTLE] No SOLD lead with ACCEPTED bid found (leadId=${leadId || 'any'})`);
                res.status(404).json({
                    error: 'No unsettled transaction found',
                    hint: leadId
                        ? `No pending transaction for lead ${leadId}. Is the auction resolved?`
                        : 'Run an auction first, then settle it',
                });
                return;
            }

            const winningBid = soldLead.bids[0];
            const amount = Number(winningBid.amount ?? 0);

            // Create the missing Transaction record
            transaction = await prisma.transaction.create({
                data: {
                    leadId: soldLead.id,
                    buyerId: winningBid.buyerId,
                    amount: winningBid.amount!,
                    platformFee: amount * 0.025,
                    status: 'PENDING',
                    escrowReleased: false,
                },
                include: {
                    lead: {
                        select: {
                            id: true, vertical: true, status: true, nftTokenId: true,
                            sellerId: true,
                            seller: {
                                select: {
                                    user: { select: { walletAddress: true } },
                                },
                            },
                        },
                    },
                    buyer: { select: { id: true, walletAddress: true } },
                },
            });
            console.log(`[DEMO SETTLE] Auto-created Transaction ${transaction.id} for lead ${soldLead.id}`);
        }

        const buyerWallet = transaction.buyer?.walletAddress;
        const sellerWallet = (transaction.lead as any)?.seller?.user?.walletAddress;
        const amount = Number(transaction.amount);
        const tokenId = parseInt(transaction.lead?.nftTokenId || '0', 10);

        console.log(`[DEMO SETTLE] Found tx=${transaction.id} | lead=${transaction.leadId} | $${amount} | escrowId=${transaction.escrowId || '(none)'} | buyer=${buyerWallet?.slice(0, 10)} | seller=${sellerWallet?.slice(0, 10)}`);

        if (!buyerWallet || !sellerWallet) {
            res.status(400).json({
                error: 'Missing wallet addresses',
                hint: `buyer=${buyerWallet || 'MISSING'}, seller=${sellerWallet || 'MISSING'}. Both must be connected.`,
            });
            return;
        }

        // 2. If no escrow yet, create + fund on-chain escrow
        if (!transaction.escrowId) {
            console.log(`[DEMO SETTLE] No escrowId — creating on-chain escrow via x402Service.createPayment`);
            const createResult = await x402Service.createPayment(
                sellerWallet,
                buyerWallet,
                amount,
                tokenId,
                transaction.id,
            );

            if (!createResult.success) {
                console.error(`[DEMO SETTLE] createPayment failed: ${createResult.error}`);
                res.status(500).json({
                    error: 'Failed to create on-chain escrow',
                    details: createResult.error,
                });
                return;
            }
            console.log(`[DEMO SETTLE] Escrow created+funded — escrowId=${createResult.escrowId}, txHash=${createResult.txHash}`);
        }

        // 3. Release the escrow on-chain
        console.log(`[DEMO SETTLE] Releasing escrow via x402Service.settlePayment`);
        const settleResult = await x402Service.settlePayment(transaction.id);

        if (!settleResult.success) {
            console.error(`[DEMO SETTLE] settlePayment failed: ${settleResult.error}`);
            res.status(500).json({
                error: 'On-chain escrow release failed',
                details: settleResult.error,
            });
            return;
        }

        // 4. Mark lead as SOLD
        await prisma.lead.update({
            where: { id: transaction.leadId },
            data: { status: 'SOLD', soldAt: new Date() },
        });
        console.log(`[DEMO SETTLE] Lead ${transaction.leadId} → SOLD`);

        console.log(`[DEMO SETTLE] ✅ Complete — txHash=${settleResult.txHash}`);
        res.json({
            success: true,
            transactionId: transaction.id,
            leadId: transaction.leadId,
            buyerId: transaction.buyerId,
            buyerWallet,
            amount,
            escrowId: transaction.escrowId,
            txHash: settleResult.txHash || null,
            escrowReleased: true,
            message: `✅ On-chain settlement complete — escrow released, USDC transferred, lead SOLD. txHash=${settleResult.txHash?.slice(0, 14)}…`,
        });
    } catch (error: any) {
        console.error('[DEMO SETTLE] Unexpected error:', error);
        res.status(500).json({
            error: 'Settlement failed',
            details: error.message,
            stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
        });
    }
});

export default router;
