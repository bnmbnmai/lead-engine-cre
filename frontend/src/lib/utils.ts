import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a number as USD currency.
 */
export function formatCurrency(amount: number | string | null | undefined): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0);
  if (isNaN(num)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Map a lead / bid / ask status to a Tailwind color class string.
 */
export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    // Lead statuses
    PENDING_AUCTION: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    IN_AUCTION: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    REVEAL_PHASE: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    SOLD: 'bg-green-500/10 text-green-500 border-green-500/20',
    UNSOLD: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    EXPIRED: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    CANCELLED: 'bg-red-500/10 text-red-400 border-red-500/20',
    DISPUTED: 'bg-orange-500/10 text-orange-500 border-orange-500/20',

    // Bid statuses
    PENDING: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    REVEALED: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    ACCEPTED: 'bg-green-500/10 text-green-500 border-green-500/20',
    OUTBID: 'bg-red-500/10 text-red-400 border-red-500/20',
    REJECTED: 'bg-red-500/10 text-red-400 border-red-500/20',
    WITHDRAWN: 'bg-gray-500/10 text-gray-400 border-gray-500/20',

    // Ask statuses
    ACTIVE: 'bg-green-500/10 text-green-500 border-green-500/20',
    PAUSED: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  };
  return map[status] || 'bg-gray-500/10 text-gray-400 border-gray-500/20';
}

/**
 * Format a future date/timestamp as a human-readable countdown.
 */
export function formatTimeRemaining(endTime: string | Date): string {
  const end = typeof endTime === 'string' ? new Date(endTime) : endTime;
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();

  if (diffMs <= 0) return 'Ended';

  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Shorten an Ethereum address for display.
 * e.g. "0x1234567890abcdef..." → "0x1234…cdef"
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}
