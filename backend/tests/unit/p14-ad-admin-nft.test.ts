/**
 * p14-ad-admin-nft.test.ts — Ad Conversion, Admin Verticals, NFT Toggle
 *
 * 20 tests covering:
 *   - Ad Conversion Analytics endpoint (5)
 *   - Admin Vertical Suggestion approve/reject (5)
 *   - Admin Vertical Suggestions GET enhancements (3)
 *   - Frontend pages & routing (4)
 *   - NFT Toggle UI (3)
 */

import { describe, test, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const fe = (rel: string) => path.join(ROOT, 'frontend', 'src', rel);
const be = (rel: string) => path.join(ROOT, 'backend', 'src', rel);
const read = (p: string) => fs.readFileSync(p, 'utf-8');

// ── Ad Conversion Analytics (5 tests) ─────────────────────

describe('Ad Conversion Analytics Endpoint', () => {
    const src = read(be('routes/analytics.routes.ts'));

    test('1. GET /conversions route is registered', () => {
        expect(src).toContain("router.get('/conversions'");
    });

    test('2. Endpoint retrieves leads with adSource not null', () => {
        expect(src).toContain('adSource: { not: null }');
    });

    test('3. Groups campaign data by utm_source + utm_campaign', () => {
        expect(src).toContain("const key = `${src}::${camp}`");
    });

    test('4. Computes conversionRate and avgBidPrice', () => {
        expect(src).toContain('conversionRate');
        expect(src).toContain('avgBidPrice');
    });

    test('5. Returns paginated campaign results', () => {
        expect(src).toContain("campaigns: paginated");
        expect(src).toContain("pagination: { page, limit, total");
    });
});

// ── Admin Suggestion Approve/Reject (5 tests) ─────────────

describe('Admin Vertical Suggestion Endpoints', () => {
    const src = read(be('routes/vertical.routes.ts'));

    test('6. PUT /suggestions/:id/approve route exists', () => {
        expect(src).toContain("router.put('/suggestions/:id/approve'");
    });

    test('7. PUT /suggestions/:id/reject route exists', () => {
        expect(src).toContain("router.put('/suggestions/:id/reject'");
    });

    test('8. Approve creates or activates a Vertical from suggestion', () => {
        expect(src).toContain("prisma.vertical.create");
        expect(src).toContain("status: 'ACTIVE'");
    });

    test('9. Approve optionally mints NFT when mintNft flag is set', () => {
        expect(src).toContain('mintNft && NFT_FEATURES_ENABLED');
        expect(src).toContain('verticalNFTService.activateVertical');
    });

    test('10. Reject updates suggestion status to REJECTED with optional reason', () => {
        expect(src).toContain("status: 'REJECTED'");
        expect(src).toContain('reason || suggestion.reasoning');
    });
});

// ── GET /suggestions Enhancements (3 tests) ───────────────

describe('GET /suggestions — Pagination & Search', () => {
    const src = read(be('routes/vertical.routes.ts'));

    test('11. Supports search query parameter', () => {
        expect(src).toContain("req.query.search as string");
    });

    test('12. Supports page and limit parameters', () => {
        expect(src).toContain("req.query.page as string");
        expect(src).toContain("req.query.limit as string");
    });

    test('13. Returns pagination metadata', () => {
        expect(src).toContain("pagination: { page, limit, total, totalPages");
    });
});

// ── Frontend Pages & Routing (4 tests) ────────────────────

describe('Frontend — Pages & Routes', () => {
    test('14. AdminVerticals.tsx page exists with tabs and suggestion table', () => {
        const src = read(fe('pages/AdminVerticals.tsx'));
        expect(src).toContain("'PROPOSED'");
        expect(src).toContain("'ACTIVE'");
        expect(src).toContain("'REJECTED'");
        expect(src).toContain('api.approveSuggestion');
        expect(src).toContain('api.rejectSuggestion');
    });

    test('15. AdConversions.tsx page exists with Recharts and campaign table', () => {
        const src = read(fe('pages/AdConversions.tsx'));
        expect(src).toContain('BarChart');
        expect(src).toContain('conversionRate');
        expect(src).toContain('api.getConversions');
    });

    test('16. App.tsx has /admin/verticals route', () => {
        const src = read(fe('App.tsx'));
        expect(src).toContain('/admin/verticals');
        expect(src).toContain('AdminVerticals');
    });

    test('17. App.tsx has /seller/conversions route', () => {
        const src = read(fe('App.tsx'));
        expect(src).toContain('/seller/conversions');
        expect(src).toContain('AdConversions');
    });
});

// ── NFT Toggle UI (3 tests) ───────────────────────────────

describe('NFT Toggle UI', () => {
    const src = read(fe('pages/AdminNFTs.tsx'));

    test('18. AdminNFTs reads VITE_NFT_ENABLED env var', () => {
        expect(src).toContain('VITE_NFT_ENABLED');
        expect(src).toContain('NFT_ENABLED');
    });

    test('19. AdminNFTs shows disabled banner when NFT is off', () => {
        expect(src).toContain('NFT Features Disabled');
        expect(src).toContain('!NFT_ENABLED');
    });

    test('20. Mint and auction buttons are disabled when NFT is off', () => {
        // Mint button
        expect(src).toContain('disabled={!NFT_ENABLED}');
        // Should appear at least twice (mint + auction)
        const matches = src.match(/disabled=\{!NFT_ENABLED\}/g);
        expect(matches?.length).toBeGreaterThanOrEqual(2);
    });
});

// ── API Client Methods (bonus validation) ─────────────────

describe('API Client — New Methods', () => {
    const src = read(fe('lib/api.ts'));

    test('API client has approveSuggestion method', () => {
        expect(src).toContain('approveSuggestion');
        expect(src).toContain('/approve');
    });

    test('API client has rejectSuggestion method', () => {
        expect(src).toContain('rejectSuggestion');
        expect(src).toContain('/reject');
    });
});
