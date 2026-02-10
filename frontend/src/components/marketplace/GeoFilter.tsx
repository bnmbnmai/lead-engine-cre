import { useState } from 'react';
import { MapPin, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const US_STATES = [
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
];

interface GeoFilterProps {
    selected: string[];
    onChange: (states: string[]) => void;
    mode?: 'include' | 'exclude';
}

export function GeoFilter({ selected, onChange, mode = 'include' }: GeoFilterProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');

    const filteredStates = US_STATES.filter(
        (s) => s.name.toLowerCase().includes(search.toLowerCase()) || s.code.toLowerCase().includes(search.toLowerCase())
    );

    const toggleState = (code: string) => {
        if (selected.includes(code)) {
            onChange(selected.filter((s) => s !== code));
        } else {
            onChange([...selected, code]);
        }
    };

    const selectAll = () => onChange(US_STATES.map((s) => s.code));
    const clearAll = () => onChange([]);

    return (
        <div className="space-y-3">
            {/* Selected States */}
            <div className="flex flex-wrap gap-2">
                {selected.length === 0 ? (
                    <span className="text-sm text-muted-foreground">
                        {mode === 'include' ? 'All states (no filter)' : 'No exclusions'}
                    </span>
                ) : (
                    selected.map((code) => (
                        <span
                            key={code}
                            className={cn(
                                'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm',
                                mode === 'include' ? 'bg-primary/20 text-primary' : 'bg-red-500/20 text-red-500'
                            )}
                        >
                            {code}
                            <button
                                onClick={() => toggleState(code)}
                                className="hover:opacity-70 transition"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))
                )}
            </div>

            {/* Toggle Button */}
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(!isOpen)}
                className="gap-2"
            >
                <MapPin className="h-4 w-4" />
                {mode === 'include' ? 'Select States' : 'Exclude States'}
            </Button>

            {/* State Picker Modal */}
            {isOpen && (
                <>
                    <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setIsOpen(false)} />
                    <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-2xl mx-auto glass rounded-2xl p-6 z-50 max-h-[80vh] overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold">
                                {mode === 'include' ? 'Select States to Include' : 'Select States to Exclude'}
                            </h3>
                            <button onClick={() => setIsOpen(false)}>
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Search */}
                        <input
                            type="text"
                            placeholder="Search states..."
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

                        {/* State Grid */}
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 overflow-y-auto flex-1">
                            {filteredStates.map((state) => {
                                const isSelected = selected.includes(state.code);
                                return (
                                    <button
                                        key={state.code}
                                        type="button"
                                        onClick={() => toggleState(state.code)}
                                        className={cn(
                                            'px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1',
                                            isSelected
                                                ? mode === 'include'
                                                    ? 'bg-primary text-primary-foreground'
                                                    : 'bg-red-500 text-white'
                                                : 'bg-white/5 hover:bg-white/10'
                                        )}
                                        title={state.name}
                                    >
                                        {state.code}
                                        {isSelected && <Check className="h-3 w-3" />}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Done Button */}
                        <div className="mt-4 pt-4 border-t border-border">
                            <Button onClick={() => setIsOpen(false)} className="w-full">
                                Done ({selected.length} selected)
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

export default GeoFilter;
