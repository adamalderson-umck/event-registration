import React from 'react';
import { Check } from 'lucide-react';

/**
 * Horizontal step indicator for multi-page forms.
 * Shows numbered dots with current, completed, and remaining states.
 * Hidden when there's only one page (single-page fallback).
 */
export default function FormStepper({ pages, currentPage, onPageClick }) {
    if (pages.length <= 1) return null;

    return (
        <div className="flex items-center justify-center gap-2 mb-6">
            {pages.map((page, index) => {
                const isCompleted = index < currentPage;
                const isCurrent = index === currentPage;

                return (
                    <React.Fragment key={index}>
                        {index > 0 && (
                            <div
                                className={`h-0.5 w-8 transition-colors ${
                                    isCompleted ? 'bg-primary' : 'bg-slate-200'
                                }`}
                            />
                        )}
                        <button
                            type="button"
                            onClick={() => isCompleted && onPageClick(index)}
                            disabled={!isCompleted}
                            className={`
                                flex items-center justify-center w-8 h-8 rounded-full
                                text-xs font-bold transition-all shrink-0
                                ${isCurrent
                                    ? 'bg-primary text-white shadow-md'
                                    : isCompleted
                                        ? 'bg-primary/20 text-primary hover:bg-primary/30 cursor-pointer'
                                        : 'bg-slate-100 text-slate-400'
                                }
                            `}
                            title={page.title || `Step ${index + 1}`}
                        >
                            {isCompleted ? <Check className="w-3.5 h-3.5" /> : index + 1}
                        </button>
                    </React.Fragment>
                );
            })}
        </div>
    );
}
