import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const { mockCapture } = vi.hoisted(() => ({
    mockCapture: vi.fn(),
}));

vi.mock('@paypal/react-paypal-js', () => ({
    PayPalScriptProvider: ({ children }) => <>{children}</>,
    PayPalButtons: ({ onApprove }) => (
        <button onClick={() => onApprove({}, { order: { capture: mockCapture } })}>
            Approve PayPal
        </button>
    ),
}));

vi.mock('../../services/supabase', () => ({
    supabase: { rpc: vi.fn() },
}));

vi.mock('../PaymentSection', () => ({
    default: ({ onPaymentComplete }) => (
        <button onClick={() => onPaymentComplete({ success: true })}>
            Complete Online Payment
        </button>
    ),
}));

import RegistrationPaymentStep from '../RegistrationPaymentStep';
import { supabase } from '../../services/supabase';

const { default: ActualPaymentSection } = await vi.importActual('../PaymentSection');

const event = {
    payment_amount: 100,
    allow_in_person_payment: true,
};

const registration = {
    id: 'reg-1',
    status: 'confirmed',
};

describe('RegistrationPaymentStep', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        supabase.rpc.mockResolvedValue({ error: null });
    });

    it('completes an online payment with paid PayPal status', () => {
        const onComplete = vi.fn();
        render(
            <RegistrationPaymentStep
                event={event}
                registration={registration}
                onComplete={onComplete}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /complete online payment/i }));

        expect(onComplete).toHaveBeenCalledWith({
            ...registration,
            payment_status: 'paid',
            payment_method: 'paypal',
        });
    });

    it('records an in-person payment choice before completing', async () => {
        const onComplete = vi.fn();
        render(
            <RegistrationPaymentStep
                event={event}
                registration={registration}
                onComplete={onComplete}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /pay in person/i }));

        await waitFor(() => {
            expect(supabase.rpc).toHaveBeenCalledWith('update_payment_status', {
                p_registration_id: 'reg-1',
                p_payment_status: 'pending',
                p_payment_method: 'in_person',
                p_payment_details: {},
            });
        });
        expect(onComplete).toHaveBeenCalledWith({
            ...registration,
            payment_status: 'pending',
            payment_method: 'in_person',
        });
    });

    it('stays in the payment step when the in-person choice cannot be recorded', async () => {
        const onComplete = vi.fn();
        supabase.rpc.mockResolvedValue({ error: { message: 'RPC failed' } });
        render(
            <RegistrationPaymentStep
                event={event}
                registration={registration}
                onComplete={onComplete}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /pay in person/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/unable to record payment choice/i);
        expect(onComplete).not.toHaveBeenCalled();
    });
});

describe('PaymentSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        {
            name: 'PayPal capture fails',
            arrange: () => {
                mockCapture.mockRejectedValue(new Error('capture failed'));
            },
            expectedError: 'capture failed',
        },
        {
            name: 'payment status persistence fails',
            arrange: () => {
                mockCapture.mockResolvedValue({ id: 'paypal-order-1', purchase_units: [] });
                supabase.rpc.mockResolvedValue({ error: { message: 'update failed' } });
            },
            expectedError: 'update failed',
        },
    ])('shows a retryable error when $name', async ({ arrange, expectedError }) => {
        const onPaymentComplete = vi.fn();
        arrange();
        render(
            <ActualPaymentSection
                registrationId="reg-1"
                amount={100}
                onPaymentComplete={onPaymentComplete}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /approve paypal/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Payment could not be completed. Please try again.',
        );
        expect(onPaymentComplete).toHaveBeenCalledWith({
            success: false,
            error: expectedError,
        });
    });
});
