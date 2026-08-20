import { describe, expect, it } from 'vitest';
import {
  assertEventAcceptsRegistration,
  buildRegistrationInsert,
  parseRegistrationRequest,
} from './registration-request.ts';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const TITHELY_FORM_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '55555555-5555-4555-8555-555555555555';

const baseRequest = {
  turnstileToken: 'verified-token',
  eventId: EVENT_ID,
  orgId: ORG_ID,
  formData: {
    system_email: 'person@example.com',
    name: 'Person Example',
    attendance: 'Sunday',
    updates: true,
    interests: ['Music'],
  },
  paymentMethod: null,
  waitlistIntent: false,
  signatureRecords: [{
    waiverId: 'waiver-1',
    declined: false,
    consentToESign: true,
    signerName: 'Person Example',
    signatureMethod: 'draw',
    signatureData: 'data:image/png;base64,c2lnbmF0dXJl',
  }],
  submissionAttemptId: ATTEMPT_ID,
  recentDuplicateOverride: false,
};

const baseEvent = {
  id: EVENT_ID,
  org_id: ORG_ID,
  status: 'active',
  registration_close_date: '2026-08-07T00:00:00.000Z',
  payment_enabled: false,
  allow_in_person_payment: false,
  tithely_giving_url: null,
  tithely_embed_config: null,
  form_fields: [
    { id: 'system_email', type: 'email', required: true },
    { id: 'name', type: 'text', required: true },
    { id: 'attendance', type: 'radio', required: true, options: ['Sunday', 'Monday'] },
    { id: 'updates', type: 'checkbox', required: false },
    { id: 'interests', type: 'checkboxGroup', required: false, options: ['Music', 'Service'] },
    { id: 'section-1', type: 'sectionBreak', label: 'More' },
    { id: 'hidden', type: 'text', condition: { field: 'attendance', operator: 'equals', value: 'Monday' } },
  ],
  waivers: [{
    id: 'waiver-1',
    title: 'Liability Waiver',
    contentHash: 'sha256:abc',
    required: true,
  }],
};

const metadata = {
  ipAddress: '203.0.113.10',
  userAgent: 'Test Browser',
  now: new Date('2026-08-06T12:00:00.000Z'),
};

describe('parseRegistrationRequest', () => {
  it('accepts the current public request shape', () => {
    expect(parseRegistrationRequest(baseRequest)).toEqual(baseRequest);
  });

  it('normalizes the cached-legacy shape only when both new fields are absent', () => {
    const { submissionAttemptId, recentDuplicateOverride, ...legacyRequest } = baseRequest;

    expect(parseRegistrationRequest(legacyRequest)).toEqual({
      ...legacyRequest,
      submissionAttemptId: null,
      recentDuplicateOverride: false,
    });
  });

  it('parses only boolean waitlist intent and defaults legacy requests to false', () => {
    expect(parseRegistrationRequest({ ...baseRequest, waitlistIntent: true }))
      .toMatchObject({ waitlistIntent: true });
    expect(() => parseRegistrationRequest({ ...baseRequest, waitlistIntent: 'true' }))
      .toThrow('invalid_request');

    const { waitlistIntent: _omitted, ...legacyRequest } = baseRequest;
    expect(parseRegistrationRequest(legacyRequest)).toMatchObject({ waitlistIntent: false });
  });

  it('rejects malformed or incomplete attempt contracts', () => {
    expect(() => parseRegistrationRequest({ ...baseRequest, submissionAttemptId: 'not-a-uuid' }))
      .toThrow('invalid_request');
    expect(() => parseRegistrationRequest({ ...baseRequest, recentDuplicateOverride: 'yes' }))
      .toThrow('invalid_request');

    const { recentDuplicateOverride, ...missingOverride } = baseRequest;
    expect(() => parseRegistrationRequest(missingOverride)).toThrow('invalid_request');

    const { submissionAttemptId, ...overrideWithoutAttempt } = baseRequest;
    expect(() => parseRegistrationRequest(overrideWithoutAttempt)).toThrow('invalid_request');
  });

  it('rejects unexpected top-level fields', () => {
    expect(() => parseRegistrationRequest({ ...baseRequest, status: 'confirmed' }))
      .toThrow('invalid_request');
  });

  it('rejects malformed identifiers and oversized Turnstile tokens', () => {
    expect(() => parseRegistrationRequest({ ...baseRequest, eventId: 'not-a-uuid' }))
      .toThrow('invalid_request');
    expect(() => parseRegistrationRequest({ ...baseRequest, turnstileToken: 'x'.repeat(2049) }))
      .toThrow('invalid_request');
  });

  it('rejects a request whose serialized body exceeds one MiB', () => {
    expect(() => parseRegistrationRequest({
      ...baseRequest,
      formData: { name: 'x'.repeat(1024 * 1024) },
    })).toThrow('invalid_request');
  });
});

describe('assertEventAcceptsRegistration', () => {
  it('accepts a matching active event before its close date', () => {
    expect(() => assertEventAcceptsRegistration(baseEvent, baseRequest, metadata.now)).not.toThrow();
  });

  it.each([
    [{ ...baseEvent, org_id: '44444444-4444-4444-8444-444444444444' }],
    [{ ...baseEvent, status: 'closed' }],
    [{ ...baseEvent, registration_close_date: '2026-08-06T11:59:59.000Z' }],
  ])('rejects an unavailable or mismatched event', (event) => {
    expect(() => assertEventAcceptsRegistration(event, baseRequest, metadata.now))
      .toThrow('registration_unavailable');
  });
});

describe('buildRegistrationInsert', () => {
  it('reconstructs authoritative registration and waiver metadata server-side', () => {
    const result = buildRegistrationInsert(baseEvent, baseRequest, metadata);

    expect(result).toEqual({
      event_id: EVENT_ID,
      org_id: ORG_ID,
      form_data: baseRequest.formData,
      status: 'pending',
      payment_status: 'not_required',
      payment_method: null,
      signature_records: [{
        waiverId: 'waiver-1',
        waiverTitle: 'Liability Waiver',
        waiverContentHash: 'sha256:abc',
        signed: true,
        signedAt: '2026-08-06T12:00:00.000Z',
        signerName: 'Person Example',
        signerEmail: 'person@example.com',
        signatureMethod: 'draw',
        signatureData: 'data:image/png;base64,c2lnbmF0dXJl',
        signatureFont: null,
        consentToESign: true,
        ipAddress: '203.0.113.10',
        userAgent: 'Test Browser',
      }],
    });

    const normalizedResult = buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      formData: { ...baseRequest.formData, system_email: '  PERSON@Example.COM ' },
    }, metadata);

    expect(normalizedResult.form_data.system_email).toBe('person@example.com');
  });

  it('rejects unknown and conditionally hidden form fields', () => {
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      formData: { ...baseRequest.formData, unknown: 'x' },
    }, metadata)).toThrow('invalid_request');
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      formData: { ...baseRequest.formData, hidden: 'should-not-submit' },
    }, metadata)).toThrow('invalid_request');
  });

  it('rejects invalid field types, values, and excessive values', () => {
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      formData: { ...baseRequest.formData, updates: 'yes' },
    }, metadata)).toThrow('invalid_request');
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      formData: { ...baseRequest.formData, attendance: 'Never' },
    }, metadata)).toThrow('invalid_request');
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      formData: { ...baseRequest.formData, name: 'x'.repeat(4097) },
    }, metadata)).toThrow('invalid_request');
  });

  it('enforces required fields and validates email and phone formats', () => {
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      formData: { ...baseRequest.formData, name: '' },
    }, metadata)).toThrow('invalid_request');
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      formData: { ...baseRequest.formData, system_email: 'invalid' },
    }, metadata)).toThrow('invalid_request');

    const phoneEvent = {
      ...baseEvent,
      form_fields: [...baseEvent.form_fields, { id: 'phone', type: 'phone', required: true }],
    };
    expect(() => buildRegistrationInsert(phoneEvent, {
      ...baseRequest,
      formData: { ...baseRequest.formData, phone: '123' },
    }, metadata)).toThrow('invalid_request');
  });

  it('rejects duplicate, unknown, missing, or invalid waiver decisions', () => {
    const signed = baseRequest.signatureRecords[0];
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      signatureRecords: [signed, signed],
    }, metadata)).toThrow('invalid_request');
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      signatureRecords: [{ ...signed, waiverId: 'unknown' }],
    }, metadata)).toThrow('invalid_request');
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      signatureRecords: [],
    }, metadata)).toThrow('invalid_request');
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      signatureRecords: [{ ...signed, declined: true }],
    }, metadata)).toThrow('invalid_request');
  });

  it('bounds signature data and rejects client-supplied signature metadata', () => {
    const signed = baseRequest.signatureRecords[0];
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      signatureRecords: [{ ...signed, signatureData: 'x'.repeat(512 * 1024 + 1) }],
    }, metadata)).toThrow('invalid_request');
    expect(() => buildRegistrationInsert(baseEvent, {
      ...baseRequest,
      signatureRecords: [{ ...signed, ipAddress: 'attacker-controlled' }],
    }, metadata)).toThrow('invalid_request');
  });

  it('allows an optional waiver decline and derives its stored metadata', () => {
    const event = {
      ...baseEvent,
      waivers: [{ ...baseEvent.waivers[0], required: false }],
    };
    const result = buildRegistrationInsert(event, {
      ...baseRequest,
      signatureRecords: [{ waiverId: 'waiver-1', declined: true }],
    }, metadata);

    expect(result.signature_records).toEqual([expect.objectContaining({
      signed: false,
      declined: true,
      declinedAt: '2026-08-06T12:00:00.000Z',
      waiverTitle: 'Liability Waiver',
      ipAddress: '203.0.113.10',
    })]);
  });

  it('permits only payment methods configured on the event', () => {
    const event = {
      ...baseEvent,
      payment_enabled: true,
      allow_in_person_payment: true,
      tithely_giving_url: `https://give.tithe.ly/?formId=${TITHELY_FORM_ID}`,
      tithely_embed_config: { formId: TITHELY_FORM_ID },
    };

    expect(buildRegistrationInsert(event, {
      ...baseRequest,
      paymentMethod: 'tithely',
    }, metadata)).toMatchObject({ payment_status: 'pending', payment_method: 'tithely' });
    expect(buildRegistrationInsert(event, {
      ...baseRequest,
      paymentMethod: 'in_person',
    }, metadata)).toMatchObject({ payment_status: 'pending', payment_method: 'in_person' });
    expect(() => buildRegistrationInsert(event, {
      ...baseRequest,
      paymentMethod: 'other',
    }, metadata)).toThrow('invalid_request');
  });

  it('defers payment only for a plausible full waitlist', () => {
    const fullEvent = {
      ...baseEvent,
      payment_enabled: true,
      capacity: 10,
      registration_count: 10,
      waitlist_enabled: true,
    };

    expect(buildRegistrationInsert(fullEvent, {
      ...baseRequest,
      paymentMethod: null,
      waitlistIntent: true,
    }, metadata)).toMatchObject({
      payment_status: 'not_required',
      payment_method: null,
    });
    expect(() => buildRegistrationInsert({ ...fullEvent, registration_count: 9 }, {
      ...baseRequest,
      paymentMethod: null,
      waitlistIntent: true,
    }, metadata)).toThrow('invalid_request');
    expect(() => buildRegistrationInsert({ ...fullEvent, waitlist_enabled: false }, {
      ...baseRequest,
      paymentMethod: null,
      waitlistIntent: true,
    }, metadata)).toThrow('invalid_request');
  });
});
