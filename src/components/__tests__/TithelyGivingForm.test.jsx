import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TithelyGivingForm from '../TithelyGivingForm';

const FORM_ID = '123e4567-e89b-42d3-a456-426614174000';
const GIVING_URL = `https://give.tithe.ly/?formId=${FORM_ID}`;

const validEvent = {
    title: 'Community Dinner',
    payment_amount: 15,
    tithely_giving_url: GIVING_URL,
    tithely_embed_config: { formId: FORM_ID },
};

describe('TithelyGivingForm', () => {
    it('renders the approved Giving URL in an accessible iframe with a new-tab fallback', () => {
        render(<TithelyGivingForm event={validEvent} onFinished={vi.fn()} />);

        expect(screen.getByTitle('Tithe.ly giving form for Community Dinner')).toHaveAttribute('src', GIVING_URL);
        expect(screen.getByTitle('Tithe.ly giving form for Community Dinner')).toHaveClass('min-h-[800px]', 'w-full');
        expect(screen.getByRole('link', { name: 'Open Tithe.ly in a new tab' })).toHaveAttribute('href', GIVING_URL);
        expect(screen.getByRole('link', { name: 'Open Tithe.ly in a new tab' })).toHaveAttribute('target', '_blank');
        expect(screen.getByRole('link', { name: 'Open Tithe.ly in a new tab' })).toHaveAttribute('rel', 'noopener noreferrer');
        expect(screen.getByText('Amount due: $15.00')).toBeInTheDocument();
        expect(screen.getByText(/remain payment pending until an administrator verifies/i)).toBeInTheDocument();
    });

    it('does not show an amount when the configured amount is zero', () => {
        render(<TithelyGivingForm event={{ ...validEvent, payment_amount: 0 }} onFinished={vi.fn()} />);

        expect(screen.queryByText(/Amount due:/)).not.toBeInTheDocument();
    });

    it('does not render the payment form when stored configuration is invalid', () => {
        render(
            <TithelyGivingForm
                event={{ ...validEvent, tithely_embed_config: { formId: 'not-a-form-id' } }}
                onFinished={vi.fn()}
            />,
        );

        expect(screen.getByRole('alert')).toHaveTextContent(/Tithe.ly payment is unavailable/i);
        expect(screen.queryByTitle('Tithe.ly giving form for Community Dinner')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: "I've finished with Tithe.ly" })).not.toBeInTheDocument();
    });

    it('only invokes its local completion callback when the registrant confirms', () => {
        const onFinished = vi.fn();
        render(<TithelyGivingForm event={validEvent} onFinished={onFinished} />);

        fireEvent.click(screen.getByRole('button', { name: "I've finished with Tithe.ly" }));

        expect(onFinished).toHaveBeenCalledTimes(1);
    });
});
