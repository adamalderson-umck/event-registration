import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PaymentMethodChoice from '../PaymentMethodChoice';

describe('PaymentMethodChoice', () => {
    it('renders nothing when no payment methods are available', () => {
        const { container } = render(<PaymentMethodChoice availableMethods={[]} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('renders an explanatory summary for one available method', () => {
        render(<PaymentMethodChoice availableMethods={['in_person']} />);

        expect(screen.getByRole('heading', { name: 'Payment Method' })).toBeInTheDocument();
        expect(screen.getByText(/pay in person/i)).toBeInTheDocument();
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('renders accessible method choices and reports the selected value', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <PaymentMethodChoice
                availableMethods={['tithely', 'in_person']}
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
                availableMethods={['tithely', 'in_person']}
                error="Choose a payment method"
            />,
        );

        expect(screen.getByRole('alert')).toHaveTextContent('Choose a payment method');
    });
});
