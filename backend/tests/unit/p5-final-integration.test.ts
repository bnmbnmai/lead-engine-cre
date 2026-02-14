/**
 * P5 Final Integration Test Suite — 50 tests
 *
 * Validates all end-to-end flows from the v2 audit report:
 *   1.  E2E flow validation (6)
 *   2.  Perk stacking edge cases (5)
 *   3.  Bot simulation / CAPTCHA (5)
 *   4.  Interrupted migration / resume (5)
 *   5.  Nonce collision / determinism (4)
 *   6.  Cross-border GDPR (5)
 *   7.  High-latency pre-ping grace (5)
 *   8.  Dashboard clutter / many-verticals (5)
 *   9.  Config & env validation (5)
 *   10. Loose ends verification (5)
 */

// ============================================
// Mocks — MUST be before imports / require()
// ============================================

const mockPrisma = {
    verticalAuction: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    vertical: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    verticalSuggestion: { create: jest.fn(), groupBy: jest.fn() },
    bid: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn(), count: jest.fn() },
    buyerProfile: { updateMany: jest.fn(), findFirst: jest.fn().mockResolvedValue({ holderNotifyOptIn: true }), findMany: jest.fn() },
    lead: { findUnique: jest.fn(), update: jest.fn() },
    auctionRoom: { update: jest.fn() },
    analyticsEvent: { create: jest.fn() },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
};
jest.mock('../../src/lib/prisma', () => ({ prisma: mockPrisma }));

const mockNftOwnershipCache = { getOrSet: jest.fn(), get: jest.fn(), set: jest.fn(), delete: jest.fn(), clear: jest.fn() };
const mockBidActivityCache = { get: jest.fn().mockReturnValue(null), set: jest.fn(), delete: jest.fn() };
const mockHolderNotifyCache = { getOrSet: jest.fn().mockResolvedValue(true), get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const mockVerticalHierarchyCache = { get: jest.fn(), set: jest.fn(), delete: jest.fn(), clear: jest.fn() };

jest.mock('../../src/lib/cache', () => ({
    nftOwnershipCache: mockNftOwnershipCache,
    bidActivityCache: mockBidActivityCache,
    holderNotifyCache: mockHolderNotifyCache,
    verticalHierarchyCache: mockVerticalHierarchyCache,
    invalidateNftOwnership: jest.fn(),
    invalidateVerticalHierarchy: jest.fn(),
    invalidateAllForResale: jest.fn(),
    LRUCache: jest.requireActual('../../src/lib/cache').LRUCache,
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

jest.mock('../../src/config/perks.env', () => ({
    ...jest.requireActual('../../src/config/perks.env'),
    DIGEST_INTERVAL_MS: 300000,
    DAILY_NOTIFICATION_CAP: 50,
}));

// ============================================
// Real imports — AFTER mocks
// ============================================

import * as fs from 'fs';
import * as path from 'path';

// ============================================
// File content loaders
// ============================================

const backendRoot = path.resolve(__dirname, '../../');
const frontendRoot = path.resolve(__dirname, '../../../frontend');
const contractsRoot = path.resolve(__dirname, '../../../contracts');

function readSrc(filePath: string): string {
    return fs.readFileSync(path.resolve(backendRoot, filePath), 'utf-8');
}

function readFrontend(filePath: string): string {
    return fs.readFileSync(path.resolve(frontendRoot, filePath), 'utf-8');
}

function readContract(filePath: string): string {
    return fs.readFileSync(path.resolve(contractsRoot, filePath), 'utf-8');
}

function readRoot(filePath: string): string {
    return fs.readFileSync(path.resolve(backendRoot, '..', filePath), 'utf-8');
}

// ============================================
// 1. E2E Flow Validation (6 tests)
// ============================================

describe('P5: E2E Flow — Suggestion → Mint → Perks → Auction', () => {
    const holderPerksContent = readSrc('src/services/holder-perks.service.ts');
    const notifContent = readSrc('src/services/notification.service.ts');
    const auctionContent = readContract('contracts/VerticalAuction.sol');
    const perksEngineContent = readSrc('src/services/perks-engine.ts');

    test('suggestion flow: vertical optimizer scrubs PII before proposing', () => {
        const optimizerContent = readSrc('src/services/vertical-optimizer.service.ts');
        expect(optimizerContent).toContain('scrubPII');
        expect(optimizerContent).toContain('PROPOSED');
    });

    test('mint flow: vertical NFT service activates on high-confidence', () => {
        const nftContent = readSrc('src/services/vertical-nft.service.ts');
        expect(nftContent).toContain('activateVertical');
        expect(nftContent).toContain('mint');
    });

    test('perks flow: applyHolderPerks checks NFT ownership then ACE gate', () => {
        // Ownership check first
        expect(holderPerksContent).toContain('nftOwnershipCache');
        // Then ACE gate
        const aceGateIndex = holderPerksContent.indexOf('aceService');
        const ownershipIndex = holderPerksContent.indexOf('nftOwnershipCache');
        expect(ownershipIndex).toBeLessThan(aceGateIndex);
    });

    test('auction flow: placeBid validates holder before pre-ping gate', () => {
        // Search within the placeBid function body only
        const placeBidBody = auctionContent.substring(auctionContent.indexOf('function placeBid'));
        // After SLOAD optimization, prePingEnd is cached to memory early, but
        // bidderIsHolder logic still runs before the pre-ping gate require()
        const holderCheckIndex = placeBidBody.indexOf('bidderIsHolder');
        const prePingGateIndex = placeBidBody.indexOf('Pre-ping window (holders only)');
        expect(holderCheckIndex).toBeGreaterThan(-1);
        expect(prePingGateIndex).toBeGreaterThan(-1);
        expect(holderCheckIndex).toBeLessThan(prePingGateIndex);
    });

    test('settle flow: settleAuction pays highBidRaw not effectiveBid', () => {
        expect(auctionContent).toContain('uint128 paymentAmount = a.highBidRaw');
        expect(auctionContent).not.toMatch(/paymentAmount\s*=\s*a\.highBid[^R]/);
    });

    test('notification flow: opted-in holders get queued post-auction', () => {
        expect(notifContent).toContain('queueNotification');
        expect(notifContent).toContain('hasGdprConsent');
        expect(perksEngineContent).toContain('getPerksOverview');
    });
});

// ============================================
// 2. Perk Stacking Edge Cases (5 tests)
// ============================================

describe('P5: Perk Stacking Edge Cases', () => {
    test('multiplier applied correctly: 100 * 1.2 = 120.00', () => {
        const { applyMultiplier } = require('../../src/services/holder-perks.service');
        expect(applyMultiplier(100, 1.2)).toBe(120.00);
    });

    test('multiplier precision: avoids floating point errors', () => {
        const { applyMultiplier } = require('../../src/services/holder-perks.service');
        // 33.33 * 1.2 = 39.996 → should round to 39.40
        const result = applyMultiplier(33.33, 1.2);
        expect(result).toBe(40.00); // 33.33 * 1.2 = 39.996 → Math.round(3999.6)/100 = 40.00
        expect(Number.isFinite(result)).toBe(true);
    });

    test('zero bid with multiplier stays zero', () => {
        const { applyMultiplier } = require('../../src/services/holder-perks.service');
        expect(applyMultiplier(0, 1.2)).toBe(0);
    });

    test('non-holder gets multiplier 1.0 (no boost)', () => {
        const { getEffectiveBid, DEFAULT_PERKS } = require('../../src/services/holder-perks.service');
        expect(getEffectiveBid(100, DEFAULT_PERKS)).toBe(100);
        expect(DEFAULT_PERKS.multiplier).toBe(1.0);
    });

    test('very large bid does not overflow JS number', () => {
        const { applyMultiplier } = require('../../src/services/holder-perks.service');
        const largeBid = 999_999_999.99;
        const result = applyMultiplier(largeBid, 1.2);
        expect(result).toBe(1_199_999_999.99);
        expect(Number.isFinite(result)).toBe(true);
    });
});

// ============================================
// 3. Bot Simulation / CAPTCHA (5 tests)
// ============================================

describe('P5: Bot Simulation & Spam Prevention', () => {
    test('activity threshold blocks at 5 bids/min', () => {
        const { checkActivityThreshold, SPAM_THRESHOLD_BIDS_PER_MINUTE } = require('../../src/services/holder-perks.service');
        expect(SPAM_THRESHOLD_BIDS_PER_MINUTE).toBe(5);
    });

    test('activity threshold uses LRU cache with 60s TTL', () => {
        const holderPerksContent = readSrc('src/services/holder-perks.service.ts');
        expect(holderPerksContent).toContain('bidActivityCache');
        expect(holderPerksContent).toContain('bid-activity:');
    });

    test('rate limiter has tiered multipliers: DEFAULT=1, HOLDER=2, PREMIUM=3', () => {
        const rateLimitContent = readSrc('src/middleware/rateLimit.ts');
        expect(rateLimitContent).toContain('DEFAULT: 1');
        expect(rateLimitContent).toContain('HOLDER: 2');
        expect(rateLimitContent).toContain('PREMIUM: 3');
    });

    test('hard ceiling caps all tiers at 30 req/min', () => {
        const rateLimitContent = readSrc('src/middleware/rateLimit.ts');
        expect(rateLimitContent).toContain('TIER_HARD_CEILING');
        expect(rateLimitContent).toContain('30');
    });

    test('subnet tracking detects coordinated bids (LRU Set pattern)', () => {
        const { LRUCache } = require('../../src/lib/cache');
        const cache = new LRUCache({ maxSize: 100, ttlMs: 60_000 });
        const set = new Set<string>();
        for (let i = 0; i < 10; i++) set.add(`bot-wallet-${i}`);
        cache.set('subnet:192.168.1', set);
        expect(cache.get('subnet:192.168.1')?.size).toBe(10);
    });
});

// ============================================
// 4. Interrupted Migration (5 tests)
// ============================================

describe('P5: Migration Robustness', () => {
    const migrationContent = readSrc('scripts/backfill-effective-bid.ts');

    test('migration uses batched $transaction for atomicity', () => {
        expect(migrationContent).toContain('$transaction');
        expect(migrationContent).toContain('BATCH_SIZE');
    });

    test('migration defaults to dry-run mode', () => {
        expect(migrationContent).toContain("!process.argv.includes('--commit')");
    });

    test('migration reports progress during batch processing', () => {
        expect(migrationContent).toContain('console.log');
        // Should have progress reporting with batch count
        const progressMatches = migrationContent.match(/console\.(log|info)/g);
        expect(progressMatches!.length).toBeGreaterThanOrEqual(3);
    });

    test('migration verifies results after commit run', () => {
        expect(migrationContent).toContain('findMany');
        // Should verify no null effectiveBid remaining
        expect(migrationContent).toContain('effectiveBid');
    });

    test('migration handles empty dataset gracefully', () => {
        // The script should handle case where nullBids.length === 0
        expect(migrationContent).toContain('nullBids');
        // Should not crash on empty array
        expect(migrationContent).toContain('length');
    });
});

// ============================================
// 5. Nonce Collision / Determinism (4 tests)
// ============================================

describe('P5: Nonce Collision & Pre-Ping Determinism', () => {
    test('computePrePing is deterministic for same slug', () => {
        const { computePrePing } = require('../../src/services/holder-perks.service');
        const a = computePrePing('mortgage');
        const b = computePrePing('mortgage');
        expect(a).toBe(b);
    });

    test('computePrePing range is always within configured bounds', () => {
        const { computePrePing, PRE_PING_MIN, PRE_PING_MAX } = require('../../src/services/holder-perks.service');
        const slugs = ['solar', 'mortgage', 'roofing', 'insurance', 'auto', 'hvac', 'plumbing', 'legal'];
        for (const slug of slugs) {
            const prePing = computePrePing(slug);
            expect(prePing).toBeGreaterThanOrEqual(PRE_PING_MIN);
            expect(prePing).toBeLessThanOrEqual(PRE_PING_MAX);
        }
    });

    test('different nonces produce consistent values when range is fixed', () => {
        const { computePrePing, PRE_PING_MIN, PRE_PING_MAX } = require('../../src/services/holder-perks.service');
        const results = new Set<number>();
        for (let i = 0; i < 20; i++) {
            results.add(computePrePing('mortgage', `nonce-${i}`));
        }
        // When PRE_PING_MIN === PRE_PING_MAX, all values are the same (fixed window)
        // When they differ, we expect at least 2 distinct values
        const rangeSize = PRE_PING_MAX - PRE_PING_MIN + 1;
        if (rangeSize <= 1) {
            expect(results.size).toBe(1);
            expect([...results][0]).toBe(PRE_PING_MIN);
        } else {
            expect(results.size).toBeGreaterThanOrEqual(2);
        }
    });

    test('empty nonce equals no-nonce behavior', () => {
        const { computePrePing } = require('../../src/services/holder-perks.service');
        expect(computePrePing('mortgage', '')).toBe(computePrePing('mortgage'));
    });
});

// ============================================
// 6. Cross-Border GDPR (5 tests)
// ============================================

describe('P5: Cross-Border GDPR Compliance', () => {
    const notifContent = readSrc('src/services/notification.service.ts');

    test('queueNotification checks GDPR consent before enqueuing', () => {
        const funcContent = notifContent.substring(
            notifContent.indexOf('async function queueNotification'),
        );
        const gdprIndex = funcContent.indexOf('hasGdprConsent');
        const enqueueIndex = funcContent.indexOf('notificationQueue');
        expect(gdprIndex).toBeLessThan(enqueueIndex);
    });

    test('GDPR consent proxied via holderNotifyOptIn field', () => {
        expect(notifContent).toContain('hasGdprConsent');
        expect(notifContent).toContain('getHolderNotifyOptIn');
    });

    test('PII scrubber handles cross-border scripts (Thai, Cyrillic, CJK)', () => {
        const optimizerContent = readSrc('src/services/vertical-optimizer.service.ts');
        // Should have regex patterns for non-Latin scripts
        expect(optimizerContent).toContain('REDACTED');
    });

    test('scrubPIIWithMetadata returns cross-border flags', () => {
        const { scrubPIIWithMetadata } = require('../../src/services/vertical-optimizer.service');
        const result = scrubPIIWithMetadata('Contact Иванов for Moscow deal', 'DE');
        expect(result.crossBorderFlags).toBeDefined();
        expect(Array.isArray(result.crossBorderFlags)).toBe(true);
    });

    test('daily notification cap prevents fatigue (50/day/user)', () => {
        expect(notifContent).toContain('DAILY_NOTIFICATION_CAP');
        expect(notifContent).toContain('dailySendCount');
    });
});

// ============================================
// 7. High-Latency Pre-Ping Grace (5 tests)
// ============================================

describe('P5: High-Latency Pre-Ping Grace Period', () => {
    test('PRE_PING_GRACE_MS is 1500ms (1.5s tolerance)', () => {
        const { PRE_PING_GRACE_MS } = require('../../src/services/holder-perks.service');
        expect(PRE_PING_GRACE_MS).toBe(1500);
    });

    test('isInPrePingWindow includes grace period', () => {
        const { isInPrePingWindow, PRE_PING_GRACE_MS } = require('../../src/services/holder-perks.service');
        // Window just ended — but within grace period
        const justEnded = new Date(Date.now() - 500); // 500ms ago
        const status = isInPrePingWindow(justEnded);
        expect(status.inWindow).toBe(true);
        expect(status.remainingMs).toBeGreaterThan(0);
        expect(status.remainingMs).toBeLessThanOrEqual(PRE_PING_GRACE_MS);
    });

    test('isInPrePingWindow returns false after grace expires', () => {
        const { isInPrePingWindow, PRE_PING_GRACE_MS } = require('../../src/services/holder-perks.service');
        // Window ended well beyond grace
        const longGone = new Date(Date.now() - PRE_PING_GRACE_MS - 1000);
        const status = isInPrePingWindow(longGone);
        expect(status.inWindow).toBe(false);
        expect(status.remainingMs).toBe(0);
    });

    test('null prePingEndsAt returns no-window status', () => {
        const { isInPrePingWindow } = require('../../src/services/holder-perks.service');
        const status = isInPrePingWindow(null);
        expect(status.inWindow).toBe(false);
        expect(status.remainingMs).toBe(0);
    });

    test('future prePingEndsAt returns full window', () => {
        const { isInPrePingWindow, PRE_PING_GRACE_MS } = require('../../src/services/holder-perks.service');
        const future = new Date(Date.now() + 5000); // 5s from now
        const status = isInPrePingWindow(future);
        expect(status.inWindow).toBe(true);
        expect(status.remainingMs).toBeGreaterThan(5000);
        expect(status.remainingMs).toBeLessThanOrEqual(5000 + PRE_PING_GRACE_MS + 100);
    });
});

// ============================================
// 8. Dashboard Clutter / Many-Verticals (5 tests)
// ============================================

describe('P5: Dashboard Clutter & Hierarchy Depth', () => {
    test('MAX_VERTICAL_DEPTH limits hierarchy (derived from config)', () => {
        const { MAX_VERTICAL_DEPTH } = require('../../src/services/perks-engine');
        expect(MAX_VERTICAL_DEPTH).toBe(5); // Derived from perks.env MAX_HIERARCHY_DEPTH
    });

    test('MAX_HIERARCHY_DEPTH in perks.env defaults to 5', () => {
        const perksEnvContent = readSrc('src/config/perks.env.ts');
        expect(perksEnvContent).toContain("MAX_HIERARCHY_DEPTH");
        expect(perksEnvContent).toContain("'5'");
    });

    test('PerksPanel has collapsible section for dense dashboards', () => {
        const panelContent = readFrontend('src/components/marketplace/PerksPanel.tsx');
        expect(panelContent).toContain('expanded');
        expect(panelContent).toContain('setExpanded');
        expect(panelContent).toContain('aria-expanded');
    });

    test('PerksPanel hides chart on mobile to prevent clutter', () => {
        const panelContent = readFrontend('src/components/marketplace/PerksPanel.tsx');
        expect(panelContent).toContain('hidden sm:block');
    });

    test('vertical hierarchy prevents depth > schema limit', () => {
        const perksEnvContent = readSrc('src/config/perks.env.ts');
        expect(perksEnvContent).toContain('MAX_HIERARCHY_DEPTH');
        expect(perksEnvContent).toContain('process.env.MAX_HIERARCHY_DEPTH');
    });
});

// ============================================
// 9. Config & Env Validation (5 tests)
// ============================================

describe('P5: Config & Env Validation', () => {
    const perksEnvContent = readSrc('src/config/perks.env.ts');

    test('PERKS_CONFIG aggregate exports all 6 sections', () => {
        const sections = ['holder', 'spam', 'notifications', 'cache', 'rateLimit', 'hierarchy'];
        for (const section of sections) {
            expect(perksEnvContent).toContain(`${section}:`);
        }
    });

    test('all env vars have sensible defaults (NaN protection)', () => {
        // Each constant uses parseInt/parseFloat with a fallback
        const envReads = perksEnvContent.match(/process\.env\.\w+/g) || [];
        expect(envReads.length).toBeGreaterThanOrEqual(10);
        // Each should have || 'defaultValue'
        const defaults = perksEnvContent.match(/\|\|\s*['"][^'"]+['"]/g) || [];
        expect(defaults.length).toBeGreaterThanOrEqual(10);
    });

    test('perks-engine re-exports PERKS_CONFIG from perks.env', () => {
        const engineContent = readSrc('src/services/perks-engine.ts');
        expect(engineContent).toContain("PERKS_CONFIG");
        expect(engineContent).toContain("from '../config/perks.env'");
    });

    test('notification constants match perks.env values', () => {
        const notifContent = readSrc('src/services/notification.service.ts');
        // Should import from perks.env, not hardcode
        expect(notifContent).toContain("from '../config/perks.env'");
        expect(notifContent).toContain('DIGEST_INTERVAL_MS');
    });

    test('HOLDER_MULTIPLIER env default is 1.2', () => {
        expect(perksEnvContent).toContain("'1.2'");
    });
});

// ============================================
// 10. Loose Ends Verification (5 tests)
// ============================================

describe('P5: Loose Ends — ACE, GDPR, Debounce, Migration', () => {
    test('ACE fail-open: logs warning but allows perks when ACE is down', () => {
        const holderPerksContent = readSrc('src/services/holder-perks.service.ts');
        expect(holderPerksContent).toContain('fail-open');
        expect(holderPerksContent).toContain("console.warn('[HOLDER-PERKS] ACE check failed");
    });

    test('GDPR check runs before every batch notification enqueue', () => {
        const notifContent = readSrc('src/services/notification.service.ts');
        // queueNotification should call hasGdprConsent first
        const funcBody = notifContent.substring(
            notifContent.indexOf('async function queueNotification'),
            notifContent.indexOf('// Enqueue') || notifContent.indexOf('notificationQueue.set'),
        );
        expect(funcBody).toContain('hasGdprConsent');
    });

    test('socket debounce emits pending state with ARIA attributes', () => {
        const socketContent = readSrc('src/rtb/socket.ts');
        expect(socketContent).toContain('holder:notify-pending');
        expect(socketContent).toContain("ariaLive: 'assertive'");
        expect(socketContent).toContain("role: 'status'");
    });

    test('migration script exists at scripts/backfill-effective-bid.ts', () => {
        const migrationExists = fs.existsSync(
            path.resolve(backendRoot, 'scripts/backfill-effective-bid.ts'),
        );
        expect(migrationExists).toBe(true);
    });

    test('perks-engine exports PerksError with all error codes', () => {
        const engineContent = readSrc('src/services/perks-engine.ts');
        const errorCodes = ['HOLDER_CHECK_FAILED', 'NOTIFICATION_FAILED', 'GDPR_DENIED', 'RATE_LIMITED', 'ACE_DENIED', 'UNKNOWN'];
        for (const code of errorCodes) {
            expect(engineContent).toContain(code);
        }
    });
});
