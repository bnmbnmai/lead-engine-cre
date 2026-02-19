/**
 * Fee Calculation Unit Tests
 *
 * Tests for the centralised calculateFees() utility.
 */

import {
    calculateFees,
    PLATFORM_FEE_RATE,
    CONVENIENCE_FEE,
    type BidSourceType,
    type FeeResult,
} from '../../src/lib/fees';

describe('calculateFees', () => {
    // ── Manual (browser) bids ──

    it('should return 5% platform fee with no convenience fee for MANUAL', () => {
        const result = calculateFees(100, 'MANUAL');
        expect(result.platformFee).toBe(5);
        expect(result.convenienceFee).toBe(0);
        expect(result.convenienceFeeType).toBeNull();
        expect(result.totalFees).toBe(5);
        expect(result.totalBuyerCharge).toBe(100);  // no convenience fee
    });

    it('should default to MANUAL when no source is provided', () => {
        const result = calculateFees(200);
        expect(result.platformFee).toBe(10);
        expect(result.convenienceFee).toBe(0);
        expect(result.convenienceFeeType).toBeNull();
        expect(result.totalFees).toBe(10);
        expect(result.totalBuyerCharge).toBe(200);
    });

    // ── Auto-bid wins ──

    it('should add $1 convenience fee for AUTO_BID', () => {
        const result = calculateFees(100, 'AUTO_BID');
        expect(result.platformFee).toBe(5);
        expect(result.convenienceFee).toBe(1);
        expect(result.convenienceFeeType).toBe('AUTOBID');
        expect(result.totalFees).toBe(6);
        expect(result.totalBuyerCharge).toBe(101);  // 100 + $1
    });

    // ── API / Agent wins ──

    it('should add $1 convenience fee for AGENT', () => {
        const result = calculateFees(100, 'AGENT');
        expect(result.platformFee).toBe(5);
        expect(result.convenienceFee).toBe(1);
        expect(result.convenienceFeeType).toBe('API');
        expect(result.totalFees).toBe(6);
        expect(result.totalBuyerCharge).toBe(101);  // 100 + $1
    });

    // ── Edge cases ──

    it('should handle $0 amount', () => {
        const result = calculateFees(0, 'MANUAL');
        expect(result.platformFee).toBe(0);
        expect(result.convenienceFee).toBe(0);
        expect(result.totalFees).toBe(0);
    });

    it('should handle $0 amount with AUTO_BID (still adds convenience fee)', () => {
        const result = calculateFees(0, 'AUTO_BID');
        expect(result.platformFee).toBe(0);
        expect(result.convenienceFee).toBe(1);
        expect(result.totalFees).toBe(1);
    });

    it('should handle large amounts with correct decimal precision', () => {
        const result = calculateFees(9999.99, 'MANUAL');
        expect(result.platformFee).toBe(500);  // 9999.99 * 0.05 = 499.9995 → 500.00
        expect(result.totalFees).toBe(500);
    });

    it('should handle fractional amounts', () => {
        const result = calculateFees(33.33, 'AUTO_BID');
        expect(result.platformFee).toBe(1.67);  // 33.33 * 0.05 = 1.6665 → 1.67
        expect(result.convenienceFee).toBe(1);
        expect(result.totalFees).toBe(2.67);
    });

    // ── Constants ──

    it('should export correct constants', () => {
        expect(PLATFORM_FEE_RATE).toBe(0.05);
        expect(CONVENIENCE_FEE).toBe(1);
    });

    // ── All three sources produce consistent structure ──

    it('should return consistent FeeResult shape for all sources', () => {
        const sources: BidSourceType[] = ['MANUAL', 'AUTO_BID', 'AGENT'];
        for (const source of sources) {
            const result = calculateFees(100, source);
            expect(result).toHaveProperty('platformFee');
            expect(result).toHaveProperty('convenienceFee');
            expect(result).toHaveProperty('convenienceFeeType');
            expect(result).toHaveProperty('totalFees');
            expect(result).toHaveProperty('totalBuyerCharge');
            expect(typeof result.platformFee).toBe('number');
            expect(typeof result.convenienceFee).toBe('number');
            expect(typeof result.totalFees).toBe('number');
            expect(typeof result.totalBuyerCharge).toBe('number');
        }
    });
});
