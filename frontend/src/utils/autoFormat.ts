/**
 * Auto-format utilities for form fields.
 *
 * Applied as-you-type in FormPreview when a field has `autoFormat` set.
 */

/**
 * Format a string as a US phone number: (555) 123-4567
 */
export function formatPhone(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Format a string as a US ZIP code: max 5 digits.
 */
export function formatZip(raw: string): string {
    return raw.replace(/\D/g, '').slice(0, 5);
}

/**
 * Format a string as currency: $1,234,567
 */
export function formatCurrency(raw: string): string {
    const digits = raw.replace(/[^\d]/g, '');
    if (!digits) return '';
    const num = parseInt(digits, 10);
    if (isNaN(num)) return '';
    return '$' + num.toLocaleString('en-US');
}

/**
 * Apply the appropriate formatter based on the autoFormat key.
 */
export function applyAutoFormat(value: string, format: 'phone' | 'zip' | 'currency'): string {
    switch (format) {
        case 'phone': return formatPhone(value);
        case 'zip': return formatZip(value);
        case 'currency': return formatCurrency(value);
        default: return value;
    }
}
