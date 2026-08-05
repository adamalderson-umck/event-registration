import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import EventTypeChooser from '../EventTypeChooser';

describe('EventTypeChooser', () => {
    it('chooses the parking preset', () => {
        const onChoose = vi.fn();
        render(<EventTypeChooser onChoose={onChoose} onCancel={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /parking registration/i }));

        expect(onChoose).toHaveBeenCalledWith('parking');
    });

    it('cancels event creation', () => {
        const onCancel = vi.fn();
        render(<EventTypeChooser onChoose={vi.fn()} onCancel={onCancel} />);

        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        expect(onCancel).toHaveBeenCalledOnce();
    });
});
