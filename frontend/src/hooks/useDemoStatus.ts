/**
 * useDemoStatus — Global shared demo state for ALL viewers.
 *
 * Unlike useDemo (which is local to the tab that launched the demo),
 * this hook connects to the socket (as GUEST-safe) and listens for
 * `demo:status` broadcasts emitted by the backend on:
 *   - Demo start    → { running: true,  ... }
 *   - Demo complete → { running: false, ... }
 *   - Demo abort    → { running: false, ... }
 *
 * Also polls the HTTP status endpoint on mount to hydrate from server
 * state (handles page-reload-while-running and cold-boot scenarios).
 *
 * Used by DemoButtonBanner to disable the Run Demo button for every
 * persona/viewer when a demo is already in progress.
 */

import { useState, useEffect } from 'react';
import socketClient from '@/lib/socket';
import api from '@/lib/api';

export interface DemoStatusState {
    /** Is a demo currently running on the server? */
    isRunning: boolean;
    /** Is post-demo token recycling in progress? */
    isRecycling: boolean;
    currentCycle: number;
    totalCycles: number;
    percent: number;
    phase: string;
    runId?: string;
}

const DEFAULT_STATE: DemoStatusState = {
    isRunning: false,
    isRecycling: false,
    currentCycle: 0,
    totalCycles: 0,
    percent: 0,
    phase: 'idle',
};

export function useDemoStatus(): DemoStatusState {
    const [status, setStatus] = useState<DemoStatusState>(DEFAULT_STATE);

    // ── Socket: real-time status broadcast ──────────────
    useEffect(() => {
        // Connect as GUEST-safe — no auth token required
        socketClient.connect();

        const unsub = socketClient.on('demo:status', (data: any) => {
            setStatus({
                isRunning: Boolean(data.running),
                isRecycling: Boolean(data.recycling),
                currentCycle: data.currentCycle ?? 0,
                totalCycles: data.totalCycles ?? 0,
                percent: data.percent ?? 0,
                phase: data.phase ?? (data.running ? 'running' : 'idle'),
                runId: data.runId,
            });
        });

        return unsub;
    }, []);

    // ── HTTP poll on mount: hydrate from server state ───
    // Handles: page reload while demo is running, cold-boot reconnect.
    useEffect(() => {
        api.demoFullE2EStatus()
            .then(({ data }) => {
                if (data?.running) {
                    setStatus(prev => ({ ...prev, isRunning: true }));
                }
            })
            .catch(() => { /* ignore — backend may be asleep */ });
    }, []);

    return status;
}
