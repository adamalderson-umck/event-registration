import React, { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegistrationEmailDeliveryCard from '../RegistrationEmailDeliveryCard';

const status = (overrides = {}) => ({
    registration_id: 'registration-1',
    delivery_id: 'delivery-1',
    kind: 'registration_confirmation',
    state: 'failed',
    attempt_count: 4,
    last_error_code: 'smtp_send_failed',
    attempted_at: '2026-08-26T12:00:00Z',
    sent_at: null,
    next_retry_at: null,
    exhausted: true,
    ...overrides,
});

describe('RegistrationEmailDeliveryCard', () => {
    it.each([null, status({ delivery_id: null, state: null })])(
        'shows no delivery record without offering retry', (value) => {
            render(<RegistrationEmailDeliveryCard status={value} onRetry={vi.fn()} />);
            expect(screen.getByRole('heading', { name: 'Email Delivery' })).toBeInTheDocument();
            expect(screen.getByText('No delivery record')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Retry email now' }))
                .not.toBeInTheDocument();
        },
    );

    it('shows a sent delivery and its authoritative timestamp', () => {
        const sentAt = '2026-08-26T12:30:00Z';
        render(<RegistrationEmailDeliveryCard
            status={status({ state: 'sent', sent_at: sentAt, exhausted: false })}
            onRetry={vi.fn()}
        />);
        expect(screen.getByText('Sent')).toBeInTheDocument();
        expect(screen.getByText(new Date(sentAt).toLocaleString())).toBeInTheDocument();
    });

    it('shows an active send', () => {
        render(<RegistrationEmailDeliveryCard
            status={status({ state: 'pending', attempt_count: 2, exhausted: false })}
            onRetry={vi.fn()}
        />);
        expect(screen.getByText('Sending')).toBeInTheDocument();
    });

    it('shows the next automatic retry for a non-exhausted failure', () => {
        const nextRetryAt = '2026-08-26T12:30:00Z';
        render(<RegistrationEmailDeliveryCard
            status={status({
                attempt_count: 2,
                next_retry_at: nextRetryAt,
                exhausted: false,
            })}
            onRetry={vi.fn()}
        />);
        expect(screen.getByText('Retry scheduled')).toBeInTheDocument();
        expect(screen.getByText(new Date(nextRetryAt).toLocaleString())).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Retry email now' }))
            .not.toBeInTheDocument();
    });

    it('shows an exhausted failure with sanitized guidance', () => {
        render(<RegistrationEmailDeliveryCard status={status()} onRetry={vi.fn()} />);
        expect(screen.getByText('Failed - intervention required')).toBeInTheDocument();
        expect(screen.getByText(
            'The outgoing mail server did not complete the delivery.',
        )).toBeInTheDocument();
        expect(screen.queryByText('smtp_send_failed')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry email now' })).toBeInTheDocument();
    });

    it('uses generic safe guidance for an unknown failure code', () => {
        render(<RegistrationEmailDeliveryCard
            status={status({ last_error_code: 'provider-secret-detail' })}
            onRetry={vi.fn()}
        />);
        expect(screen.getByText('The email could not be delivered.'))
            .toBeInTheDocument();
        expect(screen.queryByText('provider-secret-detail')).not.toBeInTheDocument();
    });

    it('requires inline confirmation and supports cancellation', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        render(<RegistrationEmailDeliveryCard status={status()} onRetry={onRetry} />);

        await user.click(screen.getByRole('button', { name: 'Retry email now' }));
        expect(screen.getByText('Send this registration email again?')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Cancel retry' }));
        expect(screen.queryByText('Send this registration email again?')).not.toBeInTheDocument();
        expect(onRetry).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Retry email now' }));
        await user.click(screen.getByRole('button', { name: 'Confirm retry' }));
        expect(onRetry).toHaveBeenCalledOnce();
        expect(onRetry).toHaveBeenCalledWith('delivery-1');
    });

    it('disables confirmation while retrying and presents a safe parent error', async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            <RegistrationEmailDeliveryCard status={status()} onRetry={vi.fn()} />,
        );
        await user.click(screen.getByRole('button', { name: 'Retry email now' }));
        rerender(
            <RegistrationEmailDeliveryCard
                status={status()}
                onRetry={vi.fn()}
                retrying
                error="The retry is still processing. Refresh delivery status shortly."
            />,
        );
        expect(screen.getByRole('button', { name: 'Sending' })).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent(
            'The retry is still processing. Refresh delivery status shortly.',
        );
    });

    it('forwards a focusable card ref', () => {
        const ref = createRef();
        render(<RegistrationEmailDeliveryCard ref={ref} status={null} onRetry={vi.fn()} />);
        ref.current.focus();
        expect(ref.current).toHaveFocus();
        expect(ref.current).toHaveAttribute('tabindex', '-1');
    });
});
