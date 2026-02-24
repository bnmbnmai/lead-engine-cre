/**
 * Data Streams Service Tests
 *
 * Unit tests for the Chainlink Data Streams integration, including:
 * - Floor price calculation with market multiplier
 * - ETH/USD baseline deviation clamping
 * - Cache behavior and TTL
 * - Stale fallback when chain is unreachable
 * - Price index derivation
 * - Subscription lifecycle
 */

// ============================================
// Mock ethers.js — simulate on-chain reads
// ============================================

const mockLatestRoundData = jest.fn();
const mockDecimals = jest.fn().mockResolvedValue(8);

jest.mock('ethers', () => ({
    ethers: {
        JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
        Contract: jest.fn().mockImplementation(() => ({
            latestRoundData: mockLatestRoundData,
            decimals: mockDecimals,
        })),
    },
}));

// ============================================
// Import service after mocks
// ============================================

import { dataStreamsService, _resetCacheForTesting } from '../../src/services/data-feeds.service';

// ============================================
// Helpers
// ============================================

/**
 * Simulate an ETH/USD price by returning a mock latestRoundData response.
 * answer = price × 1e8 (Chainlink 8-decimal format)
 */
function mockEthPrice(price: number) {
    const answer = BigInt(Math.round(price * 1e8));
    mockLatestRoundData.mockResolvedValue([
        1n,                                 // roundId
        answer,                             // answer (int256)
        BigInt(Math.floor(Date.now() / 1000)),  // startedAt
        BigInt(Math.floor(Date.now() / 1000)),  // updatedAt
        1n,                                 // answeredInRound
    ]);
}

// ============================================
// Tests
// ============================================

beforeEach(() => {
    jest.clearAllMocks();
    _resetCacheForTesting(); // Clear chain price cache between tests
    mockEthPrice(2500); // Baseline = $2500
});

describe('DataStreamsService', () => {
    describe('getRealtimeBidFloor', () => {
        it('should return floor price for a known vertical', async () => {
            mockEthPrice(2500); // Neutral market

            const result = await dataStreamsService.getRealtimeBidFloor('solar', 'US');

            expect(result.vertical).toBe('solar');
            expect(result.country).toBe('US');
            expect(result.stale).toBe(false);
            expect(result.source).toBe('on-chain');
            // Solar US base floor is $85, at neutral market should be ~$85 (±3% jitter)
            expect(result.bidFloor).toBeGreaterThan(80);
            expect(result.bidFloor).toBeLessThan(92);
            expect(result.bidCeiling).toBeGreaterThan(190);
            expect(result.bidCeiling).toBeLessThan(210);
        });

        it('should return default prices for an unknown vertical', async () => {
            mockEthPrice(2500);

            const result = await dataStreamsService.getRealtimeBidFloor('unknown_vertical', 'US');

            // Default base prices: floor=20, ceiling=80
            expect(result.bidFloor).toBeGreaterThan(18);
            expect(result.bidFloor).toBeLessThan(22);
            expect(result.bidCeiling).toBeGreaterThan(76);
            expect(result.bidCeiling).toBeLessThan(84);
        });

        it('should increase floor when ETH/USD is above baseline (bullish)', async () => {
            // ETH at $3000 → baseline $2500 → deviation = +20% → multiplier = 1.20
            mockEthPrice(3000);

            const result = await dataStreamsService.getRealtimeBidFloor('solar', 'US');

            // Solar base = $85, multiplied by 1.20 = ~$102
            expect(result.bidFloor).toBeGreaterThan(95);
            expect(result.marketMultiplier).toBeGreaterThan(1.0);
        });

        it('should decrease floor when ETH/USD is below baseline (bearish)', async () => {
            // ETH at $2000 → baseline $2500 → deviation = -20% → multiplier = 0.80
            mockEthPrice(2000);

            const result = await dataStreamsService.getRealtimeBidFloor('solar', 'US');

            // Solar base = $85, multiplied by 0.80 = ~$68
            expect(result.bidFloor).toBeLessThan(75);
            expect(result.marketMultiplier).toBeLessThan(1.0);
        });

        it('should clamp market multiplier to ±20%', async () => {
            // ETH at $5000 → raw deviation = +100% → clamped to +20%
            mockEthPrice(5000);

            const result = await dataStreamsService.getRealtimeBidFloor('solar', 'US');

            expect(result.marketMultiplier).toBeLessThanOrEqual(1.20);
            expect(result.marketMultiplier).toBeGreaterThanOrEqual(0.80);
        });

        it('should include ethUsdPrice in the response', async () => {
            mockEthPrice(2750);

            const result = await dataStreamsService.getRealtimeBidFloor('solar', 'US');

            expect(result.ethUsdPrice).toBeCloseTo(2750, 0);
        });

        it('should include confidence score between 0.85 and 1.0', async () => {
            mockEthPrice(2500);

            const result = await dataStreamsService.getRealtimeBidFloor('solar', 'US');

            expect(result.confidence).toBeGreaterThanOrEqual(0.85);
            expect(result.confidence).toBeLessThanOrEqual(1.0);
        });

        it('should return fallback when chain read fails', async () => {
            mockLatestRoundData.mockRejectedValue(new Error('RPC timeout'));

            const result = await dataStreamsService.getRealtimeBidFloor('insurance', 'US');

            // Should still return a result (either cached or default)
            expect(result.vertical).toBe('insurance');
            expect(result.country).toBe('US');
        });

        it('should handle different countries', async () => {
            mockEthPrice(2500);

            const us = await dataStreamsService.getRealtimeBidFloor('solar', 'US');
            const ca = await dataStreamsService.getRealtimeBidFloor('solar', 'CA');
            const gb = await dataStreamsService.getRealtimeBidFloor('solar', 'GB');

            // US solar floor ($85) > CA ($70) > GB ($55)
            expect(us.bidFloor).toBeGreaterThan(ca.bidFloor);
            expect(ca.bidFloor).toBeGreaterThan(gb.bidFloor);
        });
    });

    describe('getLeadPriceIndex', () => {
        it('should return a normalized index for a known vertical', async () => {
            mockEthPrice(2500);

            const result = await dataStreamsService.getLeadPriceIndex('solar');

            expect(result.vertical).toBe('solar');
            expect(result.indexValue).toBeGreaterThan(0);
            expect(result.indexValue).toBeLessThanOrEqual(1000);
        });

        it('should reflect market movement in 24h change', async () => {
            // Bullish market → positive change24h
            mockEthPrice(3000);

            const result = await dataStreamsService.getLeadPriceIndex('solar');

            expect(result.change24h).toBeGreaterThan(0);
        });

        it('should include ethUsdPrice', async () => {
            mockEthPrice(2500);

            const result = await dataStreamsService.getLeadPriceIndex('solar');

            expect(result.ethUsdPrice).toBeCloseTo(2500, 0);
        });
    });

    describe('subscribePriceFeed', () => {
        it('should return a valid feed ID', () => {
            const feedId = dataStreamsService.subscribePriceFeed(
                'solar', 'US', jest.fn(), 100_000 // Long interval to avoid callback
            );

            expect(feedId).toMatch(/^feed_solar_US_/);

            // Cleanup
            dataStreamsService.unsubscribePriceFeed(feedId);
        });

        it('should unsubscribe successfully', () => {
            const feedId = dataStreamsService.subscribePriceFeed(
                'solar', 'US', jest.fn(), 100_000
            );

            expect(dataStreamsService.unsubscribePriceFeed(feedId)).toBe(true);
            expect(dataStreamsService.unsubscribePriceFeed(feedId)).toBe(false); // Already removed
        });
    });

    describe('Multiple verticals', () => {
        it('should return different floors for different verticals', async () => {
            mockEthPrice(2500);

            const solar = await dataStreamsService.getRealtimeBidFloor('solar', 'US');
            const mortgage = await dataStreamsService.getRealtimeBidFloor('mortgage', 'US');
            const legal = await dataStreamsService.getRealtimeBidFloor('legal', 'US');

            // Solar ($85) > Legal ($60) > Mortgage ($25) — base floors differ
            expect(solar.bidFloor).toBeGreaterThan(mortgage.bidFloor);
            expect(legal.bidFloor).toBeGreaterThan(mortgage.bidFloor);
        });
    });
});
