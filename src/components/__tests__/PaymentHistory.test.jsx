import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import PaymentHistory from '../PaymentHistory';

const payments = [
    {
        id: 'active-payment',
        method: 'check',
        amount: 25,
        payment_date: '2026-08-03',
        reference_number: '1042',
        created_at: '2026-08-03T10:00:00Z',
        created_by: 'admin-1',
    },
    {
        id: 'voided-payment',
        method: 'tithely',
        amount: 40,
        payment_date: '2026-08-04',
        reference_number: 'TX-42',
        created_at: '2026-08-04T09:00:00Z',
        created_by: 'admin-2',
        voided_at: '2026-08-04T11:00:00Z',
        void_reason: 'Duplicate entry',
    },
];

function renderHistory(props = {}) {
    const onVoid = vi.fn().mockResolvedValue(undefined);

    render(<PaymentHistory payments={payments} onVoid={onVoid} {...props} />);

    return { onVoid };
}

async function openVoidDialog(user) {
    await user.click(screen.getByRole('button', { name: 'Void Payment' }));
    return screen.getByRole('dialog', { name: 'Void payment' });
}

describe('PaymentHistory', () => {
    it('shows active and voided entries in payment-date order without hiding audit history', () => {
        renderHistory();

        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('Tithe.ly #TX-42');
        expect(rows[0]).toHaveTextContent('$40.00');
        expect(rows[0]).toHaveTextContent('Voided: Duplicate entry');
        expect(rows[1]).toHaveTextContent('Check #1042');
        expect(rows[1]).toHaveTextContent('$25.00');
        expect(screen.getAllByRole('button', { name: 'Void Payment' })).toHaveLength(1);
        expect(screen.getByText(/recorded .*admin-2/i)).toBeInTheDocument();
        expect(screen.getByText(/recorded .*admin-1/i)).toBeInTheDocument();
    });

    it('shows an empty state when no payments have been recorded', () => {
        renderHistory({ payments: [] });

        expect(screen.getByText('No payments have been recorded.')).toBeInTheDocument();
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('clears a stale payment error before opening the void dialog', async () => {
        const user = userEvent.setup();

        function HistoryWithStaleError() {
            const [error, setError] = useState('A previous payment failed.');

            return (
                <PaymentHistory
                    payments={payments}
                    onVoid={vi.fn().mockResolvedValue(undefined)}
                    onBeginVoid={() => setError('')}
                    error={error}
                />
            );
        }

        render(<HistoryWithStaleError />);
        await openVoidDialog(user);

        expect(screen.queryByText('A previous payment failed.')).not.toBeInTheDocument();
    });

    it('requires a void reason before calling the void callback', async () => {
        const user = userEvent.setup();
        const { onVoid } = renderHistory();

        await openVoidDialog(user);
        await user.click(screen.getByRole('button', { name: 'Confirm Void' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Enter a reason for voiding this payment.');
        expect(onVoid).not.toHaveBeenCalled();
    });

    it('trims the void reason and closes after the callback resolves', async () => {
        const user = userEvent.setup();
        const { onVoid } = renderHistory();

        await openVoidDialog(user);
        await user.type(screen.getByLabelText(/^Void reason/), '  Duplicate entry  ');
        await user.click(screen.getByRole('button', { name: 'Confirm Void' }));

        await waitFor(() => expect(onVoid).toHaveBeenCalledWith(payments[0], 'Duplicate entry'));
        expect(screen.queryByRole('dialog', { name: 'Void payment' })).not.toBeInTheDocument();
    });

    it('keeps the dialog and supplied error visible when voiding is rejected', async () => {
        const user = userEvent.setup();
        const onVoid = vi.fn().mockRejectedValue(new Error('Unable to void payment.'));
        render(<PaymentHistory payments={payments} onVoid={onVoid} error="Unable to void payment." />);

        await openVoidDialog(user);
        const reason = screen.getByLabelText(/^Void reason/);
        await user.type(reason, 'Duplicate entry');
        await user.click(screen.getByRole('button', { name: 'Confirm Void' }));

        await waitFor(() => expect(onVoid).toHaveBeenCalledTimes(1));
        expect(screen.getByRole('dialog', { name: 'Void payment' })).toBeInTheDocument();
        expect(reason).toHaveValue('Duplicate entry');
        expect(screen.getByRole('alert')).toHaveTextContent('Unable to void payment.');
    });

    it('moves focus into the dialog, traps it, closes with idle Escape, and restores trigger focus', async () => {
        const user = userEvent.setup();
        renderHistory();
        const trigger = screen.getByRole('button', { name: 'Void Payment' });

        await user.click(trigger);
        const reason = screen.getByLabelText(/^Void reason/);
        expect(reason).toHaveFocus();

        await user.tab({ shift: true });
        expect(screen.getByRole('button', { name: 'Confirm Void' })).toHaveFocus();

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Void payment' })).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });
});
