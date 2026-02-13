/**
 * VerticalSelector — Marketplace vertical filter
 *
 * Thin wrapper around NestedVerticalSelect with marketplace-specific defaults:
 *  - "All Verticals" option enabled
 *  - "Suggest New" footer enabled
 *  - Fixed-width trigger for toolbar layout
 */

import { NestedVerticalSelect } from '@/components/ui/NestedVerticalSelect';

interface VerticalSelectorProps {
    value: string;
    onValueChange: (slug: string) => void;
    placeholder?: string;
    disabled?: boolean;
    showSuggest?: boolean;
    onSuggestClick?: () => void;
    className?: string;
}

export function VerticalSelector({
    value,
    onValueChange,
    placeholder = 'All Verticals',
    disabled = false,
    showSuggest = false,
    onSuggestClick,
    className,
}: VerticalSelectorProps) {
    return (
        <NestedVerticalSelect
            value={value}
            onValueChange={onValueChange}
            placeholder={placeholder}
            disabled={disabled}
            showAllOption
            showSuggest={showSuggest}
            onSuggestClick={onSuggestClick}
            className={className}
            triggerClassName="w-[220px] sm:w-[260px] h-9"
        />
    );
}

export default VerticalSelector;
