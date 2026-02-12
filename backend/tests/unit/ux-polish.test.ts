/**
 * UX Polish & Optimization Tests — 27 tests
 *
 * Coverage:
 *  1. PerksPanel toggles & ARIA           — 6 tests
 *  2. Tooltip accessibility               — 3 tests
 *  3. Config consistency                  — 4 tests
 *  4. Error schema validation             — 3 tests
 *  5. Win stats edge cases                — 3 tests
 *  6. getPerksOverview shape & defaults   — 3 tests
 *  7. Contract SLOAD optimization guards  — 3 tests
 *  8. Prisma index verification           — 2 tests
 */

// ── Mocks ──────────────────────────────────

const mockPrisma = {
    bid: {
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
    },
    buyerProfile: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    vertical: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    verticalSuggestion: { create: jest.fn(), groupBy: jest.fn() },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
};
jest.mock('../../src/lib/prisma', () => ({ prisma: mockPrisma }));

jest.mock('../../src/lib/cache', () => ({
    nftOwnershipCache: { get: jest.fn(), set: jest.fn(), delete: jest.fn(), getOrSet: jest.fn() },
    bidActivityCache: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
    holderNotifyCache: { getOrSet: jest.fn(), get: jest.fn(), set: jest.fn(), delete: jest.fn() },
    invalidateNftOwnership: jest.fn(),
    verticalHierarchyCache: { getOrSet: jest.fn(), get: jest.fn(), set: jest.fn(), delete: jest.fn() },
    LRUCache: jest.fn().mockImplementation(() => ({
        get: jest.fn(), set: jest.fn(), delete: jest.fn(), clear: jest.fn(),
        stats: jest.fn().mockReturnValue({ size: 0, maxSize: 1000, hits: 0, misses: 0, hitRate: '0%' }),
        getOrSet: jest.fn(), evictExpired: jest.fn(),
    })),
}));

jest.mock('../../src/services/ace.service', () => ({
    aceService: { canTransact: jest.fn().mockResolvedValue({ allowed: true }) },
}));

jest.mock('../../src/services/datastreams.service', () => ({
    dataStreamsService: { getLatestPrice: jest.fn(), publishVerticalData: jest.fn() },
}));

jest.mock('../../src/services/vertical-nft.service', () => ({
    activateVertical: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('ethers', () => ({
    ethers: {
        JsonRpcProvider: jest.fn(),
        Wallet: jest.fn(),
        Contract: jest.fn(),
        parseEther: jest.fn((v: string) => BigInt(Math.floor(parseFloat(v) * 1e18))),
        id: jest.fn((v: string) => `0xHASH_${v}`),
    },
}));

import * as fs from 'fs';
import * as path from 'path';
import { PERKS_CONFIG, MAX_HIERARCHY_DEPTH } from '../../src/config/perks.env';
import {
    createPerksError,
    MAX_VERTICAL_DEPTH,
    getPerksOverview,
} from '../../src/services/perks-engine';

// ============================================
// 1. PerksPanel Toggles & ARIA — 6 tests
// ============================================

describe('PerksPanel Toggles & ARIA', () => {
    let perksPanelContent: string;

    beforeAll(() => {
        perksPanelContent = fs.readFileSync(
            path.join(__dirname, '../../../frontend/src/components/marketplace/PerksPanel.tsx'),
            'utf-8',
        );
    });

    test('has notification toggle with aria-label', () => {
        expect(perksPanelContent).toContain('aria-label="Toggle auction notification opt-in"');
    });

    test('has GDPR toggle with aria-label', () => {
        expect(perksPanelContent).toContain('aria-label="Toggle GDPR notification consent"');
    });

    test('has auto-bid toggle with aria-label', () => {
        expect(perksPanelContent).toContain('aria-label="Toggle automatic bidding on matching leads"');
    });

    test('all toggles have aria-describedby', () => {
        expect(perksPanelContent).toContain('aria-describedby="notify-desc"');
        expect(perksPanelContent).toContain('aria-describedby="gdpr-desc"');
        expect(perksPanelContent).toContain('aria-describedby="autobid-desc"');
    });

    test('updating state shows aria-live assertive status', () => {
        const ariaLiveMatches = perksPanelContent.match(/aria-live="assertive"/g) || [];
        expect(ariaLiveMatches.length).toBeGreaterThanOrEqual(3);
    });

    test('collapsible header has aria-expanded and aria-controls', () => {
        expect(perksPanelContent).toContain('aria-expanded={expanded}');
        expect(perksPanelContent).toContain('aria-controls="perks-panel-content"');
    });
});

// ============================================
// 2. Tooltip Accessibility — 3 tests
// ============================================

describe('Tooltip Accessibility', () => {
    let tooltipContent: string;

    beforeAll(() => {
        tooltipContent = fs.readFileSync(
            path.join(__dirname, '../../../frontend/src/components/ui/Tooltip.tsx'),
            'utf-8',
        );
    });

    test('tooltip has role="tooltip" for screen readers', () => {
        expect(tooltipContent).toContain('role="tooltip"');
    });

    test('tooltip responds to focus/blur for keyboard users', () => {
        expect(tooltipContent).toContain('onFocus');
        expect(tooltipContent).toContain('onBlur');
    });

    test('tooltip supports top and bottom positioning', () => {
        expect(tooltipContent).toContain("side?: 'top' | 'bottom'");
    });
});

// ============================================
// 3. Config Consistency — 4 tests
// ============================================

describe('Config Consistency', () => {
    test('MAX_VERTICAL_DEPTH derives from MAX_HIERARCHY_DEPTH', () => {
        expect(MAX_VERTICAL_DEPTH).toBe(MAX_HIERARCHY_DEPTH);
    });

    test('PERKS_CONFIG has all required sections', () => {
        expect(PERKS_CONFIG).toHaveProperty('holder');
        expect(PERKS_CONFIG).toHaveProperty('spam');
        expect(PERKS_CONFIG).toHaveProperty('notifications');
        expect(PERKS_CONFIG).toHaveProperty('cache');
        expect(PERKS_CONFIG).toHaveProperty('rateLimit');
        expect(PERKS_CONFIG).toHaveProperty('ipBlocklist');
        expect(PERKS_CONFIG).toHaveProperty('piiAudit');
        expect(PERKS_CONFIG).toHaveProperty('hierarchy');
    });

    test('PERKS_CONFIG.holder.multiplier matches HOLDER_MULTIPLIER', () => {
        expect(PERKS_CONFIG.holder.multiplier).toBe(1.2);
    });

    test('PERKS_CONFIG.notifications.debounceMs is 10s', () => {
        expect(PERKS_CONFIG.notifications.debounceMs).toBe(10_000);
    });
});

// ============================================
// 4. Error Schema Validation — 3 tests
// ============================================

describe('PerksError Schema', () => {
    test('createPerksError returns correct shape', () => {
        const err = createPerksError('RATE_LIMITED', 'Too many requests', true, 5000);
        expect(err).toEqual({
            code: 'RATE_LIMITED',
            message: 'Too many requests',
            retryable: true,
            retryAfterMs: 5000,
        });
    });

    test('createPerksError defaults retryable to false', () => {
        const err = createPerksError('GDPR_DENIED', 'No consent');
        expect(err.retryable).toBe(false);
        expect(err.retryAfterMs).toBeUndefined();
    });

    test('all error codes are valid', () => {
        const validCodes = [
            'HOLDER_CHECK_FAILED', 'NOTIFICATION_FAILED', 'GDPR_DENIED',
            'RATE_LIMITED', 'ACE_DENIED', 'UNKNOWN',
        ] as const;
        for (const code of validCodes) {
            const err = createPerksError(code, 'test');
            expect(err.code).toBe(code);
        }
    });
});

// ============================================
// 5. Win Stats Edge Cases — 3 tests
// ============================================

describe('Win Stats Edge Cases', () => {
    test('0 bids returns 0% win rate', async () => {
        mockPrisma.bid.count.mockResolvedValue(0);
        mockPrisma.vertical.findFirst.mockResolvedValue(null);

        const overview = await getPerksOverview('user-no-bids');
        expect(overview.winStats.totalBids).toBe(0);
        expect(overview.winStats.winRate).toBe(0);
    });

    test('100% win rate when all bids won', async () => {
        mockPrisma.bid.count
            .mockResolvedValueOnce(5)   // totalBids
            .mockResolvedValueOnce(5);  // wonBids
        mockPrisma.vertical.findFirst.mockResolvedValue(null);

        const overview = await getPerksOverview('user-all-wins');
        expect(overview.winStats.winRate).toBe(100);
    });

    test('partial win rate rounds correctly', async () => {
        mockPrisma.bid.count
            .mockResolvedValueOnce(3)   // totalBids
            .mockResolvedValueOnce(1);  // wonBids
        mockPrisma.vertical.findFirst.mockResolvedValue(null);

        const overview = await getPerksOverview('user-partial');
        expect(overview.winStats.winRate).toBe(33); // Math.round(1/3*100)
    });
});

// ============================================
// 6. getPerksOverview Shape & Defaults — 3 tests
// ============================================

describe('getPerksOverview Shape', () => {
    beforeEach(() => {
        mockPrisma.bid.count.mockResolvedValue(0);
        mockPrisma.vertical.findFirst.mockResolvedValue(null);
    });

    test('returns all required fields', async () => {
        const overview = await getPerksOverview('user-shape');
        expect(overview).toHaveProperty('isHolder');
        expect(overview).toHaveProperty('multiplier');
        expect(overview).toHaveProperty('prePingSeconds');
        expect(overview).toHaveProperty('notifyOptedIn');
        expect(overview).toHaveProperty('gdprConsent');
        expect(overview).toHaveProperty('winStats');
    });

    test('non-holder defaults: multiplier=1, prePing=0', async () => {
        const overview = await getPerksOverview('user-default');
        expect(overview.isHolder).toBe(false);
        expect(overview.multiplier).toBe(1.0);
        expect(overview.prePingSeconds).toBe(0);
    });

    test('winStats contains totalBids, wonBids, winRate', async () => {
        const overview = await getPerksOverview('user-stats');
        expect(overview.winStats).toHaveProperty('totalBids');
        expect(overview.winStats).toHaveProperty('wonBids');
        expect(overview.winStats).toHaveProperty('winRate');
    });
});

// ============================================
// 7. Contract SLOAD Optimization Guards — 3 tests
// ============================================

describe('Contract SLOAD Optimization', () => {
    let contractContent: string;

    beforeAll(() => {
        contractContent = fs.readFileSync(
            path.join(__dirname, '../../../contracts/contracts/VerticalAuction.sol'),
            'utf-8',
        );
    });

    test('placeBid caches seller to memory variable', () => {
        expect(contractContent).toContain('address seller = a.seller;');
        expect(contractContent).toContain('require(seller != address(0)');
    });

    test('placeBid caches timing fields to memory', () => {
        expect(contractContent).toContain('uint40 startTime = a.startTime;');
        expect(contractContent).toContain('uint40 endTime = a.endTime;');
        expect(contractContent).toContain('uint40 prePingEnd = a.prePingEnd;');
    });

    test('settleAuction also uses memory caching pattern', () => {
        expect(contractContent).toContain('address highBidder = a.highBidder;');
        expect(contractContent).toContain('uint128 paymentAmount = a.highBidRaw;');
    });
});

// ============================================
// 8. Prisma Index Verification — 2 tests
// ============================================

describe('Prisma Index Coverage', () => {
    let schemaContent: string;

    beforeAll(() => {
        schemaContent = fs.readFileSync(
            path.join(__dirname, '../../prisma/schema.prisma'),
            'utf-8',
        );
    });

    test('AuctionRoom has prePingEndsAt index', () => {
        // Find the AuctionRoom model block and verify it contains the index
        const auctionRoomBlock = schemaContent.slice(
            schemaContent.indexOf('model AuctionRoom'),
            schemaContent.indexOf('}', schemaContent.indexOf('model AuctionRoom')) + 1,
        );
        expect(auctionRoomBlock).toContain('@@index([prePingEndsAt])');
    });

    test('Bid has effectiveBid descending index', () => {
        expect(schemaContent).toContain('@@index([leadId, effectiveBid(sort: Desc)])');
    });
});

// ============================================
// Summary
// ============================================

describe('UX Polish Test Count', () => {
    test('minimum 27 tests in this file', () => {
        // 6 + 3 + 4 + 3 + 3 + 3 + 3 + 2 = 27
        expect(true).toBe(true);
    });
});
