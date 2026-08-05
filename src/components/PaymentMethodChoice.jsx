import React from 'react';

const PAYMENT_METHOD_LABELS = {
    tithely: 'Tithe.ly',
    in_person: 'Pay in Person',
};
const ERROR_ID = 'payment-method-error';

export default function PaymentMethodChoice({
    methods = [],
    value = '',
    onChange,
    error,
}) {
    const availableMethods = methods.filter((method) => PAYMENT_METHOD_LABELS[method]);

    if (availableMethods.length === 0) {
        return error ? <p id={ERROR_ID} role="alert" className="text-sm text-danger">{error}</p> : null;
    }

    if (availableMethods.length === 1) {
        const method = availableMethods[0];
        const label = PAYMENT_METHOD_LABELS[method];

        return (
            <section aria-labelledby="payment-method-summary" className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 id="payment-method-summary" className="text-sm font-semibold text-slate-800">Payment Method</h3>
                <p className="mt-1 text-sm text-slate-600">
                    <span className="font-medium text-slate-800">Payment method: {label}.</span>{' '}
                    {method === 'tithely'
                        ? `Payment will be completed through ${label} after you submit your registration.`
                        : 'Please pay in person after you submit your registration.'}
                </p>
            </section>
        );
    }

    return (
        <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-800">Payment Method</legend>
            <div className="mt-2 space-y-3">
                {availableMethods.map((method) => (
                    <label key={method} className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
                        <input
                            type="radio"
                            name="payment_method"
                            value={method}
                            checked={value === method}
                            onChange={(event) => onChange?.(event.target.value)}
                            aria-invalid={error ? 'true' : undefined}
                            aria-describedby={error ? ERROR_ID : undefined}
                            className="mt-0.5 h-4 w-4 border-slate-300 text-primary focus:ring-primary"
                        />
                        <span>
                            <span className="font-medium text-slate-800">{PAYMENT_METHOD_LABELS[method]}</span>
                            <span className="mt-0.5 block text-slate-600">
                                {method === 'tithely'
                                    ? 'Give securely through the Tithe.ly form after registration.'
                                    : 'Register now and pay when you arrive.'}
                            </span>
                        </span>
                    </label>
                ))}
            </div>
            {error && <p id={ERROR_ID} role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </fieldset>
    );
}
