import React from 'react';
import { CalendarDays, MapPin, Users, ChevronLeft, ChevronRight, Send } from 'lucide-react';
import DynamicField from './DynamicField';
import FormStepper from './FormStepper';
import Button from './ui/Button';
import { evaluateCondition, splitIntoPages } from '../utils/formConditions';
import { resolveTheme, resolveHeaderImage } from '../constants/themePresets';

/**
 * Pure presentational renderer for an event registration form.
 * Used by both the public EventRegistrationForm and the admin FormPreviewPane.
 *
 * @param {Object} props
 * @param {Object} props.event           - Event object (real or synthetic)
 * @param {Object} props.formData        - Current field values ({ fieldId: value })
 * @param {number} props.currentPage     - Active page index
 * @param {boolean} props.readOnly       - Disable all inputs, hide submit
 * @param {Object} [props.errors]        - Validation errors ({ fieldId: message })
 * @param {Function} [props.onFieldChange] - (fieldId, value) => void
 * @param {Function} [props.onNext]      - Next-page handler
 * @param {Function} [props.onBack]      - Previous-page handler
 * @param {Function} [props.onSubmit]    - Form submit handler (e) => void
 * @param {boolean} [props.submitting]   - Show loading state on submit button
 * @param {string} [props.submitLabel]   - Final-page submit action label
 * @param {React.ReactNode} [props.waiverSlot]   - Waiver component to render on last page
 * @param {React.ReactNode} [props.captchaSlot]  - CAPTCHA widget to render on last page
 * @param {React.ReactNode} [props.paymentSlot]  - Payment-method component to render on last page
 * @param {React.ReactNode} [props.beforeFields] - Content rendered before form fields (e.g. WaitlistNotice)
 */
export default function FormPreview({
    event,
    formData = {},
    currentPage = 0,
    readOnly = false,
    errors = {},
    onFieldChange,
    onNext,
    onBack,
    onSubmit,
    submitting = false,
    submitLabel = 'Submit Registration',
    waiverSlot,
    captchaSlot,
    paymentSlot,
    beforeFields,
}) {
    if (!event) return null;

    // --- Multi-page and condition helpers ---
    const pages = splitIntoPages(event.form_fields || []);
    const isMultiPage = pages.length > 1;

    const getVisibleFields = (fieldsToCheck) =>
        fieldsToCheck.filter((f) => evaluateCondition(f.condition, formData));

    const currentPageFields = pages[currentPage]?.fields || [];
    const visibleCurrentPageFields = getVisibleFields(currentPageFields);

    const isLastPage = !isMultiPage || currentPage === pages.length - 1;

    // Resolve theme and header image
    const theme = resolveTheme(event.theme, null);
    const headerImage = resolveHeaderImage(event.header_image_url, null);

    const isFull = event.capacity && event.registration_count >= event.capacity;
    const spotsLeft = event.capacity ? event.capacity - (event.registration_count || 0) : null;

    const themeVars = {
        '--theme-primary': theme.primary,
        '--theme-accent': theme.accent,
    };

    const handleFieldChange = (fieldId, value) => {
        if (!readOnly && onFieldChange) {
            onFieldChange(fieldId, value);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!readOnly && onSubmit) {
            onSubmit(e);
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" style={themeVars}>
            {/* Event Header */}
            {headerImage ? (
                <div className="relative" style={{ aspectRatio: '16/9' }}>
                    <img
                        src={headerImage}
                        alt={event.title}
                        className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/60 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-4 sm:px-6 sm:py-6 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                        <h1 className="text-xl sm:text-2xl font-bold mb-1 sm:mb-2 leading-tight">{event.title || 'Untitled Event'}</h1>
                        {event.description && (
                            <p className="text-white/90 text-xs sm:text-sm mb-3 sm:mb-4 leading-relaxed line-clamp-2 md:line-clamp-4">{event.description}</p>
                        )}
                        <div className="flex flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm text-white/90 font-medium">
                            {event.start_date && (
                                <span className="flex items-center gap-1">
                                    <CalendarDays className="w-4 h-4" />
                                    {new Date(event.start_date).toLocaleDateString('en-US', {
                                        weekday: 'short',
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                    })}
                                </span>
                            )}
                            {event.location && (
                                <span className="flex items-center gap-1">
                                    <MapPin className="w-4 h-4" />
                                    {event.location}
                                </span>
                            )}
                            {spotsLeft !== null && spotsLeft > 0 && (
                                <span className="flex items-center gap-1">
                                    <Users className="w-4 h-4" />
                                    {spotsLeft} {spotsLeft === 1 ? 'spot' : 'spots'} remaining
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div
                    className="p-5 sm:px-6 sm:py-8 text-white"
                    style={{
                        background: `linear-gradient(to right, ${theme.primary}, ${theme.accent})`,
                    }}
                >
                    <h1 className="text-xl sm:text-2xl font-bold mb-1 sm:mb-2 leading-tight">{event.title || 'Untitled Event'}</h1>
                    {event.description && (
                        <p className="text-white/90 text-xs sm:text-sm mb-3 sm:mb-4 leading-relaxed line-clamp-2 md:line-clamp-4">{event.description}</p>
                    )}
                    <div className="flex flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm text-white/90 font-medium">
                        {event.start_date && (
                            <span className="flex items-center gap-1">
                                <CalendarDays className="w-4 h-4" />
                                {new Date(event.start_date).toLocaleDateString('en-US', {
                                    weekday: 'short',
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                })}
                            </span>
                        )}
                        {event.location && (
                            <span className="flex items-center gap-1">
                                <MapPin className="w-4 h-4" />
                                {event.location}
                            </span>
                        )}
                        {spotsLeft !== null && spotsLeft > 0 && (
                            <span className="flex items-center gap-1">
                                <Users className="w-4 h-4" />
                                {spotsLeft} {spotsLeft === 1 ? 'spot' : 'spots'} remaining
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Form Content */}
            <div className="p-6">
                <form onSubmit={handleSubmit} noValidate className="space-y-5">
                    {beforeFields}

                    {/* Step indicator */}
                    {isMultiPage && (
                        <FormStepper
                            pages={pages}
                            currentPage={currentPage}
                            onPageClick={readOnly ? (() => {}) : undefined}
                        />
                    )}

                    {/* Page title */}
                    {isMultiPage && pages[currentPage]?.title && (
                        <h2 className="text-lg font-semibold text-slate-800 mb-4">
                            {pages[currentPage].title}
                        </h2>
                    )}

                    {/* Current page fields — with condition evaluation */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-5">
                        {visibleCurrentPageFields.map((field) => {
                            const wideTypes = ['textarea', 'checkboxGroup', 'radio', 'checkbox'];
                            const isWide = wideTypes.includes(field.type);
                            return (
                                <div key={field.id} className={isWide ? 'md:col-span-2' : ''}>
                                    <DynamicField
                                        field={field}
                                        value={formData[field.id]}
                                        onChange={handleFieldChange}
                                        error={errors[field.id]}
                                        disabled={readOnly}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    {/* Empty state for preview */}
                    {visibleCurrentPageFields.length === 0 && (
                        <div className="text-center py-8 text-slate-400 text-sm">
                            {readOnly
                                ? 'Add fields in the builder to see them here'
                                : 'No fields on this page'}
                        </div>
                    )}

                    {/* Waiver — only on last page */}
                    {isLastPage && waiverSlot}
                    {isLastPage && paymentSlot}

                    {/* CAPTCHA — only on last page */}
                    {isLastPage && captchaSlot}

                    {/* Waiver placeholder in read-only mode */}
                    {isLastPage && readOnly && Array.isArray(event.waivers) && event.waivers.length > 0 && !waiverSlot && (
                        <div className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center text-sm text-slate-400">
                            Waiver / E-Signature section will appear here
                        </div>
                    )}

                    {errors._form && (
                        <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            {errors._form}
                        </p>
                    )}

                    {/* Navigation buttons */}
                    {!readOnly && (
                        <div className="flex gap-3">
                            {isMultiPage && currentPage > 0 && (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={onBack}
                                    className="flex-1"
                                    size="lg"
                                >
                                    <ChevronLeft className="w-4 h-4" /> Back
                                </Button>
                            )}

                            {isMultiPage && !isLastPage ? (
                                <Button
                                    type="button"
                                    onClick={onNext}
                                    className="flex-1"
                                    size="lg"
                                >
                                    Next <ChevronRight className="w-4 h-4" />
                                </Button>
                            ) : (
                                <Button
                                    type="submit"
                                    loading={submitting}
                                    className="flex-1"
                                    size="lg"
                                    style={{ backgroundColor: theme.primary }}
                                >
                                    <Send className="w-4 h-4" />
                                    {isFull && event.waitlist_enabled ? 'Join Waitlist' : submitLabel}
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Read-only submit button preview */}
                    {readOnly && (
                        <div className="flex gap-3">
                            {isMultiPage && currentPage > 0 && (
                                <div
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium bg-slate-100 text-slate-400 cursor-default"
                                >
                                    <ChevronLeft className="w-4 h-4" /> Back
                                </div>
                            )}
                            <div
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-white cursor-default"
                                style={{ backgroundColor: theme.primary, opacity: 0.7 }}
                            >
                                <Send className="w-4 h-4" />
                                {isMultiPage && !isLastPage
                                    ? 'Next'
                                    : (isFull && event.waitlist_enabled ? 'Join Waitlist' : submitLabel)
                                }
                            </div>
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
}
