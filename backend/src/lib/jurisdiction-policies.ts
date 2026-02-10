// ============================================
// Jurisdiction Compliance Policies
// ============================================
// Data-driven compliance map for cross-border
// lead data transfer rules per country.

export interface JurisdictionPolicy {
    framework: string;
    requiresConsentProof: boolean;
    crossBorderRestricted: boolean;
    requiresOptIn: boolean;
    requiresDPA: boolean;
    gdprAligned: boolean;
    /** Verticals that are outright banned or heavily regulated */
    restrictedVerticals: string[];
}

export const JURISDICTION_POLICIES: Record<string, JurisdictionPolicy> = {
    // ─── Americas ───────────────────────────
    US: {
        framework: 'TCPA/CCPA',
        requiresConsentProof: true,
        crossBorderRestricted: false,
        requiresOptIn: false,
        requiresDPA: false,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    CA: {
        framework: 'PIPEDA',
        requiresConsentProof: true,
        crossBorderRestricted: false,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: true,
        restrictedVerticals: [],
    },
    MX: {
        framework: 'LFPDPPP',
        requiresConsentProof: true,
        crossBorderRestricted: false,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    BR: {
        framework: 'LGPD',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: true,
        gdprAligned: true,
        restrictedVerticals: [],
    },
    CO: {
        framework: 'Law 1581',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    AR: {
        framework: 'PDPA',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: true,
        restrictedVerticals: [],
    },
    CL: {
        framework: 'Law 19628',
        requiresConsentProof: true,
        crossBorderRestricted: false,
        requiresOptIn: false,
        requiresDPA: false,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    PE: {
        framework: 'Law 29733',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    EC: {
        framework: 'LOPDP',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: true,
        restrictedVerticals: [],
    },
    // ─── Europe ─────────────────────────────
    GB: {
        framework: 'UK-GDPR',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: true,
        gdprAligned: true,
        restrictedVerticals: [],
    },
    DE: {
        framework: 'GDPR/BDSG',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: true,
        gdprAligned: true,
        restrictedVerticals: [],
    },
    FR: {
        framework: 'GDPR/CNIL',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: true,
        gdprAligned: true,
        restrictedVerticals: [],
    },
    // ─── APAC ───────────────────────────────
    AU: {
        framework: 'Privacy Act',
        requiresConsentProof: true,
        crossBorderRestricted: false,
        requiresOptIn: false,
        requiresDPA: false,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    IN: {
        framework: 'DPDPA 2023',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    JP: {
        framework: 'APPI',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: true,
        restrictedVerticals: [],
    },
    KR: {
        framework: 'PIPA',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: true,
        gdprAligned: true,
        restrictedVerticals: [],
    },
    SG: {
        framework: 'PDPA',
        requiresConsentProof: true,
        crossBorderRestricted: false,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    // ─── Middle East ────────────────────────
    AE: {
        framework: 'PDPL',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    // ─── Africa ─────────────────────────────
    ZA: {
        framework: 'POPIA',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: true,
        gdprAligned: true,
        restrictedVerticals: [],
    },
    NG: {
        framework: 'NDPR',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: true,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    KE: {
        framework: 'DPA 2019',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: true,
        restrictedVerticals: [],
    },
    GH: {
        framework: 'DPA 2012',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    EG: {
        framework: 'PDPL 2020',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: true,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    TZ: {
        framework: 'Cybercrimes Act',
        requiresConsentProof: false,
        crossBorderRestricted: false,
        requiresOptIn: false,
        requiresDPA: false,
        gdprAligned: false,
        restrictedVerticals: [],
    },
    MA: {
        framework: 'Law 09-08',
        requiresConsentProof: true,
        crossBorderRestricted: true,
        requiresOptIn: true,
        requiresDPA: false,
        gdprAligned: true,
        restrictedVerticals: [],
    },
};

// ─── Helpers ────────────────────────────────

export function getPolicy(countryCode: string): JurisdictionPolicy | undefined {
    return JURISDICTION_POLICIES[countryCode.toUpperCase()];
}

/**
 * Check whether cross-border lead data transfer between two countries
 * requires additional compliance measures.
 */
export function crossBorderRequirements(
    sellerCountry: string,
    buyerCountry: string,
): { allowed: boolean; requirements: string[]; reason?: string } {
    if (sellerCountry === buyerCountry) {
        return { allowed: true, requirements: [] };
    }

    const sellerPolicy = getPolicy(sellerCountry);
    const buyerPolicy = getPolicy(buyerCountry);
    const requirements: string[] = [];

    if (sellerPolicy?.crossBorderRestricted) {
        requirements.push(`${sellerCountry} (${sellerPolicy.framework}): cross-border data transfer restricted — consent proof required`);
    }

    if (buyerPolicy?.crossBorderRestricted) {
        requirements.push(`${buyerCountry} (${buyerPolicy.framework}): inbound data transfer may need DPA`);
    }

    if (sellerPolicy?.gdprAligned && !buyerPolicy?.gdprAligned) {
        requirements.push(`Transfer from GDPR-aligned ${sellerCountry} to non-aligned ${buyerCountry} requires adequacy decision or SCCs`);
    }

    if (sellerPolicy?.requiresDPA || buyerPolicy?.requiresDPA) {
        requirements.push('Data Processing Agreement (DPA) must be in place');
    }

    return {
        allowed: true, // allow but flag requirements
        requirements,
        reason: requirements.length > 0 ? requirements.join('; ') : undefined,
    };
}
