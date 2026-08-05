import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PARKING_FIELD_IDS } from '../../config/eventPresets';
import ParkingRegistrationTable from '../ParkingRegistrationTable';

const registration = (overrides = {}) => ({
    id: 'parking-registration-1',
    status: 'confirmed',
    payment_status: 'paid',
    payment_method: 'paypal',
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
                onMarkPaid={vi.fn()}
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

        fireEvent.click(screen.getByRole('button', { name: 'Print Pass' }));

        expect(onPrintPass).toHaveBeenCalledWith(paidRegistration);
    });

    it.each(['in_person', 'tithely'])('allows confirmed pending %s registrations to be marked paid', (payment_method) => {
        const pendingRegistration = registration({
            payment_status: 'pending',
            payment_method,
        });
        const onMarkPaid = vi.fn();

        render(
            <ParkingRegistrationTable
                registrations={[pendingRegistration]}
                onView={vi.fn()}
                onMarkPaid={onMarkPaid}
                onPrintPass={vi.fn()}
            />
        );

        expect(screen.queryByRole('button', { name: 'Print Pass' })).not.toBeInTheDocument();
        expect(screen.getByText('pending')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Mark Paid' }));

        expect(onMarkPaid).toHaveBeenCalledWith(pendingRegistration);
    });

    it('does not offer Mark Paid for ineligible registrations', () => {
        render(
            <ParkingRegistrationTable
                registrations={[registration({ payment_status: 'pending', payment_method: 'paypal' })]}
                onView={vi.fn()}
                onMarkPaid={vi.fn()}
                onPrintPass={vi.fn()}
            />
        );

        expect(screen.queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();
    });
});
