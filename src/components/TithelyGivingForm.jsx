import React from 'react';
import Card from './ui/Card';
import TithelyFallbackButton from './TithelyFallbackButton';
import { validateStoredTithelyConfiguration } from '../utils/tithelyEmbed';

export default function TithelyGivingForm({ event }) {
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
        <div className="mx-auto max-w-2xl space-y-4">
            <Card className="space-y-5 p-5">
                <header>
                    <p className="text-sm font-medium text-primary">{event.title}</p>
                    <h2 className="mt-1 text-xl font-semibold text-slate-900">
                        Complete your payment with Tithe.ly
                    </h2>
                    <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                        Registration received — payment pending
                    </p>
                    {amount > 0 && (
                        <p className="mt-3 text-sm text-slate-600">
                            Amount due: ${amount.toFixed(2)}
                        </p>
                    )}
                    <p className="mt-2 text-sm text-slate-600">
                        Your registration remains pending until an administrator records the payment.
                    </p>
                </header>

                <iframe
                    src={configuration.givingUrl}
                    title={`Tithe.ly giving form for ${event.title}`}
                    className="min-h-[800px] w-full border-0"
                />

                <div className="space-y-3 border-t border-slate-200 pt-4">
                    <p className="text-sm text-slate-600">
                        If the embedded form does not load, use the Tithe.ly button:
                    </p>
                    <TithelyFallbackButton embedConfig={configuration.embedConfig} />
                    <p className="text-sm text-slate-600">
                        If the button does not open,{' '}
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
                </div>
            </Card>
        </div>
    );
}
