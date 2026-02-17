/**
 * SpeedBadge — Displays completion time on the thank-you page.
 *
 * Shows "⚡ Completed in X seconds" with an animated entrance.
 * Seller can toggle via CROConfig.showSpeedBadge.
 */

interface SpeedBadgeProps {
    /** Time in milliseconds from form start to submit */
    elapsedMs: number;
    accentColor: string;
    mutedColor: string;
}

export default function SpeedBadge({ elapsedMs, accentColor, mutedColor }: SpeedBadgeProps) {
    const seconds = Math.round(elapsedMs / 1000);
    const isFast = seconds <= 60;

    return (
        <div
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.4rem 0.85rem',
                borderRadius: '999px',
                backgroundColor: isFast ? `${accentColor}15` : 'rgba(255,255,255,0.05)',
                border: `1px solid ${isFast ? `${accentColor}30` : 'rgba(255,255,255,0.08)'}`,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: isFast ? accentColor : mutedColor,
                marginTop: '1rem',
                animation: 'fp-fadeIn 0.6s ease-out',
            }}
        >
            <span>⚡</span>
            Completed in {seconds} second{seconds !== 1 ? 's' : ''}
            {isFast && <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>— Lightning fast!</span>}
        </div>
    );
}
