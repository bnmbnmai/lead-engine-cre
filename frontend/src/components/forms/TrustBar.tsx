/**
 * TrustBar — Trust badges displayed above the form.
 *
 * Shows "256-bit Encrypted", "TCPA Compliant", "Chainlink Verified" badges
 * in a compact horizontal bar. Seller can toggle via CROConfig.showTrustBar.
 */

import { Shield, Lock, CheckCircle } from 'lucide-react';

interface TrustBarProps {
    mutedColor: string;
}

const BADGES = [
    { icon: Lock, label: '256-bit Encrypted', color: '#22c55e' },
    { icon: Shield, label: 'TCPA Compliant', color: '#3b82f6' },
    { icon: CheckCircle, label: 'Chainlink Verified', color: '#a855f7' },
];

export default function TrustBar({ mutedColor }: TrustBarProps) {
    return (
        <div
            style={{
                display: 'flex',
                justifyContent: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem',
                marginBottom: '1.25rem',
                padding: '0.6rem 0.75rem',
                borderRadius: '0.5rem',
                backgroundColor: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
            }}
        >
            {BADGES.map(({ icon: Icon, label, color }) => (
                <span
                    key={label}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontSize: '0.65rem',
                        fontWeight: 500,
                        color: mutedColor,
                        whiteSpace: 'nowrap',
                    }}
                >
                    <Icon style={{ width: 12, height: 12, color }} />
                    {label}
                </span>
            ))}
        </div>
    );
}
