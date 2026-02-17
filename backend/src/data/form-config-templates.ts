/**
 * Form Config Templates — realistic formConfig JSON for every vertical.
 *
 * Structure matches the FormConfigSchema from vertical.routes.ts:
 *   { fields: [{id,key,label,type,required,placeholder?,options?}],
 *     steps:  [{id,label,fieldIds}],
 *     gamification?: {showProgress,showNudges,confetti} }
 *
 * Each child inherits parent contact/property fields and adds
 * 3–6 vertical-specific fields.
 */

export interface FormField {
    id: string;
    key: string;
    label: string;
    type: 'text' | 'select' | 'boolean' | 'number' | 'textarea' | 'email' | 'phone' | 'date';
    required: boolean;
    placeholder?: string;
    options?: string[];
    showWhen?: { field: string; equals: string | boolean };
    autoFormat?: 'phone' | 'zip' | 'currency';
    helpText?: string;
}

export interface FormStep {
    id: string;
    label: string;
    fieldIds: string[];
}

export interface FormConfig {
    fields: FormField[];
    steps: FormStep[];
    gamification?: { showProgress: boolean; showNudges: boolean; confetti: boolean };
}

// ─── Shared re-usable fields ───
const CONTACT_FIELDS: FormField[] = [
    { id: 'f_name', key: 'fullName', label: 'What is your full name?', type: 'text', required: true, placeholder: 'John Doe' },
    { id: 'f_email', key: 'email', label: 'Best email to reach you', type: 'email', required: true, placeholder: 'john@example.com' },
    { id: 'f_phone', key: 'phone', label: 'Phone number', type: 'phone', required: true, placeholder: '(555) 123-4567', autoFormat: 'phone' },
    { id: 'f_zip', key: 'zip', label: 'ZIP code', type: 'text', required: true, placeholder: '90210', autoFormat: 'zip' },
    { id: 'f_state', key: 'state', label: 'State', type: 'text', required: true, placeholder: 'CA' },
    { id: 'f_country', key: 'country', label: 'Country', type: 'select', required: true, options: ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'BR', 'MX', 'IN', 'JP', 'Other'] },
];

const CONTACT_STEP: FormStep = { id: 's_contact', label: 'Contact Info', fieldIds: ['f_name', 'f_email', 'f_phone', 'f_zip', 'f_state', 'f_country'] };

const DEFAULT_GAMIFICATION = { showProgress: true, showNudges: true, confetti: true };

function makeConfig(detailFields: FormField[], detailStepLabel: string): FormConfig {
    const detailStep: FormStep = { id: 's_details', label: detailStepLabel, fieldIds: detailFields.map(f => f.id) };
    return {
        fields: [...detailFields, ...CONTACT_FIELDS],
        steps: [detailStep, CONTACT_STEP],
        gamification: DEFAULT_GAMIFICATION,
    };
}

// ═══════════════════════════════════════════
//  SOLAR
// ═══════════════════════════════════════════
const SOLAR_COMMON: FormField[] = [
    { id: 'own_rent', key: 'ownOrRent', label: 'Do you own or rent your home?', type: 'select', required: true, options: ['Own', 'Rent'], helpText: 'Solar installation requires homeownership' },
    { id: 'roof_type', key: 'roofType', label: 'What type of roof do you have?', type: 'select', required: true, options: ['Asphalt Shingle', 'Metal', 'Tile', 'Flat/TPO', 'Slate'] },
    { id: 'roof_age', key: 'roofAge', label: 'How old is your roof?', type: 'number', required: false, placeholder: '10', helpText: 'Approximate years' },
    { id: 'electric_bill', key: 'electricBill', label: 'What is your monthly electric bill?', type: 'select', required: true, options: ['Under $100', '$100-$200', '$200-$300', '$300-$400', '$400+'] },
    { id: 'credit_score', key: 'creditScore', label: 'Approximate credit score', type: 'select', required: false, options: ['Excellent (750+)', 'Good (700-749)', 'Fair (650-699)', 'Below 650'] },
    { id: 'timeline', key: 'timeline', label: 'When are you looking to go solar?', type: 'select', required: true, options: ['ASAP', '1-3 months', '3-6 months', 'Just researching'] },
];

const solarResidential: FormConfig = makeConfig([
    ...SOLAR_COMMON,
    { id: 'sqft', key: 'sqft', label: 'Approximate home size (sqft)', type: 'number', required: false, placeholder: '2000' },
    { id: 'system_size', key: 'systemSize', label: 'Desired system size', type: 'select', required: false, options: ['4-6 kW', '6-8 kW', '8-10 kW', '10+ kW'] },
    { id: 'shading', key: 'shading', label: 'Does your roof get shade?', type: 'select', required: false, options: ['No shading', 'Partial shade', 'Heavy shade'] },
], 'Property & Solar Details');

const solarCommercial: FormConfig = makeConfig([
    ...SOLAR_COMMON,
    { id: 'bldg_sqft', key: 'buildingSqft', label: 'Building Sqft', type: 'number', required: true, placeholder: '10000' },
    { id: 'bldg_type', key: 'buildingType', label: 'Building Type', type: 'select', required: true, options: ['Warehouse', 'Office', 'Retail', 'Manufacturing', 'Mixed-Use'] },
    { id: 'energy_usage', key: 'monthlyEnergyKwh', label: 'Monthly Energy (kWh)', type: 'number', required: false, placeholder: '5000' },
], 'Commercial Solar Details');

const solarBattery: FormConfig = makeConfig([
    { id: 'existing_solar', key: 'existingSolar', label: 'Already Have Solar?', type: 'boolean', required: true },
    { id: 'battery_goal', key: 'batteryGoal', label: 'Primary Goal', type: 'select', required: true, options: ['Backup Power', 'Time-of-Use Savings', 'Off-Grid', 'EV Charging'] },
    { id: 'battery_budget', key: 'batteryBudget', label: 'Budget Range', type: 'select', required: true, options: ['Under $10K', '$10K-$15K', '$15K-$25K', '$25K+'] },
    { id: 'electric_bill_b', key: 'electricBill', label: 'Monthly Electric Bill', type: 'select', required: true, options: ['Under $100', '$100-$200', '$200-$300', '$400+'] },
], 'Battery Storage Details');

const solarCommunity: FormConfig = makeConfig([
    { id: 'interest_type', key: 'interestType', label: 'Interest Level', type: 'select', required: true, options: ['Subscribe to Program', 'Invest in Farm', 'Just Learning'] },
    { id: 'elec_bill_c', key: 'electricBill', label: 'Monthly Electric Bill', type: 'select', required: true, options: ['Under $100', '$100-$200', '$200-$300', '$400+'] },
    { id: 'credit_c', key: 'creditScore', label: 'Credit Score Range', type: 'select', required: false, options: ['Excellent (750+)', 'Good (700-749)', 'Fair (650-699)', 'Below 650'] },
], 'Community Solar Details');

// ═══════════════════════════════════════════
//  MORTGAGE
// ═══════════════════════════════════════════
const MORTGAGE_COMMON: FormField[] = [
    { id: 'prop_type_m', key: 'propertyType', label: 'What type of property?', type: 'select', required: true, options: ['Single Family', 'Condo', 'Townhouse', 'Multi-Family'] },
    { id: 'credit_m', key: 'creditScore', label: 'Approximate credit score', type: 'select', required: false, options: ['Excellent (750+)', 'Good (700-749)', 'Fair (650-699)', 'Below 650'] },
    { id: 'occupancy', key: 'occupancy', label: 'Is this your primary home?', type: 'select', required: true, options: ['Primary Residence', 'Second Home', 'Investment Property'] },
];

const mortgagePurchase: FormConfig = makeConfig([
    ...MORTGAGE_COMMON,
    { id: 'first_time', key: 'firstTimeBuyer', label: 'Are you a first-time home buyer?', type: 'boolean', required: false, helpText: 'First-time buyers may qualify for special programs' },
    { id: 'timeline_m', key: 'purchaseTimeline', label: 'When do you plan to purchase?', type: 'select', required: true, options: ['Immediately', '1-3 months', '3-6 months', '6+ months'] },
    { id: 'purchase_price', key: 'purchasePrice', label: 'Estimated purchase price', type: 'number', required: true, placeholder: '400000', autoFormat: 'currency' },
    { id: 'down_pmt', key: 'downPayment', label: 'How much can you put down?', type: 'select', required: true, options: ['3%', '5%', '10%', '20%', '25%+'] },
    { id: 'loan_type_p', key: 'loanType', label: 'Preferred loan type', type: 'select', required: false, options: ['Conventional', 'FHA', 'VA', 'USDA', 'Jumbo', 'Not sure'] },
    { id: 'pre_approved', key: 'preApproved', label: 'Have you been pre-approved?', type: 'boolean', required: false },
], 'Purchase Details');

const mortgageRefinance: FormConfig = makeConfig([
    ...MORTGAGE_COMMON,
    { id: 'refi_goal', key: 'refinanceGoal', label: 'What is your refinance goal?', type: 'select', required: true, options: ['Lower Rate', 'Lower Payment', 'Cash Out', 'Remove PMI', 'Shorter Term'] },
    { id: 'current_rate', key: 'currentRate', label: 'Current interest rate (%)', type: 'number', required: true, placeholder: '6.5' },
    { id: 'loan_balance', key: 'loanBalance', label: 'Remaining loan balance', type: 'number', required: true, placeholder: '250000', autoFormat: 'currency' },
    { id: 'home_value', key: 'homeValue', label: 'Estimated home value', type: 'number', required: false, placeholder: '450000', autoFormat: 'currency' },
    { id: 'cashout_amt', key: 'cashOutAmount', label: 'How much cash do you need?', type: 'number', required: false, placeholder: '0', autoFormat: 'currency', showWhen: { field: 'refinanceGoal', equals: 'Cash Out' } },
    { id: 'current_lender', key: 'currentLender', label: 'Current lender', type: 'text', required: false, placeholder: 'e.g. Wells Fargo' },
], 'Refinance Details');

const mortgageHeloc: FormConfig = makeConfig([
    ...MORTGAGE_COMMON,
    { id: 'home_val_h', key: 'homeValue', label: 'Estimated Home Value', type: 'number', required: true, placeholder: '450000' },
    { id: 'mortgage_bal', key: 'mortgageBalance', label: 'Current Mortgage Balance', type: 'number', required: true, placeholder: '200000' },
    { id: 'credit_needed', key: 'creditNeeded', label: 'Credit Amount Needed', type: 'number', required: true, placeholder: '50000' },
    { id: 'heloc_purpose', key: 'purpose', label: 'Purpose', type: 'select', required: true, options: ['Home Improvement', 'Debt Consolidation', 'Education', 'Emergency Fund', 'Other'] },
], 'HELOC Details');

const mortgageReverse: FormConfig = makeConfig([
    { id: 'age_rev', key: 'borrowerAge', label: 'Borrower Age', type: 'number', required: true, placeholder: '65' },
    { id: 'home_val_r', key: 'homeValue', label: 'Estimated Home Value', type: 'number', required: true, placeholder: '350000' },
    { id: 'mortgage_bal_r', key: 'mortgageBalance', label: 'Remaining Mortgage', type: 'number', required: false, placeholder: '50000' },
    { id: 'rev_goal', key: 'goal', label: 'Goal', type: 'select', required: true, options: ['Supplement Income', 'Pay Off Mortgage', 'Home Improvements', 'Healthcare Costs'] },
], 'Reverse Mortgage Details');

// ═══════════════════════════════════════════
//  ROOFING
// ═══════════════════════════════════════════
const ROOFING_COMMON: FormField[] = [
    { id: 'prop_type_r', key: 'propertyType', label: 'What type of property?', type: 'select', required: true, options: ['Single Family', 'Townhouse', 'Commercial', 'Multi-Family'] },
    { id: 'roof_type_r', key: 'roofMaterial', label: 'Current roof material', type: 'select', required: true, options: ['Asphalt Shingle', 'Metal', 'Tile', 'Flat/TPO', 'Slate', 'Wood Shake', 'Not sure'] },
    { id: 'stories_r', key: 'stories', label: 'How many stories?', type: 'select', required: true, options: ['1 Story', '2 Stories', '3+ Stories'] },
];

const roofingRepair: FormConfig = makeConfig([
    ...ROOFING_COMMON,
    { id: 'damage_type', key: 'damageType', label: 'What type of damage?', type: 'select', required: true, options: ['Leak', 'Missing Shingles', 'Storm Damage', 'Sagging', 'Other'] },
    { id: 'urgency_rr', key: 'urgency', label: 'How urgent is the repair?', type: 'select', required: true, options: ['Emergency', 'This week', '1-2 weeks', 'Flexible'] },
    { id: 'has_insurance', key: 'insuranceClaim', label: 'Are you filing an insurance claim?', type: 'boolean', required: false },
], 'Repair Details');

const roofingReplacement: FormConfig = makeConfig([
    ...ROOFING_COMMON,
    { id: 'roof_age_rr', key: 'roofAge', label: 'How old is your current roof?', type: 'number', required: false, placeholder: '20', helpText: 'Approximate years' },
    { id: 'home_size_rr', key: 'homeSize', label: 'Home size', type: 'select', required: true, options: ['Small (under 1,500 sqft)', 'Medium (1,500-2,500 sqft)', 'Large (2,500+ sqft)'] },
    { id: 'budget_rr', key: 'budget', label: 'Budget range', type: 'select', required: false, options: ['Under $10K', '$10K-$20K', '$20K-$35K', '$35K+'] },
    { id: 'preferred_mat', key: 'preferredMaterial', label: 'Preferred new material', type: 'select', required: false, options: ['Asphalt Shingle', 'Metal', 'Tile', 'Standing Seam', 'No preference'] },
], 'Replacement Details');

const roofingInspection: FormConfig = makeConfig([
    ...ROOFING_COMMON,
    { id: 'reason_inspect', key: 'inspectionReason', label: 'Reason for Inspection', type: 'select', required: true, options: ['Pre-purchase', 'Insurance Claim', 'Annual Checkup', 'Storm Damage', 'Selling Home'] },
    { id: 'roof_age_ri', key: 'roofAge', label: 'Estimated Roof Age', type: 'number', required: false, placeholder: '15' },
], 'Inspection Details');

const roofingGutter: FormConfig = makeConfig([
    { id: 'service_gutter', key: 'gutterService', label: 'Service Needed', type: 'select', required: true, options: ['New Install', 'Replacement', 'Repair', 'Cleaning', 'Guards/Covers'] },
    { id: 'gutter_len', key: 'linearFeet', label: 'Approx. Linear Feet', type: 'number', required: false, placeholder: '150' },
    { id: 'material_g', key: 'gutterMaterial', label: 'Material Preference', type: 'select', required: false, options: ['Aluminum', 'Copper', 'Vinyl', 'Steel', 'No preference'] },
    { id: 'stories_g', key: 'stories', label: 'Stories', type: 'select', required: true, options: ['1 Story', '2 Stories', '3+ Stories'] },
], 'Gutter & Drainage Details');

// ═══════════════════════════════════════════
//  INSURANCE
// ═══════════════════════════════════════════
const insuranceAuto: FormConfig = makeConfig([
    { id: 'vehicle_type', key: 'vehicleType', label: 'What type of vehicle?', type: 'select', required: true, options: ['Sedan', 'SUV', 'Truck', 'Sports Car', 'Minivan', 'Electric'] },
    { id: 'vehicle_year', key: 'vehicleYear', label: 'Vehicle year', type: 'number', required: true, placeholder: '2022' },
    { id: 'coverage_type_ia', key: 'coverageType', label: 'What coverage do you need?', type: 'select', required: true, options: ['Full Coverage', 'Liability Only', 'Comprehensive'] },
    { id: 'driving_record', key: 'drivingRecord', label: 'How is your driving record?', type: 'select', required: true, options: ['Clean', '1 ticket', '1 accident', 'Multiple incidents'] },
    { id: 'annual_mileage', key: 'annualMileage', label: 'Annual mileage', type: 'select', required: false, options: ['Under 5,000', '5,000-10,000', '10,000-15,000', '15,000+'], helpText: 'Lower mileage often means lower rates' },
    { id: 'current_carrier', key: 'currentCarrier', label: 'Current insurance company', type: 'select', required: false, options: ['State Farm', 'Allstate', 'Progressive', 'GEICO', 'None'] },
    { id: 'multi_car', key: 'multiCar', label: 'Insuring multiple vehicles?', type: 'boolean', required: false },
], 'Auto Insurance Details');

const insuranceHome: FormConfig = makeConfig([
    { id: 'prop_type_ih', key: 'propertyType', label: 'Property Type', type: 'select', required: true, options: ['Single Family', 'Condo', 'Townhouse', 'Rental Property'] },
    { id: 'home_age_ih', key: 'homeAge', label: 'Home Age (years)', type: 'number', required: true, placeholder: '15' },
    { id: 'sqft_ih', key: 'sqft', label: 'Square Footage', type: 'number', required: true, placeholder: '2200' },
    { id: 'coverage_ih', key: 'coverageType', label: 'Coverage Type', type: 'select', required: true, options: ['Homeowners', 'Renters', 'Umbrella', 'Bundled'] },
    { id: 'claims_ih', key: 'claimsHistory', label: 'Claims History', type: 'select', required: true, options: ['No claims', '1 claim (3+ years ago)', '1 claim (recent)', '2+ claims'] },
], 'Home Insurance Details');

const insuranceLife: FormConfig = makeConfig([
    { id: 'coverage_amt', key: 'coverageAmount', label: 'Coverage Amount', type: 'select', required: true, options: ['$100K', '$250K', '$500K', '$1M', '$2M+'] },
    { id: 'policy_type', key: 'policyType', label: 'Policy Type', type: 'select', required: true, options: ['Term (10yr)', 'Term (20yr)', 'Term (30yr)', 'Whole Life', 'Universal Life'] },
    { id: 'applicant_age', key: 'applicantAge', label: 'Age', type: 'number', required: true, placeholder: '35' },
    { id: 'health_status', key: 'healthStatus', label: 'Health Status', type: 'select', required: true, options: ['Excellent', 'Good', 'Average', 'Below Average'] },
    { id: 'smoker', key: 'smoker', label: 'Tobacco User?', type: 'boolean', required: true },
], 'Life Insurance Details');

const insuranceHealth: FormConfig = makeConfig([
    { id: 'plan_type', key: 'planType', label: 'Plan Type', type: 'select', required: true, options: ['Individual', 'Family', 'Small Group', 'Medicare Supplement'] },
    { id: 'household_size', key: 'householdSize', label: 'Household Size', type: 'number', required: true, placeholder: '3' },
    { id: 'income_range', key: 'incomeRange', label: 'Annual Income Range', type: 'select', required: true, options: ['Under $30K', '$30K-$50K', '$50K-$75K', '$75K-$100K', '$100K+'] },
    { id: 'current_coverage', key: 'currentCoverage', label: 'Current Coverage', type: 'select', required: true, options: ['Employer Plan', 'ACA Marketplace', 'Medicaid', 'Medicare', 'Uninsured'] },
    { id: 'pre_existing', key: 'preExistingConditions', label: 'Pre-Existing Conditions?', type: 'boolean', required: true },
], 'Health Insurance Details');

// ═══════════════════════════════════════════
//  HOME SERVICES
// ═══════════════════════════════════════════
const HS_COMMON: FormField[] = [
    { id: 'prop_type_hs', key: 'propertyType', label: 'Property Type', type: 'select', required: true, options: ['Single Family', 'Condo', 'Townhouse', 'Commercial'] },
    { id: 'urgency_hs', key: 'urgency', label: 'Urgency', type: 'select', required: true, options: ['Emergency', 'This week', '1-2 weeks', 'Flexible'] },
];

const hsPlumbing: FormConfig = makeConfig([
    ...HS_COMMON,
    { id: 'plumb_service', key: 'serviceType', label: 'Service Type', type: 'select', required: true, options: ['Leak Repair', 'Drain Cleaning', 'Water Heater', 'Pipe Replacement', 'Fixture Install', 'Sewer Line'] },
    { id: 'problem_desc', key: 'problemDescription', label: 'Describe the Problem', type: 'textarea', required: false, placeholder: 'e.g. Leaking kitchen faucet…' },
    { id: 'budget_hs', key: 'budget', label: 'Budget Range', type: 'select', required: false, options: ['Under $300', '$300-$1K', '$1K-$3K', '$3K+'] },
], 'Plumbing Details');

const hsElectrical: FormConfig = makeConfig([
    ...HS_COMMON,
    { id: 'elec_service', key: 'serviceType', label: 'Service Type', type: 'select', required: true, options: ['Wiring/Rewiring', 'Panel Upgrade', 'Outlet/Switch Install', 'Lighting', 'EV Charger', 'Generator'] },
    { id: 'elec_scope', key: 'projectScope', label: 'Project Scope', type: 'select', required: true, options: ['Minor Repair', 'Major Repair', 'Full Installation', 'Inspection'] },
    { id: 'budget_elec', key: 'budget', label: 'Budget Range', type: 'select', required: false, options: ['Under $500', '$500-$2K', '$2K-$5K', '$5K+'] },
], 'Electrical Details');

const hsHvac: FormConfig = makeConfig([
    ...HS_COMMON,
    { id: 'hvac_service', key: 'serviceType', label: 'What service do you need?', type: 'select', required: true, options: ['AC Repair', 'Furnace Repair', 'System Replacement', 'Duct Cleaning', 'Maintenance', 'Heat Pump'] },
    { id: 'system_type_hvac', key: 'systemType', label: 'System type', type: 'select', required: true, options: ['Central AC/Heat', 'Window Unit', 'Mini-Split', 'Not sure'] },
    { id: 'system_age', key: 'systemAge', label: 'How old is your system?', type: 'number', required: false, placeholder: '10', helpText: 'Approximate years' },
    { id: 'fuel_type', key: 'fuelType', label: 'Fuel type', type: 'select', required: false, options: ['Natural Gas', 'Electric', 'Oil', 'Propane', 'Heat Pump'] },
], 'HVAC Details');

const hsLandscaping: FormConfig = makeConfig([
    ...HS_COMMON,
    { id: 'land_service', key: 'serviceType', label: 'Service Type', type: 'select', required: true, options: ['Lawn Care', 'Hardscaping', 'Tree Service', 'Irrigation', 'Design', 'Maintenance'] },
    { id: 'lot_size', key: 'lotSize', label: 'Lot Size', type: 'select', required: true, options: ['Under 1/4 acre', '1/4-1/2 acre', '1/2-1 acre', '1+ acre'] },
    { id: 'budget_land', key: 'budget', label: 'Budget Range', type: 'select', required: true, options: ['Under $1K', '$1K-$5K', '$5K-$15K', '$15K+'] },
], 'Landscaping Details');

// ═══════════════════════════════════════════
//  B2B SAAS
// ═══════════════════════════════════════════
const SAAS_COMMON: FormField[] = [
    { id: 'company_size', key: 'companySize', label: 'Company Size', type: 'select', required: true, options: ['1-10', '11-50', '51-200', '201-500', '500+'] },
    { id: 'industry_saas', key: 'industry', label: 'Industry', type: 'select', required: true, options: ['Technology', 'Healthcare', 'Finance', 'Retail', 'Manufacturing', 'Other'] },
    { id: 'budget_saas', key: 'budget', label: 'Monthly Budget', type: 'select', required: true, options: ['<$1K/mo', '$1K-$5K/mo', '$5K-$10K/mo', '$10K+/mo'] },
    { id: 'decision_tl', key: 'decisionTimeline', label: 'Decision Timeline', type: 'select', required: true, options: ['Immediately', '1-3 months', '3-6 months', 'Evaluating'] },
];

const saasCrm: FormConfig = makeConfig([
    ...SAAS_COMMON,
    { id: 'crm_current', key: 'currentSolution', label: 'Current CRM', type: 'select', required: true, options: ['None', 'Spreadsheets', 'Salesforce', 'HubSpot', 'Other CRM'] },
    { id: 'crm_users', key: 'usersNeeded', label: 'Users Needed', type: 'select', required: true, options: ['1-5', '6-20', '21-50', '50+'] },
    { id: 'crm_features', key: 'keyFeatures', label: 'Key Features', type: 'select', required: false, options: ['Pipeline Mgmt', 'Email Integration', 'Reporting', 'Automation', 'Mobile App'] },
], 'CRM Requirements');

const saasAnalytics: FormConfig = makeConfig([
    ...SAAS_COMMON,
    { id: 'data_sources', key: 'dataSources', label: 'Primary Data Sources', type: 'select', required: true, options: ['Web Analytics', 'Sales Data', 'Financial Data', 'Marketing', 'Operations'] },
    { id: 'bi_current', key: 'currentTool', label: 'Current Tool', type: 'select', required: false, options: ['None', 'Excel', 'Tableau', 'Power BI', 'Looker', 'Other'] },
    { id: 'bi_users', key: 'usersNeeded', label: 'Users', type: 'select', required: true, options: ['1-5', '6-20', '21-50', '50+'] },
], 'Analytics Requirements');

const saasMarketing: FormConfig = makeConfig([
    ...SAAS_COMMON,
    { id: 'list_size', key: 'emailListSize', label: 'Email List Size', type: 'select', required: true, options: ['Under 1K', '1K-10K', '10K-50K', '50K-100K', '100K+'] },
    { id: 'channels', key: 'marketingChannels', label: 'Channels', type: 'select', required: true, options: ['Email', 'SMS', 'Social Media', 'Ads', 'Multi-channel'] },
    { id: 'ma_current', key: 'currentTool', label: 'Current Tool', type: 'select', required: false, options: ['None', 'Mailchimp', 'HubSpot', 'Active Campaign', 'Other'] },
], 'Marketing Automation Needs');

const saasHr: FormConfig = makeConfig([
    ...SAAS_COMMON,
    { id: 'hr_employees', key: 'employeeCount', label: 'Active Employees', type: 'number', required: true, placeholder: '50' },
    { id: 'hr_modules', key: 'modulesNeeded', label: 'Modules Needed', type: 'select', required: true, options: ['Payroll', 'Recruiting', 'Performance', 'Benefits', 'All-in-One'] },
    { id: 'hr_current', key: 'currentSystem', label: 'Current System', type: 'select', required: false, options: ['None', 'Spreadsheets', 'ADP', 'Gusto', 'BambooHR', 'Other'] },
], 'HR Tech Requirements');

// ═══════════════════════════════════════════
//  REAL ESTATE
// ═══════════════════════════════════════════
const RE_COMMON: FormField[] = [
    { id: 'transaction_type', key: 'transactionType', label: 'Transaction Type', type: 'select', required: true, options: ['Buying', 'Selling', 'Both', 'Investing'] },
    { id: 'timeline_re', key: 'timeline', label: 'Timeline', type: 'select', required: true, options: ['Immediately', '1-3 months', '3-6 months', '6+ months'] },
];

const reResidential: FormConfig = makeConfig([
    ...RE_COMMON,
    { id: 'prop_type_re', key: 'propertyType', label: 'Property Type', type: 'select', required: true, options: ['Single Family', 'Condo', 'Townhouse', 'Multi-Family'] },
    { id: 'price_range', key: 'priceRange', label: 'Price Range', type: 'select', required: true, options: ['Under $200K', '$200K-$400K', '$400K-$600K', '$600K-$1M', '$1M+'] },
    { id: 'bedrooms_re', key: 'bedrooms', label: 'Bedrooms', type: 'select', required: true, options: ['1-2', '3', '4', '5+'] },
    { id: 'pre_approved_re', key: 'preApproved', label: 'Pre-Approved?', type: 'boolean', required: false },
    { id: 'financing_re', key: 'financing', label: 'Financing Type', type: 'select', required: false, options: ['Conventional', 'FHA', 'VA', 'Cash', 'Other'] },
], 'Residential Property Details');

const reCommercial: FormConfig = makeConfig([
    ...RE_COMMON,
    { id: 'prop_type_rec', key: 'propertyType', label: 'Property Type', type: 'select', required: true, options: ['Office', 'Retail', 'Industrial', 'Multi-Family', 'Mixed-Use'] },
    { id: 'sqft_rec', key: 'sqftNeeded', label: 'Sqft Needed', type: 'number', required: true, placeholder: '5000' },
    { id: 'budget_rec', key: 'budget', label: 'Budget', type: 'select', required: true, options: ['Under $500K', '$500K-$1M', '$1M-$5M', '$5M+'] },
    { id: 'lease_buy', key: 'leaseBuy', label: 'Lease or Buy', type: 'select', required: true, options: ['Lease', 'Buy', 'Either'] },
], 'Commercial Property Details');

const reRental: FormConfig = makeConfig([
    ...RE_COMMON,
    { id: 'units_rental', key: 'unitCount', label: 'Number of Units', type: 'number', required: true, placeholder: '4' },
    { id: 'mgmt_need', key: 'managementNeeded', label: 'Property Management Needed?', type: 'boolean', required: true },
    { id: 'monthly_rent', key: 'targetRent', label: 'Target Monthly Rent', type: 'number', required: false, placeholder: '2000' },
    { id: 'rental_type', key: 'rentalType', label: 'Rental Type', type: 'select', required: true, options: ['Long-Term', 'Short-Term/Airbnb', 'Student Housing', 'Section 8'] },
], 'Rental Property Details');

const reLand: FormConfig = makeConfig([
    ...RE_COMMON,
    { id: 'acreage', key: 'acreage', label: 'Acreage Needed', type: 'select', required: true, options: ['Under 1 acre', '1-5 acres', '5-20 acres', '20+ acres'] },
    { id: 'land_use', key: 'intendedUse', label: 'Intended Use', type: 'select', required: true, options: ['Residential Build', 'Commercial Development', 'Agricultural', 'Recreation', 'Investment'] },
    { id: 'utilities', key: 'utilitiesNeeded', label: 'Utilities Required?', type: 'boolean', required: true },
    { id: 'zoning', key: 'zoningType', label: 'Zoning', type: 'select', required: false, options: ['Residential', 'Commercial', 'Agricultural', 'Mixed', 'Unknown'] },
], 'Vacant Land Details');

// ═══════════════════════════════════════════
//  AUTO
// ═══════════════════════════════════════════
const autoSales: FormConfig = makeConfig([
    { id: 'buy_type', key: 'purchaseType', label: 'Purchase Type', type: 'select', required: true, options: ['New', 'Used', 'Certified Pre-Owned', 'Lease'] },
    { id: 'veh_type_as', key: 'vehicleType', label: 'Vehicle Type', type: 'select', required: true, options: ['Sedan', 'SUV', 'Truck', 'Sports Car', 'Minivan', 'Electric'] },
    { id: 'budget_auto', key: 'budget', label: 'Budget', type: 'select', required: true, options: ['Under $20K', '$20K-$35K', '$35K-$50K', '$50K-$75K', '$75K+'] },
    { id: 'trade_in', key: 'hasTradeIn', label: 'Have a Trade-In?', type: 'boolean', required: false },
    { id: 'timeline_auto', key: 'purchaseTimeline', label: 'Timeline', type: 'select', required: true, options: ['Immediately', '1-2 weeks', '1-3 months', 'Just looking'] },
], 'Auto Sales Details');

const autoWarranty: FormConfig = makeConfig([
    { id: 'veh_make', key: 'vehicleMake', label: 'Vehicle Make', type: 'text', required: true, placeholder: 'Toyota' },
    { id: 'veh_model', key: 'vehicleModel', label: 'Vehicle Model', type: 'text', required: true, placeholder: 'Camry' },
    { id: 'veh_year_w', key: 'vehicleYear', label: 'Year', type: 'number', required: true, placeholder: '2020' },
    { id: 'mileage', key: 'mileage', label: 'Current Mileage', type: 'number', required: true, placeholder: '45000' },
    { id: 'warranty_type', key: 'warrantyType', label: 'Warranty Type', type: 'select', required: true, options: ['Powertrain', 'Bumper-to-Bumper', 'Comprehensive', 'Not Sure'] },
], 'Warranty Details');

const autoRepair: FormConfig = makeConfig([
    { id: 'veh_type_ar', key: 'vehicleType', label: 'Vehicle Type', type: 'select', required: true, options: ['Sedan', 'SUV', 'Truck', 'Sports Car', 'Minivan'] },
    { id: 'repair_type', key: 'repairType', label: 'Repair Type', type: 'select', required: true, options: ['Engine', 'Transmission', 'Brakes', 'Suspension', 'Electrical', 'Body Work', 'Other'] },
    { id: 'urgency_ar', key: 'urgency', label: 'Urgency', type: 'select', required: true, options: ['Immediate/Breakdown', 'This week', '1-2 weeks', 'Flexible'] },
    { id: 'repair_desc', key: 'problemDescription', label: 'Problem Description', type: 'textarea', required: false, placeholder: 'Describe the issue…' },
], 'Auto Repair Details');

const autoInsurance: FormConfig = makeConfig([
    { id: 'veh_type_ai', key: 'vehicleType', label: 'Vehicle Type', type: 'select', required: true, options: ['Sedan', 'SUV', 'Truck', 'Sports Car', 'Electric'] },
    { id: 'veh_year_ai', key: 'vehicleYear', label: 'Year', type: 'number', required: true, placeholder: '2022' },
    { id: 'coverage_ai', key: 'coverageType', label: 'Coverage Type', type: 'select', required: true, options: ['Full Coverage', 'Liability Only', 'Comprehensive + Collision'] },
    { id: 'driving_rec', key: 'drivingRecord', label: 'Driving Record', type: 'select', required: true, options: ['Clean', '1 ticket', '1 accident', 'Multiple'] },
    { id: 'current_carrier_ai', key: 'currentCarrier', label: 'Current Carrier', type: 'select', required: false, options: ['State Farm', 'GEICO', 'Progressive', 'Allstate', 'None'] },
], 'Auto Insurance Details');

// ═══════════════════════════════════════════
//  LEGAL
// ═══════════════════════════════════════════
const LEGAL_COMMON: FormField[] = [
    { id: 'urgency_l', key: 'urgency', label: 'Urgency', type: 'select', required: true, options: ['Emergency', 'This week', '1-2 weeks', 'Flexible'] },
    { id: 'consult_type', key: 'consultationType', label: 'Consultation Type', type: 'select', required: true, options: ['In-person', 'Virtual', 'Phone', 'No preference'] },
];

const legalPI: FormConfig = makeConfig([
    ...LEGAL_COMMON,
    { id: 'injury_type', key: 'injuryType', label: 'Type of Injury', type: 'select', required: true, options: ['Auto Accident', 'Slip & Fall', 'Medical Malpractice', 'Workplace Injury', 'Product Liability', 'Other'] },
    { id: 'injury_severity', key: 'injurySeverity', label: 'Injury Severity', type: 'select', required: true, options: ['Minor', 'Moderate', 'Severe', 'Catastrophic/Permanent'] },
    { id: 'case_value', key: 'estimatedCaseValue', label: 'Estimated Case Value', type: 'select', required: false, options: ['Under $50K', '$50K-$250K', '$250K-$1M', '$1M+', 'Unknown'] },
    { id: 'has_attorney', key: 'hasAttorney', label: 'Currently Have Attorney?', type: 'boolean', required: true },
    { id: 'incident_date', key: 'incidentDate', label: 'Incident Date', type: 'text', required: true, placeholder: 'MM/DD/YYYY' },
], 'Personal Injury Details');

const legalFamily: FormConfig = makeConfig([
    ...LEGAL_COMMON,
    { id: 'family_case', key: 'caseType', label: 'Case Type', type: 'select', required: true, options: ['Divorce', 'Child Custody', 'Child Support', 'Adoption', 'Prenuptial', 'Other'] },
    { id: 'children_involved', key: 'childrenInvolved', label: 'Children Involved?', type: 'boolean', required: true },
    { id: 'contested', key: 'contested', label: 'Contested or Uncontested?', type: 'select', required: true, options: ['Contested', 'Uncontested', 'Not Sure'] },
    { id: 'assets_divide', key: 'significantAssets', label: 'Significant Assets to Divide?', type: 'boolean', required: false },
], 'Family Law Details');

const legalImmigration: FormConfig = makeConfig([
    ...LEGAL_COMMON,
    { id: 'visa_type', key: 'visaType', label: 'Visa/Service Type', type: 'select', required: true, options: ['Work Visa (H-1B)', 'Family Sponsorship', 'Green Card', 'Asylum', 'Citizenship', 'DACA', 'Other'] },
    { id: 'current_status', key: 'currentStatus', label: 'Current Immigration Status', type: 'select', required: true, options: ['US Citizen', 'Permanent Resident', 'Visa Holder', 'Undocumented', 'Other'] },
    { id: 'filing_deadline', key: 'hasDeadline', label: 'Approaching Filing Deadline?', type: 'boolean', required: true },
], 'Immigration Details');

const legalCriminal: FormConfig = makeConfig([
    ...LEGAL_COMMON,
    { id: 'charge_type', key: 'chargeType', label: 'Type of Charge', type: 'select', required: true, options: ['Misdemeanor', 'Felony', 'DUI/DWI', 'Drug Offense', 'White Collar', 'Other'] },
    { id: 'arraigned', key: 'arraigned', label: 'Already Arraigned?', type: 'boolean', required: true },
    { id: 'bail_status', key: 'bailStatus', label: 'Bail Status', type: 'select', required: false, options: ['Released on Bail', 'Detained', 'Not Yet Arrested', 'OR Release'] },
    { id: 'prior_convictions', key: 'priorConvictions', label: 'Prior Convictions?', type: 'boolean', required: true },
], 'Criminal Defense Details');

// ═══════════════════════════════════════════
//  FINANCIAL SERVICES
// ═══════════════════════════════════════════
const FS_COMMON: FormField[] = [
    { id: 'timeline_fs', key: 'timeline', label: 'Timeline', type: 'select', required: true, options: ['Immediately', '1-3 months', '6+ months', 'Long-term planning'] },
    { id: 'current_advisor', key: 'currentAdvisor', label: 'Have a Current Advisor?', type: 'select', required: false, options: ['Yes', 'No', 'Looking to switch'] },
];

const fsDebt: FormConfig = makeConfig([
    ...FS_COMMON,
    { id: 'debt_amount', key: 'totalDebt', label: 'Total Debt Amount', type: 'select', required: true, options: ['Under $10K', '$10K-$25K', '$25K-$50K', '$50K-$100K', '$100K+'] },
    { id: 'debt_type', key: 'debtType', label: 'Primary Debt Type', type: 'select', required: true, options: ['Credit Card', 'Medical', 'Student Loan', 'Personal Loan', 'Mixed'] },
    { id: 'monthly_income', key: 'monthlyIncome', label: 'Monthly Income', type: 'select', required: true, options: ['Under $3K', '$3K-$5K', '$5K-$8K', '$8K+'] },
    { id: 'behind_payments', key: 'behindOnPayments', label: 'Behind on Payments?', type: 'boolean', required: true },
], 'Debt Consolidation Details');

const fsBanking: FormConfig = makeConfig([
    ...FS_COMMON,
    { id: 'account_type_fb', key: 'accountType', label: 'Account Type', type: 'select', required: true, options: ['Checking', 'Savings', 'Money Market', 'CD', 'Business Account'] },
    { id: 'initial_deposit', key: 'initialDeposit', label: 'Initial Deposit', type: 'select', required: false, options: ['Under $1K', '$1K-$10K', '$10K-$50K', '$50K+'] },
    { id: 'features_fb', key: 'importantFeatures', label: 'Important Features', type: 'select', required: true, options: ['No Fees', 'High APY', 'ATM Network', 'Mobile Banking', 'Branch Access'] },
], 'Banking Details');

const fsCredit: FormConfig = makeConfig([
    ...FS_COMMON,
    { id: 'current_score', key: 'currentScore', label: 'Current Credit Score', type: 'select', required: true, options: ['Below 500', '500-579', '580-669', '670-739', '740+', 'Unknown'] },
    { id: 'negative_items', key: 'negativeItems', label: 'Negative Items', type: 'select', required: true, options: ['Late Payments', 'Collections', 'Bankruptcy', 'Charge-offs', 'Multiple Issues'] },
    { id: 'credit_goal', key: 'goal', label: 'Goal', type: 'select', required: true, options: ['Buy a Home', 'Get a Loan', 'Lower Interest Rates', 'General Improvement'] },
], 'Credit Repair Details');

const fsTax: FormConfig = makeConfig([
    ...FS_COMMON,
    { id: 'tax_type', key: 'taxType', label: 'Tax Type', type: 'select', required: true, options: ['Personal', 'Business', 'Both', 'Non-Profit'] },
    { id: 'filing_status', key: 'filingStatus', label: 'Filing Status', type: 'select', required: true, options: ['Single', 'Married Filing Jointly', 'Married Filing Separately', 'Head of Household'] },
    { id: 'complexity', key: 'complexity', label: 'Complexity Level', type: 'select', required: true, options: ['Simple (W-2 only)', 'Moderate (investments)', 'Complex (self-employed)', 'Very Complex (multi-state/entity)'] },
    { id: 'back_taxes', key: 'hasBackTaxes', label: 'Owe Back Taxes?', type: 'boolean', required: false },
], 'Tax Preparation Details');

// ═══════════════════════════════════════════
//  ROOT-LEVEL FALLBACK CONFIGS (simpler)
// ═══════════════════════════════════════════
function rootConfig(label: string, fields: FormField[]): FormConfig {
    return makeConfig(fields, label);
}

const solarRoot = rootConfig('Solar Details', SOLAR_COMMON);
const mortgageRoot = rootConfig('Mortgage Details', MORTGAGE_COMMON);
const roofingRoot = rootConfig('Roofing Details', ROOFING_COMMON);
const insuranceRoot = rootConfig('Insurance Details', [
    { id: 'ins_type', key: 'insuranceType', label: 'Insurance Type', type: 'select', required: true, options: ['Auto', 'Home', 'Life', 'Health', 'Other'] },
    ...HS_COMMON.map(f => ({ ...f, id: `ins_${f.id}` })),
]);
const homeServicesRoot = rootConfig('Home Service Details', [
    ...HS_COMMON,
    { id: 'hs_service_type', key: 'serviceType', label: 'Service Type', type: 'select', required: true, options: ['Plumbing', 'Electrical', 'HVAC', 'Landscaping', 'Painting', 'Cleaning'] },
]);
const saasRoot = rootConfig('SaaS Requirements', SAAS_COMMON);
const realEstateRoot = rootConfig('Real Estate Details', RE_COMMON);
const autoRoot = rootConfig('Auto Details', [
    { id: 'auto_need', key: 'serviceNeeded', label: 'What Do You Need?', type: 'select', required: true, options: ['Buy a Vehicle', 'Insurance Quote', 'Repair/Service', 'Extended Warranty'] },
    { id: 'veh_type_root', key: 'vehicleType', label: 'Vehicle Type', type: 'select', required: true, options: ['Sedan', 'SUV', 'Truck', 'Sports Car', 'Minivan'] },
]);
const legalRoot = rootConfig('Legal Details', [
    { id: 'legal_area', key: 'legalArea', label: 'Legal Area', type: 'select', required: true, options: ['Personal Injury', 'Family Law', 'Criminal Defense', 'Immigration', 'Business', 'Estate'] },
    ...LEGAL_COMMON,
]);
const financialRoot = rootConfig('Financial Service Details', [
    { id: 'fs_type', key: 'serviceType', label: 'Service Type', type: 'select', required: true, options: ['Debt Consolidation', 'Banking', 'Credit Repair', 'Tax Prep', 'Wealth Management'] },
    ...FS_COMMON,
]);

// ═══════════════════════════════════════════
//  NEW NICHES
// ═══════════════════════════════════════════
const hsEvCharging: FormConfig = makeConfig([
    ...HS_COMMON,
    { id: 'ev_make', key: 'evMake', label: 'What EV do you drive?', type: 'select', required: true, options: ['Tesla', 'Ford', 'Chevy', 'Rivian', 'BMW', 'Hyundai', 'Other'] },
    { id: 'charger_level', key: 'chargerLevel', label: 'Charger level needed', type: 'select', required: true, options: ['Level 1 (120V)', 'Level 2 (240V)', 'Not Sure'] },
    { id: 'garage_type', key: 'garageType', label: 'Where will the charger go?', type: 'select', required: true, options: ['Attached Garage', 'Detached Garage', 'Carport', 'Driveway Only'] },
    { id: 'panel_capacity', key: 'electricalPanelCapacity', label: 'Electrical panel capacity', type: 'select', required: false, options: ['100 amp', '200 amp', 'Not sure'], helpText: 'Check your breaker box if unsure' },
], 'EV Charger Details');

const insurancePet: FormConfig = makeConfig([
    { id: 'pet_type', key: 'petType', label: 'What type of pet?', type: 'select', required: true, options: ['Dog', 'Cat', 'Other'] },
    { id: 'breed', key: 'breed', label: 'Breed', type: 'text', required: true, placeholder: 'Golden Retriever' },
    { id: 'pet_age', key: 'petAge', label: 'How old is your pet?', type: 'number', required: true, placeholder: '3' },
    { id: 'pre_existing_pet', key: 'preExistingConditions', label: 'Any pre-existing conditions?', type: 'boolean', required: true },
    { id: 'coverage_level', key: 'coverageLevel', label: 'Coverage level', type: 'select', required: true, options: ['Accidents Only', 'Accidents + Illness', 'Comprehensive', 'Wellness Add-on'] },
], 'Pet Insurance Details');

const hsSecurity: FormConfig = makeConfig([
    ...HS_COMMON,
    { id: 'security_type', key: 'securityType', label: 'What type of system?', type: 'select', required: true, options: ['DIY System', 'Professionally Monitored', 'Smart Home Integration', 'Camera Only'] },
    { id: 'home_size_s', key: 'homeSize', label: 'Home size', type: 'select', required: true, options: ['Under 1,000 sqft', '1,000-2,000 sqft', '2,000-3,000 sqft', '3,000+ sqft'] },
    { id: 'entry_points', key: 'entryPoints', label: 'Number of entry points', type: 'select', required: true, options: ['1-3', '4-6', '7-10', '10+'] },
    { id: 'monitoring', key: 'monitoringPreference', label: 'Monitoring preference', type: 'select', required: false, options: ['Self-monitored', '24/7 Professional', 'Police/Fire Dispatch', 'No preference'] },
], 'Home Security Details');

// ═══════════════════════════════════════════
//  EXPORT: slug → FormConfig map
// ═══════════════════════════════════════════

export const FORM_CONFIG_TEMPLATES: Record<string, FormConfig> = {
    // Roots
    solar: solarRoot,
    mortgage: mortgageRoot,
    roofing: roofingRoot,
    insurance: insuranceRoot,
    home_services: homeServicesRoot,
    b2b_saas: saasRoot,
    real_estate: realEstateRoot,
    auto: autoRoot,
    legal: legalRoot,
    financial_services: financialRoot,

    // Solar children
    'solar.residential': solarResidential,
    'solar.commercial': solarCommercial,
    'solar.battery_storage': solarBattery,
    'solar.community': solarCommunity,

    // Mortgage children
    'mortgage.purchase': mortgagePurchase,
    'mortgage.refinance': mortgageRefinance,
    'mortgage.heloc': mortgageHeloc,
    'mortgage.reverse': mortgageReverse,

    // Roofing children
    'roofing.repair': roofingRepair,
    'roofing.replacement': roofingReplacement,
    'roofing.inspection': roofingInspection,
    'roofing.gutter': roofingGutter,

    // Insurance children
    'insurance.auto': insuranceAuto,
    'insurance.home': insuranceHome,
    'insurance.life': insuranceLife,
    'insurance.health': insuranceHealth,
    'insurance.pet': insurancePet,

    // Home Services children
    'home_services.plumbing': hsPlumbing,
    'home_services.electrical': hsElectrical,
    'home_services.hvac': hsHvac,
    'home_services.landscaping': hsLandscaping,
    'home_services.ev_charging': hsEvCharging,
    'home_services.security': hsSecurity,

    // B2B SaaS children
    'b2b_saas.crm': saasCrm,
    'b2b_saas.analytics': saasAnalytics,
    'b2b_saas.marketing_automation': saasMarketing,
    'b2b_saas.hr_tech': saasHr,

    // Real Estate children
    'real_estate.residential': reResidential,
    'real_estate.commercial': reCommercial,
    'real_estate.rental': reRental,
    'real_estate.land': reLand,

    // Auto children
    'auto.sales': autoSales,
    'auto.warranty': autoWarranty,
    'auto.repair': autoRepair,
    'auto.insurance': autoInsurance,

    // Legal children
    'legal.personal_injury': legalPI,
    'legal.family': legalFamily,
    'legal.immigration': legalImmigration,
    'legal.criminal_defense': legalCriminal,

    // Financial Services children
    'financial_services.debt_consolidation': fsDebt,
    'financial_services.banking': fsBanking,
    'financial_services.credit_repair': fsCredit,
    'financial_services.tax_prep': fsTax,
};

