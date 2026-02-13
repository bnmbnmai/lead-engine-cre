/**
 * p11-dynamic-verticals.test.ts
 *
 * 22 tests verifying the dynamic verticals integration:
 *  - Dynamic Vertical Lists (6)
 *  - Search & Empty States (5)
 *  - maxBid Enforcement (5)
 *  - Seeder (6)
 */

import * as fs from 'fs';
import * as path from 'path';

// Project root: Lead Engine CRE
const projectRoot = path.resolve(__dirname, '../../..');
const frontendSrc = path.join(projectRoot, 'frontend/src');
const backendSrc = path.join(projectRoot, 'backend/src');
const prismaSrc = path.join(projectRoot, 'backend/prisma');

function readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

// ============================================
// 1. Dynamic Vertical Lists (6 tests)
// ============================================

describe('Dynamic Vertical Lists', () => {
    test('1. PreferencesForm imports useVerticals hook', () => {
        const src = readFile(path.join(frontendSrc, 'components/forms/PreferencesForm.tsx'));
        expect(src).toContain("import { useVerticals } from '@/hooks/useVerticals'");
    });

    test('2. PreferencesForm does NOT contain hard-coded VERTICALS array', () => {
        const src = readFile(path.join(frontendSrc, 'components/forms/PreferencesForm.tsx'));
        // Should NOT have the old const VERTICALS = [ ... ] declaration
        expect(src).not.toMatch(/const VERTICALS\s*=\s*\[/);
        // Should NOT have the old VERTICAL_LABELS mapping
        expect(src).not.toMatch(/const VERTICAL_LABELS/);
    });

    test('3. PreferenceSetCard accepts verticalLabels prop', () => {
        const src = readFile(path.join(frontendSrc, 'components/forms/PreferenceSetCard.tsx'));
        expect(src).toContain('verticalLabels: Record<string, string>');
        expect(src).toContain('verticalLabels');
        // Should NOT have hard-coded map
        expect(src).not.toMatch(/const VERTICAL_LABELS\s*[:=]/);
    });

    test('4. PreferenceSetCard does NOT contain hard-coded VERTICAL_LABELS', () => {
        const src = readFile(path.join(frontendSrc, 'components/forms/PreferenceSetCard.tsx'));
        expect(src).not.toContain("solar: 'Solar'");
        expect(src).not.toContain("mortgage: 'Mortgage'");
    });

    test('5. FormBuilder imports useVerticals hook', () => {
        const src = readFile(path.join(frontendSrc, 'pages/FormBuilder.tsx'));
        expect(src).toContain("import { useVerticals } from '@/hooks/useVerticals'");
    });

    test('6. FormBuilder keeps VERTICAL_PRESETS as fallback with GENERIC_TEMPLATE', () => {
        const src = readFile(path.join(frontendSrc, 'pages/FormBuilder.tsx'));
        expect(src).toContain('VERTICAL_PRESETS');
        expect(src).toContain('GENERIC_TEMPLATE');
        // The old VERTICALS = Object.keys should be gone
        expect(src).not.toMatch(/const VERTICALS\s*=\s*Object\.keys/);
    });
});

// ============================================
// 2. Search & Empty States (5 tests)
// ============================================

describe('Search & Empty States', () => {
    test('7. useVerticals exports searchable flatList and search function', () => {
        const src = readFile(path.join(frontendSrc, 'hooks/useVerticals.ts'));
        expect(src).toContain('flatList');
        expect(src).toContain('search');
        expect(src).toContain('labelMap');
        expect(src).toContain('export function useVerticals');
    });

    test('8. Vertical search is provided via NestedVerticalSelect', () => {
        // Search was moved into the NestedVerticalSelect component
        const selectSrc = readFile(path.join(frontendSrc, 'components/ui/NestedVerticalSelect.tsx'));
        expect(selectSrc).toContain('Search verticals');
        expect(selectSrc).toContain('search');
        // PreferencesForm delegates to NestedVerticalSelect
        const formSrc = readFile(path.join(frontendSrc, 'components/forms/PreferencesForm.tsx'));
        expect(formSrc).toContain('NestedVerticalSelect');
    });

    test('9. Empty state shows "Suggest New" CTA', () => {
        // Empty state moved into NestedVerticalSelect component
        const src = readFile(path.join(frontendSrc, 'components/ui/NestedVerticalSelect.tsx'));
        expect(src).toContain('Suggest');
        expect(src).toContain('No verticals');
    });

    test('10. FormBuilder shows "(custom)" marker for unknown verticals', () => {
        const src = readFile(path.join(frontendSrc, 'pages/FormBuilder.tsx'));
        expect(src).toContain('(custom)');
        expect(src).toContain('No preset template');
    });

    test('11. useVerticals has refresh() method for auto-refresh', () => {
        const src = readFile(path.join(frontendSrc, 'hooks/useVerticals.ts'));
        expect(src).toContain('refresh: fetchVerticals');
        expect(src).toContain('REFRESH_INTERVAL_MS');
        expect(src).toContain('autoRefresh');
    });
});

// ============================================
// 3. maxBid Enforcement (5 tests)
// ============================================

describe('maxBid Enforcement', () => {
    test('12. createDefaultSet includes maxBidPerLead: 100', () => {
        const src = readFile(path.join(frontendSrc, 'components/forms/PreferencesForm.tsx'));
        expect(src).toContain('maxBidPerLead: 100');
    });

    test('13. PreferenceSetCard sanitises maxBidPerLead via BUDGET_MAX', () => {
        const src = readFile(path.join(frontendSrc, 'components/forms/PreferenceSetCard.tsx'));
        expect(src).toContain('maxBidPerLead');
        expect(src).toContain('BUDGET_MAX');
    });

    test('14. Server-side maxBidPerLead minimum is 1', () => {
        const src = readFile(path.join(backendSrc, 'utils/validation.ts'));
        expect(src).toMatch(/maxBidPerLead.*min\(1/);
    });

    test('15. Server-side maxBidPerLead defaults to 100 when omitted', () => {
        const src = readFile(path.join(backendSrc, 'utils/validation.ts'));
        expect(src).toMatch(/maxBidPerLead.*default\(100\)/);
    });

    test('16. Validation does NOT use hard-coded VERTICAL_VALUES enum', () => {
        const src = readFile(path.join(backendSrc, 'utils/validation.ts'));
        expect(src).not.toContain('VERTICAL_VALUES');
        expect(src).not.toMatch(/z\.enum\(\s*VERTICAL/);
        // Should use dynamic slug pattern instead
        expect(src).toContain('VERTICAL_SLUG_PATTERN');
    });
});

// ============================================
// 4. Seeder (6 tests)
// ============================================

describe('Seeder', () => {
    test('17. seed-verticals.ts has generateDynamicVerticals function', () => {
        const src = readFile(path.join(prismaSrc, 'seed-verticals.ts'));
        expect(src).toContain('function generateDynamicVerticals');
        expect(src).toContain('export { generateDynamicVerticals');
    });

    test('18. Dynamic verticals have children', () => {
        const src = readFile(path.join(prismaSrc, 'seed-verticals.ts'));
        // The generator creates children from DYNAMIC_SPECIALIZATIONS
        expect(src).toContain('children: selectedSpecs.map');
    });

    test('19. Generated slugs follow naming pattern', () => {
        const src = readFile(path.join(prismaSrc, 'seed-verticals.ts'));
        // Slug format: {industry}.{spec}
        expect(src).toContain('`${industry}.${spec}`');
    });

    test('20. Existing SEED_DATA preserved', () => {
        const src = readFile(path.join(prismaSrc, 'seed-verticals.ts'));
        expect(src).toContain("slug: 'solar'");
        expect(src).toContain("slug: 'mortgage'");
        expect(src).toContain("slug: 'roofing'");
        expect(src).toContain('const SEED_DATA');
    });

    test('21. API client has getVerticalHierarchy method', () => {
        const src = readFile(path.join(frontendSrc, 'lib/api.ts'));
        expect(src).toContain('getVerticalHierarchy');
    });

    test('22. API client has suggestVertical method', () => {
        const src = readFile(path.join(frontendSrc, 'lib/api.ts'));
        expect(src).toContain('suggestVertical');
    });
});
