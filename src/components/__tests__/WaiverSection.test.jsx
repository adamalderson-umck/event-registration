/**
 * WaiverSection tests — multi-waiver admin editor
 *
 * DnD kit and WaiverEditor are stubbed so tests run in JSDOM without pointer events.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';

// Stub DnD kit — all we need is passthrough wrappers
vi.mock('@dnd-kit/core', () => ({
    DndContext: ({ children }) => <div data-testid="dnd-context">{children}</div>,
    closestCenter: vi.fn(),
    PointerSensor: vi.fn(),
    KeyboardSensor: vi.fn(),
    useSensor: vi.fn(),
    useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
    SortableContext: ({ children }) => <div data-testid="sortable-context">{children}</div>,
    useSortable: () => ({
        attributes: {},
        listeners: {},
        setNodeRef: vi.fn(),
        transform: null,
        transition: null,
    }),
    verticalListSortingStrategy: vi.fn(),
    sortableKeyboardCoordinates: vi.fn(),
    arrayMove: (arr, from, to) => {
        const next = [...arr];
        next.splice(to, 0, next.splice(from, 1)[0]);
        return next;
    },
}));

vi.mock('@dnd-kit/utilities', () => ({
    CSS: { Transform: { toString: () => '' } },
}));

// Stub WaiverEditor (rich text editor) as a simple textarea
vi.mock('../WaiverEditor', () => ({
    default: ({ content, onChange }) => (
        <textarea
            data-testid="waiver-editor"
            value={content || ''}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
}));

import WaiverSection from '../WaiverSection';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeWaiver(overrides = {}) {
    return {
        id: 'w1',
        title: 'Liability Waiver',
        content: '<p>Waiver text</p>',
        contentHash: '',
        required: true,
        order: 0,
        ...overrides,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('WaiverSection', () => {
    it('renders "Add Waiver" button when waivers is empty', () => {
        render(<WaiverSection waivers={[]} onChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: /add waiver/i })).toBeInTheDocument();
    });

    it('calls onChange with a new waiver when "Add Waiver" is clicked', () => {
        const onChange = vi.fn();
        render(<WaiverSection waivers={[]} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /add waiver/i }));
        expect(onChange).toHaveBeenCalledOnce();
        const newWaivers = onChange.mock.calls[0][0];
        expect(newWaivers).toHaveLength(1);
        expect(newWaivers[0]).toMatchObject({ title: '', required: true, order: 0 });
        expect(newWaivers[0].id).toBeDefined();
    });

    it('renders a title input for each waiver', () => {
        const waivers = [
            makeWaiver({ id: 'w1', title: 'Liability Waiver' }),
            makeWaiver({ id: 'w2', title: 'Media Release', required: false, order: 1 }),
        ];
        render(<WaiverSection waivers={waivers} onChange={vi.fn()} />);
        expect(screen.getByDisplayValue('Liability Waiver')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Media Release')).toBeInTheDocument();
    });

    it('calls onChange without the deleted waiver when delete is clicked', () => {
        const onChange = vi.fn();
        const waivers = [makeWaiver()];
        render(<WaiverSection waivers={waivers} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /delete waiver/i }));
        expect(onChange).toHaveBeenCalledWith([]);
    });

    it('calls onChange with updated title when title input changes', () => {
        const onChange = vi.fn();
        const waiver = makeWaiver({ title: 'Old Title' });
        render(<WaiverSection waivers={[waiver]} onChange={onChange} />);
        fireEvent.change(screen.getByDisplayValue('Old Title'), {
            target: { value: 'New Title' },
        });
        const updatedWaivers = onChange.mock.calls[0][0];
        expect(updatedWaivers[0].title).toBe('New Title');
    });

    it('shows "Required" checkbox checked for required waivers', () => {
        render(<WaiverSection waivers={[makeWaiver({ required: true })]} onChange={vi.fn()} />);
        const checkbox = screen.getByRole('checkbox', { name: /required/i });
        expect(checkbox).toBeChecked();
    });

    it('shows "Required" checkbox unchecked for optional waivers', () => {
        render(<WaiverSection waivers={[makeWaiver({ required: false })]} onChange={vi.fn()} />);
        const checkbox = screen.getByRole('checkbox', { name: /required/i });
        expect(checkbox).not.toBeChecked();
    });
});
