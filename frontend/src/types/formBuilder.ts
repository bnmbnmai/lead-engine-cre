// ============================================
// Form Builder Types
// ============================================

export interface FormField {
    id: string;
    key: string;
    label: string;
    type: 'text' | 'select' | 'boolean' | 'number' | 'textarea' | 'email' | 'phone';
    required: boolean;
    placeholder?: string;
    options?: string[];
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
