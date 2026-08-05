import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegistrationPaymentStep from '../RegistrationPaymentStep';

const FORM_ID = '123e4567-e89b-42d3-a456-426614174000';
const event = {
    title: 'Community Dinner',
    payment_amount: 100,
    tithely_giving_url: `https://give.tithe.ly/?formId=${FORM_ID}`,
    tithely_embed_config: { formId: FORM_ID },
};

const registration = {
    id: 'reg-1',
    status: 'confirmed',
    payment_status: 'pending',
    payment_method: 'tithely',
};

describe('RegistrationPaymentStep', () => {
    it('hands off the unchanged registration only after the local Tithe.ly action', () => {
        const onComplete = vi.fn();
        render(<RegistrationPaymentStep event={event} registration={registration} onComplete={onComplete} />);

        expect(onComplete).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: "I've finished with Tithe.ly" }));

        expect(onComplete).toHaveBeenCalledWith(registration);
        expect(onComplete).not.toHaveBeenCalledWith(expect.objectContaining({ payment_status: 'paid' }));
    });

    it('preserves the pending Pay in Person handoff without a client-side write', () => {
        const onComplete = vi.fn();
        const inPersonRegistration = { ...registration, payment_method: 'in_person' };
        render(<RegistrationPaymentStep event={event} registration={inPersonRegistration} onComplete={onComplete} />);

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(onComplete).toHaveBeenCalledWith(inPersonRegistration);
    });
});
