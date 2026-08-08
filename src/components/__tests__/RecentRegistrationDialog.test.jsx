import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import RecentRegistrationDialog from '../RecentRegistrationDialog';

function renderDialog(eventType = 'standard') {
    const onReturn = vi.fn();
    const onContinue = vi.fn();
    render(
        <RecentRegistrationDialog
            eventType={eventType}
            onReturn={onReturn}
            onContinue={onContinue}
        />,
    );
    return { onReturn, onContinue };
}

describe('RecentRegistrationDialog', () => {
    it.each([
        ['standard', 'another person', 'Register another person'],
        ['parking', 'another vehicle', 'Register another vehicle'],
        ['future-type', 'another registration', 'Submit another registration'],
    ])('uses approved %s event wording', (eventType, subject, action) => {
        renderDialog(eventType);

        expect(screen.getByRole('dialog', { name: 'You recently registered' }))
            .toHaveAttribute('aria-modal', 'true');
        const instruction = screen.getByText(/within the last 10 minutes/i);
        expect(instruction).toHaveTextContent(/contact the church office/i);
        expect(instruction).toHaveTextContent(
            new RegExp(`If you are registering ${subject}, you may continue`, 'i'),
        );
        expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('focuses the safe action, traps Tab, and restores prior focus', async () => {
        const user = userEvent.setup();
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();

        const { unmount } = render(
            <RecentRegistrationDialog
                eventType="standard"
                onReturn={vi.fn()}
                onContinue={vi.fn()}
            />,
        );

        const safeAction = screen.getByRole('button', { name: 'Return to form' });
        const continueAction = screen.getByRole('button', { name: 'Register another person' });
        expect(safeAction).toHaveFocus();
        await user.tab({ shift: true });
        expect(continueAction).toHaveFocus();
        await user.tab();
        expect(safeAction).toHaveFocus();

        unmount();
        expect(trigger).toHaveFocus();
        trigger.remove();
    });

    it('uses Escape and the safe button as Return, and calls Continue separately', async () => {
        const user = userEvent.setup();
        const { onReturn, onContinue } = renderDialog('parking');

        await user.keyboard('{Escape}');
        expect(onReturn).toHaveBeenCalledTimes(1);
        expect(onContinue).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Return to form' }));
        expect(onReturn).toHaveBeenCalledTimes(2);

        await user.click(screen.getByRole('button', { name: 'Register another vehicle' }));
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite the destination focus chosen by Continue', async () => {
        const user = userEvent.setup();
        const securityTarget = document.createElement('div');
        securityTarget.tabIndex = -1;
        document.body.append(securityTarget);
        const onContinue = vi.fn(() => securityTarget.focus());
        const { unmount } = render(
            <RecentRegistrationDialog
                eventType="standard"
                onReturn={vi.fn()}
                onContinue={onContinue}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Register another person' }));
        unmount();

        expect(onContinue).toHaveBeenCalledTimes(1);
        expect(securityTarget).toHaveFocus();
        securityTarget.remove();
    });
});
