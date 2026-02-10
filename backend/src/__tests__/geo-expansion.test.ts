import {
    isValidRegion,
    getAllCountryCodes,
    getCountryConfig,
    getRegionsByCountry,
    getCountriesByContinent,
    isValidPostalCode,
} from '../lib/geo-registry';
import {
    getPolicy,
    crossBorderRequirements,
    JURISDICTION_POLICIES,
} from '../lib/jurisdiction-policies';

// ============================================
// Geo Registry Tests
// ============================================

describe('Geo Registry', () => {
    it('contains exactly 25 supported countries', () => {
        const codes = getAllCountryCodes();
        expect(codes).toHaveLength(25);
    });

    it('includes all expected LATAM countries', () => {
        const latam = ['BR', 'MX', 'CO', 'AR', 'CL', 'PE', 'EC'];
        for (const code of latam) {
            expect(getCountryConfig(code)).toBeDefined();
            expect(getCountryConfig(code)!.continent).toBe('AMERICAS');
        }
    });

    it('includes all expected Africa countries', () => {
        const africa = ['ZA', 'NG', 'KE', 'GH', 'EG', 'TZ', 'MA'];
        for (const code of africa) {
            expect(getCountryConfig(code)).toBeDefined();
            expect(getCountryConfig(code)!.continent).toBe('AFRICA');
        }
    });

    describe('isValidRegion', () => {
        it.each([
            ['US', 'CA', true],
            ['US', 'TX', true],
            ['US', 'XX', false],
            ['BR', 'SP', true],
            ['BR', 'RJ', true],
            ['BR', 'CA', false], // CA is US, not Brazil
            ['NG', 'LA', true],
            ['NG', 'ABJ', true],
            ['KE', 'NBO', true],
            ['KE', 'LA', false], // LA is Nigeria
            ['ZA', 'GP', true],
            ['ZA', 'WC', true],
            ['CO', 'BOG', true],
            ['AR', 'CABA', true],
            ['EG', 'CAI', true],
            ['GH', 'GAR', true],
            ['XX', 'CA', false], // unknown country
        ])('isValidRegion(%s, %s) = %s', (country, region, expected) => {
            expect(isValidRegion(country, region)).toBe(expected);
        });
    });

    describe('getRegionsByCountry', () => {
        it('returns regions for Brazil', () => {
            const regions = getRegionsByCountry('BR');
            expect(regions.length).toBeGreaterThan(0);
            expect(regions.map(r => r.code)).toContain('SP');
        });

        it('returns empty for unknown country', () => {
            expect(getRegionsByCountry('XX')).toEqual([]);
        });
    });

    describe('getCountriesByContinent', () => {
        it('returns Africa countries', () => {
            const african = getCountriesByContinent('AFRICA');
            expect(african.length).toBe(7);
            expect(african.map(c => c.code)).toEqual(
                expect.arrayContaining(['ZA', 'NG', 'KE', 'GH', 'EG', 'TZ', 'MA'])
            );
        });

        it('returns Americas countries', () => {
            const americas = getCountriesByContinent('AMERICAS');
            expect(americas.length).toBe(9);
        });
    });

    describe('isValidPostalCode', () => {
        it.each([
            ['US', '90210', true],
            ['US', '90210-1234', true],
            ['US', 'ABC', false],
            ['BR', '01310-100', true],
            ['BR', '01310100', true],
            ['ZA', '2000', true],
            ['KE', '00100', true],
        ])('isValidPostalCode(%s, %s) = %s', (country, postal, expected) => {
            expect(isValidPostalCode(country, postal)).toBe(expected);
        });
    });
});

// ============================================
// Jurisdiction Policy Tests
// ============================================

describe('Jurisdiction Policies', () => {
    it('has policies for all 25 countries', () => {
        const countryCodes = getAllCountryCodes();
        for (const code of countryCodes) {
            expect(JURISDICTION_POLICIES[code]).toBeDefined();
        }
    });

    describe('getPolicy', () => {
        it('returns LGPD for Brazil', () => {
            const policy = getPolicy('BR');
            expect(policy).toBeDefined();
            expect(policy!.framework).toBe('LGPD');
            expect(policy!.crossBorderRestricted).toBe(true);
            expect(policy!.requiresConsentProof).toBe(true);
        });

        it('returns POPIA for South Africa', () => {
            const policy = getPolicy('ZA');
            expect(policy!.framework).toBe('POPIA');
            expect(policy!.requiresOptIn).toBe(true);
        });

        it('returns NDPR for Nigeria', () => {
            const policy = getPolicy('NG');
            expect(policy!.framework).toBe('NDPR');
            expect(policy!.requiresDPA).toBe(true);
        });

        it('returns DPA 2019 for Kenya', () => {
            const policy = getPolicy('KE');
            expect(policy!.framework).toBe('DPA 2019');
            expect(policy!.gdprAligned).toBe(true);
        });
    });

    describe('crossBorderRequirements', () => {
        it('same-country transfer has no requirements', () => {
            const result = crossBorderRequirements('NG', 'NG');
            expect(result.allowed).toBe(true);
            expect(result.requirements).toHaveLength(0);
        });

        it('BR to US cross-border flags LGPD restriction', () => {
            const result = crossBorderRequirements('BR', 'US');
            expect(result.allowed).toBe(true);
            expect(result.requirements.length).toBeGreaterThan(0);
            expect(result.requirements.some(r => r.includes('LGPD'))).toBe(true);
        });

        it('ZA to NG cross-border flags POPIA + NDPR', () => {
            const result = crossBorderRequirements('ZA', 'NG');
            expect(result.allowed).toBe(true);
            expect(result.requirements.some(r => r.includes('POPIA'))).toBe(true);
            expect(result.requirements.some(r => r.includes('NDPR'))).toBe(true);
        });

        it('DE to BR flags GDPR-to-non-aligned transfer', () => {
            // Both are GDPR-aligned, so no SCCs needed
            const result = crossBorderRequirements('DE', 'BR');
            expect(result.allowed).toBe(true);
            // Both cross-border restricted AND both GDPR-aligned
            // so no "adequacy" requirement, but DPA required
            expect(result.requirements.some(r => r.includes('Data Processing Agreement'))).toBe(true);
        });

        it('DE to US flags GDPR-to-non-aligned + SCCs', () => {
            const result = crossBorderRequirements('DE', 'US');
            expect(result.allowed).toBe(true);
            expect(result.requirements.some(r => r.includes('adequacy decision or SCCs'))).toBe(true);
        });

        it('KE to US flags DPA 2019 restriction', () => {
            const result = crossBorderRequirements('KE', 'US');
            expect(result.allowed).toBe(true);
            expect(result.requirements.some(r => r.includes('DPA 2019'))).toBe(true);
        });
    });
});
