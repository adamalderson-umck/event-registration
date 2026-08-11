import { describe, expect, it, vi } from 'vitest';
import { createUpdateRegistrationAnswersHandler } from './handler.ts';

const ids = {
  registration: '33333333-3333-4333-8333-333333333333',
  event: '11111111-1111-4111-8111-111111111111',
  org: '22222222-2222-4222-8222-222222222222',
  user: '44444444-4444-4444-8444-444444444444',
};

const event = {
  id: ids.event,
  org_id: ids.org,
  status: 'closed',
  form_fields: [
    { id: 'plate', type: 'text', label: 'License Plate', required: true },
  ],
};

const registration = {
  id: ids.registration,
  org_id: ids.org,
  event_id: ids.event,
  status: 'confirmed',
  form_data: { plate: 'TEMP', retired: 'keep' },
  signature_records: [],
  payment_status: 'paid',
};

const body = {
  registrationId: ids.registration,
  orgId: ids.org,
  expectedFormData: registration.form_data,
  answers: { plate: 'ABC123' },
};

function post(
  value: unknown = body,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://example.test/update-registration-answers', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(value),
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    authenticate: vi.fn(async () => ({
      id: ids.user,
      email: 'admin@kentmethodist.org',
    })),
    isMember: vi.fn(async () => true),
    loadRegistration: vi.fn(async () => registration),
    loadEvent: vi.fn(async () => event),
    loadEditorName: vi.fn(async () => 'Admin User'),
    applyEdit: vi.fn(async (args) => ({
      ok: true,
      registration: { ...registration, form_data: args.newFormData },
      edit: { id: 'edit-1', changes: args.changes },
    })),
    log: vi.fn(),
    requestId: vi.fn(() => 'request-1'),
    ...overrides,
  };
}

describe('update-registration-answers handler', () => {
  it('answers browser preflight requests for the production origin', async () => {
    const response = await createUpdateRegistrationAnswersHandler(dependencies())(
      new Request('https://example.test/update-registration-answers', {
        method: 'OPTIONS',
        headers: { Origin: 'https://events.kentmethodist.org' },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://events.kentmethodist.org',
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('includes the production origin on POST responses', async () => {
    const response = await createUpdateRegistrationAnswersHandler(dependencies())(
      post(body, { Origin: 'https://events.kentmethodist.org' }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://events.kentmethodist.org',
    );
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('uses trusted identity and canonical values for a successful edit', async () => {
    const deps = dependencies();
    const response = await createUpdateRegistrationAnswersHandler(deps)(post());

    expect(response.status).toBe(200);
    expect(deps.applyEdit).toHaveBeenCalledWith(expect.objectContaining({
      registrationId: ids.registration,
      orgId: ids.org,
      eventId: ids.event,
      editorUserId: ids.user,
      editorDisplayName: 'Admin User',
      expectedFormData: registration.form_data,
      newFormData: { retired: 'keep', plate: 'ABC123' },
      changes: [{
        fieldId: 'plate',
        fieldLabel: 'License Plate',
        before: 'TEMP',
        after: 'ABC123',
      }],
    }));
  });

  it('returns canonical data without mutation for a no-op', async () => {
    const deps = dependencies();
    const response = await createUpdateRegistrationAnswersHandler(deps)(post({
      ...body,
      answers: { plate: 'TEMP' },
    }));

    expect(response.status).toBe(200);
    expect(deps.applyEdit).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ registration, edit: null });
  });

  it('rejects a stale snapshot even when proposed answers match current data', async () => {
    const deps = dependencies();
    const response = await createUpdateRegistrationAnswersHandler(deps)(post({
      ...body,
      expectedFormData: { plate: 'OLDER', retired: 'keep' },
      answers: { plate: 'TEMP' },
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'edit_conflict' });
    expect(deps.applyEdit).not.toHaveBeenCalled();
  });

  it.each([
    ['unauthenticated', { authenticate: vi.fn(async () => null) }, 401, 'not_authorized'],
    ['non-member', { isMember: vi.fn(async () => false) }, 404, 'not_found'],
    ['missing', { loadRegistration: vi.fn(async () => null) }, 404, 'not_found'],
    [
      'cancelled',
      { loadRegistration: vi.fn(async () => ({ ...registration, status: 'cancelled' })) },
      409,
      'registration_cancelled',
    ],
  ])('rejects %s requests', async (_label, overrides, status, code) => {
    const response = await createUpdateRegistrationAnswersHandler(
      dependencies(overrides),
    )(post());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(expect.objectContaining({ error: code }));
  });

  it.each([
    ['edit_conflict', 409],
    ['registration_cancelled', 409],
    ['not_found', 404],
  ])('maps RPC result %s', async (code, status) => {
    const deps = dependencies({
      applyEdit: vi.fn(async () => ({ ok: false, code })),
    });
    const response = await createUpdateRegistrationAnswersHandler(deps)(post());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });

  it('requires POST and a bearer header', async () => {
    const handler = createUpdateRegistrationAnswersHandler(dependencies());
    const getResponse = await handler(new Request('https://example.test', {
      method: 'GET',
    }));
    const noAuthResponse = await handler(new Request('https://example.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));

    expect(getResponse.status).toBe(405);
    expect(await getResponse.json()).toEqual({ error: 'method_not_allowed' });
    expect(noAuthResponse.status).toBe(401);
    expect(await noAuthResponse.json()).toEqual({ error: 'not_authorized' });
  });

  it('rejects malformed and oversized requests', async () => {
    const handler = createUpdateRegistrationAnswersHandler(dependencies());
    const malformed = await handler(new Request('https://example.test', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: '{',
    }));
    const oversized = await handler(post(body, {
      'Content-Length': String(1024 * 1024 + 1),
    }));

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid_request' });
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ error: 'invalid_request' });
  });

  it('rejects record and event identity mismatches without leaking data', async () => {
    const wrongRegistration = await createUpdateRegistrationAnswersHandler(
      dependencies({
        loadRegistration: vi.fn(async () => ({ ...registration, org_id: 'other' })),
      }),
    )(post());
    const wrongEvent = await createUpdateRegistrationAnswersHandler(
      dependencies({
        loadEvent: vi.fn(async () => ({ ...event, org_id: 'other' })),
      }),
    )(post());

    expect(wrongRegistration.status).toBe(404);
    expect(await wrongRegistration.json()).toEqual({ error: 'not_found' });
    expect(wrongEvent.status).toBe(404);
    expect(await wrongEvent.json()).toEqual({ error: 'not_found' });
  });

  it('returns invalid_request for answers that fail current form rules', async () => {
    const response = await createUpdateRegistrationAnswersHandler(
      dependencies(),
    )(post({ ...body, answers: {} }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  });

  it('logs only a request id and stable code for unexpected failures', async () => {
    const deps = dependencies({
      loadRegistration: vi.fn(async () => { throw new Error('database included PII'); }),
    });
    const response = await createUpdateRegistrationAnswersHandler(deps)(post());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'save_failed',
      requestId: 'request-1',
    });
    expect(deps.log).toHaveBeenCalledWith({
      requestId: 'request-1',
      code: 'save_failed',
    });
  });
});
