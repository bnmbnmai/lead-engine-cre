/**
 * Unit Tests — Holder Perks Service
 *
 * Tests applyHolderPerks() and applyMultiplier() for:
 *   - NFT holder vs non-holder behaviour
 *   - Cache hit/miss
 *   - Edge cases (null owner, PROPOSED vertical, multi-vertical)
 *   - Bid multiplier math
 */

// ── Mocks ──────────────────────────────────────

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        vertical: {
            findUnique: jest.fn(),
        },
    },
}));

// Reset cache between tests
import { nftOwnershipCache } from '../../src/lib/cache';
import { applyHolderPerks, applyMultiplier, PRE_PING_MIN, PRE_PING_MAX } from '../../src/services/holder-perks.service';
import { prisma } from '../../src/lib/prisma';

const mockFindUnique = prisma.vertical.findUnique as jest.Mock;

beforeEach(() => {
    nftOwnershipCache.clear();
    mockFindUnique.mockReset();
});

// ── Tests ──────────────────────────────────────

describe('applyHolderPerks', () => {
    it('returns holder perks when wallet matches ownerAddress on ACTIVE vertical', async () => {
        mockFindUnique.mockResolvedValue({
            ownerAddress: '0xABcD1234567890abcdef1234567890abcdef1234',
            status: 'ACTIVE',
        });

        const perks = await applyHolderPerks(
            'solar',
            '0xabcd1234567890abcdef1234567890abcdef1234', // lowercase
        );

        expect(perks.isHolder).toBe(true);
        expect(perks.multiplier).toBe(1.2);
        expect(perks.prePingSeconds).toBeGreaterThanOrEqual(PRE_PING_MIN);
        expect(perks.prePingSeconds).toBeLessThanOrEqual(PRE_PING_MAX);
    });

    it('returns default perks for non-holder (address mismatch)', async () => {
        mockFindUnique.mockResolvedValue({
            ownerAddress: '0x1111111111111111111111111111111111111111',
            status: 'ACTIVE',
        });

        const perks = await applyHolderPerks(
            'solar',
            '0x2222222222222222222222222222222222222222',
        );

        expect(perks.isHolder).toBe(false);
        expect(perks.multiplier).toBe(1.0);
        expect(perks.prePingSeconds).toBe(0);
    });

    it('returns default perks when ownerAddress is null', async () => {
        mockFindUnique.mockResolvedValue({
            ownerAddress: null,
            status: 'ACTIVE',
        });

        const perks = await applyHolderPerks(
            'mortgage',
            '0xABCD1234567890abcdef1234567890abcdef1234',
        );

        expect(perks.isHolder).toBe(false);
    });

    it('returns default perks for PROPOSED (inactive) vertical', async () => {
        mockFindUnique.mockResolvedValue({
            ownerAddress: '0xABcD1234567890abcdef1234567890abcdef1234',
            status: 'PROPOSED',
        });

        const perks = await applyHolderPerks(
            'roofing',
            '0xabcd1234567890abcdef1234567890abcdef1234',
        );

        expect(perks.isHolder).toBe(false);
        expect(perks.multiplier).toBe(1.0);
    });

    it('returns default perks when vertical does not exist', async () => {
        mockFindUnique.mockResolvedValue(null);

        const perks = await applyHolderPerks(
            'nonexistent',
            '0xABcD1234567890abcdef1234567890abcdef1234',
        );

        expect(perks.isHolder).toBe(false);
    });

    it('returns default perks when userAddress is null/undefined', async () => {
        const perks1 = await applyHolderPerks('solar', null);
        const perks2 = await applyHolderPerks('solar', undefined);

        expect(perks1.isHolder).toBe(false);
        expect(perks2.isHolder).toBe(false);
        // Should not even query Prisma
        expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('uses cache on second call (no duplicate Prisma query)', async () => {
        mockFindUnique.mockResolvedValue({
            ownerAddress: '0xABcD1234567890abcdef1234567890abcdef1234',
            status: 'ACTIVE',
        });

        await applyHolderPerks('solar', '0xabcd1234567890abcdef1234567890abcdef1234');
        await applyHolderPerks('solar', '0xabcd1234567890abcdef1234567890abcdef1234');

        // Prisma should only be called once (cache hit on second call)
        expect(mockFindUnique).toHaveBeenCalledTimes(1);
    });

    it('handles multi-vertical: holder of A, non-holder of B', async () => {
        mockFindUnique
            .mockResolvedValueOnce({
                ownerAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                status: 'ACTIVE',
            })
            .mockResolvedValueOnce({
                ownerAddress: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
                status: 'ACTIVE',
            });

        const perksA = await applyHolderPerks(
            'solar',
            '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        );
        const perksB = await applyHolderPerks(
            'mortgage',
            '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        );

        expect(perksA.isHolder).toBe(true);
        expect(perksB.isHolder).toBe(false);
    });

    it('produces deterministic pre-ping per slug', async () => {
        mockFindUnique.mockResolvedValue({
            ownerAddress: '0xABcD1234567890abcdef1234567890abcdef1234',
            status: 'ACTIVE',
        });

        const perks1 = await applyHolderPerks('solar', '0xabcd1234567890abcdef1234567890abcdef1234');
        nftOwnershipCache.clear();
        const perks2 = await applyHolderPerks('solar', '0xabcd1234567890abcdef1234567890abcdef1234');

        expect(perks1.prePingSeconds).toBe(perks2.prePingSeconds);
    });
});

describe('applyMultiplier', () => {
    it('applies 1.2x multiplier correctly', () => {
        expect(applyMultiplier(100, 1.2)).toBe(120.00);
        expect(applyMultiplier(50, 1.2)).toBe(60.00);
        expect(applyMultiplier(33.33, 1.2)).toBe(40.00); // rounded
    });

    it('applies 1.0x multiplier (no change)', () => {
        expect(applyMultiplier(100, 1.0)).toBe(100.00);
    });

    it('handles small amounts', () => {
        expect(applyMultiplier(0.01, 1.2)).toBe(0.01); // rounded
        expect(applyMultiplier(1, 1.2)).toBe(1.20);
    });
});
