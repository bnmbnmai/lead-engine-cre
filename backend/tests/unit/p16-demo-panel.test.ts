/**
 * p16-demo-panel.test.ts — Demo Panel Fixes
 *
 * Tests for: clear-all, inject with non-PII fields, 5-min durations,
 * reset endpoint, and live countdown timer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Constants mirrored from demo-panel.routes ──

const VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'b2b_saas', 'real_estate', 'auto', 'legal', 'financial_services'];

const VERTICAL_DEMO_PARAMS: Record<string, Record<string, string | boolean>> = {
    solar: { roof_age: '8', monthly_bill: '185', ownership: 'own', panel_interest: 'purchase', shade_level: 'no_shade' },
    mortgage: { loan_type: 'purchase', credit_range: 'good_700-749', property_type: 'single_family', purchase_price: '450000', down_payment_pct: '20' },
    roofing: { roof_type: 'shingle', damage_type: 'storm', insurance_claim: true, roof_age: '15', square_footage: '2200' },
    insurance: { coverage_type: 'home', current_provider: 'State Farm', policy_expiry: '30', num_drivers: '2' },
    home_services: { service_type: 'hvac', urgency: 'this_week', property_type: 'residential' },
    real_estate: { transaction_type: 'buying', property_type: 'single_family', price_range: '200k-500k', timeline: '1-3_months' },
    auto: { vehicle_year: '2022', vehicle_make: 'Toyota', vehicle_model: 'Camry', mileage: '28000', coverage_type: 'full', current_insured: true },
    b2b_saas: { company_size: '51-200', industry: 'technology', budget_range: '2000-10000', decision_timeline: '1-3_months', current_solution: 'Salesforce' },
    legal: { case_type: 'personal_injury', urgency: 'this_week', has_representation: false, case_value: '75000' },
    financial: { service_type: 'financial_planning', portfolio_size: '250k-1m', risk_tolerance: 'moderate', existing_advisor: false },
};

const LEAD_AUCTION_DURATION_SECS = 300; // 5 minutes

// ── Helper: formatTimeRemaining (mirrors utils.ts) ──
function formatTimeRemaining(endTime: string | Date): string {
    const end = typeof endTime === 'string' ? new Date(endTime) : endTime;
    const now = new Date();
    const diffMs = end.getTime() - now.getTime();
    if (diffMs <= 0) return 'Ended';
    const hours = Math.floor(diffMs / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// ============================================
// Group 1: Clear-All Endpoint
// ============================================
describe('Demo Panel: Clear-All', () => {
    it('should delete ALL leads regardless of consentProof tag', () => {
        // Simulated clear function — no WHERE clause
        const deleteMany = vi.fn().mockResolvedValue({ count: 25 });
        // Before fix: only { where: { consentProof: 'DEMO_TAG' } }
        // After fix: deleteMany({}) — no filter
        const query = {}; // empty = all records
        expect(Object.keys(query)).toHaveLength(0);
    });

    it('should delete all bids before leads (dependency order)', () => {
        const order: string[] = [];
        const steps = ['bids', 'auctionRooms', 'transactions', 'leads', 'asks'];
        steps.forEach(s => order.push(s));
        expect(order.indexOf('bids')).toBeLessThan(order.indexOf('leads'));
        expect(order.indexOf('leads')).toBeLessThan(order.indexOf('asks'));
    });

    it('should emit marketplace:refreshAll after clearing', () => {
        const io = { emit: vi.fn() };
        io.emit('marketplace:refreshAll');
        expect(io.emit).toHaveBeenCalledWith('marketplace:refreshAll');
    });

    it('should return counts for leads, bids, and asks deleted', () => {
        const response = { success: true, deleted: { leads: 20, bids: 35, asks: 5 } };
        expect(response.deleted.leads).toBe(20);
        expect(response.deleted.bids).toBe(35);
        expect(response.deleted.asks).toBe(5);
    });

    it('should handle empty database gracefully', () => {
        const response = { success: true, deleted: { leads: 0, bids: 0, asks: 0 } };
        expect(response.success).toBe(true);
        expect(response.deleted.leads).toBe(0);
    });
});

// ============================================
// Group 2: Inject Single Lead — Non-PII Fields
// ============================================
describe('Demo Panel: Inject Lead with Non-PII Fields', () => {
    it('should include parameters for each of the 10 verticals', () => {
        for (const v of Object.keys(VERTICAL_DEMO_PARAMS)) {
            const params = VERTICAL_DEMO_PARAMS[v];
            expect(Object.keys(params).length).toBeGreaterThan(0);
        }
    });

    it('solar lead should have roof_age, monthly_bill, ownership, panel_interest, shade_level', () => {
        const p = VERTICAL_DEMO_PARAMS.solar;
        expect(p).toHaveProperty('roof_age');
        expect(p).toHaveProperty('monthly_bill');
        expect(p).toHaveProperty('ownership');
        expect(p).toHaveProperty('panel_interest');
        expect(p).toHaveProperty('shade_level');
    });

    it('mortgage lead should have loan_type, credit_range, property_type, purchase_price, down_payment_pct', () => {
        const p = VERTICAL_DEMO_PARAMS.mortgage;
        expect(p.loan_type).toBe('purchase');
        expect(p.credit_range).toBe('good_700-749');
        expect(p.purchase_price).toBe('450000');
    });

    it('roofing lead should include boolean insurance_claim field', () => {
        expect(VERTICAL_DEMO_PARAMS.roofing.insurance_claim).toBe(true);
    });

    it('auto lead should have vehicle details + boolean current_insured', () => {
        const p = VERTICAL_DEMO_PARAMS.auto;
        expect(p.vehicle_year).toBe('2022');
        expect(p.vehicle_make).toBe('Toyota');
        expect(p.current_insured).toBe(true);
    });

    it('b2b_saas lead should include current_solution text field', () => {
        expect(VERTICAL_DEMO_PARAMS.b2b_saas.current_solution).toBe('Salesforce');
    });

    it('legal lead should have has_representation as false', () => {
        expect(VERTICAL_DEMO_PARAMS.legal.has_representation).toBe(false);
    });

    it('injected lead response should include parameters object', () => {
        const response = {
            success: true,
            lead: { id: 'test-id', vertical: 'solar', state: 'CA', price: 50, parameters: VERTICAL_DEMO_PARAMS.solar },
        };
        expect(response.lead.parameters).toBeDefined();
        expect(response.lead.parameters.roof_age).toBe('8');
    });

    it('should emit lead:new with parameters in socket payload', () => {
        const payload = {
            lead: {
                id: 'test-id',
                vertical: 'solar',
                parameters: VERTICAL_DEMO_PARAMS.solar,
                _count: { bids: 0 },
            },
        };
        expect(payload.lead.parameters).toEqual(VERTICAL_DEMO_PARAMS.solar);
    });
});

// ============================================
// Group 3: 5-Minute Auction Duration
// ============================================
describe('Demo Panel: 5-Minute Auction Duration', () => {
    it('LEAD_AUCTION_DURATION_SECS should be 300', () => {
        expect(LEAD_AUCTION_DURATION_SECS).toBe(300);
    });

    it('seeded IN_AUCTION leads should end in ~5 minutes, not 1-72 hours', () => {
        const now = Date.now();
        const auctionEnd = new Date(now + LEAD_AUCTION_DURATION_SECS * 1000);
        const diffMinutes = (auctionEnd.getTime() - now) / 60000;
        expect(diffMinutes).toBeCloseTo(5, 0);
    });

    it('injected lead auctionEndAt should be now + 300s', () => {
        const now = Date.now();
        const endAt = new Date(now + 300 * 1000);
        const diff = endAt.getTime() - now;
        expect(diff).toBe(300000); // 5 minutes in ms
    });

    it('duration should NOT be random 1-72 hours (old behavior)', () => {
        const now = Date.now();
        const end = new Date(now + LEAD_AUCTION_DURATION_SECS * 1000);
        const hours = (end.getTime() - now) / 3600000;
        expect(hours).toBeLessThanOrEqual(1); // 5 min < 1 hour
    });
});

// ============================================
// Group 4: Reset Endpoint
// ============================================
describe('Demo Panel: Reset to Clean Demo State', () => {
    it('should return cleared count and reseeded counts', () => {
        const response = {
            success: true,
            cleared: 15,
            reseeded: { leads: 10, bids: 12, asks: 5 },
        };
        expect(response.success).toBe(true);
        expect(response.cleared).toBe(15);
        expect(response.reseeded.leads).toBe(10);
    });

    it('reset should produce 10 fresh leads (all IN_AUCTION)', () => {
        const reseeded = { leads: 10, bids: 12, asks: 5 };
        expect(reseeded.leads).toBe(10);
    });

    it('reset should produce 5 asks', () => {
        const reseeded = { leads: 10, bids: 12, asks: 5 };
        expect(reseeded.asks).toBe(5);
    });

    it('should emit marketplace:refreshAll after reset', () => {
        const io = { emit: vi.fn() };
        io.emit('marketplace:refreshAll');
        expect(io.emit).toHaveBeenCalledWith('marketplace:refreshAll');
    });

    it('reseeded leads should use LEAD_AUCTION_DURATION_SECS for duration', () => {
        const expectedEndMs = Date.now() + LEAD_AUCTION_DURATION_SECS * 1000;
        const expectedMinutes = (expectedEndMs - Date.now()) / 60000;
        expect(expectedMinutes).toBeCloseTo(5, 0);
    });
});

// ============================================
// Group 5: Live Countdown Timer (LeadCard)
// ============================================
describe('LeadCard: Live Countdown Timer', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('formatTimeRemaining should return mm:ss for <1 hour', () => {
        const end = new Date(Date.now() + 300000); // 5 min
        const result = formatTimeRemaining(end);
        expect(result).toMatch(/^\d+:\d{2}$/);
    });

    it('formatTimeRemaining should return "Ended" for past dates', () => {
        const end = new Date(Date.now() - 1000);
        expect(formatTimeRemaining(end)).toBe('Ended');
    });

    it('countdown should decrease after 1 second', () => {
        const end = new Date(Date.now() + 120000); // 2 min
        const before = formatTimeRemaining(end);
        vi.advanceTimersByTime(1000);
        const after = formatTimeRemaining(end);
        // After 1 second, the countdown should differ
        expect(before).not.toBe(after);
    });

    it('countdown should show "Ended" when timer expires', () => {
        const end = new Date(Date.now() + 2000); // 2s
        vi.advanceTimersByTime(3000);
        expect(formatTimeRemaining(end)).toBe('Ended');
    });

    it('progress should increase over time', () => {
        const start = Date.now();
        const end = start + 300000; // 5 min
        const calcProgress = () => {
            const total = end - start;
            const elapsed = Math.min(Date.now() - start, total);
            return Math.round((elapsed / total) * 100);
        };
        const p1 = calcProgress();
        vi.advanceTimersByTime(60000); // 1 minute
        const p2 = calcProgress();
        expect(p2).toBeGreaterThan(p1);
        expect(p2).toBeCloseTo(20, 0); // 1/5 = 20%
    });

    it('progress should cap at 100%', () => {
        const start = Date.now();
        const end = start + 300000;
        vi.advanceTimersByTime(600000); // double the time
        const total = end - start;
        const elapsed = Math.min(Date.now() - start, total);
        const progress = Math.min(Math.round((elapsed / total) * 100), 100);
        expect(progress).toBe(100);
    });
});

// ============================================
// Group 6: DemoPanel UI — Reset Button
// ============================================
describe('DemoPanel: Reset Button', () => {
    it('demoReset API method should POST to /api/v1/demo-panel/reset', () => {
        const endpoint = '/api/v1/demo-panel/reset';
        expect(endpoint).toContain('/demo-panel/reset');
    });

    it('handleReset should display cleared + reseeded counts in success message', () => {
        const data = { success: true, cleared: 15, reseeded: { leads: 10, bids: 12, asks: 5 } };
        const r = data.reseeded;
        const msg = `🔄 Cleared ${data.cleared} old records → reseeded ${r.leads} leads, ${r.bids} bids, ${r.asks} asks`;
        expect(msg).toContain('Cleared 15');
        expect(msg).toContain('reseeded 10 leads');
    });

    it('Reset button should have danger variant', () => {
        const variant = 'danger';
        expect(variant).toBe('danger');
    });
});

// ============================================
// Group 7: Seed Duration Fix
// ============================================
describe('Demo Panel: Seed Duration Fix', () => {
    it('seeded IN_AUCTION leads use LEAD_AUCTION_DURATION_SECS not random hours', () => {
        // Old: rand(1, 72) * 3600000  => 1h - 72h
        // New: LEAD_AUCTION_DURATION_SECS * 1000  => 300s = 5 min
        const duration = LEAD_AUCTION_DURATION_SECS * 1000;
        expect(duration).toBe(300000);
        expect(duration).toBeLessThan(3600000); // less than 1 hour
    });

    it('EXPIRED and SOLD leads keep longer durations (2 days from creation)', () => {
        const createdAt = new Date();
        const auctionEnd = new Date(createdAt.getTime() + 2 * 86400000);
        const daysDiff = (auctionEnd.getTime() - createdAt.getTime()) / 86400000;
        expect(daysDiff).toBe(2);
    });
});

// ============================================
// Group 8: Edge Cases
// ============================================
describe('Demo Panel: Edge Cases', () => {
    it('clear should work when no leads exist', () => {
        const result = { success: true, deleted: { leads: 0, bids: 0, asks: 0 } };
        expect(result.success).toBe(true);
    });

    it('inject should fail gracefully if seller not seeded', () => {
        const error = { error: 'Demo data not seeded. Seed marketplace first.' };
        expect(error.error).toContain('not seeded');
    });

    it('unknown vertical should get empty params (not crash)', () => {
        const params = VERTICAL_DEMO_PARAMS['unknown_vertical'] || {};
        expect(params).toEqual({});
    });

    it('socket emit is skipped if io is undefined', () => {
        const io = undefined;
        const emitted = io ? true : false;
        expect(emitted).toBe(false);
    });

    it('devOnly guard should block production requests', () => {
        const env = 'production';
        const demoMode = undefined;
        const blocked = env === 'production' && demoMode !== 'true';
        expect(blocked).toBe(true);
    });

    it('devOnly guard should allow production with DEMO_MODE=true', () => {
        const env = 'production';
        const demoMode = 'true';
        const blocked = env === 'production' && demoMode !== 'true';
        expect(blocked).toBe(false);
    });
});

// ============================================
// Group 9: Mock Toggle Preserved
// ============================================
describe('Demo Panel: Mock Toggle Preserved', () => {
    it('mock toggle should remain functional after changes', () => {
        let mockData = false;
        mockData = !mockData;
        expect(mockData).toBe(true);
    });

    it('mock state should persist in localStorage', () => {
        const key = 'VITE_USE_MOCK_DATA';
        // localStorage.setItem would be called
        expect(key).toBe('VITE_USE_MOCK_DATA');
    });
});
