import React from 'react';

export default function Select({ options = [], placeholder, className = '', error, ...props }) {
    return (
        <select
            className={`
        w-full px-3 py-2
        border rounded-lg
        text-slate-900 bg-white
        transition-colors duration-200
        focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
        disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed
        cursor-pointer
        ${error ? 'border-danger ring-1 ring-danger/30' : 'border-slate-300'}
        ${className}
      `}
            {...props}
        >
            {placeholder && (
                <option value="" disabled>
                    {placeholder}
                </option>
            )}
            {options.map((opt) => {
                const value = typeof opt === 'string' ? opt : opt.value;
                const label = typeof opt === 'string' ? opt : opt.label;
                return (
                    <option key={value} value={value}>
                        {label}
                    </option>
                );
            })}
        </select>
    );
}
