import { describe, expect, it } from 'vitest';
import {
  isKentMethodistGoogleUser,
  isKentMethodistEmail,
} from '../../../supabase/functions/_shared/admin-access.ts';

describe('admin identity rules used by Edge Functions', () => {
  it('accepts a confirmed kentmethodist.org user with a Google identity', () => {
    expect(isKentMethodistGoogleUser({
      email: 'Admin@KentMethodist.org',
      email_confirmed_at: '2026-08-05T12:00:00Z',
      identities: [{
        provider: 'google',
        identity_data: { email: 'Admin@KentMethodist.org', email_verified: true },
      }],
    })).toBe(true);
  });

  it.each([
    ['an outside domain', { email: 'admin@gmail.com', email_confirmed_at: 'now', identities: [{ provider: 'google' }] }],
    ['a deceptive suffix', { email: 'admin@kentmethodist.org.example', email_confirmed_at: 'now', identities: [{ provider: 'google' }] }],
    ['a non-Google identity', { email: 'admin@kentmethodist.org', email_confirmed_at: 'now', identities: [{ provider: 'email' }] }],
    ['an unconfirmed address', { email: 'admin@kentmethodist.org', identities: [{ provider: 'google' }] }],
    ['a Google identity for another domain', {
      email: 'admin@kentmethodist.org',
      email_confirmed_at: 'now',
      identities: [{
        provider: 'google',
        identity_data: { email: 'admin@gmail.com', email_verified: true },
      }],
    }],
    ['an unverified Google identity email', {
      email: 'admin@kentmethodist.org',
      email_confirmed_at: 'now',
      identities: [{
        provider: 'google',
        identity_data: { email: 'admin@kentmethodist.org', email_verified: false },
      }],
    }],
  ])('rejects %s', (_label, user) => {
    expect(isKentMethodistGoogleUser(user)).toBe(false);
  });

  it('requires an exact kentmethodist.org email for prospective members', () => {
    expect(isKentMethodistEmail('person@kentmethodist.org')).toBe(true);
    expect(isKentMethodistEmail('person@sub.kentmethodist.org')).toBe(false);
    expect(isKentMethodistEmail('person@kentmethodist.org.evil')).toBe(false);
  });
});
