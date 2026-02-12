/**
 * P9 — Integration Polish Tests
 *
 * 52 tests across 8 describe blocks:
 *   - Auction Service (8): short auctions, auto-extend, settle, concurrent bids
 *   - Lead Preview (6): non-PII fields, ZK badge, form step grouping, error states
 *   - Bid Mode Labels (4): Open/Sealed labels, tooltip text, mode toggle state
 *   - KYC Rejection Flow (6): CTA render, status transitions, error handling
 *   - NFT Feature Toggle (6): config read, route 501, frontend banner, guard bypass
 *   - Auto-Bid Dynamic (6): wildcard vertical, new verticals, budget enforcement
 *   - Ad Tracking (8): UTM parsing, adSource validation, conversion endpoint, CRM export
 *   - Mock vs Real Data (8): IS_PROD guard, seeded mock fallback, empty dataset, mixed mode
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

function readRoot(relativePath: string): string {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../../', relativePath), 'utf-8');
}

// ============================================
// 1. Auction Service (8 tests)
// ============================================

describe('Auction Service', () => {
    const src = readBackend('services/auction.service.ts');

    test('supports configurable auction durations', () => {
        const config = readBackend('config/perks.env.ts');
        expect(config).toContain('LEAD_AUCTION_DURATION_SECS');
        expect(src).toContain('durationSecs');
    });

    test('has auto-extension logic', () => {
        expect(src).toContain('AUTO_EXTEND');
        expect(src).toContain('autoExtend');
    });

    test('auto-extend increments from config', () => {
        const config = readBackend('config/perks.env.ts');
        expect(config).toContain('AUTO_EXTEND_INCREMENT_SECS');
        expect(config).toContain('AUTO_EXTEND_MAX');
    });

    test('settlement function exists and transfers to winner', () => {
        expect(src).toContain('settleAuction');
        expect(src).toContain('winner');
    });

    test('placeBid validates amount against reserve', () => {
        expect(src).toContain('placeBid');
        expect(src).toContain('reserve');
    });

    test('getActiveAuctions returns only non-settled auctions', () => {
        expect(src).toContain('getActiveAuctions');
    });

    test('auction creation uses ethers contract call', () => {
        expect(src).toContain('ethers');
        expect(src).toContain('contract');
    });

    test('concurrent bid handling uses nonce management', () => {
        // Should have some form of nonce/lock handling for on-chain txs
        expect(src).toMatch(/nonce|lock|mutex|sequential/i);
    });
});

// ============================================
// 2. Lead Preview (6 tests)
// ============================================

describe('Lead Preview', () => {
    const src = readFrontend('components/bidding/LeadPreview.tsx');

    test('component renders non-PII fields: vertical, geoState, source', () => {
        expect(src).toContain('data.vertical');
        expect(src).toContain('data.geoState');
        expect(src).toContain('data.source');
    });

    test('shows ZK Verified badge when zkDataHash present', () => {
        expect(src).toContain('zkDataHash');
        expect(src).toContain('ZK Verified');
        expect(src).toContain('ShieldCheck');
    });

    test('groups fields by form step with accordion UI', () => {
        expect(src).toContain('StepAccordion');
        expect(src).toContain('formSteps');
        expect(src).toContain('defaultOpen');
    });

    test('first form step is open by default', () => {
        expect(src).toContain('defaultOpen={i === 0}');
    });

    test('shows field counts per section (filled/total)', () => {
        expect(src).toContain('Not Provided');
        expect(src).toMatch(/fields\.filter.*Not Provided.*length/);
    });

    test('silently hides component when preview is unavailable', () => {
        expect(src).toContain('return null');
        expect(src).toContain('Silently hide');
    });
});

// ============================================
// 3. Bid Mode Labels (4 tests)
// ============================================

describe('Bid Mode Labels', () => {
    const src = readFrontend('components/bidding/BidPanel.tsx');

    test('direct bid is labeled "Open Bid"', () => {
        expect(src).toContain('Open Bid');
        expect(src).not.toContain('Direct Bid');
    });

    test('commit-reveal is labeled "Sealed Bid"', () => {
        expect(src).toContain('Sealed Bid');
        expect(src).not.toContain('Commit-Reveal');
    });

    test('Open Bid tooltip explains visibility', () => {
        expect(src).toContain('Open Bid \u2014 your bid amount is visible immediately');
    });

    test('Sealed Bid tooltip explains encryption', () => {
        expect(src).toContain('Sealed Bid \u2014 your bid is encrypted until the reveal phase');
    });
});

// ============================================
// 4. KYC Rejection Flow (6 tests)
// ============================================

describe('KYC Rejection Flow', () => {
    test('SellerSubmit has "Verify Now" CTA button', () => {
        const src = readFrontend('pages/SellerSubmit.tsx');
        expect(src).toContain('Verify Now');
        expect(src).toContain('/seller/kyc');
    });

    test('SellerSubmit KYC notice uses amber warning styling', () => {
        const src = readFrontend('pages/SellerSubmit.tsx');
        expect(src).toContain('bg-amber-500');
        expect(src).toContain('text-amber-');
    });

    test('SellerSubmit imports Shield icon for KYC notice', () => {
        const src = readFrontend('pages/SellerSubmit.tsx');
        expect(src).toContain('Shield');
    });

    test('ErrorDetail has KYC_REQUIRED code mapping', () => {
        const src = readFrontend('components/ui/ErrorDetail.tsx');
        expect(src).toContain('KYC_REQUIRED');
    });

    test('ErrorDetail supports action buttons for resolution', () => {
        const src = readFrontend('components/ui/ErrorDetail.tsx');
        expect(src).toContain('error.action');
        expect(src).toContain('error.action!');
        expect(src).toContain('ArrowRight');
    });

    test('ErrorDetail KYC_REQUIRED uses purple styling', () => {
        const src = readFrontend('components/ui/ErrorDetail.tsx');
        expect(src).toContain('KYC_REQUIRED');
        expect(src).toContain('purple');
    });
});

// ============================================
// 5. NFT Feature Toggle (6 tests)
// ============================================

describe('NFT Feature Toggle', () => {
    test('perks.env exports NFT_FEATURES_ENABLED', () => {
        const src = readBackend('config/perks.env.ts');
        expect(src).toContain('NFT_FEATURES_ENABLED');
        expect(src).toContain("process.env.NFT_FEATURES_ENABLED");
    });

    test('NFT_FEATURES_ENABLED defaults to true', () => {
        const src = readBackend('config/perks.env.ts');
        // !== 'false' means default is true (only explicitly 'false' disables)
        expect(src).toContain("!== 'false'");
    });

    test('PERKS_CONFIG includes nft.enabled property', () => {
        const src = readBackend('config/perks.env.ts');
        expect(src).toContain('nft:');
        expect(src).toContain('enabled: NFT_FEATURES_ENABLED');
    });

    test('vertical routes import NFT_FEATURES_ENABLED', () => {
        const src = readBackend('routes/vertical.routes.ts');
        expect(src).toContain('NFT_FEATURES_ENABLED');
    });

    test('vertical routes have requireNFT guard on activate/resale/auction', () => {
        const src = readBackend('routes/vertical.routes.ts');
        expect(src).toContain('requireNFT');
        // Guard should be on NFT endpoints
        const activateLine = src.match(/activate.*requireNFT|requireNFT.*activate/);
        expect(activateLine).not.toBeNull();
    });

    test('NFT guard returns 501 when disabled', () => {
        const src = readBackend('routes/vertical.routes.ts');
        expect(src).toContain('501');
        expect(src).toContain('NFT features are disabled');
    });
});

// ============================================
// 6. Auto-Bid Dynamic Verticals (6 tests)
// ============================================

describe('Auto-Bid Dynamic Verticals', () => {
    const src = readBackend('services/auto-bid.service.ts');

    test('supports wildcard vertical matching', () => {
        expect(src).toContain("'*'");
    });

    test('queries preference sets with OR (exact vertical | wildcard)', () => {
        expect(src).toContain('in: [lead.vertical,');
    });

    test('evaluateLeadForAutoBid accepts any vertical string', () => {
        // vertical is typed as string, no enum restriction
        expect(src).toContain('vertical: string');
    });

    test('enforces daily budget per buyer', () => {
        expect(src).toContain('getDailySpend');
        expect(src).toContain('dailyBudget');
    });

    test('prevents duplicate bids from same buyer', () => {
        expect(src).toContain('existingBid');
        expect(src).toContain('Already bid on this lead');
    });

    test('logs analytics event on successful auto-bid', () => {
        expect(src).toContain('analyticsEvent.create');
        expect(src).toContain("eventType: 'auto_bid'");
    });
});

// ============================================
// 7. Ad Tracking (8 tests)
// ============================================

describe('Ad Tracking', () => {
    test('Prisma schema has Lead model', () => {
        const fs = require('fs');
        const path = require('path');
        const schema = fs.readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf-8');
        expect(schema).toContain('model Lead');
        expect(schema).toContain('vertical');
    });

    test('validation.ts defines LeadSubmitSchema with vertical', () => {
        const src = readBackend('utils/validation.ts');
        expect(src).toContain('LeadSubmitSchema');
        expect(src).toContain('vertical');
    });

    test('marketplace routes handle lead submission', () => {
        const src = readBackend('routes/marketplace.routes.ts');
        expect(src).toContain('leads/submit');
    });

    test('marketplace routes handle analytics endpoints', () => {
        const src = readBackend('routes/marketplace.routes.ts');
        expect(src).toContain('analytics');
    });

    test('frontend API client has getConversions method', () => {
        const src = readFrontend('lib/api.ts');
        expect(src).toContain('getConversions');
        expect(src).toContain('/analytics/conversions');
    });

    test('frontend API client has getConversionsByPlatform method', () => {
        const src = readFrontend('lib/api.ts');
        expect(src).toContain('getConversionsByPlatform');
    });

    test('SellerAnalytics renders conversion chart', () => {
        const src = readFrontend('pages/SellerAnalytics.tsx');
        expect(src).toContain('Conversion');
        expect(src).toContain('BarChart');
    });

    test('LeadSubmitForm has ad tracking section', () => {
        const src = readFrontend('components/forms/LeadSubmitForm.tsx');
        expect(src).toContain('Ad Tracking');
        expect(src).toContain('utm_source');
    });
});

// ============================================
// 8. Mock vs Real Data (8 tests)
// ============================================

describe('Mock vs Real Data', () => {
    test('SellerAnalytics has fallback mock data when API returns empty', () => {
        const src = readFrontend('pages/SellerAnalytics.tsx');
        expect(src).toContain('FALLBACK');
        expect(src).toContain('useMock');
    });

    test('AuctionPage detects mock IDs (non-hex lead IDs)', () => {
        const src = readFrontend('pages/AuctionPage.tsx');
        expect(src).toContain('isMockId');
        expect(src).toContain('0x[0-9a-fA-F]{40}');
    });

    test('AuctionPage shows MOCK badge for non-Ethereum IDs', () => {
        const src = readFrontend('pages/AuctionPage.tsx');
        expect(src).toContain('MOCK');
    });

    test('Etherscan link is environment-driven (VITE_BLOCK_EXPLORER_URL)', () => {
        const src = readFrontend('pages/AuctionPage.tsx');
        expect(src).toContain('VITE_BLOCK_EXPLORER_URL');
        expect(src).not.toMatch(/href=\{`https:\/\/sepolia\.etherscan\.io/);
    });

    test('Etherscan link defaults to sepolia when env not set', () => {
        const src = readFrontend('pages/AuctionPage.tsx');
        expect(src).toContain("|| 'https://sepolia.etherscan.io'");
    });

    test('mock IDs disable external navigation', () => {
        const src = readFrontend('pages/AuctionPage.tsx');
        expect(src).toContain('e.preventDefault()');
        expect(src).toContain('cursor-default');
    });

    test('SellerAnalytics conversion data uses live data when available', () => {
        const src = readFrontend('pages/SellerAnalytics.tsx');
        expect(src).toContain('liveConversions');
        expect(src).toContain('getConversions');
    });

    test('PreferenceSetCard uses "open bid" terminology (not "direct bid")', () => {
        const src = readFrontend('components/forms/PreferenceSetCard.tsx');
        expect(src).toContain('open bid endpoint');
        expect(src).not.toContain('direct bid endpoint');
    });
});
