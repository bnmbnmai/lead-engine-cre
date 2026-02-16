/**
 * Fee Calculation Utility
 *
 * Centralised fee logic for the Lead Engine platform.
 * All transaction-creation sites should use calculateFees() instead
 * of hard-coding the 2.5% platform fee.
 *
 * Fee model:
 *  - Manual (browser) wins:  2.5% platform fee, $0 convenience fee
 *  - Auto-bid engine wins:   2.5% platform fee + $2 convenience fee
 *  - API / MCP agent wins:   2.5% platform fee + $2 convenience fee
 */

// ─── Constants ──────────────────────────────

/** Platform fee as a decimal rate (2.5%) */
export const PLATFORM_FEE_RATE = 0.025;

/** Flat convenience fee for server-side (non-MetaMask) wins */
export const CONVENIENCE_FEE = 2.0;

// ─── Types ──────────────────────────────────

export type BidSourceType = 'MANUAL' | 'AUTO_BID' | 'AGENT';

export interface FeeResult {
    platformFee: number;
    convenienceFee: number;
    convenienceFeeType: string | null;
    totalFees: number;
    /** Total amount the buyer is charged (sale price + convenience fee) */
    totalBuyerCharge: number;
}

// ─── Calculator ─────────────────────────────

/**
 * Calculate all fees for a given sale amount and bid source.
 *
 * @param amount  Sale price in USDC
 * @param source  How the winning bid was placed (default: MANUAL)
 * @returns       Broken-down fee object
 */
export function calculateFees(
    amount: number,
    source: BidSourceType = 'MANUAL',
): FeeResult {
    const platformFee = +(amount * PLATFORM_FEE_RATE).toFixed(2);
    const isServerSide = source === 'AUTO_BID' || source === 'AGENT';
    const convenienceFee = isServerSide ? CONVENIENCE_FEE : 0;
    const convenienceFeeType =
        source === 'AUTO_BID'
            ? 'AUTOBID'
            : source === 'AGENT'
                ? 'API'
                : null;

    return {
        platformFee,
        convenienceFee,
        convenienceFeeType,
        totalFees: +(platformFee + convenienceFee).toFixed(2),
        totalBuyerCharge: +(amount + convenienceFee).toFixed(2),
    };
}
