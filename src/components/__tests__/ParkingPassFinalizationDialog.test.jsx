import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ParkingPassFinalizationDialog from '../ParkingPassFinalizationDialog';

const registration = {
    form_data: {
        system_first_name: 'Alex',
        system_last_name: 'Morgan',
        parking_license_plate: 'ABC123',
    },
};

describe('ParkingPassFinalizationDialog', () => {
    it('uses the physical-handoff question after printing', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        render(
            <ParkingPassFinalizationDialog
                registration={registration}
                mode="post-print"
                onConfirm={onConfirm}
                onClose={vi.fn()}
            />
        );

        expect(screen.getByRole('dialog', { name: 'Finalize printed parking pass?' })).toBeInTheDocument();
        expect(screen.getByText('Was this parking pass handed to the registrant?')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Finalize' }));
        expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('confirms undo and disables dismissal while saving', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(
            <ParkingPassFinalizationDialog
                registration={registration}
                mode="undo"
                saving
                onConfirm={vi.fn()}
                onClose={onClose}
            />
        );

        expect(screen.getByText(/reopen this pass for printing and finalization/i)).toBeInTheDocument();
        await user.keyboard('{Escape}');
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Undo Finalization' })).toBeDisabled();
    });

    it('shows a stable error and calls the close action', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(
            <ParkingPassFinalizationDialog
                registration={registration}
                mode="finalize"
                error="This pass is no longer eligible."
                onConfirm={vi.fn()}
                onClose={onClose}
            />
        );

        expect(screen.getByRole('alert')).toHaveTextContent('This pass is no longer eligible.');
        await user.click(screen.getByRole('button', { name: 'Not yet' }));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
