import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    it('renders the parking administration columns and prints valid passes', () => {
        const paidRegistration = registration();
        const onPrintPass = vi.fn();

        render(
            <ParkingRegistrationTable
                registrations={[paidRegistration]}
                onView={vi.fn()}
                onRecordPayment={vi.fn()}
                onPrintPass={onPrintPass}
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

        fireEvent.click(screen.getByRole('button', { name: 'Print Pass' }));

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
            />
        );

        await userEvent.click(screen.getByRole('button', { name: 'Record Payment' }));

        expect(onRecordPayment).toHaveBeenCalledWith(paidRegistration);
    });

    it('does not offer Record Payment for ineligible registrations', () => {
        render(
            <ParkingRegistrationTable
                registrations={[registration({ status: 'waitlisted', payment_status: 'pending', payment_recorded_total: 0 })]}
                onView={vi.fn()}
                onRecordPayment={vi.fn()}
                onPrintPass={vi.fn()}
            />
        );

        expect(screen.queryByRole('button', { name: 'Record Payment' })).not.toBeInTheDocument();
    });
});
