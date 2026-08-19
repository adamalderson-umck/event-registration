import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listEvents = vi.hoisted(() => vi.fn());
vi.mock('../../services/parkingPassFinalization', () => ({
    listParkingPassFinalizationEvents: listEvents,
}));

import ParkingPassFinalizationHistory from '../ParkingPassFinalizationHistory';

describe('ParkingPassFinalizationHistory', () => {
    beforeEach(() => vi.clearAllMocks());

    it('loads and renders newest actions when expanded', async () => {
        const user = userEvent.setup();
        listEvents.mockResolvedValue([{
            id: 'audit-1',
            action: 'finalized',
            actor_display_name: 'Admin User',
            created_at: '2026-08-19T14:30:00Z',
        }]);
        render(
            <ParkingPassFinalizationHistory
                registrationId="registration-1"
                orgId="org-1"
                refreshKey={0}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Pass History' }));
        expect(await screen.findByText('Pass finalized')).toBeInTheDocument();
        expect(screen.getByText('Admin User')).toBeInTheDocument();
        expect(listEvents).toHaveBeenCalledWith('registration-1', 'org-1');
    });

    it('shows empty history and a retry after failure', async () => {
        const user = userEvent.setup();
        listEvents.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce([]);
        render(
            <ParkingPassFinalizationHistory
                registrationId="registration-1"
                orgId="org-1"
                refreshKey={0}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Pass History' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load pass history.');
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByText('No pass finalization actions recorded.')).toBeInTheDocument();
    });
});
