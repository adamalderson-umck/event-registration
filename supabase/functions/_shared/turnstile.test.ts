import { describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from './turnstile.ts';

const acceptedResult = {
  success: true,
  challenge_ts: '2026-08-06T12:00:00.000Z',
  hostname: 'events.kentmethodist.org',
  action: 'event_registration',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function options(fetchImpl: typeof fetch) {
  return {
    secret: 'test-server-secret',
    token: 'test-response-token',
    remoteIp: '203.0.113.10',
    expectedHostnames: ['events.kentmethodist.org', 'event-registration-b7840.web.app'],
    expectedAction: 'event_registration',
    fetchImpl,
    timeoutMs: 100,
  };
}

describe('verifyTurnstile', () => {
  it('posts form-encoded verification to the fixed Cloudflare endpoint', async () => {
    const fetchImpl = vi.fn(async () => response(acceptedResult));

    await expect(verifyTurnstile(options(fetchImpl))).resolves.toEqual(acceptedResult);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    expect((init?.body as URLSearchParams).toString()).toBe(
      'secret=test-server-secret&response=test-response-token&remoteip=203.0.113.10',
    );
  });

  it('omits remoteip when a trusted platform IP is unavailable', async () => {
    const fetchImpl = vi.fn(async () => response(acceptedResult));
    await verifyTurnstile({ ...options(fetchImpl), remoteIp: '' });

    const init = fetchImpl.mock.calls[0][1];
    expect((init?.body as URLSearchParams).has('remoteip')).toBe(false);
  });

  it.each([
    [{ success: false, 'error-codes': ['invalid-input-response'] }],
    [{ ...acceptedResult, hostname: 'evil.example' }],
    [{ ...acceptedResult, action: 'other_action' }],
    [{ ...acceptedResult, success: 'true' }],
  ])('fails closed for a rejected or mismatched provider result', async (providerResult) => {
    const fetchImpl = vi.fn(async () => response(providerResult));

    await expect(verifyTurnstile(options(fetchImpl)))
      .rejects.toThrow('security_verification_failed');
  });

  it('fails closed for a non-success HTTP response without exposing its body', async () => {
    const fetchImpl = vi.fn(async () => response({ secret: 'provider-detail' }, 500));

    await expect(verifyTurnstile(options(fetchImpl)))
      .rejects.toEqual(new Error('security_verification_failed'));
  });

  it('fails closed for malformed JSON or a network failure', async () => {
    const malformed = vi.fn(async () => new Response('not-json', { status: 200 }));
    const networkFailure = vi.fn(async () => {
      throw new Error('network details');
    });

    await expect(verifyTurnstile(options(malformed)))
      .rejects.toEqual(new Error('security_verification_failed'));
    await expect(verifyTurnstile(options(networkFailure)))
      .rejects.toEqual(new Error('security_verification_failed'));
  });

  it('aborts and fails closed when Siteverify exceeds the timeout', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));

    await expect(verifyTurnstile({ ...options(fetchImpl), timeoutMs: 1 }))
      .rejects.toEqual(new Error('security_verification_failed'));
  });
});
