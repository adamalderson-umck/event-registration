const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileSuccess {
  success: true;
  challenge_ts?: string;
  hostname: string;
  action: string;
}

export interface VerifyTurnstileOptions {
  secret: string;
  token: string;
  remoteIp?: string;
  expectedHostnames: string[];
  expectedAction: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isAcceptedResult(
  value: unknown,
  expectedHostnames: string[],
  expectedAction: string,
): value is TurnstileSuccess {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return result.success === true &&
    typeof result.hostname === 'string' && expectedHostnames.includes(result.hostname) &&
    result.action === expectedAction;
}

export async function verifyTurnstile({
  secret,
  token,
  remoteIp,
  expectedHostnames,
  expectedAction,
  fetchImpl = fetch,
  timeoutMs = 5000,
}: VerifyTurnstileOptions): Promise<TurnstileSuccess> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (!secret || !token || expectedHostnames.length === 0 || !expectedAction) {
      throw new Error('security_verification_failed');
    }

    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!response.ok) throw new Error('security_verification_failed');

    const result: unknown = await response.json();
    if (!isAcceptedResult(result, expectedHostnames, expectedAction)) {
      throw new Error('security_verification_failed');
    }
    return result;
  } catch {
    throw new Error('security_verification_failed');
  } finally {
    clearTimeout(timeout);
  }
}
