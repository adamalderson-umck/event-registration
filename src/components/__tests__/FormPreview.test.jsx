import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FormPreview from '../FormPreview';

// Minimal mock for formConditions
vi.mock('../../utils/formConditions', () => ({
    evaluateCondition: (condition) => {
        if (!condition) return true;
        // For testing, return false when condition.fieldId === 'hide_me'
        return condition.fieldId !== 'hide_me';
    },
    splitIntoPages: (fields) => {
        const pages = [];
        let current = { title: '', fields: [] };
        for (const f of fields) {
            if (f.type === 'sectionBreak') {
                if (current.fields.length > 0) pages.push(current);
                current = { title: f.label || '', fields: [] };
            } else {
                current.fields.push(f);
            }
        }
        if (current.fields.length > 0 || pages.length === 0) pages.push(current);
        return pages;
    },
}));

vi.mock('../../constants/themePresets', () => ({
    resolveTheme: (eventTheme) => {
        if (eventTheme?.primaryColor) {
            return { primary: eventTheme.primaryColor, accent: eventTheme.accentColor || '#8b5cf6' };
        }
        return { primary: '#2563eb', accent: '#8b5cf6', presetId: 'default' };
    },
    resolveHeaderImage: (eventUrl) => eventUrl || null,
}));

const baseEvent = {
    title: 'VBS 2026',
    description: 'Come join us for Vacation Bible School!',
    location: 'Fellowship Hall',
    start_date: '2026-07-10T09:00:00',
    form_fields: [
        { id: 'f1', type: 'text', label: 'First Name', required: true },
        { id: 'f2', type: 'email', label: 'Email', required: true },
    ],
    theme: null,
    header_image_url: null,
    waivers: [],
    capacity: null,
    registration_count: 0,
    waitlist_enabled: false,
    payment_enabled: false,
};

describe('FormPreview', () => {
    it('renders event title and description', () => {
        render(<FormPreview event={baseEvent} readOnly={true} />);
        expect(screen.getByText('VBS 2026')).toBeInTheDocument();
        expect(screen.getByText('Come join us for Vacation Bible School!')).toBeInTheDocument();
    });

    it('lets users expand a description when the responsive line clamp clips it', () => {
        const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100);
        const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);

        render(
            <FormPreview
                event={{ ...baseEvent, header_image_url: 'https://example.com/header.jpg' }}
                readOnly={true}
            />,
        );

        const description = screen.getByText('Come join us for Vacation Bible School!');
        const toggle = screen.getByRole('button', { name: 'Show more' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(description).toHaveClass('line-clamp-2', 'md:line-clamp-4');

        fireEvent.click(toggle);

        expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
        expect(description).not.toHaveClass('line-clamp-2', 'md:line-clamp-4');

        scrollHeight.mockRestore();
        clientHeight.mockRestore();
    });

    it('renders event location and date', () => {
        render(<FormPreview event={baseEvent} readOnly={true} />);
        expect(screen.getByText('Fellowship Hall')).toBeInTheDocument();
        // Date will be rendered in en-US locale
        expect(screen.getByText(/Jul/)).toBeInTheDocument();
    });

    it('renders gradient header when no header_image_url', () => {
        const { container } = render(<FormPreview event={baseEvent} readOnly={true} />);
        // Should have a div with gradient background, not an img tag
        const img = container.querySelector('img');
        expect(img).toBeNull();
    });

    it('renders header image when header_image_url is set', () => {
        const eventWithImage = {
            ...baseEvent,
            header_image_url: 'https://example.com/header.jpg',
        };
        render(<FormPreview event={eventWithImage} readOnly={true} />);
        const img = screen.getByAltText('VBS 2026');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'https://example.com/header.jpg');
    });

    it('renders form fields', () => {
        render(<FormPreview event={baseEvent} readOnly={true} />);
        expect(screen.getByText('First Name')).toBeInTheDocument();
        expect(screen.getByText('Email')).toBeInTheDocument();
    });

    it('renders stepper when form has section breaks (multi-page)', () => {
        const multiPageEvent = {
            ...baseEvent,
            form_fields: [
                { id: 'f1', type: 'text', label: 'Name', required: true },
                { id: 'sb1', type: 'sectionBreak', label: 'Page 2' },
                { id: 'f2', type: 'email', label: 'Email', required: true },
            ],
        };
        render(<FormPreview event={multiPageEvent} readOnly={true} />);
        // Should render step indicators (two pages = dots 1 and 2)
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('hides conditional fields when condition is unmet', () => {
        const conditionalEvent = {
            ...baseEvent,
            form_fields: [
                { id: 'f1', type: 'text', label: 'Visible Field', required: false },
                { id: 'f2', type: 'text', label: 'Hidden Field', required: false, condition: { fieldId: 'hide_me' } },
            ],
        };
        render(<FormPreview event={conditionalEvent} readOnly={true} />);
        expect(screen.getByText('Visible Field')).toBeInTheDocument();
        expect(screen.queryByText('Hidden Field')).not.toBeInTheDocument();
    });

    it('does not render interactive submit button when readOnly', () => {
        render(<FormPreview event={baseEvent} readOnly={true} />);
        // Should render a static div preview of the button, not an actual <button type="submit">
        const submitButton = screen.queryByRole('button', { name: /Submit Registration/i });
        expect(submitButton).toBeNull();
        // But the text should still be visible as a preview
        expect(screen.getByText(/Submit Registration/)).toBeInTheDocument();
    });

    it('uses a caller-provided final submit label', () => {
        render(
            <FormPreview
                event={baseEvent}
                submitLabel="Submit Registration & Continue to Tithe.ly"
                onSubmit={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', {
            name: 'Submit Registration & Continue to Tithe.ly',
        })).toBeInTheDocument();
    });

    it('shows waiver placeholder in readOnly mode when waivers are configured', () => {
        const waiverEvent = {
            ...baseEvent,
            waivers: [
                { id: 'w1', title: 'Liability Waiver', content: '<p>Terms</p>', required: true, order: 0 },
            ],
        };
        render(<FormPreview event={waiverEvent} readOnly={true} />);
        expect(screen.getByText(/Waiver.*section will appear here/i)).toBeInTheDocument();
    });

    it('renders the payment slot only on the last page', () => {
        const multiPageEvent = {
            ...baseEvent,
            form_fields: [
                { id: 'f1', type: 'text', label: 'Name', required: true },
                { id: 'sb1', type: 'sectionBreak', label: 'Payment' },
                { id: 'f2', type: 'email', label: 'Email', required: true },
            ],
        };
        const paymentSlot = <div>Payment method selection</div>;

        const { rerender } = render(
            <FormPreview event={multiPageEvent} currentPage={0} paymentSlot={paymentSlot} />,
        );
        expect(screen.queryByText('Payment method selection')).not.toBeInTheDocument();

        rerender(<FormPreview event={multiPageEvent} currentPage={1} paymentSlot={paymentSlot} />);
        expect(screen.getByText('Payment method selection')).toBeInTheDocument();
    });

    it('shows empty state message when no fields are configured', () => {
        const emptyEvent = {
            ...baseEvent,
            form_fields: [],
        };
        render(<FormPreview event={emptyEvent} readOnly={true} />);
        expect(screen.getByText(/Add fields in the builder/)).toBeInTheDocument();
    });

    it('returns null when event is not provided', () => {
        const { container } = render(<FormPreview event={null} readOnly={true} />);
        expect(container.innerHTML).toBe('');
    });
});
