import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'VITE_USE_MOCK_DATA';
const EVENT_NAME = 'mockdata:toggle';

/**
 * Reactive hook for the mock-data toggle.
 *
 * Listens for the custom `mockdata:toggle` event dispatched by DemoPanel
 * so analytics pages re-render instantly when the toggle flips — no
 * page refresh required.
 */
export function useMockData(): [boolean, (next: boolean) => void] {
    const [isMock, setIsMock] = useState(
        () => localStorage.getItem(STORAGE_KEY) === 'true',
    );

    // Listen for toggle events from DemoPanel (same window)
    useEffect(() => {
        const handler = () => {
            setIsMock(localStorage.getItem(STORAGE_KEY) === 'true');
        };
        window.addEventListener(EVENT_NAME, handler);
        // Also catch cross-tab storage changes
        window.addEventListener('storage', (e) => {
            if (e.key === STORAGE_KEY) handler();
        });
        return () => {
            window.removeEventListener(EVENT_NAME, handler);
        };
    }, []);

    const setMock = useCallback((next: boolean) => {
        localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
        window.dispatchEvent(new CustomEvent(EVENT_NAME));
    }, []);

    return [isMock, setMock];
}

export default useMockData;
