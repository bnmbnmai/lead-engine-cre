/**
 * Tooltip — pure CSS tooltip (no Radix dependency needed)
 * 
 * Usage:
 *   <Tooltip content="Minimum accepted bid amount">
 *       <span>Reserve Price</span>
 *   </Tooltip>
 */

import { ReactNode, useState } from 'react';

interface TooltipProps {
    content: string;
    children: ReactNode;
    side?: 'top' | 'bottom';
    className?: string;
}

export function Tooltip({ content, children, side = 'top', className = '' }: TooltipProps) {
    const [visible, setVisible] = useState(false);

    return (
        <span
            className={`relative inline-flex ${className}`}
            onMouseEnter={() => setVisible(true)}
            onMouseLeave={() => setVisible(false)}
            onFocus={() => setVisible(true)}
            onBlur={() => setVisible(false)}
        >
            {children}
            {visible && (
                <span
                    role="tooltip"
                    className={`absolute z-[100] px-2.5 py-1.5 text-xs font-medium text-white bg-[#1a1a2e] border border-white/10 rounded-lg shadow-xl max-w-[220px] whitespace-normal pointer-events-none animate-in fade-in-0 zoom-in-95 duration-150 ${side === 'top'
                        ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
                        : 'top-full left-1/2 -translate-x-1/2 mt-2'
                        }`}
                >
                    {content}
                </span>
            )}
        </span>
    );
}

export default Tooltip;
