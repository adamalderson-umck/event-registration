import React from 'react';
import Button from './ui/Button';
import Card from './ui/Card';
import TithelyGivingForm from './TithelyGivingForm';

export default function RegistrationPaymentStep({ event, registration, onComplete }) {
    if (registration?.payment_method === 'in_person') {
        return (
            <Card className="max-w-lg mx-auto p-6 space-y-4">
                <div>
                    <h2 className="text-lg font-semibold text-slate-900">Pay in Person</h2>
                    <p className="mt-2 text-sm text-slate-600">
                        Your registration will remain payment pending until an administrator verifies your payment.
                    </p>
                </div>
                <Button onClick={() => onComplete?.(registration)}>Continue</Button>
            </Card>
        );
    }

    return (
        <TithelyGivingForm
            event={event}
            onFinished={() => onComplete?.(registration)}
        />
    );
}
