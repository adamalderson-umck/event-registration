const RECORDABLE_PAYMENT_STATUSES = new Set(['pending', 'partial', 'paid']);
const TITHELY_REFERENCE_UNIQUE_INDEX = 'registration_payments_active_tithely_reference_org_key';

function toAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : 0;
}

function isMissingAmount(value) {
    return value == null || (typeof value === 'string' && value.trim() === '');
}

function toTimestamp(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

export function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(toAmount(value));
}

export function formatRecordPaymentError(error) {
    const message = error?.message || '';
    const details = error?.details || '';

    if (
        error?.code === '23505'
        && `${message} ${details}`.includes(TITHELY_REFERENCE_UNIQUE_INDEX)
    ) {
        return 'This Tithe.ly Transaction ID has already been recorded.';
    }

    return message || 'Unable to record payment.';
}

export function getPaymentRemainingAmount(registration) {
    const expectedAmount = registration?.payment_expected_amount;

    if (isMissingAmount(expectedAmount)) {
        return null;
    }

    return Math.max(toAmount(expectedAmount) - toAmount(registration?.payment_recorded_total), 0);
}

export function formatPaymentSummary(registration) {
    if (!registration) {
        return null;
    }

    if (registration.payment_status === 'not_required') {
        return 'Not required';
    }

    if (registration.legacy_payment_paid) {
        return 'Legacy paid — details unavailable';
    }

    const recordedTotal = formatCurrency(registration.payment_recorded_total);

    if (registration.payment_status === 'pending') {
        return `Pending — ${recordedTotal} recorded`;
    }

    if (registration.payment_status === 'partial') {
        return `Partially Paid — ${recordedTotal} of ${formatCurrency(registration.payment_expected_amount)}`;
    }

    if (registration.payment_status === 'paid') {
        return `Paid — ${recordedTotal} recorded`;
    }

    return null;
}

export function canRecordRegistrationPayment(registration) {
    return Boolean(
        registration
        && registration.status === 'confirmed'
        && RECORDABLE_PAYMENT_STATUSES.has(registration.payment_status)
    );
}

export function getActivePayments(payments = []) {
    return payments
        .filter(payment => !payment.voided_at)
        .sort((left, right) => {
            const paymentDateDifference = toTimestamp(right.payment_date) - toTimestamp(left.payment_date);

            if (paymentDateDifference !== 0) {
                return paymentDateDifference;
            }

            return toTimestamp(right.created_at) - toTimestamp(left.created_at);
        });
}
