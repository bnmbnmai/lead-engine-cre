import type { FormField, FormStep } from '@/types/formBuilder';

// ============================================
// Auto-step heuristic
// ============================================

const CONTACT_KEYS = new Set(['full_name', 'email', 'phone', 'name', 'first_name', 'last_name']);
const LOCATION_KEYS = new Set(['zip', 'zipcode', 'zip_code', 'state', 'city', 'address', 'region']);

let fieldCounter = 100;
export const genId = () => String(fieldCounter++);

export function autoGroupSteps(fields: FormField[]): FormStep[] {
    const contact: string[] = [];
    const location: string[] = [];
    const details: string[] = [];

    for (const f of fields) {
        if (CONTACT_KEYS.has(f.key)) contact.push(f.id);
        else if (LOCATION_KEYS.has(f.key)) location.push(f.id);
        else details.push(f.id);
    }

    const steps: FormStep[] = [];

    // 1. Details first - split into chunks of 3
    for (let i = 0; i < details.length; i += 3) {
        const chunk = details.slice(i, i + 3);
        const stepNum = Math.floor(i / 3) + 1;
        steps.push({
            id: genId(),
            label: details.length > 3 ? `Details ${stepNum}` : 'Details',
            fieldIds: chunk
        });
    }

    // 2. Location second (if has 2+ fields) or merge into last details step
    if (location.length >= 2) {
        steps.push({ id: genId(), label: 'Location', fieldIds: location });
    } else if (location.length === 1) {
        // Merge single location field into last step
        if (steps.length > 0) {
            steps[steps.length - 1].fieldIds.push(...location);
        } else {
            steps.push({ id: genId(), label: 'Location', fieldIds: location });
        }
    }

    // 3. Contact info LAST - best practice for lead gen conversion
    if (contact.length > 0) {
        steps.push({ id: genId(), label: 'Contact Info', fieldIds: contact });
    }

    // Ensure at least one step
    if (steps.length === 0) {
        steps.push({ id: genId(), label: 'Your Information', fieldIds: fields.map((f) => f.id) });
    }

    return steps;
}
