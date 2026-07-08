/**
 * Field-level filter evaluation — pure, deterministic, no I/O.
 *
 * Operator semantics:
 *   EQUALS       — exact match (string or number, case-insensitive strings)
 *   NOT_EQUALS   — inverse of EQUALS
 *   IN           — value is in a JSON array: ["a","b","c"]
 *   NOT_IN       — value is NOT in the array
 *   GT/GTE/LT/LTE — numeric comparison
 *   BETWEEN      — value within [min, max]
 *   CONTAINS     — substring match (case-insensitive)
 *   STARTS_WITH  — prefix match (case-insensitive)
 *
 * Unknown operators fail closed.
 */
import type { FieldFilter, FilterEvalResult, FilterOperator } from './types';

/** Normalize a value for comparison (lowercase strings, preserve numbers). */
export function normalize(val: unknown): string | number {
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return String(val);
    return String(val).toLowerCase().trim();
}

/** Convert a value to a number for numeric comparisons (NaN → 0). */
export function toNumber(val: unknown): number {
    const num = Number(val);
    return isNaN(num) ? 0 : num;
}

function formatValue(val: unknown): string {
    if (val === undefined || val === null) return 'null';
    if (Array.isArray(val)) return `[${val.join(', ')}]`;
    return String(val);
}

/** Evaluate a single rule: does leadValue satisfy [operator] filterValue? */
export function evaluateSingleRule(
    leadValue: unknown,
    operator: FilterOperator,
    filterValue: unknown,
): boolean {
    // Missing lead value: only negative operators can pass
    if (leadValue === undefined || leadValue === null) {
        if (operator === 'NOT_EQUALS') return filterValue !== null && filterValue !== undefined;
        if (operator === 'NOT_IN') return true;
        return false;
    }

    switch (operator) {
        case 'EQUALS':
            return normalize(leadValue) === normalize(filterValue);
        case 'NOT_EQUALS':
            return normalize(leadValue) !== normalize(filterValue);
        case 'IN': {
            if (!Array.isArray(filterValue)) return false;
            return filterValue.map(normalize).includes(normalize(leadValue));
        }
        case 'NOT_IN': {
            if (!Array.isArray(filterValue)) return true;
            return !filterValue.map(normalize).includes(normalize(leadValue));
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
            return false; // fail closed
    }
}

/**
 * Evaluate a set of field filter rules against a lead's parameters.
 * All rules must pass (AND logic). Pure function.
 */
export function evaluateFieldFilters(
    parameters: Record<string, unknown> | null | undefined,
    rules: FieldFilter[],
): FilterEvalResult {
    const result: FilterEvalResult = { pass: true, failedKeys: [], failedRules: [] };
    if (!rules || rules.length === 0) return result;

    const params = parameters || {};

    for (const rule of rules) {
        const leadValue = params[rule.fieldKey];
        let filterValue: unknown;
        try {
            filterValue = JSON.parse(rule.value);
        } catch {
            filterValue = rule.value; // raw string when not valid JSON
        }

        if (!evaluateSingleRule(leadValue, rule.operator, filterValue)) {
            result.pass = false;
            result.failedKeys.push(rule.fieldKey);
            result.failedRules.push({
                fieldKey: rule.fieldKey,
                operator: rule.operator,
                reason: `${rule.fieldKey}: ${formatValue(leadValue)} does not satisfy ${rule.operator} ${formatValue(filterValue)}`,
            });
        }
    }

    return result;
}
