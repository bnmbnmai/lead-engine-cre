import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(amount);
}

export function formatNumber(num: number): string {
    return new Intl.NumberFormat('en-US').format(num);
}

export function shortenAddress(address: string, chars = 4): string {
    return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatTimeRemaining(endTime: Date | string): string {
    const end = new Date(endTime).getTime();
    const now = Date.now();
    const diff = end - now;

    if (diff <= 0) return 'Ended';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    if (hours > 24) {
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    }

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    return `${minutes}m ${seconds}s`;
}

export function getStatusColor(status: string): string {
    const colors: Record<string, string> = {
        PENDING: 'bg-yellow-500/20 text-yellow-500',
        IN_AUCTION: 'bg-blue-500/20 text-blue-500',
        REVEAL_PHASE: 'bg-purple-500/20 text-purple-500',
        SOLD: 'bg-green-500/20 text-green-500',
        EXPIRED: 'bg-gray-500/20 text-gray-500',
        CANCELLED: 'bg-red-500/20 text-red-500',
        ACCEPTED: 'bg-green-500/20 text-green-500',
        OUTBID: 'bg-orange-500/20 text-orange-500',
        REVEALED: 'bg-blue-500/20 text-blue-500',
    };
    return colors[status] || 'bg-gray-500/20 text-gray-500';
}
