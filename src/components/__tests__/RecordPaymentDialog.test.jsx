import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import RecordPaymentDialog from '../RecordPaymentDialog';

const registration = {
    id: 'registration-1',
    payment_recorded_total: 25,
    payment_expected_amount: 100,
};

function renderDialog(props = {}) {
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    render(
        <RecordPaymentDialog
            registration={registration}
            onSubmit={onSubmit}
            onClose={onClose}
            today="2026-08-05"
            {...props}
        />,
    );

    return { onSubmit, onClose };
}

async function enterAmount(user, value) {
    const amount = screen.getByLabelText(/^Amount/);
    await user.clear(amount);
    await user.type(amount, value);
}

describe('RecordPaymentDialog', () => {
    it('moves focus to the payment method when opened', () => {
        renderDialog();

        expect(screen.getByLabelText('Payment method')).toHaveFocus();
    });

    it('keeps Tab focus within the dialog', async () => {
        const user = userEvent.setup();
        renderDialog();
        screen.getByLabelText('Payment method').focus();

        await user.tab({ shift: true });
        expect(screen.getByRole('button', { name: 'Record payment' })).toHaveFocus();

        await user.tab();
        expect(screen.getByLabelText('Payment method')).toHaveFocus();
    });

    it('closes when Escape is pressed while idle', async () => {
        const user = userEvent.setup();
        const { onClose } = renderDialog();

        await user.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close when Escape is pressed while submitting', async () => {
        const user = userEvent.setup();
        const { onClose } = renderDialog({ submitting: true });

        await user.keyboard('{Escape}');

        expect(onClose).not.toHaveBeenCalled();
    });

    it('restores focus to the triggering control when closed', () => {
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();

        const { unmount } = render(
            <RecordPaymentDialog
                registration={registration}
                onSubmit={vi.fn()}
                onClose={vi.fn()}
                today="2026-08-05"
            />,
        );

        screen.getByLabelText('Payment method').focus();
        unmount();

        expect(trigger).toHaveFocus();
        trigger.remove();
    });

    it('submits a cash payment with a numeric amount and no reference number', async () => {
        const user = userEvent.setup();
        const { onSubmit } = renderDialog();

        expect(screen.getByRole('dialog', { name: 'Record payment' })).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByText('Recorded: $25.00')).toBeInTheDocument();
        expect(screen.getByText('Expected: $100.00')).toBeInTheDocument();
        expect(screen.getByText('Remaining: $75.00')).toBeInTheDocument();
        expect(screen.queryByLabelText(/number/i)).not.toBeInTheDocument();

        await enterAmount(user, '27.50');
        await user.click(screen.getByRole('button', { name: 'Record payment' }));

        expect(onSubmit).toHaveBeenCalledWith({
            method: 'cash',
            amount: 27.5,
            paymentDate: '2026-08-05',
            referenceNumber: null,
        });
    });

    it('requires a check number before submitting a check payment', async () => {
        const user = userEvent.setup();
        const { onSubmit } = renderDialog();

        await user.selectOptions(screen.getByLabelText('Payment method'), 'check');
        expect(screen.getByLabelText(/^Check number/)).toBeInTheDocument();
        await enterAmount(user, '10');
        await user.click(screen.getByRole('button', { name: 'Record payment' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Enter the check number.');
        expect(onSubmit).not.toHaveBeenCalled();

        await user.type(screen.getByLabelText(/^Check number/), '1042');
        await user.click(screen.getByRole('button', { name: 'Record payment' }));

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
            method: 'check',
            referenceNumber: '1042',
        }));
    });

    it('requires a Transaction ID before submitting a Tithe.ly payment', async () => {
        const user = userEvent.setup();
        const { onSubmit } = renderDialog();

        await user.selectOptions(screen.getByLabelText('Payment method'), 'tithely');
        expect(screen.getByLabelText(/^Transaction ID/)).toBeInTheDocument();
        await enterAmount(user, '15');
        await user.click(screen.getByRole('button', { name: 'Record payment' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Enter the Tithe.ly Transaction ID.');
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it.each([
        { amount: '0', paymentDate: '2026-08-05', message: 'Enter an amount greater than zero.' },
        { amount: '10', paymentDate: '2026-08-06', message: 'Payment date cannot be in the future.' },
    ])('rejects invalid amount or future payment date', async ({ amount, paymentDate, message }) => {
        const user = userEvent.setup();
        const { onSubmit } = renderDialog();

        await enterAmount(user, amount);
        const date = screen.getByLabelText(/^Payment date/);
        await user.clear(date);
        await user.type(date, paymentDate);
        await user.click(screen.getByRole('button', { name: 'Record payment' }));

        expect(screen.getByRole('alert')).toHaveTextContent(message);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('keeps entered values visible when a server error is supplied', async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            <RecordPaymentDialog
                registration={registration}
                onSubmit={vi.fn()}
                onClose={vi.fn()}
                today="2026-08-05"
            />,
        );

        await enterAmount(user, '42.25');
        rerender(
            <RecordPaymentDialog
                registration={registration}
                onSubmit={vi.fn()}
                onClose={vi.fn()}
                today="2026-08-05"
                error="Unable to save this payment."
            />,
        );

        expect(screen.getByRole('alert')).toHaveTextContent('Unable to save this payment.');
        expect(screen.getByLabelText(/^Amount/)).toHaveValue(42.25);
    });
});
