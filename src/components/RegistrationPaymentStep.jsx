import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import Button from './ui/Button';
import Card from './ui/Card';
import PaymentSection from './PaymentSection';

const IN_PERSON_ERROR = 'Unable to record payment choice. Please try again.';
const ONLINE_ERROR = 'Payment was not completed. Your registration remains payment pending.';

export default function RegistrationPaymentStep({ event, registration, onComplete }) {
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const handlePaymentComplete = (result) => {
        if (!result?.success) {
            setError(ONLINE_ERROR);
            return;
        }

        setError('');
        onComplete?.({
            ...registration,
            payment_status: 'paid',
            payment_method: 'paypal',
        });
    };

    const handleInPersonPayment = async () => {
        setSaving(true);
        setError('');

        try {
            const { error: rpcError } = await supabase.rpc('update_payment_status', {
                p_registration_id: registration.id,
                p_payment_status: 'pending',
                p_payment_method: 'in_person',
                p_payment_details: {},
            });

            if (rpcError) {
                setSaving(false);
                setError(IN_PERSON_ERROR);
                return;
            }

            setSaving(false);
            onComplete?.({
                ...registration,
                payment_status: 'pending',
                payment_method: 'in_person',
            });
        } catch {
            setSaving(false);
            setError(IN_PERSON_ERROR);
        }
    };

    return (
        <div className="max-w-lg mx-auto space-y-4">
            <PaymentSection
                registrationId={registration.id}
                amount={Number(event.payment_amount)}
                onPaymentComplete={handlePaymentComplete}
            />

            {event.allow_in_person_payment && (
                <Card className="p-5">
                    <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
                        Pay in Person
                    </h3>
                    <p className="text-sm text-slate-500 mb-4">
                        Record your choice now and pay when you arrive.
                    </p>
                    <Button loading={saving} onClick={handleInPersonPayment}>
                        Pay in Person
                    </Button>
                </Card>
            )}

            {error && (
                <p role="alert" className="text-sm text-red-600">
                    {error}
                </p>
            )}
        </div>
    );
}
