import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PaymentMethodChoice from '../PaymentMethodChoice';

describe('PaymentMethodChoice', () => {
    it('renders nothing when no payment methods are available', () => {
        const { container } = render(<PaymentMethodChoice methods={[]} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('renders an explanatory summary for one available method', () => {
        render(<PaymentMethodChoice methods={['in_person']} />);

        expect(screen.getByRole('heading', { name: 'Payment Method' })).toBeInTheDocument();
        expect(screen.getByText('Payment method: Pay in Person.')).toBeInTheDocument();
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('renders accessible method choices and reports the selected value', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <PaymentMethodChoice
                methods={['tithely', 'in_person']}
                value="tithely"
                onChange={onChange}
            />,
        );

        expect(screen.getByRole('group', { name: 'Payment Method' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /tithe\.ly/i })).toBeChecked();

        await user.click(screen.getByRole('radio', { name: /pay in person/i }));

        expect(onChange).toHaveBeenCalledWith('in_person');
    });

    it('renders a supplied validation error as an alert', () => {
        render(
            <PaymentMethodChoice
                methods={['tithely', 'in_person']}
                error="Choose a payment method"
            />,
        );

        const error = screen.getByRole('alert');
        expect(error).toHaveTextContent('Choose a payment method');
        expect(error).toHaveAttribute('id', 'payment-method-error');
        for (const radio of screen.getAllByRole('radio')) {
            expect(radio).toHaveAttribute('aria-invalid', 'true');
            expect(radio).toHaveAttribute('aria-describedby', 'payment-method-error');
        }
    });

    it('does not mark radio choices invalid when there is no validation error', () => {
        render(<PaymentMethodChoice methods={['tithely', 'in_person']} />);

        for (const radio of screen.getAllByRole('radio')) {
            expect(radio).not.toHaveAttribute('aria-invalid');
            expect(radio).not.toHaveAttribute('aria-describedby');
        }
    });
});
