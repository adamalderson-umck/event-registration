import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { Loader2 } from 'lucide-react';
import SuccessState from './SuccessState';
import RegistrationPaymentStep from './RegistrationPaymentStep';
import WaitlistNotice from './WaitlistNotice';
import WaiverSignatureStep from './WaiverSignatureStep';
import FormPreview from './FormPreview';
import PaymentMethodChoice from './PaymentMethodChoice';
import RecentRegistrationDialog from './RecentRegistrationDialog';
import Card from './ui/Card';
import { evaluateCondition, splitIntoPages } from '../utils/formConditions';
import { getAvailablePaymentMethods } from '../utils/tithelyEmbed';
import {
    RECENT_REGISTRATION_ERROR,
    getRegistrationSubmissionErrorCode,
} from '../services/registrationSubmission';

export default function EventRegistrationForm({ eventId, orgId }) {
    const [event, setEvent] = useState(null);
    const [availablePaymentMethods, setAvailablePaymentMethods] = useState([]);
    const [paymentMethod, setPaymentMethod] = useState('');
    const [formData, setFormData] = useState({});
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [phase, setPhase] = useState('form');
    const [createdRegistration, setCreatedRegistration] = useState(null);
    const [fetchError, setFetchError] = useState('');
    const [currentPage, setCurrentPage] = useState(0);
    // Map of waiverID → per-waiver signature state
    const [signaturesMap, setSignaturesMap] = useState({});
    const [signaturesErrors, setSignaturesErrors] = useState({});
    const [turnstileToken, setTurnstileToken] = useState(null);
    const [recentWarningOpen, setRecentWarningOpen] = useState(false);
    const turnstileRef = useRef(null);
    const turnstileWidgetId = useRef(null);
    const submissionAttemptId = useRef(crypto.randomUUID());
    const pendingRecentOverride = useRef(false);
    const performSubmissionRef = useRef(null);
    const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

    // Prevents accidental form submit when Next→Submit buttons swap at the same DOM position
    const justNavigated = useRef(false);

    useEffect(() => {
        submissionAttemptId.current = crypto.randomUUID();
        pendingRecentOverride.current = false;
        setRecentWarningOpen(false);
    }, [eventId, orgId]);

    // Fetch event data
    useEffect(() => {
        let cancelled = false;

        setEvent(null);
        setAvailablePaymentMethods([]);
        setPaymentMethod('');
        setFetchError('');
        setLoading(Boolean(eventId && orgId));

        const fetchEvent = async () => {
            try {
                const { data, error } = await supabase
                    .from('events')
                    .select('*')
                    .eq('id', eventId)
                    .eq('org_id', orgId)
                    .single();

                if (cancelled) return;

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

                const methods = getAvailablePaymentMethods(data);
                setAvailablePaymentMethods(methods);
                setPaymentMethod(methods.length === 1 ? methods[0] : '');
                setEvent(data);
            } catch (err) {
                if (cancelled) return;
                console.error('Error fetching event:', err);
                setFetchError('Failed to load event');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        if (eventId && orgId) fetchEvent();
        return () => {
            cancelled = true;
        };
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
            action: 'event_registration',
            callback: (token) => {
                setTurnstileToken(token);
                if (pendingRecentOverride.current) {
                    pendingRecentOverride.current = false;
                    void performSubmissionRef.current?.(token, true);
                }
            },
            'expired-callback': () => {
                setTurnstileToken(null);
                if (pendingRecentOverride.current) {
                    pendingRecentOverride.current = false;
                    setSubmitting(false);
                    setErrors({ _form: 'Security verification expired. Please try again.' });
                }
            },
            'error-callback': () => {
                setTurnstileToken(null);
                if (pendingRecentOverride.current) {
                    pendingRecentOverride.current = false;
                    setSubmitting(false);
                    setErrors({ _form: 'Security verification failed. Please try again.' });
                }
            },
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
    }, [TURNSTILE_SITE_KEY, mountTurnstile, currentPage, loading]);

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
        const newSigErrors = {};
        if (!fieldsToValidate && event?.payment_enabled && !paymentMethod) {
            newErrors._payment_method = availablePaymentMethods.length === 0
                ? 'No usable payment method is configured for this event.'
                : 'Choose a payment method';
        }
        if (!fieldsToValidate && Array.isArray(event?.waivers)) {
            for (const waiver of event.waivers) {
                const sig = signaturesMap[waiver.id] || {};
                const wErr = {};
                if (sig.declined) continue; // explicit decline is valid for optional
                if (waiver.required !== false) {
                    // Required: must sign
                    if (!sig.consentToESign) {
                        newErrors[`_waiver_consent_${waiver.id}`] = 'consent';
                        wErr.consentToESign = 'You must agree to sign electronically';
                    }
                    if (!sig.signerName?.trim()) {
                        newErrors[`_waiver_name_${waiver.id}`] = 'name';
                        wErr.signerName = 'Full legal name is required';
                    }
                    if (sig.signatureMethod === 'draw' && !sig.signatureData) {
                        newErrors[`_waiver_sig_${waiver.id}`] = 'signature';
                        wErr.signature = 'Please draw your signature';
                    }
                } else if (!sig.declined) {
                    // Optional but not declined — treat as attempting to sign
                    if (sig.consentToESign) {
                        if (!sig.signerName?.trim()) {
                            newErrors[`_waiver_name_${waiver.id}`] = 'name';
                            wErr.signerName = 'Full legal name is required';
                        }
                        if (sig.signatureMethod === 'draw' && !sig.signatureData) {
                            newErrors[`_waiver_sig_${waiver.id}`] = 'signature';
                            wErr.signature = 'Please draw your signature';
                        }
                    }
                }
                if (Object.keys(wErr).length > 0) newSigErrors[waiver.id] = wErr;
            }
        }
        setSignaturesErrors(fieldsToValidate ? {} : newSigErrors);

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // --- Page navigation ---
    const handleNext = () => {
        if (!validate(visibleCurrentPageFields)) return;

        // Clear any stale errors before showing the next page
        setErrors({});
        setSignaturesErrors({});

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
        setSignaturesErrors({});

        let prevPage = currentPage - 1;
        while (prevPage > 0) {
            const visibleFields = getVisibleFields(pages[prevPage].fields);
            if (visibleFields.length > 0) break;
            prevPage--;
        }
        setCurrentPage(Math.max(0, prevPage));
    };

    async function performSubmission(token, recentDuplicateOverride) {
        setSubmitting(true);

        try {
            // Build clean form_data from visible fields only
            const cleanFormData = {};
            for (const field of allVisibleFields) {
                if (formData[field.id] !== undefined) {
                    cleanFormData[field.id] = formData[field.id];
                }
            }

            // Send only waiver decisions and signature input. The trusted server
            // derives waiver metadata, timestamps, IP address, and user agent.
            let signatureRecords = [];
            if (Array.isArray(event.waivers) && event.waivers.length > 0) {
                signatureRecords = event.waivers.map((waiver) => {
                    const sig = signaturesMap[waiver.id] || {};
                    if (sig.declined) {
                        return {
                            waiverId: waiver.id,
                            declined: true,
                        };
                    }
                    const decision = {
                        waiverId: waiver.id,
                        declined: false,
                        signerName: sig.signerName?.trim() || '',
                        signatureMethod: sig.signatureMethod || 'draw',
                        consentToESign: true,
                    };
                    if (decision.signatureMethod === 'draw') {
                        decision.signatureData = sig.signatureData;
                    }
                    return decision;
                });
            }

            const { data: created, error: insertError } = await supabase.functions.invoke(
                'submit-registration',
                {
                    body: {
                        turnstileToken: token,
                        eventId,
                        orgId,
                        formData: cleanFormData,
                        paymentMethod: event.payment_enabled ? paymentMethod : null,
                        signatureRecords,
                        submissionAttemptId: submissionAttemptId.current,
                        recentDuplicateOverride,
                    },
                }
            );

            if (insertError) {
                const errorCode = await getRegistrationSubmissionErrorCode(insertError);
                if (errorCode === RECENT_REGISTRATION_ERROR) {
                    setTurnstileToken(null);
                    setRecentWarningOpen(true);
                    return;
                }
                throw insertError;
            }
            if (!created) throw new Error('Registration was created without a returned record.');

            setCreatedRegistration(created);
            const requiresTithelyPayment =
                created.status === 'confirmed'
                && created.payment_method === 'tithely';
            setPhase(requiresTithelyPayment ? 'payment' : 'success');
        } catch (err) {
            console.error('Error submitting registration:', err);
            setTurnstileToken(null);
            if (turnstileWidgetId.current !== null) {
                window.turnstile?.reset(turnstileWidgetId.current);
            }
            setErrors({ _form: 'Failed to submit registration. Please try again.' });
        } finally {
            setSubmitting(false);
        }
    }

    performSubmissionRef.current = performSubmission;

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
        if (!TURNSTILE_SITE_KEY || !turnstileToken) {
            setErrors((prev) => ({
                ...prev,
                _form: TURNSTILE_SITE_KEY
                    ? 'Please complete the CAPTCHA challenge.'
                    : 'Security verification is unavailable. Please try again later.',
            }));
            return;
        }

        await performSubmission(turnstileToken, false);
    };

    const handleReset = () => {
        setFormData({});
        setErrors({});
        setPhase('form');
        setCreatedRegistration(null);
        setCurrentPage(0);
        setSignaturesMap({});
        setSignaturesErrors({});
        setTurnstileToken(null);
        submissionAttemptId.current = crypto.randomUUID();
        pendingRecentOverride.current = false;
        setRecentWarningOpen(false);
        if (turnstileWidgetId.current !== null) {
            window.turnstile?.reset(turnstileWidgetId.current);
        }
        setPaymentMethod(availablePaymentMethods.length === 1 ? availablePaymentMethods[0] : '');
    };

    const handleRecentReturn = () => {
        setRecentWarningOpen(false);
        pendingRecentOverride.current = false;
        setTurnstileToken(null);
        if (turnstileWidgetId.current !== null) {
            window.turnstile?.reset(turnstileWidgetId.current);
        }
    };

    const handleRecentContinue = () => {
        setRecentWarningOpen(false);
        pendingRecentOverride.current = true;
        setErrors({});
        setTurnstileToken(null);
        setSubmitting(true);
        turnstileRef.current?.focus();

        const resetTurnstile = window.turnstile?.reset;
        if (turnstileWidgetId.current === null || typeof resetTurnstile !== 'function') {
            pendingRecentOverride.current = false;
            setSubmitting(false);
            setErrors({ _form: 'Security verification is unavailable. Please try again later.' });
            return;
        }

        resetTurnstile(turnstileWidgetId.current);
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

    if (phase === 'payment') {
        return <RegistrationPaymentStep event={event} registration={createdRegistration} />;
    }

    // Success state
    if (phase === 'success') {
        return (
            <SuccessState
                event={event}
                registration={createdRegistration}
                isWaitlisted={createdRegistration?.status === 'waitlisted'}
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
                submitLabel={paymentMethod === 'tithely'
                    ? 'Submit Registration & Continue to Tithe.ly'
                    : 'Submit Registration'}
                beforeFields={
                    isFull && event.waitlist_enabled
                        ? <WaitlistNotice waitlistCount={event.waitlist_count || 0} />
                        : null
                }
                waiverSlot={
                    Array.isArray(event.waivers) && event.waivers.length > 0
                        ? (
                            <div className="space-y-6">
                                {event.waivers
                                    .slice()
                                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                                    .map((waiver) => (
                                        <WaiverSignatureStep
                                            key={waiver.id}
                                            waiver={waiver}
                                            value={signaturesMap[waiver.id] || {}}
                                            onChange={(data) => {
                                                setSignaturesMap((prev) => ({ ...prev, [waiver.id]: data }));
                                                setSignaturesErrors((prev) => { const next = { ...prev }; delete next[waiver.id]; return next; });
                                            }}
                                            errors={signaturesErrors[waiver.id] || {}}
                                        />
                                    ))}
                            </div>
                        )
                        : null
                }
                paymentSlot={
                    <PaymentMethodChoice
                        methods={availablePaymentMethods}
                        value={paymentMethod}
                        onChange={(method) => {
                            setPaymentMethod(method);
                            setErrors((prev) => {
                                if (!prev._payment_method) return prev;
                                const next = { ...prev };
                                delete next._payment_method;
                                return next;
                            });
                        }}
                        error={errors._payment_method}
                    />
                }
                captchaSlot={
                    TURNSTILE_SITE_KEY && currentPage === pages.length - 1
                        ? (
                            <div className="mt-4">
                                <div
                                    ref={turnstileRef}
                                    tabIndex="-1"
                                    aria-label="Security verification"
                                />
                                {errors._form && (
                                    <p role="alert" className="text-xs text-danger mt-2">{errors._form}</p>
                                )}
                            </div>
                        )
                        : null
                }
            />
            {recentWarningOpen && (
                <RecentRegistrationDialog
                    eventType={event.event_type}
                    onReturn={handleRecentReturn}
                    onContinue={handleRecentContinue}
                />
            )}
        </div>
    );
}
