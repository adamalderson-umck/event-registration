import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../supabase', () => ({
  supabase: { rpc: mocks.rpc },
}));

import {
  listRegistrationEmailDeliveryStatuses,
  retryRegistrationEmailDelivery,
} from '../registrationEmailDelivery';

describe('registration email delivery service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns event-scoped statuses keyed by registration ID', async () => {
    const statuses = [
      { registration_id: 'registration-1', state: 'sent' },
      { registration_id: 'registration-2', state: 'failed', exhausted: true },
    ];
    mocks.rpc.mockResolvedValue({ data: statuses, error: null });

    const result = await listRegistrationEmailDeliveryStatuses('org-1', 'event-1');

    expect(mocks.rpc).toHaveBeenCalledWith(
      'get_registration_email_delivery_statuses',
      { p_org_id: 'org-1', p_event_id: 'event-1' },
    );
    expect(result).toEqual(new Map([
      ['registration-1', statuses[0]],
      ['registration-2', statuses[1]],
    ]));
  });

  it('maps status transport failures to a stable code', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: new Error('private database detail'),
    });

    await expect(
      listRegistrationEmailDeliveryStatuses('org-1', 'event-1'),
    ).rejects.toMatchObject({ code: 'email_status_failed' });
  });

  it('queues the exact exhausted delivery', async () => {
    mocks.rpc.mockResolvedValue({
      data: { ok: true, code: 'queued' },
      error: null,
    });

    await expect(retryRegistrationEmailDelivery({
      orgId: 'org-1',
      registrationId: 'registration-1',
      deliveryId: 'delivery-1',
    })).resolves.toEqual({ ok: true, code: 'queued' });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'retry_registration_email_delivery',
      {
        p_org_id: 'org-1',
        p_registration_id: 'registration-1',
        p_delivery_id: 'delivery-1',
      },
    );
  });

  it.each([
    'registration_not_found',
    'delivery_not_found',
    'not_applicable',
    'not_exhausted',
    'configuration_unavailable',
  ])('preserves the stable %s domain response', async (code) => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, code }, error: null });

    await expect(retryRegistrationEmailDelivery({
      orgId: 'org-1',
      registrationId: 'registration-1',
      deliveryId: 'delivery-1',
    })).rejects.toMatchObject({ code });
  });

  it.each([
    { data: null, error: null },
    { data: null, error: new Error('private network detail') },
    { data: { ok: true, code: 'unexpected' }, error: null },
  ])('maps invalid or failed retry responses to a stable code', async (response) => {
    mocks.rpc.mockResolvedValue(response);

    await expect(retryRegistrationEmailDelivery({
      orgId: 'org-1',
      registrationId: 'registration-1',
      deliveryId: 'delivery-1',
    })).rejects.toMatchObject({ code: 'email_retry_failed' });
  });
});
