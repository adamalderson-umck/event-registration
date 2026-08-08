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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    default: () => (
        <section>
            <h2>Complete your payment with Tithe.ly</h2>
            <p>Registration received — payment pending</p>
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
    mockInsertSingle.mockResolvedValue({ data: null, error: null });
    mockInvoke.mockResolvedValue({
        data: insertError ? null : {
            id: 'registration-1',
            status: 'confirmed',
            payment_status: 'not_required',
            payment_method: null,
        },
        error: insertError,
    });
}

async function completeRequiredFields({ firstName = 'John', lastName = 'Doe', email = 'john@example.com' } = {}) {
    await userEvent.type(await screen.findByLabelText(/first name/i), firstName);
    await userEvent.type(screen.getByLabelText(/last name/i), lastName);
    await userEvent.type(screen.getByLabelText(/email/i), email);
    await waitFor(() => {
        expect(screen.getByRole('button', { name: /submit registration/i })).toBeEnabled();
    });
}

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function recentRegistrationError() {
    return {
        context: new Response(JSON.stringify({
            error: 'recent_registration',
            requestId: 'request-123',
        }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        }),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('EventRegistrationForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key');
        window.turnstile = {
            render: vi.fn((_element, options) => {
                options.callback('verified-token');
                return 'widget-1';
            }),
            reset: vi.fn(),
        };
    });

    afterEach(() => {
        delete window.turnstile;
        document.getElementById('cf-turnstile-script')?.remove();
    });

    it('renders form fields after loading event', async () => {
        setupMocks();
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
        expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });

    it('renders Turnstile after event data makes the final-page container available', async () => {
        vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key');
        const renderTurnstile = vi.fn(() => 'widget-1');
        window.turnstile = { render: renderTurnstile, reset: vi.fn() };
        setupMocks();

        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();
        await waitFor(() => {
            expect(renderTurnstile).toHaveBeenCalledWith(
                expect.any(HTMLElement),
                expect.objectContaining({ sitekey: 'test-site-key', action: 'event_registration' })
            );
        });
    });

    it('shows validation errors when submitting empty form', async () => {
        setupMocks();
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
        await screen.findByLabelText(/first name/i);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /submit registration/i })).toBeEnabled();
        });

        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findAllByText(/this field is required/i)).toHaveLength(3);
        expect(supabase._mocks.mockInvoke).not.toHaveBeenCalled();
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();
    });

    it('shows email format validation error', async () => {
        setupMocks();
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
        const emailInput = await screen.findByLabelText(/email/i);

        await userEvent.type(emailInput, 'not-an-email');
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
        expect(supabase._mocks.mockInvoke).not.toHaveBeenCalled();
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();
    });

    it('submits successfully and shows success state', async () => {
        setupMocks();
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields();

        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        await waitFor(() => {
            expect(supabase._mocks.mockInvoke).toHaveBeenCalledWith('submit-registration', {
                body: expect.objectContaining({
                    turnstileToken: 'verified-token',
                    eventId: 'evt-1',
                    orgId: 'org-1',
                    formData: expect.objectContaining({
                        system_email: 'john@example.com',
                    }),
                    paymentMethod: null,
                    signatureRecords: [],
                    submissionAttemptId: expect.stringMatching(
                        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
                    ),
                    recentDuplicateOverride: false,
                }),
            });
        });
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();

        // SuccessState renders after submit
        expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
    });

    it('preserves values and creates nothing when the user returns from a recent warning', async () => {
        setupMocks();
        supabase._mocks.mockInvoke.mockResolvedValueOnce({
            data: null,
            error: recentRegistrationError(),
        });
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields({
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@example.com',
        });
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findByRole('dialog', { name: 'You recently registered' }))
            .toBeInTheDocument();
        expect(screen.getByDisplayValue('Jane')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Doe')).toBeInTheDocument();
        expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
        expect(screen.getByText(/contact the church office/i)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Return to form' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(supabase._mocks.mockInvoke).toHaveBeenCalledTimes(1);
        expect(window.turnstile.reset).toHaveBeenCalledWith('widget-1');
    });

    it('continues a parking registration with the same attempt and a fresh Turnstile token', async () => {
        let turnstileCallback;
        window.turnstile.render.mockImplementation((_element, options) => {
            turnstileCallback = options.callback;
            options.callback('initial-token');
            return 'widget-1';
        });
        window.turnstile.reset.mockImplementation(() => turnstileCallback('fresh-token'));

        setupMocks(makeEvent({ event_type: 'parking' }));
        supabase._mocks.mockInvoke
            .mockResolvedValueOnce({ data: null, error: recentRegistrationError() })
            .mockResolvedValueOnce({
                data: {
                    id: 'registration-2',
                    status: 'confirmed',
                    payment_status: 'not_required',
                    payment_method: null,
                },
                error: null,
            });

        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
        await userEvent.click(await screen.findByRole('button', { name: 'Register another vehicle' }));

        await waitFor(() => expect(supabase._mocks.mockInvoke).toHaveBeenCalledTimes(2));
        const firstBody = supabase._mocks.mockInvoke.mock.calls[0][1].body;
        const secondBody = supabase._mocks.mockInvoke.mock.calls[1][1].body;
        expect(secondBody).toEqual(expect.objectContaining({
            submissionAttemptId: firstBody.submissionAttemptId,
            recentDuplicateOverride: true,
            turnstileToken: 'fresh-token',
        }));
        expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
    });

    it('retains values and stops when fresh Turnstile verification fails', async () => {
        let turnstileOptions;
        window.turnstile.render.mockImplementation((_element, options) => {
            turnstileOptions = options;
            options.callback('initial-token');
            return 'widget-1';
        });
        window.turnstile.reset.mockImplementation(() => turnstileOptions['error-callback']());

        setupMocks();
        supabase._mocks.mockInvoke.mockResolvedValueOnce({
            data: null,
            error: recentRegistrationError(),
        });
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields({
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@example.com',
        });
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
        await userEvent.click(await screen.findByRole('button', { name: 'Register another person' }));

        expect(supabase._mocks.mockInvoke).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Security verification failed. Please try again.',
        );
        expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
    });

    it('retains values and stops when fresh Turnstile verification is unavailable', async () => {
        setupMocks();
        supabase._mocks.mockInvoke.mockResolvedValueOnce({
            data: null,
            error: recentRegistrationError(),
        });
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields({ email: 'jane@example.com' });
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
        await screen.findByRole('dialog', { name: 'You recently registered' });
        window.turnstile.reset = undefined;
        await userEvent.click(screen.getByRole('button', { name: 'Register another person' }));

        expect(supabase._mocks.mockInvoke).toHaveBeenCalledTimes(1);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Security verification is unavailable. Please try again later.',
        );
        expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
    });

    it('keeps the attempt ID after a generic failure and changes it only for Register Another', async () => {
        setupMocks();
        supabase._mocks.mockInvoke
            .mockResolvedValueOnce({ data: null, error: { message: 'network failure' } })
            .mockResolvedValueOnce({
                data: {
                    id: 'registration-1',
                    status: 'confirmed',
                    payment_status: 'not_required',
                    payment_method: null,
                },
                error: null,
            })
            .mockResolvedValueOnce({
                data: {
                    id: 'registration-2',
                    status: 'confirmed',
                    payment_status: 'not_required',
                    payment_method: null,
                },
                error: null,
            });

        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
        expect((await screen.findAllByText(/failed to submit/i)).length).toBeGreaterThan(0);

        await act(async () => {
            window.turnstile.render.mock.calls[0][1].callback('retry-token');
        });
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /submit registration/i })).toBeEnabled();
        });
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
        expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();

        const failedAttempt = supabase._mocks.mockInvoke.mock.calls[0][1].body.submissionAttemptId;
        const retryAttempt = supabase._mocks.mockInvoke.mock.calls[1][1].body.submissionAttemptId;
        expect(retryAttempt).toBe(failedAttempt);

        await userEvent.click(screen.getByRole('button', { name: 'Register Another' }));
        await act(async () => {
            window.turnstile.render.mock.calls[0][1].callback('fresh-form-token');
        });
        await completeRequiredFields({ email: 'another@example.com' });
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        await waitFor(() => expect(supabase._mocks.mockInvoke).toHaveBeenCalledTimes(3));
        const freshAttempt = supabase._mocks.mockInvoke.mock.calls[2][1].body.submissionAttemptId;
        expect(freshAttempt).not.toBe(failedAttempt);
    });

    it('routes a confirmed standard registration with Tithe.ly through the payment phase', async () => {
        setupMocks(makeEvent({
            payment_enabled: true,
            payment_amount: 100,
            tithely_giving_url: `https://give.tithe.ly/?formId=${TITHELY_FORM_ID}`,
            tithely_embed_config: { formId: TITHELY_FORM_ID },
        }));
        supabase._mocks.mockInvoke.mockResolvedValue({
            data: { id: 'registration-1', status: 'confirmed', payment_status: 'pending', payment_method: 'tithely' },
            error: null,
        });
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', {
            name: 'Submit Registration & Continue to Tithe.ly',
        }));

        expect(await screen.findByText('Registration received — payment pending')).toBeInTheDocument();
        expect(supabase._mocks.mockInvoke).toHaveBeenCalledWith('submit-registration', {
            body: expect.objectContaining({ paymentMethod: 'tithely' }),
        });
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();
        expect(screen.queryByText(/registration submitted/i)).not.toBeInTheDocument();
    });

    it('routes a confirmed parking registration through Tithe.ly and keeps it pending after local completion', async () => {
        setupMocks(makeEvent({
            event_type: 'parking',
            payment_enabled: true,
            payment_amount: 100,
            tithely_giving_url: `https://give.tithe.ly/?formId=${TITHELY_FORM_ID}`,
            tithely_embed_config: { formId: TITHELY_FORM_ID },
        }));
        supabase._mocks.mockInvoke.mockResolvedValue({
            data: { id: 'registration-1', status: 'confirmed', payment_status: 'pending', payment_method: 'tithely' },
            error: null,
        });
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', {
            name: 'Submit Registration & Continue to Tithe.ly',
        }));
        expect(await screen.findByText('Registration received — payment pending')).toBeInTheDocument();
        expect(screen.queryByText(/registration submitted/i)).not.toBeInTheDocument();
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
        expect(screen.getByRole('button', { name: 'Submit Registration' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Choose a payment method');
        expect(supabase._mocks.mockInvoke).not.toHaveBeenCalled();
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('radio', { name: /tithe\.ly/i }));
        expect(screen.getByRole('button', {
            name: 'Submit Registration & Continue to Tithe.ly',
        })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('radio', { name: /pay in person/i }));
        expect(screen.getByRole('button', { name: 'Submit Registration' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Submit Registration' }));
        await waitFor(() => expect(supabase._mocks.mockInvoke).toHaveBeenCalledWith('submit-registration', {
            body: expect.objectContaining({ paymentMethod: 'in_person' }),
        }));
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();
    });

    it('blocks a payment-enabled event with no viable payment method before inserting', async () => {
        setupMocks(makeEvent({ payment_enabled: true }));
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findByText('No usable payment method is configured for this event.')).toBeInTheDocument();
        expect(supabase._mocks.mockInvoke).not.toHaveBeenCalled();
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();
    });

    it('submits an in-person-only payment as pending without the Tithe.ly handoff', async () => {
        setupMocks(makeEvent({ payment_enabled: true, allow_in_person_payment: true }));
        supabase._mocks.mockInvoke.mockResolvedValue({
            data: { id: 'registration-1', status: 'confirmed', payment_status: 'pending', payment_method: 'in_person' },
            error: null,
        });
        render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

        await completeRequiredFields();
        fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

        expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
        expect(screen.queryByText(/payment required/i)).not.toBeInTheDocument();
        expect(screen.getByText(/payment is pending.*pay in person/i)).toBeInTheDocument();
        expect(supabase._mocks.mockInvoke).toHaveBeenCalledWith('submit-registration', {
            body: expect.objectContaining({ paymentMethod: 'in_person' }),
        });
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();
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
        supabase._mocks.mockInvoke.mockResolvedValue({
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
        supabase._mocks.mockInvoke.mockResolvedValue({
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
        expect(window.turnstile.reset).toHaveBeenCalledWith('widget-1');
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();
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
            const call = supabase._mocks.mockInvoke.mock.calls[0];
            expect(call?.[0]).toBe('submit-registration');
            const records = call?.[1]?.body?.signatureRecords;
            expect(Array.isArray(records)).toBe(true);
            expect(records).toHaveLength(2);
            const rec2 = records.find((r) => r.waiverId === 'w2');
            expect(rec2?.declined).toBe(true);
        });
        expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();
    });
});
