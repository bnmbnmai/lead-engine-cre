/**
 * contrast.ts — WCAG-aware contrast utilities for form builder
 *
 * Implements WCAG 2.1 relative luminance + contrast ratio calculations.
 * Used by FormBuilder to auto-compute text colors and warn on failing schemes.
 */

/**
 * Parse a hex color string to RGB components.
 * Supports #RGB, #RRGGBB, and bare forms.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    let h = hex.replace(/^#/, '');
    if (h.length === 3) {
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    const num = parseInt(h, 16);
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255,
    };
}

/**
 * Calculate WCAG 2.1 relative luminance of a hex color.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function relativeLuminance(hex: string): number {
    const { r, g, b } = hexToRgb(hex);
    const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
        c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate WCAG contrast ratio between two hex colors.
 * Returns a value between 1 (no contrast) and 21 (maximum).
 */
export function contrastRatio(fg: string, bg: string): number {
    const l1 = relativeLuminance(fg);
    const l2 = relativeLuminance(bg);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns optimal text color (white or dark near-black) for a given background.
 * Uses WCAG luminance midpoint to decide.
 */
export function getContrastText(bg: string): string {
    const lum = relativeLuminance(bg);
    // If bg is dark (low luminance), use light text; otherwise use dark text
    return lum > 0.179 ? '#1e293b' : '#f1f5f9';
}

/**
 * Check if foreground on background meets WCAG AA contrast requirements.
 * Normal text: 4.5:1, Large text (18px+ bold or 24px+): 3.0:1
 */
export function meetsWcagAA(fg: string, bg: string, largeText = false): boolean {
    const ratio = contrastRatio(fg, bg);
    return largeText ? ratio >= 3.0 : ratio >= 4.5;
}

/**
 * Validate a hex color string.
 */
export function isValidHex(hex: string): boolean {
    return /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex);
}
