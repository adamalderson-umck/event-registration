import React from 'react';
import Button from './ui/Button';
import Card from './ui/Card';
import { validateStoredTithelyConfiguration } from '../utils/tithelyEmbed';

export default function TithelyGivingForm({ event, onFinished }) {
    const configuration = validateStoredTithelyConfiguration(event);

    if (!configuration.valid) {
        return (
            <Card className="max-w-2xl mx-auto p-6">
                <p role="alert" className="text-sm text-danger">
                    Tithe.ly payment is unavailable for this event. {configuration.error}
                </p>
            </Card>
        );
    }

    const amount = Number(event?.payment_amount);

    return (
        <div className="max-w-2xl mx-auto space-y-4">
            <Card className="p-5 space-y-4">
                <div>
                    <h2 className="text-lg font-semibold text-slate-900">Complete your payment with Tithe.ly</h2>
                    {amount > 0 && (
                        <p className="mt-1 text-sm text-slate-600">
                            Amount due: ${amount.toFixed(2)}
                        </p>
                    )}
                    <p className="mt-2 text-sm text-slate-600">
                        Your registration will remain payment pending until an administrator verifies your payment.
                    </p>
                </div>

                <iframe
                    src={configuration.givingUrl}
                    title={`Tithe.ly giving form for ${event.title}`}
                    className="min-h-[800px] w-full border-0"
                />

                <p className="text-sm text-slate-600">
                    If the form does not load,{' '}
                    <a
                        href={configuration.givingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary underline"
                    >
                        Open Tithe.ly in a new tab
                    </a>
                    .
                </p>
            </Card>

            <div className="flex justify-end">
                <Button onClick={onFinished}>I've finished with Tithe.ly</Button>
            </div>
        </div>
    );
}
