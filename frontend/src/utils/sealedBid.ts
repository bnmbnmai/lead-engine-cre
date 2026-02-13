import { formatCurrency } from '@/lib/utils';

/**
 * Retrieve the amount of a sealed bid from localStorage.
 * When a sealed bid is placed, the amount and salt are stored locally
 * keyed by the commitment hash. Returns null if not found.
 */
export function getSealedBidAmount(commitment: string | undefined | null): number | null {
    if (!commitment) return null;
    try {
        const stored = localStorage.getItem(`bid_salt_${commitment}`);
        if (!stored) return null;
        const { amount } = JSON.parse(stored);
        return typeof amount === 'number' ? amount : null;
    } catch {
        return null;
    }
}

/**
 * Format a sealed bid amount for display.
 * Returns a formatted string with 🔒 prefix, or 'Hidden' if amount unavailable.
 */
export function formatSealedBid(commitment: string | undefined | null): {
    display: string;
    amount: number | null;
    isRevealed: boolean;
} {
    const amount = getSealedBidAmount(commitment);
    if (amount !== null) {
        return { display: `🔒 ${formatCurrency(amount)}`, amount, isRevealed: true };
    }
    return { display: 'Hidden', amount: null, isRevealed: false };
}
