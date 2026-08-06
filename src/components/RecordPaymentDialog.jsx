import React, { useState } from 'react';
import Button from './ui/Button';
import Card from './ui/Card';
import Input from './ui/Input';
import Label from './ui/Label';
import Select from './ui/Select';
import { formatCurrency, getPaymentRemainingAmount } from '../utils/paymentStatus';

function getLocalToday() {
    const now = new Date();
    const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60_000));
    return local.toISOString().slice(0, 10);
}

function getTodayValue(today) {
    if (today instanceof Date) {
        const local = new Date(today.getTime() - (today.getTimezoneOffset() * 60_000));
        return local.toISOString().slice(0, 10);
    }

    return today || getLocalToday();
}

function FieldError({ id, message }) {
    if (!message) {
        return null;
    }

    return <p id={id} role="alert" className="mt-1 text-sm text-danger">{message}</p>;
}

export default function RecordPaymentDialog({
    registration,
    onSubmit,
    onClose,
    submitting = false,
    error = '',
    today,
}) {
    const todayValue = getTodayValue(today);
    const [method, setMethod] = useState('cash');
    const [amount, setAmount] = useState('');
    const [paymentDate, setPaymentDate] = useState(todayValue);
    const [referenceNumber, setReferenceNumber] = useState('');
    const [fieldErrors, setFieldErrors] = useState({});
    const remaining = getPaymentRemainingAmount(registration);
    const expectedAmount = registration?.payment_expected_amount;
    const referenceLabel = method === 'check' ? 'Check number' : 'Transaction number';

    function clearFieldError(field) {
        setFieldErrors((current) => {
            if (!current[field]) {
                return current;
            }

            const next = { ...current };
            delete next[field];
            return next;
        });
    }

    function handleMethodChange(event) {
        setMethod(event.target.value);
        setReferenceNumber('');
        setFieldErrors({});
    }

    function handleSubmit(event) {
        event.preventDefault();

        const numericAmount = Number(amount);
        const nextErrors = {};

        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            nextErrors.amount = 'Enter an amount greater than zero.';
        }

        if (!paymentDate) {
            nextErrors.paymentDate = 'Enter the payment date.';
        } else if (paymentDate > todayValue) {
            nextErrors.paymentDate = 'Payment date cannot be in the future.';
        }

        if (method === 'check' && !referenceNumber.trim()) {
            nextErrors.referenceNumber = 'Enter the check number.';
        }

        if (method === 'tithely' && !referenceNumber.trim()) {
            nextErrors.referenceNumber = 'Enter the Tithe.ly transaction number.';
        }

        if (Object.keys(nextErrors).length > 0) {
            setFieldErrors(nextErrors);
            return;
        }

        setFieldErrors({});
        onSubmit({
            method,
            amount: numericAmount,
            paymentDate,
            referenceNumber: method === 'cash' ? null : referenceNumber.trim(),
        });
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <Card
                role="dialog"
                aria-modal="true"
                aria-labelledby="record-payment-dialog-title"
                className="w-full max-w-lg p-6"
            >
                <div className="mb-5">
                    <h2 id="record-payment-dialog-title" className="text-xl font-bold text-slate-900">Record payment</h2>
                    <div className="mt-3 space-y-1 text-sm text-slate-600">
                        <p>Recorded: {formatCurrency(registration?.payment_recorded_total)}</p>
                        {expectedAmount != null && <p>Expected: {formatCurrency(expectedAmount)}</p>}
                        {remaining != null && <p>Remaining: {formatCurrency(remaining)}</p>}
                    </div>
                </div>

                {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}

                <form noValidate onSubmit={handleSubmit}>
                    <div className="space-y-4">
                        <div>
                            <Label htmlFor="record-payment-method">Payment method</Label>
                            <Select
                                id="record-payment-method"
                                value={method}
                                onChange={handleMethodChange}
                                options={[
                                    { value: 'cash', label: 'Cash' },
                                    { value: 'check', label: 'Check' },
                                    { value: 'tithely', label: 'Tithe.ly' },
                                ]}
                            />
                        </div>

                        <div>
                            <Label htmlFor="record-payment-amount" required>Amount</Label>
                            <Input
                                id="record-payment-amount"
                                name="amount"
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                value={amount}
                                onChange={(event) => {
                                    setAmount(event.target.value);
                                    clearFieldError('amount');
                                }}
                                error={fieldErrors.amount}
                                aria-invalid={fieldErrors.amount ? 'true' : undefined}
                                aria-describedby={fieldErrors.amount ? 'record-payment-amount-error' : undefined}
                            />
                            <FieldError id="record-payment-amount-error" message={fieldErrors.amount} />
                        </div>

                        <div>
                            <Label htmlFor="record-payment-date" required>Payment date</Label>
                            <Input
                                id="record-payment-date"
                                name="paymentDate"
                                type="date"
                                value={paymentDate}
                                onChange={(event) => {
                                    setPaymentDate(event.target.value);
                                    clearFieldError('paymentDate');
                                }}
                                error={fieldErrors.paymentDate}
                                aria-invalid={fieldErrors.paymentDate ? 'true' : undefined}
                                aria-describedby={fieldErrors.paymentDate ? 'record-payment-date-error' : undefined}
                            />
                            <FieldError id="record-payment-date-error" message={fieldErrors.paymentDate} />
                        </div>

                        {method !== 'cash' && (
                            <div>
                                <Label htmlFor="record-payment-reference" required>{referenceLabel}</Label>
                                <Input
                                    id="record-payment-reference"
                                    name="referenceNumber"
                                    value={referenceNumber}
                                    onChange={(event) => {
                                        setReferenceNumber(event.target.value);
                                        clearFieldError('referenceNumber');
                                    }}
                                    error={fieldErrors.referenceNumber}
                                    aria-invalid={fieldErrors.referenceNumber ? 'true' : undefined}
                                    aria-describedby={fieldErrors.referenceNumber ? 'record-payment-reference-error' : undefined}
                                />
                                <FieldError id="record-payment-reference-error" message={fieldErrors.referenceNumber} />
                            </div>
                        )}
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                        <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
                        <Button type="submit" loading={submitting}>Record payment</Button>
                    </div>
                </form>
            </Card>
        </div>
    );
}
