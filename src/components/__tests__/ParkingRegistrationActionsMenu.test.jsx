import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ParkingRegistrationActionsMenu from '../ParkingRegistrationActionsMenu';

const actions = () => ({
    onView: vi.fn(),
    onRecordPayment: vi.fn(),
    onPrintPass: vi.fn(),
    onFinalize: vi.fn(),
    onUndoFinalization: vi.fn(),
});

describe('ParkingRegistrationActionsMenu', () => {
    it('renders only enabled actions and invokes the selected action', async () => {
        const user = userEvent.setup();
        const handlers = actions();
        render(
            <ParkingRegistrationActionsMenu
                {...handlers}
                canRecordPayment
                canPrint
                canFinalize
                canUndo={false}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Actions' }));

        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'View', 'Record Payment', 'Print Pass', 'Finalize',
        ]);
        await user.click(screen.getByRole('menuitem', { name: 'Finalize' }));
        expect(handlers.onFinalize).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('supports arrow navigation and Escape focus restoration', async () => {
        const user = userEvent.setup();
        render(
            <ParkingRegistrationActionsMenu
                {...actions()}
                canRecordPayment={false}
                canPrint={false}
                canFinalize={false}
                canUndo
            />
        );

        const trigger = screen.getByRole('button', { name: 'Actions' });
        await user.click(trigger);
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('menuitem', { name: 'Undo Finalization' })).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(trigger).toHaveFocus();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes on an outside pointer action', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <ParkingRegistrationActionsMenu
                    {...actions()}
                    canRecordPayment={false}
                    canPrint={false}
                    canFinalize={false}
                    canUndo={false}
                />
                <button>Outside</button>
            </div>
        );

        await user.click(screen.getByRole('button', { name: 'Actions' }));
        await user.click(screen.getByRole('button', { name: 'Outside' }));
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
});
