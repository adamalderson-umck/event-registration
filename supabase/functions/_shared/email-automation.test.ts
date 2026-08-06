import { describe, expect, it } from 'vitest';
import {
  isTrustedAutomationRequest,
  registrationDeliveryKey,
  reminderDeliveryKey,
} from './email-automation.ts';

describe('trusted email automation', () => {
  it('accepts only the exact service-role bearer value', () => {
    const trusted = new Request('https://example.test', {
      headers: { authorization: 'Bearer service-role-secret' },
    });
    const ordinaryUser = new Request('https://example.test', {
      headers: { authorization: 'Bearer ordinary-user-token' },
    });

    expect(isTrustedAutomationRequest(trusted, 'service-role-secret')).toBe(true);
    expect(isTrustedAutomationRequest(ordinaryUser, 'service-role-secret')).toBe(false);
    expect(isTrustedAutomationRequest(trusted, '')).toBe(false);
  });

  it('builds stable registration and occurrence-specific reminder keys', () => {
    expect(registrationDeliveryKey('registration_confirmation', 'reg-1', 'created-at'))
      .toBe('registration_confirmation:reg-1:created-at');
    expect(reminderDeliveryKey('event-1', 'reg-1', '2026-08-15T09:00:00Z', 24))
      .toBe('event_reminder:event-1:reg-1:2026-08-15T09:00:00Z:24');
  });
});
