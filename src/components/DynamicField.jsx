import React from 'react';
import Input from './ui/Input';
import Label from './ui/Label';
import Select from './ui/Select';
import Checkbox from './ui/Checkbox';

/**
 * DynamicField renders a single form field based on its schema configuration.
 * Supports: text, email, phone, number, textarea, select, checkbox, checkboxGroup, radio, date
 *
 * Accessibility: WCAG 2.1 AA compliant
 * - All inputs have associated <label> via htmlFor/id
 * - Errors linked via aria-describedby
 * - Invalid state communicated via aria-invalid
 * - Group fields use role="group" + aria-labelledby
 */
export default function DynamicField({ field, value, onChange, onBlur, error, disabled = false }) {
    const { id, type, label, required, placeholder, options = [] } = field;
    const inputId = `field-${id}`;
    const errorId = `field-${id}-error`;
    const groupLabelId = `field-${id}-label`;

    const handleChange = (newValue) => {
        onChange(id, newValue);
    };

    const handleBlur = (currentValue) => {
        onBlur?.(id, currentValue);
    };

    const sharedInputProps = {
        'aria-describedby': error ? errorId : undefined,
        'aria-invalid': error ? 'true' : undefined,
    };

    const renderField = () => {
        switch (type) {
            case 'text':
            case 'email':
            case 'phone':
            case 'number': {
                const handlePhoneChange = (v) => {
                    const digits = v.replace(/\D/g, '');
                    if (digits.length <= 3) return handleChange(digits);
                    if (digits.length <= 6) return handleChange(`(${digits.slice(0, 3)}) ${digits.slice(3)}`);
                    return handleChange(`(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`);
                };

                return (
                    <Input
                        id={inputId}
                        type={type === 'phone' ? 'tel' : type}
                        value={value || ''}
                        onChange={(e) => type === 'phone' ? handlePhoneChange(e.target.value) : handleChange(e.target.value)}
                        onBlur={(e) => handleBlur(e.target.value)}
                        placeholder={type === 'phone' && !placeholder ? '(555) 555-5555' : placeholder}
                        error={error}
                        disabled={disabled}
                        {...sharedInputProps}
                    />
                );
            }

            case 'date':
                return (
                    <Input
                        id={inputId}
                        type="date"
                        value={value || ''}
                        onChange={(e) => handleChange(e.target.value)}
                        error={error}
                        disabled={disabled}
                        {...sharedInputProps}
                    />
                );

            case 'textarea':
                return (
                    <textarea
                        id={inputId}
                        value={value || ''}
                        onChange={(e) => handleChange(e.target.value)}
                        placeholder={placeholder}
                        rows={3}
                        disabled={disabled}
                        aria-describedby={error ? errorId : undefined}
                        aria-invalid={error ? 'true' : undefined}
                        className={`
              w-full px-3 py-2 border rounded-lg
              text-slate-900 placeholder-slate-400
              transition-colors duration-200
              focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
              resize-y
              ${error ? 'border-danger ring-1 ring-danger/30' : 'border-slate-300'}
              ${disabled ? 'opacity-60 cursor-not-allowed bg-slate-50' : ''}
            `}
                    />
                );

            case 'select':
                return (
                    <Select
                        id={inputId}
                        value={value || ''}
                        onChange={(e) => handleChange(e.target.value)}
                        options={options}
                        placeholder={`Select ${label}`}
                        error={error}
                        disabled={disabled}
                        aria-describedby={error ? errorId : undefined}
                        aria-invalid={error ? 'true' : undefined}
                    />
                );

            case 'checkbox':
                return (
                    <Checkbox
                        id={inputId}
                        checked={!!value}
                        onChange={(e) => handleChange(e.target.checked)}
                        label={label}
                        disabled={disabled}
                        aria-describedby={error ? errorId : undefined}
                        aria-invalid={error ? 'true' : undefined}
                    />
                );

            case 'checkboxGroup':
                return (
                    <div
                        role="group"
                        aria-labelledby={groupLabelId}
                        aria-describedby={error ? errorId : undefined}
                        className="flex flex-wrap gap-x-6 gap-y-3"
                    >
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
                                    disabled={disabled}
                                    className={disabled ? 'opacity-60' : ''}
                                />
                            );
                        })}
                    </div>
                );

            case 'radio':
                return (
                    <div
                        role="radiogroup"
                        aria-labelledby={groupLabelId}
                        aria-describedby={error ? errorId : undefined}
                        className="flex flex-wrap gap-x-6 gap-y-3"
                    >
                        {options.map((opt) => {
                            const optValue = typeof opt === 'string' ? opt : opt.value;
                            const optLabel = typeof opt === 'string' ? opt : opt.label;
                            return (
                                <label key={optValue} className={`inline-flex items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                                    <input
                                        type="radio"
                                        name={`field-${id}`}
                                        value={optValue}
                                        checked={value === optValue}
                                        onChange={(e) => handleChange(e.target.value)}
                                        disabled={disabled}
                                        className={`w-4 h-4 text-primary border-slate-300 focus:ring-primary/50 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
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
                <Label id={groupLabelId} htmlFor={type === 'checkboxGroup' || type === 'radio' ? undefined : inputId} required={required}>
                    {label}
                </Label>
            )}
            {renderField()}
            {error && (
                <p id={errorId} role="alert" className="text-xs text-danger mt-1">
                    {error}
                </p>
            )}
        </div>
    );
}
