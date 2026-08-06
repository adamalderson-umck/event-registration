import { describe, expect, it, vi } from 'vitest';
import { createSubmitRegistrationHandler } from './handler.ts';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const allowedOrigin = 'https://events.kentmethodist.org';
const requestBody = {
  turnstileToken: 'browser-response-token',
  eventId: EVENT_ID,
  orgId: ORG_ID,
  formData: { email: 'person@example.com' },
  paymentMethod: null,
  signatureRecords: [],
};
const event = {
  id: EVENT_ID,
  org_id: ORG_ID,
  status: 'active',
  registration_close_date: null,
  payment_enabled: false,
  allow_in_person_payment: false,
  tithely_giving_url: null,
  tithely_embed_config: null,
  form_fields: [{ id: 'email', type: 'email', required: true }],
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
  insertData = created,
  insertError = null,
} = {}) {
  const eventSingle = vi.fn(async () => ({ data: eventData, error: eventError }));
  const eventEq2 = vi.fn(() => ({ single: eventSingle }));
  const eventEq1 = vi.fn(() => ({ eq: eventEq2 }));
  const eventSelect = vi.fn(() => ({ eq: eventEq1 }));
  const insertSingle = vi.fn(async () => ({ data: insertData, error: insertError }));
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));
  const from = vi.fn((table: string) => table === 'events'
    ? { select: eventSelect }
    : { insert });
  return {
    client: { from },
    mocks: { from, eventSelect, eventEq1, eventEq2, eventSingle, insert, insertSelect, insertSingle },
  };
}

function post(body: unknown = requestBody, headers: Record<string, string> = {}): Request {
  return new Request('https://project.supabase.co/functions/v1/submit-registration', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      'User-Agent': 'Test Browser',
      'CF-Connecting-IP': '203.0.113.10',
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
    now: () => new Date('2026-08-06T12:00:00.000Z'),
    requestId: () => 'request-123',
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
      form_data: { email: 'person@example.com' },
      status: 'pending',
      payment_status: 'not_required',
      payment_method: null,
      signature_records: [],
    });
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

  it('returns a generic server error and logs no raw database detail', async () => {
    const { handler, log, mocks } = setup({ insertError: { message: 'secret database detail' }, insertData: null });
    const response = await handler(post());

    expect(response.status).toBe(500);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      error: 'submission_failed',
      requestId: 'request-123',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret database detail');
    expect(JSON.stringify(log.mock.calls)).not.toContain('person@example.com');
  });
});
