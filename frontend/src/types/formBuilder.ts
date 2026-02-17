// ============================================
// Form Builder Types
// ============================================

export interface FormField {
    id: string;
    key: string;
    label: string;
    type: 'text' | 'select' | 'boolean' | 'number' | 'textarea' | 'email' | 'phone' | 'date';
    required: boolean;
    placeholder?: string;
    options?: string[];
    /** Show this field only when a sibling field meets a condition */
    showWhen?: { field: string; equals: string | boolean };
    /** Auto-format pattern applied as-you-type */
    autoFormat?: 'phone' | 'zip' | 'currency';
    /** Help text displayed below the input */
    helpText?: string;
}

export interface FormStep {
    id: string;
    label: string;
    fieldIds: string[];
}

export interface GamificationConfig {
    showProgress: boolean;
    showNudges: boolean;
    confetti: boolean;
}

export interface FormColorScheme {
    name: string;
    swatch: string; // CSS color for the swatch button
    vars: Record<string, string>;
}

// ============================================
// CRO (Conversion Rate Optimization) Config
// ============================================

export interface CROConfig {
    /** Trust bar: "256-bit encrypted", "TCPA compliant", etc. */
    showTrustBar: boolean;
    /** "X leads verified today" counter */
    showSocialProof: boolean;
    /** Persist form state across page reloads via sessionStorage */
    persistFormState: boolean;
    /** Auto-prefill matching fields from URL query params */
    utmPrefill: boolean;
    /** Exit-intent modal on mouse-leave / back-button */
    showExitIntent: boolean;
    /** Speed badge on the thank-you page */
    showSpeedBadge: boolean;
    /** Single-column layout enforced on all viewports */
    singleColumn: boolean;
}

export const DEFAULT_CRO_CONFIG: CROConfig = {
    showTrustBar: true,
    showSocialProof: true,
    persistFormState: true,
    utmPrefill: true,
    showExitIntent: false,
    showSpeedBadge: true,
    singleColumn: true,
};
