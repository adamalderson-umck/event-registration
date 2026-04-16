import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import DynamicField from '../DynamicField';

describe('DynamicField', () => {
    const mockOnChange = vi.fn();

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders text field', () => {
        render(
            <DynamicField
                field={{ id: 'f1', type: 'text', label: 'Full Name', required: true }}
                value=""
                onChange={mockOnChange}
            />
        );
        expect(screen.getByLabelText(/Full Name/)).toBeInTheDocument();
    });

    it('renders email field', () => {
        render(
            <DynamicField
                field={{ id: 'f2', type: 'email', label: 'Email', required: true }}
                value=""
                onChange={mockOnChange}
            />
        );
        const input = screen.getByLabelText(/Email/);
        expect(input).toHaveAttribute('type', 'email');
    });

    it('renders phone field as tel type', () => {
        render(
            <DynamicField
                field={{ id: 'f3', type: 'phone', label: 'Phone', required: false }}
                value=""
                onChange={mockOnChange}
            />
        );
        const input = screen.getByLabelText(/Phone/);
        expect(input).toHaveAttribute('type', 'tel');
    });

    it('renders number field', () => {
        render(
            <DynamicField
                field={{ id: 'f4', type: 'number', label: 'Age', required: false }}
                value=""
                onChange={mockOnChange}
            />
        );
        const input = screen.getByLabelText(/Age/);
        expect(input).toHaveAttribute('type', 'number');
    });

    it('renders date field', () => {
        render(
            <DynamicField
                field={{ id: 'f5', type: 'date', label: 'Birth Date', required: false }}
                value=""
                onChange={mockOnChange}
            />
        );
        const input = screen.getByLabelText(/Birth Date/);
        expect(input).toHaveAttribute('type', 'date');
    });

    it('renders textarea field', () => {
        render(
            <DynamicField
                field={{ id: 'f6', type: 'textarea', label: 'Notes', required: false }}
                value=""
                onChange={mockOnChange}
            />
        );
        expect(screen.getByLabelText(/Notes/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Notes/).tagName.toLowerCase()).toBe('textarea');
    });

    it('renders select field with options', () => {
        render(
            <DynamicField
                field={{ id: 'f7', type: 'select', label: 'T-Shirt Size', required: true, options: ['S', 'M', 'L'] }}
                value=""
                onChange={mockOnChange}
            />
        );
        expect(screen.getByLabelText(/T-Shirt Size/)).toBeInTheDocument();
        expect(screen.getByText('S')).toBeInTheDocument();
        expect(screen.getByText('M')).toBeInTheDocument();
        expect(screen.getByText('L')).toBeInTheDocument();
    });

    it('renders checkbox field', () => {
        render(
            <DynamicField
                field={{ id: 'f8', type: 'checkbox', label: 'I agree', required: true }}
                value={false}
                onChange={mockOnChange}
            />
        );
        expect(screen.getByLabelText(/I agree/)).toBeInTheDocument();
    });

    it('renders checkboxGroup field', () => {
        render(
            <DynamicField
                field={{ id: 'f9', type: 'checkboxGroup', label: 'Allergies', required: false, options: ['Nuts', 'Dairy', 'Gluten'] }}
                value={[]}
                onChange={mockOnChange}
            />
        );
        expect(screen.getByText('Nuts')).toBeInTheDocument();
        expect(screen.getByText('Dairy')).toBeInTheDocument();
        expect(screen.getByText('Gluten')).toBeInTheDocument();
    });

    it('renders radio field', () => {
        render(
            <DynamicField
                field={{ id: 'f10', type: 'radio', label: 'Shirt Color', required: true, options: ['Red', 'Blue'] }}
                value=""
                onChange={mockOnChange}
            />
        );
        expect(screen.getByText('Red')).toBeInTheDocument();
        expect(screen.getByText('Blue')).toBeInTheDocument();
    });

    it('calls onChange when text input changes', () => {
        render(
            <DynamicField
                field={{ id: 'f1', type: 'text', label: 'Name', required: true }}
                value=""
                onChange={mockOnChange}
            />
        );
        fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'John' } });
        expect(mockOnChange).toHaveBeenCalledWith('f1', 'John');
    });

    it('shows error message when provided', () => {
        render(
            <DynamicField
                field={{ id: 'f1', type: 'text', label: 'Name', required: true }}
                value=""
                onChange={mockOnChange}
                error="This field is required"
            />
        );
        expect(screen.getByText('This field is required')).toBeInTheDocument();
    });

    it('shows required indicator on label', () => {
        render(
            <DynamicField
                field={{ id: 'f1', type: 'text', label: 'Name', required: true }}
                value=""
                onChange={mockOnChange}
            />
        );
        expect(screen.getByText('*')).toBeInTheDocument();
    });
});
