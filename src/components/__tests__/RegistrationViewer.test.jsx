import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PARKING_FIELD_IDS } from '../../config/eventPresets';

const { downloadCsvMock, downloadPaymentLedgerCsvMock } = vi.hoisted(() => ({
    downloadCsvMock: vi.fn(),
    downloadPaymentLedgerCsvMock: vi.fn(),
}));

vi.mock('../../utils/exportCsv', () => ({
    downloadCsv: downloadCsvMock,
    downloadPaymentLedgerCsv: downloadPaymentLedgerCsvMock,
}));

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
        payment_expected_amount: 50,
        payment_recorded_total: 0,
        registration_payments: [],
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
                payment_status: 'not_required',
                payment_recorded_total: 0,
                registration_payments: [],
                form_data: { name: 'Alex' },
                signature_records: [
                    { waiverId: 'liability', signed: true, declined: false },
                    { waiverId: 'media', signed: false, declined: true },
                ],
            }],
            error: null,
        });
    });

    it('renders Waiver and Media before Status, with Payment before Actions', async () => {
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
        expect(headers).toEqual(['Name', 'Waiver', 'Media', 'Status', 'Payment', 'Actions']);

        const rows = within(table).getAllByRole('row');
        const cells = within(rows[1])
            .getAllByRole('cell')
            .map((cell) => cell.textContent.trim());
        expect(cells).toEqual(['Alex', 'Signed', 'Declined', 'confirmed', 'Not required', 'View']);
    });

    it('records a check payment and preserves the registrant-selected method', async () => {
        const user = userEvent.setup();
        const pendingRegistration = {
            id: 'registration-1',
            status: 'confirmed',
            payment_status: 'pending',
            payment_method: 'in_person',
            payment_expected_amount: 50,
            payment_recorded_total: 0,
            registration_payments: [],
            form_data: { name: 'Alex' },
            signature_records: [],
        };
        const refreshedRegistration = {
            ...pendingRegistration,
            payment_status: 'partial',
            payment_recorded_total: 25,
        };
        const payment = {
            id: 'payment-1',
            method: 'check',
            amount: 25,
            payment_date: '2026-08-05',
            reference_number: '1042',
            created_at: '2026-08-05T12:00:00Z',
            created_by: 'admin-1',
        };
        supabase._mocks.mockOrder.mockResolvedValue({ data: [pendingRegistration], error: null });
        supabase.rpc.mockResolvedValue({
            data: { registration: refreshedRegistration, payments: [payment] },
            error: null,
        });

        render(<RegistrationViewer orgId="org-1" eventId="event-1" event={{ ...event, payment_enabled: true }} onBack={vi.fn()} />);

        await user.click(await screen.findByRole('button', { name: 'Record Payment' }));
        const dialog = await screen.findByRole('dialog', { name: 'Record payment' });
        await user.selectOptions(within(dialog).getByLabelText('Payment method'), 'check');
        await user.type(within(dialog).getByLabelText(/^Amount/), '25');
        await user.type(within(dialog).getByLabelText(/^Check number/), '1042');
        await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));

        await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('record_registration_payment', {
            p_registration_id: 'registration-1',
            p_org_id: 'org-1',
            p_method: 'check',
            p_amount: 25,
            p_payment_date: expect.any(String),
            p_reference_number: '1042',
        }));
        expect(refreshedRegistration.payment_method).toBe('in_person');
        expect(await screen.findByText('Partially Paid — $25.00 of $50.00')).toBeInTheDocument();
    });

    it('shows a Transaction ID duplicate error without clearing entered values', async () => {
        const user = userEvent.setup();
        const pendingRegistration = {
            id: 'registration-1',
            status: 'confirmed',
            payment_status: 'pending',
            payment_method: 'tithely',
            payment_expected_amount: 50,
            payment_recorded_total: 0,
            registration_payments: [],
            form_data: { name: 'Alex' },
            signature_records: [],
        };
        supabase._mocks.mockOrder.mockResolvedValue({ data: [pendingRegistration], error: null });
        supabase.rpc.mockResolvedValue({
            data: null,
            error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "registration_payments_active_tithely_reference_org_key"',
            },
        });

        render(<RegistrationViewer orgId="org-1" eventId="event-1" event={{ ...event, payment_enabled: true }} onBack={vi.fn()} />);

        await user.click(await screen.findByRole('button', { name: 'Record Payment' }));
        const dialog = await screen.findByRole('dialog', { name: 'Record payment' });
        await user.selectOptions(within(dialog).getByLabelText('Payment method'), 'tithely');
        await user.type(within(dialog).getByLabelText(/^Amount/), '25');
        await user.type(within(dialog).getByLabelText(/^Transaction ID/), 'TX-42');
        await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));

        expect(await within(dialog).findByRole('alert')).toHaveTextContent(
            'This Tithe.ly Transaction ID has already been recorded.',
        );
        expect(within(dialog).getByLabelText(/^Amount/)).toHaveValue(25);
        expect(within(dialog).getByLabelText(/^Transaction ID/)).toHaveValue('TX-42');
    });

    it('keeps Record Payment available after paid because donations are uncapped', async () => {
        supabase._mocks.mockOrder.mockResolvedValue({
            data: [{
                id: 'registration-1',
                status: 'confirmed',
                payment_status: 'paid',
                payment_method: 'in_person',
                payment_expected_amount: 50,
                payment_recorded_total: 75,
                registration_payments: [],
                form_data: { name: 'Alex' },
                signature_records: [],
            }],
            error: null,
        });

        render(<RegistrationViewer orgId="org-1" eventId="event-1" event={{ ...event, payment_enabled: true }} onBack={vi.fn()} />);

        expect(await screen.findByRole('button', { name: 'Record Payment' })).toBeInTheDocument();
        expect(screen.getByText('Paid — $75.00 recorded')).toBeInTheDocument();
    });

    it('does not offer Record Payment for an ineligible standard registration', async () => {
        supabase._mocks.mockOrder.mockResolvedValue({
            data: [{
                id: 'registration-1',
                status: 'waitlisted',
                payment_status: 'pending',
                payment_method: 'tithely',
                payment_expected_amount: 50,
                payment_recorded_total: 0,
                registration_payments: [],
                form_data: { name: 'Alex' },
                signature_records: [],
            }],
            error: null,
        });

        render(<RegistrationViewer orgId="org-1" eventId="event-1" event={{ ...event, payment_enabled: true }} onBack={vi.fn()} />);

        await screen.findByText('Alex');
        expect(screen.queryByRole('button', { name: 'Record Payment' })).not.toBeInTheDocument();
    });

    it('voids a payment and replaces the registration projection from the RPC result', async () => {
        const user = userEvent.setup();
        const payment = {
            id: 'payment-1',
            method: 'cash',
            amount: 25,
            payment_date: '2026-08-05',
            created_at: '2026-08-05T12:00:00Z',
            created_by: 'admin-1',
        };
        const partialRegistration = {
            id: 'registration-1',
            status: 'confirmed',
            payment_status: 'partial',
            payment_method: 'in_person',
            payment_expected_amount: 50,
            payment_recorded_total: 25,
            registration_payments: [payment],
            form_data: { name: 'Alex' },
            signature_records: [],
        };
        const pendingRegistration = {
            ...partialRegistration,
            payment_status: 'pending',
            payment_recorded_total: 0,
        };
        const voidedPayment = {
            ...payment,
            voided_at: '2026-08-05T13:00:00Z',
            voided_by: 'admin-1',
            void_reason: 'Entered twice',
        };
        supabase._mocks.mockOrder.mockResolvedValue({ data: [partialRegistration], error: null });
        supabase.rpc.mockResolvedValue({
            data: { registration: pendingRegistration, payments: [voidedPayment] },
            error: null,
        });

        render(<RegistrationViewer orgId="org-1" eventId="event-1" event={{ ...event, payment_enabled: true }} onBack={vi.fn()} />);

        await user.click(await screen.findByRole('button', { name: /view/i }));
        await user.click(screen.getByRole('button', { name: 'Void Payment' }));
        await user.type(screen.getByLabelText(/^Void reason/), 'Entered twice');
        await user.click(screen.getByRole('button', { name: 'Confirm Void' }));

        await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('void_registration_payment', {
            p_payment_id: 'payment-1',
            p_registration_id: 'registration-1',
            p_org_id: 'org-1',
            p_void_reason: 'Entered twice',
        }));
        expect(await screen.findByText('Pending — $0.00 recorded')).toBeInTheDocument();
        expect(screen.getByText('Voided: Entered twice')).toBeInTheDocument();
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

        fireEvent.click(screen.getByTitle('Export Payment Ledger'));
        expect(downloadPaymentLedgerCsvMock).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 'registration-1' })],
            event.form_fields,
            event,
            'Beta_Event_payments.csv',
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

    it('opens payment entry for an eligible parking registration', async () => {
        const user = userEvent.setup();
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

        await user.click(await screen.findByRole('button', { name: 'Record Payment' }));

        expect(await screen.findByRole('dialog', { name: 'Record payment' })).toBeInTheDocument();
    });
});
