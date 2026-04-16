import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { XCircle, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import Button from './ui/Button';
import Card from './ui/Card';

/**
 * CancelRegistration handles self-service cancellation via HMAC token.
 * URL format: /?cancel=true&token=<hmac-token>
 *
 * The token encodes: orgId, registrationId, and a signature.
 * Token format (base64): orgId:registrationId:hmacSignature
 */
export default function CancelRegistration({ token }) {
    const [state, setState] = useState('loading'); // loading, confirm, success, error, already-cancelled
    const [eventTitle, setEventTitle] = useState('');
    const [error, setError] = useState('');
    const [cancelling, setCancelling] = useState(false);

    useEffect(() => {
        const decodeAndFetch = async () => {
            try {
                // We no longer query the database locally to protect PII.
                // Instead, we hit our secure Edge Function proxy with 'dry_run: true' 
                // to validate the HMAC token and check the status using elevated backend keys.
                const { data, error: fnErr } = await supabase.functions.invoke('verify-cancel-token', {
                    body: { token, dry_run: true },
                });

                if (fnErr) throw fnErr;
                if (data?.error) {
                    if (data.error === 'Registration not found') {
                        setState('error');
                        setError('Registration not found');
                        return;
                    }
                    throw new Error(data.error);
                }

                if (data?.status === 'cancelled') {
                    setState('already-cancelled');
                    return;
                }

                if (data?.eventTitle) {
                    setEventTitle(data.eventTitle);
                }

                setState('confirm');
            } catch (err) {
                console.error('Cancel page error:', err);
                setState('error');
                setError('Invalid or expired cancellation link');
            }
        };

        if (token) decodeAndFetch();
        else {
            setState('error');
            setError('No cancellation token provided');
        }
    }, [token]);

    const handleCancel = async () => {
        setCancelling(true);
        try {
            const { data, error: fnErr } = await supabase.functions.invoke('verify-cancel-token', {
                body: { token },
            });

            if (fnErr) throw fnErr;
            if (data?.error) throw new Error(data.error);

            setState('success');
        } catch (err) {
            console.error('Cancellation error:', err);
            setError(err.message || 'Failed to cancel registration. Please try again.');
        } finally {
            setCancelling(false);
        }
    };

    if (state === 'loading') {
        return (
            <div className="flex justify-center items-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    if (state === 'error') {
        return (
            <Card className="max-w-lg mx-auto p-8 text-center">
                <div className="inline-flex bg-red-50 p-4 rounded-full mb-6">
                    <AlertTriangle className="w-12 h-12 text-danger" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Something went wrong</h2>
                <p className="text-slate-500">{error}</p>
            </Card>
        );
    }

    if (state === 'already-cancelled') {
        return (
            <Card className="max-w-lg mx-auto p-8 text-center">
                <div className="inline-flex bg-slate-100 p-4 rounded-full mb-6">
                    <XCircle className="w-12 h-12 text-slate-400" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Already Cancelled</h2>
                <p className="text-slate-500">This registration has already been cancelled.</p>
            </Card>
        );
    }

    if (state === 'success') {
        return (
            <Card className="max-w-lg mx-auto p-8 text-center">
                <div className="inline-flex bg-green-50 p-4 rounded-full mb-6">
                    <CheckCircle2 className="w-12 h-12 text-success" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Registration Cancelled</h2>
                <p className="text-slate-500">
                    Your registration for "{eventTitle}" has been successfully cancelled.
                </p>
                <p className="text-sm text-slate-400 mt-2">
                    A confirmation email will be sent shortly.
                </p>
            </Card>
        );
    }

    // Confirm state
    return (
        <Card className="max-w-lg mx-auto p-8 text-center">
            <div className="inline-flex bg-amber-50 p-4 rounded-full mb-6">
                <AlertTriangle className="w-12 h-12 text-amber-500" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Cancel Registration?</h2>
            <p className="text-slate-500 mb-6">
                Are you sure you want to cancel your registration for "{eventTitle}"?
                This action cannot be undone.
            </p>

            <div className="flex gap-3 justify-center">
                <Button variant="secondary" onClick={() => window.close()}>
                    Keep Registration
                </Button>
                <Button variant="danger" onClick={handleCancel} loading={cancelling}>
                    <XCircle className="w-4 h-4" />
                    Cancel Registration
                </Button>
            </div>
        </Card>
    );
}
