/**
 * useFormPersistence — Saves/restores form state via sessionStorage.
 *
 * Persists `formData` and `currentStep` on every change, restores on mount.
 * Clears on explicit `clear()` (called after successful submit).
 */

import { useEffect, useCallback, useRef } from 'react';

interface UseFormPersistenceOpts {
    slug: string;
    formData: Record<string, string | boolean>;
    currentStep: number;
    setFormData: (data: Record<string, string | boolean>) => void;
    setCurrentStep: (step: number) => void;
    enabled?: boolean;
}

const KEY_PREFIX = 'form_persist:';

export function useFormPersistence({
    slug,
    formData,
    currentStep,
    setFormData,
    setCurrentStep,
    enabled = true,
}: UseFormPersistenceOpts) {
    const key = `${KEY_PREFIX}${slug}`;
    const restored = useRef(false);

    // Restore on mount (once)
    useEffect(() => {
        if (!enabled || restored.current) return;
        restored.current = true;
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (saved.formData && typeof saved.formData === 'object') {
                setFormData(saved.formData);
            }
            if (typeof saved.currentStep === 'number' && saved.currentStep >= 0) {
                setCurrentStep(saved.currentStep);
            }
        } catch {
            // Corrupted data — ignore
        }
    }, [key, enabled, setFormData, setCurrentStep]);

    // Persist on every change
    useEffect(() => {
        if (!enabled) return;
        try {
            sessionStorage.setItem(key, JSON.stringify({ formData, currentStep }));
        } catch {
            // Storage full — silently fail
        }
    }, [key, enabled, formData, currentStep]);

    // Clear (call after submit)
    const clear = useCallback(() => {
        try { sessionStorage.removeItem(key); } catch { /* noop */ }
    }, [key]);

    return { clear };
}
