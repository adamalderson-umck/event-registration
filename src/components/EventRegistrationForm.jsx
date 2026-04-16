import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { Loader2 } from 'lucide-react';
import SuccessState from './SuccessState';
import WaitlistNotice from './WaitlistNotice';
import WaiverSignatureStep from './WaiverSignatureStep';
import FormPreview from './FormPreview';
import Card from './ui/Card';
import { evaluateCondition, splitIntoPages } from '../utils/formConditions';

export default function EventRegistrationForm({ eventId, orgId }) {
    const [event, setEvent] = useState(null);
    const [formData, setFormData] = useState({});
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [isWaitlisted, setIsWaitlisted] = useState(false);
    const [fetchError, setFetchError] = useState('');
    const [currentPage, setCurrentPage] = useState(0);
    const [waiverData, setWaiverData] = useState({
        consentToESign: false,
        signerName: '',
        signatureMethod: 'draw',
        signatureData: null,
        signatureFont: null,
    });
    const [waiverErrors, setWaiverErrors] = useState({});
    const [turnstileToken, setTurnstileToken] = useState(null);
    const turnstileRef = useRef(null);
    const turnstileWidgetId = useRef(null);
    const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

    // Prevents accidental form submit when Next→Submit buttons swap at the same DOM position
    const justNavigated = useRef(false);

    // Fetch event data
    useEffect(() => {
        const fetchEvent = async () => {
            try {
                const { data, error } = await supabase
                    .from('events')
                    .select('*')
                    .eq('id', eventId)
                    .eq('org_id', orgId)
                    .single();

                if (error || !data) {
                    setFetchError('Event not found');
                    setLoading(false);
                    return;
                }

                if (data.status !== 'active') {
                    setFetchError('This event is no longer accepting registrations');
                    setLoading(false);
                    return;
                }

                if (data.registration_close_date && new Date(data.registration_close_date) < new Date()) {
                    setFetchError('Registration for this event has closed');
                    setLoading(false);
                    return;
                }

                setEvent(data);
            } catch (err) {
                console.error('Error fetching event:', err);
                setFetchError('Failed to load event');
            } finally {
                setLoading(false);
            }
        };

        if (eventId && orgId) fetchEvent();
    }, [eventId, orgId]);

    // Load Cloudflare Turnstile script (only if site key is configured)
    useEffect(() => {
        if (!TURNSTILE_SITE_KEY) return;
        if (document.getElementById('cf-turnstile-script')) return;
        const script = document.createElement('script');
        script.id = 'cf-turnstile-script';
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
    }, [TURNSTILE_SITE_KEY]);

    // Mount Turnstile widget once the container ref and script are ready
    const mountTurnstile = useCallback(() => {
        if (!TURNSTILE_SITE_KEY || !turnstileRef.current || !window.turnstile) return;
        if (turnstileWidgetId.current !== null) return; // already mounted
        turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
            sitekey: TURNSTILE_SITE_KEY,
            callback: (token) => setTurnstileToken(token),
            'expired-callback': () => setTurnstileToken(null),
            'error-callback': () => setTurnstileToken(null),
            theme: 'light',
        });
    }, [TURNSTILE_SITE_KEY]);

    // Try mounting when the last page is shown (widget lives on last page)
    useEffect(() => {
        if (!TURNSTILE_SITE_KEY) return;
        const tryMount = () => {
            if (window.turnstile) mountTurnstile();
        };
        const script = document.getElementById('cf-turnstile-script');
        if (script) script.addEventListener('load', tryMount);
        tryMount(); // in case script already loaded
        return () => {
            if (script) script.removeEventListener('load', tryMount);
        };
    }, [TURNSTILE_SITE_KEY, mountTurnstile]);

    // --- Multi-page and condition helpers ---
    const pages = event ? splitIntoPages(event.form_fields || []) : [];

    const getVisibleFields = (fieldsToCheck) =>
        fieldsToCheck.filter((f) => evaluateCondition(f.condition, formData));

    const currentPageFields = pages[currentPage]?.fields || [];
    const visibleCurrentPageFields = getVisibleFields(currentPageFields);
    const allVisibleFields = pages.flatMap((p) => getVisibleFields(p.fields));

    const handleFieldChange = (fieldId, value) => {
        setFormData((prev) => ({ ...prev, [fieldId]: value }));
        // Clear error when user modifies field
        if (errors[fieldId]) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next[fieldId];
                return next;
            });
        }
    };

    const findRegistrantEmail = (fields, data) => {
        const emailField = (fields || []).find((f) => f.id === 'system_email') || (fields || []).find((f) => f.type === 'email');
        return emailField ? data[emailField.id] || '' : '';
    };

    const validate = (fieldsToValidate = null) => {
        const newErrors = {};
        const fields = fieldsToValidate || allVisibleFields;

        for (const field of fields) {
            if (!field.required) continue;

            const value = formData[field.id];

            if (field.type === 'checkbox') {
                if (!value) newErrors[field.id] = 'This field is required';
            } else if (field.type === 'checkboxGroup') {
                if (!Array.isArray(value) || value.length === 0) {
                    newErrors[field.id] = 'Select at least one option';
                }
            } else {
                if (!value || (typeof value === 'string' && value.trim() === '')) {
                    newErrors[field.id] = 'This field is required';
                }
            }

            // Email format validation
            if (field.type === 'email' && value && typeof value === 'string') {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(value.trim())) {
                    newErrors[field.id] = 'Please enter a valid email address';
                }
            }

            // Phone format validation
            if (field.type === 'phone' && value && typeof value === 'string') {
                const digits = value.replace(/\D/g, '');
                if (digits.length > 0 && digits.length < 10) {
                    newErrors[field.id] = 'Please enter a valid 10-digit phone number';
                }
            }
        }

        // Waiver validation — only on final submit (fieldsToValidate is null)
        const newWaiverErrors = {};
        if (!fieldsToValidate && event?.waiver_enabled) {
            if (!waiverData.consentToESign) {
                newErrors._waiver_consent = 'consent';
                newWaiverErrors.consentToESign = 'You must agree to sign electronically';
            }
            if (!waiverData.signerName?.trim()) {
                newErrors._waiver_name = 'name';
                newWaiverErrors.signerName = 'Full legal name is required';
            }
            if (waiverData.signatureMethod === 'draw' && !waiverData.signatureData) {
                newErrors._waiver_sig = 'signature';
                newWaiverErrors.signature = 'Please draw your signature';
            }
        }
        setWaiverErrors(fieldsToValidate ? {} : newWaiverErrors);

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // --- Page navigation ---
    const handleNext = () => {
        if (!validate(visibleCurrentPageFields)) return;

        // Clear any stale errors before showing the next page
        setErrors({});
        setWaiverErrors({});

        // Guard against accidental submit from Next→Submit button swap at same DOM position
        justNavigated.current = true;

        // Find the next page with visible fields (skip all-hidden pages)
        let nextPage = currentPage + 1;
        while (nextPage < pages.length - 1) {
            const visibleFields = getVisibleFields(pages[nextPage].fields);
            if (visibleFields.length > 0) break;
            nextPage++;
        }
        setCurrentPage(nextPage);
    };

    const handleBack = () => {
        // Clear errors when going back so the previous page starts clean
        setErrors({});
        setWaiverErrors({});

        let prevPage = currentPage - 1;
        while (prevPage > 0) {
            const visibleFields = getVisibleFields(pages[prevPage].fields);
            if (visibleFields.length > 0) break;
            prevPage--;
        }
        setCurrentPage(Math.max(0, prevPage));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        // Reject submit that fired because the Submit button appeared at the same
        // DOM position as the Next button the user just clicked (double-click race)
        if (justNavigated.current) {
            justNavigated.current = false;
            return;
        }
        if (!validate()) return;

        // CAPTCHA check — only if Turnstile is configured
        if (TURNSTILE_SITE_KEY && !turnstileToken) {
            setErrors((prev) => ({ ...prev, _form: 'Please complete the CAPTCHA challenge.' }));
            return;
        }

        setSubmitting(true);

        try {
            // Build clean form_data from visible fields only
            const cleanFormData = {};
            for (const field of allVisibleFields) {
                if (formData[field.id] !== undefined) {
                    cleanFormData[field.id] = formData[field.id];
                }
            }

            const registrationData = {
                event_id: eventId,
                org_id: orgId,
                form_data: cleanFormData,
                status: 'pending', // Trigger will set to confirmed/waitlisted
                payment_status: event.payment_enabled ? 'pending' : 'not_required',
                payment_method: null,
            };

            // Add signature record if waiver is enabled
            if (event.waiver_enabled) {
                let ipAddress = 'unknown';
                try {
                    const response = await supabase.functions.invoke('capture-signer-ip');
                    if (response.data?.ip) {
                        ipAddress = response.data.ip;
                    }
                } catch (err) {
                    console.warn('Could not capture IP:', err);
                }

                registrationData.signature_record = {
                    signed: true,
                    signedAt: new Date().toISOString(),
                    signerName: waiverData.signerName.trim(),
                    signerEmail: findRegistrantEmail(event.form_fields, formData),
                    signatureMethod: waiverData.signatureMethod,
                    signatureData: waiverData.signatureMethod === 'draw'
                        ? waiverData.signatureData
                        : null,
                    signatureFont: waiverData.signatureMethod === 'type'
                        ? waiverData.signatureFont
                        : null,
                    waiverTitle: event.waiver_title || '',
                    waiverContentHash: event.waiver_content_hash || '',
                    ipAddress,
                    userAgent: navigator.userAgent,
                    consentToESign: true,
                };
            }

            const { error: insertError } = await supabase
                .from('registrations')
                .insert(registrationData);

            if (insertError) throw insertError;

            // Determine if waitlisted for UI display
            const isFull = event.capacity && event.registration_count >= event.capacity;
            setIsWaitlisted(isFull && event.waitlist_enabled);
            setSubmitted(true);
        } catch (err) {
            console.error('Error submitting registration:', err);
            setErrors({ _form: 'Failed to submit registration. Please try again.' });
        } finally {
            setSubmitting(false);
        }
    };

    const handleReset = () => {
        setFormData({});
        setErrors({});
        setSubmitted(false);
        setIsWaitlisted(false);
        setCurrentPage(0);
        setWaiverData({
            consentToESign: false,
            signerName: '',
            signatureMethod: 'draw',
            signatureData: null,
            signatureFont: null,
        });
        setWaiverErrors({});
    };

    // Loading state
    if (loading) {
        return (
            <div className="flex justify-center items-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    // Error state
    if (fetchError) {
        return (
            <Card className="max-w-lg mx-auto p-8 text-center">
                <p className="text-lg font-semibold text-slate-900 mb-2">Oops!</p>
                <p className="text-slate-500">{fetchError}</p>
            </Card>
        );
    }

    // Success state
    if (submitted) {
        return (
            <SuccessState
                event={event}
                isWaitlisted={isWaitlisted}
                onReset={handleReset}
            />
        );
    }

    const isFull = event.capacity && event.registration_count >= event.capacity;
    const isClosed = isFull && !event.waitlist_enabled;

    // Closed state
    if (isClosed) {
        return (
            <Card className="max-w-2xl mx-auto p-8 text-center">
                <p className="text-lg font-semibold text-slate-700">Registration is Full</p>
                <p className="text-slate-500 text-sm mt-1">This event has reached capacity and is no longer accepting registrations.</p>
            </Card>
        );
    }

    return (
        <div className="max-w-2xl mx-auto">
            {/* Screen-reader live region for form-level errors */}
            <div aria-live="polite" aria-atomic="true" className="sr-only">
                {errors._form}
            </div>
            <FormPreview
                event={event}
                formData={formData}
                currentPage={currentPage}
                readOnly={false}
                errors={errors}
                onFieldChange={handleFieldChange}
                onNext={handleNext}
                onBack={handleBack}
                onSubmit={handleSubmit}
                submitting={submitting || (TURNSTILE_SITE_KEY && !turnstileToken && currentPage === pages.length - 1)}
                beforeFields={
                    isFull && event.waitlist_enabled
                        ? <WaitlistNotice waitlistCount={event.waitlist_count || 0} />
                        : null
                }
                waiverSlot={
                    event.waiver_enabled
                        ? (
                            <WaiverSignatureStep
                                waiver={event}
                                value={waiverData}
                                onChange={(data) => {
                                    setWaiverData(data);
                                    setWaiverErrors({});
                                }}
                                errors={waiverErrors}
                            />
                        )
                        : null
                }
                captchaSlot={
                    TURNSTILE_SITE_KEY && currentPage === pages.length - 1
                        ? (
                            <div className="mt-4">
                                <div ref={turnstileRef} />
                                {errors._form && (
                                    <p role="alert" className="text-xs text-danger mt-2">{errors._form}</p>
                                )}
                            </div>
                        )
                        : null
                }
            />
        </div>
    );
}
