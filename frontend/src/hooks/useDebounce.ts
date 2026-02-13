import { useState, useEffect } from 'react';

/**
 * useDebounce — Debounces a value by the given delay.
 *
 * Usage:
 *   const [search, setSearch] = useState('');
 *   const debouncedSearch = useDebounce(search, 300);
 *   // debouncedSearch updates 300ms after the last setSearch call
 */
export function useDebounce<T>(value: T, delayMs = 300): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);

    return debounced;
}

export default useDebounce;
