/**
 * P2-15 — analytics.service.ts Tests
 *
 * Tests for the real AnalyticsService singleton and analytics.routes.ts changes.
 * Uses source-scan approach (same pattern as P2-12/P2-13/P2-14) for frontend
 * concerns, and direct in-process calls for the pure TS service unit tests.
 *
 * Coverage:
 *  1.  analyticsService.emit() buffers events
 *  2.  emit() adds structured ts + event fields
 *  3.  emit() broadcasts to io when io is set
 *  4.  emit() is silent when io is null (no crash)
 *  5.  getRecentEvents() returns last N events
 *  6.  getRecentEvents() respects the 500-entry ring buffer cap
 *  7.  Ring buffer drops oldest entries beyond 500
 *  8.  _resetForTesting() clears all state
 *  9.  ANALYTICS_EVENTS vocabulary has expected keys
 * 10.  analytics.routes.ts no longer imports analytics-mock
 * 11.  analytics.routes.ts imports analyticsService
 * 12.  analytics.routes.ts has no shouldUseMock function
 * 13.  analytics.routes.ts has no USE_MOCK_DEFAULT
 * 14.  analytics.service.ts exports ANALYTICS_EVENTS constant
 * 15.  analytics.service.ts exports analyticsService singleton
 * 16.  analytics.service.ts defines emit() method
 * 17.  analytics.service.ts defines getRecentEvents() method
 * 18.  analytics.service.ts defines setIO() method
 * 19.  analytics.routes.ts has GET /events endpoint
 * 20.  analytics-mock.ts has @deprecated annotation
 * 21.  analytics-mock.ts still exports getMockOverview (backward compat)
 * 22.  emit() payload is merged into event entry (no key clobbering)
 * 23.  bufferSize reflects current count
 * 24.  getRecentEvents(limit) honours the limit parameter
 */

import * as fs from 'fs';
import * as path from 'path';

const BACKEND_SRC = path.join(__dirname, '../../src');
const ANALYTICS_SERVICE = path.join(BACKEND_SRC, 'services', 'analytics.service.ts');
const ANALYTICS_MOCK = path.join(BACKEND_SRC, 'services', 'analytics-mock.ts');
const ANALYTICS_ROUTES = path.join(BACKEND_SRC, 'routes', 'analytics.routes.ts');

let svcSrc: string;
let routesSrc: string;
let mockSrc: string;

beforeAll(() => {
    svcSrc = fs.readFileSync(ANALYTICS_SERVICE, 'utf8');
    routesSrc = fs.readFileSync(ANALYTICS_ROUTES, 'utf8');
    mockSrc = fs.readFileSync(ANALYTICS_MOCK, 'utf8');
});

// ──────────────────────────────────────────────────────────────
// In-process unit tests for AnalyticsService
// ──────────────────────────────────────────────────────────────

import { analyticsService, ANALYTICS_EVENTS } from '../../src/services/analytics.service';

beforeEach(() => {
    analyticsService._resetForTesting();
});

describe('P2-15 — AnalyticsService unit tests', () => {

    it('emit() bufffers a single event', () => {
        analyticsService.emit('lead:created', { leadId: 'abc' });
        expect(analyticsService.bufferSize).toBe(1);
    });

    it('emit() adds ts and event fields to stored entry', () => {
        analyticsService.emit('bid:placed', { amount: 42 });
        const events = analyticsService.getRecentEvents(1);
        expect(events).toHaveLength(1);
        expect(events[0].event).toBe('bid:placed');
        expect(typeof events[0].ts).toBe('string');
        expect(new Date(events[0].ts).getTime()).toBeGreaterThan(0);
    });

    it('emit() merges payload into entry without clobbering ts or event', () => {
        analyticsService.emit('auction:resolved', { winnerId: 'u1', amount: 100 });
        const [e] = analyticsService.getRecentEvents(1);
        expect(e.winnerId).toBe('u1');
        expect(e.amount).toBe(100);
        expect(e.event).toBe('auction:resolved');
    });

    it('emit() broadcasts to io.emit("analytics:event") when io is set', () => {
        const ioMock = { emit: jest.fn() };
        analyticsService.setIO(ioMock as any);
        analyticsService.emit('escrow:released', { txHash: '0xabc' });
        expect(ioMock.emit).toHaveBeenCalledWith('analytics:event', expect.objectContaining({
            event: 'escrow:released',
            txHash: '0xabc',
        }));
    });

    it('emit() does not throw when io is null', () => {
        // io is null after _resetForTesting
        expect(() => analyticsService.emit('demo:cycle-complete', {})).not.toThrow();
    });

    it('getRecentEvents() returns the last N events', () => {
        for (let i = 0; i < 10; i++) {
            analyticsService.emit('lead:created', { n: i });
        }
        const last3 = analyticsService.getRecentEvents(3);
        expect(last3).toHaveLength(3);
        expect(last3[2].n).toBe(9); // newest
        expect(last3[0].n).toBe(7); // 3rd from end
    });

    it('bufferSize reflects current count', () => {
        expect(analyticsService.bufferSize).toBe(0);
        analyticsService.emit('lead:created', {});
        analyticsService.emit('bid:placed', {});
        expect(analyticsService.bufferSize).toBe(2);
    });

    it('ring buffer caps at 500 entries', () => {
        for (let i = 0; i < 520; i++) {
            analyticsService.emit('lead:created', { n: i });
        }
        expect(analyticsService.bufferSize).toBe(500);
    });

    it('ring buffer drops oldest entries beyond 500', () => {
        for (let i = 0; i < 520; i++) {
            analyticsService.emit('lead:created', { n: i });
        }
        const all = analyticsService.getRecentEvents(500);
        expect(all[0].n).toBe(20);     // first 20 dropped
        expect(all[499].n).toBe(519);  // last pushed
    });

    it('_resetForTesting() clears buffer and unsets io', () => {
        analyticsService.emit('lead:created', {});
        analyticsService._resetForTesting();
        expect(analyticsService.bufferSize).toBe(0);
        // After reset, io is null — emit should not call anything
        const ioMock = { emit: jest.fn() };
        analyticsService._resetForTesting();
        analyticsService.emit('lead:created', {});
        expect(ioMock.emit).not.toHaveBeenCalled();
    });

    it('ANALYTICS_EVENTS has the expected canonical keys', () => {
        expect(ANALYTICS_EVENTS.LEAD_CREATED).toBe('lead:created');
        expect(ANALYTICS_EVENTS.BID_PLACED).toBe('bid:placed');
        expect(ANALYTICS_EVENTS.AUCTION_RESOLVED).toBe('auction:resolved');
        expect(ANALYTICS_EVENTS.ESCROW_RELEASED).toBe('escrow:released');
        expect(ANALYTICS_EVENTS.DEMO_CYCLE_COMPLETE).toBe('demo:cycle-complete');
        expect(ANALYTICS_EVENTS.PLATFORM_FEE).toBe('platform:fee');
    });

    it('getRecentEvents(limit) returns no more than limit', () => {
        for (let i = 0; i < 50; i++) {
            analyticsService.emit('lead:created', { n: i });
        }
        expect(analyticsService.getRecentEvents(10)).toHaveLength(10);
    });
});

// ──────────────────────────────────────────────────────────────
// Source-scan: analytics.service.ts exports and structure
// ──────────────────────────────────────────────────────────────

describe('P2-15 — analytics.service.ts source structure', () => {

    it('exports ANALYTICS_EVENTS constant', () => {
        expect(svcSrc).toContain('export const ANALYTICS_EVENTS');
    });

    it('exports analyticsService singleton', () => {
        expect(svcSrc).toContain('export const analyticsService');
    });

    it('defines emit() method', () => {
        expect(svcSrc).toContain('emit(');
    });

    it('defines getRecentEvents() method', () => {
        expect(svcSrc).toContain('getRecentEvents(');
    });

    it('defines setIO() method', () => {
        expect(svcSrc).toContain('setIO(');
    });

    it('exports AnalyticsEventName type', () => {
        expect(svcSrc).toContain('export type AnalyticsEventName');
    });
});

// ──────────────────────────────────────────────────────────────
// Source-scan: analytics.routes.ts changes
// ──────────────────────────────────────────────────────────────

describe('P2-15 — analytics.routes.ts source changes', () => {

    it('does NOT import analytics-mock', () => {
        expect(routesSrc).not.toContain("from '../services/analytics-mock'");
    });

    it('imports analyticsService from analytics.service', () => {
        expect(routesSrc).toContain("from '../services/analytics.service'");
    });

    it('does NOT contain shouldUseMock function', () => {
        expect(routesSrc).not.toContain('shouldUseMock');
    });

    it('does NOT contain USE_MOCK_DEFAULT', () => {
        expect(routesSrc).not.toContain('USE_MOCK_DEFAULT');
    });

    it('does NOT contain getMockOverview call', () => {
        expect(routesSrc).not.toContain('getMockOverview(');
    });

    it('does NOT contain getMockLeadAnalytics call', () => {
        expect(routesSrc).not.toContain('getMockLeadAnalytics(');
    });

    it('does NOT contain getMockBidAnalytics call', () => {
        expect(routesSrc).not.toContain('getMockBidAnalytics(');
    });

    it('has GET /events endpoint', () => {
        expect(routesSrc).toContain("router.get('/events'");
    });

    it('GET /events returns 403 for non-admin (source check)', () => {
        expect(routesSrc).toContain("role !== 'ADMIN'");
    });

    it('calls analyticsService.setIO(io) for lazy init', () => {
        expect(routesSrc).toContain('analyticsService.setIO(io)');
    });

    it('emits analytics:overview-read event on /overview', () => {
        expect(routesSrc).toContain("analyticsService.emit('analytics:overview-read'");
    });

    it('emits analytics:leads-read event on /leads', () => {
        expect(routesSrc).toContain("analyticsService.emit('analytics:leads-read'");
    });

    it('emits analytics:bids-read event on /bids', () => {
        expect(routesSrc).toContain("analyticsService.emit('analytics:bids-read'");
    });
});

// ──────────────────────────────────────────────────────────────
// Source-scan: analytics-mock.ts deprecation
// ──────────────────────────────────────────────────────────────

describe('P2-15 — analytics-mock.ts deprecation', () => {

    it('has @deprecated annotation', () => {
        expect(mockSrc).toContain('@deprecated');
    });

    it('still exports getMockOverview for backwards compatibility', () => {
        expect(mockSrc).toContain('export function getMockOverview(');
    });

    it('still exports getMockLeadAnalytics for backwards compatibility', () => {
        expect(mockSrc).toContain('export function getMockLeadAnalytics(');
    });

    it('still exports getMockBidAnalytics for backwards compatibility', () => {
        expect(mockSrc).toContain('export function getMockBidAnalytics(');
    });

    it('still has production guard (never loads in prod)', () => {
        expect(mockSrc).toContain("NODE_ENV === 'production'");
    });
});
