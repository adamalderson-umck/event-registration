import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PARKING_FIELD_IDS } from '../../config/eventPresets';
import ParkingRegistrationTable from '../ParkingRegistrationTable';

const registration = (overrides = {}) => ({
    id: 'parking-registration-1',
    status: 'confirmed',
    payment_status: 'paid',
    payment_method: 'tithely',
    payment_expected_amount: 50,
    payment_recorded_total: 65,
    form_data: {
        system_first_name: 'Alex',
        system_last_name: 'Morgan',
        system_email: 'alex@example.com',
        [PARKING_FIELD_IDS.LICENSE_PLATE]: 'ABC123',
        [PARKING_FIELD_IDS.VEHICLE_MAKE]: 'Honda',
        [PARKING_FIELD_IDS.VEHICLE_MODEL]: 'Civic',
        [PARKING_FIELD_IDS.VEHICLE_COLOR]: 'Blue',
    },
    ...overrides,
});

describe('ParkingRegistrationTable', () => {
    it('shows and routes retry only for an exhausted delivery', async () => {
        const user = userEvent.setup();
        const failedRegistration = registration();
        const healthyRegistration = registration({ id: 'parking-registration-2' });
        const onRetryEmail = vi.fn();
        render(
            <ParkingRegistrationTable
                registrations={[failedRegistration, healthyRegistration]}
                onView={vi.fn()}
                onRecordPayment={vi.fn()}
                onPrintPass={vi.fn()}
                onFinalize={vi.fn()}
                onUndoFinalization={vi.fn()}
                onRetryEmail={onRetryEmail}
                emailDeliveryStatuses={new Map([
                    [failedRegistration.id, { exhausted: true }],
                    [healthyRegistration.id, { exhausted: false }],
                ])}
            />
        );

        expect(screen.getAllByText('Email failed')).toHaveLength(1);
        const rows = screen.getAllByRole('row').slice(1);
        await user.click(within(rows[0]).getByRole('button', { name: 'Actions' }));
        await user.click(screen.getByRole('menuitem', { name: 'Retry failed email' }));
        expect(onRetryEmail).toHaveBeenCalledWith(failedRegistration);

        await user.click(within(rows[1]).getByRole('button', { name: 'Actions' }));
        expect(screen.queryByRole('menuitem', { name: 'Retry failed email' }))
            .not.toBeInTheDocument();
    });

    it('renders the parking administration columns and prints valid passes', async () => {
        const user = userEvent.setup();
        const paidRegistration = registration();
        const onPrintPass = vi.fn();

        render(
            <ParkingRegistrationTable
                registrations={[paidRegistration]}
                onView={vi.fn()}
                onRecordPayment={vi.fn()}
                onPrintPass={onPrintPass}
                onFinalize={vi.fn()}
                onUndoFinalization={vi.fn()}
            />
        );

        const headers = within(screen.getByRole('table'))
            .getAllByRole('columnheader')
            .map((header) => header.textContent);
        expect(headers).toEqual([
            'Registrant',
            'Email',
            'License Plate',
            'Vehicle',
            'Registration',
            'Payment',
            'Pass',
            'Actions',
        ]);
        expect(screen.getByText('Alex Morgan')).toBeInTheDocument();
        expect(screen.getByText('alex@example.com')).toBeInTheDocument();
        expect(screen.getByText('ABC123')).toBeInTheDocument();
        expect(screen.getByText('Blue Honda Civic')).toBeInTheDocument();
        expect(screen.getByText('Paid — $65.00 recorded')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Actions' }));
        await user.click(screen.getByRole('menuitem', { name: 'Print Pass' }));

        expect(onPrintPass).toHaveBeenCalledWith(paidRegistration);
    });

    it('keeps Record Payment available for paid registrations because donations are uncapped', async () => {
        const paidRegistration = registration();
        const onRecordPayment = vi.fn();

        render(
            <ParkingRegistrationTable
                registrations={[paidRegistration]}
                onView={vi.fn()}
                onRecordPayment={onRecordPayment}
                onPrintPass={vi.fn()}
                onFinalize={vi.fn()}
                onUndoFinalization={vi.fn()}
            />
        );

        await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Record Payment' }));

        expect(onRecordPayment).toHaveBeenCalledWith(paidRegistration);
    });

    it('does not offer Record Payment for ineligible registrations', () => {
        render(
            <ParkingRegistrationTable
                registrations={[registration({ status: 'waitlisted', payment_status: 'pending', payment_recorded_total: 0 })]}
                onView={vi.fn()}
                onRecordPayment={vi.fn()}
                onPrintPass={vi.fn()}
                onFinalize={vi.fn()}
                onUndoFinalization={vi.fn()}
            />
        );

        expect(screen.queryByRole('button', { name: 'Record Payment' })).not.toBeInTheDocument();
    });

    it('shows valid unfinalized actions in one dropdown', async () => {
        const user = userEvent.setup();
        const paidRegistration = registration();
        const onPrintPass = vi.fn();
        const onFinalize = vi.fn();
        render(
            <ParkingRegistrationTable
                registrations={[paidRegistration]}
                onView={vi.fn()}
                onRecordPayment={vi.fn()}
                onPrintPass={onPrintPass}
                onFinalize={onFinalize}
                onUndoFinalization={vi.fn()}
                busyRegistrationId={null}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Actions' }));
        expect(screen.getByRole('menuitem', { name: 'Print Pass' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Finalize' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'Undo Finalization' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('menuitem', { name: 'Print Pass' }));
        expect(onPrintPass).toHaveBeenCalledWith(paidRegistration);
    });

    it('shows Finalized and only the undo fulfillment action', async () => {
        const user = userEvent.setup();
        const onUndoFinalization = vi.fn();
        const finalized = registration({
            parking_pass_finalized_at: '2026-08-19T14:30:00Z',
        });
        render(
            <ParkingRegistrationTable
                registrations={[finalized]}
                onView={vi.fn()}
                onRecordPayment={vi.fn()}
                onPrintPass={vi.fn()}
                onFinalize={vi.fn()}
                onUndoFinalization={onUndoFinalization}
                busyRegistrationId={null}
            />
        );

        expect(screen.getByText('Finalized')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Actions' }));
        expect(screen.queryByRole('menuitem', { name: 'Print Pass' })).not.toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'Finalize' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('menuitem', { name: 'Undo Finalization' }));
        expect(onUndoFinalization).toHaveBeenCalledWith(finalized);
    });
});
