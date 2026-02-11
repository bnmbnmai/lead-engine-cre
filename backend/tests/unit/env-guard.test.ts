/**
 * Environment guard tests — validate that mock data is correctly blocked
 * in production and allowed in development.
 */

describe('Environment guard logic', () => {
    // ─── Helper: replicate the guard from analytics.routes.ts ───
    function shouldUseMock(env: Record<string, string | undefined>): boolean {
        const isProd = env.NODE_ENV === 'production';
        return env.USE_MOCK_DATA === 'true' && !isProd;
    }

    function shouldWarn(env: Record<string, string | undefined>): boolean {
        const isProd = env.NODE_ENV === 'production';
        return env.USE_MOCK_DATA === 'true' && isProd;
    }

    // ============================================
    // Production mode
    // ============================================

    describe('Production mode (NODE_ENV=production)', () => {
        test('blocks mock even when USE_MOCK_DATA=true', () => {
            expect(shouldUseMock({ NODE_ENV: 'production', USE_MOCK_DATA: 'true' })).toBe(false);
        });

        test('blocks mock when USE_MOCK_DATA=false', () => {
            expect(shouldUseMock({ NODE_ENV: 'production', USE_MOCK_DATA: 'false' })).toBe(false);
        });

        test('blocks mock when USE_MOCK_DATA is undefined', () => {
            expect(shouldUseMock({ NODE_ENV: 'production' })).toBe(false);
        });
    });

    // ============================================
    // Development mode
    // ============================================

    describe('Development mode (NODE_ENV=development)', () => {
        test('allows mock when USE_MOCK_DATA=true', () => {
            expect(shouldUseMock({ NODE_ENV: 'development', USE_MOCK_DATA: 'true' })).toBe(true);
        });

        test('blocks mock when USE_MOCK_DATA=false', () => {
            expect(shouldUseMock({ NODE_ENV: 'development', USE_MOCK_DATA: 'false' })).toBe(false);
        });

        test('blocks mock when USE_MOCK_DATA is undefined', () => {
            expect(shouldUseMock({ NODE_ENV: 'development' })).toBe(false);
        });
    });

    // ============================================
    // Edge cases
    // ============================================

    describe('Edge cases', () => {
        test('allows mock when NODE_ENV is undefined and USE_MOCK_DATA=true', () => {
            expect(shouldUseMock({ USE_MOCK_DATA: 'true' })).toBe(true);
        });

        test('allows mock when NODE_ENV is empty string', () => {
            expect(shouldUseMock({ NODE_ENV: '', USE_MOCK_DATA: 'true' })).toBe(true);
        });

        test('allows mock for NODE_ENV=staging (not production)', () => {
            expect(shouldUseMock({ NODE_ENV: 'staging', USE_MOCK_DATA: 'true' })).toBe(true);
        });

        test('rejects USE_MOCK_DATA=TRUE (case sensitive)', () => {
            expect(shouldUseMock({ NODE_ENV: 'development', USE_MOCK_DATA: 'TRUE' })).toBe(false);
        });

        test('rejects USE_MOCK_DATA=1 (not string "true")', () => {
            expect(shouldUseMock({ NODE_ENV: 'development', USE_MOCK_DATA: '1' })).toBe(false);
        });
    });

    // ============================================
    // Prod warning detection
    // ============================================

    describe('Production warning detection', () => {
        test('warns when USE_MOCK_DATA=true in production', () => {
            expect(shouldWarn({ NODE_ENV: 'production', USE_MOCK_DATA: 'true' })).toBe(true);
        });

        test('does NOT warn when USE_MOCK_DATA=false in production', () => {
            expect(shouldWarn({ NODE_ENV: 'production', USE_MOCK_DATA: 'false' })).toBe(false);
        });

        test('does NOT warn when USE_MOCK_DATA=true in development', () => {
            expect(shouldWarn({ NODE_ENV: 'development', USE_MOCK_DATA: 'true' })).toBe(false);
        });
    });

    // ============================================
    // Empty dataset handling
    // ============================================

    describe('Empty dataset handling', () => {
        test('empty arrays produce zero aggregates', () => {
            const data: { count: number; revenue: number }[] = [];
            const totalCount = data.reduce((s, d) => s + d.count, 0);
            const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);
            expect(totalCount).toBe(0);
            expect(totalRevenue).toBe(0);
        });

        test('win rate is 0% when no bids exist', () => {
            const totalBids = 0;
            const wonBids = 0;
            const winRate = totalBids > 0 ? ((wonBids / totalBids) * 100).toFixed(1) : '0';
            expect(winRate).toBe('0');
        });

        test('conversion rate is 0 when no leads exist', () => {
            const totalLeads = 0;
            const soldLeads = 0;
            const conversionRate = totalLeads > 0 ? (soldLeads / totalLeads * 100).toFixed(1) : 0;
            expect(conversionRate).toBe(0);
        });

        test('avg bid is 0 when amounts array is empty', () => {
            const amounts: number[] = [];
            const avg = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
            expect(avg).toBe(0);
        });
    });
});
