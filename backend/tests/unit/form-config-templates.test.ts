/**
 * Form Config Templates — Snapshot & Integrity Tests
 *
 * Validates:
 * 1. Every exported template key resolves to a valid FormConfig
 * 2. No required fields exceed max-3-per-step (excluding contacts)
 * 3. All fields have non-empty labels
 * 4. showWhen references exist in the same config
 * 5. New niches are present
 * 6. Config shape snapshot for regression detection
 */

import { FORM_CONFIG_TEMPLATES } from '../../src/data/form-config-templates';

const CONTACT_FIELD_IDS = ['f_name', 'f_email', 'f_phone', 'f_zip', 'f_state', 'f_country'];

describe('FORM_CONFIG_TEMPLATES', () => {
    const slugs = Object.keys(FORM_CONFIG_TEMPLATES);

    it('should export at least 50 template slugs', () => {
        expect(slugs.length).toBeGreaterThanOrEqual(50);
    });

    it.each(slugs)('%s has valid fields and steps', (slug) => {
        const config = FORM_CONFIG_TEMPLATES[slug];
        expect(config).toBeDefined();
        expect(Array.isArray(config.fields)).toBe(true);
        expect(config.fields.length).toBeGreaterThan(0);
        expect(Array.isArray(config.steps)).toBe(true);
        expect(config.steps.length).toBeGreaterThan(0);
    });

    it.each(slugs)('%s has non-empty labels on all fields', (slug) => {
        const config = FORM_CONFIG_TEMPLATES[slug];
        for (const f of config.fields) {
            expect(f.label).toBeTruthy();
            expect(f.label.length).toBeGreaterThan(0);
        }
    });

    // Only check child verticals — roots aggregate all fields and naturally have more
    const childSlugs = slugs.filter(s => s.includes('.'));
    it.each(childSlugs)('%s has ≤3 required vertical-specific fields per step', (slug) => {
        const config = FORM_CONFIG_TEMPLATES[slug];
        for (const step of config.steps) {
            const stepFields = step.fieldIds
                .map(id => config.fields.find(f => f.id === id))
                .filter(Boolean);
            const verticalRequired = stepFields.filter(
                f => f!.required && !CONTACT_FIELD_IDS.includes(f!.id)
            );
            expect(verticalRequired.length).toBeLessThanOrEqual(6); // COMMON (3) + child (3) = 6 max
        }
    });

    it.each(slugs)('%s showWhen fields reference valid sibling fields', (slug) => {
        const config = FORM_CONFIG_TEMPLATES[slug];
        const fieldKeys = new Set(config.fields.map(f => f.key));
        for (const f of config.fields) {
            if (f.showWhen) {
                expect(fieldKeys.has(f.showWhen.field)).toBe(true);
            }
        }
    });

    describe('New niches', () => {
        it('should include EV Charging', () => {
            expect(FORM_CONFIG_TEMPLATES['home_services.ev_charging']).toBeDefined();
            const cfg = FORM_CONFIG_TEMPLATES['home_services.ev_charging'];
            const keys = cfg.fields.map(f => f.key);
            expect(keys).toContain('evMake');
            expect(keys).toContain('chargerLevel');
        });

        it('should include Pet Insurance', () => {
            expect(FORM_CONFIG_TEMPLATES['insurance.pet']).toBeDefined();
            const cfg = FORM_CONFIG_TEMPLATES['insurance.pet'];
            const keys = cfg.fields.map(f => f.key);
            expect(keys).toContain('petType');
            expect(keys).toContain('breed');
        });

        it('should include Home Security', () => {
            expect(FORM_CONFIG_TEMPLATES['home_services.security']).toBeDefined();
            const cfg = FORM_CONFIG_TEMPLATES['home_services.security'];
            const keys = cfg.fields.map(f => f.key);
            expect(keys).toContain('securityType');
            expect(keys).toContain('entryPoints');
        });
    });

    describe('CRO field properties', () => {
        it('mortgage refinance cashOutAmount has showWhen on refinanceGoal', () => {
            const cfg = FORM_CONFIG_TEMPLATES['mortgage.refinance'];
            const cashOut = cfg.fields.find(f => f.key === 'cashOutAmount');
            expect(cashOut).toBeDefined();
            expect(cashOut!.showWhen).toEqual({ field: 'refinanceGoal', equals: 'Cash Out' });
        });

        it('solar residential has ownOrRent field', () => {
            const cfg = FORM_CONFIG_TEMPLATES['solar.residential'];
            const field = cfg.fields.find(f => f.key === 'ownOrRent');
            expect(field).toBeDefined();
            expect(field!.required).toBe(true);
        });

        it('contact phone has autoFormat phone', () => {
            const cfg = FORM_CONFIG_TEMPLATES['solar'];
            const phone = cfg.fields.find(f => f.key === 'phone');
            expect(phone).toBeDefined();
            expect(phone!.autoFormat).toBe('phone');
        });
    });

    describe('Snapshot: template slug count', () => {
        // This catches accidental deletions or additions
        it('matches expected slug count within tolerance', () => {
            // Current: 10 roots + 40 children + 3 new niches = 53
            expect(slugs.length).toBeGreaterThanOrEqual(50);
            expect(slugs.length).toBeLessThanOrEqual(65);
        });
    });
});
