/**
 * Demo Panel API Routes
 * 
 * Development-only endpoints for demo control panel.
 * Gated by NODE_ENV check — returns 403 in production.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { calculateFees, type BidSourceType } from '../lib/fees';
import { getConfig, setConfig } from '../lib/config';
import { LEAD_AUCTION_DURATION_SECS } from '../config/perks.env';
import { clearAllCaches } from '../lib/cache';
import { generateToken, authMiddleware, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { FORM_CONFIG_TEMPLATES } from '../data/form-config-templates';
import { creService } from '../services/cre.service';
import { aceService } from '../services/ace.service';
import { nftService } from '../services/nft.service';
import { computeCREQualityScore, type LeadScoringInput } from '../lib/chainlink/cre-quality-score';

const router = Router();


// ============================================
// Production Guard — block all demo routes in prod
// ============================================

const devOnly = (req: Request, res: Response, next: NextFunction) => {
    // For hackathon demo: allow demo routes unless explicitly disabled
    // Set DEMO_MODE=false to disable demo routes in production
    if (process.env.DEMO_MODE === 'false') {
        // Always include CORS headers so the browser doesn't hide the real error
        const origin = req.headers.origin;
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        res.status(403).json({ error: 'Demo endpoints disabled' });
        return;
    }
    next();
};

router.use(devOnly);

// TD-08 fix: Demo data is now identified via source='DEMO' (LeadSource enum)
// instead of hijacking consentProof. The DEMO_TAG constant is kept only for Ask._demoTag.
const DEMO_TAG = 'DEMO_PANEL';  // Only for Ask.parameters._demoTag (no LeadSource on Ask model)

// Real Base Sepolia wallet addresses for demo personas (replaces old 0xDEMO_ placeholders)
// All addresses normalized to lowercase for consistent DB lookups.
const DEMO_WALLETS = {
    PANEL_USER: '0x88dda5d4b22fa15edaf94b7a97508ad7693bdc58',   // Demo panel user
    ADMIN: '0x88dda5d4b22fa15edaf94b7a97508ad7693bdc58',   // Admin (same as panel user)
    BUYER: '0x424cac929939377f221348af52d4cb1247fe4379',   // Demo buyer (Wallet 4)
    SELLER: '0x9bb15f98982715e33a2113a35662036528ee0a36',   // Demo seller (Wallet 11 — DEMO_SELLER_WALLET)
    BUYER_1: '0x88dda5d4b22fa15edaf94b7a97508ad7693bdc58',   // Auction bidder 1
    BUYER_2: '0x424cac929939377f221348af52d4cb1247fe4379',   // Auction bidder 2
    BUYER_3: '0x089b6bdb4824628c5535acf60abf80683452e862',   // Auction bidder 3
    SELLER_KYC: '0x6bbcf283847f409a58ff984a79efd5719d3a9f70',   // Verified seller (deployer)
};

// 10 faucet wallets for seller rotation (from faucet-wallets.txt)
const FAUCET_WALLETS = [
    '0xa75d76b27ff9511354c78cb915cfc106c6b23dd9',
    '0x55190ce8a38079d8415a1ba15d001bc1a52718ec',
    '0x88dda5d4b22fa15edaf94b7a97508ad7693bdc58',
    '0x424cac929939377f221348af52d4cb1247fe4379',
    '0x3a9a41078992734ab24dfb51761a327eeaac7b3d',
    '0x089b6bdb4824628c5535acf60abf80683452e862',
    '0xc92a0a5080077fb8c2b756f8f52419cb76d99afe',
    '0xb9edeeb25bf7f2db79c03e3175d71e715e5ee78c',
    '0xe10a5ba5fe03adb833b8c01ff12cedc4422f0fdf',
    '0x7be5ce8824d5c1890bc09042837ceac57a55fdad',
];

let faucetWalletIndex = 0;
function pickFaucetWallet(): string {
    const wallet = FAUCET_WALLETS[faucetWalletIndex % FAUCET_WALLETS.length];
    faucetWalletIndex++;
    return wallet;
}

// TD-06 fix: toggle is now persisted in PlatformConfig DB table.
// Default: false in production, true in dev/demo mode.
const DEMO_BUYERS_KEY = 'demoBuyersEnabled';
const DEMO_BUYERS_DEFAULT = (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') ? 'false' : 'true';

/** Read the current toggle state — persisted in DB, cached in memory (5 s). */
export async function getDemoBuyersEnabled(): Promise<boolean> {
    const val = await getConfig(DEMO_BUYERS_KEY, DEMO_BUYERS_DEFAULT);
    return val === 'true';
}

// CRE-Native Demo Mode toggle — persisted in PlatformConfig.
// When ON, injected leads are evaluated by the CRE 7-gate workflow.
const CRE_NATIVE_MODE_KEY = 'creNativeDemoMode';

export async function getCreNativeModeEnabled(): Promise<boolean> {
    const val = await getConfig(CRE_NATIVE_MODE_KEY, 'false');
    return val === 'true';
}

// ============================================
// Demo Login — returns a real JWT for demo personas
// ============================================

router.post('/demo-login', async (req: Request, res: Response) => {
    try {
        const { role } = req.body as { role?: string };
        const isBuyer = role === 'BUYER';
        // Always use the fixed persona wallet — ignore MetaMask connectedWallet.
        // The whole point of persona switching is to authenticate AS the demo wallet
        // so GET /bids/my returns bids owned by the persona wallet's userId.
        const walletAddress = (isBuyer ? DEMO_WALLETS.BUYER : DEMO_WALLETS.SELLER).toLowerCase();
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

        // Ensure buyer has a profile with KYC VERIFIED so ACE canTransact() passes.
        // Without this, isKYCValid() falls back to checking buyerProfile.kycStatus,
        // finds no profile (or PENDING), and silently blocks all bids.
        if (isBuyer) {
            await prisma.buyerProfile.upsert({
                where: { userId: user.id },
                create: {
                    userId: user.id,
                    companyName: 'Demo Buyer',
                    verticals: [],
                    acceptOffSite: true,
                    kycStatus: 'VERIFIED',
                },
                update: {
                    kycStatus: 'VERIFIED',
                },
            });

            // Register buyer on-chain via ACECompliance.verifyKYC()
            // This calls the real contract so on-chain canTransact() passes.
            // Also caches a ComplianceCheck in the DB as fallback.
            try {
                await aceService.autoKYC(walletAddress);
                console.log(`[DEMO] On-chain KYC registered for buyer ${walletAddress}`);
            } catch (err: any) {
                console.warn(`[DEMO] On-chain KYC failed (will use DB fallback): ${err.message}`);
                // Ensure DB compliance check exists even if on-chain fails
                const existingCheck = await prisma.complianceCheck.findFirst({
                    where: {
                        entityType: 'user',
                        entityId: walletAddress.toLowerCase(),
                        checkType: 'KYC',
                        status: 'PASSED',
                        expiresAt: { gt: new Date() },
                    },
                });
                if (!existingCheck) {
                    await prisma.complianceCheck.create({
                        data: {
                            entityType: 'user',
                            entityId: walletAddress.toLowerCase(),
                            checkType: 'KYC',
                            status: 'PASSED',
                            checkedAt: new Date(),
                            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                        },
                    });
                }
            }
        } else {
            // Seller persona — ensure SellerProfile exists so analytics overview
            // endpoint returns real stats (Total Leads, Revenue, Conversion, etc.).
            await prisma.sellerProfile.upsert({
                where: { userId: user.id },
                create: {
                    userId: user.id,
                    companyName: 'Demo Seller',
                    verticals: [],
                    isVerified: true,
                    kycStatus: 'VERIFIED',
                },
                update: {
                    kycStatus: 'VERIFIED',
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

router.get('/demo-buyers-toggle', authMiddleware, publicDemoBypass, async (_req: Request, res: Response) => {
    const enabled = await getDemoBuyersEnabled();
    res.json({ enabled });
});

router.post('/demo-buyers-toggle', authMiddleware, publicDemoBypass, async (req: Request, res: Response) => {
    const { enabled } = req.body as { enabled?: boolean };
    let newValue: boolean;
    if (typeof enabled === 'boolean') {
        newValue = enabled;
    } else {
        // Toggle: read current then flip
        newValue = !(await getDemoBuyersEnabled());
    }
    await setConfig(DEMO_BUYERS_KEY, String(newValue));
    console.log(`[DEMO] Demo buyers toggled → ${newValue ? 'ON' : 'OFF'} (persisted)`);
    res.json({ enabled: newValue });
});

// ============================================
// GET /cre-mode — read CRE-Native demo mode toggle
// POST /cre-mode — set CRE-Native demo mode toggle
// ============================================

router.get('/cre-mode', async (_req: Request, res: Response) => {
    const enabled = await getCreNativeModeEnabled();
    res.json({ enabled });
});

router.post('/cre-mode', authMiddleware, publicDemoBypass, async (req: Request, res: Response) => {
    const { enabled } = req.body as { enabled?: boolean };
    let newValue: boolean;
    if (typeof enabled === 'boolean') {
        newValue = enabled;
    } else {
        newValue = !(await getCreNativeModeEnabled());
    }
    await setConfig(CRE_NATIVE_MODE_KEY, String(newValue));
    console.log(`[DEMO] CRE-Native mode toggled → ${newValue ? 'ON' : 'OFF'} (persisted)`);
    res.json({ enabled: newValue });
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
        // Count demo-tagged data using source='DEMO' (TD-08 fix)
        const [leads, bids, asks] = await Promise.all([
            prisma.lead.count({ where: { source: 'DEMO' } }),
            prisma.bid.count({ where: { lead: { source: 'DEMO' } } }),
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
router.post('/seed', authMiddleware, publicDemoBypass, async (req: Request, res: Response) => {
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
        const existing = await prisma.lead.count({ where: { source: 'DEMO' } });
        if (existing > 0) {
            console.log(`[DEMO] Auto-clearing ${existing} existing demo leads before re-seed`);
            await prisma.bid.deleteMany({ where: { lead: { source: 'DEMO' } } });
            await prisma.transaction.deleteMany({ where: { lead: { source: 'DEMO' } } });
            await prisma.auctionRoom.deleteMany({ where: { lead: { source: 'DEMO' } } });

            await prisma.lead.deleteMany({ where: { source: 'DEMO' } });
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
                            kycStatus: 'VERIFIED',
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
                    data: { userId: demoUser.id, companyName: 'Demo Buyer Corp.', verticals: VERTICALS, acceptOffSite: true, kycStatus: 'VERIFIED' },
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
                                kycStatus: 'VERIFIED',
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

        // Accept optional sellerId from request body — allows attributing all leads
        // to the session user's seller profile instead of rotating faucet wallets
        let sessionSellerId: string | null = null;
        if (req.body?.sellerId) {
            const sessionSeller = await prisma.sellerProfile.findFirst({
                where: { user: { id: req.body.sellerId } },
            });
            if (sessionSeller) sessionSellerId = sessionSeller.id;
        }

        // Create N leads using hierarchical verticals — mix of IN_AUCTION + UNSOLD
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
            // Auction timestamps: both anchored to `now` so the progress bar starts at 0%
            const auctionStartAt = status === 'IN_AUCTION' ? now : undefined;
            const auctionEndAt = status === 'IN_AUCTION'
                ? new Date(now.getTime() + LEAD_AUCTION_DURATION_SECS * 1000)
                : status === 'SOLD'
                    ? new Date(now.getTime() - rand(1, 5) * 60_000) // ended in the past
                    : undefined;

            // Build non-PII parameters
            const params = buildVerticalDemoParams(vertical);

            // Compute quality score (same algo as POST /lead — CREVerifier stub)
            const seedGeo = { country: geo.country, state: geo.state, city: geo.city, zip: `${rand(10000, 99999)}` };
            const paramCount = params ? Object.keys(params).filter((k: string) => (params as any)[k] != null && (params as any)[k] !== '').length : 0;
            const seedScoreInput: LeadScoringInput = {
                tcpaConsentAt: now,
                geo: { country: seedGeo.country, state: seedGeo.state, zip: seedGeo.zip },
                hasEncryptedData: false,
                encryptedDataValid: false,
                parameterCount: paramCount,
                source: 'PLATFORM',
                zipMatchesState: false,
            };
            const qualityScore = computeCREQualityScore(seedScoreInput);

            // Determine seller: use session seller if provided, else rotate faucet wallets
            const leadSellerId = sessionSellerId || await (async () => {
                const faucetWallet = FAUCET_WALLETS[i % FAUCET_WALLETS.length];
                let faucetSeller = await prisma.sellerProfile.findFirst({ where: { user: { walletAddress: faucetWallet } } });
                if (!faucetSeller) {
                    let faucetUser = await prisma.user.findFirst({ where: { walletAddress: faucetWallet } });
                    if (!faucetUser) {
                        faucetUser = await prisma.user.create({
                            data: {
                                walletAddress: faucetWallet,
                                role: 'SELLER',
                                sellerProfile: { create: { companyName: `Demo Seller ${i + 1}`, verticals: VERTICALS, isVerified: true, kycStatus: 'VERIFIED' } },
                            },
                            include: { sellerProfile: true },
                        });
                    } else {
                        await prisma.sellerProfile.create({
                            data: { userId: faucetUser.id, companyName: `Demo Seller ${i + 1}`, verticals: VERTICALS, isVerified: true, kycStatus: 'VERIFIED' },
                        });
                    }
                    faucetSeller = await prisma.sellerProfile.findFirst({ where: { user: { walletAddress: faucetWallet } } });
                }
                return faucetSeller!.id;
            })();

            const lead = await prisma.lead.create({
                data: {
                    sellerId: leadSellerId,
                    vertical,
                    geo: seedGeo as any,
                    source: 'DEMO',
                    status: status as any,
                    reservePrice: price,
                    buyNowPrice: status === 'UNSOLD' ? Math.round(price * 1.2) : undefined,
                    expiresAt: status === 'UNSOLD' ? new Date(now.getTime() + 7 * 86400000) : undefined,
                    winningBid: status === 'SOLD' ? price * 1.2 : undefined,
                    isVerified: true,
                    qualityScore,
                    tcpaConsentAt: now,
                    auctionStartAt,
                    auctionEndAt,
                    soldAt: status === 'SOLD' ? new Date(now.getTime() - rand(1, 5) * 60_000) : undefined,
                    parameters: params as any,
                },
            });

            // Create AuctionRoom for IN_AUCTION leads so the closure service can track phase
            if (status === 'IN_AUCTION' && auctionEndAt) {
                await prisma.auctionRoom.create({
                    data: {
                        leadId: lead.id,
                        roomId: `auction_${lead.id}`,
                        phase: 'BIDDING',
                        biddingEndsAt: auctionEndAt,
                        revealEndsAt: auctionEndAt,
                    },
                });
            }

            leadIds.push(lead.id);
            creService.afterLeadCreated(lead.id);
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
            const numBidders = (await getDemoBuyersEnabled()) ? 1 : 0;
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
            auctionLeads: auctionLeads.length,
            buyNowLeads: leadCount - auctionLeads.length - (await prisma.lead.count({ where: { id: { in: leadIds }, status: 'SOLD' } })),
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
router.post('/clear', authMiddleware, publicDemoBypass, async (req: Request, res: Response) => {
    try {
        // TD-09 fix: only delete demo-tagged records, not ALL data
        const deletedBids = await prisma.bid.deleteMany({ where: { lead: { source: 'DEMO' } } });
        await prisma.auctionRoom.deleteMany({ where: { lead: { source: 'DEMO' } } });
        await prisma.transaction.deleteMany({ where: { lead: { source: 'DEMO' } } });
        const deletedLeads = await prisma.lead.deleteMany({ where: { source: 'DEMO' } });
        const deletedAsks = await prisma.ask.deleteMany({ where: { parameters: { path: ['_demoTag'], equals: DEMO_TAG } } });

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
router.post('/lead', authMiddleware, publicDemoBypass, async (req: Request, res: Response) => {
    try {
        const vertical = req.body?.vertical || pick(DEMO_VERTICALS);
        const geo = req.body?.geo || pick(GEOS);
        const pr = priceFor(vertical);
        const price = req.body?.reservePrice ?? rand(pr.min, pr.max);

        // Accept optional sellerWallet to attribute to session seller, else rotate faucet wallets
        const sellerWalletAddr = req.body?.sellerWallet || pickFaucetWallet();
        let seller = await prisma.sellerProfile.findFirst({
            where: { user: { walletAddress: sellerWalletAddr } },
        });

        if (!seller) {
            // Auto-create seller from faucet wallet
            let sellerUser = await prisma.user.findFirst({ where: { walletAddress: sellerWalletAddr } });
            if (!sellerUser) {
                sellerUser = await prisma.user.create({
                    data: {
                        walletAddress: sellerWalletAddr,
                        role: 'SELLER',
                        sellerProfile: { create: { companyName: 'Demo Seller Co.', verticals: FALLBACK_VERTICALS, isVerified: true, kycStatus: 'VERIFIED' } },
                    },
                    include: { sellerProfile: true },
                });
            } else {
                await prisma.sellerProfile.create({
                    data: { userId: sellerUser.id, companyName: 'Demo Seller Co.', verticals: FALLBACK_VERTICALS, isVerified: true, kycStatus: 'VERIFIED' },
                });
            }
            seller = await prisma.sellerProfile.findFirst({ where: { user: { walletAddress: sellerWalletAddr } } });
            if (!seller) {
                res.status(500).json({ error: 'Failed to auto-create demo seller profile' });
                return;
            }
            // Also seed verticals so hierarchy API works
            await seedVerticals();
        }

        // Build non-PII form parameters from vertical schema (randomized)
        const params = buildVerticalDemoParams(vertical);

        // Compute quality score for demo lead using same algorithm as CREVerifier
        const demoParamCount = params ? Object.keys(params).filter((k: string) => (params as any)[k] != null && (params as any)[k] !== '').length : 0;
        const demoGeo = { country: geo.country, state: geo.state, city: geo.city, zip: `${rand(10000, 99999)}` };
        const demoScoreInput: LeadScoringInput = {
            tcpaConsentAt: new Date(),
            geo: { country: demoGeo.country, state: demoGeo.state, zip: demoGeo.zip },
            hasEncryptedData: false,
            encryptedDataValid: false,
            parameterCount: demoParamCount,
            source: 'PLATFORM',
            zipMatchesState: false,
        };
        const demoScore = computeCREQualityScore(demoScoreInput);

        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical,
                geo: demoGeo as any,
                source: 'DEMO',
                status: 'IN_AUCTION',
                reservePrice: price,
                isVerified: true,
                qualityScore: demoScore,
                tcpaConsentAt: new Date(),
                auctionStartAt: new Date(),
                auctionEndAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
                parameters: params as any,
            },
        });

        // Create auction room so the auction monitor can resolve this lead
        creService.afterLeadCreated(lead.id);
        await prisma.auctionRoom.create({
            data: {
                leadId: lead.id,
                roomId: `auction_${lead.id}`,
                phase: 'BIDDING',
                biddingEndsAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
                revealEndsAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
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
                    qualityScore: demoScore != null ? Math.floor(demoScore / 100) : null, // normalize 0-10000 → 0-100
                    _count: { bids: 0 },
                },
            });
            // Also emit refreshAll so the marketplace refetches even if lead:new handler misses
            io.emit('marketplace:refreshAll');
        }

        // CRE-Native mode: evaluate lead against buyer rules via 7-gate workflow
        let creEvaluation: any = null;
        const creMode = await getCreNativeModeEnabled();
        if (creMode) {
            try {
                const creResult = await creService.triggerBuyerRulesWorkflow(lead.id);
                creEvaluation = {
                    workflowEnabled: true,
                    matchedSets: creResult.matchedSets,
                    totalPreferenceSets: creResult.totalPreferenceSets,
                    results: creResult.results,
                };
                const io2 = req.app.get('io');
                if (io2) {
                    io2.emit('demo:cre-evaluation', {
                        leadId: lead.id,
                        vertical,
                        matchedSets: creResult.matchedSets,
                        totalPreferenceSets: creResult.totalPreferenceSets,
                        results: creResult.results,
                        timestamp: new Date().toISOString(),
                    });
                }
                console.log(`[CRE-NATIVE] Lead ${lead.id.slice(0, 8)}… evaluated: ${creResult.matchedSets}/${creResult.totalPreferenceSets} matched`);
            } catch (creErr: any) {
                console.warn(`[CRE-NATIVE] Evaluation failed for ${lead.id.slice(0, 8)}…: ${creErr.message?.slice(0, 80)}`);
            }
        }

        res.json({
            success: true,
            lead: { id: lead.id, vertical, geo: { country: geo.country, state: geo.state }, price, parameters: params },
            creEvaluation,
        });
    } catch (error) {
        console.error('Demo inject lead error:', error);
        res.status(500).json({ error: 'Failed to inject lead' });
    }
});

// ============================================
// POST /leads/:leadId/decrypt-pii — Winner-only PII decryption
// ============================================
router.post('/leads/:leadId/decrypt-pii', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { leadId } = req.params;
        const authReq = req as any;
        const userId = authReq.user?.id;

        // Verify the lead exists
        const lead = await prisma.lead.findUnique({ where: { id: leadId } });
        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }

        // Ownership check: the caller must be the auction winner.
        // 1. Check for a settled Transaction (production path / CRE-Native mode)
        // 2. Fall back to checking for an ACCEPTED Bid record (demo path)
        const settledTx = await prisma.transaction.findFirst({
            where: { leadId, escrowReleased: true },
            orderBy: { createdAt: 'desc' },
        });

        if (!settledTx) {
            // Demo path: check if the caller has an ACCEPTED bid on this lead
            // First try direct userId match
            let acceptedBid = userId
                ? await prisma.bid.findFirst({
                    where: { leadId, buyerId: userId, status: 'ACCEPTED' },
                })
                : null;

            // Fallback: check by wallet address (handles duplicate User records for same wallet)
            if (!acceptedBid) {
                const authReqWallet = authReq.user?.walletAddress?.toLowerCase();
                if (authReqWallet) {
                    acceptedBid = await prisma.bid.findFirst({
                        where: {
                            leadId,
                            status: 'ACCEPTED',
                            buyer: { walletAddress: { equals: authReqWallet, mode: 'insensitive' } },
                        },
                    });
                }
            }

            if (!acceptedBid) {
                res.status(403).json({ error: 'Only the auction winner can decrypt PII after settlement' });
                return;
            }
        }

        // Generate demo PII based on lead vertical/geo (deterministic from leadId)
        const verticals: Record<string, { firstNames: string[]; lastNames: string[] }> = {
            'solar': { firstNames: ['Marcus', 'Elena', 'David'], lastNames: ['Chen', 'Rodriguez', 'Kim'] },
            'roofing': { firstNames: ['Sarah', 'James', 'Lisa'], lastNames: ['Johnson', 'Williams', 'Brown'] },
            'insurance': { firstNames: ['Michael', 'Jennifer', 'Robert'], lastNames: ['Davis', 'Miller', 'Wilson'] },
            'mortgage': { firstNames: ['Emily', 'Daniel', 'Rachel'], lastNames: ['Taylor', 'Anderson', 'Thomas'] },
        };
        const v = (lead.vertical || 'solar').toLowerCase();
        const pool = verticals[v] || verticals['solar'];
        const hash = leadId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        const firstName = pool.firstNames[hash % pool.firstNames.length];
        const lastName = pool.lastNames[(hash + 1) % pool.lastNames.length];

        const pii = {
            firstName,
            lastName,
            email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
            phone: `(555) ${String(100 + (hash % 900)).padStart(3, '0')}-${String(1000 + (hash % 9000)).padStart(4, '0')}`,
            address: `${100 + (hash % 900)} ${['Oak', 'Maple', 'Cedar', 'Pine'][hash % 4]} Street`,
            city: (lead as any).parameters?.geo?.state === 'CA' ? 'Los Angeles' : 'Austin',
            state: (lead as any).parameters?.geo?.state || 'TX',
            zip: String(10000 + (hash % 90000)),
        };

        // Emit to On-Chain Log
        const io = req.app.get('io');
        if (io) {
            io.emit('demo:log', {
                ts: new Date().toISOString(),
                level: 'success',
                message: `🔓 PII decrypted for lead ${leadId.slice(0, 8)}… via CRE DON (winner-only, encryptOutput: true)`,
            });
        }

        res.json({
            success: true,
            pii,
            attestation: {
                source: 'CRE DON (DecryptForWinner)',
                encryptOutput: true,
                workflow: 'decrypt-for-winner-staging',
                timestamp: new Date().toISOString(),
                leadId,
                verifiedWinner: true,
            },
        });
    } catch (error: any) {
        console.error('Decrypt PII error:', error);
        res.status(500).json({ error: 'Failed to decrypt PII' });
    }
});

// ============================================
// POST /auction — simulate live auction (create lead + bids over time)
// ============================================
router.post('/auction', authMiddleware, publicDemoBypass, async (req: Request, res: Response) => {
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
            ? demoBuyerUsers.map((u: { id: string }) => u.id)
            : demoUser ? [demoUser.id] : [];

        if (!seller || !demoUser) {
            res.status(400).json({ error: 'Demo data not seeded. Seed marketplace first.' });
            return;
        }

        // Create lead in auction
        // Compute quality score for demo auction lead
        const auctionGeo = { country: geo.country, state: geo.state, city: geo.city, zip: `${rand(10000, 99999)}` };
        const auctionScoreInput: LeadScoringInput = {
            tcpaConsentAt: new Date(),
            geo: { country: auctionGeo.country, state: auctionGeo.state, zip: auctionGeo.zip },
            hasEncryptedData: false,
            encryptedDataValid: false,
            parameterCount: 0,
            source: 'PLATFORM',
            zipMatchesState: false,
        };
        const auctionScore = computeCREQualityScore(auctionScoreInput);

        const lead = await prisma.lead.create({
            data: {
                sellerId: seller.id,
                vertical,
                geo: auctionGeo as any,
                source: 'DEMO',
                status: 'IN_AUCTION',
                reservePrice,
                isVerified: true,
                qualityScore: auctionScore,
                tcpaConsentAt: new Date(),
                auctionStartAt: new Date(),
                auctionEndAt: new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000),
            },
        });

        // Create auction room
        creService.afterLeadCreated(lead.id);
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
                    qualityScore: auctionScore != null ? Math.floor(auctionScore / 100) : null, // normalize 0-10000 → 0-100
                    _count: { bids: 0 },
                },
            });
            // Also emit refreshAll so the marketplace refetches even if lead:new handler misses
            io.emit('marketplace:refreshAll');
        }

        // Simulate bids arriving over auction window (conservative — user should outbid)
        // Only if demo buyers are enabled
        const bidIntervals = (await getDemoBuyersEnabled()) ? [5000, 15000, 30000] : []; // 3 bids at 5s, 15s, 30s
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
            demoBuyersEnabled: bidIntervals.length > 0,
        });
    } catch (error) {
        console.error('Demo auction error:', error);
        res.status(500).json({ error: 'Failed to start demo auction' });
    }
});

// ============================================
// POST /reset — clear ALL non-sold leads + demo-sold leads
// Comprehensive reset: catches lander-submitted leads that lack DEMO_TAG
// ============================================
router.post('/reset', authMiddleware, publicDemoBypass, async (req: Request, res: Response) => {
    try {
        // 1. Delete ALL non-sold leads (IN_AUCTION, UNSOLD, PENDING_AUCTION, EXPIRED, CANCELLED)
        //    This catches lander-submitted leads that don't have source: DEMO
        const nonSoldStatuses = ['IN_AUCTION', 'UNSOLD', 'PENDING_AUCTION', 'EXPIRED', 'CANCELLED', 'DISPUTED'] as any;

        // Delete related records for non-sold leads (FK order: bids → auctionRoom → transactions → leads)
        await prisma.bid.deleteMany({ where: { lead: { status: { in: nonSoldStatuses } } } });
        await prisma.auctionRoom.deleteMany({ where: { lead: { status: { in: nonSoldStatuses } } } });
        await prisma.transaction.deleteMany({ where: { lead: { status: { in: nonSoldStatuses } } } });
        const clearedNonSold = await prisma.lead.deleteMany({ where: { status: { in: nonSoldStatuses } } });

        // 2. Also clear demo-tagged SOLD leads (fake demo sales, not real purchases)
        await prisma.bid.deleteMany({ where: { lead: { source: 'DEMO', status: 'SOLD' } } });
        await prisma.auctionRoom.deleteMany({ where: { lead: { source: 'DEMO', status: 'SOLD' } } });
        await prisma.transaction.deleteMany({ where: { lead: { source: 'DEMO', status: 'SOLD' } } });
        const clearedDemoSold = await prisma.lead.deleteMany({ where: { source: 'DEMO', status: 'SOLD' } });

        // 3. Clear all demo-tagged asks
        await prisma.ask.deleteMany({ where: { parameters: { path: ['_demoTag'], equals: DEMO_TAG } } });

        // Flush all in-memory LRU caches
        clearAllCaches();

        // Keep verticals seeded so hierarchy API stays functional
        await seedVerticals();

        // Notify clients to refresh
        const io = req.app.get('io');
        if (io) io.emit('marketplace:refreshAll');

        const totalCleared = clearedNonSold.count + clearedDemoSold.count;
        console.log(`[DEMO RESET] Cleared ${totalCleared} leads (${clearedNonSold.count} non-sold + ${clearedDemoSold.count} demo-sold)`);

        res.json({
            success: true,
            cleared: totalCleared,
            breakdown: {
                nonSoldLeads: clearedNonSold.count,
                demoSoldLeads: clearedDemoSold.count,
            },
            message: `Cleared ${totalCleared} leads. Real SOLD leads preserved. Dashboards are now clean.`,
        });
    } catch (error) {
        console.error('Demo reset error:', error);
        res.status(500).json({ error: 'Failed to reset demo state', details: String(error) });
    }
});

// ============================================
// POST /wipe — FULL marketplace data wipe (nuclear option)
// Deletes ALL leads, bids, transactions, auction rooms, asks regardless of tag
// ============================================
router.post('/wipe', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { confirm } = req.body as { confirm?: boolean };
        if (!confirm) {
            res.status(400).json({ error: 'Must send { confirm: true } to wipe all data' });
            return;
        }

        // Delete in FK dependency order
        const deletedBids = await prisma.bid.deleteMany({});
        const deletedAuctionRooms = await prisma.auctionRoom.deleteMany({});
        const deletedTransactions = await prisma.transaction.deleteMany({});
        const deletedLeads = await prisma.lead.deleteMany({});
        const deletedAsks = await prisma.ask.deleteMany({});

        // Flush caches
        clearAllCaches();

        // Re-seed verticals so the platform stays functional
        await seedVerticals();

        // Notify clients
        const io = req.app.get('io');
        if (io) io.emit('marketplace:refreshAll');

        console.log(`[DEMO WIPE] Full marketplace wipe: ${deletedLeads.count} leads, ${deletedBids.count} bids, ${deletedTransactions.count} txns, ${deletedAsks.count} asks`);

        res.json({
            success: true,
            deleted: {
                leads: deletedLeads.count,
                bids: deletedBids.count,
                transactions: deletedTransactions.count,
                auctionRooms: deletedAuctionRooms.count,
                asks: deletedAsks.count,
            },
            message: 'All marketplace data wiped. Platform is clean.',
        });
    } catch (error) {
        console.error('Demo wipe error:', error);
        res.status(500).json({ error: 'Failed to wipe data', details: String(error) });
    }
});

// ============================================
// POST /seed-templates — Reset + seed all formConfig templates
// ============================================
router.post('/seed-templates', authMiddleware, publicDemoBypass, async (req: Request, res: Response) => {
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
// Settle (Escrow Release) — on-chain settlement
// ============================================

router.post('/settle', authMiddleware, publicDemoBypass, async (req: Request, res: Response) => {
    try {
        const { leadId } = req.body as { leadId?: string };
        const { escrowService } = await import('../services/escrow.service');

        console.log(`[DEMO SETTLE] Request received — leadId=${leadId || '(auto-detect)'}`);

        // ── Guard: on-chain infra must be configured ──
        if (!process.env.DEPLOYER_PRIVATE_KEY) {
            res.status(503).json({
                error: 'Server signer not configured',
                hint: 'Set DEPLOYER_PRIVATE_KEY env var on Render',
            });
            return;
        }
        if (!process.env.RTB_ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA && !process.env.ESCROW_CONTRACT_ADDRESS) {

            res.status(503).json({
                error: 'Escrow contract address not configured',
                hint: 'Set RTB_ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA (or ESCROW_CONTRACT_ADDRESS) env var on Render',

            });
            return;
        }

        // 1. Find the most recent unsettled transaction — prioritize those WITH escrowId (ready for release)
        const txInclude = {
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
        };
        const txWhere = {
            ...(leadId ? { leadId } : {}),
            escrowReleased: false,
        };

        // First: find a transaction WITH escrowId (ready for immediate release)
        let transaction = await prisma.transaction.findFirst({
            where: { ...txWhere, escrowId: { not: null } },
            orderBy: { createdAt: 'desc' },
            include: txInclude,
        });

        // Fallback: find any unsettled transaction (will need escrow creation/recovery)
        if (!transaction) {
            transaction = await prisma.transaction.findFirst({
                where: txWhere,
                orderBy: { createdAt: 'desc' },
                include: txInclude,
            });
        }

        if (!transaction) {
            // ── Auto-create Transaction from winning bid ──
            // Demo/manual bids may resolve the auction without creating a Transaction record.
            // Also handles leads incorrectly marked UNSOLD due to USDC check bug (bids marked OUTBID).
            console.warn(`[DEMO SETTLE] No unsettled transaction found — attempting to create from bid data`);

            const candidateLead = await prisma.lead.findFirst({
                where: {
                    ...(leadId ? { id: leadId } : {}),
                    status: { in: ['SOLD', 'UNSOLD'] },
                },
                include: {
                    bids: {
                        where: { status: { in: ['ACCEPTED', 'OUTBID', 'REVEALED', 'EXPIRED'] }, amount: { not: null } },
                        orderBy: { amount: 'desc' },
                        take: 1,
                        include: { buyer: { select: { id: true, walletAddress: true } } },
                    },
                    seller: {
                        select: { user: { select: { walletAddress: true } } },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });

            if (!candidateLead || candidateLead.bids.length === 0) {
                console.warn(`[DEMO SETTLE] No settleable lead with valid bid found (leadId=${leadId || 'any'})`);
                res.status(404).json({
                    error: 'No unsettled transaction found',
                    hint: leadId
                        ? `No pending transaction for lead ${leadId}. Is the auction resolved?`
                        : 'Run an auction first, then settle it',
                });
                return;
            }

            const topBid = candidateLead.bids[0];
            const bidAmount = Number(topBid.amount ?? 0);

            // Fix incorrect statuses from USDC check bug
            if (candidateLead.status === 'UNSOLD') {
                await prisma.lead.update({
                    where: { id: candidateLead.id },
                    data: { status: 'SOLD', winningBid: topBid.amount, soldAt: new Date() },
                });
                console.log(`[DEMO SETTLE] Corrected lead ${candidateLead.id} UNSOLD → SOLD`);
            }
            if (topBid.status !== 'ACCEPTED') {
                await prisma.bid.update({
                    where: { id: topBid.id },
                    data: { status: 'ACCEPTED', processedAt: new Date() },
                });
                console.log(`[DEMO SETTLE] Corrected bid ${topBid.id} ${topBid.status} → ACCEPTED`);
            }

            const topBidFees = calculateFees(bidAmount, ((topBid as any).source || 'MANUAL') as BidSourceType);

            // Create the missing Transaction record
            transaction = await prisma.transaction.create({
                data: {
                    leadId: candidateLead.id,
                    buyerId: topBid.buyerId,
                    amount: topBid.amount!,
                    platformFee: topBidFees.platformFee,
                    convenienceFee: topBidFees.convenienceFee || undefined,
                    convenienceFeeType: topBidFees.convenienceFeeType,
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
            console.log(`[DEMO SETTLE] Auto-created Transaction ${transaction.id} for lead ${candidateLead.id} ($${bidAmount})`);
        }

        const buyerWallet = transaction.buyer?.walletAddress;
        const sellerWallet = (transaction.lead as any)?.seller?.user?.walletAddress;
        const amount = Number(transaction.amount);
        const _tokenId = parseInt(transaction.lead?.nftTokenId || '0', 10);

        console.log(`[DEMO SETTLE] Found tx=${transaction.id} | lead=${transaction.leadId} | $${amount} | escrowId=${transaction.escrowId || '(none)'} | buyer=${buyerWallet?.slice(0, 10)} | seller=${sellerWallet?.slice(0, 10)}`);

        if (!buyerWallet || !sellerWallet) {
            res.status(400).json({
                error: 'Missing wallet addresses',
                hint: `buyer=${buyerWallet || 'MISSING'}, seller=${sellerWallet || 'MISSING'}. Both must be connected.`,
            });
            return;
        }

        // 2. If no escrow yet (recovery path — escrow should have been created at auction resolution)
        if (!transaction.escrowId) {
            console.warn(`[DEMO SETTLE] No escrowId on tx=${transaction.id} — retrying createPayment (recovery path)`);
            const createResult = await escrowService.createPayment(
                sellerWallet,
                buyerWallet,
                amount,
                transaction.leadId,
                transaction.id,
            );

            if (!createResult.success) {
                console.error(`[DEMO SETTLE] createPayment failed: ${createResult.error}`);
                res.status(500).json({
                    error: 'Failed to create on-chain escrow',
                    details: createResult.error,
                    hint: 'Ensure DEPLOYER_PRIVATE_KEY has Base Sepolia ETH for gas and RTB_ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA is deployed.',

                });
                return;
            }
            console.log(`[DEMO SETTLE] Recovery: escrow created+funded — escrowId=${createResult.escrowId}, txHash=${createResult.txHash}`);
        } else {
            console.log(`[DEMO SETTLE] Escrow already exists — escrowId=${transaction.escrowId}, proceeding to release`);
        }

        // 3. Release the escrow on-chain
        console.log(`[DEMO SETTLE] Releasing escrow via escrowService.settlePayment`);
        const settleResult = await escrowService.settlePayment(transaction.id);

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

        // 5. Mark transaction as settled so PII unlocks for buyer
        await prisma.transaction.update({
            where: { id: transaction.id },
            data: { escrowReleased: true, status: 'RELEASED' },
        });
        console.log(`[DEMO SETTLE] Transaction ${transaction.id} → escrowReleased=true, status=COMPLETED`);

        // 6. Mint LeadNFT on-chain + record sale to buyer
        let nftTokenId: string | null = null;
        let nftMintTxHash: string | null = null;
        try {
            const mintResult = await nftService.mintLeadNFT(transaction.leadId);
            if (mintResult.success) {
                nftTokenId = mintResult.tokenId || null;
                nftMintTxHash = mintResult.txHash || null;
                console.log(`[DEMO SETTLE] LeadNFT minted — tokenId=${nftTokenId}, txHash=${nftMintTxHash?.slice(0, 14)}…`);

                // Persist nftMintTxHash in the lead record
                if (nftMintTxHash) {
                    await prisma.lead.update({
                        where: { id: transaction.leadId },
                        data: { nftMintTxHash },
                    });
                }

                // Record the sale on-chain (transfers NFT ownership to buyer)
                if (nftTokenId && buyerWallet) {
                    const saleResult = await nftService.recordSaleOnChain(nftTokenId, buyerWallet, amount);
                    if (saleResult.success) {
                        console.log(`[DEMO SETTLE] NFT sale recorded on-chain — buyer=${buyerWallet.slice(0, 10)}`);
                    } else {
                        console.warn(`[DEMO SETTLE] NFT recordSale failed (non-fatal): ${saleResult.error}`);
                    }
                }
            } else {
                // BUG-08: Persist failure flag + schedule retry instead of silent warn.
                // Settlement has already succeeded — NFT mint is non-blocking.
                console.warn(`[DEMO SETTLE] LeadNFT mint failed (non-fatal): ${mintResult.error}`);
                await nftService.scheduleMintRetry(transaction.leadId, mintResult.error || 'unknown mint error');
            }
        } catch (nftErr: any) {
            console.warn(`[DEMO SETTLE] NFT minting error (non-fatal):`, nftErr.message);
        }


        console.log(`[DEMO SETTLE] ✅ Complete — txHash=${settleResult.txHash}`);

        // Emit socket events so the main lead page auto-refreshes
        const io = req.app.get('io');
        if (io) {
            io.emit('marketplace:refreshAll', { reason: 'settlement' });
            io.emit('lead:status-changed', {
                leadId: transaction.leadId,
                oldStatus: 'SOLD',
                newStatus: 'SOLD',
                escrowReleased: true,
            });
        }

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
            nftTokenId,
            nftMintTxHash,
            message: `✅ On-chain settlement complete — escrow released, USDC transferred, lead SOLD, NFT minted. txHash=${settleResult.txHash?.slice(0, 14)}…`,
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

// ============================================
// POST /full-e2e — One-Click Full On-Chain Demo
// ============================================

import * as demoE2E from '../services/demo-e2e.service';

// Hydrate in-memory results cache from DB on startup (non-blocking, never throws)
void demoE2E.initResultsStore().catch((e: Error) =>
    console.warn('[demo-panel] initResultsStore startup failed (non-fatal):', e.message)
);

// ─── BigInt-safe response helper ────────────────────────────────────────────
// Belt-and-suspenders: even with the global middleware in index.ts, these
// endpoints defensively sanitise BigInt before handing to res.json.
function safeSend(res: Response, body: any, status = 200): void {
    const safe = JSON.parse(
        JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );
    res.status(status).json(safe);
}
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// publicDemoBypass
//
// Reusable middleware for demo-panel endpoints accessible from the public
// marketplace page and Demo Control Panel (Buyer/Seller personas included).
// Allows passage if the caller is an ADMIN OR presents TEST_API_TOKEN via
// `X-Api-Token` header.
//
// Applied to (non-destructive):
//   GET  /demo-buyers-toggle  — status poll
//   POST /demo-buyers-toggle  — toggle bot buyers on/off
//   POST /seed                — seed marketplace data
//   POST /clear               — clear demo data (preserves real transactions)
//   POST /reset               — reset to clean demo state
//   POST /seed-templates      — sync form templates
//   POST /settle              — trigger on-chain settlement
//   POST /lead                — inject a single lead
//   POST /auction             — start a live auction
//   POST /full-e2e            — run full on-chain demo
//   POST /full-e2e/stop       — stop running demo
//
// Strict requireAdmin (truly destructive — never from public demo):
//   POST /wipe          — nukes ALL data including real transactions
//   POST /fund-eth      — sends real ETH from deployer
//   POST /full-e2e/reset — full environment reset
// ─────────────────────────────────────────────────────────────────────────────
function publicDemoBypass(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    // Path 1: caller has a valid ADMIN JWT (set by authMiddleware)
    const user = (req as any).user;
    if (user?.role === 'ADMIN') {
        next();
        return;
    }

    // Path 2: caller presents the shared TEST_API_TOKEN secret
    const token = process.env.TEST_API_TOKEN;
    const provided = req.headers['x-api-token'] as string | undefined;
    if (token && provided && provided === token) {
        next();
        return;
    }

    // Neither — reject
    res.status(403).json({
        error: 'Forbidden: ADMIN role or valid X-Api-Token required',
        code: 'DEMO_AUTH_REQUIRED',
    });
}

router.post('/full-e2e', authMiddleware, publicDemoBypass, async (req: Request, res: Response) => {
    try {
        if (demoE2E.isDemoRunning()) {
            res.status(409).json({ error: 'A demo is already running', running: true, recycling: false });
            return;
        }
        if (demoE2E.isDemoRecycling()) {
            res.status(409).json({
                error: 'Token redistribution from the previous run is in progress — please wait ~30s',
                running: false,
                recycling: true,
            });
            return;
        }

        const cycles = Math.max(1, Math.min(req.body?.cycles || 5, 12));
        const io = req.app.get('io');

        if (!io) {
            res.status(500).json({ error: 'Socket.IO not initialized' });
            return;
        }

        // Auto-enable CRE-Native mode for 1-click full demo
        await setConfig('creNativeDemoMode', 'true');
        io.emit('demo:log', {
            ts: new Date().toISOString(),
            level: 'step',
            message: '⛓️ CRE-Native mode auto-enabled — 7-gate DON evaluation will run on every lead',
        });

        // Start the demo asynchronously — results stream via Socket.IO
        const resultPromise = demoE2E.runFullDemo(io, cycles, true);

        // Return immediately with runId
        res.json({
            success: true,
            message: `Demo started with ${cycles} cycles`,
            running: true,
        });

        // Let it run in background — results stored in memory
        resultPromise.catch((err) => {
            console.error('[DEMO E2E] Unhandled error:', err);
        });
    } catch (error: any) {
        console.error('[DEMO E2E] Start error:', error);
        res.status(500).json({ error: 'Failed to start demo', details: error.message });
    }
});

// ============================================
// POST /full-e2e/stop — Abort running demo
// ============================================

router.post('/full-e2e/stop', authMiddleware, publicDemoBypass, async (_req: Request, res: Response) => {
    const wasRunning = demoE2E.isDemoRunning();
    const wasRecycling = demoE2E.isDemoRecycling();
    const stopped = demoE2E.stopDemo();
    res.json({
        success: stopped,
        message: stopped
            ? (wasRunning ? 'Demo cycles aborted' : 'Token recovery aborted')
            : 'Nothing was running',
        wasRunning,
        wasRecycling,
    });
});

// ============================================
// GET /full-e2e/results/latest — Get latest demo results
// ============================================

router.get('/full-e2e/results/latest', async (_req: Request, res: Response) => {
    // While demo is actively running, signal that results aren't ready yet
    if (demoE2E.isDemoRunning()) {
        res.json({ status: 'running', message: 'Demo is still in progress' });
        return;
    }

    // While recycle is in flight, return 202 so frontend can show a friendly message
    if (demoE2E.isDemoRecycling()) {
        res.status(202).json({
            status: 'finalizing',
            recycling: true,
            message: 'Demo complete — finalizing background tasks, results loading in <5s…',
        });
        return;
    }

    // Async-aware: queries DB on cache miss (cold boot recovery)
    const result = await demoE2E.getLatestResult();
    if (!result) {
        res.status(404).json({ error: 'No demo results available yet', resultsReady: false });
        return;
    }
    safeSend(res, { ...result, resultsReady: true });
});

// ============================================
// GET /full-e2e/results/:runId — Get demo results
// ============================================

router.get('/full-e2e/results/:runId', async (req: Request, res: Response) => {
    const { runId } = req.params;
    const result = demoE2E.getResults(runId);

    if (!result) {
        // Check if demo is still running
        if (demoE2E.isDemoRunning()) {
            res.json({ status: 'running', message: 'Demo is still in progress' });
            return;
        }
        res.status(404).json({ error: 'Results not found', runId });
        return;
    }

    safeSend(res, result);
});

// ============================================
// GET /full-e2e/status — Check if demo is running
// ============================================

router.get('/full-e2e/status', async (_req: Request, res: Response) => {
    const allResults = demoE2E.getAllResults();
    const resultsReady = allResults.length > 0;
    safeSend(res, {
        running: demoE2E.isDemoRunning(),
        recycling: demoE2E.isDemoRecycling(),
        resultsReady,
        results: allResults.map(r => ({
            runId: r.runId,
            status: r.status,
            startedAt: r.startedAt,
            completedAt: r.completedAt,
            totalCycles: r.cycles.length,
            totalSettled: r.totalSettled,
        })),
    });
});


// ============================================
// POST /full-e2e/reset — One-click Full Reset & Recycle (judge-facing)
// ============================================
// Stops any running demo, cleans up stranded locked funds, forces USDC recycle,
// prunes stale DEMO leads, and emits demo:reset-complete for the frontend.

router.post('/full-e2e/reset', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    const io = req.app.get('io');

    // 1. Abort any running demo or recycle
    const wasRunning = demoE2E.isDemoRunning() || demoE2E.isDemoRecycling();
    if (wasRunning) demoE2E.stopDemo();

    // Respond immediately — the heavy work runs in the background
    res.json({
        success: true,
        message: 'Full reset initiated — watch the Dev Log for real-time progress.',
        wasRunning,
    });

    // 2. Background reset sequence (never throw to caller)
    setImmediate(async () => {
        try {
            if (io) {
                io.emit('demo:log', {
                    ts: new Date().toISOString(),
                    level: 'step',
                    message: '🔄 Full Reset & Recycle initiated — cleaning up locked funds + recycling USDC...',
                });
            }

            // 3. Clean up any stranded locked funds
            if (io) {
                await demoE2E.cleanupLockedFundsForDemoBuyers(io);
            }

            // 4. Prune DEMO leads older than 1 hour
            try {
                const cutoff = new Date(Date.now() - 3_600_000);
                const deleted = await prisma.lead.deleteMany({
                    where: { source: 'DEMO', createdAt: { lt: cutoff } },
                });
                if (io && deleted.count > 0) {
                    io.emit('demo:log', {
                        ts: new Date().toISOString(),
                        level: 'info',
                        message: `🗑️ Pruned ${deleted.count} stale DEMO leads (older than 1 hour)`,
                    });
                }
            } catch (pruneErr: any) {
                console.warn('[DEMO /reset] Lead prune failed (non-fatal):', pruneErr.message?.slice(0, 80));
            }

            // 5. Emit reset-complete
            if (io) {
                io.emit('demo:reset-complete', {
                    ts: new Date().toISOString(),
                    success: true,
                    message: '✅ Demo environment fully reset — ready for next run!',
                });
                io.emit('demo:log', {
                    ts: new Date().toISOString(),
                    level: 'success',
                    message: '✅ Full Reset & Recycle complete — demo environment is clean. Click Full E2E to start a fresh run.',
                });
                io.emit('demo:status', {
                    running: false,
                    recycling: false,
                    phase: 'idle',
                    ts: new Date().toISOString(),
                });
            }
        } catch (err: any) {
            console.error('[DEMO /reset] Error:', err.message);
            if (io) {
                io.emit('demo:log', {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ Reset encountered an error: ${err.message?.slice(0, 100)}`,
                });
                io.emit('demo:reset-complete', { ts: new Date().toISOString(), success: false, error: err.message });
            }
        }
    });
});

// ============================================
// POST /fund-eth — Pre-fund all 11 demo wallets with 0.015 ETH each
// Fund-once model: run before first demo, or any time wallets run dry.
// ============================================
router.post('/fund-eth', authMiddleware, requireAdmin, async (_req: Request, res: Response) => {
    const { ethers } = await import('ethers');

    const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';
    const RAW_PK = process.env.DEPLOYER_PRIVATE_KEY || '';
    const DEPLOYER_PK = RAW_PK.startsWith('0x') ? RAW_PK : '0x' + RAW_PK;
    const FUND_ETH = ethers.parseEther('0.015');

    const RECIPIENTS = [
        { label: 'Wallet 1  (buyer)', addr: '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9' },
        { label: 'Wallet 2  (buyer)', addr: '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC' },
        { label: 'Wallet 3  (buyer)', addr: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58' },
        { label: 'Wallet 4  (buyer)', addr: '0x424CaC929939377f221348af52d4cb1247fE4379' },
        { label: 'Wallet 5  (buyer)', addr: '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d' },
        { label: 'Wallet 6  (buyer)', addr: '0x089B6Bdb4824628c5535acF60aBF80683452e862' },
        { label: 'Wallet 7  (buyer)', addr: '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE' },
        { label: 'Wallet 8  (buyer)', addr: '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C' },
        { label: 'Wallet 9  (buyer)', addr: '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf' },
        { label: 'Wallet 10 (buyer)', addr: '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad' },
        { label: 'Wallet 11 (seller)', addr: '0x9Bb15F98982715E33a2113a35662036528eE0A36' },
    ];

    if (!DEPLOYER_PK || DEPLOYER_PK === '0x') {
        res.status(500).json({ error: 'DEPLOYER_PRIVATE_KEY not configured' });
        return;
    }

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
        const deployerBalBefore = await provider.getBalance(deployer.address);

        const results: Array<{ label: string; addr: string; sent: string; status: string }> = [];
        let totalSent = 0n;

        for (const { label, addr } of RECIPIENTS) {
            const currentBal = await provider.getBalance(addr);
            if (currentBal >= FUND_ETH) {
                results.push({ label, addr, sent: '0', status: 'skipped (already funded)' });
                continue;
            }
            const toSend = FUND_ETH - currentBal;
            try {
                const feeData = await provider.getFeeData();
                const gasPrice = feeData.gasPrice ? (feeData.gasPrice * 120n) / 100n : undefined;
                const tx = await deployer.sendTransaction({ to: addr, value: toSend, ...(gasPrice ? { gasPrice } : {}) });
                await tx.wait();
                totalSent += toSend;
                results.push({ label, addr, sent: ethers.formatEther(toSend), status: 'funded' });
            } catch (err: any) {
                results.push({ label, addr, sent: '0', status: `failed: ${err.message?.slice(0, 60)}` });
            }
        }

        const deployerBalAfter = await provider.getBalance(deployer.address);
        console.log(`[DEMO] /fund-eth: sent ${ethers.formatEther(totalSent)} ETH to ${results.filter(r => r.status === 'funded').length} wallets`);
        res.json({
            totalSent: ethers.formatEther(totalSent),
            deployerBefore: ethers.formatEther(deployerBalBefore),
            deployerAfter: ethers.formatEther(deployerBalAfter),
            results,
        });
    } catch (err: any) {
        console.error('[DEMO] /fund-eth error:', err);
        res.status(500).json({ error: 'Fund ETH failed', details: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/demo/seed-agent
// One-shot: upserts the Kimi AI agent's User, BuyerProfile, EscrowVault, and
// Session. Returns the session token to use as API_KEY in mcp-server/.env.
// Protected by a simple header check (DEPLOYER_PRIVATE_KEY prefix).
// Safe to re-run — all operations are idempotent upserts.
// ─────────────────────────────────────────────────────────────────────────────
const KIMI_AGENT_WALLET_ADDR = '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad'; // Wallet 10 — already funded

router.post('/seed-agent', async (req: Request, res: Response) => {
    // Lightweight admin check — require a header that only the deployer knows
    const expectedKey = (process.env.DEPLOYER_PRIVATE_KEY || '').slice(0, 16);
    const provided = req.headers['x-demo-admin-key'] as string | undefined;
    if (!expectedKey || !provided || provided !== expectedKey) {
        res.status(401).json({ error: 'Unauthorized — provide X-Demo-Admin-Key header' });
        return;
    }

    try {
        const { randomBytes } = await import('crypto');

        // 1 — Upsert User
        const user = await prisma.user.upsert({
            where: { walletAddress: KIMI_AGENT_WALLET_ADDR },
            update: { role: 'BUYER' },
            create: {
                walletAddress: KIMI_AGENT_WALLET_ADDR,
                role: 'BUYER',
                email: 'kimi-agent@lead-engine.internal',
            },
        });

        // 2 — Upsert BuyerProfile
        const profile = await prisma.buyerProfile.upsert({
            where: { userId: user.id },
            update: { kycStatus: 'VERIFIED', companyName: 'Kimi AI Agent' },
            create: {
                userId: user.id,
                companyName: 'Kimi AI Agent',
                verticals: [],
                kycStatus: 'VERIFIED',
                kycVerifiedAt: new Date(),
            },
        });

        // 3 — Upsert EscrowVault
        await prisma.escrowVault.upsert({
            where: { userId: user.id },
            update: {},
            create: { userId: user.id },
        });

        // 4 — Create a 1-year session token
        const token = randomBytes(48).toString('hex');
        const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        const session = await prisma.session.create({
            data: {
                userId: user.id,
                token,
                expiresAt,
                userAgent: 'Kimi-MCP-Agent/1.0',
                ipAddress: '127.0.0.1',
            },
        });

        console.log(`[DEMO] /seed-agent: Kimi agent account seeded — userId=${user.id}`);

        res.json({
            ok: true,
            userId: user.id,
            buyerProfileId: profile.id,
            sessionId: session.id,
            sessionToken: token,           // → mcp-server/.env  API_KEY=<this>
            walletAddress: KIMI_AGENT_WALLET_ADDR,
            expiresAt: expiresAt.toISOString(),
            envLine: [
                `# mcp-server/.env`,
                `API_KEY=${token}`,
                ``,
                `# backend/.env`,
                `KIMI_AGENT_WALLET=${KIMI_AGENT_WALLET_ADDR}`,
                `KIMI_AGENT_USER_ID=${user.id}`,
                `KIMI_AGENT_BUYER_PROFILE_ID=${profile.id}`,
            ].join('\n'),
        });
    } catch (err: any) {
        console.error('[DEMO] /seed-agent error:', err);
        res.status(500).json({ error: 'Seed failed', details: err.message });
    }
});

export default router;
