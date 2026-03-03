/**
 * useDemo — Custom hook for One-Click Full On-Chain Demo
 *
 * Manages: start/stop/status, streaming logs from demo:log,
 * progress tracking, and completion state.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import socketClient from '@/lib/socket';
import { toast } from '@/hooks/useToast';

const LS_KEY = 'demo:partialResults';

function lsRead(): PartialResults | null {
    try {
        const raw = localStorage.getItem(LS_KEY);
        return raw ? (JSON.parse(raw) as PartialResults) : null;
    } catch { return null; }
}

function lsWrite(data: PartialResults | null) {
    try {
        if (data) localStorage.setItem(LS_KEY, JSON.stringify(data));
        else localStorage.removeItem(LS_KEY);
    } catch { /* non-fatal */ }
}

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
    isRecycling: boolean;       // true while background recycle is in-flight
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
    const navigate = useNavigate();
    const [isRunning, setIsRunning] = useState(false);
    const [isComplete, setIsComplete] = useState(false);
    const [isRecycling, setIsRecycling] = useState(false);
    const [logs, setLogs] = useState<DemoLogEntry[]>([]);
    const [runId, setRunId] = useState<string | null>(null);
    const [completedRunId, setCompletedRunId] = useState<string | null>(null);
    const [partialResults, setPartialResultsState] = useState<PartialResults | null>(() => lsRead());
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

    // Wrapper that syncs partialResults to localStorage every time state changes
    const setPartialResults = useCallback((value: PartialResults | null) => {
        setPartialResultsState(value);
        lsWrite(value);
    }, []);

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

    // Subscribe to demo:results-ready — fires BEFORE recycle starts, carries full cycle data.
    // Immediately navigates to the results page and marks recycling as in-progress.
    useEffect(() => {
        const unsub = socketClient.on('demo:results-ready', (data: any) => {
            setIsComplete(true);
            setIsRunning(false);
            setIsRecycling(true);           // recycle is about to start in background
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
            // Add recycling start to On-Chain Log so the user sees it
            setLogs(prev => [...prev, {
                ts: new Date().toISOString(), level: 'info' as const,
                message: '♻️ Recycling wallets + bounty pools in background…',
            }]);
            toast({
                type: 'success',
                title: '⚡ Results Ready!',
                description: `${data.totalCycles} cycles · $${data.totalSettled} settled · Wallets recycling in background`,
            });
            // Navigate immediately — results page renders from partialResults, no wait
            navigate('/demo/results');
        });

        return unsub;
    }, [navigate]);

    // Subscribe to demo:recycle-complete — clears the recycling indicator
    useEffect(() => {
        const unsub = socketClient.on('demo:recycle-complete', () => {
            setIsRecycling(false);
            setRecyclePercent(100);
            setProgress(prev => ({ ...prev, phase: 'done' }));
            // Add recycling complete to On-Chain Log
            setLogs(prev => [...prev, {
                ts: new Date().toISOString(), level: 'success' as const,
                message: '✅ Wallets recycled — ready for next demo run',
            }]);
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

    // Check initial status on mount — hydrate BOTH running and recycling
    useEffect(() => {
        api.demoFullE2EStatus().then(({ data }) => {
            if (data?.running || data?.recycling) {
                setIsRunning(Boolean(data.running));
                setIsRecycling(Boolean(data.recycling));
                if (data.recycling) {
                    setProgress(prev => ({ ...prev, phase: 'recycling' }));
                }
            }
        }).catch(() => { /* ignore */ });
    }, []);

    // Periodic sync while recycling — catches missed socket events (disconnect/reconnect)
    useEffect(() => {
        if (!isRecycling) return;
        const interval = setInterval(() => {
            api.demoFullE2EStatus().then(({ data }) => {
                if (!data?.recycling) {
                    setIsRecycling(false);
                    setRecyclePercent(100);
                    setProgress(prev => ({ ...prev, phase: 'done' }));
                    setLogs(prev => [...prev, {
                        ts: new Date().toISOString(), level: 'success' as const,
                        message: '✅ Wallets recycled — ready for next demo run',
                    }]);
                }
            }).catch(() => { });
        }, 10_000);
        return () => clearInterval(interval);
    }, [isRecycling]);

    const startDemo = useCallback(async (cycles?: number) => {
        if (isRunning) return;

        setLogs([]);
        setCompletedRunId(null);
        setPartialResults(null);
        setRecyclePercent(0);
        setIsRecycling(false);
        setIsRunning(true);
        setIsComplete(false);
        setProgress({ currentCycle: 0, totalCycles: cycles || 5, percent: 0, phase: 'starting' });

        try {
            const { data, error } = await api.demoFullE2EStart(cycles);
            if (error) {
                // User-friendly message when server rejects because recycling is active
                const errStr = typeof error === 'object' && 'error' in error ? (error as any).error : String(error);
                const isRecyclingErr = errStr?.includes?.('redistribution') || errStr?.includes?.('recycling');
                toast({
                    type: isRecyclingErr ? 'info' : 'error',
                    title: isRecyclingErr ? 'Wallets Still Recycling' : 'Failed to start demo',
                    description: isRecyclingErr ? 'Please wait ~30s for wallet recycling to complete' : errStr,
                });
                setIsRunning(false);
                if (isRecyclingErr) setIsRecycling(true); // re-gate the button
                setProgress(prev => ({ ...prev, phase: isRecyclingErr ? 'recycling' : 'idle' }));
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
        setIsRecycling(false);
        setPartialResults(null);
        setRecyclePercent(0);
        setProgress({ currentCycle: 0, totalCycles: 0, percent: 0, phase: 'idle' });
    }, []);

    return {
        isRunning,
        isComplete,
        isRecycling,
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
