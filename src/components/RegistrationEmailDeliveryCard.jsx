import React, { forwardRef, useState } from 'react';
import Button from './ui/Button';
import Card from './ui/Card';

const kindLabels = {
    registration_confirmation: 'Registration confirmation',
    registration_waitlist: 'Waitlist confirmation',
    waitlist_promotion: 'Waitlist promotion',
    registration_cancellation: 'Cancellation confirmation',
};

const failureMessages = {
    smtp_send_failed: 'The outgoing mail server did not complete the delivery.',
    smtp_not_configured: 'Outgoing mail settings are unavailable.',
    cancel_token_not_configured: 'The cancellation-link signing configuration is unavailable.',
    base_url_not_configured: 'The event-site cancellation-link configuration is unavailable.',
    message_configuration_missing: 'The event email message configuration is incomplete.',
};

const formatTimestamp = (value) => value ? new Date(value).toLocaleString() : '';

const RegistrationEmailDeliveryCard = forwardRef(function RegistrationEmailDeliveryCard({
    status,
    retrying = false,
    error = '',
    onRetry,
}, ref) {
    const [confirming, setConfirming] = useState(false);
    const hasDelivery = Boolean(status?.delivery_id);
    const exhausted = hasDelivery && status.exhausted === true;
    let stateLabel = '';
    let timestampLabel = '';
    let timestamp = '';

    if (hasDelivery && status.state === 'sent') {
        stateLabel = 'Sent';
        timestampLabel = 'Sent at';
        timestamp = formatTimestamp(status.sent_at);
    } else if (hasDelivery && status.state === 'pending') {
        stateLabel = 'Sending';
    } else if (hasDelivery && status.state === 'failed' && exhausted) {
        stateLabel = 'Failed - intervention required';
    } else if (hasDelivery && status.state === 'failed') {
        stateLabel = 'Retry scheduled';
        timestampLabel = 'Next retry';
        timestamp = formatTimestamp(status.next_retry_at);
    }

    return (
        <Card ref={ref} tabIndex={-1} className="p-6 focus:outline-none focus:ring-2 focus:ring-primary/40">
            <h3 className="text-lg font-semibold text-slate-900">Email Delivery</h3>
            {!hasDelivery ? (
                <p className="mt-3 text-sm text-slate-600">No delivery record</p>
            ) : (
                <div className="mt-3 space-y-3 text-sm text-slate-700">
                    <div>
                        <p className="font-medium text-slate-900">
                            {kindLabels[status.kind] || 'Registration email'}
                        </p>
                        <p>{stateLabel}</p>
                    </div>
                    {timestamp && (
                        <p>
                            <span className="font-medium">{timestampLabel}:</span>{' '}
                            {timestamp}
                        </p>
                    )}
                    {status.state === 'failed' && (
                        <p>
                            {failureMessages[status.last_error_code]
                                || 'The email could not be delivered.'}
                        </p>
                    )}
                    {exhausted && !confirming && (
                        <Button type="button" size="sm" onClick={() => setConfirming(true)}>
                            Retry email now
                        </Button>
                    )}
                    {exhausted && confirming && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <p className="font-medium text-amber-900">
                                Send this registration email again?
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    loading={retrying}
                                    onClick={() => onRetry(status.delivery_id)}
                                >
                                    {retrying ? 'Sending' : 'Confirm retry'}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    disabled={retrying}
                                    onClick={() => setConfirming(false)}
                                >
                                    Cancel retry
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
            {error && (
                <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>
            )}
        </Card>
    );
});

export default RegistrationEmailDeliveryCard;
