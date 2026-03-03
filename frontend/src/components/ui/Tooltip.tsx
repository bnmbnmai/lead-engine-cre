/**
 * Tooltip — pure CSS tooltip (no Radix dependency needed)
 * 
 * Usage:
 *   <Tooltip content="Minimum accepted bid amount">
 *       <span>Reserve Price</span>
 *   </Tooltip>
 *
 * Single-line by default (w-max whitespace-nowrap).
 * Pass wrap={true} for long multi-line content.
 */

import { ReactNode, useState } from 'react';

interface TooltipProps {
    content: string;
    children: ReactNode;
    side?: 'top' | 'bottom';
    align?: 'center' | 'right';
    className?: string;
    /** When true, text wraps with max-w-sm. Default: single-line w-max. */
    wrap?: boolean;
}

export function Tooltip({ content, children, side = 'top', align = 'center', className = '', wrap = false }: TooltipProps) {
    const [visible, setVisible] = useState(false);

    const alignCls = align === 'right'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';

    const sizeCls = wrap
        ? 'max-w-sm whitespace-normal'
        : 'w-max whitespace-nowrap';

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
                    className={`absolute z-[9999] px-2.5 py-1.5 text-xs font-medium text-white bg-[#1a1a2e] border border-white/10 rounded-lg shadow-xl ${sizeCls} pointer-events-none animate-in fade-in-0 zoom-in-95 duration-150 ${side === 'top'
                        ? `bottom-full ${alignCls} mb-2`
                        : `top-full ${alignCls} mt-2`
                        }`}
                >
                    {content}
                </span>
            )}
        </span>
    );
}

export default Tooltip;
