/**
 * P7 — Non-PII Lead Preview Tests
 *
 * Tests for:
 *   - PII field classification (classifyField)
 *   - Lead redaction (redactLeadForPreview)
 *   - API endpoint structure
 *   - Frontend component structure
 *
 * Coverage: 12 tests across 4 describe blocks
 */

// ── Helpers ──────────────────────────────

function readBackend(relativePath: string): string {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../../src', relativePath), 'utf-8');
}

function readFrontend(relativePath: string): string {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../../../frontend/src', relativePath), 'utf-8');
}

// ============================================
// 1. PII Field Classification (3 tests)
// ============================================

describe('PII Field Classification', () => {
    let classifyField: typeof import('../../src/services/piiProtection').classifyField;

    beforeAll(() => {
        jest.resetModules();
        const mod = require('../../src/services/piiProtection');
        classifyField = mod.classifyField;
    });

    test('classifies known PII fields (email, phone, ssn) as "pii"', () => {
        expect(classifyField('email')).toBe('pii');
        expect(classifyField('phone')).toBe('pii');
        expect(classifyField('ssn')).toBe('pii');
        expect(classifyField('firstName')).toBe('pii');
        expect(classifyField('lastName')).toBe('pii');
        expect(classifyField('address')).toBe('pii');
    });

    test('classifies vertical-specific safe fields as "safe"', () => {
        expect(classifyField('loanAmount', 'mortgage')).toBe('safe');
        expect(classifyField('propertyType', 'mortgage')).toBe('safe');
        expect(classifyField('creditScore', 'solar')).toBe('safe');
        expect(classifyField('roofType', 'roofing')).toBe('safe');
    });

    test('classifies unknown fields as "unknown" (whitelist-only)', () => {
        expect(classifyField('randomField')).toBe('unknown');
        expect(classifyField('customData', 'mortgage')).toBe('unknown');
    });
});

// ============================================
// 2. Lead Redaction (3 tests)
// ============================================

describe('Lead Redaction', () => {
    let redactLeadForPreview: typeof import('../../src/services/piiProtection').redactLeadForPreview;

    beforeAll(() => {
        jest.resetModules();
        const mod = require('../../src/services/piiProtection');
        redactLeadForPreview = mod.redactLeadForPreview;
    });

    const baseLead = {
        vertical: 'mortgage',
        geo: { country: 'US', state: 'CA', zip: '90210', city: 'Beverly Hills' },
        source: 'PLATFORM',
        status: 'IN_AUCTION',
        isVerified: true,
        createdAt: new Date('2025-01-15T10:00:00Z'),
        reservePrice: 75.50,
        dataHash: '0xabc123',
        parameters: {
            propertyType: 'single_family',
            loanAmount: 350000,
            creditScore: 720,
            loanType: 'Refinance',
            // PII that should be stripped:
            email: 'test@example.com',
            phone: '555-1234',
            firstName: 'John',
        },
    };

    test('strips PII fields from parameters, keeps safe fields', () => {
        const preview = redactLeadForPreview(baseLead);

        // Safe fields should be present in form steps
        const allFields = preview.formSteps.flatMap(s => s.fields);
        const propertyType = allFields.find(f => f.key === 'propertyType');
        expect(propertyType?.value).toBe('single_family');

        const loanAmount = allFields.find(f => f.key === 'loanAmount');
        expect(loanAmount?.value).toBe('350000');

        // PII should NOT appear anywhere
        const allValues = allFields.map(f => f.value);
        expect(allValues).not.toContain('test@example.com');
        expect(allValues).not.toContain('555-1234');
        expect(allValues).not.toContain('John');
    });

    test('returns "Not Provided" for missing parameter keys', () => {
        const sparseParams = { ...baseLead, parameters: { propertyType: 'condo' } };
        const preview = redactLeadForPreview(sparseParams);

        const allFields = preview.formSteps.flatMap(s => s.fields);
        const loanAmount = allFields.find(f => f.key === 'loanAmount');
        expect(loanAmount?.value).toBe('Not Provided');
    });

    test('handles null parameters gracefully', () => {
        const noParams = { ...baseLead, parameters: null };
        const preview = redactLeadForPreview(noParams);

        expect(preview.formSteps.length).toBeGreaterThan(0);
        const allFields = preview.formSteps.flatMap(s => s.fields);
        // All fields should be "Not Provided"
        allFields.forEach(f => {
            expect(f.value).toBe('Not Provided');
        });
    });
});

// ============================================
// 3. API Endpoint Structure (3 tests)
// ============================================

describe('Lead Preview Endpoint', () => {
    test('marketplace routes file contains /leads/:id/preview endpoint', () => {
        const src = readBackend('routes/marketplace.routes.ts');
        expect(src).toContain("'/leads/:id/preview'");
        expect(src).toContain('authMiddleware');
        expect(src).toContain('redactLeadForPreview');
    });

    test('endpoint never selects encryptedData from Prisma', () => {
        const src = readBackend('routes/marketplace.routes.ts');
        // Find the preview endpoint section
        const previewIdx = src.indexOf("'/leads/:id/preview'");
        const previewSection = src.slice(previewIdx, previewIdx + 500);
        expect(previewSection).not.toContain('encryptedData: true');
    });

    test('endpoint returns 404 JSON for missing lead', () => {
        const src = readBackend('routes/marketplace.routes.ts');
        const previewIdx = src.indexOf("'/leads/:id/preview'");
        const previewSection = src.slice(previewIdx, previewIdx + 800);
        expect(previewSection).toContain("'Lead not found'");
        expect(previewSection).toContain('404');
    });
});

// ============================================
// 4. Frontend Component Structure (3 tests)
// ============================================

describe('LeadPreview Component', () => {
    test('LeadPreview has accordion step structure', () => {
        const src = readFrontend('components/bidding/LeadPreview.tsx');
        expect(src).toContain('StepAccordion');
        expect(src).toContain('formSteps');
        expect(src).toContain('ChevronDown');
    });

    test('handles "Not Provided" empty fields with muted styling', () => {
        const src = readFrontend('components/bidding/LeadPreview.tsx');
        expect(src).toContain("'Not Provided'");
        expect(src).toContain('italic');
        expect(src).toContain('muted-foreground/50');
    });

    test('shows ZK verification badge when zkDataHash is present', () => {
        const src = readFrontend('components/bidding/LeadPreview.tsx');
        expect(src).toContain('zkDataHash');
        expect(src).toContain('ShieldCheck');
        expect(src).toContain('ZK Verified');
    });
});
