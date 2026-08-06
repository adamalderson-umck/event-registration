import { describe, expect, it } from 'vitest';
import {
    canRecordRegistrationPayment,
    formatCurrency,
    formatRecordPaymentError,
    formatPaymentSummary,
    getActivePayments,
    getPaymentRemainingAmount,
} from '../paymentStatus';

function registration(overrides = {}) {
    return {
        status: 'confirmed',
        payment_status: 'pending',
        payment_expected_amount: 50,
        payment_recorded_total: 0,
        ...overrides,
    };
}

describe('payment status helpers', () => {
    it('formats USD values with two decimal places', () => {
        expect(formatCurrency(25)).toBe('$25.00');
        expect(formatCurrency('5.5')).toBe('$5.50');
    });

    it('uses Transaction ID wording for the Tithe.ly duplicate-reference constraint', () => {
        expect(formatRecordPaymentError({
            code: '23505',
            message: 'duplicate key value violates unique constraint "registration_payments_active_tithely_reference_org_key"',
        })).toBe('This Tithe.ly Transaction ID has already been recorded.');
    });

    it('preserves other record-payment errors and supplies a fallback', () => {
        expect(formatRecordPaymentError({ message: 'Network unavailable' })).toBe('Network unavailable');
        expect(formatRecordPaymentError(null)).toBe('Unable to record payment.');
    });

    it.each([undefined, null, ''])('returns no remaining amount when the expected amount is %s', (payment_expected_amount) => {
        expect(getPaymentRemainingAmount(registration({ payment_expected_amount }))).toBeNull();
    });

    it('returns the expected amount less recorded payments without going below zero', () => {
        expect(getPaymentRemainingAmount(registration({ payment_expected_amount: 50, payment_recorded_total: 25 }))).toBe(25);
        expect(getPaymentRemainingAmount(registration({ payment_expected_amount: 50, payment_recorded_total: 65 }))).toBe(0);
    });

    it('formats payment summaries for each payment status', () => {
        expect(formatPaymentSummary(null)).toBeNull();
        expect(formatPaymentSummary(registration({ payment_status: 'not_required' }))).toBe('Not required');
        expect(formatPaymentSummary(registration({ payment_status: 'pending' }))).toBe('Pending — $0.00 recorded');
        expect(formatPaymentSummary(registration({ payment_status: 'pending', payment_recorded_total: 25 }))).toBe('Pending — $25.00 recorded');
        expect(formatPaymentSummary(registration({ payment_status: 'partial', payment_recorded_total: 25 }))).toBe('Partially Paid — $25.00 of $50.00');
        expect(formatPaymentSummary(registration({ payment_status: 'paid', payment_recorded_total: 50 }))).toBe('Paid — $50.00 recorded');
        expect(formatPaymentSummary(registration({ payment_status: 'paid', payment_recorded_total: 65 }))).toBe('Paid — $65.00 recorded');
    });

    it('formats legacy paid registrations without ledger details', () => {
        expect(formatPaymentSummary(registration({
            payment_status: 'paid',
            legacy_payment_paid: true,
            payment_recorded_total: 0,
        }))).toBe('Legacy paid — details unavailable');
    });

    it('formats uncapped paid donations above a former expected amount as paid without an overpaid state', () => {
        expect(formatPaymentSummary(registration({
            payment_status: 'paid',
            payment_expected_amount: null,
            payment_recorded_total: 65,
        }))).toBe('Paid — $65.00 recorded');
    });

    it.each([
        registration({ payment_status: 'pending' }),
        registration({ payment_status: 'partial', payment_recorded_total: 25 }),
        registration({ payment_status: 'paid', payment_expected_amount: null, payment_recorded_total: 65 }),
        registration({ payment_status: 'paid', legacy_payment_paid: true }),
    ])('allows recording a supplemental payment for eligible confirmed registrations', (eligibleRegistration) => {
        expect(canRecordRegistrationPayment(eligibleRegistration)).toBe(true);
    });

    it.each([
        undefined,
        null,
        registration({ status: 'waitlisted' }),
        registration({ status: 'cancelled' }),
        registration({ payment_status: 'not_required' }),
        registration({ payment_status: undefined }),
    ])('rejects registrations that cannot receive a payment', (ineligibleRegistration) => {
        expect(canRecordRegistrationPayment(ineligibleRegistration)).toBe(false);
    });

    it('omits voided payments and orders active payments by payment date and then creation date', () => {
        const payments = [
            { id: 'old', payment_date: '2026-08-01', created_at: '2026-08-01T10:00:00Z' },
            { id: 'newer-created', payment_date: '2026-08-03', created_at: '2026-08-03T12:00:00Z' },
            { id: 'newer-date', payment_date: '2026-08-04', created_at: '2026-08-02T10:00:00Z' },
            { id: 'voided', payment_date: '2026-08-05', created_at: '2026-08-05T10:00:00Z', voided_at: '2026-08-05T11:00:00Z' },
            { id: 'same-date-later', payment_date: '2026-08-03', created_at: '2026-08-03T13:00:00Z' },
        ];

        expect(getActivePayments(payments).map(({ id }) => id)).toEqual([
            'newer-date',
            'same-date-later',
            'newer-created',
            'old',
        ]);
        expect(payments).toHaveLength(5);
    });
});
