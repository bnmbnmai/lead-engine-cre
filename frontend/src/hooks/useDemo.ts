/**
 * useDemo — Custom hook for One-Click Full On-Chain Demo
 *
 * Manages: start/stop/status, streaming logs from demo:log,
 * and navigation to results page on demo:complete.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/lib/api';
import socketClient from '@/lib/socket';
import { toast } from '@/hooks/useToast';

export interface DemoLogEntry {
    ts: string;
    level: 'info' | 'success' | 'warn' | 'error' | 'step';
    message: string;
    txHash?: string;
    basescanLink?: string;
    data?: Record<string, any>;
    cycle?: number;
    totalCycles?: number;
}

export interface UseDemoReturn {
    isRunning: boolean;
    logs: DemoLogEntry[];
    runId: string | null;
    completedRunId: string | null;
    startDemo: (cycles?: number) => Promise<void>;
    stopDemo: () => Promise<void>;
    clearLogs: () => void;
}

export function useDemo(): UseDemoReturn {
    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState<DemoLogEntry[]>([]);
    const [runId, setRunId] = useState<string | null>(null);
    const [completedRunId, setCompletedRunId] = useState<string | null>(null);
    const logsRef = useRef<DemoLogEntry[]>([]);

    // Keep ref in sync for callbacks
    logsRef.current = logs;

    // Subscribe to demo:log events
    useEffect(() => {
        const unsub = socketClient.on('demo:log', (data: any) => {
            const entry: DemoLogEntry = {
                ts: data.ts || new Date().toISOString(),
                level: data.level || 'info',
                message: data.message || '',
                txHash: data.txHash,
                basescanLink: data.basescanLink,
                data: data.data,
                cycle: data.cycle,
                totalCycles: data.totalCycles,
            };
            setLogs(prev => {
                const next = [...prev, entry];
                // Keep last 500 entries
                return next.length > 500 ? next.slice(-500) : next;
            });
        });

        return unsub;
    }, []);

    // Subscribe to demo:complete events
    useEffect(() => {
        const unsub = socketClient.on('demo:complete', (data: any) => {
            setIsRunning(false);
            setCompletedRunId(data.runId);
            setRunId(data.runId);

            if (data.status === 'completed') {
                toast({
                    type: 'success',
                    title: 'Demo Complete! 🎉',
                    description: `${data.totalCycles} cycles completed — $${data.totalSettled} settled on-chain`,
                });
            } else if (data.status === 'aborted') {
                toast({
                    type: 'info',
                    title: 'Demo Stopped',
                    description: 'Demo was aborted by user',
                });
            } else {
                toast({
                    type: 'error',
                    title: 'Demo Failed',
                    description: data.error || 'Unknown error',
                });
            }
        });

        return unsub;
    }, []);

    // Check initial status on mount
    useEffect(() => {
        api.demoFullE2EStatus().then(({ data }) => {
            if (data?.running) {
                setIsRunning(true);
            }
        }).catch(() => { /* ignore */ });
    }, []);

    const startDemo = useCallback(async (cycles?: number) => {
        if (isRunning) return;

        setLogs([]);
        setCompletedRunId(null);
        setIsRunning(true);

        try {
            const { data, error } = await api.demoFullE2EStart(cycles);
            if (error) {
                toast({ type: 'error', title: 'Failed to start demo', description: String(error) });
                setIsRunning(false);
                return;
            }
            toast({
                type: 'info',
                title: '🚀 Demo Started',
                description: data?.message || 'Running on-chain demo...',
            });
        } catch (err: any) {
            toast({ type: 'error', title: 'Failed to start demo', description: err.message });
            setIsRunning(false);
        }
    }, [isRunning]);

    const stopDemo = useCallback(async () => {
        try {
            await api.demoFullE2EStop();
            toast({ type: 'info', title: 'Stopping demo...', description: 'Abort signal sent' });
        } catch (err: any) {
            toast({ type: 'error', title: 'Failed to stop demo', description: err.message });
        }
    }, []);

    const clearLogs = useCallback(() => {
        setLogs([]);
        setCompletedRunId(null);
    }, []);

    return {
        isRunning,
        logs,
        runId,
        completedRunId,
        startDemo,
        stopDemo,
        clearLogs,
    };
}
