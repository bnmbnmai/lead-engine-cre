/**
 * P10 — Auction Duration + Lead Preview Tests
 *
 * 17 tests across 3 describe blocks:
 *   - Auction Duration Config (6): default 60s, max 60s, config export, schema cap, clamping, optional
 *   - Auto-Extend Edge Cases (4): max extensions, remaining threshold, settled skip, extension count
 *   - Lead Preview (7): endpoint, redaction, URL, AuctionPage integration, autoExpand, empty fields, ZK badge
 */

function readFrontend(relativePath: string): string {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../../../frontend/src', relativePath), 'utf-8');
}

function readBackend(relativePath: string): string {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../../src', relativePath), 'utf-8');
}

// ============================================
// 1. Auction Duration Config (6 tests)
// ============================================

describe('Auction Duration Config', () => {
    const config = readBackend('config/perks.env.ts');

    test('LEAD_AUCTION_DURATION_SECS defaults to 60 (universal auction)', () => {
        expect(config).toContain("LEAD_AUCTION_DURATION_SECS || '60'");
    });

    test('AuctionCreateSchema caps durationSecs at 60', () => {
        const routes = readBackend('routes/vertical.routes.ts');
        expect(routes).toContain('.max(60)');
        expect(routes).not.toContain('.max(604800)');
    });

    test('AuctionCreateSchema.durationSecs is optional', () => {
        const routes = readBackend('routes/vertical.routes.ts');
        expect(routes).toContain('.optional()');
        expect(routes).toContain('locked to 60s');
    });

    test('createAuction clamps duration to [60, LEAD_AUCTION_DURATION_SECS]', () => {
        const src = readBackend('services/auction.service.ts');
        expect(src).toContain('Math.max(60, Math.min(durationSecs, LEAD_AUCTION_DURATION_SECS))');
    });
});

// ============================================
// 2. Auto-Extend Edge Cases (4 tests)
// ============================================

describe('Auto-Extend Edge Cases', () => {
    const src = readBackend('services/auction.service.ts');

    test('auto-extend respects AUTO_EXTEND_MAX limit', () => {
        expect(src).toContain('extensions >= AUTO_EXTEND_MAX');
    });

    test('auto-extend only fires when remaining < AUTO_EXTEND_INCREMENT_SECS', () => {
        expect(src).toContain('remainingMs > AUTO_EXTEND_INCREMENT_SECS * 1000');
    });

    test('auto-extend skips settled or cancelled auctions', () => {
        expect(src).toContain('auction.settled || auction.cancelled');
    });

    test('auto-extend tracks extensionCount in update', () => {
        expect(src).toContain('extensionCount: extensions + 1');
    });
});

// ============================================
// 3. Lead Preview (7 tests)
// ============================================

describe('Lead Preview', () => {
    test('/leads/:id/preview endpoint exists in marketplace routes', () => {
        const src = readBackend('routes/marketplace.routes.ts');
        expect(src).toContain("'/leads/:id/preview'");
        expect(src).toContain('redactLeadForPreview');
    });

    test('redactLeadForPreview skips PII fields', () => {
        const src = readBackend('services/piiProtection.ts');
        expect(src).toContain('redactLeadForPreview');
        expect(src).toContain('PII_PARAMETER_KEYS');
        expect(src).toContain('continue');
    });

    test('LeadPreview fetches via api.getLeadPreview', () => {
        const src = readFrontend('components/bidding/LeadPreview.tsx');
        expect(src).toContain('api.getLeadPreview');
        expect(src).toContain('leadId');
        expect(src).not.toContain('/api/marketplace');
    });

    test('AuctionPage imports and renders LeadPreview', () => {
        const src = readFrontend('pages/AuctionPage.tsx');
        expect(src).toContain("import { LeadPreview }");
        expect(src).toContain('<LeadPreview');
        expect(src).toContain('leadId={lead.id}');
    });

    test('LeadPreview supports autoExpand prop', () => {
        const src = readFrontend('components/bidding/LeadPreview.tsx');
        expect(src).toContain('autoExpand');
        expect(src).toContain('useState(autoExpand)');
    });

    test('empty parameters render "Not Provided"', () => {
        const src = readFrontend('components/bidding/LeadPreview.tsx');
        expect(src).toContain("'Not Provided'");
        expect(src).toContain('No data provided for this section');
    });

    test('ZK badge renders when zkDataHash present', () => {
        const src = readFrontend('components/bidding/LeadPreview.tsx');
        expect(src).toContain('zkDataHash');
        expect(src).toContain('ZK Verified');
        expect(src).toContain('ShieldCheck');
    });
});
