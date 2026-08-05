import React, { useState, useMemo } from 'react';
import { Eye, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react';
import FormPreview from './FormPreview';
import { splitIntoPages } from '../utils/formConditions';

/**
 * Admin preview wrapper — renders a collapsible, scaled-down FormPreview
 * fed by the current EventEditor state.
 *
 * @param {Object} props
 * @param {Object} props.eventState - Current EventEditor state (title, description, etc.)
 * @param {string} props.orgId
 */
export default function FormPreviewPane({ eventState }) {
    const [open, setOpen] = useState(false);
    const [currentPage, setCurrentPage] = useState(0);

    // Build a synthetic event object matching the shape FormPreview expects
    const syntheticEvent = useMemo(() => ({
        title: eventState.title || '',
        description: eventState.description || '',
        location: eventState.location || '',
        start_date: eventState.startDate || null,
        end_date: eventState.endDate || null,
        form_fields: eventState.formFields || [],
        theme: eventState.theme || null,
        header_image_url: eventState.headerImageUrl || null,
        waivers: eventState.waivers || [],
        capacity: eventState.capacity ? parseInt(eventState.capacity) : null,
        registration_count: 0,
        waitlist_enabled: eventState.waitlistEnabled || false,
        payment_enabled: eventState.paymentEnabled || false,
        allow_in_person_payment: eventState.allowInPersonPayment ?? false,
        tithely_giving_url: eventState.tithelyGivingUrl ?? null,
        tithely_embed_config: eventState.tithelyEmbedConfig ?? null,
    }), [eventState]);

    // Reset page when fields change and page would be out of bounds
    const pages = splitIntoPages(syntheticEvent.form_fields);
    const safePage = Math.min(currentPage, Math.max(0, pages.length - 1));
    if (safePage !== currentPage) {
        setCurrentPage(safePage);
    }

    const handlePrevPage = () => {
        setCurrentPage((p) => Math.max(0, p - 1));
    };

    const handleNextPage = () => {
        setCurrentPage((p) => Math.min(pages.length - 1, p + 1));
    };

    return (
        <div className="space-y-3">
            {/* Toggle header */}
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-primary transition-colors cursor-pointer"
            >
                {open ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {open ? 'Hide Live Preview' : 'Show Live Preview'}
            </button>

            {open && (
                <div className="relative">
                    {/* Preview badge */}
                    <div className="absolute top-3 right-3 z-10 bg-slate-800/80 text-white text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded">
                        Preview
                    </div>

                    {/* Page navigation for multi-page forms */}
                    {pages.length > 1 && (
                        <div className="flex items-center justify-center gap-3 mb-3">
                            <button
                                type="button"
                                onClick={handlePrevPage}
                                disabled={currentPage === 0}
                                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                            >
                                <ChevronLeft className="w-4 h-4 text-slate-500" />
                            </button>
                            <span className="text-xs font-medium text-slate-500">
                                Page {currentPage + 1} of {pages.length}
                            </span>
                            <button
                                type="button"
                                onClick={handleNextPage}
                                disabled={currentPage >= pages.length - 1}
                                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                            >
                                <ChevronRight className="w-4 h-4 text-slate-500" />
                            </button>
                        </div>
                    )}

                    {/* Scaled preview container */}
                    <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 bg-slate-50/50 overflow-hidden">
                        <div
                            className="origin-top-left"
                            style={{
                                transform: 'scale(0.85)',
                                transformOrigin: 'top center',
                                width: '117.65%', // 1/0.85 to counteract the scale
                                marginLeft: '-8.82%', // center the scaled content
                            }}
                        >
                            <FormPreview
                                event={syntheticEvent}
                                formData={{}}
                                currentPage={currentPage}
                                readOnly={true}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
