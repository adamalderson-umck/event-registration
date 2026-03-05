import React from 'react';
import Input from './ui/Input';
import Label from './ui/Label';
import Select from './ui/Select';
import Checkbox from './ui/Checkbox';

/**
 * DynamicField renders a single form field based on its schema configuration.
 * Supports: text, email, phone, number, textarea, select, checkbox, checkboxGroup, radio, date
 */
export default function DynamicField({ field, value, onChange, error }) {
    const { id, type, label, required, placeholder, options = [] } = field;

    const handleChange = (newValue) => {
        onChange(id, newValue);
    };

    const renderField = () => {
        switch (type) {
            case 'text':
            case 'email':
            case 'phone':
            case 'number':
                return (
                    <Input
                        id={`field-${id}`}
                        type={type === 'phone' ? 'tel' : type}
                        value={value || ''}
                        onChange={(e) => handleChange(e.target.value)}
                        placeholder={placeholder}
                        error={error}
                    />
                );

            case 'date':
                return (
                    <Input
                        id={`field-${id}`}
                        type="date"
                        value={value || ''}
                        onChange={(e) => handleChange(e.target.value)}
                        error={error}
                    />
                );

            case 'textarea':
                return (
                    <textarea
                        id={`field-${id}`}
                        value={value || ''}
                        onChange={(e) => handleChange(e.target.value)}
                        placeholder={placeholder}
                        rows={3}
                        className={`
              w-full px-3 py-2 border rounded-lg
              text-slate-900 placeholder-slate-400
              transition-colors duration-200
              focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
              resize-y
              ${error ? 'border-danger ring-1 ring-danger/30' : 'border-slate-300'}
            `}
                    />
                );

            case 'select':
                return (
                    <Select
                        id={`field-${id}`}
                        value={value || ''}
                        onChange={(e) => handleChange(e.target.value)}
                        options={options}
                        placeholder={`Select ${label}`}
                        error={error}
                    />
                );

            case 'checkbox':
                return (
                    <Checkbox
                        id={`field-${id}`}
                        checked={!!value}
                        onChange={(e) => handleChange(e.target.checked)}
                        label={label}
                    />
                );

            case 'checkboxGroup':
                return (
                    <div className="space-y-2">
                        {options.map((opt) => {
                            const optValue = typeof opt === 'string' ? opt : opt.value;
                            const optLabel = typeof opt === 'string' ? opt : opt.label;
                            const selectedValues = Array.isArray(value) ? value : [];
                            return (
                                <Checkbox
                                    key={optValue}
                                    checked={selectedValues.includes(optValue)}
                                    onChange={(e) => {
                                        const newValues = e.target.checked
                                            ? [...selectedValues, optValue]
                                            : selectedValues.filter((v) => v !== optValue);
                                        handleChange(newValues);
                                    }}
                                    label={optLabel}
                                />
                            );
                        })}
                    </div>
                );

            case 'radio':
                return (
                    <div className="space-y-2">
                        {options.map((opt) => {
                            const optValue = typeof opt === 'string' ? opt : opt.value;
                            const optLabel = typeof opt === 'string' ? opt : opt.label;
                            return (
                                <label key={optValue} className="inline-flex items-center gap-2 cursor-pointer mr-4">
                                    <input
                                        type="radio"
                                        name={`field-${id}`}
                                        value={optValue}
                                        checked={value === optValue}
                                        onChange={(e) => handleChange(e.target.value)}
                                        className="w-4 h-4 text-primary border-slate-300 focus:ring-primary/50 cursor-pointer"
                                    />
                                    <span className="text-sm text-slate-700">{optLabel}</span>
                                </label>
                            );
                        })}
                    </div>
                );

            default:
                return (
                    <p className="text-sm text-slate-400">Unsupported field type: {type}</p>
                );
        }
    };

    return (
        <div className="space-y-1">
            {/* Don't show label for checkbox type — it's built into the component */}
            {type !== 'checkbox' && (
                <Label htmlFor={`field-${id}`} required={required}>
                    {label}
                </Label>
            )}
            {renderField()}
            {error && (
                <p className="text-xs text-danger mt-1">{error}</p>
            )}
        </div>
    );
}
