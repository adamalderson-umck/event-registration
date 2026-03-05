import React from 'react';

export default function Input({ className = '', error, ...props }) {
    return (
        <input
            className={`
        w-full px-3 py-2
        border rounded-lg
        text-slate-900 placeholder-slate-400
        transition-colors duration-200
        focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
        disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed
        ${error ? 'border-danger ring-1 ring-danger/30' : 'border-slate-300'}
        ${className}
      `}
            {...props}
        />
    );
}
