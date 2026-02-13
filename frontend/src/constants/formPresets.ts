import type { FormField, FormColorScheme } from '@/types/formBuilder';

// ============================================
// Color Schemes
// ============================================

export const COLOR_SCHEMES: FormColorScheme[] = [
    {
        name: 'Dark',
        swatch: '#1a1a2e',
        vars: { '--form-bg': '#1a1a2e', '--form-text': '#e2e8f0', '--form-accent': '#6366f1', '--form-border': '#334155', '--form-input-bg': '#0f172a', '--form-muted': '#94a3b8' },
    },
    {
        name: 'Light',
        swatch: '#ffffff',
        vars: { '--form-bg': '#ffffff', '--form-text': '#1e293b', '--form-accent': '#2563eb', '--form-border': '#e2e8f0', '--form-input-bg': '#f8fafc', '--form-muted': '#64748b' },
    },
    {
        name: 'Ocean Blue',
        swatch: '#0c1929',
        vars: { '--form-bg': '#0c1929', '--form-text': '#cbd5e1', '--form-accent': '#0ea5e9', '--form-border': '#1e3a5f', '--form-input-bg': '#0a1220', '--form-muted': '#7dd3fc' },
    },
    {
        name: 'Forest Green',
        swatch: '#14261a',
        vars: { '--form-bg': '#14261a', '--form-text': '#d1d5db', '--form-accent': '#22c55e', '--form-border': '#1e3a29', '--form-input-bg': '#0d1f12', '--form-muted': '#86efac' },
    },
    {
        name: 'Sunset Warm',
        swatch: '#fef3e2',
        vars: { '--form-bg': '#fef3e2', '--form-text': '#44403c', '--form-accent': '#f97316', '--form-border': '#e7d5b8', '--form-input-bg': '#fffbf5', '--form-muted': '#78716c' },
    },
    {
        name: 'Midnight Purple',
        swatch: '#1a0a2e',
        vars: { '--form-bg': '#1a0a2e', '--form-text': '#d4d4d8', '--form-accent': '#a855f7', '--form-border': '#2e1065', '--form-input-bg': '#120720', '--form-muted': '#c4b5fd' },
    },
];

// ============================================
// Vertical Presets
// ============================================

export const VERTICAL_PRESETS: Record<string, FormField[]> = {
    roofing: [
        { id: '1', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'John Doe' },
        { id: '2', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'john@example.com' },
        { id: '3', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 123-4567' },
        { id: '4', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '33101' },
        { id: '5', key: 'roof_type', label: 'Roof Type', type: 'select', required: true, options: ['Shingle', 'Tile', 'Metal', 'Flat', 'Slate'] },
        { id: '6', key: 'damage_type', label: 'Damage Type', type: 'select', required: false, options: ['Storm', 'Hail', 'Wind', 'Age', 'Leak', 'None'] },
        { id: '7', key: 'insurance_claim', label: 'Filing Insurance Claim?', type: 'boolean', required: false },
        { id: '8', key: 'roof_age', label: 'Roof Age (years)', type: 'number', required: false, placeholder: '15' },
    ],
    mortgage: [
        { id: '1', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Jane Smith' },
        { id: '2', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'jane@example.com' },
        { id: '3', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 987-6543' },
        { id: '4', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '90001' },
        { id: '5', key: 'loan_type', label: 'Loan Type', type: 'select', required: true, options: ['Purchase', 'Refinance', 'HELOC', 'Reverse', 'Construction'] },
        { id: '6', key: 'credit_range', label: 'Credit Score Range', type: 'select', required: true, options: ['Excellent (750+)', 'Good (700-749)', 'Fair (650-699)', 'Below 650'] },
        { id: '7', key: 'property_type', label: 'Property Type', type: 'select', required: false, options: ['Single Family', 'Condo', 'Townhouse', 'Multi-Family'] },
        { id: '8', key: 'purchase_price', label: 'Purchase Price', type: 'number', required: false, placeholder: '450000' },
    ],
    solar: [
        { id: '1', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Alex Johnson' },
        { id: '2', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'alex@example.com' },
        { id: '3', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 456-7890' },
        { id: '4', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '85001' },
        { id: '5', key: 'monthly_bill', label: 'Monthly Electric Bill ($)', type: 'number', required: true, placeholder: '250' },
        { id: '6', key: 'ownership', label: 'Home Ownership', type: 'select', required: true, options: ['Own', 'Rent', 'Buying'] },
        { id: '7', key: 'roof_age', label: 'Roof Age (years)', type: 'number', required: false, placeholder: '10' },
        { id: '8', key: 'shade_level', label: 'Roof Shade Level', type: 'select', required: false, options: ['No Shade', 'Partial', 'Heavy'] },
    ],
    insurance: [
        { id: '1', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Sam Wilson' },
        { id: '2', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'sam@example.com' },
        { id: '3', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 321-0987' },
        { id: '4', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '60601' },
        { id: '5', key: 'coverage_type', label: 'Coverage Type', type: 'select', required: true, options: ['Auto', 'Home', 'Life', 'Health', 'Business', 'Bundle'] },
        { id: '6', key: 'current_provider', label: 'Current Provider', type: 'text', required: false, placeholder: 'State Farm' },
        { id: '7', key: 'num_drivers', label: 'Number of Drivers', type: 'number', required: false, placeholder: '2' },
    ],
    home_services: [
        { id: '1', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Chris Lee' },
        { id: '2', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'chris@example.com' },
        { id: '3', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 654-3210' },
        { id: '4', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '10001' },
        { id: '5', key: 'service_type', label: 'Service Needed', type: 'select', required: true, options: ['HVAC', 'Plumbing', 'Electrical', 'Painting', 'Landscaping', 'Cleaning'] },
        { id: '6', key: 'urgency', label: 'Urgency', type: 'select', required: true, options: ['Emergency', 'This Week', 'This Month', 'Planning'] },
    ],
    b2b_saas: [
        { id: '1', key: 'company_name', label: 'Company Name', type: 'text', required: true, placeholder: 'Acme Corp' },
        { id: '2', key: 'company_size', label: 'Company Size', type: 'select', required: true, options: ['1-10', '11-50', '51-200', '201-1000', '1000+'] },
        { id: '3', key: 'industry', label: 'Industry', type: 'select', required: false, options: ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Other'] },
        { id: '4', key: 'decision_timeline', label: 'Decision Timeline', type: 'select', required: true, options: ['Immediate', '1-3 months', '3-6 months', '6+ months'] },
        { id: '5', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Taylor Chen' },
        { id: '6', key: 'email', label: 'Work Email', type: 'email', required: true, placeholder: 'taylor@acme.com' },
        { id: '7', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 111-2222' },
    ],
    real_estate: [
        { id: '1', key: 'transaction_type', label: 'Transaction Type', type: 'select', required: true, options: ['Buy', 'Sell', 'Rent'] },
        { id: '2', key: 'property_type', label: 'Property Type', type: 'select', required: true, options: ['Single Family', 'Condo', 'Townhouse', 'Multi-Family', 'Land'] },
        { id: '3', key: 'price_range', label: 'Price Range', type: 'select', required: true, options: ['Under $200k', '$200k-$500k', '$500k-$1M', '$1M-$2M', '$2M+'] },
        { id: '4', key: 'timeline', label: 'Timeline', type: 'select', required: true, options: ['ASAP', '1-3 months', '3-6 months', 'Just browsing'] },
        { id: '5', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '90210' },
        { id: '6', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Morgan Davis' },
        { id: '7', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'morgan@email.com' },
        { id: '8', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 333-4444' },
    ],
    auto: [
        { id: '1', key: 'vehicle_year', label: 'Vehicle Year', type: 'number', required: true, placeholder: '2020' },
        { id: '2', key: 'make', label: 'Make', type: 'text', required: true, placeholder: 'Toyota' },
        { id: '3', key: 'model', label: 'Model', type: 'text', required: true, placeholder: 'Camry' },
        { id: '4', key: 'coverage_type', label: 'Coverage Type', type: 'select', required: true, options: ['Full Coverage', 'Liability Only', 'Comprehensive', 'Collision'] },
        { id: '5', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '75001' },
        { id: '6', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Jordan Kim' },
        { id: '7', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'jordan@email.com' },
        { id: '8', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 555-6666' },
    ],
    legal: [
        { id: '1', key: 'case_type', label: 'Case Type', type: 'select', required: true, options: ['Personal Injury', 'Family Law', 'Criminal Defense', 'Business Law', 'Real Estate', 'Other'] },
        { id: '2', key: 'urgency', label: 'Urgency', type: 'select', required: true, options: ['Immediate', 'Within a week', 'Within a month', 'Consultation only'] },
        { id: '3', key: 'case_value', label: 'Estimated Case Value', type: 'select', required: false, options: ['Under $10k', '$10k-$50k', '$50k-$100k', '$100k+', 'Not sure'] },
        { id: '4', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '10001' },
        { id: '5', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Casey Martinez' },
        { id: '6', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'casey@email.com' },
        { id: '7', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 777-8888' },
    ],
    financial_services: [
        { id: '1', key: 'service_type', label: 'Service Type', type: 'select', required: true, options: ['Wealth Management', 'Retirement Planning', 'Tax Planning', 'Estate Planning', 'Investment Advisory'] },
        { id: '2', key: 'portfolio_size', label: 'Portfolio Size', type: 'select', required: false, options: ['Under $100k', '$100k-$500k', '$500k-$1M', '$1M-$5M', '$5M+'] },
        { id: '3', key: 'risk_tolerance', label: 'Risk Tolerance', type: 'select', required: false, options: ['Conservative', 'Moderate', 'Aggressive', 'Not sure'] },
        { id: '4', key: 'timeline', label: 'Meeting Timeline', type: 'select', required: true, options: ['This week', 'This month', 'Next 3 months', 'Just exploring'] },
        { id: '5', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Riley Thompson' },
        { id: '6', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'riley@email.com' },
        { id: '7', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 999-0000' },
    ],
};

// Generic fallback template for verticals without a specific preset
export const GENERIC_TEMPLATE: FormField[] = [
    { id: '1', key: 'full_name', label: 'Full Name', type: 'text', required: true, placeholder: 'Your Name' },
    { id: '2', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'you@example.com' },
    { id: '3', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 000-0000' },
    { id: '4', key: 'zip', label: 'ZIP Code', type: 'text', required: true, placeholder: '00000' },
];
