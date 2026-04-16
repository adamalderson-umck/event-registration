import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { fieldTypeOptions, needsOptions } from '../config/fieldTemplates';
import Button from './ui/Button';
import Input from './ui/Input';
import Label from './ui/Label';
import Select from './ui/Select';
import Checkbox from './ui/Checkbox';

export default function FieldConfigPanel({ field, onUpdate, onClose, allFields = [] }) {
    const [config, setConfig] = useState(field);
    const [newOption, setNewOption] = useState('');

    useEffect(() => {
        setConfig(field);
    }, [field]);

    const isSectionBreak = config.type === 'sectionBreak';

    const handleChange = (key, value) => {
        const updated = { ...config, [key]: value };
        setConfig(updated);
        onUpdate(updated);
    };

    const addOption = () => {
        if (!newOption.trim()) return;
        const options = [...(config.options || []), newOption.trim()];
        handleChange('options', options);
        setNewOption('');
    };

    const removeOption = (index) => {
        const options = (config.options || []).filter((_, i) => i !== index);
        handleChange('options', options);
    };

    // --- Condition helpers ---
    const fieldIndex = allFields.findIndex((f) => f.id === config.id);
    const precedingFields = allFields
        .slice(0, fieldIndex)
        .filter((f) => f.type !== 'sectionBreak');

    const sourceField = allFields.find((f) => f.id === config.condition?.field);
    const sourceFieldHasOptions = sourceField && needsOptions(sourceField.type);
    const sourceFieldOptions = sourceFieldHasOptions
        ? (sourceField.options || []).map((opt) =>
            typeof opt === 'string' ? { value: opt, label: opt } : opt
        )
        : [];

    return (
        <div className="border-l border-slate-200 bg-slate-50 p-5 w-80 shrink-0 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
                    {isSectionBreak ? 'Section Settings' : 'Field Settings'}
                </h3>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="space-y-4">
                {/* Label */}
                <div>
                    <Label htmlFor="field-label">{isSectionBreak ? 'Section Title' : 'Label'}</Label>
                    <Input
                        id="field-label"
                        value={config.label || ''}
                        onChange={(e) => handleChange('label', e.target.value)}
                    />
                </div>

                {/* Type — hidden for section breaks */}
                {!isSectionBreak && !config.system && (
                    <div>
                        <Label htmlFor="field-type">Type</Label>
                        <Select
                            id="field-type"
                            value={config.type}
                            onChange={(e) => handleChange('type', e.target.value)}
                            options={fieldTypeOptions.filter((t) => t.value !== 'sectionBreak')}
                        />
                    </div>
                )}
                {!isSectionBreak && config.system && (
                    <div>
                        <Label htmlFor="field-type">Type (Locked)</Label>
                        <Input
                            id="field-type"
                            value={fieldTypeOptions.find(t => t.value === config.type)?.label || config.type}
                            disabled
                            className="bg-slate-100 text-slate-500 cursor-not-allowed"
                        />
                    </div>
                )}

                {/* Placeholder (for applicable types) */}
                {!isSectionBreak && ['text', 'email', 'phone', 'number', 'textarea'].includes(config.type) && (
                    <div>
                        <Label htmlFor="field-placeholder">Placeholder</Label>
                        <Input
                            id="field-placeholder"
                            value={config.placeholder || ''}
                            onChange={(e) => handleChange('placeholder', e.target.value)}
                        />
                    </div>
                )}

                {/* Required — hidden for section breaks */}
                {!isSectionBreak && !config.system && (
                    <Checkbox
                        label="Required field"
                        checked={!!config.required}
                        onChange={(e) => handleChange('required', e.target.checked)}
                    />
                )}
                {!isSectionBreak && config.system && (
                    <div className="flex items-center gap-2">
                        <input type="checkbox" checked disabled className="w-4 h-4 text-slate-300 rounded border-slate-200 cursor-not-allowed" />
                        <span className="text-sm font-medium text-slate-400 cursor-not-allowed">Required field (System)</span>
                    </div>
                )}

                {/* Options (for select, checkboxGroup, radio) */}
                {!isSectionBreak && needsOptions(config.type) && (
                    <div>
                        <Label>Options</Label>
                        <div className="space-y-2 mb-2">
                            {(config.options || []).map((opt, index) => (
                                <div key={index} className="flex items-center gap-2">
                                    <Input
                                        value={typeof opt === 'string' ? opt : opt.value}
                                        onChange={(e) => {
                                            const options = [...(config.options || [])];
                                            options[index] = e.target.value;
                                            handleChange('options', options);
                                        }}
                                        className="flex-1"
                                    />
                                    <button
                                        onClick={() => removeOption(index)}
                                        className="text-slate-400 hover:text-danger shrink-0 cursor-pointer"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <Input
                                value={newOption}
                                onChange={(e) => setNewOption(e.target.value)}
                                placeholder="New option..."
                                className="flex-1"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        addOption();
                                    }
                                }}
                            />
                            <Button variant="secondary" size="sm" onClick={addOption} type="button">
                                <Plus className="w-3 h-3" />
                            </Button>
                        </div>
                    </div>
                )}

                {/* Visibility Condition — only for regular fields */}
                {!isSectionBreak && (
                    <div className="border-t border-slate-200 pt-4 mt-4">
                        <Label>Visibility</Label>
                        <div className="mt-2">
                            <Checkbox
                                label="Always visible"
                                checked={!config.condition}
                                onChange={(e) => {
                                    if (e.target.checked) {
                                        // Remove condition
                                        const { condition: _, ...rest } = config;
                                        setConfig(rest);
                                        onUpdate(rest);
                                    } else {
                                        // Add default empty condition
                                        handleChange('condition', {
                                            field: '',
                                            operator: 'equals',
                                            value: '',
                                        });
                                    }
                                }}
                            />
                        </div>

                        {config.condition && (
                            <div className="mt-3 space-y-3 bg-white border border-slate-200 rounded-lg p-3">
                                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                                    Show when…
                                </p>

                                {/* Field picker — only preceding fields */}
                                <div>
                                    <Label htmlFor="cond-field">Field</Label>
                                    <Select
                                        id="cond-field"
                                        value={config.condition.field}
                                        onChange={(e) =>
                                            handleChange('condition', {
                                                ...config.condition,
                                                field: e.target.value,
                                                value: '', // reset value when field changes
                                            })
                                        }
                                        options={precedingFields.map((f) => ({
                                            value: f.id,
                                            label: f.label,
                                        }))}
                                        placeholder="Select field..."
                                    />
                                </div>

                                {/* Operator */}
                                <div>
                                    <Label htmlFor="cond-op">Operator</Label>
                                    <Select
                                        id="cond-op"
                                        value={config.condition.operator}
                                        onChange={(e) =>
                                            handleChange('condition', {
                                                ...config.condition,
                                                operator: e.target.value,
                                            })
                                        }
                                        options={[
                                            { value: 'equals', label: 'Equals' },
                                            { value: 'notEquals', label: 'Does not equal' },
                                        ]}
                                    />
                                </div>

                                {/* Value — dropdown if source has options, text input otherwise */}
                                <div>
                                    <Label htmlFor="cond-value">Value</Label>
                                    {sourceFieldHasOptions ? (
                                        <Select
                                            id="cond-value"
                                            value={config.condition.value}
                                            onChange={(e) =>
                                                handleChange('condition', {
                                                    ...config.condition,
                                                    value: e.target.value,
                                                })
                                            }
                                            options={sourceFieldOptions}
                                            placeholder="Select value..."
                                        />
                                    ) : (
                                        <Input
                                            id="cond-value"
                                            value={config.condition.value}
                                            onChange={(e) =>
                                                handleChange('condition', {
                                                    ...config.condition,
                                                    value: e.target.value,
                                                })
                                            }
                                            placeholder="Enter value..."
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
