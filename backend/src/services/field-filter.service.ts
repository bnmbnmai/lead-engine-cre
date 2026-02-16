/**
 * Field Filter Evaluation Service — Lead Engine CRE
 *
 * Evaluates Lead.parameters against BuyerFieldFilter rules.
 * Used by:
 *   1. auto-bid.service.ts — field-level autobid rules (step 3.5)
 *   2. marketplace.routes.ts — POST /leads/search endpoint
 *
 * Security rules:
 *   - Only VerticalField records with isFilterable=true can appear in search filters
 *   - Only VerticalField records with isBiddable=true can appear in autobid rules
 *   - isPii=true fields are never evaluated (blocked at DB query level)
 *
 * Operator semantics:
 *   EQUALS       — exact match (string or number)
 *   NOT_EQUALS   — inverse of EQUALS
 *   IN           — value is in a JSON array: ["a","b","c"]
 *   NOT_IN       — value is NOT in the array
 *   GT / GTE     — greater than (number only)
 *   LT / LTE     — less than (number only)
 *   BETWEEN      — value within [min, max]: [500, 800] (number only)
 *   CONTAINS     — substring match (case-insensitive)
 *   STARTS_WITH  — prefix match (case-insensitive)
 */

// ============================================
// Types
// ============================================

/** A single filter rule (from BuyerFieldFilter or search request) */
export interface FieldFilterRule {
    fieldKey: string;         // Must match VerticalField.key AND Lead.parameters key
    operator: FilterOperator;
    value: string;            // JSON-encoded value
}

export type FilterOperator =
    | 'EQUALS' | 'NOT_EQUALS'
    | 'IN' | 'NOT_IN'
    | 'GT' | 'GTE' | 'LT' | 'LTE'
    | 'BETWEEN'
    | 'CONTAINS' | 'STARTS_WITH';

/** Combined result of evaluating all rules against a single lead */
export interface FilterEvalResult {
    pass: boolean;
    failedRules: { fieldKey: string; operator: string; reason: string }[];
}

// ============================================
// Evaluator
// ============================================

/**
 * Evaluate a set of field filter rules against a lead's parameters.
 * All rules must pass (AND logic).
 *
 * @param parameters  Lead.parameters JSON (flat key-value object)
 * @param rules       Array of filter rules to evaluate
 * @returns           { pass: boolean, failedRules: [...] }
 */
export function evaluateFieldFilters(
    parameters: Record<string, any> | null | undefined,
    rules: FieldFilterRule[]
): FilterEvalResult {
    const result: FilterEvalResult = { pass: true, failedRules: [] };

    if (!rules || rules.length === 0) return result;

    const params = parameters || {};

    for (const rule of rules) {
        const leadValue = params[rule.fieldKey];
        let filterValue: any;

        // Parse JSON-encoded value safely
        try {
            filterValue = JSON.parse(rule.value);
        } catch {
            filterValue = rule.value; // treat as raw string if not valid JSON
        }

        const passed = evaluateSingleRule(leadValue, rule.operator, filterValue);

        if (!passed) {
            result.pass = false;
            result.failedRules.push({
                fieldKey: rule.fieldKey,
                operator: rule.operator,
                reason: `${rule.fieldKey}: ${formatValue(leadValue)} does not satisfy ${rule.operator} ${formatValue(filterValue)}`,
            });
        }
    }

    return result;
}

/**
 * Evaluate a single rule: does leadValue satisfy [operator] filterValue?
 */
function evaluateSingleRule(
    leadValue: any,
    operator: FilterOperator,
    filterValue: any
): boolean {
    // If lead has no value for this field, only EQUALS null or NOT_EQUALS passes
    if (leadValue === undefined || leadValue === null) {
        if (operator === 'NOT_EQUALS') return filterValue !== null && filterValue !== undefined;
        if (operator === 'NOT_IN') return true; // null is not in any list
        return false; // all other operators require a value
    }

    switch (operator) {
        case 'EQUALS':
            return normalize(leadValue) === normalize(filterValue);

        case 'NOT_EQUALS':
            return normalize(leadValue) !== normalize(filterValue);

        case 'IN': {
            if (!Array.isArray(filterValue)) return false;
            const normalizedList = filterValue.map(normalize);
            return normalizedList.includes(normalize(leadValue));
        }

        case 'NOT_IN': {
            if (!Array.isArray(filterValue)) return true;
            const normalizedList = filterValue.map(normalize);
            return !normalizedList.includes(normalize(leadValue));
        }

        case 'GT':
            return toNumber(leadValue) > toNumber(filterValue);

        case 'GTE':
            return toNumber(leadValue) >= toNumber(filterValue);

        case 'LT':
            return toNumber(leadValue) < toNumber(filterValue);

        case 'LTE':
            return toNumber(leadValue) <= toNumber(filterValue);

        case 'BETWEEN': {
            if (!Array.isArray(filterValue) || filterValue.length !== 2) return false;
            const num = toNumber(leadValue);
            return num >= toNumber(filterValue[0]) && num <= toNumber(filterValue[1]);
        }

        case 'CONTAINS':
            return String(leadValue).toLowerCase().includes(String(filterValue).toLowerCase());

        case 'STARTS_WITH':
            return String(leadValue).toLowerCase().startsWith(String(filterValue).toLowerCase());

        default:
            return false; // Unknown operator — fail closed for security
    }
}

// ============================================
// Helpers
// ============================================

/** Normalize a value for comparison (lowercase strings, preserve numbers) */
function normalize(val: any): string | number {
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return String(val);
    return String(val).toLowerCase().trim();
}

/** Convert a value to a number for numeric comparisons */
function toNumber(val: any): number {
    const num = Number(val);
    return isNaN(num) ? 0 : num;
}

/** Format a value for human-readable error messages */
function formatValue(val: any): string {
    if (val === undefined || val === null) return 'null';
    if (Array.isArray(val)) return `[${val.join(', ')}]`;
    return String(val);
}
