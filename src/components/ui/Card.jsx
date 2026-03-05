import React from 'react';

export default function Card({ children, className = '', ...props }) {
    return (
        <div
            className={`bg-white rounded-xl shadow-sm border border-slate-200 ${className}`}
            {...props}
        >
            {children}
        </div>
    );
}
