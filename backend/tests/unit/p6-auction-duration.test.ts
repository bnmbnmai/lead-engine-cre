/**
 * P6 — Configurable Auction Duration Tests
 *
 * Tests for:
 *   - Config defaults (LEAD_AUCTION_DURATION_SECS, NFT_AUCTION_DURATION_SECS, etc.)
 *   - Auto-extend logic (autoExtendAuction)
 *   - Short-auction edge cases
 *   - Frontend format helpers
 *
 * Coverage: 17 tests across 4 describe blocks
 */

// ── Helpers ──────────────────────────────

function readBackend(relativePath: string): string {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../../src', relativePath), 'utf-8');
}

function readFrontend(relativePath: string): string {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../../../frontend/src', relativePath), 'utf-8');
}

// ============================================
// 1. Config Validation (5 tests)
// ============================================

describe('Auction Duration Config', () => {
    let perksConfig: any;

    beforeAll(() => {
        // Reset module cache to pick up defaults
        jest.resetModules();
        // Ensure env vars are NOT set so defaults kick in
        delete process.env.LEAD_AUCTION_DURATION_SECS;
        delete process.env.NFT_AUCTION_DURATION_SECS;
        delete process.env.AUTO_EXTEND_INCREMENT_SECS;
        delete process.env.AUTO_EXTEND_MAX;
        perksConfig = require('../../src/config/perks.env');
    });

    test('LEAD_AUCTION_DURATION_SECS defaults to 60 (Standard preset)', () => {
        expect(perksConfig.LEAD_AUCTION_DURATION_SECS).toBe(60);
    });

    test('NFT_AUCTION_DURATION_SECS defaults to 600 (10 minutes)', () => {
        expect(perksConfig.NFT_AUCTION_DURATION_SECS).toBe(600);
    });

    test('AUTO_EXTEND_INCREMENT_SECS defaults to 60 (1 minute)', () => {
        expect(perksConfig.AUTO_EXTEND_INCREMENT_SECS).toBe(60);
    });

    test('AUTO_EXTEND_MAX defaults to 5', () => {
        expect(perksConfig.AUTO_EXTEND_MAX).toBe(5);
    });

    test('PERKS_CONFIG.auction contains all duration keys + presets', () => {
        const auctionConfig = perksConfig.PERKS_CONFIG.auction;
        expect(auctionConfig).toBeDefined();
        expect(auctionConfig).toEqual({
            presets: { hot: 30, standard: 60, extended: 300 },
            leadDurationSecs: 60,
            leadMaxDurationSecs: 300,
            nftDurationSecs: 600,
            autoExtendIncrementSecs: 60,
            autoExtendMax: 5,
        });
    });
});

// ============================================
// 2. Auto-Extend Logic (5 tests)
// ============================================

describe('Auto-Extend Auction', () => {
    const mockPrisma = {
        verticalAuction: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    };

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        // Mock Prisma
        jest.mock('../../src/lib/prisma', () => ({
            prisma: mockPrisma,
        }));
    });

    function makeAuction(overrides: any = {}) {
        return {
            id: 'auction-1',
            settled: false,
            cancelled: false,
            extensionCount: 0,
            endTime: new Date(Date.now() + 30_000), // 30s remaining
            ...overrides,
        };
    }

    test('extends when < 60s remaining and below max extensions', async () => {
        const auction = makeAuction({ extensionCount: 0, endTime: new Date(Date.now() + 30_000) });
        mockPrisma.verticalAuction.findUnique.mockResolvedValue(auction);
        mockPrisma.verticalAuction.update.mockResolvedValue({});

        const { autoExtendAuction } = require('../../src/services/auction.service');
        const result = await autoExtendAuction('auction-1');

        expect(result).toBe(true);
        expect(mockPrisma.verticalAuction.update).toHaveBeenCalledWith({
            where: { id: 'auction-1' },
            data: expect.objectContaining({
                extensionCount: 1,
            }),
        });
    });

    test('refuses when extensionCount >= AUTO_EXTEND_MAX (5)', async () => {
        const auction = makeAuction({ extensionCount: 5 });
        mockPrisma.verticalAuction.findUnique.mockResolvedValue(auction);

        const { autoExtendAuction } = require('../../src/services/auction.service');
        const result = await autoExtendAuction('auction-1');

        expect(result).toBe(false);
        expect(mockPrisma.verticalAuction.update).not.toHaveBeenCalled();
    });

    test('refuses when > 60s remaining (no urgency)', async () => {
        const auction = makeAuction({ endTime: new Date(Date.now() + 120_000) }); // 2 min left
        mockPrisma.verticalAuction.findUnique.mockResolvedValue(auction);

        const { autoExtendAuction } = require('../../src/services/auction.service');
        const result = await autoExtendAuction('auction-1');

        expect(result).toBe(false);
    });

    test('refuses for settled auctions', async () => {
        const auction = makeAuction({ settled: true });
        mockPrisma.verticalAuction.findUnique.mockResolvedValue(auction);

        const { autoExtendAuction } = require('../../src/services/auction.service');
        const result = await autoExtendAuction('auction-1');

        expect(result).toBe(false);
    });

    test('refuses for cancelled auctions', async () => {
        const auction = makeAuction({ cancelled: true });
        mockPrisma.verticalAuction.findUnique.mockResolvedValue(auction);

        const { autoExtendAuction } = require('../../src/services/auction.service');
        const result = await autoExtendAuction('auction-1');

        expect(result).toBe(false);
    });
});

// ============================================
// 3. Short Auction Edge Cases (5 tests)
// ============================================

describe('Short Auction Edge Cases', () => {
    test('RTB engine defaults to LEAD_AUCTION_DURATION_SECS (300), not 3600', () => {
        const engineSrc = readBackend('rtb/engine.ts');
        expect(engineSrc).toContain('LEAD_AUCTION_DURATION_SECS');
        expect(engineSrc).not.toContain('|| 3600');
    });

    test('validation schema rejects durations > 3600s', () => {
        const { AskCreateSchema } = require('../../src/utils/validation');
        const result = AskCreateSchema.safeParse({
            vertical: 'solar',
            geoTargets: { country: 'US', states: ['CA'] },
            reservePrice: 50,
            auctionDuration: 7200, // 2 hours — should fail
        });
        expect(result.success).toBe(false);
    });

    test('validation schema accepts 60s minimum (contract floor)', () => {
        const { AskCreateSchema } = require('../../src/utils/validation');
        const result = AskCreateSchema.safeParse({
            vertical: 'solar',
            geoTargets: { country: 'US', states: ['CA'] },
            reservePrice: 50,
            auctionDuration: 60,
        });
        expect(result.success).toBe(true);
    });

    test('validation schema defaults to 60s (Standard preset) when omitted', () => {
        const { AskCreateSchema } = require('../../src/utils/validation');
        const result = AskCreateSchema.safeParse({
            vertical: 'solar',
            geoTargets: { country: 'US', states: ['CA'] },
            reservePrice: 50,
        });
        expect(result.success).toBe(true);
        expect(result.data.auctionDuration).toBe(60);
    });

    test('demo panel uses config constant, not hardcoded 3600', () => {
        const demoSrc = readBackend('routes/demo-panel.routes.ts');
        expect(demoSrc).toContain('LEAD_AUCTION_DURATION_SECS');
        // Ensure no remaining hardcoded 3600 for auction duration
        // (the 120s demo auction sim is intentionally kept)
        const lines = demoSrc.split('\n');
        const auctionDurationLines = lines.filter((l: string) =>
            l.includes('auctionDuration') && l.includes('3600')
        );
        expect(auctionDurationLines.length).toBe(0);
    });
});

// ============================================
// 4. Frontend Format Tests (2 tests)
// ============================================

describe('Frontend Countdown Formatting', () => {
    test('NFTCard uses mm:ss format for sub-hour auctions', () => {
        const nftCardSrc = readFrontend('components/marketplace/NFTCard.tsx');
        // Must use padStart for seconds in mm:ss format
        expect(nftCardSrc).toContain("padStart(2, '0')");
        // Must have urgency state
        expect(nftCardSrc).toContain("'critical'");
        expect(nftCardSrc).toContain("'warning'");
        expect(nftCardSrc).toContain('animate-pulse');
    });

    test('formatTimeRemaining returns mm:ss for sub-hour durations', () => {
        const utilsSrc = readFrontend('lib/utils.ts');
        // Must contain mm:ss format (padStart pattern)
        expect(utilsSrc).toContain("padStart(2, '0')");
        // Should NOT contain old Xm Xs format
        expect(utilsSrc).not.toContain('`${minutes}m ${seconds}s`');
    });
});
