import React, { useState, useEffect } from 'react';
import { doc, getDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../services/firebase';
import { Loader2, Send, CalendarDays, MapPin, Users } from 'lucide-react';
import DynamicField from './DynamicField';
import SuccessState from './SuccessState';
import WaitlistNotice from './WaitlistNotice';
import WaiverSignatureStep from './WaiverSignatureStep';
import Button from './ui/Button';
import Card from './ui/Card';

export default function EventRegistrationForm({ eventId, orgId }) {
    const [event, setEvent] = useState(null);
    const [formData, setFormData] = useState({});
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [isWaitlisted, setIsWaitlisted] = useState(false);
    const [fetchError, setFetchError] = useState('');
    const [waiverData, setWaiverData] = useState({
        consentToESign: false,
        signerName: '',
        signatureMethod: 'draw',
        signatureData: null,
        signatureFont: null,
    });
    const [waiverErrors, setWaiverErrors] = useState({});

    // Fetch event data
    useEffect(() => {
        const fetchEvent = async () => {
            try {
                const eventRef = doc(db, 'organizations', orgId, 'events', eventId);
                const eventSnap = await getDoc(eventRef);

                if (!eventSnap.exists()) {
                    setFetchError('Event not found');
                    setLoading(false);
                    return;
                }

                const eventData = { id: eventSnap.id, ...eventSnap.data() };

                if (eventData.status !== 'active') {
                    setFetchError('This event is no longer accepting registrations');
                    setLoading(false);
                    return;
                }

                setEvent(eventData);
            } catch (err) {
                console.error('Error fetching event:', err);
                setFetchError('Failed to load event');
            } finally {
                setLoading(false);
            }
        };

        if (eventId && orgId) fetchEvent();
    }, [eventId, orgId]);

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
        const emailField = (fields || []).find((f) => f.type === 'email');
        return emailField ? data[emailField.id] || '' : '';
    };

    const validate = () => {
        const newErrors = {};
        const fields = event?.formFields || [];

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
        }

        // Waiver validation (only when waiver is enabled)
        const newWaiverErrors = {};
        if (event?.waiverEnabled) {
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
        setWaiverErrors(newWaiverErrors);

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;

        setSubmitting(true);

        try {
            const registrationData = {
                eventId,
                formData,
                status: 'pending', // Cloud Function will set to confirmed/waitlisted
                paymentStatus: event.paymentEnabled ? 'pending' : 'not_required',
                paymentMethod: null,
                createdAt: serverTimestamp(),
            };

            // Add signature record if waiver is enabled
            if (event.waiverEnabled) {
                let ipAddress = 'unknown';
                try {
                    const getIp = httpsCallable(functions, 'captureSignerIp');
                    const ipResult = await getIp();
                    ipAddress = ipResult.data.ip;
                } catch (err) {
                    console.warn('Could not capture IP:', err);
                }

                registrationData.signatureRecord = {
                    signed: true,
                    signedAt: serverTimestamp(),
                    signerName: waiverData.signerName.trim(),
                    signerEmail: findRegistrantEmail(event.formFields, formData),
                    signatureMethod: waiverData.signatureMethod,
                    signatureData: waiverData.signatureMethod === 'draw'
                        ? waiverData.signatureData
                        : null,
                    signatureFont: waiverData.signatureMethod === 'type'
                        ? waiverData.signatureFont
                        : null,
                    waiverTitle: event.waiverTitle || '',
                    waiverContentHash: event.waiverContentHash || '',
                    ipAddress,
                    userAgent: navigator.userAgent,
                    consentToESign: true,
                };
            }

            await addDoc(
                collection(db, 'organizations', orgId, 'registrations'),
                registrationData
            );

            // Determine if waitlisted for UI display
            const isFull = event.capacity && event.registrationCount >= event.capacity;
            setIsWaitlisted(isFull && event.waitlistEnabled);
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
                eventTitle={event?.title}
                isWaitlisted={isWaitlisted}
                onReset={handleReset}
            />
        );
    }

    const isFull = event.capacity && event.registrationCount >= event.capacity;
    const isClosed = isFull && !event.waitlistEnabled;
    const spotsLeft = event.capacity ? event.capacity - (event.registrationCount || 0) : null;

    return (
        <Card className="max-w-2xl mx-auto overflow-hidden">
            {/* Event Header */}
            <div className="bg-gradient-to-r from-primary to-accent px-6 py-8 text-white">
                <h1 className="text-2xl font-bold mb-2">{event.title}</h1>
                {event.description && (
                    <p className="text-white/80 text-sm mb-4">{event.description}</p>
                )}
                <div className="flex flex-wrap gap-4 text-sm text-white/70">
                    {event.startDate && (
                        <span className="flex items-center gap-1">
                            <CalendarDays className="w-4 h-4" />
                            {new Date(event.startDate).toLocaleDateString('en-US', {
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

            {/* Form Content */}
            <div className="p-6">
                {isClosed ? (
                    <div className="text-center py-8">
                        <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                        <p className="text-lg font-semibold text-slate-700">Registration is Full</p>
                        <p className="text-slate-500 text-sm mt-1">This event has reached capacity and is no longer accepting registrations.</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {isFull && event.waitlistEnabled && (
                            <WaitlistNotice waitlistCount={event.waitlistCount || 0} />
                        )}

                        {(event.formFields || []).map((field) => (
                            <DynamicField
                                key={field.id}
                                field={field}
                                value={formData[field.id]}
                                onChange={handleFieldChange}
                                error={errors[field.id]}
                            />
                        ))}

                        {errors._form && (
                            <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                {errors._form}
                            </p>
                        )}

                        {/* Payment section placeholder */}

                        {event.waiverEnabled && (
                            <WaiverSignatureStep
                                waiver={event}
                                value={waiverData}
                                onChange={(data) => {
                                    setWaiverData(data);
                                    setWaiverErrors({});
                                }}
                                errors={waiverErrors}
                            />
                        )}

                        <Button
                            type="submit"
                            loading={submitting}
                            className="w-full"
                            size="lg"
                        >
                            <Send className="w-4 h-4" />
                            {isFull && event.waitlistEnabled ? 'Join Waitlist' : 'Submit Registration'}
                        </Button>
                    </form>
                )}
            </div>
        </Card>
    );
}
