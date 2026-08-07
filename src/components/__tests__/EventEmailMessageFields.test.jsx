import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EventEmailMessageFields from '../EventEmailMessageFields';

describe('EventEmailMessageFields', () => {
    it('edits confirmation text for every event', () => {
        const onChange = vi.fn();
        render(
            <EventEmailMessageFields
                confirmationMessage="Current confirmation"
                reminderMessage=""
                reminderEnabled={false}
                onChange={onChange}
            />
        );

        fireEvent.change(screen.getByLabelText('Confirmation Email Message'), {
            target: { value: 'Pickup at the church office.' },
        });
        expect(onChange).toHaveBeenCalledWith(
            'confirmationMessage',
            'Pickup at the church office.'
        );
    });

    it('disables reminder editing until a reminder time is configured', () => {
        const { rerender } = render(
            <EventEmailMessageFields
                confirmationMessage="Confirmation"
                reminderMessage="Preserved reminder"
                reminderEnabled={false}
                onChange={vi.fn()}
            />
        );

        expect(screen.getByLabelText('Reminder Email Message')).toBeDisabled();
        expect(screen.getByText('Set a reminder time to edit this message.')).toBeInTheDocument();

        rerender(
            <EventEmailMessageFields
                confirmationMessage="Confirmation"
                reminderMessage="Preserved reminder"
                reminderEnabled
                onChange={vi.fn()}
            />
        );
        expect(screen.getByLabelText('Reminder Email Message')).toBeEnabled();
        expect(screen.getByLabelText('Reminder Email Message')).toHaveValue('Preserved reminder');
    });
});
