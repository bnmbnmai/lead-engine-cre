import { useState } from 'react';
import { MapPin, X, Check, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ============================================
// Global Region Data
// ============================================

interface RegionEntry {
    code: string;
    name: string;
}

interface CountryConfig {
    code: string;
    name: string;
    regionLabel: string;         // "State", "Province", "Region", etc.
    regions: RegionEntry[];
}

export const COUNTRY_DATA: CountryConfig[] = [
    {
        code: 'US', name: 'United States', regionLabel: 'State',
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
            { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
        ],
    },
    {
        code: 'CA', name: 'Canada', regionLabel: 'Province',
        regions: [
            { code: 'AB', name: 'Alberta' }, { code: 'BC', name: 'British Columbia' },
            { code: 'MB', name: 'Manitoba' }, { code: 'NB', name: 'New Brunswick' },
            { code: 'NL', name: 'Newfoundland' }, { code: 'NS', name: 'Nova Scotia' },
            { code: 'ON', name: 'Ontario' }, { code: 'PE', name: 'Prince Edward Island' },
            { code: 'QC', name: 'Quebec' }, { code: 'SK', name: 'Saskatchewan' },
        ],
    },
    {
        code: 'GB', name: 'United Kingdom', regionLabel: 'Region',
        regions: [
            { code: 'ENG', name: 'England' }, { code: 'SCT', name: 'Scotland' },
            { code: 'WLS', name: 'Wales' }, { code: 'NIR', name: 'Northern Ireland' },
        ],
    },
    {
        code: 'AU', name: 'Australia', regionLabel: 'State',
        regions: [
            { code: 'NSW', name: 'New South Wales' }, { code: 'VIC', name: 'Victoria' },
            { code: 'QLD', name: 'Queensland' }, { code: 'WA', name: 'Western Australia' },
            { code: 'SA', name: 'South Australia' }, { code: 'TAS', name: 'Tasmania' },
            { code: 'ACT', name: 'Australian Capital Territory' }, { code: 'NT', name: 'Northern Territory' },
        ],
    },
    {
        code: 'DE', name: 'Germany', regionLabel: 'State',
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
    },
    {
        code: 'FR', name: 'France', regionLabel: 'Region',
        regions: [
            { code: 'IDF', name: 'Île-de-France' }, { code: 'PAC', name: 'Provence-Alpes-Côte d\'Azur' },
            { code: 'OCC', name: 'Occitanie' }, { code: 'NAQ', name: 'Nouvelle-Aquitaine' },
            { code: 'ARA', name: 'Auvergne-Rhône-Alpes' }, { code: 'BRE', name: 'Brittany' },
            { code: 'NOR', name: 'Normandy' }, { code: 'HDF', name: 'Hauts-de-France' },
            { code: 'GES', name: 'Grand Est' }, { code: 'PDL', name: 'Pays de la Loire' },
        ],
    },
    {
        code: 'BR', name: 'Brazil', regionLabel: 'State',
        regions: [
            { code: 'SP', name: 'São Paulo' }, { code: 'RJ', name: 'Rio de Janeiro' },
            { code: 'MG', name: 'Minas Gerais' }, { code: 'BA', name: 'Bahia' },
            { code: 'PR', name: 'Paraná' }, { code: 'RS', name: 'Rio Grande do Sul' },
            { code: 'PE', name: 'Pernambuco' }, { code: 'CE', name: 'Ceará' },
        ],
    },
    {
        code: 'IN', name: 'India', regionLabel: 'State',
        regions: [
            { code: 'MH', name: 'Maharashtra' }, { code: 'KA', name: 'Karnataka' },
            { code: 'TN', name: 'Tamil Nadu' }, { code: 'DL', name: 'Delhi' },
            { code: 'GJ', name: 'Gujarat' }, { code: 'UP', name: 'Uttar Pradesh' },
            { code: 'WB', name: 'West Bengal' }, { code: 'RJ', name: 'Rajasthan' },
            { code: 'TG', name: 'Telangana' }, { code: 'KL', name: 'Kerala' },
        ],
    },
    {
        code: 'MX', name: 'Mexico', regionLabel: 'State',
        regions: [
            { code: 'CDMX', name: 'Mexico City' }, { code: 'JAL', name: 'Jalisco' },
            { code: 'NLE', name: 'Nuevo León' }, { code: 'YUC', name: 'Yucatán' },
            { code: 'QRO', name: 'Querétaro' }, { code: 'PUE', name: 'Puebla' },
        ],
    },
    {
        code: 'JP', name: 'Japan', regionLabel: 'Prefecture',
        regions: [
            { code: 'TYO', name: 'Tokyo' }, { code: 'OSK', name: 'Osaka' },
            { code: 'AIC', name: 'Aichi' }, { code: 'FKO', name: 'Fukuoka' },
            { code: 'HKD', name: 'Hokkaido' }, { code: 'KYT', name: 'Kyoto' },
        ],
    },
    {
        code: 'KR', name: 'South Korea', regionLabel: 'Province',
        regions: [
            { code: 'SEL', name: 'Seoul' }, { code: 'BSN', name: 'Busan' },
            { code: 'ICN', name: 'Incheon' }, { code: 'DGU', name: 'Daegu' },
            { code: 'GGI', name: 'Gyeonggi' },
        ],
    },
    {
        code: 'SG', name: 'Singapore', regionLabel: 'District',
        regions: [
            { code: 'CTR', name: 'Central' }, { code: 'NE', name: 'North-East' },
            { code: 'NW', name: 'North-West' }, { code: 'SE', name: 'South-East' },
        ],
    },
    {
        code: 'AE', name: 'UAE', regionLabel: 'Emirate',
        regions: [
            { code: 'DXB', name: 'Dubai' }, { code: 'AUH', name: 'Abu Dhabi' },
            { code: 'SHJ', name: 'Sharjah' }, { code: 'AJM', name: 'Ajman' },
        ],
    },
    {
        code: 'ZA', name: 'South Africa', regionLabel: 'Province',
        regions: [
            { code: 'GP', name: 'Gauteng' }, { code: 'WC', name: 'Western Cape' },
            { code: 'KZN', name: 'KwaZulu-Natal' }, { code: 'EC', name: 'Eastern Cape' },
        ],
    },
    {
        code: 'NG', name: 'Nigeria', regionLabel: 'State',
        regions: [
            { code: 'LA', name: 'Lagos' }, { code: 'ABJ', name: 'Abuja' },
            { code: 'KN', name: 'Kano' }, { code: 'RV', name: 'Rivers' },
        ],
    },
];

// Helper to look up countries
export function getCountryConfig(code: string): CountryConfig | undefined {
    return COUNTRY_DATA.find((c) => c.code === code);
}

// ============================================
// GeoFilter Component
// ============================================

interface GeoFilterProps {
    country: string;
    onCountryChange: (country: string) => void;
    selectedRegions: string[];
    onRegionsChange: (regions: string[]) => void;
    mode?: 'include' | 'exclude';
    showCountrySelector?: boolean;
}

export function GeoFilter({
    country,
    onCountryChange,
    selectedRegions,
    onRegionsChange,
    mode = 'include',
    showCountrySelector = true,
}: GeoFilterProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');

    const countryConfig = getCountryConfig(country);
    const regions = countryConfig?.regions || [];
    const regionLabel = countryConfig?.regionLabel || 'Region';

    const filteredRegions = regions.filter(
        (r) => r.name.toLowerCase().includes(search.toLowerCase()) || r.code.toLowerCase().includes(search.toLowerCase())
    );

    const toggleRegion = (code: string) => {
        if (selectedRegions.includes(code)) {
            onRegionsChange(selectedRegions.filter((s) => s !== code));
        } else {
            onRegionsChange([...selectedRegions, code]);
        }
    };

    const selectAll = () => onRegionsChange(regions.map((r) => r.code));
    const clearAll = () => onRegionsChange([]);

    return (
        <div className="space-y-3">
            {/* Country Selector */}
            {showCountrySelector && (
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Country</label>
                    <div className="flex flex-wrap gap-2">
                        {COUNTRY_DATA.map((c) => (
                            <button
                                key={c.code}
                                type="button"
                                onClick={() => {
                                    onCountryChange(c.code);
                                    onRegionsChange([]); // Reset regions on country change
                                }}
                                className={cn(
                                    'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border',
                                    country === c.code
                                        ? 'bg-primary text-primary-foreground border-primary'
                                        : 'bg-muted/50 text-muted-foreground border-border hover:border-primary/50'
                                )}
                                title={c.name}
                            >
                                {c.code}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Selected Regions */}
            <div className="flex flex-wrap gap-2">
                {selectedRegions.length === 0 ? (
                    <span className="text-sm text-muted-foreground">
                        {mode === 'include'
                            ? `All ${regionLabel.toLowerCase()}s (no filter)`
                            : 'No exclusions'}
                    </span>
                ) : (
                    selectedRegions.map((code) => {
                        const regionName = regions.find((r) => r.code === code)?.name || code;
                        return (
                            <span
                                key={code}
                                className={cn(
                                    'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm',
                                    mode === 'include' ? 'bg-primary/20 text-primary' : 'bg-red-500/20 text-red-500'
                                )}
                                title={regionName}
                            >
                                {code}
                                <button
                                    onClick={() => toggleRegion(code)}
                                    className="hover:opacity-70 transition"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        );
                    })
                )}
            </div>

            {/* Toggle Button */}
            {regions.length > 0 && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsOpen(!isOpen)}
                    className="gap-2"
                >
                    <MapPin className="h-4 w-4" />
                    {mode === 'include' ? `Select ${regionLabel}s` : `Exclude ${regionLabel}s`}
                </Button>
            )}

            {/* Region Picker Modal */}
            {isOpen && (
                <>
                    <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setIsOpen(false)} />
                    <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-2xl mx-auto glass rounded-2xl p-6 z-50 max-h-[80vh] overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-semibold">
                                    {mode === 'include'
                                        ? `Select ${regionLabel}s to Include`
                                        : `Select ${regionLabel}s to Exclude`}
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    <Globe className="h-3 w-3 inline mr-1" />
                                    {countryConfig?.name || country}
                                </p>
                            </div>
                            <button onClick={() => setIsOpen(false)}>
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Search */}
                        <input
                            type="text"
                            placeholder={`Search ${regionLabel.toLowerCase()}s...`}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full px-4 py-2 rounded-xl bg-background border border-input mb-4"
                        />

                        {/* Quick Actions */}
                        <div className="flex gap-2 mb-4">
                            <Button type="button" variant="outline" size="sm" onClick={selectAll}>
                                Select All
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={clearAll}>
                                Clear All
                            </Button>
                        </div>

                        {/* Region Grid */}
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 overflow-y-auto flex-1">
                            {filteredRegions.map((region) => {
                                const isSelected = selectedRegions.includes(region.code);
                                return (
                                    <button
                                        key={region.code}
                                        type="button"
                                        onClick={() => toggleRegion(region.code)}
                                        className={cn(
                                            'px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1',
                                            isSelected
                                                ? mode === 'include'
                                                    ? 'bg-primary text-primary-foreground'
                                                    : 'bg-red-500 text-white'
                                                : 'bg-white/5 hover:bg-white/10'
                                        )}
                                        title={region.name}
                                    >
                                        {region.code}
                                        {isSelected && <Check className="h-3 w-3" />}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Done Button */}
                        <div className="mt-4 pt-4 border-t border-border">
                            <Button onClick={() => setIsOpen(false)} className="w-full">
                                Done ({selectedRegions.length} selected)
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

export default GeoFilter;
