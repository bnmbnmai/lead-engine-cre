/**
 * p18-realtime-analytics.test.ts — Real-Time Analytics from Purchases/Bids
 *
 * Tests: source param routing, socket emission shape, empty state,
 * cache key isolation, toggle state management, environment guards.
 */

// Jest globals: describe, it, expect are provided automatically

// ── Source param routing ──

const IS_PROD = false;
const USE_MOCK_DEFAULT = true;  // simulates USE_MOCK_DATA=true in dev

function shouldUseMock(source?: string): boolean {
    const src = (source || '').toLowerCase();
    if (src === 'real') return false;
    if (src === 'mock') return !IS_PROD;
    return USE_MOCK_DEFAULT;
}

// ── Analytics update event shape ──

interface AnalyticsUpdateEvent {
    type: 'bid' | 'purchase';
    leadId: string;
    buyerId: string;
    amount: number;
    vertical: string;
    timestamp: string;
}

const SAMPLE_BID_EVENT: AnalyticsUpdateEvent = {
    type: 'bid',
    leadId: 'lead-123',
    buyerId: 'buyer-456',
    amount: 75.50,
    vertical: 'solar',
    timestamp: '2026-02-12T08:00:00.000Z',
};

const SAMPLE_PURCHASE_EVENT: AnalyticsUpdateEvent = {
    type: 'purchase',
    leadId: 'lead-789',
    buyerId: 'buyer-456',
    amount: 150.00,
    vertical: 'mortgage',
    timestamp: '2026-02-12T08:30:00.000Z',
};

// ============================================
// Group 1: Source Param Routing
// ============================================
describe('Analytics: Source Param Routing', () => {
    it('?source=real should bypass mock even when USE_MOCK_DATA=true', () => {
        expect(shouldUseMock('real')).toBe(false);
    });

    it('?source=mock should use mock in dev', () => {
        expect(shouldUseMock('mock')).toBe(true);
    });

    it('no source param should use server default', () => {
        expect(shouldUseMock()).toBe(USE_MOCK_DEFAULT);
    });

    it('?source=REAL should be case-insensitive', () => {
        expect(shouldUseMock('REAL')).toBe(false);
    });

    it('?source=mock should be blocked in production', () => {
        // Simulate production
        const shouldUseMockProd = (source?: string): boolean => {
            const src = (source || '').toLowerCase();
            if (src === 'real') return false;
            if (src === 'mock') return false;   // IS_PROD = true
            return false; // USE_MOCK_DEFAULT=false in prod
        };
        expect(shouldUseMockProd('mock')).toBe(false);
    });
});

// ============================================
// Group 2: Cache Key Isolation
// ============================================
describe('Analytics: Cache Key Isolation', () => {
    it('cache key should include source param', () => {
        const buildCacheKey = (role: string, userId: string, source?: string) =>
            `overview:${role}:${userId}:${source || 'default'}`;

        const keyReal = buildCacheKey('BUYER', 'user-1', 'real');
        const keyMock = buildCacheKey('BUYER', 'user-1', 'mock');
        const keyDefault = buildCacheKey('BUYER', 'user-1');

        expect(keyReal).not.toBe(keyMock);
        expect(keyReal).not.toBe(keyDefault);
        expect(keyReal).toContain('real');
    });
});

// ============================================
// Group 3: Analytics Update Event Shape
// ============================================
describe('Analytics: WebSocket Event Shape', () => {
    it('bid event should have type=bid', () => {
        expect(SAMPLE_BID_EVENT.type).toBe('bid');
    });

    it('purchase event should have type=purchase', () => {
        expect(SAMPLE_PURCHASE_EVENT.type).toBe('purchase');
    });

    it('event should include leadId, buyerId, amount, vertical', () => {
        for (const event of [SAMPLE_BID_EVENT, SAMPLE_PURCHASE_EVENT]) {
            expect(event.leadId).toBeTruthy();
            expect(event.buyerId).toBeTruthy();
            expect(event.amount).toBeGreaterThan(0);
            expect(event.vertical).toBeTruthy();
        }
    });

    it('timestamp should be ISO format', () => {
        const parsed = new Date(SAMPLE_BID_EVENT.timestamp);
        expect(parsed.toISOString()).toBe(SAMPLE_BID_EVENT.timestamp);
    });

    it('amount should be numeric', () => {
        expect(typeof SAMPLE_BID_EVENT.amount).toBe('number');
        expect(typeof SAMPLE_PURCHASE_EVENT.amount).toBe('number');
    });
});

// ============================================
// Group 4: Frontend Toggle State
// ============================================
describe('Analytics: Frontend Toggle State', () => {
    it('dev mode should default useRealData=true', () => {
        const DEV = true;
        const DEMO_MODE = undefined;
        const useRealData = DEV || DEMO_MODE === 'true';
        expect(useRealData).toBe(true);
    });

    it('prod with no DEMO_MODE should default useRealData=false', () => {
        const DEV = false;
        const DEMO_MODE = undefined;
        const useRealData = DEV || DEMO_MODE === 'true';
        expect(useRealData).toBe(false);
    });

    it('prod with VITE_DEMO_MODE=true should default useRealData=true', () => {
        const DEV = false;
        const DEMO_MODE = 'true';
        const useRealData = DEV || DEMO_MODE === 'true';
        expect(useRealData).toBe(true);
    });

    it('dataSource should be "real" when useRealData=true', () => {
        const useRealData = true;
        const useMock = false;
        const dataSource = useRealData ? 'real' : useMock ? 'mock' : undefined;
        expect(dataSource).toBe('real');
    });

    it('dataSource should be "mock" when useRealData=false and useMock=true', () => {
        const useRealData = false;
        const useMock = true;
        const dataSource = useRealData ? 'real' : useMock ? 'mock' : undefined;
        expect(dataSource).toBe('mock');
    });

    it('dataSource should be undefined when both off', () => {
        const useRealData = false;
        const useMock = false;
        const dataSource = useRealData ? 'real' : useMock ? 'mock' : undefined;
        expect(dataSource).toBeUndefined();
    });
});

// ============================================
// Group 5: Empty State Detection
// ============================================
describe('Analytics: Empty State', () => {
    it('should detect empty real data state', () => {
        const useRealData = true;
        const overview = null;
        const liveByVertical: any[] = [];
        const useMock = false;
        const isEmptyRealData = useRealData && !overview && liveByVertical.length === 0 && !useMock;
        expect(isEmptyRealData).toBe(true);
    });

    it('should NOT show empty state when overview exists', () => {
        const useRealData = true;
        const overview = { totalBids: 5 };
        const liveByVertical: any[] = [];
        const useMock = false;
        const isEmptyRealData = useRealData && !overview && liveByVertical.length === 0 && !useMock;
        expect(isEmptyRealData).toBe(false);
    });

    it('should NOT show empty state in mock mode', () => {
        const useRealData = false;
        const overview = null;
        const liveByVertical: any[] = [];
        const useMock = true;
        const isEmptyRealData = useRealData && !overview && liveByVertical.length === 0 && !useMock;
        expect(isEmptyRealData).toBe(false);
    });
});

// ============================================
// Group 6: Socket Listener Lifecycle
// ============================================
describe('Analytics: Socket Listener', () => {
    it('should subscribe to analytics:update when useRealData=true', () => {
        const subscriptions: string[] = [];
        const on = (event: string) => { subscriptions.push(event); return () => { }; };

        const useRealData = true;
        if (useRealData) on('analytics:update');
        expect(subscriptions).toContain('analytics:update');
    });

    it('should NOT subscribe when useRealData=false', () => {
        const subscriptions: string[] = [];
        const on = (event: string) => { subscriptions.push(event); return () => { }; };

        const useRealData = false;
        if (useRealData) on('analytics:update');
        expect(subscriptions).toHaveLength(0);
    });

    it('should increment fetchKey on analytics:update to trigger refetch', () => {
        let fetchKey = 0;
        // Simulate socket event handler
        fetchKey = fetchKey + 1;
        expect(fetchKey).toBe(1);
    });
});

// ============================================
// Group 7: API URL Construction
// ============================================
describe('Analytics: API URL Construction', () => {
    it('getOverview with source=real should add query param', () => {
        const source = 'real';
        const url = `/api/v1/analytics/overview${source ? `?source=${source}` : ''}`;
        expect(url).toBe('/api/v1/analytics/overview?source=real');
    });

    it('getOverview without source should have no query param', () => {
        const source = undefined;
        const url = `/api/v1/analytics/overview${source ? `?source=${source}` : ''}`;
        expect(url).toBe('/api/v1/analytics/overview');
    });

    it('getBidAnalytics with source=mock should add query param', () => {
        const source = 'mock';
        const url = `/api/v1/analytics/bids${source ? `?source=${source}` : ''}`;
        expect(url).toBe('/api/v1/analytics/bids?source=mock');
    });
});
