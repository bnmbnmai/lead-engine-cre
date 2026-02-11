/**
 * ChainlinkBadge — visual indicator for Chainlink oracle verification
 * 
 * Shown on verified leads to highlight the Chainlink integration.
 * Uses the Chainlink brand blue (#375BD2) with a hexagon icon.
 */

interface ChainlinkBadgeProps {
    size?: 'sm' | 'md';
    showLabel?: boolean;
    className?: string;
}

export function ChainlinkBadge({ size = 'sm', showLabel = true, className = '' }: ChainlinkBadgeProps) {
    const isSmall = size === 'sm';

    return (
        <span
            className={`inline-flex items-center gap-1 ${isSmall ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'
                } rounded-full bg-[#375BD2]/15 text-[#6B93F5] border border-[#375BD2]/25 font-medium ${className}`}
            title="Lead data verified via Chainlink oracle network"
        >
            {/* Hexagon icon representing Chainlink */}
            <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className={isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5'}
                aria-hidden="true"
            >
                <path d="M12 1.5L3 7v10l9 5.5L21 17V7L12 1.5zM12 4.31l6 3.67v7.04l-6 3.67-6-3.67V7.98l6-3.67z" />
                <path d="M12 8l-4 2.45v4.1L12 17l4-2.45v-4.1L12 8z" />
            </svg>
            {showLabel && (
                <span>{isSmall ? 'Verified' : 'Chainlink Verified'}</span>
            )}
        </span>
    );
}

export default ChainlinkBadge;
