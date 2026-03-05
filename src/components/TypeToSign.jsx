import React from 'react';

export default function TypeToSign({ name }) {
    return (
        <div className="border border-slate-300 rounded-lg bg-white px-6 py-4 relative"
            style={{ height: '150px' }}
        >
            <div className="flex items-end h-full pb-6">
                {name ? (
                    <p
                        className="text-3xl text-slate-900 truncate w-full"
                        style={{ fontFamily: "'Dancing Script', cursive" }}
                    >
                        {name}
                    </p>
                ) : (
                    <p className="text-lg text-slate-300 italic">
                        Your name will appear here as a signature...
                    </p>
                )}
            </div>
            {/* Signature line */}
            <div className="absolute bottom-8 left-6 right-6 border-b border-slate-300" />
            <p className="absolute bottom-2 left-6 text-xs text-slate-400">Typed signature</p>
        </div>
    );
}
