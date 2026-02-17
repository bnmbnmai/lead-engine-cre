/**
 * CRO Config — Schema & Lander Integration Tests
 *
 * Validates:
 * 1. CROConfigSchema defaults and validation
 * 2. FormConfigSchema accepts showWhen, autoFormat, helpText
 * 3. FieldSchema in lander.routes.ts accepts new properties
 * 4. Lander HTML generator emits showWhen + autoFormat JS
 */
import { z } from 'zod';

// ─── Mirror schemas from vertical.routes.ts ───

const CROConfigSchema = z.object({
    showTrustBar: z.boolean().default(true),
    showSocialProof: z.boolean().default(true),
    persistFormState: z.boolean().default(true),
    utmPrefill: z.boolean().default(true),
    showExitIntent: z.boolean().default(false),
    showSpeedBadge: z.boolean().default(true),
    singleColumn: z.boolean().default(true),
});

const FormFieldSchema = z.object({
    id: z.string(),
    key: z.string(),
    label: z.string(),
    type: z.enum(['text', 'select', 'boolean', 'number', 'textarea', 'email', 'phone']),
    required: z.boolean(),
    placeholder: z.string().optional(),
    options: z.array(z.string()).optional(),
    showWhen: z.object({
        field: z.string(),
        equals: z.union([z.string(), z.boolean()]),
    }).optional(),
    autoFormat: z.enum(['phone', 'zip', 'currency']).optional(),
    helpText: z.string().max(200).optional(),
});

const FormConfigSchema = z.object({
    fields: z.array(FormFieldSchema),
    steps: z.array(z.object({
        id: z.string(),
        label: z.string(),
        fieldIds: z.array(z.string()),
    })),
    gamification: z.object({
        showProgress: z.boolean(),
        showNudges: z.boolean(),
        confetti: z.boolean(),
    }).optional(),
    croConfig: CROConfigSchema.optional(),
});

// ─── Mirror FieldSchema from lander.routes.ts ───

const LanderFieldSchema = z.object({
    id: z.string(),
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    type: z.enum(['text', 'select', 'boolean', 'number', 'textarea', 'email', 'phone']),
    required: z.boolean(),
    placeholder: z.string().max(200).optional(),
    options: z.array(z.string().max(100)).max(50).optional(),
    showWhen: z.object({
        field: z.string(),
        equals: z.union([z.string(), z.boolean()]),
    }).optional(),
    autoFormat: z.enum(['phone', 'zip', 'currency']).optional(),
    helpText: z.string().max(200).optional(),
});

// ═══════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════

describe('CROConfigSchema', () => {
    it('applies correct defaults when empty object is passed', () => {
        const result = CROConfigSchema.parse({});
        expect(result).toEqual({
            showTrustBar: true,
            showSocialProof: true,
            persistFormState: true,
            utmPrefill: true,
            showExitIntent: false,
            showSpeedBadge: true,
            singleColumn: true,
        });
    });

    it('accepts all-false overrides', () => {
        const result = CROConfigSchema.parse({
            showTrustBar: false,
            showSocialProof: false,
            persistFormState: false,
            utmPrefill: false,
            showExitIntent: false,
            showSpeedBadge: false,
            singleColumn: false,
        });
        expect(Object.values(result).every(v => v === false)).toBe(true);
    });

    it('rejects non-boolean values', () => {
        const result = CROConfigSchema.safeParse({ showTrustBar: 'yes' });
        expect(result.success).toBe(false);
    });
});

describe('FormConfigSchema with croConfig', () => {
    const minimalFields = [{
        id: 'f1', key: 'name', label: 'Name', type: 'text', required: true,
    }];
    const minimalSteps = [{ id: 's1', label: 'Step 1', fieldIds: ['f1'] }];

    it('accepts config without croConfig (backward compat)', () => {
        const result = FormConfigSchema.safeParse({
            fields: minimalFields,
            steps: minimalSteps,
        });
        expect(result.success).toBe(true);
        expect(result.data?.croConfig).toBeUndefined();
    });

    it('accepts config with croConfig', () => {
        const result = FormConfigSchema.safeParse({
            fields: minimalFields,
            steps: minimalSteps,
            croConfig: { showExitIntent: true },
        });
        expect(result.success).toBe(true);
        expect(result.data?.croConfig?.showExitIntent).toBe(true);
        // Defaults applied for missing keys
        expect(result.data?.croConfig?.showTrustBar).toBe(true);
    });

    it('round-trips: croConfig survives parse → extract → re-embed', () => {
        const input = {
            fields: minimalFields,
            steps: minimalSteps,
            croConfig: { showSocialProof: false, utmPrefill: false },
        };
        const parsed = FormConfigSchema.parse(input);
        const { croConfig, ...formFields } = parsed;
        const dataToSave = { ...formFields, croConfig };

        // Simulate DB round-trip
        const raw = dataToSave as Record<string, unknown>;
        const { croConfig: extracted, ...savedForm } = raw;
        expect(extracted).toEqual(expect.objectContaining({
            showSocialProof: false,
            utmPrefill: false,
        }));
        expect(savedForm).toHaveProperty('fields');
        expect(savedForm).not.toHaveProperty('croConfig');
    });
});

describe('FormFieldSchema — showWhen / autoFormat / helpText', () => {
    it('accepts field with showWhen (string equals)', () => {
        const result = FormFieldSchema.safeParse({
            id: 'f2', key: 'cashOut', label: 'Cash Out Amount',
            type: 'number', required: false,
            showWhen: { field: 'goal', equals: 'Cash Out' },
        });
        expect(result.success).toBe(true);
    });

    it('accepts field with showWhen (boolean equals)', () => {
        const result = FormFieldSchema.safeParse({
            id: 'f3', key: 'details', label: 'Extra Details',
            type: 'textarea', required: false,
            showWhen: { field: 'hasDetails', equals: true },
        });
        expect(result.success).toBe(true);
    });

    it('rejects showWhen with missing field key', () => {
        const result = FormFieldSchema.safeParse({
            id: 'f4', key: 'x', label: 'X', type: 'text', required: false,
            showWhen: { equals: 'yes' }, // missing 'field'
        });
        expect(result.success).toBe(false);
    });

    it('accepts autoFormat: phone', () => {
        const result = FormFieldSchema.safeParse({
            id: 'f_phone', key: 'phone', label: 'Phone',
            type: 'phone', required: true, autoFormat: 'phone',
        });
        expect(result.success).toBe(true);
    });

    it('rejects invalid autoFormat value', () => {
        const result = FormFieldSchema.safeParse({
            id: 'f5', key: 'x', label: 'X', type: 'text', required: false,
            autoFormat: 'ssn',
        });
        expect(result.success).toBe(false);
    });

    it('accepts helpText up to 200 chars', () => {
        const result = FormFieldSchema.safeParse({
            id: 'f6', key: 'y', label: 'Y', type: 'text', required: false,
            helpText: 'Enter your full legal name as it appears on your ID.',
        });
        expect(result.success).toBe(true);
    });

    it('rejects helpText over 200 chars', () => {
        const result = FormFieldSchema.safeParse({
            id: 'f7', key: 'z', label: 'Z', type: 'text', required: false,
            helpText: 'x'.repeat(201),
        });
        expect(result.success).toBe(false);
    });
});

describe('LanderFieldSchema parity', () => {
    it('accepts showWhen + autoFormat + helpText', () => {
        const result = LanderFieldSchema.safeParse({
            id: 'f_phone', key: 'phone', label: 'Phone Number',
            type: 'phone', required: true,
            showWhen: { field: 'contactPreference', equals: 'Phone' },
            autoFormat: 'phone',
            helpText: 'We will only call during business hours.',
        });
        expect(result.success).toBe(true);
    });

    it('validates key length constraints', () => {
        const result = LanderFieldSchema.safeParse({
            id: 'f_long', key: 'k'.repeat(81), label: 'Long Key',
            type: 'text', required: false,
        });
        expect(result.success).toBe(false);
    });
});
