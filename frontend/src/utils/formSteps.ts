import type { FormField, FormStep } from '@/types/formBuilder';

/**
 * Generate a short unique ID for form fields and steps.
 */
export function genId(): string {
    return Math.random().toString(36).slice(2, 9);
}

/**
 * Auto-group an array of FormFields into logical FormSteps
 * based on field key patterns (contact, location, etc.).
 * This is the default grouping used when no explicit step config exists.
 */
export function autoGroupSteps(fields: FormField[]): FormStep[] {
    if (fields.length === 0) return [];

    const CONTACT_KEYS = new Set(['name', 'first_name', 'last_name', 'full_name', 'email', 'phone', 'phone_number', 'zip', 'zipcode', 'zip_code']);
    const LOCATION_KEYS = new Set(['address', 'city', 'state', 'region', 'country']);

    const contact: string[] = [];
    const location: string[] = [];
    const other: string[] = [];

    for (const f of fields) {
        const k = f.key.toLowerCase();
        if (CONTACT_KEYS.has(k)) contact.push(f.id);
        else if (LOCATION_KEYS.has(k)) location.push(f.id);
        else other.push(f.id);
    }

    const steps: FormStep[] = [];

    // Non-PII steps first
    if (other.length > 0) {
        steps.push({ id: genId(), label: 'Details', fieldIds: other });
    }
    if (location.length > 0) {
        steps.push({ id: genId(), label: 'Location', fieldIds: location });
    }
    // Contact Info (PII) always last — best practice for lead gen conversion
    if (contact.length > 0) {
        steps.push({ id: genId(), label: 'Contact Info', fieldIds: contact });
    }

    // If grouping resulted in only one step, merge everything
    if (steps.length === 1) {
        return [{ id: genId(), label: 'Your Information', fieldIds: fields.map((f) => f.id) }];
    }

    // Guarantee at least one step
    if (steps.length === 0) {
        steps.push({ id: genId(), label: 'Your Information', fieldIds: fields.map((f) => f.id) });
    }

    return steps;
}
