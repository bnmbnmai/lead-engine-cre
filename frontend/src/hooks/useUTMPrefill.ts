/**
 * useUTMPrefill — Reads URL query params and pre-fills matching form fields.
 *
 * Supports params like ?state=CA&zip=90210&vertical=solar.
 * Only sets values for fields that are currently empty.
 */

import { useEffect, useRef } from 'react';
import type { FormField } from '@/types/formBuilder';

interface UseUTMPrefillOpts {
    fields: FormField[];
    formData: Record<string, string | boolean>;
    setFormData: React.Dispatch<React.SetStateAction<Record<string, string | boolean>>>;
    enabled?: boolean;
}

/** Common param → field key mapping */
const PARAM_ALIASES: Record<string, string> = {
    state: 'state',
    zip: 'zip',
    zipcode: 'zip',
    email: 'email',
    phone: 'phone',
    name: 'fullName',
    full_name: 'fullName',
    vertical: '_vertical', // meta, not a form field
};

export function useUTMPrefill({
    fields,
    formData,
    setFormData,
    enabled = true,
}: UseUTMPrefillOpts) {
    const applied = useRef(false);

    useEffect(() => {
        if (!enabled || applied.current || fields.length === 0) return;
        applied.current = true;

        const params = new URLSearchParams(window.location.search);
        if (params.size === 0) return;

        const fieldKeys = new Set(fields.map(f => f.key));
        const updates: Record<string, string> = {};

        for (const [param, value] of params.entries()) {
            if (!value) continue;
            const lowerParam = param.toLowerCase();

            // Direct key match
            if (fieldKeys.has(param) && !formData[param]) {
                updates[param] = value;
                continue;
            }

            // Alias match
            const aliasKey = PARAM_ALIASES[lowerParam];
            if (aliasKey && aliasKey !== '_vertical' && fieldKeys.has(aliasKey) && !formData[aliasKey]) {
                updates[aliasKey] = value;
            }
        }

        if (Object.keys(updates).length > 0) {
            setFormData(prev => ({ ...prev, ...updates }));
        }
    }, [fields, formData, setFormData, enabled]);
}
