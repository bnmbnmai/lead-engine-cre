/**
 * useDemo — Custom hook for One-Click Full On-Chain Demo
 *
 * Manages: start/stop/status, streaming logs from demo:log,
 * progress tracking, and completion state.
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

export interface DemoProgress {
    currentCycle: number;
    totalCycles: number;
    percent: number;
    phase: string;
}

export interface PartialResults {
    runId: string;
    totalSettled: number;
    totalCycles: number;
    elapsedSec?: number;
    cycles: any[];
}

export interface UseDemoReturn {
    isRunning: boolean;
    isComplete: boolean;
    logs: DemoLogEntry[];
    runId: string | null;
    completedRunId: string | null;
    progress: DemoProgress;
    partialResults: PartialResults | null;
    recyclePercent: number;
    startDemo: (cycles?: number) => Promise<void>;
    stopDemo: () => Promise<void>;
    clearLogs: () => void;
}

export function useDemo(): UseDemoReturn {
    const [isRunning, setIsRunning] = useState(false);
    const [isComplete, setIsComplete] = useState(false);
    const [logs, setLogs] = useState<DemoLogEntry[]>([]);
    const [runId, setRunId] = useState<string | null>(null);
    const [completedRunId, setCompletedRunId] = useState<string | null>(null);
    const [partialResults, setPartialResults] = useState<PartialResults | null>(null);
    const [recyclePercent, setRecyclePercent] = useState(0);
    const [progress, setProgress] = useState<DemoProgress>({
        currentCycle: 0,
        totalCycles: 0,
        percent: 0,
        phase: 'idle',
    });
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

            // Update progress from cycle data
            if (data.cycle != null && data.totalCycles != null) {
                setProgress({
                    currentCycle: data.cycle,
                    totalCycles: data.totalCycles,
                    percent: Math.round((data.cycle / data.totalCycles) * 100),
                    phase: data.level === 'step' ? 'processing' : 'on-chain',
                });
            }

            // Detect seeding phase
            if (data.message?.includes('Seeding marketplace')) {
                setProgress(prev => ({ ...prev, phase: 'seeding' }));
            }
        });

        return unsub;
    }, []);

    // Subscribe to demo:complete events
    useEffect(() => {
        const unsub = socketClient.on('demo:complete', (data: any) => {
            setIsRunning(false);
            setIsComplete(true);
            setCompletedRunId(data.runId);
            setRunId(data.runId);
            setProgress(prev => ({
                ...prev,
                percent: 100,
                phase: data.status === 'completed' ? 'done' : data.status,
            }));

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

    // Subscribe to demo:results-ready — fires BEFORE recycle starts, carries partial cycle data.
    // Allows the frontend to show results immediately without waiting for wallet recycling.
    useEffect(() => {
        const unsub = socketClient.on('demo:results-ready', (data: any) => {
            setIsComplete(true);
            setIsRunning(false);
            setCompletedRunId(data.runId);
            setRunId(data.runId);
            setPartialResults({
                runId: data.runId,
                totalSettled: data.totalSettled,
                totalCycles: data.totalCycles,
                elapsedSec: data.elapsedSec,
                cycles: data.cycles ?? [],
            });
            setProgress(prev => ({ ...prev, percent: 100, phase: 'recycling' }));
            toast({
                type: 'success',
                title: '⚡ Results Ready!',
                description: `${data.totalCycles} cycles · $${data.totalSettled} settled · Wallets recycling in background`,
            });
        });

        return unsub;
    }, []);

    // Subscribe to demo:recycle-progress — shows live recycle completion %
    useEffect(() => {
        const unsub = socketClient.on('demo:recycle-progress', (data: any) => {
            setRecyclePercent(data.percent ?? 0);
            setProgress(prev => ({ ...prev, phase: 'recycling' }));
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
        setPartialResults(null);
        setRecyclePercent(0);
        setIsRunning(true);
        setIsComplete(false);
        setProgress({ currentCycle: 0, totalCycles: cycles || 5, percent: 0, phase: 'starting' });

        try {
            const { data, error } = await api.demoFullE2EStart(cycles);
            if (error) {
                toast({ type: 'error', title: 'Failed to start demo', description: String(error) });
                setIsRunning(false);
                setProgress(prev => ({ ...prev, phase: 'idle' }));
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
            setProgress(prev => ({ ...prev, phase: 'idle' }));
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
        setIsComplete(false);
        setPartialResults(null);
        setRecyclePercent(0);
        setProgress({ currentCycle: 0, totalCycles: 0, percent: 0, phase: 'idle' });
    }, []);

    return {
        isRunning,
        isComplete,
        logs,
        runId,
        completedRunId,
        progress,
        partialResults,
        recyclePercent,
        startDemo,
        stopDemo,
        clearLogs,
    };
}
