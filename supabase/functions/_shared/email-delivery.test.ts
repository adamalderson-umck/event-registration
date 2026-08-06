import { describe, expect, it, vi } from 'vitest';
import { deliverOnce, type DeliveryClaim, type DeliveryStore } from './email-delivery.ts';

const claim: DeliveryClaim = {
  deliveryKey: 'registration_confirmation:registration-1:created-at',
  orgId: 'org-1',
  eventId: 'event-1',
  registrationId: 'registration-1',
  kind: 'registration_confirmation',
};

function storeWith(
  claimResult: 'claimed' | 'already_sent' | 'in_progress',
): DeliveryStore & {
  claim: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
} {
  return {
    claim: vi.fn(async () => claimResult),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  };
}

describe('deliverOnce', () => {
  it('sends and completes a newly claimed delivery', async () => {
    const store = storeWith('claimed');
    const send = vi.fn(async () => undefined);

    expect(await deliverOnce(store, claim, send)).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.complete).toHaveBeenCalledWith(claim.deliveryKey);
  });

  it('skips an already sent key', async () => {
    const store = storeWith('already_sent');
    const send = vi.fn();

    expect(await deliverOnce(store, claim, send)).toBe('already_sent');
    expect(send).not.toHaveBeenCalled();
  });

  it('does not send or claim completion while another invocation owns the key', async () => {
    const store = storeWith('in_progress');
    const send = vi.fn();

    expect(await deliverOnce(store, claim, send)).toBe('in_progress');
    expect(send).not.toHaveBeenCalled();
    expect(store.complete).not.toHaveBeenCalled();
  });

  it('records a sanitized failure code and remains retryable', async () => {
    const store = storeWith('claimed');
    const send = vi.fn(async () => {
      throw new Error('SMTP exposed person@example.org');
    });

    expect(await deliverOnce(store, claim, send)).toBe('failed');
    expect(store.fail).toHaveBeenCalledWith(claim.deliveryKey, 'smtp_send_failed');
    expect(JSON.stringify(store.fail.mock.calls)).not.toContain('person@example.org');
  });
});
