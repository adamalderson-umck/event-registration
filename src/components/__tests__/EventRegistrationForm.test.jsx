/**
 * EventRegistrationForm — critical path tests
 *
 * Tests: form validation, submit success, submit error, full/closed/waitlisted states.
 * Supabase client is fully mocked to avoid network calls.
 *
 * NOTE: vi.mock is hoisted to top-of-file by Vitest, so the factory must NOT
 * reference const variables declared outside it. All mock functions are created
 * inside the factory and retrieved via vi.mocked() or module import.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

// ── Supabase mock ─────────────────────────────────────────────────────────────
// Factory must be self-contained (no external var references due to hoisting)
vi.mock('../../services/supabase', () => {
    const mockInsert = vi.fn();
    const mockSingle = vi.fn();
    const mockEq2 = vi.fn(() => ({ single: mockSingle }));
    const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));
    const mockSelect = vi.fn(() => ({ eq: mockEq1 }));
    const mockFrom = vi.fn(() => ({ select: mockSelect, insert: mockInsert }));
    const mockInvoke = vi.fn();

    return {
        supabase: {
            from: mockFrom,
            functions: { invoke: mockInvoke },
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
            },
            _mocks: { mockInsert, mockSingle, mockFrom, mockInvoke },
        },
    };
});

// Import AFTER mock is registered
import EventRegistrationForm from '../EventRegistrationForm';
import { supabase } from '../../services/supabase';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeEvent(overrides = {}) {
    return {
        id: 'evt-1',
        org_id: 'org-1',
        title: 'Test Event',
        status: 'active',
        registration_close_date: null,
        capacity: null,
        registration_count: 0,
        waitlist_enabled: false,
        waitlist_count: 0,
        payment_enabled: false,
        waiver_enabled: false,
        form_fields: [
            { id: 'system_first_name', type: 'text', label: 'First Name', required: true },
            { id: 'system_last_name', type: 'text', label: 'Last Name', required: true },
            { id: 'system_email', type: 'email', label: 'Email', required: true },
        ],
        ...overrides,
    };
}

function setupMocks(eventData = makeEvent(), insertError = null) {
    const { mockInsert, mockSingle, mockFrom, mockInvoke } = supabase._mocks;

    // Reset call history
    mockSingle.mockReset();
    mockInsert.mockReset();
    mockFrom.mockClear();
    mockInvoke.mockReset();

    // Wire up the chain: .from().select().eq().eq().single()
    const mockEq2 = vi.fn(() => ({ single: mockSingle }));
    const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));
    const mockSelect = vi.fn(() => ({ eq: mockEq1 }));
    mockFrom.mockReturnValue({ select: mockSelect, insert: mockInsert });
    mockSingle.mockResolvedValue({ data: eventData, error: null });
    mockInsert.mockResolvedValue({ error: insertError });
    mockInvoke.mockResolvedValue({ data: { ip: '127.0.0.1' }, error: null });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('EventRegistrationForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders form fields after loading event', async () => {
        setupMocks();
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
        expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });

    it('shows validation errors when submitting empty form', async () => {
        setupMocks();
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
        await screen.findByLabelText(/first name/i);

        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findAllByText(/this field is required/i)).toHaveLength(3);
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();
    });

    it('shows email format validation error', async () => {
        setupMocks();
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
        const emailInput = await screen.findByLabelText(/email/i);

        await userEvent.type(emailInput, 'not-an-email');
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();
    });

    it('submits successfully and shows success state', async () => {
        setupMocks();
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await userEvent.type(await screen.findByLabelText(/first name/i), 'John');
        await userEvent.type(screen.getByLabelText(/last name/i), 'Doe');
        await userEvent.type(screen.getByLabelText(/email/i), 'john@example.com');

        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        await waitFor(() => {
            expect(supabase._mocks.mockInsert).toHaveBeenCalledWith(expect.objectContaining({
                event_id: 'evt-1',
                org_id: 'org-1',
                form_data: expect.objectContaining({
                    system_email: 'john@example.com',
                }),
            }));
        });

        // SuccessState renders after submit
        expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
    });

    it('shows error message when submit fails', async () => {
        setupMocks(makeEvent(), { message: 'DB error' });
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await userEvent.type(await screen.findByLabelText(/first name/i), 'Jane');
        await userEvent.type(screen.getByLabelText(/last name/i), 'Doe');
        await userEvent.type(screen.getByLabelText(/email/i), 'jane@example.com');

        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        // Multiple elements possible (aria-live region + visible error) — at least one must match
        const errors = await screen.findAllByText(/failed to submit/i);
        expect(errors.length).toBeGreaterThan(0);
    });

    it('shows "event not found" when event fetch returns error', async () => {
        const { mockSingle, mockFrom } = supabase._mocks;
        const mockEq2 = vi.fn(() => ({ single: mockSingle }));
        const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));
        const mockSelect = vi.fn(() => ({ eq: mockEq1 }));
        mockFrom.mockReturnValue({ select: mockSelect });
        mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

        render(<EventRegistrationForm eventId="evt-999" orgId="org-1" />);
        expect(await screen.findByText(/event not found/i)).toBeInTheDocument();
    });

    it('shows "no longer accepting" when event status is not active', async () => {
        setupMocks(makeEvent({ status: 'closed' }));
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
        expect(await screen.findByText(/no longer accepting/i)).toBeInTheDocument();
    });

    it('shows "registration is full" when at capacity without waitlist', async () => {
        setupMocks(makeEvent({ capacity: 10, registration_count: 10, waitlist_enabled: false }));
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
        expect(await screen.findByText(/registration is full/i)).toBeInTheDocument();
    });

    it('shows form (not closed state) when at capacity with waitlist enabled', async () => {
        setupMocks(makeEvent({ capacity: 10, registration_count: 10, waitlist_enabled: true, waitlist_count: 3 }));
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
        // Form still renders — waitlist join path
        expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();
    });
});
