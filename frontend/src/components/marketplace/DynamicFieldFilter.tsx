import { useState, useEffect } from 'react';
import { Sliders, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';

interface VerticalField {
    id: string;
    key: string;
    label: string;
    type: string;
    options?: string[];
    placeholder?: string;
}

interface FieldFilter {
    op: string;
    value: string;
}

interface DynamicFieldFilterProps {
    vertical: string;
    filters: Record<string, FieldFilter>;
    onChange: (filters: Record<string, FieldFilter>) => void;
    disabled?: boolean;
}

export function DynamicFieldFilter({ vertical, filters, onChange, disabled }: DynamicFieldFilterProps) {
    const [fields, setFields] = useState<VerticalField[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!vertical || vertical === 'all') {
            setFields([]);
            return;
        }

        const fetchFields = async () => {
            setLoading(true);
            try {
                const { data } = await api.getVerticalFields(vertical);
                setFields(data?.fields || []);
            } catch (error) {
                console.error('Failed to load vertical fields:', error);
                setFields([]);
            } finally {
                setLoading(false);
            }
        };

        fetchFields();
    }, [vertical]);

    const activeCount = Object.keys(filters).length;

    if (!vertical || vertical === 'all' || fields.length === 0) {
        return null;
    }

    const updateFilter = (fieldKey: string, filter: FieldFilter | null) => {
        const newFilters = { ...filters };
        if (filter) {
            newFilters[fieldKey] = filter;
        } else {
            delete newFilters[fieldKey];
        }
        onChange(newFilters);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Sliders className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Vertical-Specific Filters</span>
                    {activeCount > 0 && (
                        <Badge variant="secondary" className="text-xs">
                            {activeCount} active
                        </Badge>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="text-sm text-muted-foreground">Loading fields...</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {fields.map((field) => {
                        const filter = filters[field.key];
                        const isActive = !!filter;

                        if (field.type === 'select' && field.options?.length) {
                            const selectedValues = filter?.op === 'includes'
                                ? JSON.parse(filter.value || '[]')
                                : filter?.value ? [filter.value] : [];

                            return (
                                <div
                                    key={field.key}
                                    className={`rounded-xl border p-3 transition ${isActive
                                        ? 'border-violet-500/40 bg-gradient-to-br from-violet-500/5 to-violet-600/10'
                                        : 'border-border bg-muted/20'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium">{field.label}</span>
                                        {isActive && (
                                            <button
                                                onClick={() => updateFilter(field.key, null)}
                                                className="text-muted-foreground hover:text-foreground"
                                                disabled={disabled}
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap gap-1.5">
                                        {field.options.map((option) => {
                                            const isSelected = selectedValues.includes(option);
                                            return (
                                                <button
                                                    key={option}
                                                    onClick={() => {
                                                        const newSelected = isSelected
                                                            ? selectedValues.filter((v: string) => v !== option)
                                                            : [...selectedValues, option];

                                                        if (newSelected.length === 0) {
                                                            updateFilter(field.key, null);
                                                        } else if (newSelected.length === 1) {
                                                            updateFilter(field.key, { op: '==', value: newSelected[0] });
                                                        } else {
                                                            updateFilter(field.key, {
                                                                op: 'includes',
                                                                value: JSON.stringify(newSelected),
                                                            });
                                                        }
                                                    }}
                                                    disabled={disabled}
                                                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition border ${isSelected
                                                        ? 'bg-violet-500/20 border-violet-500/50 text-violet-400'
                                                        : 'bg-muted border-border text-muted-foreground hover:bg-muted/80'
                                                        }`}
                                                >
                                                    {isSelected && '✓ '}
                                                    {option}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {isActive && selectedValues.length > 0 && (
                                        <div className="mt-2 text-xs text-muted-foreground">
                                            Matches any of {selectedValues.length} value{selectedValues.length > 1 ? 's' : ''}
                                        </div>
                                    )}
                                </div>
                            );
                        }

                        if (field.type === 'number') {
                            const op = filter?.op || '>=';
                            const value = filter?.value || '';

                            return (
                                <div
                                    key={field.key}
                                    className={`rounded-xl border p-3 transition ${isActive
                                        ? 'border-violet-500/40 bg-gradient-to-br from-violet-500/5 to-violet-600/10'
                                        : 'border-border bg-muted/20'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium">{field.label}</span>
                                        {isActive && (
                                            <button
                                                onClick={() => updateFilter(field.key, null)}
                                                className="text-muted-foreground hover:text-foreground"
                                                disabled={disabled}
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>

                                    <div className="flex gap-2">
                                        <Select
                                            value={op}
                                            onValueChange={(newOp) => {
                                                if (value) {
                                                    updateFilter(field.key, { op: newOp as any, value });
                                                }
                                            }}
                                            disabled={disabled}
                                        >
                                            <SelectTrigger className="w-20 h-8 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value=">=">≥</SelectItem>
                                                <SelectItem value="<=">≤</SelectItem>
                                                <SelectItem value="==">＝</SelectItem>
                                            </SelectContent>
                                        </Select>

                                        <Input
                                            type="number"
                                            value={value}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val) {
                                                    updateFilter(field.key, { op: op as any, value: val });
                                                } else {
                                                    updateFilter(field.key, null);
                                                }
                                            }}
                                            placeholder="Value"
                                            className="h-8 text-xs"
                                            disabled={disabled}
                                        />
                                    </div>

                                    {isActive && (
                                        <div className="mt-2 text-xs text-muted-foreground">
                                            Only leads with {field.label} {op === '>=' ? '≥' : op === '<=' ? '≤' : '='} {value}
                                        </div>
                                    )}
                                </div>
                            );
                        }

                        if (field.type === 'boolean') {
                            const value = filter?.value;
                            return (
                                <div
                                    key={field.key}
                                    className={`rounded-xl border p-3 transition ${isActive
                                        ? 'border-violet-500/40 bg-gradient-to-br from-violet-500/5 to-violet-600/10'
                                        : 'border-border bg-muted/20'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium">{field.label}</span>
                                    </div>

                                    <div className="flex gap-1">
                                        {['Any', 'Yes', 'No'].map((option) => {
                                            const optValue = option === 'Any' ? null : option === 'Yes' ? 'true' : 'false';
                                            const isSelected = value === optValue || (!value && option === 'Any');

                                            return (
                                                <button
                                                    key={option}
                                                    onClick={() => {
                                                        if (optValue) {
                                                            updateFilter(field.key, { op: '==', value: optValue });
                                                        } else {
                                                            updateFilter(field.key, null);
                                                        }
                                                    }}
                                                    disabled={disabled}
                                                    className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition border ${isSelected
                                                        ? 'bg-violet-500/20 border-violet-500/50 text-violet-400'
                                                        : 'bg-muted border-border text-muted-foreground hover:bg-muted/80'
                                                        }`}
                                                >
                                                    {option}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        }

                        return null;
                    })}
                </div>
            )}
        </div>
    );
}
