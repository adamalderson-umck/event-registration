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
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

// ── Supabase mock ─────────────────────────────────────────────────────────────
// Factory must be self-contained (no external var references due to hoisting)
vi.mock('../../services/supabase', () => {
    const mockInsertSingle = vi.fn();
    const mockInsertSelect = vi.fn(() => ({ single: mockInsertSingle }));
    const mockInsert = vi.fn(() => ({ select: mockInsertSelect }));
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
            _mocks: { mockInsert, mockInsertSelect, mockInsertSingle, mockSingle, mockFrom, mockInvoke },
        },
    };
});

// Stub SignaturePad — JSDOM doesn't support HTMLCanvasElement
vi.mock('../SignaturePad', () => ({
    default: ({ onChange }) => (
        <canvas
            data-testid="signature-pad"
            onClick={() => onChange('mock-sig-data')}
        />
    ),
}));

// Stub WaiverEditor (rich text) — not needed for form submission tests
vi.mock('../WaiverEditor', () => ({
    default: ({ content }) => <div data-testid="waiver-editor">{content}</div>,
}));

vi.mock('../RegistrationPaymentStep', () => ({
    default: ({ registration, onComplete }) => (
        <section>
            <h2>Payment Required</h2>
            <button
                onClick={() => onComplete(registration)}
            >
                Finish Mock Tithe.ly
            </button>
        </section>
    ),
}));

// Import AFTER mock is registered
import EventRegistrationForm from '../EventRegistrationForm';
import { supabase } from '../../services/supabase';

const TITHELY_FORM_ID = '123e4567-e89b-42d3-a456-426614174000';

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
        waivers: [],
        form_fields: [
            { id: 'system_first_name', type: 'text', label: 'First Name', required: true },
            { id: 'system_last_name', type: 'text', label: 'Last Name', required: true },
            { id: 'system_email', type: 'email', label: 'Email', required: true },
        ],
        ...overrides,
    };
}

function setupMocks(eventData = makeEvent(), insertError = null) {
    const { mockInsert, mockInsertSelect, mockInsertSingle, mockSingle, mockFrom, mockInvoke } = supabase._mocks;

    // Reset call history
    mockSingle.mockReset();
    mockInsertSelect.mockReset();
    mockInsertSelect.mockImplementation(() => ({ single: mockInsertSingle }));
    mockInsert.mockReset();
    mockInsert.mockImplementation(() => ({ select: mockInsertSelect }));
    mockInsertSingle.mockReset();
    mockFrom.mockClear();
    mockInvoke.mockReset();

    // Wire up the chain: .from().select().eq().eq().single()
    const mockEq2 = vi.fn(() => ({ single: mockSingle }));
    const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));
    const mockSelect = vi.fn(() => ({ eq: mockEq1 }));
    mockFrom.mockReturnValue({ select: mockSelect, insert: mockInsert });
    mockSingle.mockResolvedValue({ data: eventData, error: null });
    mockInsertSingle.mockResolvedValue({
        data: {
            id: 'registration-1',
            status: 'confirmed',
            payment_status: 'pending',
            payment_method: null,
        },
        error: insertError,
    });
    mockInvoke.mockResolvedValue({ data: { ip: '127.0.0.1' }, error: null });
}

async function completeRequiredFields({ firstName = 'John', lastName = 'Doe', email = 'john@example.com' } = {}) {
    await userEvent.type(await screen.findByLabelText(/first name/i), firstName);
    await userEvent.type(screen.getByLabelText(/last name/i), lastName);
    await userEvent.type(screen.getByLabelText(/email/i), email);
}

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('EventRegistrationForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('VITE_TURNSTILE_SITE_KEY', ''); // Disable CAPTCHA for JSDOM
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

        await completeRequiredFields();

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

    it('routes a confirmed standard registration with Tithe.ly through the payment phase', async () => {
        setupMocks(makeEvent({
            payment_enabled: true,
            payment_amount: 100,
            tithely_giving_url: `https://give.tithe.ly/?formId=${TITHELY_FORM_ID}`,
            tithely_embed_config: { formId: TITHELY_FORM_ID },
        }));
        supabase._mocks.mockInsertSingle.mockResolvedValue({
            data: { id: 'registration-1', status: 'confirmed', payment_status: 'pending', payment_method: 'tithely' },
            error: null,
        });
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findByText(/payment required/i)).toBeInTheDocument();
        expect(supabase._mocks.mockInsertSingle).toHaveBeenCalledTimes(1);
        expect(supabase._mocks.mockInsert).toHaveBeenCalledWith(expect.objectContaining({ payment_method: 'tithely' }));

        fireEvent.click(screen.getByRole('button', { name: /finish mock tithe\.ly/i }));
        expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
        expect(screen.getByText(/tithe\.ly payment is pending administrator verification/i)).toBeInTheDocument();
    });

    it('routes a confirmed parking registration through Tithe.ly and keeps it pending after local completion', async () => {
        setupMocks(makeEvent({
            event_type: 'parking',
            payment_enabled: true,
            payment_amount: 100,
            tithely_giving_url: `https://give.tithe.ly/?formId=${TITHELY_FORM_ID}`,
            tithely_embed_config: { formId: TITHELY_FORM_ID },
        }));
        supabase._mocks.mockInsertSingle.mockResolvedValue({
            data: { id: 'registration-1', status: 'confirmed', payment_status: 'pending', payment_method: 'tithely' },
            error: null,
        });
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
        expect(await screen.findByText(/payment required/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /finish mock tithe\.ly/i }));
        expect(await screen.findByText(/tithe\.ly payment is pending administrator verification/i)).toBeInTheDocument();
    });

    it('requires an explicit method selection when Tithe.ly and Pay in Person are available', async () => {
        setupMocks(makeEvent({
            payment_enabled: true,
            allow_in_person_payment: true,
            tithely_giving_url: `https://give.tithe.ly/?formId=${TITHELY_FORM_ID}`,
            tithely_embed_config: { formId: TITHELY_FORM_ID },
        }));
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Choose a payment method');
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('radio', { name: /pay in person/i }));
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
        await waitFor(() => expect(supabase._mocks.mockInsert).toHaveBeenCalledWith(expect.objectContaining({ payment_method: 'in_person' })));
    });

    it('blocks a payment-enabled event with no viable payment method before inserting', async () => {
        setupMocks(makeEvent({ payment_enabled: true }));
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findByText('No usable payment method is configured for this event.')).toBeInTheDocument();
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();
    });

    it('submits an in-person-only payment as pending without the Tithe.ly handoff', async () => {
        setupMocks(makeEvent({ payment_enabled: true, allow_in_person_payment: true }));
        supabase._mocks.mockInsertSingle.mockResolvedValue({
            data: { id: 'registration-1', status: 'confirmed', payment_status: 'pending', payment_method: 'in_person' },
            error: null,
        });
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
        expect(screen.queryByText(/payment required/i)).not.toBeInTheDocument();
        expect(screen.getByText(/payment is pending.*pay in person/i)).toBeInTheDocument();
        expect(supabase._mocks.mockInsert).toHaveBeenCalledWith(expect.objectContaining({ payment_method: 'in_person' }));
    });

    it('uses the returned waitlist status and skips Tithe.ly payment despite stale capacity counters', async () => {
        setupMocks(makeEvent({
            event_type: 'parking',
            payment_enabled: true,
            payment_amount: 100,
            tithely_giving_url: `https://give.tithe.ly/?formId=${TITHELY_FORM_ID}`,
            tithely_embed_config: { formId: TITHELY_FORM_ID },
            capacity: 10,
            registration_count: 1,
            waitlist_enabled: true,
        }));
        supabase._mocks.mockInsertSingle.mockResolvedValue({
            data: {
                id: 'registration-1',
                status: 'waitlisted',
                payment_status: 'pending',
                payment_method: 'tithely',
            },
            error: null,
        });
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findByText(/added to waitlist/i)).toBeInTheDocument();
        expect(screen.queryByText(/payment required/i)).not.toBeInTheDocument();
    });

    it('skips parking payment when the returned registration is not confirmed', async () => {
        setupMocks(makeEvent({
            event_type: 'parking',
            payment_enabled: true,
            payment_amount: 100,
            allow_in_person_payment: true,
        }));
        supabase._mocks.mockInsertSingle.mockResolvedValue({
            data: {
                id: 'registration-1',
                status: 'pending',
                payment_status: 'pending',
                payment_method: null,
            },
            error: null,
        });
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
        expect(screen.queryByText(/payment required/i)).not.toBeInTheDocument();
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

    it('ignores a stale event fetch after the requested event changes', async () => {
        setupMocks();
        const stale = deferred();
        const currentEvent = makeEvent({ id: 'evt-2', title: 'Current Event' });
        supabase._mocks.mockSingle
            .mockImplementationOnce(() => stale.promise)
            .mockResolvedValueOnce({ data: currentEvent, error: null });

        const { rerender } = render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
        rerender(<EventRegistrationForm eventId="evt-2" orgId="org-1" />);

        expect(await screen.findByRole('heading', { name: 'Current Event' })).toBeInTheDocument();

        await act(async () => {
            stale.resolve({ data: makeEvent({ title: 'Stale Event' }), error: null });
        });

        await waitFor(() => {
            expect(screen.queryByRole('heading', { name: 'Stale Event' })).not.toBeInTheDocument();
            expect(screen.getByRole('heading', { name: 'Current Event' })).toBeInTheDocument();
        });
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

    it('submits signature_records[] for multi-waiver events', async () => {
        const waivers = [
            { id: 'w1', title: 'Liability Waiver', content: '<p>Liability</p>', contentHash: 'h1', required: true, order: 0 },
            { id: 'w2', title: 'Media Release', content: '<p>Media</p>', contentHash: 'h2', required: false, order: 1 },
        ];
        setupMocks(makeEvent({ waivers }));
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        // Fill standard fields
        await userEvent.type(await screen.findByLabelText(/first name/i), 'Alice');
        await userEvent.type(screen.getByLabelText(/last name/i), 'Smith');
        await userEvent.type(screen.getByLabelText(/email/i), 'alice@example.com');

        // Waiver 1 (required) — consent checkbox then signer name then draw sig
        const checkboxes = await screen.findAllByRole('checkbox', { name: /agree to sign/i });
        fireEvent.click(checkboxes[0]);

        // Fill the signer name input for w1 (enabled after consent)
        const nameInputs = await screen.findAllByLabelText(/full legal name/i);
        await userEvent.type(nameInputs[0], 'Alice Smith');

        // Click the stubbed SignaturePad canvas so onChange('mock-sig-data') fires
        const pads = screen.getAllByTestId('signature-pad');
        fireEvent.click(pads[0]);

        // Waiver 2 (optional) — decline via radio
        const declineRadios = await screen.findAllByRole('radio', { name: /i decline/i });
        fireEvent.click(declineRadios[0]);

        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        await waitFor(() => {
            const call = supabase._mocks.mockInsert.mock.calls[0]?.[0];
            expect(call).toBeDefined();
            expect(Array.isArray(call.signature_records)).toBe(true);
            expect(call.signature_records).toHaveLength(2);
            const rec2 = call.signature_records.find((r) => r.waiverId === 'w2');
            expect(rec2?.declined).toBe(true);
        });
    });
});
