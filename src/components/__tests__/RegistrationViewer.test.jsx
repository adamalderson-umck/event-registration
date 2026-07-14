import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

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

    return {
        supabase: {
            from: mockFrom,
            channel: mockChannel,
            removeChannel: vi.fn(),
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
});
