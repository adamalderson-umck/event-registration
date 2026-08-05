import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PARKING_FIELD_IDS } from '../../config/eventPresets';

const { downloadCsvMock } = vi.hoisted(() => ({ downloadCsvMock: vi.fn() }));

vi.mock('../../utils/exportCsv', () => ({ downloadCsv: downloadCsvMock }));

vi.mock('../../services/supabase', () => {
    const mockOrder = vi.fn();
    const mockSecondEq = vi.fn(() => ({ order: mockOrder }));
    const mockFirstEq = vi.fn(() => ({ eq: mockSecondEq }));
    const mockSelect = vi.fn(() => ({ eq: mockFirstEq }));
    const mockFrom = vi.fn(() => ({ select: mockSelect }));
    const mockSubscribe = vi.fn(() => ({ id: 'channel-1' }));
    const mockOn = vi.fn(() => ({ subscribe: mockSubscribe }));
    const mockChannel = vi.fn(() => ({ on: mockOn }));
    const mockRpc = vi.fn();

    return {
        supabase: {
            from: mockFrom,
            channel: mockChannel,
            removeChannel: vi.fn(),
            rpc: mockRpc,
            _mocks: { mockOrder },
        },
    };
});

import RegistrationViewer from '../RegistrationViewer';
import { supabase } from '../../services/supabase';

describe('RegistrationViewer', () => {
    const event = {
        title: 'Beta Event',
        form_fields: [{ id: 'name', label: 'Name', type: 'text' }],
        waivers: [
            { id: 'liability', title: 'Liability Waiver', required: true },
            { id: 'media', title: 'Media Release', required: false },
        ],
    };
    const parkingEvent = {
        ...event,
        title: 'Fall Parking',
        event_type: 'parking',
    };
    const parkingRegistration = {
        id: 'parking-registration-1',
        status: 'confirmed',
        payment_status: 'pending',
        payment_method: 'in_person',
        form_data: {
            system_first_name: 'Alex',
            system_last_name: 'Morgan',
            system_email: 'alex@example.com',
            [PARKING_FIELD_IDS.LICENSE_PLATE]: 'ABC123',
            [PARKING_FIELD_IDS.VEHICLE_MAKE]: 'Honda',
            [PARKING_FIELD_IDS.VEHICLE_MODEL]: 'Civic',
            [PARKING_FIELD_IDS.VEHICLE_COLOR]: 'Blue',
        },
        signature_records: [],
    };

    beforeEach(() => {
        vi.clearAllMocks();
        supabase._mocks.mockOrder.mockResolvedValue({
            data: [{
                id: 'registration-1',
                status: 'confirmed',
                form_data: { name: 'Alex' },
                signature_records: [
                    { waiverId: 'liability', signed: true, declined: false },
                    { waiverId: 'media', signed: false, declined: true },
                ],
            }],
            error: null,
        });
    });

    it('renders Waiver and Media before Status and keeps Actions last', async () => {
        render(
            <RegistrationViewer
                orgId="org-1"
                eventId="event-1"
                event={event}
                onBack={vi.fn()}
            />
        );

        expect(await screen.findByText('Alex')).toBeInTheDocument();
        const table = screen.getByRole('table');
        const headers = within(table)
            .getAllByRole('columnheader')
            .map((header) => header.textContent);
        expect(headers).toEqual(['Name', 'Waiver', 'Media', 'Status', 'Actions']);

        const rows = within(table).getAllByRole('row');
        const cells = within(rows[1])
            .getAllByRole('cell')
            .map((cell) => cell.textContent.trim());
        expect(cells).toEqual(['Alex', 'Signed', 'Declined', 'confirmed', 'View']);
    });

    it('marks an eligible standard registration paid and retains its payment method from the RPC result', async () => {
        const pendingRegistration = {
            id: 'registration-1',
            status: 'confirmed',
            payment_status: 'pending',
            payment_method: 'tithely',
            form_data: { name: 'Alex' },
            signature_records: [],
        };
        const paidRegistration = { ...pendingRegistration, payment_status: 'paid' };
        supabase._mocks.mockOrder.mockResolvedValue({ data: [pendingRegistration], error: null });
        supabase.rpc.mockResolvedValue({ data: [paidRegistration], error: null });

        render(<RegistrationViewer orgId="org-1" eventId="event-1" event={event} onBack={vi.fn()} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Mark Paid' }));

        await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('mark_registration_paid', {
            p_registration_id: 'registration-1',
            p_org_id: 'org-1',
        }));
        expect(screen.queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /view/i }));
        expect(await screen.findByText('Payment: paid (tithely)')).toBeInTheDocument();
    });

    it('does not offer Mark Paid for an ineligible standard registration', async () => {
        supabase._mocks.mockOrder.mockResolvedValue({
            data: [{
                id: 'registration-1',
                status: 'waitlisted',
                payment_status: 'pending',
                payment_method: 'tithely',
                form_data: { name: 'Alex' },
                signature_records: [],
            }],
            error: null,
        });

        render(<RegistrationViewer orgId="org-1" eventId="event-1" event={event} onBack={vi.fn()} />);

        await screen.findByText('Alex');
        expect(screen.queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();
    });

    it('marks an eligible standard registration paid from its details view', async () => {
        const pendingRegistration = {
            id: 'registration-1',
            status: 'confirmed',
            payment_status: 'pending',
            payment_method: 'in_person',
            form_data: { name: 'Alex' },
            signature_records: [],
        };
        supabase._mocks.mockOrder.mockResolvedValue({ data: [pendingRegistration], error: null });
        supabase.rpc.mockResolvedValue({
            data: [{ ...pendingRegistration, payment_status: 'paid' }],
            error: null,
        });

        render(<RegistrationViewer orgId="org-1" eventId="event-1" event={event} onBack={vi.fn()} />);

        fireEvent.click(await screen.findByRole('button', { name: /view/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Mark Paid' }));

        await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('mark_registration_paid', {
            p_registration_id: 'registration-1',
            p_org_id: 'org-1',
        }));
        expect(await screen.findByText('Payment: paid (in_person)')).toBeInTheDocument();
    });

    it('passes the event waivers to the CSV export', async () => {
        render(
            <RegistrationViewer
                orgId="org-1"
                eventId="event-1"
                event={event}
                onBack={vi.fn()}
            />
        );

        expect(await screen.findByText('Alex')).toBeInTheDocument();
        fireEvent.click(screen.getByTitle('Export to CSV'));

        expect(downloadCsvMock).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 'registration-1' })],
            event.form_fields,
            'Beta_Event.csv',
            event.waivers
        );
    });

    it('renders parking registrations with the parking administration columns', async () => {
        supabase._mocks.mockOrder.mockResolvedValue({
            data: [parkingRegistration],
            error: null,
        });

        render(
            <RegistrationViewer
                orgId="org-1"
                eventId="event-1"
                event={parkingEvent}
                organizationName="Kent Methodist Church"
                onBack={vi.fn()}
            />
        );

        expect(await screen.findByText('ABC123')).toBeInTheDocument();
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
    });

    it('marks an eligible parking registration paid and replaces it with the RPC result', async () => {
        const paidRegistration = {
            ...parkingRegistration,
            payment_status: 'paid',
            payment_method: 'in_person',
        };
        supabase._mocks.mockOrder.mockResolvedValue({
            data: [parkingRegistration],
            error: null,
        });
        supabase.rpc.mockResolvedValue({ data: [paidRegistration], error: null });

        render(
            <RegistrationViewer
                orgId="org-1"
                eventId="event-1"
                event={parkingEvent}
                organizationName="Kent Methodist Church"
                onBack={vi.fn()}
            />
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Mark Paid' }));

        await waitFor(() => expect(screen.getByText('Valid')).toBeInTheDocument());
        expect(supabase.rpc).toHaveBeenCalledWith('mark_registration_paid', {
            p_registration_id: 'parking-registration-1',
            p_org_id: 'org-1',
        });
    });
});
