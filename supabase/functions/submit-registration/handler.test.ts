import { describe, expect, it, vi } from 'vitest';
import { createSubmitRegistrationHandler } from './handler.ts';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const allowedOrigin = 'https://events.kentmethodist.org';
const requestBody = {
  turnstileToken: 'browser-response-token',
  eventId: EVENT_ID,
  orgId: ORG_ID,
  formData: { system_email: 'Person@Example.com' },
  paymentMethod: null,
  waitlistIntent: false,
  signatureRecords: [],
  submissionAttemptId: ATTEMPT_ID,
  recentDuplicateOverride: false,
};
const event = {
  id: EVENT_ID,
  org_id: ORG_ID,
  status: 'active',
  registration_close_date: null,
  capacity: null,
  registration_count: 0,
  waitlist_enabled: false,
  payment_enabled: false,
  allow_in_person_payment: false,
  tithely_giving_url: null,
  tithely_embed_config: null,
  form_fields: [{ id: 'system_email', type: 'email', required: true, system: true }],
  waivers: [],
};
const created = {
  id: '33333333-3333-4333-8333-333333333333',
  status: 'confirmed',
  payment_status: 'not_required',
  payment_method: null,
};

function makeAdminClient({
  eventData = event,
  eventError = null,
  lookupResults = [],
  insertData = created,
  insertError = null,
} = {}) {
  const eventSingle = vi.fn(async () => ({ data: eventData, error: eventError }));
  const eventEq2 = vi.fn(() => ({ single: eventSingle }));
  const eventEq1 = vi.fn(() => ({ eq: eventEq2 }));
  const eventSelect = vi.fn(() => ({ eq: eventEq1 }));
  const maybeSingle = vi.fn();
  lookupResults.forEach((result) => maybeSingle.mockResolvedValueOnce(result));
  maybeSingle.mockResolvedValue({ data: null, error: null });
  const lookupChain = {
    eq: vi.fn(() => lookupChain),
    in: vi.fn(() => lookupChain),
    gte: vi.fn(() => lookupChain),
    limit: vi.fn(() => lookupChain),
    maybeSingle,
  };
  const registrationSelect = vi.fn(() => lookupChain);
  const insertSingle = vi.fn(async () => ({ data: insertData, error: insertError }));
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));
  const from = vi.fn((table: string) => table === 'events'
    ? { select: eventSelect }
    : { select: registrationSelect, insert });
  return {
    client: { from },
    mocks: {
      from,
      eventSelect,
      eventEq1,
      eventEq2,
      eventSingle,
      lookupChain,
      maybeSingle,
      registrationSelect,
      insert,
      insertSelect,
      insertSingle,
    },
  };
}

function post(body: unknown = requestBody, headers: Record<string, string> = {}): Request {
  return new Request('https://project.supabase.co/functions/v1/submit-registration', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      'User-Agent': 'Test Browser',
      'X-Forwarded-For': '203.0.113.10',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function setup(adminOverrides = {}) {
  const { client, mocks } = makeAdminClient(adminOverrides);
  const verifyTurnstileFn = vi.fn(async () => ({
    success: true as const,
    hostname: 'events.kentmethodist.org',
    action: 'event_registration',
  }));
  const log = vi.fn();
  const handler = createSubmitRegistrationHandler({
    adminClient: client,
    turnstileSecret: 'server-secret',
    expectedHostnames: ['events.kentmethodist.org', 'event-registration-b7840.web.app'],
    expectedAction: 'event_registration',
    verifyTurnstileFn,
    log,
    now: () => new Date('2026-08-07T12:00:00.000Z'),
    requestId: () => 'request-123',
    attemptId: () => '66666666-6666-4666-8666-666666666666',
  });
  return { handler, verifyTurnstileFn, log, mocks };
}

describe('submit-registration HTTP handler', () => {
  it('answers an allowed CORS preflight without credentials', async () => {
    const { handler } = setup();
    const response = await handler(new Request('https://project.supabase.co/functions/v1/submit-registration', {
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('rejects disallowed browser origins and unsupported content types before verification', async () => {
    const { handler, verifyTurnstileFn, mocks } = setup();
    const badOrigin = await handler(post(requestBody, { Origin: 'https://evil.example' }));
    const badType = await handler(post(requestBody, { 'Content-Type': 'text/plain' }));

    expect(badOrigin.status).toBe(403);
    expect(badType.status).toBe(400);
    expect(verifyTurnstileFn).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('rejects non-POST methods and oversized declared bodies', async () => {
    const { handler } = setup();
    const getResponse = await handler(new Request('https://project.supabase.co/functions/v1/submit-registration', {
      method: 'GET',
      headers: { Origin: allowedOrigin },
    }));
    const oversized = await handler(post(requestBody, { 'Content-Length': String(1024 * 1024 + 1) }));

    expect(getResponse.status).toBe(405);
    expect(oversized.status).toBe(400);
  });

  it('verifies the token and inserts only a server-built registration', async () => {
    const { handler, verifyTurnstileFn, mocks } = setup();
    const response = await handler(post());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(created);
    expect(verifyTurnstileFn).toHaveBeenCalledWith(expect.objectContaining({
      secret: 'server-secret',
      token: 'browser-response-token',
      remoteIp: '203.0.113.10',
      expectedHostnames: ['events.kentmethodist.org', 'event-registration-b7840.web.app'],
      expectedAction: 'event_registration',
    }));
    expect(mocks.insert).toHaveBeenCalledWith({
      event_id: EVENT_ID,
      org_id: ORG_ID,
      form_data: { system_email: 'person@example.com' },
      status: 'pending',
      payment_status: 'not_required',
      payment_method: null,
      signature_records: [],
      submission_attempt_id: ATTEMPT_ID,
    });
  });

  it('accepts deferred payment for a full enabled waitlist', async () => {
    const waitlistEvent = {
      ...event,
      payment_enabled: true,
      capacity: 10,
      registration_count: 10,
      waitlist_enabled: true,
    };
    const { handler, mocks } = setup({ eventData: waitlistEvent });
    const response = await handler(post({ ...requestBody, waitlistIntent: true }));

    expect(response.status).toBe(200);
    expect(mocks.eventSelect).toHaveBeenCalledWith(expect.stringContaining('capacity,registration_count,waitlist_enabled'));
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      payment_status: 'not_required',
      payment_method: null,
    }));
  });

  it('returns an existing same-scope attempt before checking recency or inserting', async () => {
    const existing = { ...created, event_id: EVENT_ID, org_id: ORG_ID };
    const { handler, mocks } = setup({
      lookupResults: [{ data: existing, error: null }],
    });

    const response = await handler(post());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(created);
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('returns a sanitized warning for a recent active same-email registration', async () => {
    const { handler, log, mocks } = setup({
      lookupResults: [
        { data: null, error: null },
        { data: { id: 'recent-registration' }, error: null },
      ],
    });

    const response = await handler(post());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'recent_registration',
      requestId: 'request-123',
    });
    expect(mocks.lookupChain.eq).toHaveBeenCalledWith('org_id', ORG_ID);
    expect(mocks.lookupChain.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(mocks.lookupChain.eq).toHaveBeenCalledWith(
      'form_data->>system_email',
      'person@example.com',
    );
    expect(mocks.lookupChain.in).toHaveBeenCalledWith(
      'status',
      ['pending', 'confirmed', 'waitlisted'],
    );
    expect(mocks.lookupChain.gte).toHaveBeenCalledWith(
      'created_at',
      '2026-08-07T11:50:00.000Z',
    );
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('allows an explicit override without bypassing trusted insertion', async () => {
    const { handler, mocks } = setup({
      lookupResults: [{ data: null, error: null }],
    });

    const response = await handler(post({ ...requestBody, recentDuplicateOverride: true }));

    expect(response.status).toBe(200);
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      submission_attempt_id: ATTEMPT_ID,
      form_data: { system_email: 'person@example.com' },
    }));
  });

  it('keeps cached legacy clients compatible without emitting an unreadable warning', async () => {
    const legacyBody: Record<string, unknown> = { ...requestBody };
    delete legacyBody.submissionAttemptId;
    delete legacyBody.recentDuplicateOverride;
    const { handler, mocks } = setup({
      lookupResults: [{ data: null, error: null }],
    });

    const response = await handler(post(legacyBody));

    expect(response.status).toBe(200);
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      submission_attempt_id: '66666666-6666-4666-8666-666666666666',
    }));
  });

  it('fails closed when the attempt lookup fails', async () => {
    const { handler, log, mocks } = setup({
      lookupResults: [{ data: null, error: { message: 'private lookup detail' } }],
    });

    const response = await handler(post());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'submission_failed',
      requestId: 'request-123',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ code: 'attempt_lookup_failed' }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('private lookup detail');
  });

  it('rejects an attempt identifier already used by another scope', async () => {
    const { handler, mocks } = setup({
      lookupResults: [{
        data: {
          ...created,
          event_id: '77777777-7777-4777-8777-777777777777',
          org_id: ORG_ID,
        },
        error: null,
      }],
    });

    const response = await handler(post());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      requestId: 'request-123',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('inserts once when the attempt and recent-registration lookups are empty', async () => {
    const { handler, mocks } = setup({
      lookupResults: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    });

    const response = await handler(post());

    expect(response.status).toBe(200);
    expect(mocks.lookupChain.eq).toHaveBeenCalledWith('org_id', ORG_ID);
    expect(mocks.lookupChain.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(mocks.lookupChain.eq).toHaveBeenCalledWith(
      'form_data->>system_email',
      'person@example.com',
    );
    expect(mocks.lookupChain.in).toHaveBeenCalledWith(
      'status',
      ['pending', 'confirmed', 'waitlisted'],
    );
    expect(mocks.lookupChain.gte).toHaveBeenCalledWith(
      'created_at',
      '2026-08-07T11:50:00.000Z',
    );
    expect(mocks.lookupChain.limit).toHaveBeenCalledWith(1);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the recent-registration lookup fails', async () => {
    const { handler, log, mocks } = setup({
      lookupResults: [
        { data: null, error: null },
        { data: null, error: { message: 'private recent detail' } },
      ],
    });

    const response = await handler(post());

    expect(response.status).toBe(500);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      code: 'recent_registration_lookup_failed',
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('private recent detail');
  });

  it('recovers a same-attempt insert race without logging or inserting again', async () => {
    const existing = { ...created, event_id: EVENT_ID, org_id: ORG_ID };
    const { handler, log, mocks } = setup({
      lookupResults: [
        { data: null, error: null },
        { data: null, error: null },
        { data: existing, error: null },
      ],
      insertData: null,
      insertError: { message: 'unique violation detail' },
    });

    const response = await handler(post());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(created);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({
      code: 'registration_insert_failed',
    }));
  });

  it('uses the Supabase gateway IP header and ignores a caller-supplied Cloudflare header', async () => {
    const { handler, verifyTurnstileFn, mocks } = setup();
    const response = await handler(post(requestBody, {
      'CF-Connecting-IP': '198.51.100.99',
      'X-Forwarded-For': '203.0.113.10, 192.0.2.1',
    }));

    expect(response.status).toBe(200);
    expect(verifyTurnstileFn).toHaveBeenCalledWith(expect.objectContaining({
      remoteIp: '203.0.113.10',
    }));
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      signature_records: [],
    }));
  });

  it('fails closed when Siteverify rejects and does not log sensitive values', async () => {
    const { handler, verifyTurnstileFn, log, mocks } = setup();
    verifyTurnstileFn.mockRejectedValue(new Error('provider included browser-response-token'));

    const response = await handler(post());
    const serializedLogs = JSON.stringify(log.mock.calls);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'security_verification_failed',
      requestId: 'request-123',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(serializedLogs).not.toContain('browser-response-token');
    expect(serializedLogs).not.toContain('server-secret');
    expect(serializedLogs).not.toContain('person@example.com');
    expect(serializedLogs).not.toContain('provider included');
  });

  it('returns registration unavailable without inserting when the event does not exist', async () => {
    const { handler, mocks } = setup({ eventData: null });
    const response = await handler(post());

    expect(response.status).toBe(409);
    expect(mocks.insert).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: 'registration_unavailable',
      requestId: 'request-123',
    });
  });

  it('keeps an unrecovered insert failure generic and PII-free', async () => {
    const { handler, log, mocks } = setup({
      lookupResults: [
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
      insertError: { message: 'secret database detail' },
      insertData: null,
    });
    const response = await handler(post());
    const serializedLogs = JSON.stringify(log.mock.calls);

    expect(response.status).toBe(500);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      error: 'submission_failed',
      requestId: 'request-123',
    });
    expect(serializedLogs).toContain('registration_insert_failed');
    expect(serializedLogs).not.toContain('secret database detail');
    expect(serializedLogs).not.toContain('person@example.com');
    expect(serializedLogs).not.toContain('browser-response-token');
    expect(serializedLogs).not.toContain('203.0.113.10');
  });

  it('maps an atomic payment-selection race to a sanitized conflict', async () => {
    const { handler, log, mocks } = setup({
      lookupResults: [
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
      insertError: { message: 'payment_selection_required', details: 'secret database detail' },
      insertData: null,
    });
    const response = await handler(post());
    const serializedLogs = JSON.stringify(log.mock.calls);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'availability_changed',
      requestId: 'request-123',
    });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(serializedLogs).not.toContain('secret database detail');
  });
});
