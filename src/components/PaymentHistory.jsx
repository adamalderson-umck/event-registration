import React, { useEffect, useRef, useState } from 'react';
import Button from './ui/Button';
import Card from './ui/Card';
import Input from './ui/Input';
import Label from './ui/Label';
import { formatCurrency } from '../utils/paymentStatus';

function getFocusableElements(container) {
    return Array.from(container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element instanceof HTMLElement && element.getAttribute('aria-hidden') !== 'true');
}

function formatDate(value, options) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Unknown date';
    }

    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(date);
}

function formatPaymentDate(paymentDate) {
    return formatDate(`${paymentDate}T00:00:00Z`, { dateStyle: 'medium' });
}

function formatRecordedAt(createdAt) {
    return formatDate(createdAt, { dateStyle: 'medium', timeStyle: 'short' });
}

function getPaymentMethodDescription(payment) {
    if (payment.method === 'cash') {
        return 'Cash';
    }

    const method = payment.method === 'tithely' ? 'Tithe.ly' : 'Check';
    return `${method} #${payment.reference_number}`;
}

function getRecordedBy(payment) {
    const recordedBy = payment.created_by_name || payment.created_by_email || payment.created_by;
    return typeof recordedBy === 'string' && recordedBy.trim() ? recordedBy : 'Unknown administrator';
}

function sortPayments(payments) {
    return [...payments].sort((left, right) => {
        const paymentDateDifference = Date.parse(right.payment_date) - Date.parse(left.payment_date);

        if (paymentDateDifference !== 0) {
            return paymentDateDifference;
        }

        return Date.parse(right.created_at) - Date.parse(left.created_at);
    });
}

export default function PaymentHistory({
    payments = [],
    onVoid,
    voidingPaymentId = null,
    error = '',
}) {
    const [voidTarget, setVoidTarget] = useState(null);
    const [voidReason, setVoidReason] = useState('');
    const [reasonError, setReasonError] = useState('');
    const reasonInputRef = useRef(null);
    const sortedPayments = sortPayments(payments);
    const isVoiding = voidTarget?.id === voidingPaymentId;

    useEffect(() => {
        if (!voidTarget) {
            return undefined;
        }

        const previouslyFocusedElement = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        reasonInputRef.current?.focus();

        return () => {
            if (previouslyFocusedElement?.isConnected) {
                previouslyFocusedElement.focus();
            }
        };
    }, [voidTarget]);

    function openVoidDialog(payment) {
        setVoidTarget(payment);
        setVoidReason('');
        setReasonError('');
    }

    function closeVoidDialog() {
        if (isVoiding) {
            return;
        }

        setVoidTarget(null);
        setVoidReason('');
        setReasonError('');
    }

    async function confirmVoid() {
        const trimmedReason = voidReason.trim();

        if (!trimmedReason) {
            setReasonError('Enter a reason for voiding this payment.');
            return;
        }

        try {
            await onVoid(voidTarget, trimmedReason);
            setVoidTarget(null);
            setVoidReason('');
            setReasonError('');
        } catch {
            // The owner supplies the visible server error through the error prop.
        }
    }

    function handleDialogKeyDown(event) {
        if (event.key === 'Escape') {
            closeVoidDialog();
            return;
        }

        if (event.key !== 'Tab') {
            return;
        }

        const focusableElements = getFocusableElements(event.currentTarget);
        const firstFocusableElement = focusableElements[0];
        const lastFocusableElement = focusableElements.at(-1);

        if (!firstFocusableElement || !lastFocusableElement) {
            return;
        }

        if (event.shiftKey && document.activeElement === firstFocusableElement) {
            event.preventDefault();
            lastFocusableElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastFocusableElement) {
            event.preventDefault();
            firstFocusableElement.focus();
        }
    }

    return (
        <section aria-labelledby="payment-history-title">
            <h3 id="payment-history-title" className="text-lg font-semibold text-slate-900">Payment history</h3>

            {sortedPayments.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">No payments have been recorded.</p>
            ) : (
                <ul className="mt-3 space-y-3">
                    {sortedPayments.map((payment) => {
                        const isVoided = Boolean(payment.voided_at);

                        return (
                            <li
                                key={payment.id}
                                className={`rounded-lg border p-4 ${isVoided ? 'border-slate-300 bg-slate-50 text-slate-600 line-through decoration-slate-400' : 'border-slate-200 bg-white text-slate-900'}`}
                            >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="font-semibold">{formatCurrency(payment.amount)}</p>
                                        <p className="text-sm">{getPaymentMethodDescription(payment)}</p>
                                        <p className="mt-1 text-sm">Payment date: {formatPaymentDate(payment.payment_date)}</p>
                                        <p className="mt-1 text-sm">Recorded {formatRecordedAt(payment.created_at)} by {getRecordedBy(payment)}</p>
                                        {isVoided && <p className="mt-2 text-sm font-medium">Voided: {payment.void_reason}</p>}
                                    </div>
                                    {!isVoided && (
                                        <Button
                                            type="button"
                                            variant="danger"
                                            size="sm"
                                            onClick={() => openVoidDialog(payment)}
                                            disabled={Boolean(voidingPaymentId)}
                                        >
                                            Void Payment
                                        </Button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {voidTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
                    <Card
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="void-payment-dialog-title"
                        className="w-full max-w-lg p-6"
                        onKeyDown={handleDialogKeyDown}
                    >
                        <h2 id="void-payment-dialog-title" className="text-xl font-bold text-slate-900">Void payment</h2>
                        <p className="mt-2 text-sm text-slate-600">This will preserve the payment in the audit history and remove it from the active payment total.</p>

                        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
                        {reasonError && <p id="void-payment-reason-error" role="alert" className="mt-4 text-sm text-danger">{reasonError}</p>}

                        <div className="mt-4">
                            <Label htmlFor="void-payment-reason" required>Void reason</Label>
                            <Input
                                ref={reasonInputRef}
                                id="void-payment-reason"
                                value={voidReason}
                                onChange={(event) => {
                                    setVoidReason(event.target.value);
                                    setReasonError('');
                                }}
                                aria-invalid={reasonError ? 'true' : undefined}
                                aria-describedby={reasonError ? 'void-payment-reason-error' : undefined}
                            />
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <Button type="button" variant="secondary" onClick={closeVoidDialog} disabled={isVoiding}>Cancel</Button>
                            <Button type="button" variant="danger" onClick={confirmVoid} loading={isVoiding}>Confirm Void</Button>
                        </div>
                    </Card>
                </div>
            )}
        </section>
    );
}
