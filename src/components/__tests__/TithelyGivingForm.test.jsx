import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TithelyGivingForm from '../TithelyGivingForm';

const FORM_ID = '59b0fe48-e075-436e-a91e-88011a19d975';
const LOCATION_ID = 'c9f19096-4a76-4ea1-be56-d7f16d1e5241';
const FUND_ID = 'c4c11990-779e-4582-ba46-bf510ed3a37f';
const GIVING_URL = `https://give.tithe.ly/?formId=${FORM_ID}&locationId=${LOCATION_ID}&fundId=${FUND_ID}&amount=10000&frequency=one-time`;

const validEvent = {
    title: 'Community Dinner',
    payment_amount: 15,
    tithely_giving_url: GIVING_URL,
    tithely_embed_config: {
        formId: FORM_ID,
        locationId: LOCATION_ID,
        fundId: FUND_ID,
        amount: '10000',
        frequency: 'one-time',
    },
};

describe('TithelyGivingForm', () => {
    it('renders the dedicated pending-payment page with iframe, button, and link fallbacks', () => {
        render(<TithelyGivingForm event={validEvent} />);

        expect(screen.getByText('Community Dinner')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Complete your payment with Tithe.ly' })).toBeInTheDocument();
        expect(screen.getByText('Registration received — payment pending')).toBeInTheDocument();
        expect(screen.getByTitle('Tithe.ly giving form for Community Dinner')).toHaveAttribute('src', GIVING_URL);
        expect(screen.getByTitle('Tithe.ly giving form for Community Dinner')).toHaveClass('min-h-[800px]', 'w-full');
        expect(screen.getByRole('button', { name: 'Pay with Tithe.ly' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open Tithe.ly in a new tab' })).toHaveAttribute('href', GIVING_URL);
        expect(screen.getByRole('link', { name: 'Open Tithe.ly in a new tab' })).toHaveAttribute('target', '_blank');
        expect(screen.getByRole('link', { name: 'Open Tithe.ly in a new tab' })).toHaveAttribute('rel', 'noopener noreferrer');
        expect(screen.getByText('Amount due: $15.00')).toBeInTheDocument();
        expect(screen.getByText(/remains pending until an administrator records/i)).toBeInTheDocument();
    });

    it('does not ask the registrant for an identifier or local completion assertion', () => {
        render(<TithelyGivingForm event={validEvent} />);

        expect(screen.queryByRole('button', { name: /finished/i })).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/gift id|transaction id/i)).not.toBeInTheDocument();
    });

    it('does not show an amount when the configured amount is zero', () => {
        render(<TithelyGivingForm event={{ ...validEvent, payment_amount: 0 }} />);

        expect(screen.queryByText(/Amount due:/)).not.toBeInTheDocument();
    });

    it('does not render payment paths when stored configuration is invalid', () => {
        render(
            <TithelyGivingForm
                event={{ ...validEvent, tithely_embed_config: { formId: 'not-a-form-id' } }}
            />,
        );

        expect(screen.getByRole('alert')).toHaveTextContent(/Tithe.ly payment is unavailable/i);
        expect(screen.queryByTitle('Tithe.ly giving form for Community Dinner')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Pay with Tithe.ly' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Open Tithe.ly in a new tab' })).not.toBeInTheDocument();
    });
});
