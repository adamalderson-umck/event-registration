import React from 'react';

export default function Checkbox({ label, className = '', ...props }) {
    return (
        <label className={`inline-flex items-center gap-2 cursor-pointer ${className}`}>
            <input
                type="checkbox"
                className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/50 cursor-pointer"
                {...props}
            />
            {label && <span className="text-sm text-slate-700">{label}</span>}
        </label>
    );
}
