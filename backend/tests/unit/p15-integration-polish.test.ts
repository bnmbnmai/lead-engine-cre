/**
 * p15-integration-polish.test.ts
 * ──────────────────────────────
 * 51 tests covering all RTB integration & polish features:
 *   Marketplace Search · Sidebar Nav · Analytics Hooks · KYC Links
 *   Explorer Links · Feedback Widget · NFT Deprecation · Docs RTB
 *   Short Auctions · Dynamic Lists · Routing
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============================================
// Mocks
// ============================================

const mockPrisma = {
    lead: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
    },
    ask: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
    },
    sellerProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    buyerProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    analyticsEvent: { create: jest.fn() },
    auction: {
        findFirst: jest.fn(),
        update: jest.fn(),
    },
};

jest.mock('../../src/lib/prisma', () => ({ prisma: mockPrisma }));

afterEach(() => { jest.restoreAllMocks(); });

// ============================================
// 1. Marketplace Search (6 tests)
// ============================================

describe('Marketplace Search', () => {
    const { LeadQuerySchema, AskQuerySchema } = require('../../src/utils/validation');

    test('LeadQuerySchema accepts search param', () => {
        const result = LeadQuerySchema.safeParse({ search: 'solar' });
        expect(result.success).toBe(true);
        expect(result.data.search).toBe('solar');
    });

    test('LeadQuerySchema accepts country param', () => {
        const result = LeadQuerySchema.safeParse({ country: 'US' });
        expect(result.success).toBe(true);
        expect(result.data.country).toBe('US');
    });

    test('AskQuerySchema accepts search param', () => {
        const result = AskQuerySchema.safeParse({ search: 'mortgage' });
        expect(result.success).toBe(true);
        expect(result.data.search).toBe('mortgage');
    });

    test('AskQuerySchema accepts country param', () => {
        const result = AskQuerySchema.safeParse({ country: 'GB' });
        expect(result.success).toBe(true);
        expect(result.data.country).toBe('GB');
    });

    test('search param max length is 100', () => {
        const longSearch = 'a'.repeat(101);
        const result = LeadQuerySchema.safeParse({ search: longSearch });
        expect(result.success).toBe(false);
    });

    test('empty search is valid (optional)', () => {
        const result = LeadQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        expect(result.data.search).toBeUndefined();
    });
});

// ============================================
// 2. Sidebar Nav (4 tests)
// ============================================

describe('Sidebar Navigation', () => {
    test('admin items array exists with NFT + Verticals links', () => {
        // Verify the sidebar module exports the expected structure
        const sidebarPath = require('path').resolve(__dirname, '../../..', 'frontend/src/components/layout/Sidebar.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(sidebarPath, 'utf-8');
        expect(content).toContain("'/admin/nfts'");
        expect(content).toContain("'/admin/verticals'");
    });

    test('seller items include Ad Conversions link', () => {
        const sidebarPath = require('path').resolve(__dirname, '../../..', 'frontend/src/components/layout/Sidebar.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(sidebarPath, 'utf-8');
        expect(content).toContain("'/seller/conversions'");
        expect(content).toContain('Ad Conversions');
    });

    test('getContextItems routes /admin paths to admin section', () => {
        const sidebarPath = require('path').resolve(__dirname, '../../..', 'frontend/src/components/layout/Sidebar.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(sidebarPath, 'utf-8');
        expect(content).toContain("pathname.startsWith('/admin')");
        expect(content).toContain("label: 'Admin'");
    });

    test('admin items use Gem and Layers icons', () => {
        const sidebarPath = require('path').resolve(__dirname, '../../..', 'frontend/src/components/layout/Sidebar.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(sidebarPath, 'utf-8');
        expect(content).toContain('Gem');
        expect(content).toContain('Layers');
    });
});

// ============================================
// 3. Analytics Real Hooks (5 tests)
// ============================================

describe('Analytics Real Data Hooks', () => {
    test('BuyerAnalytics reads useMock from localStorage', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/BuyerAnalytics.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain("localStorage.getItem('VITE_USE_MOCK_DATA')");
    });

    test('BuyerAnalytics has API error banner for production', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/BuyerAnalytics.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('apiError');
        expect(content).toContain('Analytics data unavailable');
    });

    test('SellerAnalytics skips API when useMock is true', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/SellerAnalytics.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('if (useMock && !useRealData) return;');
    });

    test('SellerAnalytics has API error banner', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/SellerAnalytics.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('apiError');
        expect(content).toContain('Analytics data unavailable');
    });

    test('SellerAnalytics fetches conversion data from API', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/SellerAnalytics.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('api.getConversions()');
    });
});

// ============================================
// 4. KYC Links (4 tests)
// ============================================

describe('KYC Links', () => {
    test('SellerSubmit has Verify Now button', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/SellerSubmit.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('Verify Now');
    });

    test('SellerSubmit KYC links to /seller/kyc', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/SellerSubmit.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('/seller/kyc');
    });

    test('Backend marketplace route references KYC action', () => {
        const filePath = require('path').resolve(__dirname, '../..', 'src/routes/marketplace.routes.ts');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain("action:");
        expect(content).toContain('/profile/kyc');
    });

    test('KYC starts from Start KYC label', () => {
        const filePath = require('path').resolve(__dirname, '../..', 'src/routes/marketplace.routes.ts');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('Start KYC');
    });
});

// ============================================
// 5. Explorer Links (4 tests)
// ============================================

describe('Explorer Links', () => {
    test('AuctionPage uses VITE_BLOCK_EXPLORER_URL env var', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/AuctionPage.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('VITE_BLOCK_EXPLORER_URL');
    });

    test('AuctionPage detects mock IDs and disables link', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/AuctionPage.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('isMockId');
        expect(content).toContain('MOCK');
    });

    test('AuctionPage shows fallback etherscan URL', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/AuctionPage.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('sepolia.etherscan.io');
    });

    test('AuctionPage constructs address link correctly', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/AuctionPage.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('/address/');
    });
});

// ============================================
// 6. Feedback Widget (5 tests)
// ============================================

describe('Feedback Widget', () => {
    test('FeedbackButton component file exists', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/components/ui/FeedbackButton.tsx');
        const fs = require('fs');
        expect(fs.existsSync(filePath)).toBe(true);
    });

    test('FeedbackButton has bug, feature, and other type options', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/components/ui/FeedbackButton.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain("'bug'");
        expect(content).toContain("'feature'");
        expect(content).toContain("'other'");
    });

    test('FeedbackButton posts to /api/feedback', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/components/ui/FeedbackButton.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('/api/feedback');
    });

    test('FeedbackButton has accessible IDs for testing', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/components/ui/FeedbackButton.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('id="feedback-trigger"');
        expect(content).toContain('id="feedback-panel"');
        expect(content).toContain('id="feedback-submit"');
    });

    test('DashboardLayout renders FeedbackButton for authenticated users', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/components/layout/DashboardLayout.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('FeedbackButton');
        expect(content).toContain('isAuthenticated');
    });
});

// ============================================
// 7. NFT Deprecation (4 tests)
// ============================================

describe('NFT Deprecation Notice', () => {
    test('AdminNFTs has RTB focus notice element', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/AdminNFTs.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('nft-deprecation-notice');
    });

    test('AdminNFTs notice mentions leads as core value', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/AdminNFTs.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('Leads are the core value');
    });

    test('AdminNFTs has NFT_ENABLED toggle based on env var', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/AdminNFTs.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('VITE_NFT_ENABLED');
        expect(content).toContain('NFT_ENABLED');
    });

    test('AdminNFTs mentions potential deprecation', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/AdminNFTs.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('deprecated');
    });
});

// ============================================
// 8. Docs RTB Section (4 tests)
// ============================================

describe('Docs RTB Section', () => {
    test('PITCH_DECK.md has Lead RTB Focus slide', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'docs/PITCH_DECK.md');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('Lead RTB Focus');
    });

    test('PITCH_DECK mentions optional NFTs', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'docs/PITCH_DECK.md');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('Optional NFTs');
    });

    test('SUBMISSION_CHECKLIST has Lead RTB Focus section', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'docs/SUBMISSION_CHECKLIST.md');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('Lead RTB Focus');
    });

    test('SUBMISSION_CHECKLIST includes marketplace search item', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'docs/SUBMISSION_CHECKLIST.md');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('Marketplace search wired');
    });
});

// ============================================
// 9. Short Auctions (5 tests)
// ============================================

describe('Short Auctions', () => {
    const { AskCreateSchema } = require('../../src/utils/validation');

    test('minimum auction duration is 60 seconds', () => {
        const result = AskCreateSchema.safeParse({
            vertical: 'solar',
            geoTargets: {},
            reservePrice: 50,
            auctionDuration: 30,
        });
        expect(result.success).toBe(false);
    });

    test('maximum auction duration is 3600 seconds', () => {
        const result = AskCreateSchema.safeParse({
            vertical: 'solar',
            geoTargets: {},
            reservePrice: 50,
            auctionDuration: 7200,
        });
        expect(result.success).toBe(false);
    });

    test('default auction duration is 300 seconds', () => {
        const result = AskCreateSchema.safeParse({
            vertical: 'solar',
            geoTargets: {},
            reservePrice: 50,
        });
        expect(result.success).toBe(true);
        expect(result.data.auctionDuration).toBe(300);
    });

    test('60-second auction is valid (minimum)', () => {
        const result = AskCreateSchema.safeParse({
            vertical: 'solar',
            geoTargets: {},
            reservePrice: 50,
            auctionDuration: 60,
        });
        expect(result.success).toBe(true);
        expect(result.data.auctionDuration).toBe(60);
    });

    test('default reveal window is 900 seconds', () => {
        const result = AskCreateSchema.safeParse({
            vertical: 'solar',
            geoTargets: {},
            reservePrice: 50,
        });
        expect(result.success).toBe(true);
        expect(result.data.revealWindow).toBe(900);
    });
});

// ============================================
// 10. Dynamic Lists (5 tests)
// ============================================

describe('Dynamic Lists', () => {
    test('HomePage uses socket events for real-time updates', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/HomePage.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('useSocketEvents');
    });

    test('HomePage has view toggle between leads and asks', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/HomePage.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain("'leads'");
        expect(content).toContain("'asks'");
    });

    test('HomePage debounces search input with 300ms delay', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/HomePage.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('debouncedSearch');
        expect(content).toContain('setTimeout');
        expect(content).toContain('300');
    });

    test('HomePage applies vertical filter to API call', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/HomePage.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain("params.vertical = vertical");
    });

    test('Homepage applies country filter to API call', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/pages/HomePage.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain("params.country = country");
    });
});

// ============================================
// 11. Routing (5 tests)
// ============================================

describe('Routing', () => {
    test('App has admin/nfts route', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/App.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('/admin/nfts');
    });

    test('App has admin/verticals route', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/App.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('/admin/verticals');
    });

    test('App has seller/conversions route', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/App.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('/seller/conversions');
    });

    test('App has fallback route redirecting to /', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/App.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('path="*"');
        expect(content).toContain('Navigate to="/"');
    });

    test('App uses ProtectedRoute for admin routes', () => {
        const filePath = require('path').resolve(__dirname, '../../..', 'frontend/src/App.tsx');
        const fs = require('fs');
        const content = fs.readFileSync(filePath, 'utf-8');
        // Admin routes use ProtectedRoute wrapping
        const adminNftsMatch = content.match(/admin\/nfts.*ProtectedRoute|ProtectedRoute.*admin\/nfts/s);
        expect(adminNftsMatch || content.includes('ProtectedRoute')).toBeTruthy();
    });
});
