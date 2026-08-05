import { describe, expect, it } from 'vitest';
import { canMarkRegistrationPaid } from '../paymentStatus';

const eligibleRegistration = {
    status: 'confirmed',
    payment_status: 'pending',
    payment_method: 'tithely',
};

describe('canMarkRegistrationPaid', () => {
    it.each(['tithely', 'in_person'])('allows confirmed pending %s registrations', (payment_method) => {
        expect(canMarkRegistrationPaid({ ...eligibleRegistration, payment_method })).toBe(true);
    });

    it.each([
        undefined,
        null,
        { ...eligibleRegistration, status: 'waitlisted' },
        { ...eligibleRegistration, status: 'cancelled' },
        { ...eligibleRegistration, payment_status: 'paid' },
        { ...eligibleRegistration, payment_status: 'not_required' },
        { ...eligibleRegistration, payment_method: 'other_processor' },
        { ...eligibleRegistration, payment_method: 'in_person_verified' },
        { ...eligibleRegistration, payment_method: null },
    ])('rejects ineligible registrations', (registration) => {
        expect(canMarkRegistrationPaid(registration)).toBe(false);
    });
});
