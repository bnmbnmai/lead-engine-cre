/**
 * SupplySpec validation unit tests
 */
import { describe, it, expect } from 'vitest';
import { parseSupplySpec, validateSupplyListing } from '../src/supply-spec';

const baseSpec = parseSupplySpec({
    version: 1,
    name: 'Solar supply',
    vertical: 'solar.residential',
    reservePrice: 5,
    dailyListingCap: 10,
    hourlyListingCap: 5,
    requiredFieldKeys: ['email', 'phone'],
    minFieldCount: 2,
    requireTcpaProof: true,
});

describe('SupplySpec', () => {
    it('accepts valid listing request', () => {
        const result = validateSupplyListing(
            baseSpec,
            {
                vertical: 'solar.residential',
                geo: { country: 'US', state: 'CA' },
                fields: { email: 'a@b.com', phone: '5551234567', roofAge: '5y' },
                tcpaConsentAt: new Date().toISOString(),
                tcpaProof: { consentId: 'c1' },
            },
            { listingsToday: 0, listingsThisHour: 0 },
        );
        expect(result.ok).toBe(true);
    });

    it('rejects missing tcpa proof', () => {
        const result = validateSupplyListing(
            baseSpec,
            {
                vertical: 'solar.residential',
                fields: { email: 'a@b.com', phone: '5551234567' },
            },
            { listingsToday: 0, listingsThisHour: 0 },
        );
        expect(result.ok).toBe(false);
        expect(result.gate).toBe('tcpa');
    });

    it('rejects daily cap exceeded', () => {
        const result = validateSupplyListing(
            baseSpec,
            {
                vertical: 'solar.residential',
                fields: { email: 'a@b.com', phone: '5551234567' },
                tcpaConsentAt: new Date().toISOString(),
                tcpaProof: 'token',
            },
            { listingsToday: 10, listingsThisHour: 0 },
        );
        expect(result.ok).toBe(false);
        expect(result.gate).toBe('dailyCap');
    });
});
