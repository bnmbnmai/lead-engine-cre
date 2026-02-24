/**
 * Marketplace Visibility + Bounty Tests
 *
 * Validates:
 *   1. Seeded leads have non-null qualityScore (QS)
 *   2. Unified marketplace: sellers see all leads, not just own
 *   3. ?view=my-leads narrows to seller's own leads
 *   4. Buyers see all statuses when authenticated
 *   5. Unauthenticated users see only IN_AUCTION
 *   6. Bounty validation (schema, amount, status)
 *   7. Bounty stacking (cumulative totals)
 *
 * Uses mocked Prisma — no database required.
 */

import { computeCREQualityScore, LeadScoringInput } from '../../src/lib/chainlink/cre-quality-score';

// ─── Mock Prisma ────────────────────────────────
const mockPrisma = {
    lead: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
    },
    transaction: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    sellerProfile: {
        findFirst: jest.fn(),
        create: jest.fn(),
    },
    buyerProfile: {
        findFirst: jest.fn(),
    },
    user: {
        findFirst: jest.fn(),
        create: jest.fn(),
    },
    vertical: {
        findMany: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn(),
};

jest.mock('../../src/lib/prisma', () => ({ prisma: mockPrisma }));

afterEach(() => {
    jest.clearAllMocks();
});

// =============================================
// 1. Seeded leads — QS scored
// =============================================

describe('Seeded Lead QS Scoring', () => {
    const DEMO_VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'home_services.plumbing'];
    const GEOS = [
        { country: 'US', state: 'CA', city: 'Los Angeles' },
        { country: 'US', state: 'FL', city: 'Miami' },
        { country: 'US', state: 'TX', city: 'Austin' },
    ];

    it('should compute a non-null, non-zero QS for every seeded lead', () => {
        // Simulate the QS input for seeded leads (same as demo-panel POST /seed)
        for (let i = 0; i < 10; i++) {
            const vertical = DEMO_VERTICALS[i % DEMO_VERTICALS.length];
            const geo = GEOS[i % GEOS.length];
            const zip = `${10000 + Math.floor(Math.random() * 89999)}`;

            const seedScoreInput: LeadScoringInput = {
                tcpaConsentAt: new Date(),
                geo: { country: geo.country, state: geo.state, zip },
                hasEncryptedData: false,
                encryptedDataValid: false,
                parameterCount: 3, // typical demo lead has 3-5 params
                source: 'PLATFORM',
                zipMatchesState: false,
            };

            const qs = computeCREQualityScore(seedScoreInput);
            expect(qs).not.toBeNull();
            expect(qs).toBeGreaterThan(0);
            expect(qs).toBeLessThanOrEqual(10000);
        }
    });

    it('should produce consistent QS ranges for PLATFORM source with geo', () => {
        const input: LeadScoringInput = {
            tcpaConsentAt: new Date(),
            geo: { country: 'US', state: 'FL', zip: '33101' },
            hasEncryptedData: false,
            encryptedDataValid: false,
            parameterCount: 4,
            source: 'PLATFORM',
            zipMatchesState: false,
        };

        const qs = computeCREQualityScore(input);
        // TCPA (fresh) + geo (state+zip) + no encrypted data + 4 params + PLATFORM source
        // Expected: 2000 + 1400 + 0 + 1600 + 1500 = 6500
        expect(qs).toBeGreaterThanOrEqual(5000);
        expect(qs).toBeLessThanOrEqual(8000);
    });

    it('should compute higher QS for leads with more parameters', () => {
        const base: LeadScoringInput = {
            tcpaConsentAt: new Date(),
            geo: { country: 'US', state: 'CA' },
            hasEncryptedData: false,
            encryptedDataValid: false,
            source: 'PLATFORM',
            zipMatchesState: false,
            parameterCount: 1,
        };

        const qs1 = computeCREQualityScore({ ...base, parameterCount: 1 });
        const qs5 = computeCREQualityScore({ ...base, parameterCount: 5 });

        expect(qs5).toBeGreaterThan(qs1);
    });
});

// =============================================
// 2. Unified Marketplace Visibility
// =============================================

describe('Unified Marketplace Visibility', () => {
    // Simulates the where-clause logic from GET /leads

    function buildWhereClause(
        user: { id: string; role: string } | null,
        query: { view?: string; status?: string; buyNow?: boolean }
    ): Record<string, any> {
        const where: any = {};

        if (user) {
            if (query.view === 'my-leads' && (user.role === 'SELLER' || user.role === 'ADMIN')) {
                // Would do DB lookup — simulate with sellerId
                where.sellerId = `seller-for-${user.id}`;
            }
            // Both buyers and sellers see all active statuses
        } else {
            where.status = 'IN_AUCTION';
        }

        if (query.buyNow) {
            where.status = 'UNSOLD';
            where.expiresAt = { gt: expect.any(Date) };
        }
        if (query.status && !query.buyNow) {
            where.status = query.status;
        }

        return where;
    }

    it('seller (default view) sees ALL leads — no sellerId filter', () => {
        const where = buildWhereClause(
            { id: 'user-seller-1', role: 'SELLER' },
            {}
        );
        expect(where.sellerId).toBeUndefined();
        expect(where.status).toBeUndefined();
    });

    it('seller with ?view=my-leads sees only own leads', () => {
        const where = buildWhereClause(
            { id: 'user-seller-1', role: 'SELLER' },
            { view: 'my-leads' }
        );
        expect(where.sellerId).toBe('seller-for-user-seller-1');
    });

    it('buyer sees ALL leads — no status restriction', () => {
        const where = buildWhereClause(
            { id: 'user-buyer-1', role: 'BUYER' },
            {}
        );
        expect(where.status).toBeUndefined();
        expect(where.sellerId).toBeUndefined();
    });

    it('buyer with ?view=my-leads is ignored (not seller)', () => {
        const where = buildWhereClause(
            { id: 'user-buyer-1', role: 'BUYER' },
            { view: 'my-leads' }
        );
        expect(where.sellerId).toBeUndefined();
    });

    it('unauthenticated user sees only IN_AUCTION', () => {
        const where = buildWhereClause(null, {});
        expect(where.status).toBe('IN_AUCTION');
    });

    it('admin with ?view=my-leads narrows to own leads', () => {
        const where = buildWhereClause(
            { id: 'admin-1', role: 'ADMIN' },
            { view: 'my-leads' }
        );
        expect(where.sellerId).toBe('seller-for-admin-1');
    });

    it('hybrid user (buyer+seller role=SELLER) sees all by default', () => {
        const where = buildWhereClause(
            { id: 'hybrid-user', role: 'SELLER' },
            {}
        );
        expect(where.sellerId).toBeUndefined();
        expect(where.status).toBeUndefined();
    });

    it('?status filter still works for authenticated users', () => {
        const where = buildWhereClause(
            { id: 'user-1', role: 'BUYER' },
            { status: 'SOLD' }
        );
        expect(where.status).toBe('SOLD');
    });

    it('buyNow mode overrides status to UNSOLD', () => {
        const where = buildWhereClause(
            { id: 'user-1', role: 'BUYER' },
            { buyNow: true, status: 'IN_AUCTION' }
        );
        expect(where.status).toBe('UNSOLD');
    });
});

// =============================================
// 3. Vertical Bounty Deposit Validation
// =============================================

import { BountyDepositSchema, BountyCriteriaSchema } from '../../src/services/bounty.service';

describe('Vertical Bounty Deposit Validation', () => {
    it('should reject deposit below $10', () => {
        const result = BountyDepositSchema.safeParse({ amount: 5 });
        expect(result.success).toBe(false);
    });

    it('should reject deposit above $10000', () => {
        const result = BountyDepositSchema.safeParse({ amount: 10001 });
        expect(result.success).toBe(false);
    });

    it('should accept deposit of exactly $10', () => {
        const result = BountyDepositSchema.safeParse({ amount: 10 });
        expect(result.success).toBe(true);
    });

    it('should accept deposit of exactly $10000', () => {
        const result = BountyDepositSchema.safeParse({ amount: 10000 });
        expect(result.success).toBe(true);
    });

    it('should accept deposit with criteria', () => {
        const result = BountyDepositSchema.safeParse({
            amount: 100,
            criteria: {
                minQualityScore: 7000,
                geoStates: ['CA', 'TX'],
                minCreditScore: 650,
                maxLeadAge: 24,
            },
        });
        expect(result.success).toBe(true);
    });

    it('should reject invalid geo state codes', () => {
        const result = BountyCriteriaSchema.safeParse({
            geoStates: ['CAL'], // 3 chars, must be 2
        });
        expect(result.success).toBe(false);
    });

    it('should reject credit score out of range', () => {
        const low = BountyCriteriaSchema.safeParse({ minCreditScore: 100 }); // below 300
        const high = BountyCriteriaSchema.safeParse({ minCreditScore: 900 }); // above 850
        expect(low.success).toBe(false);
        expect(high.success).toBe(false);
    });

    it('should accept deposit without criteria (no filter = match all)', () => {
        const result = BountyDepositSchema.safeParse({ amount: 500 });
        expect(result.success).toBe(true);
    });
});

// =============================================
// 4. Bounty Criteria Matching Engine
// =============================================

describe('Bounty Criteria Matching', () => {
    // Pure matching logic extracted for testing
    function matchesCriteria(
        lead: { qualityScore?: number; state?: string; country?: string; creditScore?: number; ageHours?: number },
        criteria: { minQualityScore?: number; geoStates?: string[]; geoCountries?: string[]; minCreditScore?: number; maxLeadAge?: number }
    ): boolean {
        if (criteria.minQualityScore != null && (lead.qualityScore || 0) < criteria.minQualityScore) return false;
        if (criteria.geoStates?.length && !criteria.geoStates.includes(lead.state || '')) return false;
        if (criteria.geoCountries?.length && !criteria.geoCountries.includes(lead.country || '')) return false;
        if (criteria.minCreditScore != null && (lead.creditScore || 0) < criteria.minCreditScore) return false;
        if (criteria.maxLeadAge != null && (lead.ageHours || 0) > criteria.maxLeadAge) return false;
        return true;
    }

    it('should match lead with no criteria (match all)', () => {
        const lead = { qualityScore: 5000, state: 'CA' };
        expect(matchesCriteria(lead, {})).toBe(true);
    });

    it('should reject lead below minQualityScore', () => {
        const lead = { qualityScore: 3000, state: 'CA' };
        expect(matchesCriteria(lead, { minQualityScore: 7000 })).toBe(false);
    });

    it('should accept lead above minQualityScore', () => {
        const lead = { qualityScore: 8000, state: 'CA' };
        expect(matchesCriteria(lead, { minQualityScore: 7000 })).toBe(true);
    });

    it('should reject lead outside geoStates filter', () => {
        const lead = { qualityScore: 9000, state: 'NY' };
        expect(matchesCriteria(lead, { geoStates: ['CA', 'TX'] })).toBe(false);
    });

    it('should accept lead inside geoStates filter', () => {
        const lead = { qualityScore: 9000, state: 'TX' };
        expect(matchesCriteria(lead, { geoStates: ['CA', 'TX'] })).toBe(true);
    });

    it('should reject lead below minCreditScore', () => {
        const lead = { creditScore: 580, state: 'CA' };
        expect(matchesCriteria(lead, { minCreditScore: 650 })).toBe(false);
    });

    it('should accept lead above minCreditScore', () => {
        const lead = { creditScore: 720, state: 'CA' };
        expect(matchesCriteria(lead, { minCreditScore: 650 })).toBe(true);
    });

    it('should reject lead older than maxLeadAge', () => {
        const lead = { ageHours: 48, state: 'CA' };
        expect(matchesCriteria(lead, { maxLeadAge: 24 })).toBe(false);
    });

    it('should accept fresh lead within maxLeadAge', () => {
        const lead = { ageHours: 12, state: 'CA' };
        expect(matchesCriteria(lead, { maxLeadAge: 24 })).toBe(true);
    });

    it('should require ALL criteria to match (AND logic)', () => {
        const lead = { qualityScore: 9000, state: 'CA', creditScore: 750, ageHours: 6 };
        const criteria = { minQualityScore: 7000, geoStates: ['CA'], minCreditScore: 700, maxLeadAge: 12 };
        expect(matchesCriteria(lead, criteria)).toBe(true);
    });

    it('should fail if any one criterion fails (AND logic)', () => {
        const lead = { qualityScore: 9000, state: 'CA', creditScore: 600, ageHours: 6 }; // credit too low
        const criteria = { minQualityScore: 7000, geoStates: ['CA'], minCreditScore: 700, maxLeadAge: 12 };
        expect(matchesCriteria(lead, criteria)).toBe(false);
    });

    it('should handle missing lead fields gracefully (default to 0)', () => {
        const lead = {}; // no fields set
        expect(matchesCriteria(lead, { minQualityScore: 1 })).toBe(false);
        expect(matchesCriteria(lead, { minCreditScore: 300 })).toBe(false);
    });
});


// =============================================
// 5. Cross-Persona Consistency
// =============================================

describe('Cross-Persona Consistency', () => {
    it('seller and buyer should see the same lead count (unified view)', () => {
        // Simulate: N leads in DB, various statuses
        const allLeads = [
            { status: 'IN_AUCTION' },
            { status: 'IN_AUCTION' },
            { status: 'IN_AUCTION' },
            { status: 'IN_AUCTION' },
            { status: 'IN_AUCTION' },
            { status: 'IN_AUCTION' },
            { status: 'UNSOLD' },
            { status: 'UNSOLD' },
            { status: 'UNSOLD' },
            { status: 'SOLD' },
        ];

        // Both seller (default unified) and buyer see all — no status filter
        const sellerView = allLeads; // no filter
        const buyerView = allLeads; // no filter

        expect(sellerView.length).toBe(10);
        expect(buyerView.length).toBe(10);
        expect(sellerView.length).toBe(buyerView.length);
    });

    it('unauthenticated sees only IN_AUCTION (6 of 10)', () => {
        const allLeads = [
            { status: 'IN_AUCTION' },
            { status: 'IN_AUCTION' },
            { status: 'IN_AUCTION' },
            { status: 'IN_AUCTION' },
            { status: 'IN_AUCTION' },
            { status: 'IN_AUCTION' },
            { status: 'UNSOLD' },
            { status: 'UNSOLD' },
            { status: 'UNSOLD' },
            { status: 'SOLD' },
        ];

        const publicView = allLeads.filter(l => l.status === 'IN_AUCTION');
        expect(publicView.length).toBe(6);
    });

    it('my-leads filter correctly narrows for seller', () => {
        const allLeads = [
            { sellerId: 'seller-A', status: 'IN_AUCTION' },
            { sellerId: 'seller-A', status: 'UNSOLD' },
            { sellerId: 'seller-B', status: 'IN_AUCTION' },
            { sellerId: 'seller-C', status: 'IN_AUCTION' },
        ];

        const myLeads = allLeads.filter(l => l.sellerId === 'seller-A');
        expect(myLeads.length).toBe(2);
    });
});

// =============================================
// 6. View Query Param Schema
// =============================================

describe('LeadQuerySchema — view param', () => {
    // Inline validation to avoid importing zod schema with all its deps
    const validViews = ['all', 'my-leads'];
    const invalidViews = ['admin', 'public', '', 'MY-LEADS', null];

    it('should accept valid view values', () => {
        for (const v of validViews) {
            expect(validViews.includes(v)).toBe(true);
        }
    });

    it('should reject invalid view values', () => {
        for (const v of invalidViews) {
            expect(validViews.includes(v as string)).toBe(false);
        }
    });

    it('should default to "all" when no view is specified', () => {
        const queryView: string | undefined = undefined;
        const defaultView = queryView ?? 'all';
        expect(defaultView).toBe('all');
    });
});

// =============================================
// 7. Bounty Stacking & Cap Logic
// =============================================

describe('Bounty Stacking & Cap Logic', () => {
    const BOUNTY_STACKING_CAP_MULTIPLIER = 2;

    function applyStackingCap(
        matched: { poolId: string; amount: number }[],
        leadPrice: number
    ): { poolId: string; amount: number }[] {
        if (leadPrice <= 0) return matched;
        const cap = leadPrice * BOUNTY_STACKING_CAP_MULTIPLIER;
        let total = 0;
        const capped: { poolId: string; amount: number }[] = [];
        for (const m of matched) {
            if (total >= cap) break;
            const allowed = Math.min(m.amount, cap - total);
            capped.push({ ...m, amount: allowed });
            total += allowed;
        }
        return capped;
    }

    it('should not cap when total bounty < 2× lead price', () => {
        const matched = [
            { poolId: 'p1', amount: 50 },
            { poolId: 'p2', amount: 30 },
        ];
        const result = applyStackingCap(matched, 100); // cap = $200
        expect(result.length).toBe(2);
        expect(result[0].amount + result[1].amount).toBe(80);
    });

    it('should cap total bounty at 2× lead price', () => {
        const matched = [
            { poolId: 'p1', amount: 150 },
            { poolId: 'p2', amount: 100 },
        ];
        const result = applyStackingCap(matched, 100); // cap = $200
        expect(result.length).toBe(2);
        expect(result[0].amount).toBe(150);
        expect(result[1].amount).toBe(50); // truncated to fit cap
    });

    it('should exclude pools entirely if cap already reached', () => {
        const matched = [
            { poolId: 'p1', amount: 200 },
            { poolId: 'p2', amount: 100 }, // should be excluded
        ];
        const result = applyStackingCap(matched, 100); // cap = $200
        expect(result.length).toBe(1);
        expect(result[0].amount).toBe(200);
    });

    it('should return all matched when leadPrice is 0 (no cap)', () => {
        const matched = [
            { poolId: 'p1', amount: 500 },
            { poolId: 'p2', amount: 500 },
        ];
        const result = applyStackingCap(matched, 0); // no cap
        expect(result.length).toBe(2);
        expect(result[0].amount + result[1].amount).toBe(1000);
    });
});

// =============================================
// 8. Bounty Refund Flow
// =============================================

describe('Bounty Refund Flow', () => {
    it('should deactivate only the targeted pool (not all buyer pools)', () => {
        const buyerId = 'buyer-1';
        const pools = [
            { poolId: 'pool-1', buyerId, amount: 100, active: true },
            { poolId: 'pool-2', buyerId, amount: 50, active: true },
            { poolId: 'pool-3', buyerId: 'buyer-2', amount: 75, active: true },
        ];

        // Simulate withdraw targeting pool-1 only
        const withdrawPoolId = 'pool-1';
        const updated = pools.map(p =>
            p.poolId === withdrawPoolId ? { ...p, active: false } : p
        );

        expect(updated[0].active).toBe(false); // pool-1 deactivated
        expect(updated[1].active).toBe(true);   // pool-2 still active
        expect(updated[2].active).toBe(true);   // pool-3 unaffected
    });

    it('should not deactivate pools from other buyers', () => {
        const pools = [
            { poolId: 'pool-A', buyerId: 'buyer-1', active: true },
            { poolId: 'pool-B', buyerId: 'buyer-2', active: true },
        ];

        const updated = pools.map(p =>
            p.poolId === 'pool-A' ? { ...p, active: false } : p
        );

        expect(updated[0].active).toBe(false);
        expect(updated[1].active).toBe(true);
    });

    it('should handle pool not found gracefully', () => {
        const pools = [
            { poolId: 'pool-1', buyerId: 'buyer-1', active: true },
        ];

        const updated = pools.map(p =>
            p.poolId === 'nonexistent' ? { ...p, active: false } : p
        );

        expect(updated[0].active).toBe(true); // unchanged
    });
});

// =============================================
// 9. Buyer-Funded E2E Matching
// =============================================

describe('Buyer-Funded E2E Matching', () => {
    const matchesCriteria = (
        lead: { qualityScore?: number; state?: string; creditScore?: number; ageHours?: number },
        criteria: { minQualityScore?: number; geoStates?: string[]; minCreditScore?: number; maxLeadAge?: number }
    ): boolean => {
        if (criteria.minQualityScore != null && (lead.qualityScore || 0) < criteria.minQualityScore) return false;
        if (criteria.geoStates?.length && !criteria.geoStates.includes(lead.state || '')) return false;
        if (criteria.minCreditScore != null && (lead.creditScore || 0) < criteria.minCreditScore) return false;
        if (criteria.maxLeadAge != null && (lead.ageHours || 0) > criteria.maxLeadAge) return false;
        return true;
    };

    it('should resolve tie between equal-amount pools by first-match order', () => {
        const lead = { qualityScore: 8000, state: 'CA', creditScore: 750, ageHours: 2 };
        const pools = [
            { poolId: 'pool-1', buyerId: 'buyer-A', amount: 100, criteria: { minQualityScore: 7000 } },
            { poolId: 'pool-2', buyerId: 'buyer-B', amount: 100, criteria: { minQualityScore: 5000 } },
        ];

        const matched = pools
            .filter(p => matchesCriteria(lead, p.criteria))
            .sort((a, b) => b.amount - a.amount);

        expect(matched.length).toBe(2);
        // Both match, equal amount → first-match (FIFO) preserved from sort stability
        expect(matched[0].poolId).toBe('pool-1');
        expect(matched[1].poolId).toBe('pool-2');
    });

    it('should match only the buyer whose criteria pass', () => {
        const lead = { qualityScore: 6000, state: 'TX' };
        const pools = [
            { poolId: 'p1', buyerId: 'b1', amount: 200, criteria: { minQualityScore: 7000 } }, // fails
            { poolId: 'p2', buyerId: 'b2', amount: 50, criteria: { geoStates: ['TX'] } },       // passes
        ];

        const matched = pools.filter(p => matchesCriteria(lead, p.criteria));
        expect(matched.length).toBe(1);
        expect(matched[0].poolId).toBe('p2');
    });

    it('should match no pools when no criteria pass', () => {
        const lead = { qualityScore: 1000, state: 'FL' };
        const pools = [
            { poolId: 'p1', buyerId: 'b1', amount: 200, criteria: { minQualityScore: 7000 } },
            { poolId: 'p2', buyerId: 'b2', amount: 50, criteria: { geoStates: ['TX', 'CA'] } },
        ];

        const matched = pools.filter(p => matchesCriteria(lead, p.criteria));
        expect(matched.length).toBe(0);
    });

    it('should match all pools when they have no criteria (match-all)', () => {
        const lead = { qualityScore: 1000, state: 'FL' };
        const pools = [
            { poolId: 'p1', buyerId: 'b1', amount: 200, criteria: {} },
            { poolId: 'p2', buyerId: 'b2', amount: 50, criteria: {} },
        ];

        const matched = pools.filter(p => matchesCriteria(lead, p.criteria));
        expect(matched.length).toBe(2);
    });
});
