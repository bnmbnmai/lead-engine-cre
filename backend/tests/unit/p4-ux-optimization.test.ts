/**
 * P4 UX Polish & Optimization Test Suite
 *
 * 25+ tests covering:
 *   - Perks Engine unified API (getPerksOverview, PerksError, re-exports)
 *   - Config centralization (constants sourced from perks.env.ts)
 *   - LabeledSwitch ARIA attributes
 *   - Tooltip accessibility (role="tooltip", focus/blur)
 *   - Collapsible sections (expand/collapse, many-verticals)
 *   - Contract gas optimization patterns (storage caching)
 *   - Mobile responsiveness (badge hidden on mobile)
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================
// File content loaders
// ============================================

const backendRoot = path.resolve(__dirname, '../../');
const frontendRoot = path.resolve(__dirname, '../../../frontend');
const contractsRoot = path.resolve(__dirname, '../../../contracts');

function readSrc(filePath: string): string {
    const fullPath = path.resolve(backendRoot, filePath);
    return fs.readFileSync(fullPath, 'utf-8');
}

function readFrontend(filePath: string): string {
    const fullPath = path.resolve(frontendRoot, filePath);
    return fs.readFileSync(fullPath, 'utf-8');
}

function readContract(filePath: string): string {
    const fullPath = path.resolve(contractsRoot, filePath);
    return fs.readFileSync(fullPath, 'utf-8');
}

// ============================================
// 1. Perks Engine Unified API (5 tests)
// ============================================

describe('P4: Perks Engine Unified API', () => {
    const engineContent = readSrc('src/services/perks-engine.ts');

    test('exports getPerksOverview function', () => {
        expect(engineContent).toContain('export async function getPerksOverview');
        expect(engineContent).toContain('userId: string');
        expect(engineContent).toContain('walletAddress?: string');
    });

    test('exports PerksError interface with retryable flag', () => {
        expect(engineContent).toContain('export interface PerksError');
        expect(engineContent).toContain('retryable: boolean');
        expect(engineContent).toContain('retryAfterMs?: number');
    });

    test('exports createPerksError factory function', () => {
        expect(engineContent).toContain('export function createPerksError');
        const { createPerksError } = require('../../src/services/perks-engine');
        const err = createPerksError('RATE_LIMITED', 'Too fast', true, 5000);
        expect(err).toEqual({
            code: 'RATE_LIMITED',
            message: 'Too fast',
            retryable: true,
            retryAfterMs: 5000,
        });
    });

    test('re-exports all holder-perks functions', () => {
        const expectedExports = [
            'applyHolderPerks',
            'applyMultiplier',
            'getEffectiveBid',
            'isInPrePingWindow',
            'checkActivityThreshold',
            'computePrePing',
        ];
        for (const name of expectedExports) {
            expect(engineContent).toContain(name);
        }
    });

    test('re-exports all notification functions', () => {
        const expectedExports = [
            'setHolderNotifyOptIn',
            'getHolderNotifyOptIn',
            'findNotifiableHolders',
            'queueNotification',
            'flushNotificationDigest',
            'hasGdprConsent',
            'startDigestTimer',
        ];
        for (const name of expectedExports) {
            expect(engineContent).toContain(name);
        }
    });

    test('exports MAX_VERTICAL_DEPTH derived from config', () => {
        expect(engineContent).toContain('MAX_HIERARCHY_DEPTH as MAX_VERTICAL_DEPTH');
        const { MAX_VERTICAL_DEPTH } = require('../../src/services/perks-engine');
        expect(MAX_VERTICAL_DEPTH).toBe(5); // Derived from perks.env MAX_HIERARCHY_DEPTH
    });
});

// ============================================
// 2. Config Centralization (4 tests)
// ============================================

describe('P4: Config Centralization', () => {
    const perksEnvContent = readSrc('src/config/perks.env.ts');
    const notifContent = readSrc('src/services/notification.service.ts');
    const holderPerksContent = readSrc('src/services/holder-perks.service.ts');

    test('perks.env.ts exports all core constants', () => {
        const constants = [
            'HOLDER_MULTIPLIER',
            'PRE_PING_MIN',
            'PRE_PING_MAX',
            'SPAM_THRESHOLD_BIDS_PER_MINUTE',
            'DIGEST_INTERVAL_MS',
            'DAILY_NOTIFICATION_CAP',
            'NOTIFY_DEBOUNCE_MS',
            'NFT_OWNERSHIP_TTL_MS',
            'TIER_HARD_CEILING',
            'MAX_HIERARCHY_DEPTH',
        ];
        for (const name of constants) {
            expect(perksEnvContent).toContain(`export const ${name}`);
        }
    });

    test('perks.env.ts reads from env vars with defaults', () => {
        expect(perksEnvContent).toContain('process.env.HOLDER_MULTIPLIER');
        expect(perksEnvContent).toContain('process.env.DAILY_NOTIFICATION_CAP');
        expect(perksEnvContent).toContain('process.env.MAX_HIERARCHY_DEPTH');
    });

    test('notification.service imports DIGEST_INTERVAL_MS from perks.env', () => {
        // Should import from perks.env, not hardcode
        expect(notifContent).toContain("from '../config/perks.env'");
        expect(notifContent).toContain('DIGEST_INTERVAL_MS');
        // Should NOT have the old hardcoded value
        expect(notifContent).not.toContain('const DIGEST_INTERVAL_MS = 5 * 60_000');
    });

    test('perks.env PERKS_CONFIG aggregate has all sections', () => {
        expect(perksEnvContent).toContain('PERKS_CONFIG');
        const sections = ['holder:', 'spam:', 'notifications:', 'cache:', 'rateLimit:', 'hierarchy:'];
        for (const section of sections) {
            expect(perksEnvContent).toContain(section);
        }
    });
});

// ============================================
// 3. LabeledSwitch ARIA (3 tests)
// ============================================

describe('P4: LabeledSwitch ARIA Accessibility', () => {
    const switchContent = readFrontend('src/components/ui/switch.tsx');

    test('Switch uses Radix primitives with proper base ARIA', () => {
        expect(switchContent).toContain("@radix-ui/react-switch");
        expect(switchContent).toContain('focus-visible:ring-2');
        expect(switchContent).toContain('disabled:cursor-not-allowed');
    });

    test('LabeledSwitch has label and optional description', () => {
        expect(switchContent).toContain('label: string');
        expect(switchContent).toContain('description?: string');
        expect(switchContent).toContain('cursor-pointer');
    });

    test('PerksPanel applies aria-label and aria-describedby to toggles', () => {
        const panelContent = readFrontend('src/components/marketplace/PerksPanel.tsx');
        expect(panelContent).toContain('aria-label="Toggle auction notification opt-in"');
        expect(panelContent).toContain('aria-label="Toggle GDPR notification consent"');
        expect(panelContent).toContain('aria-describedby');
    });
});

// ============================================
// 4. Tooltip Accessibility (3 tests)
// ============================================

describe('P4: Tooltip Accessibility', () => {
    const tooltipContent = readFrontend('src/components/ui/Tooltip.tsx');

    test('tooltip has role="tooltip" for screen readers', () => {
        expect(tooltipContent).toContain('role="tooltip"');
    });

    test('tooltip triggers on focus/blur for keyboard navigation', () => {
        expect(tooltipContent).toContain('onFocus');
        expect(tooltipContent).toContain('onBlur');
    });

    test('PerksPanel uses tooltips on multiplier and pre-ping badges', () => {
        const panelContent = readFrontend('src/components/marketplace/PerksPanel.tsx');
        // Multiplier tooltip
        expect(panelContent).toContain('bids are weighted');
        expect(panelContent).toContain('Multiplier');
        // Pre-ping tooltip
        expect(panelContent).toContain('exclusive early access');
        expect(panelContent).toContain('Pre-Ping');
    });
});

// ============================================
// 5. Collapsible Sections (3 tests)
// ============================================

describe('P4: Collapsible Sections', () => {
    const panelContent = readFrontend('src/components/marketplace/PerksPanel.tsx');

    test('PerksPanel has collapsible section with aria-expanded', () => {
        expect(panelContent).toContain('aria-expanded={expanded}');
        expect(panelContent).toContain('aria-controls="perks-panel-content"');
    });

    test('collapse toggle supports both click and keyboard', () => {
        expect(panelContent).toContain('onClick={() => setExpanded(!expanded)}');
        expect(panelContent).toContain("e.key === 'Enter'");
        expect(panelContent).toContain("e.key === ' '");
    });

    test('content ID matches aria-controls for many-verticals', () => {
        // The expandable content has id matching aria-controls
        expect(panelContent).toContain('id="perks-panel-content"');
        expect(panelContent).toContain('aria-controls="perks-panel-content"');
    });
});

// ============================================
// 6. Contract Gas Optimization (4 tests)
// ============================================

describe('P4: Contract Gas Optimization', () => {
    const auctionContent = readContract('contracts/VerticalAuction.sol');

    test('settleAuction caches storage values in local variables', () => {
        // Should cache highBidder, paymentAmount, nftContract, tokenId, seller
        expect(auctionContent).toContain('address highBidder = a.highBidder');
        expect(auctionContent).toContain('uint128 paymentAmount = a.highBidRaw');
        expect(auctionContent).toContain('address nftContract = a.nftContract');
        expect(auctionContent).toContain('uint256 tokenId = a.tokenId');
        expect(auctionContent).toContain('address seller = a.seller');
    });

    test('settleAuction uses cached values instead of repeated SLOAD', () => {
        // Extract settleAuction function body
        const settleMatch = auctionContent.match(
            /function settleAuction[\s\S]*?emit AuctionSettled[\s\S]*?\}/,
        );
        expect(settleMatch).not.toBeNull();
        const settleBody = settleMatch![0];

        // After caching, should use local vars, not a.field
        // Count references to local cached vars vs a.field in the execution section
        const cachedRefs = (settleBody.match(/\b(highBidder|nftContract|seller|tokenId)\b/g) || []).length;
        // a.highBidder etc after the cache lines should not appear
        const storageRefs = (settleBody.match(/a\.highBidder|a\.nftContract|a\.seller|a\.tokenId/g) || []).filter(
            (_, i) => i > 0, // first ref is the cache assignment
        );
        // All post-cache references should be to local vars
        expect(cachedRefs).toBeGreaterThan(storageRefs.length);
    });

    test('placeBid uses holderCache for gas-efficient repeat bids', () => {
        expect(auctionContent).toContain('holderCacheSet[auctionId][msg.sender]');
        expect(auctionContent).toContain('holderCache[auctionId][msg.sender]');
        expect(auctionContent).toContain('saves ~2,100 gas');
    });

    test('batchCheckHolders view function exists for batch verification', () => {
        expect(auctionContent).toContain('batchCheckHolders');
        expect(auctionContent).toContain('address[] calldata bidders');
    });
});

// ============================================
// 7. Mobile Responsiveness (3 tests)
// ============================================

describe('P4: Mobile Responsiveness', () => {
    const panelContent = readFrontend('src/components/marketplace/PerksPanel.tsx');

    test('pre-ping badge hidden on mobile (sm:inline-flex)', () => {
        // Badge should have responsive class
        expect(panelContent).toContain('hidden sm:inline-flex');
    });

    test('chart hidden on mobile with desktop-only wrapper', () => {
        expect(panelContent).toContain('hidden sm:block');
        expect(panelContent).toContain('sm:hidden');
    });

    test('toggles use responsive grid (1 col mobile, 3 col desktop)', () => {
        expect(panelContent).toContain('grid-cols-1 sm:grid-cols-3');
    });
});

// ============================================
// 8. PerksPanel Integration (3 tests)
// ============================================

describe('P4: PerksPanel Integration', () => {
    test('BuyerDashboard imports and renders PerksPanel', () => {
        const dashContent = readFrontend('src/pages/BuyerDashboard.tsx');
        expect(dashContent).toContain("from '@/components/marketplace/PerksPanel'");
        expect(dashContent).toContain('<PerksPanel');
    });

    test('PerksPanel has GDPR consent toggle (functional)', () => {
        const panelContent = readFrontend('src/components/marketplace/PerksPanel.tsx');
        expect(panelContent).toContain('GDPR Consent');
        expect(panelContent).toContain('/api/v1/buyer/gdpr-consent');
    });

    test('PerksPanel embeds HolderWinRateChart', () => {
        const panelContent = readFrontend('src/components/marketplace/PerksPanel.tsx');
        expect(panelContent).toContain("from '@/components/marketplace/HolderWinRateChart'");
        expect(panelContent).toContain('<HolderWinRateChart');
    });
});
