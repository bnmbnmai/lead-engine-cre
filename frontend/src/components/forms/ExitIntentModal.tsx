/**
 * ExitIntentModal — "Don't lose your progress!" overlay.
 *
 * Fires on desktop `mouseleave` (top of viewport) or mobile back-button.
 * Only shows once per session (tracked via sessionStorage).
 * Seller can toggle via CROConfig.showExitIntent.
 */

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';

interface ExitIntentModalProps {
    accentColor: string;
    bgColor: string;
    textColor: string;
    /** Number of fields the user has filled so far */
    filledFieldCount: number;
    /** Total fields across all steps */
    totalFieldCount: number;
}

const STORAGE_KEY = 'exit_intent_shown';
const ANIM_ID = 'exit-intent-anims';

function ensureAnimations() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(ANIM_ID)) return;
    const s = document.createElement('style');
    s.id = ANIM_ID;
    s.textContent = `
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(s);
}

export default function ExitIntentModal({
    accentColor,
    bgColor,
    textColor,
    filledFieldCount,
    totalFieldCount,
}: ExitIntentModalProps) {
    ensureAnimations();
    const [show, setShow] = useState(false);

    const handleMouseLeave = useCallback((e: MouseEvent) => {
        if (e.clientY > 10) return; // Only trigger when leaving from the top
        if (filledFieldCount === 0) return; // Only if user has started filling
        if (sessionStorage.getItem(STORAGE_KEY)) return;
        sessionStorage.setItem(STORAGE_KEY, '1');
        setShow(true);
    }, [filledFieldCount]);

    useEffect(() => {
        if (sessionStorage.getItem(STORAGE_KEY)) return;
        document.addEventListener('mouseleave', handleMouseLeave);
        return () => document.removeEventListener('mouseleave', handleMouseLeave);
    }, [handleMouseLeave]);

    if (!show) return null;

    const pct = totalFieldCount > 0 ? Math.round((filledFieldCount / totalFieldCount) * 100) : 0;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                backgroundColor: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                animation: 'fadeIn 0.3s ease-out',
            }}
            onClick={() => setShow(false)}
        >
            <div
                style={{
                    backgroundColor: bgColor,
                    border: `1px solid ${accentColor}33`,
                    borderRadius: '1rem',
                    padding: '2rem',
                    maxWidth: 400,
                    width: '100%',
                    textAlign: 'center',
                    boxShadow: `0 25px 50px rgba(0,0,0,0.4)`,
                    animation: 'slideUp 0.3s ease-out',
                }}
                onClick={e => e.stopPropagation()}
            >
                <AlertTriangle style={{ width: 40, height: 40, color: '#fbbf24', margin: '0 auto 1rem' }} />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: textColor, marginBottom: '0.5rem' }}>
                    Don't lose your progress!
                </h2>
                <p style={{ fontSize: '0.85rem', color: textColor, opacity: 0.7, marginBottom: '1rem' }}>
                    You're <strong style={{ color: accentColor }}>{pct}%</strong> done. Just a few more
                    fields to get your personalized quote.
                </p>
                <button
                    onClick={() => setShow(false)}
                    style={{
                        width: '100%',
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`,
                        color: '#fff',
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                    }}
                >
                    Continue <ArrowRight style={{ width: 16, height: 16 }} />
                </button>
                <button
                    onClick={() => setShow(false)}
                    style={{
                        marginTop: '0.75rem',
                        background: 'none',
                        border: 'none',
                        color: textColor,
                        opacity: 0.4,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                    }}
                >
                    No thanks
                </button>
            </div>
        </div>
    );
}
