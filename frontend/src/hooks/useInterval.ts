import { useEffect, useRef } from 'react';

/**
 * useInterval — Dan Abramov pattern
 * Runs a callback at a fixed interval. Pass `null` as delay to pause.
 */
export function useInterval(callback: () => void, delay: number | null) {
    const savedCallback = useRef(callback);

    // Remember the latest callback
    useEffect(() => {
        savedCallback.current = callback;
    }, [callback]);

    // Set up the interval
    useEffect(() => {
        if (delay === null) return;
        const id = setInterval(() => savedCallback.current(), delay);
        return () => clearInterval(id);
    }, [delay]);
}

export default useInterval;
