/**
 * SocialProofBanner — "X leads verified today" counter.
 *
 * Fetches real count from /api/v1/leads/count-today.
 * Falls back to a stable plausible range (50–200) on API failure,
 * cached in sessionStorage so it doesn't jitter across re-renders.
 * Seller can toggle via CROConfig.showSocialProof.
 */

import { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import api from '@/lib/api';

interface SocialProofBannerProps {
    accentColor: string;
    mutedColor: string;
}

const FALLBACK_KEY = 'sp_fallback_count';

function stableFallback(): number {
    try {
        const cached = sessionStorage.getItem(FALLBACK_KEY);
        if (cached) return parseInt(cached, 10);
    } catch { /* noop */ }
    const val = Math.floor(Math.random() * 150) + 50;
    try { sessionStorage.setItem(FALLBACK_KEY, String(val)); } catch { /* noop */ }
    return val;
}

const SP_ANIM_ID = 'sp-banner-anims';
function ensureAnims() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(SP_ANIM_ID)) return;
    const s = document.createElement('style');
    s.id = SP_ANIM_ID;
    s.textContent = `@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`;
    document.head.appendChild(s);
}

export default function SocialProofBanner({ accentColor, mutedColor }: SocialProofBannerProps) {
    ensureAnims();
    const [count, setCount] = useState<number | null>(null);

    useEffect(() => {
        api.getLeadCountToday()
            .then(res => {
                if (res.data?.count !== undefined) {
                    setCount(res.data.count);
                } else {
                    setCount(stableFallback());
                }
            })
            .catch(() => {
                setCount(stableFallback());
            });
    }, []);

    if (count === null) return null;

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                marginBottom: '1rem',
                fontSize: '0.7rem',
                fontWeight: 500,
                color: mutedColor,
                animation: 'fadeIn 0.5s ease-out',
            }}
        >
            <Users style={{ width: 13, height: 13, color: accentColor }} />
            <span>
                <strong style={{ color: accentColor }}>{count.toLocaleString()}</strong> leads verified today
            </span>
        </div>
    );
}
