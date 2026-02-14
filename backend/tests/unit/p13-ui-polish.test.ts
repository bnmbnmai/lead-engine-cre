/**
 * p13-ui-polish.test.ts — UI Polish: Card Glow, Theme Accents, Auto-Contrast
 *
 * 20 tests covering:
 *   - Card glow hover-only (5)
 *   - Theme green accents (4)
 *   - FormBuilder StepProgress auto-contrast (5)
 *   - BidPanel sealed-only (3)
 *   - Mobile & Accessibility (3)
 */

import { describe, test, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const fe = (rel: string) => path.join(ROOT, 'frontend', 'src', rel);
const read = (rel: string) => fs.readFileSync(fe(rel), 'utf-8');

// ── Card Glow (5 tests) ──────────────────────────────────

describe('Card Glow — Hover-Only', () => {
    const css = read('index.css');

    test('1. index.css has .glow-ready class with transition', () => {
        expect(css).toContain('.glow-ready');
        expect(css).toMatch(/\.glow-ready\s*\{[^}]*transition/s);
    });

    test('2. index.css .glow-ready:hover has box-shadow', () => {
        expect(css).toMatch(/\.glow-ready:hover\s*\{[^}]*box-shadow/s);
    });

    test('3. index.css .glow-ready:active has active state', () => {
        expect(css).toMatch(/\.glow-ready:active\s*\{[^}]*box-shadow/s);
    });

    test('4. LeadCard uses glow-ready (not bare glow) for live cards', () => {
        const src = read('components/marketplace/LeadCard.tsx');
        expect(src).toContain('glow-ready');
        // Should NOT have standalone 'glow' (not followed by -ready) on the Card line
        const cardLine = src.split('\n').find(l => l.includes('isLive') && l.includes('glow'));
        expect(cardLine).toBeDefined();
        expect(cardLine).toContain('glow-ready');
    });

    test('5. LeadCard has active:scale for mobile tap', () => {
        const src = read('components/marketplace/LeadCard.tsx');
        expect(src).toMatch(/active:scale-\[0\.98\]/);
    });
});

// ── Theme Accents (4 tests) ──────────────────────────────

describe('Theme — Green Institutional Accents', () => {
    const css = read('index.css');

    test('6. index.css :root has --verified CSS variable', () => {
        expect(css).toMatch(/--verified:\s*142/);
    });

    test('7. index.css has .verified-glow utility', () => {
        expect(css).toContain('.verified-glow');
        expect(css).toMatch(/\.verified-glow\s*\{[^}]*box-shadow/s);
    });

    test('8. LeadCard verified icon uses emerald/green color', () => {
        const src = read('components/marketplace/LeadCard.tsx');
        // Should use emerald-500 instead of hard-coded #6B93F5
        expect(src).toContain('text-emerald-500');
        expect(src).not.toContain('text-[#6B93F5]');
    });

    test('9. index.css has prefers-contrast media query', () => {
        expect(css).toContain('prefers-contrast: more');
        // Should disable glow/shadow and add outline instead
        expect(css).toMatch(/prefers-contrast[^}]*box-shadow:\s*none/s);
    });
});

// ── FormBuilder Contrast (5 tests) ───────────────────────

describe('FormBuilder — StepProgress Auto-Contrast', () => {
    test('10. StepProgress accepts colorVars prop', () => {
        const src = read('components/forms/StepProgress.tsx');
        expect(src).toContain('colorVars');
        expect(src).toMatch(/colorVars\??\s*:\s*Record<string,\s*string>/);
    });

    test('11. StepProgress uses inline styles when colorVars provided', () => {
        const src = read('components/forms/StepProgress.tsx');
        // Should compute accent/muted styles from colorVars
        expect(src).toContain("colorVars['--form-accent']");
        expect(src).toContain("colorVars['--form-muted']");
    });

    test('12. FormBuilder passes colorVars to StepProgress', () => {
        const src = read('pages/FormBuilder.tsx');
        expect(src).toMatch(/colorVars\s*=\s*\{colorScheme\.vars\}/);
    });

    test('13. Color scheme picker shows WCAG warning for low contrast', () => {
        const src = read('pages/FormBuilder.tsx');
        expect(src).toContain('meetsWcagAA');
        // The warning emoji should appear next to failing schemes
        expect(src).toMatch(/meetsWcagAA.*--form-text.*--form-bg/s);
    });

    test('14. getContrastText used on submit button in preview', () => {
        const src = read('pages/FormBuilder.tsx');
        expect(src).toMatch(/getContrastText\(colorScheme\.vars\['--form-accent'\]\)/);
    });
});

// ── BidPanel Sealed-Only (3 tests) ──────────────────────

describe('BidPanel — Sealed-Only Compliance', () => {
    const src = read('components/bidding/BidPanel.tsx');

    test('15. No Open Bid or Direct Bid references', () => {
        expect(src).not.toContain('Open Bid');
        expect(src).not.toContain('Direct Bid');
    });

    test('16. Uses commitment-based sealed flow', () => {
        expect(src).toContain('commitment');
    });

    test('17. No bid mode toggle present', () => {
        expect(src).not.toContain('bid mode');
        expect(src).not.toContain('bidMode');
    });
});

// ── Mobile & Accessibility (3 tests) ─────────────────────

describe('Mobile & Accessibility', () => {
    test('18. index.css has forced-colors media query', () => {
        const css = read('index.css');
        expect(css).toContain('forced-colors: active');
        expect(css).toMatch(/forced-colors[^}]*ButtonText/s);
    });

    test('19. LeadCard has aria-label on interactive elements', () => {
        const src = read('components/marketplace/LeadCard.tsx');
        expect(src).toContain('aria-label');
    });

    test('20. Card base component includes hover:shadow-md transition', () => {
        const src = read('components/ui/card.tsx');
        expect(src).toContain('hover:shadow-md');
        expect(src).toContain('transition-all');
    });
});
