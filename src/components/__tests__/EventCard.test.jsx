import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import EventCard from '../EventCard';

describe('EventCard', () => {
    it('shows the Parking badge only for parking events', () => {
        const onSelect = vi.fn();
        const { rerender } = render(
            <EventCard event={{ title: 'Fall Parking', event_type: 'parking' }} onSelect={onSelect} />
        );

        expect(screen.getByText('Parking')).toBeInTheDocument();

        rerender(<EventCard event={{ title: 'Fall Parking', event_type: 'standard' }} onSelect={onSelect} />);

        expect(screen.queryByText('Parking')).not.toBeInTheDocument();
    });
});
