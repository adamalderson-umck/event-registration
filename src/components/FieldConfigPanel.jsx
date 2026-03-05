import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { fieldTypeOptions, needsOptions } from '../config/fieldTemplates';
import Button from './ui/Button';
import Input from './ui/Input';
import Label from './ui/Label';
import Select from './ui/Select';
import Checkbox from './ui/Checkbox';

export default function FieldConfigPanel({ field, onUpdate, onClose }) {
    const [config, setConfig] = useState(field);
    const [newOption, setNewOption] = useState('');

    useEffect(() => {
        setConfig(field);
    }, [field]);

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

    return (
        <div className="border-l border-slate-200 bg-slate-50 p-5 w-80 shrink-0 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Field Settings</h3>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="space-y-4">
                {/* Label */}
                <div>
                    <Label htmlFor="field-label">Label</Label>
                    <Input
                        id="field-label"
                        value={config.label || ''}
                        onChange={(e) => handleChange('label', e.target.value)}
                    />
                </div>

                {/* Type */}
                <div>
                    <Label htmlFor="field-type">Type</Label>
                    <Select
                        id="field-type"
                        value={config.type}
                        onChange={(e) => handleChange('type', e.target.value)}
                        options={fieldTypeOptions}
                    />
                </div>

                {/* Placeholder (for applicable types) */}
                {['text', 'email', 'phone', 'number', 'textarea'].includes(config.type) && (
                    <div>
                        <Label htmlFor="field-placeholder">Placeholder</Label>
                        <Input
                            id="field-placeholder"
                            value={config.placeholder || ''}
                            onChange={(e) => handleChange('placeholder', e.target.value)}
                        />
                    </div>
                )}

                {/* Required */}
                <Checkbox
                    label="Required field"
                    checked={!!config.required}
                    onChange={(e) => handleChange('required', e.target.checked)}
                />

                {/* Options (for select, checkboxGroup, radio) */}
                {needsOptions(config.type) && (
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
            </div>
        </div>
    );
}
