/**
 * PII Protection Service
 *
 * Central utility for classifying lead fields as PII vs non-PII
 * and producing redacted previews for buyer bid pages.
 *
 * Design: Whitelist approach — only explicitly safe fields pass through.
 * Unknown fields are treated as PII by default.
 */

import { scrubPII } from './vertical-optimizer.service';

// ============================================
// PII Field Classification
// ============================================

/** Fields that are ALWAYS PII and must never appear in previews */
const _PII_FIELDS = new Set([
    'firstName', 'lastName', 'email', 'phone', 'address',
    'ssn', 'dob', 'dateOfBirth', 'ip', 'ipAddress',
    'driversLicense', 'bankAccount', 'routingNumber',
    'socialSecurity', 'taxId', 'passportNumber',
]);

/** Top-level Lead model fields that are safe to show in previews */
const _SAFE_LEAD_FIELDS = new Set([
    'vertical', 'geo', 'source', 'status', 'isVerified',
    'createdAt', 'auctionStartAt', 'auctionEndAt',
    'reservePrice', 'parameters',
]);

/** Parameter keys that are ALWAYS PII regardless of vertical */
const PII_PARAMETER_KEYS = new Set([
    'firstName', 'lastName', 'name', 'fullName',
    'email', 'emailAddress', 'phone', 'phoneNumber', 'mobile',
    'address', 'streetAddress', 'street', 'apartment', 'unit',
    'ssn', 'socialSecurity', 'taxId',
    'dob', 'dateOfBirth', 'birthDate',
    'ip', 'ipAddress', 'userAgent',
]);

// ============================================
// Vertical Preview Configuration
// ============================================

export interface FormStep {
    label: string;
    keys: string[];
}

export interface VerticalPreviewConfig {
    /** Parameter keys safe to show for this vertical */
    safeKeys: string[];
    /** Grouping into form steps for accordion display */
    formSteps: FormStep[];
}

/**
 * Per-vertical configuration for which parameters to show
 * and how to group them into form steps.
 */
export const VERTICAL_PREVIEW_CONFIG: Record<string, VerticalPreviewConfig> = {
    mortgage: {
        safeKeys: [
            'propertyType', 'homeValue', 'loanAmount', 'loanType',
            'creditScore', 'purchaseTimeline', 'occupancy', 'downPayment',
        ],
        formSteps: [
            { label: 'Property Details', keys: ['propertyType', 'homeValue', 'occupancy'] },
            { label: 'Financial Info', keys: ['loanAmount', 'loanType', 'creditScore', 'downPayment'] },
            { label: 'Timeline', keys: ['purchaseTimeline'] },
        ],
    },
    solar: {
        safeKeys: [
            'roofType', 'roofAge', 'sqft', 'electricBill',
            'creditScore', 'systemSize', 'timeline', 'shading',
        ],
        formSteps: [
            { label: 'Property Details', keys: ['roofType', 'roofAge', 'sqft', 'shading'] },
            { label: 'Financial Info', keys: ['electricBill', 'creditScore'] },
            { label: 'Project Scope', keys: ['systemSize', 'timeline'] },
        ],
    },
    roofing: {
        safeKeys: [
            'propertyType', 'roofType', 'roofAge', 'projectBudget',
            'projectType', 'urgency', 'sqft', 'stories',
        ],
        formSteps: [
            { label: 'Property Details', keys: ['propertyType', 'roofType', 'roofAge', 'sqft', 'stories'] },
            { label: 'Financial Info', keys: ['projectBudget'] },
            { label: 'Project Scope', keys: ['projectType', 'urgency'] },
        ],
    },
    insurance: {
        safeKeys: [
            'propertyType', 'coverageType', 'currentCarrier',
            'homeAge', 'sqft', 'claimsHistory',
        ],
        formSteps: [
            { label: 'Property Details', keys: ['propertyType', 'homeAge', 'sqft'] },
            { label: 'Coverage Info', keys: ['coverageType', 'currentCarrier', 'claimsHistory'] },
        ],
    },
    home_services: {
        safeKeys: [
            'propertyType', 'serviceType', 'projectScope',
            'urgency', 'timeline', 'sqft', 'budget',
        ],
        formSteps: [
            { label: 'Property Details', keys: ['propertyType', 'sqft'] },
            { label: 'Service Info', keys: ['serviceType', 'projectScope', 'urgency'] },
            { label: 'Budget & Timeline', keys: ['budget', 'timeline'] },
        ],
    },
    real_estate: {
        safeKeys: [
            'propertyType', 'transactionType', 'priceRange',
            'bedrooms', 'sqft', 'timeline', 'preApproved', 'financing',
        ],
        formSteps: [
            { label: 'Property Details', keys: ['propertyType', 'bedrooms', 'sqft'] },
            { label: 'Transaction Info', keys: ['transactionType', 'priceRange', 'financing'] },
            { label: 'Timeline', keys: ['timeline', 'preApproved'] },
        ],
    },
    auto: {
        safeKeys: [
            'coverageType', 'vehicleType', 'vehicleYear',
            'currentCarrier', 'drivingRecord', 'annualMileage', 'multiCar',
        ],
        formSteps: [
            { label: 'Vehicle Info', keys: ['vehicleType', 'vehicleYear', 'annualMileage'] },
            { label: 'Coverage Info', keys: ['coverageType', 'currentCarrier', 'drivingRecord'] },
            { label: 'Discounts', keys: ['multiCar'] },
        ],
    },
    b2b_saas: {
        safeKeys: [
            'companySize', 'industry', 'currentSolution',
            'budget', 'decisionTimeline', 'painPoints', 'usersNeeded',
        ],
        formSteps: [
            { label: 'Company Info', keys: ['companySize', 'industry'] },
            { label: 'Current Setup', keys: ['currentSolution', 'painPoints'] },
            { label: 'Budget & Timeline', keys: ['budget', 'decisionTimeline', 'usersNeeded'] },
        ],
    },
    legal: {
        safeKeys: [
            'caseType', 'urgency', 'priorRepresentation',
            'caseTimeline', 'consultationType',
        ],
        formSteps: [
            { label: 'Case Details', keys: ['caseType', 'urgency', 'caseTimeline'] },
            { label: 'Consultation', keys: ['consultationType', 'priorRepresentation'] },
        ],
    },
    financial_services: {
        safeKeys: [
            'serviceType', 'investmentRange', 'riskTolerance',
            'timeline', 'currentAdvisor', 'accountType',
        ],
        formSteps: [
            { label: 'Service Info', keys: ['serviceType', 'accountType'] },
            { label: 'Financial Profile', keys: ['investmentRange', 'riskTolerance'] },
            { label: 'Timeline', keys: ['timeline', 'currentAdvisor'] },
        ],
    },
};

/** Fallback config for verticals not explicitly mapped */
const _DEFAULT_PREVIEW_CONFIG: VerticalPreviewConfig = {
    safeKeys: [],
    formSteps: [{ label: 'Lead Details', keys: [] }],
};

// ============================================
// Field Classification
// ============================================

export type FieldClassification = 'pii' | 'safe' | 'unknown';

/**
 * Classify a parameter field as PII, safe, or unknown.
 * Uses the vertical config to determine safe keys.
 */
export function classifyField(
    key: string,
    vertical?: string,
): FieldClassification {
    // Always-PII keys
    if (PII_PARAMETER_KEYS.has(key)) return 'pii';

    // Check vertical-specific safe keys
    if (vertical) {
        const config = VERTICAL_PREVIEW_CONFIG[vertical];
        if (config?.safeKeys.includes(key)) return 'safe';
    }

    return 'unknown';
}

// ============================================
// Lead Redaction
// ============================================

export interface RedactedPreview {
    vertical: string;
    geoState: string;
    geoCountry: string;
    source: string;
    status: string;
    isVerified: boolean;
    createdAt: string;
    reservePrice: number | null;
    zkDataHash: string | null;
    formSteps: {
        label: string;
        fields: { key: string; label: string; value: string }[];
    }[];
}

/**
 * Format a camelCase parameter key into a human-readable label.
 * e.g., "loanAmount" → "Loan Amount", "creditScore" → "Credit Score"
 */
export function formatFieldLabel(key: string): string {
    return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (s) => s.toUpperCase())
        .trim();
}

/**
 * Redact a lead record for buyer preview.
 *
 * For verticals with explicit configs: whitelist approach (only configured safe keys).
 * For dynamic/unknown verticals: blocklist approach (show all non-PII parameter keys).
 * All values are defense-in-depth scrubbed via scrubPII().
 */
export function redactLeadForPreview(lead: {
    vertical: string;
    geo: any;
    source: string;
    status: string;
    isVerified: boolean;
    createdAt: Date | string;
    reservePrice?: any;
    dataHash?: string | null;
    parameters?: Record<string, any> | null;
}): RedactedPreview {
    const explicitConfig = VERTICAL_PREVIEW_CONFIG[lead.vertical];

    // Extract geo safely
    const geo = typeof lead.geo === 'string' ? JSON.parse(lead.geo) : lead.geo || {};

    // Parse parameters once
    const params: Record<string, any> = lead.parameters
        ? (typeof lead.parameters === 'string' ? JSON.parse(lead.parameters) : lead.parameters)
        : {};

    // Build parameter map: filter through PII classification + scrub values
    const safeParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
        // Always skip PII-classified keys
        if (PII_PARAMETER_KEYS.has(key)) continue;

        if (explicitConfig) {
            // Whitelist mode: only keys in safeKeys pass
            if (!explicitConfig.safeKeys.includes(key)) continue;
        }
        // else: blocklist mode — anything not PII passes through

        // Defense-in-depth: scrub the value through PII regex
        const strValue = String(value ?? '');
        const scrubbed = scrubPII(strValue);
        safeParams[key] = scrubbed || 'Not Provided';
    }

    // Build form steps
    let formSteps: { label: string; fields: { key: string; label: string; value: string }[] }[];

    if (explicitConfig) {
        // Use curated form step groupings
        formSteps = explicitConfig.formSteps.map((step) => ({
            label: step.label,
            fields: step.keys.map((key) => ({
                key,
                label: formatFieldLabel(key),
                value: safeParams[key] || 'Not Provided',
            })),
        }));
    } else {
        // Dynamic: auto-derive a single "Lead Details" step from the params that passed
        const dynamicKeys = Object.keys(safeParams);
        formSteps = dynamicKeys.length > 0
            ? [{
                label: 'Lead Details', fields: dynamicKeys.map((key) => ({
                    key,
                    label: formatFieldLabel(key),
                    value: safeParams[key],
                }))
            }]
            : [];
    }

    return {
        vertical: lead.vertical,
        geoState: geo.state || 'Unknown',
        geoCountry: geo.country || 'US',
        source: lead.source,
        status: lead.status,
        isVerified: lead.isVerified,
        createdAt: typeof lead.createdAt === 'string'
            ? lead.createdAt
            : lead.createdAt.toISOString(),
        reservePrice: lead.reservePrice
            ? parseFloat(String(lead.reservePrice))
            : null,
        zkDataHash: lead.dataHash || null,
        formSteps,
    };
}
