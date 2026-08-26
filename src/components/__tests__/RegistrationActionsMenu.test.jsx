import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegistrationActionsMenu from '../RegistrationActionsMenu';

const items = (overrides = []) => [
    { label: 'View', onSelect: vi.fn() },
    { label: 'Retry failed email', onSelect: vi.fn(), enabled: false },
    ...overrides,
];

describe('RegistrationActionsMenu', () => {
    it('renders only enabled items and closes after selection', async () => {
        const user = userEvent.setup();
        const onView = vi.fn();
        render(
            <RegistrationActionsMenu items={[
                { label: 'View', onSelect: onView },
                { label: 'Retry failed email', onSelect: vi.fn(), enabled: false },
            ]} />
        );

        await user.click(screen.getByRole('button', { name: 'Actions' }));
        expect(screen.getAllByRole('menuitem')).toHaveLength(1);
        expect(screen.queryByRole('menuitem', { name: 'Retry failed email' }))
            .not.toBeInTheDocument();
        await user.click(screen.getByRole('menuitem', { name: 'View' }));
        expect(onView).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('supports ArrowUp, ArrowDown, Home, End, and Escape focus restoration', async () => {
        const user = userEvent.setup();
        render(<RegistrationActionsMenu items={items([
            { label: 'Record Payment', onSelect: vi.fn() },
            { label: 'Print Pass', onSelect: vi.fn() },
        ])} />);

        const trigger = screen.getByRole('button', { name: 'Actions' });
        await user.click(trigger);
        expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('menuitem', { name: 'Record Payment' })).toHaveFocus();
        await user.keyboard('{End}');
        expect(screen.getByRole('menuitem', { name: 'Print Pass' })).toHaveFocus();
        await user.keyboard('{Home}');
        expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus();
        await user.keyboard('{ArrowUp}');
        expect(screen.getByRole('menuitem', { name: 'Print Pass' })).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(trigger).toHaveFocus();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes on an outside pointer action', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <RegistrationActionsMenu items={items()} />
                <button>Outside</button>
            </div>
        );

        await user.click(screen.getByRole('button', { name: 'Actions' }));
        await user.click(screen.getByRole('button', { name: 'Outside' }));
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('disables the trigger', async () => {
        const user = userEvent.setup();
        render(<RegistrationActionsMenu items={items()} disabled />);

        const trigger = screen.getByRole('button', { name: 'Actions' });
        expect(trigger).toBeDisabled();
        await user.click(trigger);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
});
