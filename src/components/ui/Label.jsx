import React from 'react';

export default function Label({ children, required, className = '', ...props }) {
    return (
        <label
            className={`block text-sm font-medium text-slate-700 mb-1 ${className}`}
            {...props}
        >
            {children}
            {required && <span className="text-danger ml-1">*</span>}
        </label>
    );
}
