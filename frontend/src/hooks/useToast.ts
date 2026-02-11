import { useSyncExternalStore } from 'react';

// ============================================
// Toast Types
// ============================================

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface Toast {
    id: string;
    type: ToastType;
    title: string;
    description?: string;
    duration?: number;
}

// ============================================
// Global toast store (pub/sub — no external deps)
// ============================================

type Listener = () => void;
let toasts: Toast[] = [];
const listeners = new Set<Listener>();
let toastId = 0;

function emitChange() {
    listeners.forEach((l) => l());
}

function subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getSnapshot() {
    return toasts;
}

export function toast(opts: Omit<Toast, 'id'>) {
    const id = `toast-${++toastId}`;
    const duration = opts.duration ?? 5000;
    const entry: Toast = { ...opts, id, duration };
    toasts = [entry, ...toasts].slice(0, 5); // Max 5 visible
    emitChange();

    if (duration > 0) {
        setTimeout(() => dismissToast(id), duration);
    }
    return id;
}

export function dismissToast(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
    emitChange();
}

// ============================================
// React hook
// ============================================

export function useToast() {
    const currentToasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return { toasts: currentToasts, toast, dismissToast };
}

export default useToast;
