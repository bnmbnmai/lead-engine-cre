// ============================================
// Global Geo Registry — Single Source of Truth
// ============================================
// All 25 supported countries with regions, postal
// patterns, and continent grouping.

export interface RegionEntry {
    code: string;
    name: string;
}

export interface CountryConfig {
    code: string;
    name: string;
    regionLabel: string;
    regions: RegionEntry[];
    postalPattern: RegExp;
    continent: 'AMERICAS' | 'EUROPE' | 'APAC' | 'AFRICA' | 'MIDDLE_EAST';
}

// ─── Americas ───────────────────────────────

const US: CountryConfig = {
    code: 'US', name: 'United States', regionLabel: 'State', continent: 'AMERICAS',
    postalPattern: /^\d{5}(-\d{4})?$/,
    regions: [
        { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
        { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
        { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
        { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
        { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
        { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
        { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
        { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
        { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
        { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
        { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
        { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
        { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
        { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
        { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
        { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
        { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }, { code: 'DC', name: 'District of Columbia' },
    ],
};

const CA_COUNTRY: CountryConfig = {
    code: 'CA', name: 'Canada', regionLabel: 'Province', continent: 'AMERICAS',
    postalPattern: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i,
    regions: [
        { code: 'AB', name: 'Alberta' }, { code: 'BC', name: 'British Columbia' },
        { code: 'MB', name: 'Manitoba' }, { code: 'NB', name: 'New Brunswick' },
        { code: 'NL', name: 'Newfoundland' }, { code: 'NS', name: 'Nova Scotia' },
        { code: 'ON', name: 'Ontario' }, { code: 'PE', name: 'Prince Edward Island' },
        { code: 'QC', name: 'Quebec' }, { code: 'SK', name: 'Saskatchewan' },
    ],
};

const MX: CountryConfig = {
    code: 'MX', name: 'Mexico', regionLabel: 'State', continent: 'AMERICAS',
    postalPattern: /^\d{5}$/,
    regions: [
        { code: 'CDMX', name: 'Mexico City' }, { code: 'JAL', name: 'Jalisco' },
        { code: 'NLE', name: 'Nuevo León' }, { code: 'YUC', name: 'Yucatán' },
        { code: 'QRO', name: 'Querétaro' }, { code: 'PUE', name: 'Puebla' },
    ],
};

const BR: CountryConfig = {
    code: 'BR', name: 'Brazil', regionLabel: 'State', continent: 'AMERICAS',
    postalPattern: /^\d{5}-?\d{3}$/,
    regions: [
        { code: 'SP', name: 'São Paulo' }, { code: 'RJ', name: 'Rio de Janeiro' },
        { code: 'MG', name: 'Minas Gerais' }, { code: 'BA', name: 'Bahia' },
        { code: 'PR', name: 'Paraná' }, { code: 'RS', name: 'Rio Grande do Sul' },
        { code: 'PE', name: 'Pernambuco' }, { code: 'CE', name: 'Ceará' },
    ],
};

const CO: CountryConfig = {
    code: 'CO', name: 'Colombia', regionLabel: 'Department', continent: 'AMERICAS',
    postalPattern: /^\d{6}$/,
    regions: [
        { code: 'BOG', name: 'Bogotá' }, { code: 'ANT', name: 'Antioquia' },
        { code: 'VAC', name: 'Valle del Cauca' }, { code: 'ATL', name: 'Atlántico' },
        { code: 'SAN', name: 'Santander' }, { code: 'BOL', name: 'Bolívar' },
    ],
};

const AR: CountryConfig = {
    code: 'AR', name: 'Argentina', regionLabel: 'Province', continent: 'AMERICAS',
    postalPattern: /^[A-Z]\d{4}[A-Z]{3}$/i,
    regions: [
        { code: 'CABA', name: 'Buenos Aires City' }, { code: 'BUE', name: 'Buenos Aires Province' },
        { code: 'COR', name: 'Córdoba' }, { code: 'SFE', name: 'Santa Fe' },
        { code: 'MZA', name: 'Mendoza' }, { code: 'TUC', name: 'Tucumán' },
    ],
};

const CL: CountryConfig = {
    code: 'CL', name: 'Chile', regionLabel: 'Region', continent: 'AMERICAS',
    postalPattern: /^\d{7}$/,
    regions: [
        { code: 'RM', name: 'Santiago Metropolitan' }, { code: 'VAL', name: 'Valparaíso' },
        { code: 'BIO', name: 'Biobío' }, { code: 'ARA', name: 'Araucanía' },
        { code: 'MAU', name: "Maule" }, { code: 'COQ', name: 'Coquimbo' },
    ],
};

const PE: CountryConfig = {
    code: 'PE', name: 'Peru', regionLabel: 'Department', continent: 'AMERICAS',
    postalPattern: /^\d{5}$/,
    regions: [
        { code: 'LIM', name: 'Lima' }, { code: 'ARE', name: 'Arequipa' },
        { code: 'LAL', name: 'La Libertad' }, { code: 'PIU', name: 'Piura' },
        { code: 'CUS', name: 'Cusco' }, { code: 'CAL', name: 'Callao' },
    ],
};

const EC: CountryConfig = {
    code: 'EC', name: 'Ecuador', regionLabel: 'Province', continent: 'AMERICAS',
    postalPattern: /^\d{6}$/,
    regions: [
        { code: 'GYE', name: 'Guayaquil (Guayas)' }, { code: 'UIO', name: 'Quito (Pichincha)' },
        { code: 'AZU', name: 'Azuay' }, { code: 'MAN', name: 'Manabí' },
        { code: 'TUN', name: 'Tungurahua' },
    ],
};

// ─── Europe ─────────────────────────────────

const GB: CountryConfig = {
    code: 'GB', name: 'United Kingdom', regionLabel: 'Region', continent: 'EUROPE',
    postalPattern: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
    regions: [
        { code: 'ENG', name: 'England' }, { code: 'SCT', name: 'Scotland' },
        { code: 'WLS', name: 'Wales' }, { code: 'NIR', name: 'Northern Ireland' },
    ],
};

const DE: CountryConfig = {
    code: 'DE', name: 'Germany', regionLabel: 'State', continent: 'EUROPE',
    postalPattern: /^\d{5}$/,
    regions: [
        { code: 'BW', name: 'Baden-Württemberg' }, { code: 'BY', name: 'Bavaria' },
        { code: 'BE', name: 'Berlin' }, { code: 'BB', name: 'Brandenburg' },
        { code: 'HB', name: 'Bremen' }, { code: 'HH', name: 'Hamburg' },
        { code: 'HE', name: 'Hesse' }, { code: 'NI', name: 'Lower Saxony' },
        { code: 'MV', name: 'Mecklenburg-Vorpommern' }, { code: 'NW', name: 'North Rhine-Westphalia' },
        { code: 'RP', name: 'Rhineland-Palatinate' }, { code: 'SL', name: 'Saarland' },
        { code: 'SN', name: 'Saxony' }, { code: 'ST', name: 'Saxony-Anhalt' },
        { code: 'SH', name: 'Schleswig-Holstein' }, { code: 'TH', name: 'Thuringia' },
    ],
};

const FR: CountryConfig = {
    code: 'FR', name: 'France', regionLabel: 'Region', continent: 'EUROPE',
    postalPattern: /^\d{5}$/,
    regions: [
        { code: 'IDF', name: 'Île-de-France' }, { code: 'PAC', name: "Provence-Alpes-Côte d'Azur" },
        { code: 'OCC', name: 'Occitanie' }, { code: 'NAQ', name: 'Nouvelle-Aquitaine' },
        { code: 'ARA', name: 'Auvergne-Rhône-Alpes' }, { code: 'BRE', name: 'Brittany' },
        { code: 'NOR', name: 'Normandy' }, { code: 'HDF', name: 'Hauts-de-France' },
        { code: 'GES', name: 'Grand Est' }, { code: 'PDL', name: 'Pays de la Loire' },
    ],
};

// ─── APAC ───────────────────────────────────

const AU: CountryConfig = {
    code: 'AU', name: 'Australia', regionLabel: 'State', continent: 'APAC',
    postalPattern: /^\d{4}$/,
    regions: [
        { code: 'NSW', name: 'New South Wales' }, { code: 'VIC', name: 'Victoria' },
        { code: 'QLD', name: 'Queensland' }, { code: 'WA', name: 'Western Australia' },
        { code: 'SA', name: 'South Australia' }, { code: 'TAS', name: 'Tasmania' },
        { code: 'ACT', name: 'Australian Capital Territory' }, { code: 'NT', name: 'Northern Territory' },
    ],
};

const IN_COUNTRY: CountryConfig = {
    code: 'IN', name: 'India', regionLabel: 'State', continent: 'APAC',
    postalPattern: /^\d{6}$/,
    regions: [
        { code: 'MH', name: 'Maharashtra' }, { code: 'KA', name: 'Karnataka' },
        { code: 'TN', name: 'Tamil Nadu' }, { code: 'DL', name: 'Delhi' },
        { code: 'GJ', name: 'Gujarat' }, { code: 'UP', name: 'Uttar Pradesh' },
        { code: 'WB', name: 'West Bengal' }, { code: 'RJ', name: 'Rajasthan' },
        { code: 'TG', name: 'Telangana' }, { code: 'KL', name: 'Kerala' },
    ],
};

const JP: CountryConfig = {
    code: 'JP', name: 'Japan', regionLabel: 'Prefecture', continent: 'APAC',
    postalPattern: /^\d{3}-?\d{4}$/,
    regions: [
        { code: 'TYO', name: 'Tokyo' }, { code: 'OSK', name: 'Osaka' },
        { code: 'AIC', name: 'Aichi' }, { code: 'FKO', name: 'Fukuoka' },
        { code: 'HKD', name: 'Hokkaido' }, { code: 'KYT', name: 'Kyoto' },
    ],
};

const KR: CountryConfig = {
    code: 'KR', name: 'South Korea', regionLabel: 'Province', continent: 'APAC',
    postalPattern: /^\d{5}$/,
    regions: [
        { code: 'SEL', name: 'Seoul' }, { code: 'BSN', name: 'Busan' },
        { code: 'ICN', name: 'Incheon' }, { code: 'DGU', name: 'Daegu' },
        { code: 'GGI', name: 'Gyeonggi' },
    ],
};

const SG: CountryConfig = {
    code: 'SG', name: 'Singapore', regionLabel: 'District', continent: 'APAC',
    postalPattern: /^\d{6}$/,
    regions: [
        { code: 'CTR', name: 'Central' }, { code: 'NE', name: 'North-East' },
        { code: 'NW', name: 'North-West' }, { code: 'SE', name: 'South-East' },
    ],
};

// ─── Middle East ────────────────────────────

const AE: CountryConfig = {
    code: 'AE', name: 'UAE', regionLabel: 'Emirate', continent: 'MIDDLE_EAST',
    postalPattern: /^.{0,10}$/, // UAE postal codes are optional
    regions: [
        { code: 'DXB', name: 'Dubai' }, { code: 'AUH', name: 'Abu Dhabi' },
        { code: 'SHJ', name: 'Sharjah' }, { code: 'AJM', name: 'Ajman' },
    ],
};

// ─── Africa ─────────────────────────────────

const ZA: CountryConfig = {
    code: 'ZA', name: 'South Africa', regionLabel: 'Province', continent: 'AFRICA',
    postalPattern: /^\d{4}$/,
    regions: [
        { code: 'GP', name: 'Gauteng' }, { code: 'WC', name: 'Western Cape' },
        { code: 'KZN', name: 'KwaZulu-Natal' }, { code: 'EC', name: 'Eastern Cape' },
        { code: 'LP', name: 'Limpopo' }, { code: 'MP', name: 'Mpumalanga' },
    ],
};

const NG: CountryConfig = {
    code: 'NG', name: 'Nigeria', regionLabel: 'State', continent: 'AFRICA',
    postalPattern: /^\d{6}$/,
    regions: [
        { code: 'LA', name: 'Lagos' }, { code: 'ABJ', name: 'Abuja' },
        { code: 'KN', name: 'Kano' }, { code: 'RV', name: 'Rivers' },
        { code: 'OY', name: 'Oyo' }, { code: 'EDO', name: 'Edo' },
    ],
};

const KE: CountryConfig = {
    code: 'KE', name: 'Kenya', regionLabel: 'County', continent: 'AFRICA',
    postalPattern: /^\d{5}$/,
    regions: [
        { code: 'NBO', name: 'Nairobi' }, { code: 'MBA', name: 'Mombasa' },
        { code: 'KSM', name: 'Kisumu' }, { code: 'NKR', name: 'Nakuru' },
        { code: 'ELD', name: 'Uasin Gishu' },
    ],
};

const GH: CountryConfig = {
    code: 'GH', name: 'Ghana', regionLabel: 'Region', continent: 'AFRICA',
    postalPattern: /^[A-Z]{2}-?\d{3,4}-?\d{4}$/i,
    regions: [
        { code: 'GAR', name: 'Greater Accra' }, { code: 'ASH', name: 'Ashanti' },
        { code: 'WR', name: 'Western' }, { code: 'CR', name: 'Central' },
        { code: 'ER', name: 'Eastern' },
    ],
};

const EG: CountryConfig = {
    code: 'EG', name: 'Egypt', regionLabel: 'Governorate', continent: 'AFRICA',
    postalPattern: /^\d{5}$/,
    regions: [
        { code: 'CAI', name: 'Cairo' }, { code: 'ALX', name: 'Alexandria' },
        { code: 'GIZ', name: 'Giza' }, { code: 'ASW', name: 'Aswan' },
        { code: 'LUX', name: 'Luxor' },
    ],
};

const TZ: CountryConfig = {
    code: 'TZ', name: 'Tanzania', regionLabel: 'Region', continent: 'AFRICA',
    postalPattern: /^\d{5}$/,
    regions: [
        { code: 'DSM', name: 'Dar es Salaam' }, { code: 'ARU', name: 'Arusha' },
        { code: 'MWZ', name: 'Mwanza' }, { code: 'DGM', name: 'Dodoma' },
        { code: 'ZNZ', name: 'Zanzibar' },
    ],
};

const MA: CountryConfig = {
    code: 'MA', name: 'Morocco', regionLabel: 'Region', continent: 'AFRICA',
    postalPattern: /^\d{5}$/,
    regions: [
        { code: 'CAS', name: 'Casablanca-Settat' }, { code: 'RBT', name: 'Rabat-Salé-Kénitra' },
        { code: 'TNG', name: 'Tanger-Tétouan-Al Hoceïma' }, { code: 'MRK', name: 'Marrakech-Safi' },
        { code: 'FES', name: 'Fès-Meknès' },
    ],
};

// ─── Registry ───────────────────────────────

export const SUPPORTED_COUNTRIES: CountryConfig[] = [
    // Americas
    US, CA_COUNTRY, MX, BR, CO, AR, CL, PE, EC,
    // Europe
    GB, DE, FR,
    // APAC
    AU, IN_COUNTRY, JP, KR, SG,
    // Middle East
    AE,
    // Africa
    ZA, NG, KE, GH, EG, TZ, MA,
];

// ─── Helpers ────────────────────────────────

const countryMap = new Map(SUPPORTED_COUNTRIES.map(c => [c.code, c]));

export function getCountryConfig(code: string): CountryConfig | undefined {
    return countryMap.get(code.toUpperCase());
}

export function getRegionsByCountry(code: string): RegionEntry[] {
    return getCountryConfig(code)?.regions || [];
}

export function isValidRegion(countryCode: string, regionCode: string): boolean {
    const country = getCountryConfig(countryCode);
    if (!country) return false;
    return country.regions.some(r => r.code === regionCode);
}

export function getAllCountryCodes(): string[] {
    return SUPPORTED_COUNTRIES.map(c => c.code);
}

export function getCountriesByContinent(continent: CountryConfig['continent']): CountryConfig[] {
    return SUPPORTED_COUNTRIES.filter(c => c.continent === continent);
}

export function isValidPostalCode(countryCode: string, postalCode: string): boolean {
    const country = getCountryConfig(countryCode);
    if (!country) return true; // unknown country — don't block
    return country.postalPattern.test(postalCode);
}

// ─── US Zip-Prefix → State Mapping ─────────
// Maps 3-digit zip prefixes to their state code.
// Source: USPS Publication 65 (prefix ranges)

const US_ZIP_PREFIX_TO_STATE: Record<string, string> = {};

function registerRange(start: number, end: number, state: string) {
    for (let i = start; i <= end; i++) {
        US_ZIP_PREFIX_TO_STATE[String(i).padStart(3, '0')] = state;
    }
}

// Northeast
registerRange(5, 5, 'NY'); // specific NY prefix
registerRange(6, 9, 'PR'); // Puerto Rico / VI
registerRange(10, 14, 'NY');
registerRange(15, 19, 'PA');
registerRange(20, 20, 'DC');
registerRange(21, 21, 'MD');
registerRange(22, 24, 'VA');
registerRange(25, 26, 'WV');
registerRange(27, 28, 'NC');
registerRange(29, 29, 'SC');
registerRange(30, 31, 'GA');
registerRange(32, 34, 'FL');
registerRange(35, 36, 'AL');
registerRange(37, 38, 'TN');
registerRange(39, 39, 'MS');
registerRange(40, 42, 'KY');
registerRange(43, 45, 'OH');
registerRange(46, 47, 'IN');
registerRange(48, 49, 'MI');
registerRange(50, 52, 'IA');
registerRange(53, 54, 'WI');
registerRange(55, 56, 'MN');
registerRange(57, 57, 'SD');
registerRange(58, 58, 'ND');
registerRange(59, 59, 'MT');
registerRange(60, 62, 'IL');
registerRange(63, 65, 'MO');
registerRange(66, 67, 'KS');
registerRange(68, 69, 'NE');
registerRange(70, 71, 'LA');
registerRange(72, 72, 'AR');
registerRange(73, 74, 'OK');
registerRange(75, 79, 'TX');
registerRange(80, 81, 'CO');
registerRange(82, 83, 'WY');
registerRange(83, 83, 'ID'); // 833-839 are ID; 830-832 WY — simplified to ID since 834+ dominates
registerRange(84, 84, 'UT');
registerRange(85, 86, 'AZ');
registerRange(87, 88, 'NM');
registerRange(89, 89, 'NV');
registerRange(90, 96, 'CA');
registerRange(97, 97, 'OR');
registerRange(98, 99, 'WA');
// New England
registerRange(1, 2, 'MA');
registerRange(3, 3, 'NH');
registerRange(4, 4, 'ME');
registerRange(5, 5, 'VT'); // 050-059 VT (overwrites NY above — VT is correct for 05x)
// AK/HI
registerRange(995, 999, 'AK');
registerRange(967, 968, 'HI');
// DE, NJ, CT
US_ZIP_PREFIX_TO_STATE['197'] = 'DE'; US_ZIP_PREFIX_TO_STATE['198'] = 'DE'; US_ZIP_PREFIX_TO_STATE['199'] = 'DE';
registerRange(7, 8, 'NJ');
registerRange(6, 6, 'CT');
// RI
US_ZIP_PREFIX_TO_STATE['028'] = 'RI'; US_ZIP_PREFIX_TO_STATE['029'] = 'RI';

// Overrides for shared prefixes — more precise
// WY = 820-831, ID = 832-838
for (let i = 820; i <= 831; i++) US_ZIP_PREFIX_TO_STATE[String(i)] = 'WY';
for (let i = 832; i <= 838; i++) US_ZIP_PREFIX_TO_STATE[String(i)] = 'ID';

/**
 * Get the expected US state for a given 5-digit zip code.
 * Returns undefined for non-US or unrecognised prefixes.
 */
export function getStateForZip(zip: string): string | undefined {
    const digits = zip.replace(/[^0-9]/g, '');
    if (digits.length < 3) return undefined;
    const prefix = digits.substring(0, 3);
    return US_ZIP_PREFIX_TO_STATE[prefix];
}
