import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    it('keeps a Tithe.ly registration on its pending payment page', () => {
        render(<RegistrationPaymentStep event={event} registration={registration} />);

        expect(screen.getByRole('heading', { name: 'Complete your payment with Tithe.ly' })).toBeInTheDocument();
        expect(screen.getByText('Registration received — payment pending')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /continue|finished/i })).not.toBeInTheDocument();
    });

    it('does not render a Tithe.ly step for an in-person registration', () => {
        const { container } = render(
            <RegistrationPaymentStep
                event={event}
                registration={{ ...registration, payment_method: 'in_person' }}
            />,
        );

        expect(container).toBeEmptyDOMElement();
    });
});
