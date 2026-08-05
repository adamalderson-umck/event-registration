import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

vi.mock('@dnd-kit/core', () => ({
    DndContext: ({ children }) => <div>{children}</div>,
    closestCenter: vi.fn(),
    KeyboardSensor: vi.fn(),
    PointerSensor: vi.fn(),
    useSensor: vi.fn(),
    useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
    SortableContext: ({ children }) => <div>{children}</div>,
    arrayMove: vi.fn(),
    sortableKeyboardCoordinates: vi.fn(),
    useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null }),
    verticalListSortingStrategy: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }));

vi.mock('../FieldConfigPanel', () => ({ default: () => null }));

import FormFieldBuilder from '../FormFieldBuilder';

const fields = [
    { id: 'system_first_name', type: 'text', label: 'First Name', system: true, required: true },
    { id: 'parking_license_plate', type: 'text', label: 'License Plate', system: true, required: true },
    { id: 'custom_notes', type: 'text', label: 'Notes', required: false },
];

describe('FormFieldBuilder protected fields', () => {
    it('keeps protected fields when Clear All is confirmed', () => {
        const onChange = vi.fn();
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<FormFieldBuilder fields={fields} onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: /clear all/i }));

        expect(confirmSpy).toHaveBeenCalledWith('Remove all custom fields? Protected fields will remain.');
        expect(onChange).toHaveBeenCalledWith(fields.filter(field => field.system));
        confirmSpy.mockRestore();
    });

    it('does not render delete controls for protected fields', () => {
        render(<FormFieldBuilder fields={fields} onChange={vi.fn()} />);

        expect(screen.queryByRole('button', { name: 'Delete License Plate' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Notes' })).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: 'Select License Plate for deletion' })).not.toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Select Notes for deletion' })).toBeInTheDocument();
    });
});
